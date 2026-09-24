import express from 'express'
import { randomUUID } from 'node:crypto'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = (v) => typeof v === 'string' && UUID.test(v)
const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
export const MAX_PEDIDOS = 10

const aAutorizacion = (a) => ({
  id: a.id, peticionId: a.peticionId ?? undefined, tercero: a.tercero, documentoId: a.documentoId,
  concedidaEn: new Date(a.concedidaEn).toISOString(), venceEn: new Date(a.venceEn).toISOString(),
})
const aPeticion = (p, autorizaciones) => ({
  id: p.id, entidad: p.entidad, proposito: p.proposito, pedidos: p.pedidos, estado: p.estado, creado: new Date(p.creado).toISOString(),
  autorizaciones: autorizaciones.map((a) => ({ id: a.id, documentoId: a.documentoId, venceEn: new Date(a.venceEn).toISOString(), revocada: !!a.revocadaEn })),
})

export function validarPeticion(p = {}) {
  if (!texto(p.entidad, 80) || !texto(p.idExterno, 120)) return 'Faltan la entidad o el identificador de la petición.'
  if (!/^[0-9]{6,10}$/.test(p.cedula ?? '')) return 'La cédula del titular no es válida.'
  if (!texto(p.proposito, 200)) return 'Falta el propósito de la petición (hasta 200 caracteres).'
  if (!Array.isArray(p.pedidos) || !p.pedidos.length || p.pedidos.length > MAX_PEDIDOS) return `La petición debe pedir entre 1 y ${MAX_PEDIDOS} documentos.`
  if (!p.pedidos.every((d) => texto(d?.titulo, 120))) return 'Cada documento pedido necesita un título (hasta 120 caracteres).'
  return null
}

