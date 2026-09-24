import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuentaInstitucional, validarRegistro, cedulaEnmascarada } from '../src/cuenta.js'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { crearApp, crearLimite } from '../src/app.js'

const datos = { cedula: '9912345678', nombre: 'José Ángel', apellido: 'Muñoz Pérez', direccion: 'Calle 1', correoContacto: 'j@x.co', telefono: '3001234567', clave: 'clave-muy-segura' }

test('cuenta institucional: sin tildes, determinista y distinta en colisión', () => {
  assert.equal(cuentaInstitucional(datos), 'jose.munoz.45678@carpetacolombia.co')
  assert.equal(cuentaInstitucional(datos), cuentaInstitucional(datos))
  assert.notEqual(cuentaInstitucional(datos, 1), cuentaInstitucional(datos))
  assert.match(cuentaInstitucional(datos, 1), /^jose\.munoz\.\d{5}@carpetacolombia\.co$/)
  assert.equal(cuentaInstitucional({ ...datos, nombre: '  José ', apellido: ' 李' }), 'jose.ciudadano.45678@carpetacolombia.co')
})

test('valida entrada y enmascara la cédula en logs', () => {
  assert.deepEqual(validarRegistro(datos), [])
  assert.deepEqual(validarRegistro({ ...datos, cedula: '12a', clave: 'corta' }), ['cedula', 'clave'])
  assert.deepEqual(validarRegistro({ ...datos, cedula: 9912345678 }), ['cedula'], 'la cédula llega como texto')
  for (const telefono of [undefined, '300123456', '6011234567', '300 123 4567', 3001234567]) {
    assert.deepEqual(validarRegistro({ ...datos, telefono }), ['telefono'], `teléfono ${telefono}`)
  }
  assert.equal(cedulaEnmascarada('9912345678'), '******5678')
})

test('el límite por IP corta al sexto intento', () => {
  const lim = crearLimite({ max: 5 })
  for (let i = 0; i < 5; i++) assert.equal(lim('1.1.1.1'), true)
  assert.equal(lim('1.1.1.1'), false)
  assert.equal(lim('2.2.2.2'), true)
})

