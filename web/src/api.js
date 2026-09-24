import { sesion } from './sesion.js'

export const AFILIACION = import.meta.env.VITE_MCS_AFILIACION || 'http://localhost:8082'
const CUSTODIA = import.meta.env.VITE_MCS_CUSTODIA || 'http://localhost:8083'
const NOTIFICACIONES = import.meta.env.VITE_MCS_NOTIFICACIONES || 'http://localhost:8087'
const INDICE = import.meta.env.VITE_MCS_INDICE || 'http://localhost:8091'
const AUTORIZACIONES = import.meta.env.VITE_MCS_AUTORIZACIONES || 'http://localhost:8093'

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

// Llamadas a la custodia (o a notificaciones) con el token de la sesión; un 401 (token vencido o inválido) cierra la sesión local.
async function conSesion(ruta, opciones = {}, base = CUSTODIA) {
  const usuario = await sesion.getUser()
  if (!usuario || usuario.expired) throw new ErrorServicio(401, 'Sesión vencida', 'Tu sesión venció. Ingresa de nuevo.')
  try {
    return await pedir(`${base}${ruta}`, { ...opciones, headers: { authorization: `Bearer ${usuario.access_token}`, ...(opciones.body && { 'content-type': 'application/json' }), ...opciones.headers } })
  } catch (e) {
    if (e.status === 401) await sesion.removeUser()
    throw e
  }
}

// La lista sale del índice de carpeta (MS-05, RNF-04); la custodia (MS-04) solo guarda, entrega y cuenta la cuota.
export const buscar = ({ q, clase, desde, hasta } = {}) =>
  conSesion(`/carpeta?${new URLSearchParams(Object.entries({ q, clase, desde, hasta }).filter(([, v]) => v))}`, {}, INDICE)
// RF-02.7: URL prefirmada de corta vida; la custodia registra el acceso al entregarla.
export const descargar = (id) => conSesion(`/documentos/${id}/descarga`)
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

// Peticiones de terceros y autorización documento a documento (MS-06, HU-07).
export const peticiones = () => conSesion('/peticiones', {}, AUTORIZACIONES)
export const autorizar = (peticionId, documentos) =>
  conSesion('/autorizaciones', { method: 'POST', body: JSON.stringify({ peticionId, documentos }) }, AUTORIZACIONES)
export const rechazar = (id) => conSesion(`/peticiones/${id}/rechazo`, { method: 'POST', body: '{}' }, AUTORIZACIONES)
export const revocar = (id) => conSesion(`/autorizaciones/${id}`, { method: 'DELETE' }, AUTORIZACIONES)

export const preferencias = () => conSesion('/preferencias', {}, NOTIFICACIONES)
export const guardarPreferencias = (canales) =>
  conSesion('/preferencias', { method: 'PUT', body: JSON.stringify({ canales }) }, NOTIFICACIONES)
export const avisos = () => conSesion('/notificaciones', {}, NOTIFICACIONES)