// MS-06 decide si un documento puede salir hacia un tercero (RI-08). No guarda documentos ni sus títulos (RD-11):
// solo el consentimiento del titular. dependencias: repo (src/repo.js), verificar(token) → claims, ahora (reloj), horas (vigencia).
export function crearApp({ repo, verificar, origenes = [], ahora = () => new Date(), horas = 72 }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  app.use(express.json({ limit: '8kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    try {
      req.claims = await verificar(token)
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // Servicio a servicio (client credentials): la interoperabilidad crea peticiones y la custodia pide la decisión.
  const interno = express.Router()
  const solo = (azp) => (req, res, next) => (req.claims.azp === azp ? next() : problema(res, 403, 'Solo para servicios del operador'))
  const venceEn = () => new Date(ahora().getTime() + horas * 3_600_000)

  interno.post('/peticiones', solo('interoperabilidad'), async (req, res, next) => {
    const invalido = validarPeticion(req.body)
    if (invalido) return problema(res, 422, 'Petición inválida', invalido)
    try {
      const p = req.body
      const { peticion, existente } = await repo.crearPeticion({
        id: randomUUID(), entidad: p.entidad, idExterno: p.idExterno, cedula: p.cedula, proposito: p.proposito.trim(),
        pedidos: p.pedidos.map((d) => ({ titulo: d.titulo.trim() })),
      })
      res.status(existente ? 200 : 201).json({ id: peticion.id, estado: peticion.estado })
    } catch (e) { next(e) }
  })

  // La entidad solo ve el estado y lo autorizado que sigue vigente; nada más de la carpeta.
  interno.get('/peticiones/:id', solo('interoperabilidad'), async (req, res, next) => {
    try {
      const p = esUuid(req.params.id) ? await repo.peticion(req.params.id) : null
      if (!p || p.entidad !== req.query.entidad) return problema(res, 404, 'Petición no encontrada')
      const vigentes = p.estado === 'atendida' ? await repo.vigentesDeLaPeticion(p.id) : []
      res.json({ id: p.id, estado: p.estado, autorizaciones: vigentes.map((a) => ({ id: a.id, documentoId: a.documentoId, venceEn: new Date(a.venceEn).toISOString() })) })
    } catch (e) { next(e) }
  })

  interno.post('/decisiones', solo('custodia'), async (req, res, next) => {
    const { cedula, documentoId, tercero } = req.body ?? {}
    if (!/^[0-9]{6,10}$/.test(cedula ?? '') || !esUuid(documentoId) || !texto(tercero, 254)) {
      return problema(res, 422, 'Decisión inválida', 'Se exigen cédula del titular, documento y tercero.')
    }
    try {
      const a = await repo.decidir({ cedula, documentoId, tercero })
      res.json(a ? { permitida: true, autorizacionId: a.id, venceEn: new Date(a.venceEn).toISOString() } : { permitida: false })
    } catch (e) { next(e) }
  })
  app.use('/interno', interno)

  // Ciudadano con sesión del portal.
  app.use((req, res, next) => {
    if (req.claims.azp !== 'portal' || !req.claims.cedula) return problema(res, 401, 'Token no válido para autorizaciones')
    req.cedula = req.claims.cedula
    next()
  })

  app.get('/peticiones', async (req, res, next) => {
    try {
      const lista = await repo.peticionesDe(req.cedula)
      res.json(await Promise.all(lista.map(async (p) => aPeticion(p, await repo.deLaPeticion(p.id)))))
    } catch (e) { next(e) }
  })

  // RF-04.4: el ciudadano marca documento por documento; nada sale sin esa decisión explícita.
  app.post('/autorizaciones', async (req, res, next) => {
    const { peticionId, documentos } = req.body ?? {}
    if (!esUuid(peticionId) || !Array.isArray(documentos) || !documentos.length || !documentos.every(esUuid) || new Set(documentos).size !== documentos.length) {
      return problema(res, 422, 'Autorización inválida', 'Indica la petición y al menos un documento, sin repetirlo.')
    }
    try {
      const p = await repo.peticion(peticionId)
      if (p?.cedula !== req.cedula) return problema(res, 404, 'Petición no encontrada')
      if (p.estado !== 'pendiente') return problema(res, 409, 'La petición ya se respondió', 'Esta petición ya fue autorizada o rechazada.')
      if (documentos.length > p.pedidos.length) return problema(res, 422, 'Autorización inválida', `La entidad pidió ${p.pedidos.length} documento(s); no puedes autorizar más.`)
      const filas = await repo.atender(peticionId, req.cedula, documentos, venceEn())
      if (!filas) return problema(res, 409, 'La petición ya se respondió', 'Esta petición ya fue autorizada o rechazada.')
      res.status(201).json({ autorizaciones: filas.map(aAutorizacion) })
    } catch (e) { next(e) }
  })

  // RF-04.4: rechazar la petición completa; la entidad recibe el rechazo sin detalle de la carpeta.
  app.post('/peticiones/:id/rechazo', async (req, res, next) => {
    try {
      const p = esUuid(req.params.id) ? await repo.peticion(req.params.id) : null
      if (p?.cedula !== req.cedula) return problema(res, 404, 'Petición no encontrada')
      const r = await repo.rechazar(p.id, req.cedula)
      if (!r) return problema(res, 409, 'La petición ya se respondió', 'Esta petición ya fue autorizada o rechazada.')
      res.json(aPeticion(r, []))
    } catch (e) { next(e) }
  })

  app.get('/autorizaciones', async (req, res, next) => {
    try { res.json((await repo.vigentesDe(req.cedula)).map(aAutorizacion)) } catch (e) { next(e) }
  })

  // RF-04.5: revocar surte efecto de inmediato, porque la custodia pregunta aquí antes de firmar cada lectura.
  app.delete('/autorizaciones/:id', async (req, res, next) => {
    try {
      const a = esUuid(req.params.id) ? await repo.revocar(req.params.id, req.cedula) : null
      a ? res.sendStatus(204) : problema(res, 404, 'Autorización no encontrada')
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
