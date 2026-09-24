import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose'
import { crearApp, crearLlave, cifrarClave } from '../src/app.js'

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

const SECRETO_ADMIN = 'secreto-de-afiliacion'

// Doble en memoria del repositorio Postgres (src/usuarios.js), con el mismo contrato.
function enMemoria() {
  const filas = new Map()
  return {
    porCuenta: async (cuenta) => [...filas.values()].find((u) => u.cuenta === cuenta) ?? null,
    crear: async (u) => {
      if ([...filas.values()].some((x) => x.cuenta === u.cuenta)) return null
      const id = randomUUID()
      filas.set(id, { ...u, id })
      return id
    },
    habilitar: async (id, habilitado) => filas.has(id) && !!Object.assign(filas.get(id), { habilitado }),
    borrar: async (id) => filas.delete(id),
  }
}

async function conEmisor(prueba) {
  const usuarios = enMemoria()
  await usuarios.crear({ ...USUARIO, clave: await cifrarClave(USUARIO.clave), habilitado: true })
  const app = crearApp({
    emisor: EMISOR,
    llave: await crearLlave(),
    usuarios,
    clientes: { portal: [`${REDIRECT}*`] },
    administradores: { 'afiliacion-admin': SECRETO_ADMIN },
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
  const q = new URLSearchParams({ client_id: 'portal', redirect_uri: REDIRECT, response_type: 'code', state: '"><script>', code_challenge: RETO, code_challenge_method: 'S256', login_hint: 'ana@carpetacolombia.co' })
  const r = await fetch(`${base}${RUTA}/auth?${q}`)
  assert.equal(r.status, 200)
  const html = await r.text()
  for (const id of ['id="username"', 'id="password"', 'id="kc-login"']) assert.ok(html.includes(id), id)
  assert.ok(!html.includes('"><script>'), 'escapa los parámetros reflejados')
  assert.ok(html.includes('value="ana@carpetacolombia.co"'), 'login_hint precarga la cuenta')
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

// Admin API: el mismo subconjunto del de Keycloak que usa Afiliación para crear cuentas (HU-01).
const ADMIN = '/admin/realms/carpeta/users'

async function tokenAdmin(base, secreto = SECRETO_ADMIN) {
  const r = await fetch(`${base}${RUTA}/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'afiliacion-admin', client_secret: secreto }),
  })
  return { status: r.status, token: (await r.json()).access_token }
}

const admin = (base, token, metodo, ruta = '', cuerpo) => fetch(`${base}${ADMIN}${ruta}`, {
  method: metodo, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: cuerpo && JSON.stringify(cuerpo),
})

const NUEVO = {
  username: 'ana.gil.45678@carpetacolombia.co', email: 'ana.gil.45678@carpetacolombia.co', emailVerified: true,
  firstName: 'Ana', lastName: 'Gil', enabled: false,
  attributes: { cedula: ['9912345678'], correoContacto: ['ana@correo.co'], telefono: ['3001234567'] },
  credentials: [{ type: 'password', value: 'clave-muy-segura', temporary: false }],
}

test('client_credentials solo con el secreto del cliente administrador', () => conEmisor(async (base) => {
  assert.equal((await tokenAdmin(base, 'otro')).status, 401)
  const { status, token } = await tokenAdmin(base)
  assert.equal(status, 200)
  assert.deepEqual(decodeJwt(token).resource_access['realm-management'].roles, ['manage-users'])
}))

test('el Admin API exige un token de administrador', () => conEmisor(async (base) => {
  assert.equal((await admin(base, 'basura', 'GET', '?exact=true&username=x')).status, 401)
  const code = new URL((await autorizar(base)).headers.get('location')).searchParams.get('code')
  const { access_token } = await (await canjear(base, code)).json()
  const r = await admin(base, access_token, 'GET', '?exact=true&username=x')
  assert.equal(r.status, 403)
  assert.match(r.headers.get('content-type'), /problem\+json/)
}))

test('crea deshabilitado, habilita, consulta y borra como Keycloak', () => conEmisor(async (base) => {
  const { token } = await tokenAdmin(base)
  const creado = await admin(base, token, 'POST', '', NUEVO)
  assert.equal(creado.status, 201)
  const id = creado.headers.get('location').split('/').pop()
  assert.equal((await admin(base, token, 'POST', '', NUEVO)).status, 409, 'la cuenta es única')

  const [u] = await (await admin(base, token, 'GET', `?exact=true&username=${NUEVO.username}`)).json()
  assert.equal(u.id, id)
  assert.equal(u.enabled, false)
  assert.deepEqual(u.attributes.cedula, ['9912345678'])
  assert.deepEqual(u.attributes.telefono, ['3001234567'])
  assert.equal(u.credentials, undefined, 'nunca devuelve la clave')

  const ingreso = { username: NUEVO.username, password: 'clave-muy-segura' }
  assert.equal((await autorizar(base, ingreso)).status, 401, 'deshabilitado no ingresa')
  assert.equal((await admin(base, token, 'PUT', `/${id}`, { enabled: true })).status, 204)
  const ok = await autorizar(base, ingreso)
  assert.equal(ok.status, 302)
  const { access_token } = await (await canjear(base, new URL(ok.headers.get('location')).searchParams.get('code'))).json()
  assert.equal(decodeJwt(access_token).cedula, '9912345678')
  assert.equal(decodeJwt(access_token).sub, id)

  assert.equal((await admin(base, token, 'DELETE', `/${id}`)).status, 204)
  assert.deepEqual(await (await admin(base, token, 'GET', `?exact=true&username=${NUEVO.username}`)).json(), [])
  assert.equal((await admin(base, token, 'DELETE', `/${id}`)).status, 404)
}))

test('usuario sin clave o sin cuenta: 400', () => conEmisor(async (base) => {
  const { token } = await tokenAdmin(base)
  assert.equal((await admin(base, token, 'POST', '', { ...NUEVO, credentials: [] })).status, 400)
  assert.equal((await admin(base, token, 'POST', '', { ...NUEVO, username: '' })).status, 400)
}))
