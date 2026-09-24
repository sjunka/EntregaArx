export const problema = (res, status, title, detail, extra = {}) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail, ...extra })

export const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
