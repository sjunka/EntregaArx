import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { rutasTraslados, tokenActivacion } from '../src/traslados.js'

// HU-09 · Traslado de entrada: la cuenta se crea al recibir el traslado, la afiliación cambia en GovCarpeta solo al completar.
// RF-01.8, RF-01.5, RI-03, RNF-22.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const servicio = (azp = 'interoperabilidad') => new SignJWT({ azp, sub: azp }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('afiliacion').setIssuedAt().setExpirationTime('5m').sign(privateKey)
const verificar = async (t) => (await jwtVerify(t, jwks, { issuer: EMISOR, audience: 'afiliacion' })).payload

const CIUDADANO = {
  cedula: '1012345678', nombre: 'Ana', apellido: 'Gil', direccion: 'Calle 10 # 20-30, Bogotá', cuenta: 'ana.gil.45678@carpetacolombia.co',
  correoContacto: 'ana@correo.co', telefono: '3001234567',
}
const SECRETO = 'secreto-de-activacion-de-prueba'
const HORA = 3_600_000

function repoEnMemoria() {
  const filas = new Map()
  return {
    filas, eventos: [],
    porCedula: async (c) => filas.get(c) ?? null,
    porTraslado: async (id) => [...filas.values()].find((f) => f.trasladoId === id) ?? null,
    async crear(f) { const nueva = { trasladoId: randomUUID(), estado: 'traslado', activadoEn: null, ...f }; filas.set(f.cedula, nueva); return nueva },
    async activar(id, datos = {}) { const f = [...filas.values()].find((x) => x.trasladoId === id); f.activadoEn = new Date(); f.datos = { ...f.datos, ...datos }; return f },
    async afiliar(cedula, evento) { filas.get(cedula).estado = 'afiliado'; this.eventos.push(evento) },
    async borrar(cedula) { filas.delete(cedula) },
  }
}

function montar({ centralizador = { afiliado: false, operador: null }, registrar, existente } = {}) {
  const reloj = { ahora: new Date('2026-09-24T10:00:00Z') }
  const f = { reloj, repo: repoEnMemoria(), llamadas: [], usuarios: new Map() }
  if (existente) f.usuarios.set(existente.cuenta, existente)
  f.keycloak = {
    buscar: async (c) => f.usuarios.get(c) ?? null,
    crearDeshabilitado: async (u) => { f.llamadas.push('crear'); f.usuarios.set(u.cuenta, { id: 'kc-1', cedula: u.cedula, habilitado: false, clave: u.clave }); f.creado = u; return 'kc-1' },
    habilitar: async () => f.llamadas.push('habilitar'),
    fijarClave: async (id, clave) => { f.llamadas.push(['fijarClave', id, clave]) },
    borrar: async (id) => { f.llamadas.push(['borrar', id]); for (const [k, v] of f.usuarios) if (v.id === id) f.usuarios.delete(k) },
  }
  f.pasarela = {
    consultar: async () => { if (centralizador instanceof Error) throw centralizador; return centralizador },
    registrar: async (c) => { f.llamadas.push(['registrar', c]); if (registrar) await registrar(c); return {} },
  }
  const { interno, publico } = rutasTraslados({ repo: f.repo, keycloak: f.keycloak, pasarela: f.pasarela, verificar, secreto: SECRETO, operador: 'Mi Carpeta Segura', ahora: () => reloj.ahora })
  f.app = express().use('/interno/traslados', interno).use('/traslados', publico)
  return f
}

async function con(f, prueba) {
  const srv = f.app.listen(0)
  const pedir = async (ruta, { metodo = 'POST', cuerpo, servicioDe = 'interoperabilidad', sinToken } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, headers: { ...(!sinToken && ruta.startsWith('/interno') && { authorization: `Bearer ${await servicio(servicioDe)}` }), 'content-type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const iniciar = (pedir, cambio = {}) => pedir('/interno/traslados', { cuerpo: { ...CIUDADANO, ...cambio } })

test('iniciar: crea la cuenta institucional deshabilitada con clave aleatoria y devuelve el enlace de activación, sin tocar GovCarpeta', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const r = await iniciar(pedir)
    assert.equal(r.status, 201)
    assert.match(r.cuerpo.activacion, /^[0-9a-f-]{36}\.[\w-]{32}$/)
    assert.equal(r.cuerpo.venceEn, new Date(f.reloj.ahora.getTime() + 24 * HORA).toISOString())
    assert.deepEqual(f.llamadas, ['crear'], 'no se registra en GovCarpeta hasta que la Carpeta esté completa')
    assert.equal(f.creado.cuenta, 'ana.gil.45678@carpetacolombia.co')
    assert.ok(f.creado.clave.length >= 32, 'clave aleatoria: no viaja entre operadores')
    assert.equal(f.repo.filas.get('1012345678').estado, 'traslado')
    assert.deepEqual(f.repo.filas.get('1012345678').datos, { nombre: 'Ana', apellido: 'Gil', direccion: CIUDADANO.direccion, correoContacto: 'ana@correo.co', telefono: '3001234567' })
  })
})

