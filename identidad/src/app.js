import express from 'express'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from 'jose'

const derivar = promisify(scrypt)

export async function cifrarClave(clave) {
  const sal = randomBytes(16)
  return `scrypt$${sal.toString('base64url')}$${(await derivar(clave, sal, 32)).toString('base64url')}`
}

async function claveCorrecta(clave, cifrada) {
  const [, sal, hash] = cifrada.split('$')
  return timingSafeEqual(await derivar(clave, Buffer.from(sal, 'base64url'), 32), Buffer.from(hash, 'base64url'))
}
// Se compara contra esta cuando la cuenta no existe, para no revelar por tiempo qué cuentas hay.
const SEÑUELO = await cifrarClave(randomUUID())

// Emisor OIDC simulado (ADR-0014). Rutas, claims y audiencias iguales a las del realm «carpeta» de Keycloak,
// para que servicios y SPA cambien de emisor solo con variables de entorno.
// ponytail: llave en memoria, cada reinicio invalida las sesiones; cargarla de un secreto si hace falta más de una réplica.
export async function crearLlave() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  return { privada: privateKey, publica: publicKey, jwk: { ...(await exportJWK(publicKey)), kid: randomUUID(), alg: 'RS256', use: 'sig' } }
}

export const AUDIENCIAS_CIUDADANO = ['custodia', 'notificaciones', 'indice', 'auditoria']
const VIDA_TOKEN = 300 // accessTokenLifespan del realm
const VIDA_CODIGO = 60
const MAX_INTENTOS = 5 // HU-02: al quinto fallo la cuenta se bloquea
const BLOQUEO_MS = 15 * 60_000

const sha256 = (s) => createHash('sha256').update(s).digest()
const iguales = (a, b) => timingSafeEqual(sha256(a), sha256(b))
const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const coincide = (patrones = [], uri) =>
  typeof uri === 'string' && patrones.some((p) => (p.endsWith('*') ? uri.startsWith(p.slice(0, -1)) : uri === p))

