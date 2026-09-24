export const AFILIACION = import.meta.env.VITE_MCS_AFILIACION || 'http://localhost:8082'

export class ErrorServicio extends Error {
  constructor(status, titulo, detalle) {
    super(detalle || titulo)
    this.status = status
    this.titulo = titulo
  }
}

async function pedir(url, opciones = {}) {
  let r
  try {
    r = await fetch(url, opciones)
  } catch {
    throw new ErrorServicio(0, 'Sin conexión', 'No pudimos comunicarnos con el operador. Revisa tu conexión e intenta de nuevo.')
  }
  const cuerpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorServicio(r.status, cuerpo.title ?? 'No se pudo completar', cuerpo.detail)
  return cuerpo
}

export const registrar = (datos) =>
  pedir(`${AFILIACION}/ciudadanos`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos),
  })
