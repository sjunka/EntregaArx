import express from 'express'
import { randomUUID } from 'node:crypto'

export const TIPOS = ['application/pdf', 'image/jpeg', 'image/png']
export const MAX_ARCHIVO = 10 * 1024 * 1024
export const CUOTA = { documentos: 20, bytes: 200 * 1024 * 1024 } // RNF-24

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const aDocumento = (d) => ({
  id: d.id, titulo: d.titulo, clase: d.clase, estado: d.estado, tipo: d.tipo, tamano: d.tamano, sha256: d.sha256 ?? undefined, creado: d.creado,
})

const mb = (b) => Math.floor(b / 1048576)

export function validarSolicitud({ titulo, tipo, tamano } = {}) {
  if (typeof titulo !== 'string' || !titulo.trim()) return [422, 'Falta el título', 'Escribe un nombre para el documento.']
  if (titulo.length > 120) return [422, 'Título demasiado largo', 'El título admite hasta 120 caracteres.']
  if (!TIPOS.includes(tipo)) return [415, 'Formato no permitido', 'Solo aceptamos PDF, JPG o PNG.']
  if (!Number.isInteger(tamano) || tamano <= 0) return [422, 'Tamaño inválido', 'El archivo está vacío o su tamaño no es válido.']
  if (tamano > MAX_ARCHIVO) return [413, 'Archivo demasiado grande', 'El archivo pesa más de 10 MB. Reduce su tamaño e intenta de nuevo.']
  return null
}

// dependencias: documentos (repositorio, src/documentos.js), verificar(token) → claims,
// almacen (urlCarga, cabecera, sha256, borrar).
export function crearApp({ documentos, verificar, almacen, origenes = [] }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  // RI-06: el binario nunca llega aquí, solo metadatos.
  app.use(express.json({ limit: '2kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    try {
      const c = await verificar(token)
      if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, 'Token no válido para custodia')
      req.titular = { cedula: c.cedula, cuenta: c.preferred_username }
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // Documento del titular o 403: ajeno e inexistente responden igual para no revelar qué hay en otras carpetas.
  async function propio(req, res) {
    const d = /^[0-9a-f-]{36}$/.test(req.params.id) ? await documentos.buscar(req.params.id) : null
    if (d?.titular === req.titular.cedula) return d
    problema(res, 403, 'Sin acceso al documento', 'Este documento no está en tu carpeta.')
    return null
  }

  app.get('/documentos', async (req, res, next) => {
    try { res.json((await documentos.listar(req.titular.cedula)).map(aDocumento)) } catch (e) { next(e) }
  })

  app.get('/cuota', async (req, res, next) => {
    try {
      const u = await documentos.uso(req.titular.cedula)
      res.json({ documentos: { usados: u.documentos, maximo: CUOTA.documentos }, bytes: { usados: u.bytes, maximo: CUOTA.bytes } })
    } catch (e) { next(e) }
  })

  app.post('/documentos', async (req, res, next) => {
    const invalido = validarSolicitud(req.body)
    if (invalido) return problema(res, ...invalido)
    try {
      const u = await documentos.uso(req.titular.cedula)
      if (u.documentos >= CUOTA.documentos) {
        return problema(res, 422, 'Carpeta llena', `Tu carpeta admite ${CUOTA.documentos} documentos temporales y ya tienes ${u.documentos}. Elimina alguno para subir otro.`)
      }
      if (u.bytes + req.body.tamano > CUOTA.bytes) {
        return problema(res, 422, 'Carpeta llena', `Tu carpeta admite ${mb(CUOTA.bytes)} MB y te quedan ${mb(CUOTA.bytes - u.bytes)} MB, menos de lo que pesa este archivo.`)
      }
      const id = randomUUID()
      await documentos.crear({ id, titular: req.titular.cedula, titulo: req.body.titulo.trim(), tipo: req.body.tipo, tamano: req.body.tamano })
      res.status(201).json({ id, urlCarga: await almacen.urlCarga(`${req.titular.cedula}/${id}`, req.body.tipo) })
    } catch (e) { next(e) }
  })

  app.post('/documentos/:id/confirmacion', async (req, res, next) => {
    try {
      const d = await propio(req, res)
      if (!d) return
      if (d.estado !== 'pendiente') return res.json(aDocumento(d))
      const clave = `${d.titular}/${d.id}`
      const cab = await almacen.cabecera(clave)
      if (!cab || cab.tamano !== d.tamano || cab.tipo !== d.tipo) {
        if (cab) await almacen.borrar(clave)
        await documentos.descartar(d.id)
        return problema(res, 422, 'El archivo no llegó completo', cab
          ? 'El tamaño o el tipo del archivo subido no coinciden con lo declarado. Vuelve a subirlo.'
          : 'No recibimos el archivo. Vuelve a subirlo.')
      }
      res.json(aDocumento(await documentos.confirmar(d.id, await almacen.sha256(clave))))
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande', 'La custodia solo recibe metadatos: el archivo se sube directo al almacén con la URL prefirmada.')
    log('error', err.message)
    problema(res, 500, 'Error interno')
  })
  return app
}
