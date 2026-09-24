import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'

// HU-06 · GET /carpeta (MS-05). RF-02.6 búsqueda por título, clase y fecha; RNF-04 lista desde el índice.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const token = ({ aud = ['custodia', 'indice'], cedula = '1012345678', azp = 'portal' } = {}) =>
  new SignJWT({ azp, cedula }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)

async function pedir(ruta, { t, repo = { listar: async () => [] } } = {}) {
  const srv = crearApp({ repo, verificar: crearVerificador({ issuer: EMISOR, jwks }) }).listen(0)
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, { headers: t === null ? {} : { authorization: `Bearer ${t ?? await token()}` } })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  } finally { srv.close() }
}

test('lista la carpeta del titular del token y pasa los filtros al índice', async () => {
  const llamadas = []
  const repo = { listar: async (...a) => { llamadas.push(a); return [{ id: 'x' }] } }
  const r = await pedir('/carpeta?q=%20diploma%20&clase=certificado&desde=2026-01-01&hasta=2026-09-24', { repo })
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, [{ id: 'x' }])
  assert.deepEqual(llamadas, [['1012345678', { q: 'diploma', clase: 'certificado', desde: '2026-01-01', hasta: '2026-09-24' }]])
})

test('sin filtros lista toda la carpeta', async () => {
  const llamadas = []
  await pedir('/carpeta', { repo: { listar: async (...a) => { llamadas.push(a); return [] } } })
  assert.deepEqual(llamadas, [['1012345678', { q: undefined, clase: undefined, desde: undefined, hasta: undefined }]])
})

for (const [caso, ruta] of [
  ['clase desconocida', '/carpeta?clase=paloma'],
  ['fecha mal escrita', '/carpeta?desde=24/09/2026'],
  ['fecha inexistente', '/carpeta?hasta=2026-13-45'],
  ['rango al revés', '/carpeta?desde=2026-09-24&hasta=2026-01-01'],
  ['filtro repetido', '/carpeta?q=a&q=b'],
  ['texto demasiado largo', `/carpeta?q=${'a'.repeat(121)}`],
]) {
  test(`filtro no válido (${caso}): 422 en problem+json y sin consultar el índice`, async () => {
    const r = await pedir(ruta, { repo: { listar: async () => assert.fail('no debe consultar') } })
    assert.equal(r.status, 422)
    assert.match(r.tipo, /problem\+json/)
  })
}

test('sin token, con token de otra audiencia o de otro cliente: 401', async () => {
  assert.equal((await pedir('/carpeta', { t: null })).status, 401)
  assert.equal((await pedir('/carpeta', { t: await token({ aud: 'custodia' }) })).status, 401)
  assert.equal((await pedir('/carpeta', { t: await token({ azp: 'interoperabilidad' }) })).status, 401)
})
