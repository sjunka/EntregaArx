import express from 'express'
import { EscrituraDeshabilitada, Indisponible, Rechazo } from './govcarpeta.js'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const CEDULA = /^[0-9]{6,10}$/

// RI-01 y RNF-21: la pasarela transporta datos de afiliación y URL, nunca el documento.
export function crearApp({ cliente, operador }) {
  const app = express()
  app.use(express.json({ limit: '2kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.get('/centralizador/ciudadanos/:id', async (req, res, next) => {
    if (!CEDULA.test(req.params.id)) return problema(res, 400, 'Identificación inválida')
    try { res.json(await cliente.consultar(req.params.id)) } catch (e) { next(e) }
  })

  app.post('/centralizador/ciudadanos', async (req, res, next) => {
    const { id, nombre, direccion, correo } = req.body ?? {}
    if (!CEDULA.test(id ?? '') || !nombre || !direccion || !correo) return problema(res, 400, 'Datos incompletos')
    try {
      await cliente.registrar({
        id: Number(id), name: nombre, address: direccion, email: correo,
        operatorId: operador.id, operatorName: operador.nombre,
      })
      res.status(201).json({ registrado: true })
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande', 'La pasarela no acepta contenido documental')
    if (err instanceof Indisponible || err instanceof EscrituraDeshabilitada) return problema(res, 503, 'Centralizador no disponible', err.message)
    if (err instanceof Rechazo) return problema(res, 502, 'El centralizador rechazó la operación', err.message)
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