test('iniciar de nuevo es idempotente: mismo enlace y una sola cuenta', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const a = await iniciar(pedir)
    const b = await iniciar(pedir)
    assert.equal(b.status, 200)
    assert.equal(b.cuerpo.activacion, a.cuerpo.activacion)
    assert.deepEqual(f.llamadas, ['crear'])
  })
})

test('ya afiliado aquí, cuenta ajena o datos inválidos: no se crea nada', async () => {
  const f = montar()
  f.repo.filas.set('1012345678', { cedula: '1012345678', estado: 'afiliado' })
  await con(f, async (pedir) => assert.equal((await iniciar(pedir)).status, 409))
  const g = montar({ existente: { id: 'otro', cedula: '2000000002', habilitado: true, cuenta: CIUDADANO.cuenta } })
  await con(g, async (pedir) => {
    const r = await iniciar(pedir)
    assert.equal(r.status, 409)
    assert.match(r.tipo, /problem\+json/)
    assert.deepEqual(g.llamadas, [])
    for (const cambio of [{ cedula: '12a' }, { telefono: '6011234567' }, { cuenta: 'no-es-correo' }, { nombre: '' }, { direccion: '' }, { correoContacto: 'x' }]) {
      assert.equal((await iniciar(pedir, cambio)).status, 422, JSON.stringify(cambio))
    }
  })
})

test('completar: registra en GovCarpeta como Mi Carpeta Segura y afilia, publicando el contacto', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    const r = await pedir('/interno/traslados/1012345678/completar')
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { estado: 'afiliado' })
    assert.deepEqual(f.llamadas.at(-1), ['registrar', { id: '1012345678', nombre: 'Ana Gil', direccion: CIUDADANO.direccion, correo: 'ana.gil.45678@carpetacolombia.co' }])
    assert.equal(f.repo.filas.get('1012345678').estado, 'afiliado')
    assert.deepEqual(f.repo.eventos, [{ cedula: '1012345678', cuenta: 'ana.gil.45678@carpetacolombia.co', correoContacto: 'ana@correo.co', telefono: '3001234567', afiliadoEn: '2026-09-24T10:00:00.000Z' }])
    const otra = await pedir('/interno/traslados/1012345678/completar')
    assert.equal(otra.status, 200, 'completar dos veces no vuelve a registrar')
    assert.equal(f.llamadas.filter((l) => l[0] === 'registrar').length, 1)
  })
})

test('completar: si GovCarpeta ya lo tiene aquí no registra de nuevo; si lo tiene otro operador, 409 y no afilia (RI-03)', async () => {
  const propio = montar({ centralizador: { afiliado: true, operador: 'Mi Carpeta Segura' } })
  await con(propio, async (pedir) => {
    await iniciar(pedir)
    assert.equal((await pedir('/interno/traslados/1012345678/completar')).status, 200)
    assert.equal(propio.llamadas.filter((l) => l[0] === 'registrar').length, 0)
  })
  const ajeno = montar({ centralizador: { afiliado: true, operador: 'Operador Ciudadano' } })
  await con(ajeno, async (pedir) => {
    await iniciar(pedir)
    const r = await pedir('/interno/traslados/1012345678/completar')
    assert.equal(r.status, 409)
    assert.equal(ajeno.repo.filas.get('1012345678').estado, 'traslado')
    assert.equal(ajeno.repo.eventos.length, 0)
  })
})

test('completar: centralizador caído responde 503 para reintentar; rechazo de GovCarpeta responde 502; sin traslado, 404', async () => {
  const caido = montar({ centralizador: new Error('caído') })
  await con(caido, async (pedir) => {
    await iniciar(pedir)
    assert.equal((await pedir('/interno/traslados/1012345678/completar')).status, 503)
    assert.equal(caido.repo.filas.get('1012345678').estado, 'traslado')
  })
  const rechaza = montar({ registrar: async () => { throw Object.assign(new Error('no'), { status: 502 }) } })
  await con(rechaza, async (pedir) => {
    await iniciar(pedir)
    assert.equal((await pedir('/interno/traslados/1012345678/completar')).status, 502)
    const timeout = montar({ registrar: async () => { throw Object.assign(new Error('timeout'), { status: 503 }) } })
    await con(timeout, async (p2) => { await iniciar(p2); assert.equal((await p2('/interno/traslados/1012345678/completar')).status, 503) })
  })
  await con(montar(), async (pedir) => assert.equal((await pedir('/interno/traslados/1012345678/completar')).status, 404))
})

test('cancelar: borra la cuenta y el traslado; es idempotente y no toca a un ciudadano ya afiliado', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    assert.equal((await pedir('/interno/traslados/1012345678/cancelar')).status, 200)
    assert.deepEqual(f.llamadas.at(-1), ['borrar', 'kc-1'])
    assert.equal(f.repo.filas.size, 0)
    assert.equal((await pedir('/interno/traslados/1012345678/cancelar')).status, 200, 'sin traslado tampoco falla')
    await iniciar(pedir)
    await pedir('/interno/traslados/1012345678/completar')
    assert.equal((await pedir('/interno/traslados/1012345678/cancelar')).status, 409)
    assert.equal(f.repo.filas.get('1012345678').estado, 'afiliado')
  })
})

