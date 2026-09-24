import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearVerificador } from '../src/auth.js'
import { crearApp } from '../src/app.js'

const EMISOR = 'http://localhost:8081/realms/carpeta'
const CEDULA = '1012345678'

const par = async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  return { privateKey, jwks: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] }) }
}
const llave = await par()
const otra = await par()

const firmar = ({ privateKey = llave.privateKey, iss = EMISOR, aud = 'custodia', exp = '5m', claims = {} } = {}) =>
  new SignJWT({ azp: 'portal', preferred_username: 'a@carpetacolombia.co', cedula: CEDULA, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey)

const FILAS = [{ id: '11111111-1111-1111-1111-111111111111', titulo: 'Diploma', clase: 'temporal', estado: 'cargado', tipo: 'application/pdf', tamano: 10, creado: new Date('2026-01-01') }]

async function pedir(cabeceras) {
  const consultas = []
  const app = crearApp({
    documentos: { listar: async (titular) => { consultas.push([titular]); return FILAS } },
    verificar: crearVerificador({ issuer: EMISOR, jwks: llave.jwks }),
  })
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/documentos`, { headers: cabeceras })
    return { r, consultas }
  } finally { srv.close() }
}

test('token válido: lista solo los documentos de su titular', async () => {
  const { r, consultas } = await pedir({ authorization: `Bearer ${await firmar()}` })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).length, 1)
  assert.deepEqual(consultas, [[CEDULA]])
})

for (const [nombre, cabeceras] of [
  ['sin token', async () => ({})],
  ['firma de otra llave', async () => ({ authorization: `Bearer ${await firmar({ privateKey: otra.privateKey })}` })],
  ['otro emisor', async () => ({ authorization: `Bearer ${await firmar({ iss: 'https://atacante.example/realms/carpeta' })}` })],
  ['otra audiencia', async () => ({ authorization: `Bearer ${await firmar({ aud: 'portal' })}` })],
  ['vencido', async () => ({ authorization: `Bearer ${await firmar({ exp: Math.floor(Date.now() / 1000) - 60 })}` })],
  ['otro cliente (azp)', async () => ({ authorization: `Bearer ${await firmar({ claims: { azp: 'otro' } })}` })],
  ['sin cédula', async () => ({ authorization: `Bearer ${await firmar({ claims: { cedula: undefined } })}` })],
  ['basura', async () => ({ authorization: 'Bearer abc.def.ghi' })],
]) {
  test(`${nombre}: 401 problem+json y no toca la base`, async () => {
    const { r, consultas } = await pedir(await cabeceras())
    assert.equal(r.status, 401)
    assert.match(r.headers.get('content-type'), /application\/problem\+json/)
    assert.equal((await r.json()).status, 401)
    assert.deepEqual(consultas, [])
  })
}
