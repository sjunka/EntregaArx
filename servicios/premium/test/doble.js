import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { ErrorAutorizaciones } from '../src/autorizaciones.js'

export const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })

export const token = (claims, aud = 'premium') => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
  .setIssuer(EMISOR).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)
export const tokenEmpresa = (empresa = 'tramites-premium') => token({ azp: 'portal', empresa })

const CATALOGO = [
  { id: 'caso-pqrs', nombre: 'Caso PQRS', descripcion: 'Abre un caso', tarifaCop: 5000 },
  { id: 'peticion-documentos', nombre: 'Petición de documentos', descripcion: 'Pide documentos', tarifaCop: 1500 },
]

// Doble en memoria del repositorio Postgres (src/repo.js), con el mismo contrato.
export function repoEnMemoria() {
  const empresas = new Map([['tramites-premium', { id: 'tramites-premium', nombre: 'Trámites Premium', premium: true }], ['otra-premium', { id: 'otra-premium', nombre: 'Otra Premium', premium: true }], ['servicios-basicos', { id: 'servicios-basicos', nombre: 'Servicios Básicos', premium: false }]])
  const casos = []
  const peticiones = []
  const usos = []
  return {
    casos, peticiones, usos,
    empresa: async (id) => empresas.get(id) ?? null,
    catalogo: async () => CATALOGO,
    async abrirCaso({ id, empresa, asunto }) {
      const c = { id, empresa, asunto, estado: 'abierto', creado: new Date('2026-09-24T10:00:00Z') }
      casos.push(c)
      usos.push({ empresa, servicio: 'caso-pqrs', casoId: id })
      return { id, asunto, estado: c.estado, creado: c.creado, peticiones: [] }
    },
    casosDe: async (empresa) => casos.filter((c) => c.empresa === empresa).map((c) => ({ id: c.id, asunto: c.asunto, estado: c.estado, creado: c.creado, peticiones: peticiones.filter((p) => p.casoId === c.id) })),
    caso: async (id, empresa) => casos.find((c) => c.id === id && c.empresa === empresa) ?? null,
    async agregarPeticion(p) {
      const f = { id: p.id, casoId: p.casoId, cedula: p.cedula, proposito: p.proposito, pedidos: p.pedidos, estado: 'pendiente', creado: new Date('2026-09-24T10:00:00Z') }
      peticiones.push(f)
      usos.push({ empresa: p.empresa, servicio: 'peticion-documentos', casoId: p.casoId, peticionId: p.id })
      return f
    },
    actualizarEstado: async (id, estado) => { peticiones.find((p) => p.id === id).estado = estado },
    uso: async (empresa) => CATALOGO.map((s) => {
      const total = usos.filter((u) => u.empresa === empresa && u.servicio === s.id).length
      return { servicio: s.id, nombre: s.nombre, total, tarifaCop: s.tarifaCop, subtotalCop: total * s.tarifaCop }
    }),
  }
}

// Doble de MS-06: guarda las peticiones que recibe y deja que la prueba cambie su estado, como haría el ciudadano.
export function autorizacionesDoble() {
  const recibidas = new Map()
  return {
    recibidas, falla: false,
    async crearPeticion(p) {
      if (this.falla) throw new ErrorAutorizaciones(503, 'caído')
      const id = randomUUID()
      recibidas.set(id, { ...p, estado: 'pendiente' })
      return { id, estado: 'pendiente' }
    },
    async consultarPeticion(id, entidad) {
      const p = recibidas.get(id)
      if (p?.entidad !== entidad) throw new ErrorAutorizaciones(404, 'no encontrada')
      return { id, estado: p.estado, autorizaciones: [] }
    },
  }
}

export async function conServicio(prueba) {
  const repo = repoEnMemoria()
  const autorizaciones = autorizacionesDoble()
  const app = crearApp({ repo, autorizaciones, verificar: crearVerificador({ issuer: EMISOR, jwks }) })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const pedir = async (ruta, { metodo = 'GET', cuerpo, empresa, jwt, sinToken } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(!sinToken && { authorization: `Bearer ${jwt ?? await tokenEmpresa(empresa)}` }), ...(cuerpo && { 'content-type': 'application/json' }) },
      body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba({ pedir, repo, autorizaciones }) } finally { srv.close() }
}