test('activación: con el enlace el ciudadano fija su clave y la cuenta queda habilitada; sirve una sola vez', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const { cuerpo: { activacion } } = await iniciar(pedir)
    const activar = (cuerpo) => pedir('/traslados/activacion', { cuerpo })
    assert.equal((await activar({ token: activacion, clave: 'corta' })).status, 422)
    assert.equal((await activar({ token: activacion })).status, 422)
    const r = await activar({ token: activacion, clave: 'una-clave-de-12-o-mas' })
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { cuenta: 'ana.gil.45678@carpetacolombia.co' })
    assert.deepEqual(f.llamadas.slice(-2), [['fijarClave', 'kc-1', 'una-clave-de-12-o-mas'], 'habilitar'])
    const otra = await activar({ token: activacion, clave: 'otra-clave-de-12-o-mas' })
    assert.equal(otra.status, 409)
    assert.match(otra.tipo, /problem\+json/)
  })
})

test('activación: un token alterado, ajeno o vencido no sirve y no cambia ninguna clave', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const { cuerpo: { activacion } } = await iniciar(pedir)
    const [id] = activacion.split('.')
    const activar = (token) => pedir('/traslados/activacion', { cuerpo: { token, clave: 'una-clave-de-12-o-mas' } })
    for (const token of [`${id}.${'a'.repeat(32)}`, `${randomUUID()}.${activacion.split('.')[1]}`, 'basura', '', `${id}.`]) assert.equal((await activar(token)).status, 404, token)
    f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 24 * HORA + 1000)
    assert.equal((await activar(activacion)).status, 410)
    assert.deepEqual(f.llamadas, ['crear'])
  })
  assert.equal(tokenActivacion(SECRETO, 'x').startsWith('x.'), true)
})

test('las rutas internas exigen el token de servicio de la interoperabilidad', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await pedir('/interno/traslados', { cuerpo: CIUDADANO, sinToken: true })).status, 401)
    assert.equal((await pedir('/interno/traslados', { cuerpo: CIUDADANO, servicioDe: 'custodia' })).status, 403)
    assert.equal((await pedir('/interno/traslados/1012345678/completar', { servicioDe: 'portal' })).status, 403)
    assert.equal(f.repo.filas.size, 0)
  })
})

// ADR-0027: el formato del curso trae solo cédula, nombre completo y correo. Dirección y celular los da el ciudadano al activar,
// y la afiliación en GovCarpeta espera a que los tenga.
const DEL_CURSO = { cedula: '1012345678', nombre: 'Ana María Gil', cuenta: 'ana@otro-operador.co', correoContacto: 'ana@otro-operador.co' }

test('formato del curso: se crea la cuenta sin dirección ni celular y completar espera la activación (425)', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const r = await pedir('/interno/traslados', { cuerpo: DEL_CURSO })
    assert.equal(r.status, 201)
    assert.equal(f.creado.nombre, 'Ana María Gil')
    const antes = await pedir('/interno/traslados/1012345678/completar')
    assert.equal(antes.status, 425)
    assert.equal(f.llamadas.filter((l) => l[0] === 'registrar').length, 0, 'sin dirección no se registra en GovCarpeta')
  })
})

test('formato del curso: la activación exige dirección y celular; después completar registra con ellos', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const { cuerpo: { activacion } } = await pedir('/interno/traslados', { cuerpo: DEL_CURSO })
    const activar = (cuerpo) => pedir('/traslados/activacion', { cuerpo: { token: activacion, clave: 'una-clave-de-12-o-mas', ...cuerpo } })
    assert.equal((await activar({})).status, 422, 'faltan dirección y celular')
    assert.equal((await activar({ direccion: 'Calle 1 # 2-3, Bogotá', telefono: '6011234567' })).status, 422, 'celular inválido')
    assert.equal(f.repo.filas.get('1012345678').activadoEn, null, 'un intento inválido no consume el enlace')
    assert.equal((await activar({ direccion: 'Calle 1 # 2-3, Bogotá', telefono: '3009876543' })).status, 200)
    const r = await pedir('/interno/traslados/1012345678/completar')
    assert.equal(r.status, 200)
    assert.deepEqual(f.llamadas.at(-1), ['registrar', { id: '1012345678', nombre: 'Ana María Gil', direccion: 'Calle 1 # 2-3, Bogotá', correo: 'ana@otro-operador.co' }])
    assert.equal(f.repo.eventos[0].telefono, '3009876543')
  })
})

test('formato del curso: si la activación vence sin completarse, completar responde 410 para que el traslado falle', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await pedir('/interno/traslados', { cuerpo: DEL_CURSO })
    f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 25 * HORA)
    assert.equal((await pedir('/interno/traslados/1012345678/completar')).status, 410)
  })
})