const pagina = (titulo, cuerpo) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · Mi Carpeta Segura</title>
<style>
  *{box-sizing:border-box} body{margin:0;font:400 16px/24px Inter,system-ui,sans-serif;color:#17201C;background:#F7F8F6}
  main{max-width:440px;margin:48px auto;padding:24px;background:#fff;border:1px solid #E0E5E1;border-radius:14px}
  h1{font-size:24px;line-height:32px;margin:0 0 8px} p{color:#46514C;margin:0 0 16px}
  label{display:block;font-weight:600;margin:16px 0 4px}
  input{width:100%;min-height:48px;padding:10px 12px;font:inherit;border:1px solid #8A9590;border-radius:10px}
  button{width:100%;min-height:48px;margin-top:24px;font:600 16px/1 inherit;color:#fff;background:#176B53;border:0;border-radius:10px;cursor:pointer}
  button:hover{background:#218161} :focus-visible{outline:3px solid #176B53;outline-offset:2px}
  .error{color:#B43B37;background:#FDEEEE;border:1px solid #B43B37;border-radius:10px;padding:12px;font-weight:600}
</style></head><body><main>${cuerpo}</main></body></html>`

const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method']

function formulario(p, error) {
  const ocultos = PARAMS.filter((k) => p[k]).map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('')
  return pagina('Ingresar', `<h1>Ingresa a tu carpeta</h1>
<p>Usa la cuenta institucional que recibiste al afiliarte.</p>
${error ? `<p class="error" role="alert" id="error">${error}</p>` : ''}
<form method="post">${ocultos}
<label for="username">Cuenta institucional</label>
<input id="username" name="username" type="email" autocomplete="username" value="${esc(p.username ?? p.login_hint)}" required${error ? ' aria-describedby="error"' : ''}>
<label for="password">Contraseña</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button id="kc-login" type="submit">Ingresar</button>
</form>`)
}

// usuarios: repositorio (src/usuarios.js) con porCuenta, crear, habilitar, borrar y el conteo de intentos (bloqueo, fallo, exito).
// clientes: { clientId: [redirects, admite * final] }; administradores: { clientId: secreto } para el Admin API;
// servicios: { clientId: { secreto, audiencia } } para client_credentials entre servicios (ADR-0006).
export function crearApp({ emisor, llave, usuarios, clientes, administradores = {}, servicios = {}, origenes = [] }) {
  const app = express()
  const base = new URL(emisor).pathname.replace(/\/$/, '')
  const oidc = `${base}/protocol/openid-connect`
  const adminUsuarios = `/admin${base}/users`
  const firmar = (claims, aud, vida) => new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: llave.jwk.kid, typ: 'JWT' })
    .setIssuer(emisor).setAudience(aud).setIssuedAt().setExpirationTime(`${vida}s`).setJti(randomUUID())
    .sign(llave.privada)

  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', vary: 'origin' })
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  app.use(express.urlencoded({ extended: false, limit: '4kb' }))
  app.use(express.json({ limit: '4kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.get(`${base}/.well-known/openid-configuration`, (_req, res) => res.json({
    issuer: emisor,
    authorization_endpoint: `${emisor}/protocol/openid-connect/auth`,
    token_endpoint: `${emisor}/protocol/openid-connect/token`,
    jwks_uri: `${emisor}/protocol/openid-connect/certs`,
    end_session_endpoint: `${emisor}/protocol/openid-connect/logout`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
  }))

  app.get(`${oidc}/certs`, (_req, res) => res.json({ keys: [llave.jwk] }))

  // Solo Authorization Code con PKCE S256 hacia una redirect registrada; si no, nunca se redirige.
  const invalida = (p) => {
    if (!Object.hasOwn(clientes, p.client_id) || !coincide(clientes[p.client_id], p.redirect_uri)) return 'La aplicación que pidió el ingreso no está registrada.'
    if (p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !p.code_challenge) return 'La solicitud de ingreso no es válida.'
  }
  const rechazo = (res, motivo) => res.status(400).type('html').send(pagina('No se pudo ingresar', `<h1>No se pudo ingresar</h1><p>${motivo}</p>`))

  app.get(`${oidc}/auth`, (req, res) => {
    const motivo = invalida(req.query)
    motivo ? rechazo(res, motivo) : res.type('html').send(formulario(req.query))
  })

  app.post(`${oidc}/auth`, async (req, res) => {
    const p = req.body ?? {}
    const motivo = invalida(p)
    if (motivo) return rechazo(res, motivo)
    // ponytail: un renglón por nombre probado (existan o no); purgar los vencidos si la tabla crece.
    const cuenta = typeof p.username === 'string' ? p.username.trim().toLowerCase().slice(0, 254) : ''
    const bloqueado = (r) => r.status(429).type('html').send(formulario(p, `Por seguridad bloqueamos el ingreso durante ${BLOQUEO_MS / 60_000} minutos tras varios intentos fallidos. Intenta de nuevo más tarde.`))
    if (cuenta && await usuarios.bloqueo(cuenta)) return bloqueado(res)
    const u = cuenta ? await usuarios.porCuenta(cuenta) : null
    const clave = typeof p.password === 'string' ? p.password : ''
    const valida = await claveCorrecta(clave, u?.clave ?? SEÑUELO)
    if (!u || !u.habilitado || !valida) {
      if (cuenta && await usuarios.fallo(cuenta, MAX_INTENTOS, BLOQUEO_MS)) return bloqueado(res)
      return res.status(401).type('html').send(formulario(p, 'La cuenta o la contraseña no coinciden. Revisa e intenta de nuevo.'))
    }
    await usuarios.exito(cuenta)
    // ponytail: código sin estado (JWT de 60 s), reutilizable dentro de esa ventana; Keycloak real lo invalida al primer uso.
    const code = await firmar({ sub: u.cuenta, azp: p.client_id, redirect_uri: p.redirect_uri, reto: p.code_challenge, nonce: p.nonce }, 'codigo', VIDA_CODIGO)
    const destino = new URL(p.redirect_uri)
    destino.searchParams.set('code', code)
    destino.searchParams.set('iss', emisor)
    if (p.state) destino.searchParams.set('state', p.state)
    res.redirect(302, destino.href)
  })

  // Errores del token en formato OAuth 2.0 (RFC 6749 *5.2), que es lo que esperan los clientes OIDC.
  app.post(`${oidc}/token`, async (req, res) => {
    const p = req.body ?? {}
    const falla = (error, status = 400) => res.status(status).json({ error })
    if (p.grant_type === 'client_credentials' && Object.hasOwn(servicios, p.client_id)) {
      const { secreto, audiencia } = servicios[p.client_id]
      if (typeof p.client_secret !== 'string' || !iguales(secreto, p.client_secret)) return falla('unauthorized_client', 401)
      return res.set('cache-control', 'no-store').json({
        token_type: 'Bearer', expires_in: VIDA_TOKEN,
        access_token: await firmar({ sub: p.client_id, azp: p.client_id, typ: 'Bearer' }, audiencia, VIDA_TOKEN),
      })
    }
    if (p.grant_type === 'client_credentials') {
      const secreto = Object.hasOwn(administradores, p.client_id) ? administradores[p.client_id] : null
      if (!secreto || typeof p.client_secret !== 'string' || !iguales(secreto, p.client_secret)) return falla('unauthorized_client', 401)
      // Cuenta de servicio con el rol manage-users de realm-management, como en Keycloak.
      return res.set('cache-control', 'no-store').json({
        token_type: 'Bearer', expires_in: VIDA_TOKEN,
        access_token: await firmar({ sub: p.client_id, azp: p.client_id, typ: 'Bearer', resource_access: { 'realm-management': { roles: ['manage-users'] } } }, 'realm-management', VIDA_TOKEN),
      })
    }
    if (p.grant_type !== 'authorization_code') return falla('unsupported_grant_type')
    let c
    try { ({ payload: c } = await jwtVerify(String(p.code ?? ''), llave.publica, { issuer: emisor, audience: 'codigo' })) } catch { return falla('invalid_grant') }
    const reto = sha256(String(p.code_verifier ?? '')).toString('base64url')
    if (c.azp !== p.client_id || c.redirect_uri !== p.redirect_uri || reto !== c.reto) return falla('invalid_grant')
    const u = await usuarios.porCuenta(c.sub)
    if (!u?.habilitado) return falla('invalid_grant')

    const perfil = {
      sub: u.id,
      azp: c.azp, preferred_username: u.cuenta, email: u.cuenta, email_verified: true,
      given_name: u.nombres, family_name: u.apellidos, name: `${u.nombres} ${u.apellidos}`,
    }
    res.set('cache-control', 'no-store').json({
      token_type: 'Bearer',
      expires_in: VIDA_TOKEN,
      scope: 'openid profile email',
      // Audiencias: cada servicio que atiende al ciudadano valida el mismo token (mapeador de audiencia en Keycloak).
      access_token: await firmar({ ...perfil, typ: 'Bearer', scope: 'openid profile email', cedula: u.cedula }, AUDIENCIAS_CIUDADANO, VIDA_TOKEN),
      id_token: await firmar({ ...perfil, typ: 'ID', nonce: c.nonce }, c.azp, VIDA_TOKEN),
    })
  })

  app.get(`${oidc}/logout`, (req, res) => {
    const uri = req.query.post_logout_redirect_uri
    const permitidas = req.query.client_id ? clientes[req.query.client_id] : Object.values(clientes).flat()
    if (coincide(permitidas, uri)) return res.redirect(302, uri)
    res.type('html').send(pagina('Sesión cerrada', '<h1>Cerraste sesión</h1><p>Ya puedes cerrar esta ventana.</p>'))
  })

  // Admin API: subconjunto del de Keycloak que usa Afiliación (MS-03) para crear cuentas institucionales.
  app.use(adminUsuarios, async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    let t
    try { ({ payload: t } = await jwtVerify(token ?? '', llave.publica, { issuer: emisor })) } catch { return problema(res, 401, 'Token inválido o ausente') }
    const admin = [].concat(t.aud).includes('realm-management') && t.resource_access?.['realm-management']?.roles?.includes('manage-users')
    admin ? next() : problema(res, 403, 'Sin permiso para administrar usuarios')
  })

  const representar = (u) => ({
    id: u.id, username: u.cuenta, email: u.cuenta, emailVerified: true, firstName: u.nombres, lastName: u.apellidos,
    enabled: u.habilitado, attributes: { cedula: [u.cedula], correoContacto: [u.correoContacto], telefono: [u.telefono] },
  })

  app.get(adminUsuarios, async (req, res) => {
    const u = typeof req.query.username === 'string' ? await usuarios.porCuenta(req.query.username.toLowerCase()) : null
    res.json(u ? [representar(u)] : [])
  })

  app.post(adminUsuarios, async (req, res) => {
    const b = req.body ?? {}
    const clave = b.credentials?.find?.((c) => c.type === 'password')?.value
    if (typeof b.username !== 'string' || !b.username.trim() || typeof clave !== 'string' || !clave) {
      return problema(res, 400, 'Usuario inválido', 'Se exige username y una credencial de tipo password')
    }
    const id = await usuarios.crear({
      cuenta: b.username.trim().toLowerCase(), clave: await cifrarClave(clave), habilitado: b.enabled === true,
      nombres: b.firstName ?? '', apellidos: b.lastName ?? '',
      cedula: b.attributes?.cedula?.[0] ?? null, correoContacto: b.attributes?.correoContacto?.[0] ?? null,
      telefono: b.attributes?.telefono?.[0] ?? null,
    })
    if (!id) return problema(res, 409, 'La cuenta ya existe')
    res.location(`${req.protocol}://${req.get('host')}${adminUsuarios}/${id}`).sendStatus(201)
  })

  app.put(`${adminUsuarios}/:id`, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return problema(res, 400, 'Solo se admite cambiar enabled')
    ;(await usuarios.habilitar(req.params.id, req.body.enabled)) ? res.sendStatus(204) : problema(res, 404, 'Usuario no encontrado')
  })

  app.delete(`${adminUsuarios}/:id`, async (req, res) => {
    ;(await usuarios.borrar(req.params.id)) ? res.sendStatus(204) : problema(res, 404, 'Usuario no encontrado')
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'Cuerpo inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande')
    console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }))
    problema(res, 500, 'Error interno')
  })
  return app
}
