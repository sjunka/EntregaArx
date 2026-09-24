import { sesion } from './sesion.js'

export const AFILIACION = import.meta.env.VITE_MCS_AFILIACION || 'http://localhost:8082'
const CUSTODIA = import.meta.env.VITE_MCS_CUSTODIA || 'http://localhost:8083'
const NOTIFICACIONES = import.meta.env.VITE_MCS_NOTIFICACIONES || 'http://localhost:8087'
const INDICE = import.meta.env.VITE_MCS_INDICE || 'http://localhost:8091'
const AUTORIZACIONES = import.meta.env.VITE_MCS_AUTORIZACIONES || 'http://localhost:8093'
const AUDITORIA = import.meta.env.VITE_MCS_AUDITORIA || 'http://localhost:8092'
const ANALITICA = import.meta.env.VITE_MCS_ANALITICA || 'http://localhost:8096'
const PREMIUM = import.meta.env.VITE_MCS_PREMIUM || 'http://localhost:8095'
const INTEROPERABILIDAD = import.meta.env.VITE_MCS_INTEROPERABILIDAD || 'http://localhost:8086'

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

// Envío a una entidad sin operador (MS-07, HU-08). La clave de idempotencia hace seguro repetir la solicitud si la
// respuesta se pierde: el envío, la autorización y el correo no se duplican.
export const enviar = ({ correo, documentos, clave }) =>
  conSesion('/envios', { method: 'POST', headers: { 'idempotency-key': clave }, body: JSON.stringify({ correo, documentos }) }, INTEROPERABILIDAD)
export const envios = () => conSesion('/envios', {}, INTEROPERABILIDAD)

// Traslado de entrada (HU-09). El avance sale de MS-07 con la sesión del ciudadano (404: no tiene un traslado). La activación es
// pública: la credencial es el token del enlace y la clave la fija el ciudadano (MS-03).
export const traslado = () => conSesion('/traslados/actual', {}, INTEROPERABILIDAD).catch((e) => { if (e.status === 404) return null; throw e })
export const activar = ({ token, clave }) =>
  pedir(`${AFILIACION}/traslados/activacion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, clave }) })

// HU-11: bitácora de accesos a la Carpeta (MS-02), con filtros por documento y por rango de días.
export const accesos = (filtros = {}) =>
  conSesion(`/accesos?${new URLSearchParams(Object.entries(filtros).filter(([, v]) => v))}`, {}, AUDITORIA)

// Traslado de salida (MS-07, HU-13): operadores de GovCarpeta, inicio (con confirmación explícita en la pantalla) y avance (404: no hay).
export const operadoresDestino = () => conSesion('/traslados/salida/operadores', {}, INTEROPERABILIDAD)
export const iniciarSalida = (operadorId) =>
  conSesion('/traslados/salida', { method: 'POST', body: JSON.stringify({ operadorId }) }, INTEROPERABILIDAD)
export const salida = () => conSesion('/traslados/salida/actual', {}, INTEROPERABILIDAD).catch((e) => { if (e.status === 404) return null; throw e })

export const preferencias = () => conSesion('/preferencias', {}, NOTIFICACIONES)
export const guardarPreferencias = (canales) =>
  conSesion('/preferencias', { method: 'PUT', body: JSON.stringify({ canales }) }, NOTIFICACIONES)
export const avisos = () => conSesion('/notificaciones', {}, NOTIFICACIONES)

// Consola de la empresa Premium (MS-11, HU-10). La sesión de una empresa lleva el claim `empresa` y solo sirve aquí.
export const perfilEmpresa = () => conSesion('/perfil', {}, PREMIUM)
export const catalogo = () => conSesion('/catalogo', {}, PREMIUM)
export const usoEmpresa = () => conSesion('/uso', {}, PREMIUM)
export const casos = () => conSesion('/casos', {}, PREMIUM)
export const abrirCaso = (asunto) => conSesion('/casos', { method: 'POST', body: JSON.stringify({ asunto }) }, PREMIUM)
export const pedirDocumentos = (casoId, datos) => conSesion(`/casos/${casoId}/peticiones`, { method: 'POST', body: JSON.stringify(datos) }, PREMIUM)

// Tablero del analista del Estado (MS-10, HU-12). La sesión de un analista lleva el claim `analista` y solo sirve aquí.
export const diplomasPorRegion = (filtros = {}) =>
  conSesion(`/tableros/diplomas?${new URLSearchParams(Object.entries(filtros).filter(([, v]) => v))}`, {}, ANALITICA)
