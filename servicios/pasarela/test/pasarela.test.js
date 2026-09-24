import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerAfiliacion, crearBreaker, crearCliente, Indisponible, EscrituraDeshabilitada } from '../src/govcarpeta.js'
import { crearApp } from '../src/app.js'

test('204 significa libre; 200 extrae el operador aunque haya espacio final', () => {
  assert.deepEqual(leerAfiliacion(204, ''), { afiliado: false, operador: null })
  const r = leerAfiliacion(200, 'El ciudadano 99123 ya se encuentra registrado en el operador Operador 123 ')
  assert.deepEqual(r, { afiliado: true, operador: 'Operador 123' })
  assert.throws(() => leerAfiliacion(500, ''), Indisponible)
})

test('el breaker abre tras el umbral y cierra tras el enfriamiento', () => {
  let t = 0
  const b = crearBreaker({ umbral: 2, enfriamientoMs: 100, ahora: () => t })
  b.fallo(); assert.equal(b.abierto(), false)
  b.fallo(); assert.equal(b.abierto(), true)
  t = 101; assert.equal(b.abierto(), false)
})

test('un 500 del centralizador se traduce en Indisponible', async () => {
  const cliente = crearCliente({ base: 'http://x', escritura: true, fetch: async () => new Response('', { status: 500 }) })
  await assert.rejects(cliente.registrar({}), Indisponible)
})

test('GovCarpeta lento: corta por timeout y no espera más', async () => {
  const lento = (_url, { signal }) => new Promise((_ok, falla) => signal.addEventListener('abort', () => falla(signal.reason)))
  const cliente = crearCliente({ base: 'http://x', fetch: lento, timeoutMs: 20, esperaMs: 1 })
  const t = Date.now()
  await assert.rejects(cliente.consultar('9912345678'), Indisponible)
  assert.ok(Date.now() - t < 500)
})

test('la lectura se reintenta; con el breaker abierto ni se llama a GovCarpeta', async () => {
  let llamadas = 0
  const cliente = crearCliente({
    base: 'http://x', esperaMs: 1, breaker: crearBreaker({ umbral: 1 }),
    fetch: async () => { llamadas++; return new Response('', { status: 503 }) },
  })
  await assert.rejects(cliente.consultar('9912345678'), Indisponible)
  assert.equal(llamadas, 3)
  await assert.rejects(cliente.consultar('9912345678'), /Circuito abierto/)
  assert.equal(llamadas, 3)
})

test('sin permiso de escritura no se envía nada a GovCarpeta', async () => {
  let llamadas = 0
  const cliente = crearCliente({ base: 'http://x', escritura: false, fetch: async () => { llamadas++; return new Response('', { status: 201 }) } })
  await assert.rejects(cliente.registrar({}), EscrituraDeshabilitada)
  assert.equal(llamadas, 0)
})

async function pedir(cliente, metodo, ruta, cuerpo) {
  const app = crearApp({ cliente, operador: { id: 'op-1', nombre: 'Mi Carpeta Segura' } })
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://localhost:${srv.address().port}${ruta}`, {
      method: metodo, headers: { 'content-type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json() }
  } finally { srv.close() }
}

test('consulta normalizada y cédula inválida en problem+json', async () => {
  const cliente = { consultar: async () => ({ afiliado: true, operador: 'Otro' }) }
  assert.deepEqual((await pedir(cliente, 'GET', '/centralizador/ciudadanos/9912345678')).cuerpo, { afiliado: true, operador: 'Otro' })
  const r = await pedir(cliente, 'GET', '/centralizador/ciudadanos/12a')
  assert.equal(r.status, 400)
  assert.match(r.tipo, /problem\+json/)
})

test('al registrar solo viajan id, nombre, dirección, correo y operador', async () => {
  const enviados = []
  const cliente = { registrar: async (c) => { enviados.push(c) } }
  const r = await pedir(cliente, 'POST', '/centralizador/ciudadanos', { id: '9912345678', nombre: 'Ana Gil', direccion: 'Calle 1', correo: 'ana.gil.45678@carpetacolombia.co', clave: 'x' })
  assert.equal(r.status, 201)
  assert.deepEqual(enviados, [{ id: 9912345678, name: 'Ana Gil', address: 'Calle 1', email: 'ana.gil.45678@carpetacolombia.co', operatorId: 'op-1', operatorName: 'Mi Carpeta Segura' }])
})

test('errores del centralizador se traducen a 503 y 502', async () => {
  const caido = await pedir({ consultar: async () => { throw new Indisponible('x') } }, 'GET', '/centralizador/ciudadanos/9912345678')
  assert.equal(caido.status, 503)
  const bloqueado = await pedir({ registrar: async () => { throw new EscrituraDeshabilitada() } }, 'POST', '/centralizador/ciudadanos', { id: '9912345678', nombre: 'a', direccion: 'b', correo: 'c@d.co' })
  assert.equal(bloqueado.status, 503)
})

test('rechaza contenido documental: cuerpo mayor a 2 KB da 413', async () => {
  const r = await pedir({}, 'POST', '/centralizador/ciudadanos', { id: '9912345678', nombre: 'a', direccion: 'b', correo: 'c@d.co', contenido: 'A'.repeat(4000) })
  assert.equal(r.status, 413)
  assert.match(r.tipo, /problem\+json/)
})

test('JSON malformado: 400 en problem+json', async () => {
  const app = crearApp({ cliente: {}, operador: {} })
  const srv = app.listen(0)
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/centralizador/ciudadanos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal(r.status, 400)
    assert.match(r.headers.get('content-type'), /problem\+json/)
  } finally { srv.close() }
})
