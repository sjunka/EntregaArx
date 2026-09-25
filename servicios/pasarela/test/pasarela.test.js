import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerAfiliacion, crearBreaker, crearCliente, Indisponible, EscrituraDeshabilitada, Rechazo } from '../src/govcarpeta.js'
import { crearApp } from '../src/app.js'

test('204 significa libre; 200 extrae el operador aunque haya espacio final', () => {
  assert.deepEqual(leerAfiliacion(204, ''), { afiliado: false, operador: null })
  const r = leerAfiliacion(200, 'El ciudadano 99123 ya se encuentra registrado en el operador Operador 123 ')
  assert.deepEqual(r, { afiliado: true, operador: 'Operador 123' })
  // Texto literal del GovCarpeta real (24 sep 2026): cadena JSON entre comillas y «operador:» con dos puntos.
  const real = leerAfiliacion(200, '"El ciudadano con id: 9990097549 se encuentra registrado en el operador: Mi Carpeta Segura "')
  assert.deepEqual(real, { afiliado: true, operador: 'Mi Carpeta Segura' })
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

async function pedir(cliente, metodo, ruta, cuerpo, opciones = {}) {
  const app = crearApp({ cliente, operador: { id: 'op-1', nombre: 'Mi Carpeta Segura' }, ...opciones })
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

// HU-04 · authenticateDocument: viaja la URL prefirmada, nunca el documento (RI-01, RNF-21).
const AUTENTICAR = { idCiudadano: '9912345678', url: 'https://almacen.example/mcs/9912345678/d1?X-Amz-Signature=abc', titulo: 'Diploma' }

test('autenticar traduce la solicitud al contrato de GovCarpeta y devuelve su respuesta', async () => {
  const enviados = []
  const cliente = { autenticar: async (d) => { enviados.push(d); return 'Documento autenticado' } }
  const r = await pedir(cliente, 'PUT', '/centralizador/documentos/autenticacion', AUTENTICAR)
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, { autenticado: true, respuesta: 'Documento autenticado' })
  assert.deepEqual(enviados, [{ idCitizen: 9912345678, UrlDocument: AUTENTICAR.url, documentTitle: 'Diploma' }])
})

test('autenticar rechaza URL que no sea https, título vacío o cédula inválida', async () => {
  const cliente = { autenticar: async () => assert.fail('no debe llamar a GovCarpeta') }
  for (const malo of [{ url: 'http://almacen.example/x' }, { url: 'no-es-url' }, { url: 'data:application/pdf;base64,AAAA' }, { titulo: '' }, { idCiudadano: '12a' }]) {
    const r = await pedir(cliente, 'PUT', '/centralizador/documentos/autenticacion', { ...AUTENTICAR, ...malo })
    assert.equal(r.status, 400, JSON.stringify(malo))
    assert.match(r.tipo, /problem\+json/)
  }
})

test('autenticar acepta http solo si la pasarela lo permite (MinIO local)', async () => {
  const cliente = { autenticar: async () => 'ok' }
  const r = await pedir(cliente, 'PUT', '/centralizador/documentos/autenticacion', { ...AUTENTICAR, url: 'http://localhost:9000/x?X-Amz-Signature=1' }, { soloHttps: false })
  assert.equal(r.status, 200)
})

test('autenticar con contenido adjunto: 413', async () => {
  const r = await pedir({}, 'PUT', '/centralizador/documentos/autenticacion', { ...AUTENTICAR, contenido: 'A'.repeat(4000) })
  assert.equal(r.status, 413)
})

test('autenticar traduce los fallos de GovCarpeta a 502 y 503', async () => {
  const rechazo = await pedir({ autenticar: async () => { throw new Rechazo(501, 'no') } }, 'PUT', '/centralizador/documentos/autenticacion', AUTENTICAR)
  assert.equal(rechazo.status, 502)
  const bloqueado = await pedir({ autenticar: async () => { throw new EscrituraDeshabilitada() } }, 'PUT', '/centralizador/documentos/autenticacion', AUTENTICAR)
  assert.equal(bloqueado.status, 503)
})

test('el cliente autentica con PUT y sin permiso de escritura no envía nada', async () => {
  const llamadas = []
  const fetch = async (url, init) => { llamadas.push([url, init.method, init.body]); return new Response('Documento autenticado', { status: 200 }) }
  const sin = crearCliente({ base: 'http://gov', escritura: false, fetch })
  await assert.rejects(sin.autenticar({ idCitizen: 1 }), EscrituraDeshabilitada)
  assert.equal(llamadas.length, 0)
  const con = crearCliente({ base: 'http://gov', escritura: true, fetch })
  assert.equal(await con.autenticar({ idCitizen: 9912345678, UrlDocument: 'https://x', documentTitle: 'D' }), 'Documento autenticado')
  assert.deepEqual(llamadas, [['http://gov/apis/authenticateDocument', 'PUT', JSON.stringify({ idCitizen: 9912345678, UrlDocument: 'https://x', documentTitle: 'D' })]])
  const malo = crearCliente({ base: 'http://gov', escritura: true, fetch: async () => new Response('no', { status: 501 }) })
  await assert.rejects(malo.autenticar({}), Rechazo)
})

// HU-13 · Traslado de salida: unregisterCitizen (escritura) y getOperators (lectura). Solo viajan datos de afiliación (RI-01).
test('desafiliar viaja como DELETE con id y operador, y sin permiso de escritura no envía nada', async () => {
  const llamadas = []
  const fetch = async (url, o) => { llamadas.push([o.method, url, o.body]); return new Response('Ciudadano dado de baja', { status: 200 }) }
  await crearCliente({ base: 'http://x', escritura: true, fetch }).desafiliar({ id: 9912345678, operatorId: 'op-1', operatorName: 'Mi Carpeta Segura' })
  assert.deepEqual(llamadas, [['DELETE', 'http://x/apis/unregisterCitizen', JSON.stringify({ id: 9912345678, operatorId: 'op-1', operatorName: 'Mi Carpeta Segura' })]])
  llamadas.length = 0
  await assert.rejects(crearCliente({ base: 'http://x', escritura: false, fetch }).desafiliar({}), EscrituraDeshabilitada)
  assert.equal(llamadas.length, 0)
})

test('desafiliar: 200 y 204 dejan libre al ciudadano; otro código es un rechazo', async () => {
  for (const status of [200, 201, 204]) await crearCliente({ base: 'http://x', escritura: true, fetch: async () => new Response(status === 204 ? null : 'ok', { status }) }).desafiliar({})
  await assert.rejects(crearCliente({ base: 'http://x', escritura: true, fetch: async () => new Response('no existe', { status: 501 }) }).desafiliar({}), Rechazo)
})

test('operadores normaliza getOperators: id, nombre y transferAPIURL solo cuando existe', async () => {
  const lista = [
    { _id: 'a1', operatorName: 'Operador Uno', transferAPIURL: ' https://uno.example/api/transferCitizen ' },
    { _id: 'b2', operatorName: 'Operador Dos', transferAPIURL: '' },
    { OperatorId: 'c3', OperatorName: 'Operador Tres' },
  ]
  const cliente = crearCliente({ base: 'http://x', fetch: async (url) => { assert.equal(url, 'http://x/apis/getOperators'); return new Response(JSON.stringify(lista), { status: 200 }) } })
  assert.deepEqual(await cliente.operadores(), [
    { id: 'a1', nombre: 'Operador Uno', transferAPIURL: 'https://uno.example/api/transferCitizen' },
    { id: 'b2', nombre: 'Operador Dos', transferAPIURL: null },
    { id: 'c3', nombre: 'Operador Tres', transferAPIURL: null },
  ])
})

test('DELETE /centralizador/ciudadanos/:id da de baja con el operador de la pasarela; cédula inválida 400', async () => {
  const enviados = []
  const cliente = { desafiliar: async (c) => { enviados.push(c) } }
  const r = await pedir(cliente, 'DELETE', '/centralizador/ciudadanos/9912345678')
  assert.equal(r.status, 200)
  assert.deepEqual(enviados, [{ id: 9912345678, operatorId: 'op-1', operatorName: 'Mi Carpeta Segura' }])
  assert.equal((await pedir(cliente, 'DELETE', '/centralizador/ciudadanos/12a')).status, 400)
  assert.equal((await pedir({ desafiliar: async () => { throw new EscrituraDeshabilitada() } }, 'DELETE', '/centralizador/ciudadanos/9912345678')).status, 503)
  assert.equal((await pedir({ desafiliar: async () => { throw new Rechazo(501, 'no registrado') } }, 'DELETE', '/centralizador/ciudadanos/9912345678')).status, 502)
})

test('GET /centralizador/operadores lista los operadores del centralizador', async () => {
  const r = await pedir({ operadores: async () => [{ id: 'a1', nombre: 'Uno', transferAPIURL: null }] }, 'GET', '/centralizador/operadores')
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, [{ id: 'a1', nombre: 'Uno', transferAPIURL: null }])
})
