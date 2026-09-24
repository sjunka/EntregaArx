import express from 'express'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

// dependencias: verificar(token) → claims (audiencia auditoria), repo (listar).
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
      if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, 'Token no válido para auditoría')
      req.cedula = c.cedula
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // La bitácora solo se lee: quien la consulta ve únicamente los accesos a su propia Carpeta.
  app.get('/accesos', async (req, res, next) => {
    try { res.json(await repo.listar(req.cedula)) } catch (e) { next(e) }
  })

  // Solo-append (RNF-14): ninguna ruta cambia ni borra un registro.
  app.all('/accesos{/*resto}', (_req, res) => res.set('allow', 'GET').status(405)
    .type('application/problem+json').json({ type: 'about:blank', title: 'La bitácora es inalterable', status: 405, detail: 'Los registros de acceso solo se consultan: no se pueden modificar ni borrar.' }))

  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
