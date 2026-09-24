import express from 'express'
import { armarTablero } from './tablero.js'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

// dependencias: verificar(token) → claims (audiencia analitica), repo (celdas, anios, corte), umbral de anonimato.
export function crearApp({ verificar, repo, umbral = 10, origenes = [] }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    let c
    try { c = await verificar(token) } catch { return problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.') }
    if (c.azp !== 'portal' || c.analista !== true) return problema(res, 403, 'Solo para analistas del Estado', 'Esta consulta requiere el rol de analista.')
    next()
  })

  app.get('/tableros/diplomas', async (req, res, next) => {
    const { anio, region } = req.query
    if (![anio, region].every((v) => v === undefined || typeof v === 'string')) return problema(res, 422, 'Filtro no válido', 'Cada filtro se envía una sola vez.')
    if (anio !== undefined && !(/^\d{4}$/.test(anio) && anio >= 2000 && anio <= 2100)) return problema(res, 422, 'Filtro no válido', 'El año va con cuatro dígitos, entre 2000 y 2100.')
    if (region !== undefined && region.length > 80) return problema(res, 422, 'Filtro no válido', 'La región admite hasta 80 caracteres.')
    try {
      const filtros = { ...(anio && { anio: Number(anio) }), ...(region && { region }) }
      const [celdas, anios, corte] = await Promise.all([repo.celdas(filtros), repo.anios(), repo.corte()])
      res.json(armarTablero({ celdas, anios, corte, umbral }))
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
