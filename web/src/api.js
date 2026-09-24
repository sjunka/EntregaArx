import { sesion } from './sesion.js'

export const AFILIACION = import.meta.env.VITE_MCS_AFILIACION || 'http://localhost:8082'
const CUSTODIA = import.meta.env.VITE_MCS_CUSTODIA || 'http://localhost:8083'

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

// Llamadas a la custodia con el token de la sesión; un 401 (token vencido o inválido) cierra la sesión local.
async function conSesion(ruta, opciones = {}) {
  const usuario = await sesion.getUser()
  if (!usuario || usuario.expired) throw new ErrorServicio(401, 'Sesión vencida', 'Tu sesión venció. Ingresa de nuevo.')
  try {
    return await pedir(`${CUSTODIA}${ruta}`, { ...opciones, headers: { authorization: `Bearer ${usuario.access_token}`, ...(opciones.body && { 'content-type': 'application/json' }), ...opciones.headers } })
  } catch (e) {
    if (e.status === 401) await sesion.removeUser()
    throw e
  }
}

export const listar = () => conSesion('/documentos')
export const cuota = () => conSesion('/cuota')

// Tres pasos (HU-03): reservar en la custodia, subir el binario directo al almacén con la URL prefirmada
// (RI-06, no pasa por el operador) y confirmar para que la custodia compruebe tamaño, tipo y huella.
export async function subir({ titulo, archivo }, alAvanzar) {
  alAvanzar('reservando')
  const { id, urlCarga } = await conSesion('/documentos', {
    method: 'POST', body: JSON.stringify({ titulo, tipo: archivo.type, tamano: archivo.size }),
  })
  alAvanzar('subiendo')
  const put = await fetch(urlCarga, { method: 'PUT', headers: { 'content-type': archivo.type }, body: archivo }).catch(() => null)
  if (!put?.ok) throw new ErrorServicio(0, 'No se pudo subir el archivo', 'La carga se interrumpió. Intenta de nuevo.')
  alAvanzar('verificando')
  return conSesion(`/documentos/${id}/confirmacion`, { method: 'POST' })
}

export const autenticar = (id) => conSesion(`/documentos/${id}/autenticacion`, { method: 'POST' })
