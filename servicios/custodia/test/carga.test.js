import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, nuevoId, repositorioEnMemoria } from './doble.js'

const PDF = { titulo: 'Diploma de bachiller', tipo: 'application/pdf', tamano: 1000 }
const CEDULA = '1012345678'

test('registra el Temporal pendiente y entrega la URL de carga sin recibir el binario', () => conServicio(async ({ pedir, documentos, almacen }) => {
  const r = await pedir('/documentos', { metodo: 'POST', cuerpo: PDF })
  assert.equal(r.status, 201)
  assert.match(r.cuerpo.urlCarga, /^http:\/\/almacen\.test\//)
  assert.deepEqual(almacen.llamadas.urlCarga, [[`${CEDULA}/${r.cuerpo.id}`, 'application/pdf']])
  const d = await documentos.buscar(r.cuerpo.id)
  assert.equal(d.clase, 'temporal')
  assert.equal(d.estado, 'pendiente')
  assert.equal(d.titular, CEDULA)
  assert.equal(d.titulo, 'Diploma de bachiller')
}))

test('el binario no pasa por el servicio: un cuerpo grande se rechaza', () => conServicio(async ({ pedir }) => {
  const r = await pedir('/documentos', { metodo: 'POST', cuerpo: JSON.stringify({ ...PDF, contenido: 'x'.repeat(5000) }) })
  assert.equal(r.status, 413)
  assert.match(r.tipo, /problem\+json/)
}))

for (const [caso, cuerpo, status] of [
  ['formato no permitido', { ...PDF, tipo: 'application/zip' }, 415],
  ['más de 10 MB', { ...PDF, tamano: 10 * 1024 * 1024 + 1 }, 413],
  ['título vacío', { ...PDF, titulo: '   ' }, 422],
  ['sin título', { tipo: PDF.tipo, tamano: 5 }, 422],
  ['tamaño inválido', { ...PDF, tamano: 0 }, 422],
]) {
  test(`${caso}: ${status} con mensaje claro y sin emitir URL`, () => conServicio(async ({ pedir, documentos, almacen }) => {
    const r = await pedir('/documentos', { metodo: 'POST', cuerpo })
    assert.equal(r.status, status)
    assert.match(r.tipo, /problem\+json/)
    assert.ok(r.cuerpo.detail.length > 10, r.cuerpo.detail)
    assert.equal(almacen.llamadas.urlCarga.length, 0)
    assert.equal(documentos.filas.size, 0)
  }))
}

function llenar(documentos, n, tamano = 1000) {
  for (let i = 0; i < n; i++) documentos.filas.set(nuevoId(), { id: nuevoId(), titular: CEDULA, clase: 'temporal', estado: 'cargado', tamano, titulo: `d${i}`, creado: new Date() })
}

test('cuota: el Temporal 21 se rechaza con 422 y dice cuánto queda', () => {
  const documentos = repositorioEnMemoria()
  llenar(documentos, 20)
  return conServicio(async ({ pedir, almacen }) => {
    const r = await pedir('/documentos', { metodo: 'POST', cuerpo: PDF })
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.detail, /20 documentos/)
    assert.equal(almacen.llamadas.urlCarga.length, 0)
    // Otro titular no comparte la cuota.
    assert.equal((await pedir('/documentos', { metodo: 'POST', cuerpo: PDF, cedula: '2000000002' })).status, 201)
  }, { documentos })
})

test('cuota: pasar de 200 MB se rechaza aunque queden cupos', () => {
  const documentos = repositorioEnMemoria()
  llenar(documentos, 5, 40 * 1024 * 1024)
  return conServicio(async ({ pedir }) => {
    const r = await pedir('/documentos', { metodo: 'POST', cuerpo: { ...PDF, tamano: 1024 } })
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.detail, /200 MB/)
  }, { documentos })
})

test('GET /cuota informa lo usado y el máximo', () => {
  const documentos = repositorioEnMemoria()
  llenar(documentos, 3, 2048)
  return conServicio(async ({ pedir }) => {
    const r = await pedir('/cuota')
    assert.deepEqual(r.cuerpo, { documentos: { usados: 3, maximo: 20 }, bytes: { usados: 6144, maximo: 200 * 1024 * 1024 } })
  }, { documentos })
})

async function reservar(pedir) {
  return (await pedir('/documentos', { metodo: 'POST', cuerpo: PDF })).cuerpo.id
}

test('confirmar: el objeto coincide, se guarda el SHA-256 y queda Cargado', () => conServicio(async ({ pedir, almacen }) => {
  const id = await reservar(pedir)
  almacen.subir(`${CEDULA}/${id}`, 1000, 'application/pdf', 'b'.repeat(64))
  const r = await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.estado, 'cargado')
  assert.equal(r.cuerpo.clase, 'temporal')
  assert.equal(r.cuerpo.sha256, 'b'.repeat(64))
  assert.equal((await pedir('/documentos')).cuerpo.length, 1)
  assert.equal((await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })).status, 200, 'confirmar dos veces es inocuo')
}))

test('confirmar: tamaño o tipo distintos a lo declarado borran el objeto y responden 422', () => conServicio(async ({ pedir, almacen, documentos }) => {
  for (const [tamano, tipo] of [[999, 'application/pdf'], [1000, 'image/png']]) {
    const id = await reservar(pedir)
    almacen.subir(`${CEDULA}/${id}`, tamano, tipo)
    const r = await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })
    assert.equal(r.status, 422)
    assert.deepEqual(almacen.llamadas.borrar.at(-1), `${CEDULA}/${id}`)
    assert.equal(await documentos.buscar(id), null)
  }
}))

test('confirmar sin haber subido nada: 422', () => conServicio(async ({ pedir }) => {
  const id = await reservar(pedir)
  assert.equal((await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })).status, 422)
}))

test('un documento ajeno o inexistente responde 403 igual, sin revelar si existe', () => conServicio(async ({ pedir }) => {
  const id = await reservar(pedir)
  assert.equal((await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST', cedula: '2000000002' })).status, 403)
  assert.equal((await pedir(`/documentos/${nuevoId()}/confirmacion`, { metodo: 'POST' })).status, 403)
  assert.equal((await pedir('/documentos/no-es-uuid/confirmacion', { metodo: 'POST' })).status, 403)
}))

test('GET /documentos solo trae los Cargados del titular', () => conServicio(async ({ pedir, almacen }) => {
  const id = await reservar(pedir) // pendiente: no aparece
  assert.deepEqual((await pedir('/documentos')).cuerpo, [])
  almacen.subir(`${CEDULA}/${id}`, 1000, 'application/pdf')
  await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })
  assert.equal((await pedir('/documentos')).cuerpo.length, 1)
  assert.deepEqual((await pedir('/documentos', { cedula: '2000000002' })).cuerpo, [])
}))
