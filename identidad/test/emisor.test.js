import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose'
import { crearApp, crearLlave } from '../src/app.js'

// El iss es la URL que ve el navegador; los tests entran por el puerto local, como los servicios en compose.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const RUTA = '/realms/carpeta/protocol/openid-connect'
const REDIRECT = 'http://localhost:4173/'
const USUARIO = {
  cuenta: 'andres.perez.12345@carpetacolombia.co', clave: 'clave-de-prueba',
  cedula: '1012345678', nombres: 'Andrés', apellidos: 'Pérez',
}
const VERIFICADOR = 'v'.repeat(43)
const RETO = createHash('sha256').update(VERIFICADOR).digest('base64url')

async function conEmisor(prueba) {
  const app = crearApp({
    emisor: EMISOR,
    llave: await crearLlave(),
    usuarios: [USUARIO],
    clientes: { portal: [`${REDIRECT}*`] },
    origenes: ['http://localhost:4173'],
  })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  try { await prueba(base) } finally { srv.close() }
}

const autorizar = (base, extra = {}) => fetch(`${base}${RUTA}/auth`, {
  method: 'POST',
  redirect: 'manual',
  body: new URLSearchParams({
    client_id: 'portal', redirect_uri: REDIRECT, response_type: 'code', scope: 'openid', state: 'e1', nonce: 'n1',
    code_challenge: RETO, code_challenge_method: 'S256', username: USUARIO.cuenta, password: USUARIO.clave, ...extra,
  }),
})

const canjear = (base, code, extra = {}) => fetch(`${base}${RUTA}/token`, {
  method: 'POST',
  headers: { origin: 'http://localhost:4173' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'portal', redirect_uri: REDIRECT, code, code_verifier: VERIFICADOR, ...extra }),
})

test('publica el descubrimiento y el JWKS con las rutas de Keycloak', () => conEmisor(async (base) => {
  const d = await (await fetch(`${base}/realms/carpeta/.well-known/openid-configuration`)).json()
  assert.equal(d.issuer, EMISOR)
  assert.equal(d.authorization_endpoint, `${EMISOR}/protocol/openid-connect/auth`)
  assert.equal(d.token_endpoint, `${EMISOR}/protocol/openid-connect/token`)
  assert.equal(d.jwks_uri, `${EMISOR}/protocol/openid-connect/certs`)
  assert.deepEqual(d.code_challenge_methods_supported, ['S256'])
  const { keys } = await (await fetch(`${base}${RUTA}/certs`)).json()
  assert.equal(keys[0].alg, 'RS256')
  assert.ok(keys[0].kid)
  assert.equal(keys[0].d, undefined, 'nunca publica la parte privada')
}))

test('muestra el formulario de ingreso con los campos de Keycloak', () => conEmisor(async (base) => {
  const q = new URLSearchParams({ client_id: 'portal', redirect_uri: REDIRECT, response_type: 'code', state: '"><script>', code_challenge: RETO, code_challenge_method: 'S256' })
  const r = await fetch(`${base}${RUTA}/auth?${q}`)
  assert.equal(r.status, 200)
  const html = await r.text()
  for (const id of ['id="username"', 'id="password"', 'id="kc-login"']) assert.ok(html.includes(id), id)
  assert.ok(!html.includes('"><script>'), 'escapa los parámetros reflejados')
}))

test('código con PKCE canjeado por tokens con los claims del realm', () => conEmisor(async (base) => {
  const r = await autorizar(base)
  assert.equal(r.status, 302)
  const destino = new URL(r.headers.get('location'))
  assert.equal(`${destino.origin}${destino.pathname}`, REDIRECT)
  assert.equal(destino.searchParams.get('state'), 'e1')

  const t = await canjear(base, destino.searchParams.get('code'))
  assert.equal(t.status, 200)
  assert.equal(t.headers.get('access-control-allow-origin'), 'http://localhost:4173')
  const cuerpo = await t.json()
  assert.equal(cuerpo.token_type, 'Bearer')

  const jwks = createRemoteJWKSet(new URL(`${base}${RUTA}/certs`))
  const { payload: acceso } = await jwtVerify(cuerpo.access_token, jwks, { issuer: EMISOR, audience: 'custodia' })
  assert.equal(acceso.azp, 'portal')
  assert.equal(acceso.preferred_username, USUARIO.cuenta)
  assert.equal(acceso.cedula, USUARIO.cedula)

  const { payload: id } = await jwtVerify(cuerpo.id_token, jwks, { issuer: EMISOR, audience: 'portal' })
  assert.equal(id.nonce, 'n1')
  assert.equal(id.given_name, 'Andrés')
  assert.equal(id.cedula, undefined, 'la cédula solo va en el token de acceso')
}))

test('clave errada no redirige', () => conEmisor(async (base) => {
  const r = await autorizar(base, { password: 'otra' })
  assert.equal(r.status, 401)
  assert.match(await r.text(), /no coinciden/)
}))

test('redirect_uri no registrada no redirige', () => conEmisor(async (base) => {
  const r = await autorizar(base, { redirect_uri: 'https://atacante.example/' })
  assert.equal(r.status, 400)
  assert.equal(r.headers.get('location'), null)
}))

test('sin PKCE S256 no hay código', () => conEmisor(async (base) => {
  const r = await autorizar(base, { code_challenge_method: 'plain' })
  assert.equal(r.status, 400)
}))

test('verificador PKCE errado o redirect distinta: invalid_grant', () => conEmisor(async (base) => {
  const code = new URL((await autorizar(base)).headers.get('location')).searchParams.get('code')
  for (const extra of [{ code_verifier: 'x'.repeat(43) }, { redirect_uri: 'http://localhost:4173/otra' }, { code: 'basura' }]) {
    const t = await canjear(base, code, extra)
    assert.equal(t.status, 400)
    assert.equal((await t.json()).error, 'invalid_grant')
  }
}))

test('el código no sirve como token de acceso', () => conEmisor(async (base) => {
  const code = new URL((await autorizar(base)).headers.get('location')).searchParams.get('code')
  assert.notEqual(decodeJwt(code).aud, 'custodia')
}))

test('cerrar sesión vuelve solo a una URL registrada', () => conEmisor(async (base) => {
  const ok = await fetch(`${base}${RUTA}/logout?client_id=portal&post_logout_redirect_uri=${encodeURIComponent(REDIRECT)}`, { redirect: 'manual' })
  assert.equal(ok.status, 302)
  assert.equal(ok.headers.get('location'), REDIRECT)
  const malo = await fetch(`${base}${RUTA}/logout?client_id=portal&post_logout_redirect_uri=https://atacante.example/`, { redirect: 'manual' })
  assert.equal(malo.status, 200)
}))

test('entradas raras responden como rechazo, no como falla del emisor', () => conEmisor(async (base) => {
  assert.equal((await autorizar(base, { client_id: 'constructor' })).status, 400)
  const doble = await fetch(`${base}${RUTA}/auth`, {
    method: 'POST', redirect: 'manual',
    body: `client_id=portal&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=${RETO}&code_challenge_method=S256&username=${USUARIO.cuenta}&password=a&password=b`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  assert.equal(doble.status, 401)
}))

test('la cuenta no distingue mayúsculas, como en Keycloak', () => conEmisor(async (base) => {
  assert.equal((await autorizar(base, { username: USUARIO.cuenta.toUpperCase() })).status, 302)
}))
