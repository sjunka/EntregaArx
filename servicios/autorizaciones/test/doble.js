import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'

export const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })

const firmar = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience(['custodia', 'autorizaciones']).setIssuedAt().setExpirationTime('5m').sign(privateKey)
export const tokenCiudadano = (cedula = '1012345678') => firmar({ azp: 'portal', cedula })
export const tokenServicio = (azp) => firmar({ azp, sub: azp, typ: 'Bearer' })

// Doble en memoria del repositorio Postgres (src/repo.js), con el mismo contrato y un reloj que la prueba controla.
export function repoEnMemoria(reloj) {
  const peticiones = new Map()
  const autorizaciones = []
  const vigente = (a) => !a.revocadaEn && a.venceEn > reloj.ahora
  return {
    peticiones, autorizaciones,
    async crearPeticion(p) {
      const previa = [...peticiones.values()].find((x) => x.entidad === p.entidad && x.idExterno === p.idExterno)
      if (previa) return { peticion: previa, existente: true }
      const nueva = { estado: 'pendiente', creado: reloj.ahora, ...p }
      peticiones.set(p.id, nueva)
      return { peticion: nueva, existente: false }
    },
    peticion: async (id) => peticiones.get(id) ?? null,
    peticionesDe: async (cedula) => [...peticiones.values()].filter((p) => p.cedula === cedula).sort((a, b) => b.creado - a.creado),
    // Atiende una petición pendiente del titular y concede una autorización por documento; null si no aplica.
    async atender(id, cedula, documentos, venceEn) {
      const p = peticiones.get(id)
      if (p?.cedula !== cedula || p.estado !== 'pendiente') return null
      p.estado = 'atendida'
      return this.conceder({ cedula, tercero: `entidad:${p.entidad}`, documentos, venceEn, peticionId: id })
    },
    async rechazar(id, cedula) {
      const p = peticiones.get(id)
      if (p?.cedula !== cedula || p.estado !== 'pendiente') return null
      return Object.assign(p, { estado: 'rechazada' })
    },
    async conceder({ cedula, tercero, documentos, venceEn, peticionId = null }) {
      const filas = documentos.map((documentoId) => ({ id: randomUUID(), cedula, tercero, documentoId, peticionId, concedidaEn: reloj.ahora, venceEn, revocadaEn: null }))
      autorizaciones.push(...filas)
      return filas
    },
    vigentesDe: async (cedula) => autorizaciones.filter((a) => a.cedula === cedula && vigente(a)),
    deLaPeticion: async (peticionId) => autorizaciones.filter((a) => a.peticionId === peticionId),
    vigentesDeLaPeticion: async (peticionId) => autorizaciones.filter((a) => a.peticionId === peticionId && vigente(a)),
    async revocar(id, cedula) {
      const a = autorizaciones.find((x) => x.id === id && x.cedula === cedula)
      if (!a) return null
      a.revocadaEn ??= reloj.ahora
      return a
    },
    decidir: async ({ cedula, documentoId, tercero }) =>
      autorizaciones.find((a) => a.cedula === cedula && a.documentoId === documentoId && a.tercero === tercero && vigente(a)) ?? null,
  }
}

export async function conServicio(prueba, { horas = 72 } = {}) {
  const reloj = { ahora: new Date('2026-09-24T10:00:00Z') }
  const repo = repoEnMemoria(reloj)
  const app = crearApp({ repo, verificar: crearVerificador({ issuer: EMISOR, jwks }), ahora: () => reloj.ahora, horas })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const pedir = async (ruta, { metodo = 'GET', cuerpo, cedula, servicio, sinToken } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(!sinToken && { authorization: `Bearer ${servicio ? await tokenServicio(servicio) : await tokenCiudadano(cedula)}` }), ...(cuerpo && { 'content-type': 'application/json' }) },
      body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: r.status === 204 ? null : await r.json().catch(() => null) }
  }
  try { await prueba({ pedir, repo, reloj }) } finally { srv.close() }
}

export const nuevoId = randomUUID
