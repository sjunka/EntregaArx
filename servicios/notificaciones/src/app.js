import express from 'express'
import { CANALES } from './notificador.js'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

export const enmascarar = {
  correo: (c = '') => c.replace(/^(.{1,2})[^@]*@/, '$1***@'),
  telefono: (t = '') => (t.length >= 7 ? `${t.slice(0, 3)}***${t.slice(-4)}` : ''),
}

const aPreferencias = (c) => ({ canales: c.canales, correo: enmascarar.correo(c.correo), telefono: enmascarar.telefono(c.telefono) })

// ADR-0016: MS-09 no tiene API síncrona de negocio; estas rutas solo sirven a la SPA para elegir canal y ver los avisos.
// dependencias: verificar(token) → claims (audiencia notificaciones), contactos (obtener, guardarCanales), historial (ultimos).
export function crearApp({ verificar, contactos, historial, origenes = [] }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  app.use(express.json({ limit: '1kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    try {
      const c = await verificar(token)
      if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, 'Token no válido para notificaciones')
      req.cedula = c.cedula
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  const sinContacto = (res) => problema(res, 404, 'Sin datos de contacto', 'Todavía no tenemos tus datos de contacto para avisarte.')

  app.get('/preferencias', async (req, res, next) => {
    try {
      const c = await contactos.obtener(req.cedula)
      c ? res.json(aPreferencias(c)) : sinContacto(res)
    } catch (e) { next(e) }
  })

  app.put('/preferencias', async (req, res, next) => {
    const canales = req.body?.canales
    if (!Array.isArray(canales) || !canales.length || new Set(canales).size !== canales.length || !canales.every((c) => CANALES.includes(c))) {
      return problema(res, 422, 'Canales no válidos', `Elige al menos un canal entre: ${CANALES.join(', ')}.`)
    }
    try {
      const c = await contactos.guardarCanales(req.cedula, canales)
      c ? res.json(aPreferencias(c)) : sinContacto(res)
    } catch (e) { next(e) }
  })

  app.get('/notificaciones', async (req, res, next) => {
    try {
      res.json((await historial.ultimos(req.cedula)).map((h) => ({ canal: h.canal, estado: h.estado, asunto: h.asunto, detalle: h.detalle, creado: h.creado })))
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
