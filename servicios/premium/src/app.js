import express from 'express'
import { randomUUID } from 'node:crypto'
import { ErrorAutorizaciones } from './autorizaciones.js'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const MAX_PEDIDOS = 10 // el mismo tope que MS-06 (HU-07)

export function validarPeticion(p = {}) {
  if (!/^[0-9]{6,10}$/.test(p.cedula ?? '')) return 'La cédula del ciudadano no es válida.'
  if (!texto(p.proposito, 200)) return 'Falta el propósito de la petición (hasta 200 caracteres).'
  if (!Array.isArray(p.documentos) || !p.documentos.length || p.documentos.length > MAX_PEDIDOS) return `La petición debe pedir entre 1 y ${MAX_PEDIDOS} documentos.`
  if (!p.documentos.every((d) => texto(d?.titulo, 120))) return 'Cada documento pedido necesita un título (hasta 120 caracteres).'
  return null
}

// MS-11: catálogo Premium, casos PQRS y medición de uso de las empresas (RF-07.2, RF-07.3). Solo cobra a empresas (RI-07):
// ninguna operación del ciudadano pasa por aquí. Las peticiones de un caso viajan a MS-06 como las de cualquier entidad,
// así el ciudadano decide documento por documento (RI-08). dependencias: repo (src/repo.js), autorizaciones (MS-06),
// verificar(token) → claims.
export function crearApp({ repo, autorizaciones, verificar, origenes = [] }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  app.use(express.json({ limit: '8kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  // Sesión del portal de una empresa registrada: el token lleva el claim `empresa` (un ciudadano lleva `cedula`).
  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con la cuenta de tu empresa.')
    let claims
    try { claims = await verificar(token) } catch { return problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.') }
    try {
      req.empresa = claims.azp === 'portal' && typeof claims.empresa === 'string' ? await repo.empresa(claims.empresa) : null
    } catch (e) { return next(e) }
    req.empresa ? next() : problema(res, 403, 'Solo para empresas registradas', 'Esta cuenta no pertenece a una empresa cliente.')
  })

  const requierePremium = (req, res, next) => (req.empresa.premium ? next() : problema(res, 403, 'Plan Premium requerido',
    'Tu empresa no tiene un plan Premium activo. Consulta el catálogo para contratarlo.'))

  app.get('/perfil', (req, res) => res.json({ empresa: req.empresa.id, nombre: req.empresa.nombre, premium: req.empresa.premium }))

  app.get('/catalogo', async (_req, res, next) => {
    try { res.json(await repo.catalogo()) } catch (e) { next(e) }
  })

  app.get('/uso', async (req, res, next) => {
    try { res.json(await repo.uso(req.empresa.id)) } catch (e) { next(e) }
  })

  app.post('/casos', requierePremium, async (req, res, next) => {
    if (!texto(req.body?.asunto, 120)) return problema(res, 422, 'Caso inválido', 'Escribe el asunto del caso (hasta 120 caracteres).')
    try {
      res.status(201).json(await repo.abrirCaso({ id: randomUUID(), empresa: req.empresa.id, asunto: req.body.asunto.trim() }))
    } catch (e) { next(e) }
  })

  // El estado de cada petición pendiente se pone al día con MS-06, que es quien lo guarda; si no responde, queda el último conocido.
  app.get('/casos', async (req, res, next) => {
    try {
      const casos = await repo.casosDe(req.empresa.id)
      await Promise.all(casos.flatMap((c) => c.peticiones).filter((x) => x.estado === 'pendiente').map(async (p) => {
        try {
          const { estado } = await autorizaciones.consultarPeticion(p.id, req.empresa.id)
          if (estado !== p.estado) { await repo.actualizarEstado(p.id, estado); p.estado = estado }
        } catch (e) { console.error(JSON.stringify({ nivel: 'warn', mensaje: 'no se pudo poner al día una petición', detalle: e.message })) }
      }))
      res.json(casos)
    } catch (e) { next(e) }
  })

  // RF-07.3: la empresa pide documentos desde un caso. MS-06 la registra antes de medirla, así una petición que no
  // llegó no se cobra. La petición conserva el id que le dio MS-06, con el que después se consulta su estado.
  app.post('/casos/:id/peticiones', requierePremium, async (req, res, next) => {
    const invalido = validarPeticion(req.body)
    if (invalido) return problema(res, 422, 'Petición inválida', invalido)
    try {
      const caso = UUID.test(req.params.id) ? await repo.caso(req.params.id, req.empresa.id) : null
      if (!caso) return problema(res, 404, 'Caso no encontrado')
      const p = req.body
      const pedidos = p.documentos.map((d) => ({ titulo: d.titulo.trim() }))
      // ponytail: si MS-06 acepta y el INSERT local falla, la petición queda sin fila ni medición; reconciliar con un idExterno guardado antes de llamar si ocurre.
      let id
      try {
        ;({ id } = await autorizaciones.crearPeticion({ entidad: req.empresa.id, idExterno: randomUUID(), cedula: p.cedula, proposito: p.proposito.trim(), pedidos }))
      } catch (e) {
        if (!(e instanceof ErrorAutorizaciones)) throw e
        return problema(res, e.status === 422 ? 422 : 502, 'No pudimos enviar la petición', 'El servicio de autorizaciones no aceptó la petición. Intenta de nuevo en unos minutos.')
      }
      const fila = await repo.agregarPeticion({ id, casoId: caso.id, empresa: req.empresa.id, cedula: p.cedula, proposito: p.proposito.trim(), pedidos })
      res.status(201).json({ id: fila.id, estado: fila.estado })
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande')
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
