import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { rutasSalida } from '../src/salida.js'

// HU-13 · Traslado de salida en MS-03: la baja en GovCarpeta, la reafiliación si el destino rechaza y el cierre de la cuenta
// solo tras la confirmación. RF-01.7, RF-01.8, RI-01, RI-03.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const servicio = (azp = 'interoperabilidad') => new SignJWT({ azp, sub: azp }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('afiliacion').setIssuedAt().setExpirationTime('5m').sign(privateKey)
const verificar = async (t) => (await jwtVerify(t, jwks, { issuer: EMISOR, audience: 'afiliacion' })).payload

const CEDULA = '1012345678'
const CUENTA = 'ana.gil.45678@carpetacolombia.co'

function montar({ estado = 'afiliado', direccion = 'Calle 10 # 20-30, Bogotá', centralizador = { afiliado: true, operador: 'Mi Carpeta Segura' }, desafiliar, registrar } = {}) {
  const f = { llamadas: [], filas: new Map([[CEDULA, { cedula: CEDULA, cuenta: CUENTA, estado, direccion }]]), central: { ...centralizador } }
  f.repo = {
    porCedula: async (c) => f.filas.get(c) ?? null,
    estado: async (c, e) => { f.filas.get(c).estado = e },
    borrar: async (c) => { f.filas.delete(c) },
  }
  f.keycloak = {
    buscar: async () => ({ id: 'kc-1', nombre: 'Ana Gil' }),
    borrar: async (id) => { f.llamadas.push(['borrarCuenta', id]) },
  }
  f.pasarela = {
    consultar: async () => f.central,
    desafiliar: async (c) => { f.llamadas.push(['desafiliar', c]); if (desafiliar) await desafiliar(); f.central = { afiliado: false, operador: null } },
    registrar: async (c) => { f.llamadas.push(['registrar', c]); if (registrar) await registrar(); f.central = { afiliado: true, operador: 'Mi Carpeta Segura' } },
  }
  f.app = express().use('/interno/salida', rutasSalida({ ...f, verificar, operador: 'Mi Carpeta Segura' }))
  return f
}

async function con(f, prueba) {
  const srv = f.app.listen(0)
  const pedir = async (ruta, { metodo = 'POST', servicioDe = 'interoperabilidad', sinToken } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/interno/salida${ruta}`, {
      method: metodo, headers: { ...(!sinToken && { authorization: `Bearer ${await servicio(servicioDe)}` }), 'content-type': 'application/json' },
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}

test('consultar devuelve lo que MS-07 manda al destino: cédula, cuenta y nombre, sin contacto', async () => {
  await con(montar(), async (pedir) => {
    const r = await pedir(`/${CEDULA}`, { metodo: 'GET' })
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { cedula: CEDULA, cuenta: CUENTA, nombre: 'Ana Gil', estado: 'afiliado' })
    assert.equal((await pedir('/2000000002', { metodo: 'GET' })).status, 404)
  })
})

test('baja: da de baja en GovCarpeta y marca la salida; repetirla no vuelve a escribir en GovCarpeta', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const r = await pedir(`/${CEDULA}/baja`)
    assert.equal(r.status, 200)
    assert.equal(f.filas.get(CEDULA).estado, 'salida')
    assert.deepEqual(f.llamadas, [['desafiliar', CEDULA]])
    assert.equal((await pedir(`/${CEDULA}/baja`)).status, 200)
    assert.equal(f.llamadas.length, 1)
  })
})

test('baja: si GovCarpeta no responde o rechaza, la cuenta sigue afiliada y se informa', async () => {
  for (const [error, status] of [[Object.assign(new Error('caído'), { status: 503 }), 503], [Object.assign(new Error('rechazo'), { status: 502 }), 502]]) {
    const f = montar({ desafiliar: async () => { throw error } })
    await con(f, async (pedir) => {
      const r = await pedir(`/${CEDULA}/baja`)
      assert.equal(r.status, status)
      assert.match(r.tipo, /problem\+json/)
      assert.equal(f.filas.get(CEDULA).estado, 'afiliado')
    })
  }
})

test('reafiliar: vuelve a registrar al ciudadano con nombre, dirección y cuenta, y lo deja afiliado', async () => {
  const f = montar({ estado: 'salida', centralizador: { afiliado: false, operador: null } })
  await con(f, async (pedir) => {
    assert.equal((await pedir(`/${CEDULA}/reafiliacion`)).status, 200)
    assert.deepEqual(f.llamadas, [['registrar', { id: CEDULA, nombre: 'Ana Gil', direccion: 'Calle 10 # 20-30, Bogotá', correo: CUENTA }]])
    assert.equal(f.filas.get(CEDULA).estado, 'afiliado')
    assert.equal((await pedir(`/${CEDULA}/reafiliacion`)).status, 200)
    assert.equal(f.llamadas.length, 1, 'ya afiliado: no se registra dos veces')
  })
})

test('reafiliar sin dirección guardada usa un texto neutro; si GovCarpeta lo tiene en otro operador, 409 y no se escribe', async () => {
  const f = montar({ estado: 'salida', direccion: null, centralizador: { afiliado: false, operador: null } })
  await con(f, async (pedir) => {
    await pedir(`/${CEDULA}/reafiliacion`)
    assert.equal(f.llamadas[0][1].direccion, 'Sin dirección registrada')
  })
  const g = montar({ estado: 'salida', centralizador: { afiliado: true, operador: 'Otro Operador' } })
  await con(g, async (pedir) => {
    assert.equal((await pedir(`/${CEDULA}/reafiliacion`)).status, 409)
    assert.deepEqual(g.llamadas, [])
    assert.equal(g.filas.get(CEDULA).estado, 'salida')
  })
})

test('cierre: borra la cuenta y el registro del ciudadano; sin salida en curso responde 409 y no borra', async () => {
  const f = montar({ estado: 'salida', centralizador: { afiliado: true, operador: 'Operador Destino' } })
  await con(f, async (pedir) => {
    assert.equal((await pedir(`/${CEDULA}/cierre`)).status, 200)
    assert.deepEqual(f.llamadas, [['borrarCuenta', 'kc-1']])
    assert.equal(f.filas.has(CEDULA), false)
    assert.equal((await pedir(`/${CEDULA}/cierre`)).status, 200, 'idempotente')
  })
  const g = montar({ estado: 'afiliado' })
  await con(g, async (pedir) => {
    assert.equal((await pedir(`/${CEDULA}/cierre`)).status, 409)
    assert.equal(g.filas.has(CEDULA), true)
    assert.deepEqual(g.llamadas, [])
  })
})

test('solo la interoperabilidad llama a las rutas de salida', async () => {
  await con(montar(), async (pedir) => {
    assert.equal((await pedir(`/${CEDULA}/baja`, { sinToken: true })).status, 401)
    assert.equal((await pedir(`/${CEDULA}/baja`, { servicioDe: 'premium' })).status, 403)
    assert.equal((await pedir('/abc/baja')).status, 422)
  })
})
