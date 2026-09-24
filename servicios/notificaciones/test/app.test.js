import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp, enmascarar } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'

const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const token = ({ aud = ['custodia', 'notificaciones'], cedula = '1012345678', azp = 'portal', iss = EMISOR } = {}) =>
  new SignJWT({ azp, cedula }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)

function montar(contacto = { cedula: '1012345678', correo: 'ana.gil@correo.co', telefono: '3001234567', canales: ['correo'] }) {
  const contactos = new Map(contacto ? [[contacto.cedula, contacto]] : [])
  const historial = [{ cedula: '1012345678', canal: 'correo', estado: 'enviado', asunto: 'Recibiste un documento', creado: new Date('2026-09-24T10:00:00Z') }, { cedula: '2000000002', canal: 'sms', estado: 'enviado', asunto: 'ajeno', creado: new Date() }]
  return crearApp({
    verificar: crearVerificador({ issuer: EMISOR, audience: 'notificaciones', jwks }),
    contactos: { obtener: async (c) => contactos.get(c) ?? null, guardarCanales: async (c, canales) => { const x = contactos.get(c); if (x) x.canales = canales; return x ?? null } },
    historial: { ultimos: async (c) => historial.filter((h) => h.cedula === c) },
  })
}

async function pedir(app, ruta, { metodo = 'GET', cuerpo, t } = {}) {
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, headers: { ...(t !== null && { authorization: `Bearer ${t ?? await token()}` }), ...(cuerpo && { 'content-type': 'application/json' }) }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  } finally { srv.close() }
}

test('enmascara el contacto', () => {
  assert.equal(enmascarar.correo('ana.gil@correo.co'), 'an***@correo.co')
  assert.equal(enmascarar.correo('a@x.co'), 'a***@x.co')
  assert.equal(enmascarar.telefono('3001234567'), '300***4567')
  assert.equal(enmascarar.telefono(''), '')
})

test('GET /preferencias: canales elegidos y destinos enmascarados, nunca completos', async () => {
  const r = await pedir(montar(), '/preferencias')
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, { canales: ['correo'], correo: 'an***@correo.co', telefono: '300***4567' })
})

test('PUT /preferencias guarda correo, sms o ambos', async () => {
  const app = montar()
  const r = await pedir(app, '/preferencias', { metodo: 'PUT', cuerpo: { canales: ['correo', 'sms'] } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo.canales, ['correo', 'sms'])
  assert.deepEqual((await pedir(app, '/preferencias')).cuerpo.canales, ['correo', 'sms'])
})

for (const [caso, canales] of [['ninguno', []], ['canal desconocido', ['paloma']], ['repetido', ['sms', 'sms']], ['no es lista', 'correo'], ['ausente', undefined]]) {
  test(`PUT /preferencias con ${caso}: 422 en problem+json`, async () => {
    const r = await pedir(montar(), '/preferencias', { metodo: 'PUT', cuerpo: { canales } })
    assert.equal(r.status, 422)
    assert.match(r.tipo, /problem\+json/)
  })
}

test('sin datos de contacto todavía: 404 con explicación', async () => {
  const r = await pedir(montar(null), '/preferencias')
  assert.equal(r.status, 404)
  assert.match(r.cuerpo.detail, /contacto/i)
})

test('GET /notificaciones solo devuelve los avisos del titular', async () => {
  const r = await pedir(montar(), '/notificaciones')
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.length, 1)
  assert.equal(r.cuerpo[0].asunto, 'Recibiste un documento')
  assert.equal(r.cuerpo[0].cedula, undefined)
})

for (const [caso, t] of [
  ['sin token', null],
  ['otra audiencia', () => token({ aud: 'custodia' })],
  ['otro emisor', () => token({ iss: 'https://atacante.example/realms/carpeta' })],
  ['otro cliente', () => token({ azp: 'servicio' })],
  ['sin cédula', () => token({ cedula: null })],
]) {
  test(`${caso}: 401 y no toca los datos`, async () => {
    const r = await pedir(montar(), '/preferencias', { t: typeof t === 'function' ? await t() : t })
    assert.equal(r.status, 401)
    assert.match(r.tipo, /problem\+json/)
  })
}

test('un ciudadano solo ve y cambia sus propias preferencias', async () => {
  const app = montar()
  assert.equal((await pedir(app, '/preferencias', { t: await token({ cedula: '2000000002' }) })).status, 404, 'el otro no tiene contacto y no ve el de Ana')
})