async function registrar(deps, cuerpo = datos, { previo = null, cabeceras = {} } = {}) {
  const llamadas = []
  const creados = []
  const sql = []
  const keycloak = {
    buscar: async () => previo,
    crearDeshabilitado: async (u) => { llamadas.push('crear'); creados.push(u); return 'u1' },
    habilitar: async () => llamadas.push('habilitar'),
    borrar: async () => llamadas.push('borrar'),
  }
  const app = crearApp({ db: { query: async (q, v) => { sql.push([q.trim().split(/\s/)[0], v]) } }, keycloak, ...deps })
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/ciudadanos`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json(), llamadas, creados, sql }
  } finally { srv.close() }
}

const libre = { consultar: async () => ({ afiliado: false, operador: null }), registrar: async () => ({}) }

test('datos inválidos: 400 en problem+json sin tocar GovCarpeta', async () => {
  const r = await registrar({ pasarela: { consultar: async () => assert.fail('no debe consultar') } }, { ...datos, cedula: '12a' })
  assert.equal(r.status, 400)
  assert.match(r.tipo, /problem\+json/)
})

test('ya afiliado a otro operador: 409 que nombra al operador, sin crear usuario', async () => {
  const r = await registrar({ pasarela: { consultar: async () => ({ afiliado: true, operador: 'Operador Ciudadano' }) } })
  assert.equal(r.status, 409)
  assert.match(r.cuerpo.detail, /Operador Ciudadano/)
  assert.deepEqual(r.llamadas, [])
})

test('centralizador caído: 503, registro pendiente y nunca se crea la cuenta', async () => {
  const r = await registrar({ pasarela: { consultar: async () => { throw new Error('caído') } } })
  assert.equal(r.status, 503)
  assert.deepEqual(r.llamadas, [])
  assert.deepEqual(r.sql.map(([q, v]) => [q, v[0]]), [['INSERT', '9912345678']])
})

test('rechazo del registro central: compensa borrando el usuario', async () => {
  const r = await registrar({ pasarela: { ...libre, registrar: async () => { throw Object.assign(new Error('no'), { status: 502 }) } } })
  assert.equal(r.status, 502)
  assert.deepEqual(r.llamadas, ['crear', 'borrar'])
})

test('GovCarpeta lento al registrar: 503 sin borrar la cuenta, porque pudo quedar registrado', async () => {
  const r = await registrar({ pasarela: { ...libre, registrar: async () => { throw Object.assign(new Error('timeout'), { status: 503 }) } } })
  assert.equal(r.status, 503)
  assert.deepEqual(r.llamadas, ['crear'])
})

const propio = { consultar: async () => ({ afiliado: true, operador: 'Mi Carpeta Segura' }), registrar: async () => assert.fail('no debe volver a registrar') }

test('reintento tras un registro interrumpido: rehace la cuenta sin volver a escribir en GovCarpeta', async () => {
  const r = await registrar({ pasarela: propio }, datos, { previo: { id: 'viejo', cedula: '9912345678', habilitado: false } })
  assert.equal(r.status, 201)
  assert.deepEqual(r.llamadas, ['borrar', 'crear', 'habilitar'])
})

test('ya afiliado aquí con cuenta activa: 409 sin tocar nada', async () => {
  const r = await registrar({ pasarela: propio }, datos, { previo: { id: 'u0', cedula: '9912345678', habilitado: true } })
  assert.equal(r.status, 409)
  assert.match(r.cuerpo.detail, /Mi Carpeta Segura/)
  assert.deepEqual(r.llamadas, [])
})

test('X-Forwarded-For no evade el límite por IP', async () => {
  const limite = crearLimite({ max: 1 })
  const primera = await registrar({ pasarela: libre, limite }, datos, { cabeceras: { 'x-forwarded-for': '1.1.1.1' } })
  const segunda = await registrar({ pasarela: libre, limite }, datos, { cabeceras: { 'x-forwarded-for': '2.2.2.2' } })
  assert.equal(primera.status, 201)
  assert.equal(segunda.status, 429)
})

test('JSON malformado: 400 en problem+json', async () => {
  const app = crearApp({ db: {}, keycloak: {}, pasarela: {} })
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/ciudadanos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal(r.status, 400)
    assert.match(r.headers.get('content-type'), /problem\+json/)
  } finally { srv.close() }
})

test('identidad no verificada: 422 sin consultar GovCarpeta (B-06 simulada)', async () => {
  const r = await registrar({ pasarela: { consultar: async () => assert.fail('no debe consultar') }, registraduria: { verificar: async () => false } })
  assert.equal(r.status, 422)
  assert.deepEqual(r.llamadas, [])
})

test('camino feliz: verifica, crea deshabilitado, registra solo lo mínimo y habilita', async () => {
  const enviados = []
  const r = await registrar({ pasarela: { ...libre, registrar: async (c) => { enviados.push(c) } } })
  assert.equal(r.status, 201)
  assert.deepEqual(r.cuerpo, { cedula: '9912345678', cuenta: 'jose.munoz.45678@carpetacolombia.co', estado: 'afiliado', identidad: 'simulada' })
  assert.deepEqual(r.llamadas, ['crear', 'habilitar'])
  assert.deepEqual(enviados, [{ id: '9912345678', nombre: 'José Ángel Muñoz Pérez', direccion: 'Calle 1', correo: 'jose.munoz.45678@carpetacolombia.co' }], 'el teléfono no viaja a GovCarpeta')
  assert.equal(r.creados[0].telefono, '3001234567', 'el teléfono queda en la cuenta')
})

test('al afiliar deja en la misma sentencia el evento ciudadano.afiliado con el contacto, que cumple el contrato', async () => {
  const r = await registrar({ pasarela: libre })
  const escritura = r.sql.filter(([q]) => q === 'WITH')
  assert.equal(escritura.length, 1, 'ciudadano y bandeja se escriben juntos')
  const [cedula, cuenta, json] = escritura[0][1]
  assert.deepEqual([cedula, cuenta], ['9912345678', 'jose.munoz.45678@carpetacolombia.co'])
  const evento = JSON.parse(json)
  assert.deepEqual(Object.keys(evento).sort(), ['afiliadoEn', 'cedula', 'correoContacto', 'cuenta', 'telefono'])
  assert.equal(evento.correoContacto, 'j@x.co')
  assert.equal(evento.telefono, '3001234567')
  const ajv = addFormats(new Ajv({ strict: true }), ['uuid', 'email', 'date-time'])
  ajv.addKeyword('x-cloudevent')
  const validar = ajv.compile(JSON.parse(await readFile(new URL('../../../contratos/eventos/ciudadano-afiliado.v1.schema.json', import.meta.url), 'utf8')))
  assert.ok(validar(evento), JSON.stringify(validar.errors))
})

test('CORS solo para orígenes registrados', async () => {
  const app = crearApp({ db: {}, keycloak: {}, pasarela: {}, origenes: ['http://localhost:4173'] })
  const srv = app.listen(0)
  try {
    const url = `http://localhost:${srv.address().port}/ciudadanos`
    const ok = await fetch(url, { method: 'OPTIONS', headers: { origin: 'http://localhost:4173' } })
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:4173')
    const otro = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://atacante.example' } })
    assert.equal(otro.headers.get('access-control-allow-origin'), null)
  } finally { srv.close() }
})
