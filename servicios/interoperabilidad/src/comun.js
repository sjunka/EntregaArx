export const problema = (res, status, title, detail, extra = {}) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail, ...extra })

export const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

// Sesión del ciudadano: firma, emisor, audiencia `interoperabilidad` y `azp: portal` (RNF-11). Deja `req.claims`.
export const sesionCiudadano = (verificar, recurso) => async (req, res, next) => {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
  if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
  try {
    const c = await verificar(token)
    if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, `Token no válido para ${recurso}`)
    req.claims = c
    next()
  } catch {
    problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
  }
}
