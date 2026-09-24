import express from 'express'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const CLASES = ['temporal', 'certificado']

// dependencias: verificar(token) → claims (audiencia indice), repo (listar).
export function crearApp({ verificar, repo, origenes = [] }) {
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
    try {
      const c = await verificar(token)
      if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, 'Token no válido para el índice de carpeta')
      req.cedula = c.cedula
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // RF-02.6: búsqueda por título, clase y fecha de la Carpeta del titular del token, nunca de otro.
  app.get('/carpeta', async (req, res, next) => {
    const { q, clase, desde, hasta } = req.query
    const texto = (v) => v === undefined || typeof v === 'string'
    if (![q, clase, desde, hasta].every(texto)) return problema(res, 422, 'Filtro no válido', 'Cada filtro se envía una sola vez.')
    if (q && q.length > 120) return problema(res, 422, 'Filtro no válido', 'El texto a buscar admite hasta 120 caracteres.')
    if (clase && !CLASES.includes(clase)) return problema(res, 422, 'Filtro no válido', `La clase debe ser ${CLASES.join(' o ')}.`)
    for (const f of [desde, hasta]) if (f && (!FECHA.test(f) || Number.isNaN(Date.parse(f)))) return problema(res, 422, 'Filtro no válido', 'Las fechas van como AAAA-MM-DD.')
    if (desde && hasta && desde > hasta) return problema(res, 422, 'Filtro no válido', 'La fecha inicial no puede ser posterior a la final.')
    try {
      res.json(await repo.listar(req.cedula, { q: q?.trim(), clase, desde, hasta }))
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
