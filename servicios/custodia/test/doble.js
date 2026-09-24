import { createHash, randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { normalizarTitulo } from '../src/documentos.js'
import { ErrorOrigen } from '../src/traslado.js'

export const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })

export const token = (cedula = '1012345678', claims = {}) =>
  new SignJWT({ azp: 'portal', preferred_username: `u${cedula}@carpetacolombia.co`, cedula, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('custodia').setIssuedAt().setExpirationTime('5m').sign(privateKey)

export const tokenServicio = (azp = 'interoperabilidad') =>
  new SignJWT({ azp, typ: 'Bearer' }).setSubject(azp)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('custodia').setIssuedAt().setExpirationTime('5m').sign(privateKey)

// Doble en memoria del repositorio Postgres (src/documentos.js), con el mismo contrato.
export function repositorioEnMemoria() {
  const filas = new Map()
  const transiciones = []
  const eventos = [] // lo que el repositorio Postgres deja en la bandeja de salida, en la misma transacción que el hecho
  const evento = (nombre, datos) => eventos.push({ nombre, datos })
  const cambiar = (id, cambios) => { if (cambios.estado) transiciones.push([id, cambios.estado]); return Object.assign(filas.get(id), cambios) }
  const visible = (d) => (d.clase === 'temporal' ? ['cargado', 'sustituido'] : ['vigente']).includes(d.estado)
  const repo = {
    filas, transiciones, eventos,
    uso: async (titular) => {
      const v = [...filas.values()].filter((d) => d.titular === titular && d.clase === 'temporal' && d.estado === 'cargado' && !d.origen)
      return { documentos: v.length, bytes: v.reduce((a, d) => a + d.tamano, 0) }
    },
    crear: async (d) => { filas.set(d.id, { clase: 'temporal', estado: 'pendiente', sha256: null, autenticacion: null, creado: new Date(), ...d }) },
    buscar: async (id) => filas.get(id) ?? null,
    confirmar: async (id, sha256) => {
      const d = cambiar(id, { estado: 'cargado', sha256 })
      evento('documento.cargado', { id, cedula: d.titular, clase: 'temporal', titulo: d.titulo, tipo: d.tipo, tamano: d.tamano })
      return d
    },
    marcarAutenticado: async (id, respuesta) => {
      const d = Object.assign(filas.get(id), { autenticacion: { fecha: new Date(), respuesta } })
      evento('documento.autenticado', { id, cedula: d.titular })
      return d
    },
    registrarAcceso: async (d, acceso) => { evento('acceso.registrado', { documentoId: d.id, cedula: d.titular, titulo: d.titulo, ...acceso }) },
    descartar: async (id) => { filas.delete(id) },
    eliminar: async (id) => {
      const d = cambiar(id, { estado: 'eliminado' })
      evento('documento.eliminado', { id, cedula: d.titular })
      return d
    },
    listar: async (titular) => [...filas.values()].filter((d) => d.titular === titular && visible(d)),
    // Traslado de salida (HU-13): la Carpeta se congela (solo lectura) mientras el destino confirma y se borra al cerrar.
    congeladas: new Set(),
    congelar: async (titular) => { repo.congeladas.add(titular) },
    reabrir: async (titular) => { repo.congeladas.delete(titular) },
    congelada: async (titular) => repo.congeladas.has(titular),
    borrarCarpeta: async (titular) => {
      const borrados = [...filas.values()].filter((d) => d.titular === titular)
      for (const d of borrados) filas.delete(d.id)
      repo.congeladas.delete(titular)
      return borrados
    },
    // Traslado de entrada (HU-09): conserva la clase, no consume cuota y es idempotente por (origen, idOrigen).
    buscarPorOrigen: async (origen, idOrigen) => [...filas.values()].find((d) => d.origen === origen && d.idOrigen === idOrigen) ?? null,
    crearTrasladado: async (d) => {
      const fila = { autenticacion: null, creado: new Date(), estado: d.clase === 'certificado' ? 'vigente' : 'cargado', ...d }
      filas.set(d.id, fila)
      evento('documento.cargado', { id: d.id, cedula: d.titular, clase: d.clase, titulo: d.titulo, tipo: d.tipo, tamano: d.tamano, ...(d.clase === 'certificado' && { emisor: d.emisor }) })
      return fila
    },
    descartarTraslado: async (titular, origen) => {
      const borrados = [...filas.values()].filter((d) => d.titular === titular && d.origen === origen)
      for (const d of borrados) { filas.delete(d.id); evento('documento.eliminado', { id: d.id, cedula: titular }) }
      return borrados
    },
    // Certificados (HU-05). Idempotente por (emisor, idExterno).
    crearCertificado: async (d) => {
      const previo = [...filas.values()].find((f) => f.emisor === d.emisor && f.idExterno === d.idExterno)
      if (previo) return { documento: previo, existente: true }
      filas.set(d.id, { clase: 'certificado', autenticacion: null, creado: new Date(), ...d })
      transiciones.push([d.id, d.estado])
      return { documento: filas.get(d.id), existente: false }
    },
    marcarVerificado: async (id) => cambiar(id, { estado: 'verificado' }),
    rechazar: async (id, motivo) => cambiar(id, { estado: 'rechazado', motivo }),
    // Vigente y, en la misma operación, el Temporal equivalente más antiguo pasa a Sustituido.
    activarCertificado: async (id) => {
      const c = filas.get(id)
      const eq = [...filas.values()].filter((d) => d.titular === c.titular && d.clase === 'temporal' && d.estado === 'cargado' && normalizarTitulo(d.titulo) === normalizarTitulo(c.titulo))
        .sort((x, y) => x.creado - y.creado)[0]
      if (eq) cambiar(eq.id, { estado: 'sustituido', sustituidoPor: id })
      return { documento: cambiar(id, { estado: 'vigente' }), sustituyeA: eq?.id }
    },
  }
  return repo
}

// Almacén falso: guarda lo que el "navegador" subió por la URL prefirmada.
export function almacenFalso(nombre = 'temporales') {
  const objetos = new Map()
  const llamadas = { urlCarga: [], urlLectura: [], borrar: [] }
  const almacen = {
    objetos, llamadas, caido: false,
    urlLectura: async (clave, opciones) => { llamadas.urlLectura.push(opciones ? [clave, opciones] : clave); return `https://almacen.test/${clave}?firma=2` },
    urlCarga: async (clave, tipo) => { llamadas.urlCarga.push([clave, tipo]); return `http://almacen.test/${nombre}/${clave}?firma=1` },
    cabecera: async (clave) => {
      if (almacen.caido) throw new Error('el almacén no responde')
      return objetos.get(clave)?.cabecera ?? null
    },
    sha256: async (clave) => objetos.get(clave)?.sha256 ?? 'sin-objeto',
    borrar: async (clave) => { llamadas.borrar.push(clave); objetos.delete(clave) },
    subir: (clave, tamano, tipo, sha256 = 'a'.repeat(64)) => objetos.set(clave, { cabecera: { tamano, tipo }, sha256 }),
    guardar: async (clave, bytes, tipo) => {
      if (almacen.noGuarda) throw new Error('el almacén no responde')
      objetos.set(clave, { cabecera: { tamano: bytes.length, tipo }, sha256: createHash('sha256').update(bytes).digest('hex'), bytes })
    },
  }
  return almacen
}

export function pasarelaFalsa(respuesta = 'Documento autenticado') {
  const enviados = []
  return { enviados, autenticar: async (d) => { enviados.push(d); return { autenticado: true, respuesta } } }
}

// MS-06 falso: `permitir(cedula, documentoId, tercero)` concede; `caido` simula que no responde.
export function autorizacionesFalsas() {
  const permitidas = new Set()
  const a = {
    consultas: [], caido: false,
    permitir: (cedula, documentoId, tercero) => permitidas.add(`${cedula}|${documentoId}|${tercero}`),
    decidir: async (d) => {
      a.consultas.push(d)
      if (a.caido) throw new Error('autorizaciones no responde')
      return { permitida: permitidas.has(`${d.cedula}|${d.documentoId}|${d.tercero}`) }
    },
  }
  return a
}

// Descargador falso: las URL del operador de origen devuelven lo que la prueba dejó en `paginas` (Buffer) o lanzan el error indicado.
export function descargadorFalso() {
  const d = { paginas: new Map(), llamadas: [], descargar: async (url) => {
    d.llamadas.push(url)
    const r = d.paginas.get(url)
    if (r instanceof ErrorOrigen) throw r
    if (r instanceof Error) throw new ErrorOrigen(r.message)
    if (!r) throw new ErrorOrigen('el origen respondió 404')
    return r
  } }
  return d
}

export async function conServicio(prueba, { documentos = repositorioEnMemoria(), almacen = almacenFalso(), almacenCertificados = almacenFalso('certificados'), pasarela = pasarelaFalsa(), autorizaciones = autorizacionesFalsas(), descargador = descargadorFalso(), ...resto } = {}) {
  const app = crearApp({ documentos, almacen, almacenCertificados, pasarela, autorizaciones, descargar: descargador.descargar, verificar: crearVerificador({ issuer: EMISOR, jwks }), ...resto })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const pedir = async (ruta, { metodo = 'GET', cuerpo, cedula, cabeceras, servicio } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${servicio ? await tokenServicio(servicio === true ? undefined : servicio) : await token(cedula)}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...cabeceras },
      body: cuerpo && (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba({ pedir, documentos, almacen, almacenCertificados, pasarela, autorizaciones, descargador, base }) } finally { srv.close() }
}

export const nuevoId = randomUUID
