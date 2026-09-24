import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'

export const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })

export const token = (cedula = '1012345678', claims = {}) =>
  new SignJWT({ azp: 'portal', preferred_username: `u${cedula}@carpetacolombia.co`, cedula, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('custodia').setIssuedAt().setExpirationTime('5m').sign(privateKey)

// Doble en memoria del repositorio Postgres (src/documentos.js), con el mismo contrato.
export function repositorioEnMemoria() {
  const filas = new Map()
  return {
    filas,
    uso: async (titular) => {
      const v = [...filas.values()].filter((d) => d.titular === titular && d.clase === 'temporal' && d.estado === 'cargado')
      return { documentos: v.length, bytes: v.reduce((a, d) => a + d.tamano, 0) }
    },
    crear: async (d) => { filas.set(d.id, { clase: 'temporal', estado: 'pendiente', sha256: null, autenticacion: null, creado: new Date(), ...d }) },
    buscar: async (id) => filas.get(id) ?? null,
    confirmar: async (id, sha256) => Object.assign(filas.get(id), { estado: 'cargado', sha256 }),
    marcarAutenticado: async (id, respuesta) => Object.assign(filas.get(id), { autenticacion: { fecha: new Date(), respuesta } }),
    descartar: async (id) => { filas.delete(id) },
    listar: async (titular) => [...filas.values()].filter((d) => d.titular === titular && d.estado === 'cargado'),
  }
}

// Almacén falso: guarda lo que el "navegador" subió por la URL prefirmada.
export function almacenFalso() {
  const objetos = new Map()
  const llamadas = { urlCarga: [], urlLectura: [], borrar: [] }
  return {
    objetos, llamadas,
    urlLectura: async (clave) => { llamadas.urlLectura.push(clave); return `https://almacen.test/${clave}?firma=2` },
    urlCarga: async (clave, tipo) => { llamadas.urlCarga.push([clave, tipo]); return `http://almacen.test/${clave}?firma=1` },
    cabecera: async (clave) => objetos.get(clave)?.cabecera ?? null,
    sha256: async (clave) => objetos.get(clave)?.sha256 ?? 'sin-objeto',
    borrar: async (clave) => { llamadas.borrar.push(clave); objetos.delete(clave) },
    subir: (clave, tamano, tipo, sha256 = 'a'.repeat(64)) => objetos.set(clave, { cabecera: { tamano, tipo }, sha256 }),
  }
}

export function pasarelaFalsa(respuesta = 'Documento autenticado') {
  const enviados = []
  return { enviados, autenticar: async (d) => { enviados.push(d); return { autenticado: true, respuesta } } }
}

export async function conServicio(prueba, { documentos = repositorioEnMemoria(), almacen = almacenFalso(), pasarela = pasarelaFalsa(), ...resto } = {}) {
  const app = crearApp({ documentos, almacen, pasarela, verificar: crearVerificador({ issuer: EMISOR, jwks }), ...resto })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const pedir = async (ruta, { metodo = 'GET', cuerpo, cedula, cabeceras } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${await token(cedula)}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...cabeceras },
      body: cuerpo && (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba({ pedir, documentos, almacen, pasarela, base }) } finally { srv.close() }
}

export const nuevoId = randomUUID
