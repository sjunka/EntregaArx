import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import { crearRepo, normalizar } from '../src/mongo.js'

// Proyección del índice contra un MongoDB real: MONGO_URL_TEST=mongodb://localhost:27018 npm test (se omite sin él).
const url = process.env.MONGO_URL_TEST
const CEDULA = '1012345678'
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cargado = (n, extra = {}) => ({ id: ID(n), cedula: CEDULA, clase: 'temporal', titulo: 'Diploma de Ingeniería', tipo: 'application/pdf', tamano: 100, creadoEn: '2026-09-20T15:00:00Z', ...extra })

let cliente, repo
before(async () => {
  if (!url) return
  cliente = await new MongoClient(url).connect()
  await cliente.db('indice_test').dropDatabase()
  repo = crearRepo(cliente.db('indice_test'))
  await repo.indices()
}, { skip: !url })
after(async () => { await cliente?.db('indice_test').dropDatabase(); await cliente?.close() })
const limpiar = () => cliente.db('indice_test').collection('carpeta').deleteMany({})

test('normalizar: sin tildes, mayúsculas ni espacios de más', () => assert.equal(normalizar('  Diploma  de INGENIERÍA '), 'diploma de ingenieria'))

test('busca por título sin tildes ni mayúsculas, por clase y por fecha; solo de su titular', { skip: !url }, async () => {
  await limpiar()
  await repo.cargado(cargado(1))
  await repo.cargado(cargado(2, { titulo: 'Cédula', creadoEn: '2026-08-01T15:00:00Z' }))
  await repo.cargado(cargado(3, { titulo: 'Diploma ajeno', cedula: '2000000002' }))
  await repo.recibido({ id: ID(4), cedula: CEDULA, clase: 'certificado', titulo: 'Certificado laboral', emisor: 'universidad-demo', recibidoEn: '2026-09-22T15:00:00Z' })
  assert.deepEqual((await repo.listar(CEDULA)).map((d) => d.id), [ID(4), ID(1), ID(2)], 'más reciente primero y sin el ajeno')
  assert.deepEqual((await repo.listar(CEDULA, { q: 'INGENIERIA' })).map((d) => d.id), [ID(1)])
  assert.deepEqual((await repo.listar(CEDULA, { clase: 'certificado' })).map((d) => d.id), [ID(4)])
  assert.deepEqual((await repo.listar(CEDULA, { desde: '2026-09-01', hasta: '2026-09-20' })).map((d) => d.id), [ID(1)])
  assert.deepEqual((await repo.listar(CEDULA, { q: '.*' })), [], 'el texto no es una expresión regular')
  assert.deepEqual((await repo.listar(CEDULA, { q: 'Ingeniería', clase: 'certificado' })), [])
})

test('las marcas y los estados se reflejan y el orden de los eventos no importa', { skip: !url }, async () => {
  await limpiar()
  await repo.autenticado({ id: ID(1), cedula: CEDULA, autenticadoEn: '2026-09-21T10:00:00Z' })
  assert.deepEqual(await repo.listar(CEDULA), [], 'sin el evento base no se muestra')
  await repo.cargado(cargado(1))
  const [d] = await repo.listar(CEDULA)
  assert.equal(d.estado, 'cargado')
  assert.equal(d.autenticacion.fecha, '2026-09-21T10:00:00.000Z')
  await repo.recibido({ id: ID(2), cedula: CEDULA, clase: 'certificado', titulo: 'Diploma de Ingeniería', emisor: 'u', recibidoEn: '2026-09-22T15:00:00Z', sustituyeA: ID(1) })
  assert.deepEqual((await repo.listar(CEDULA)).map((x) => [x.id, x.estado, x.sustituidoPor]), [[ID(2), 'vigente', undefined], [ID(1), 'sustituido', ID(2)]])
  await repo.cargado(cargado(1)) // repetir el evento no revive ni duplica
  assert.equal((await repo.listar(CEDULA)).length, 2)
  assert.equal((await repo.listar(CEDULA)).find((x) => x.id === ID(1)).estado, 'sustituido')
})

test('un eliminado sale de la lista aunque su evento llegue antes que el de carga', { skip: !url }, async () => {
  await limpiar()
  await repo.eliminado({ id: ID(1), cedula: CEDULA, eliminadoEn: '2026-09-21T10:00:00Z' })
  await repo.cargado(cargado(1))
  assert.deepEqual(await repo.listar(CEDULA), [])
})

test('un Certificado trasladado llega Vigente con su emisor', { skip: !url }, async () => {
  await limpiar()
  await repo.cargado(cargado(1, { clase: 'certificado', emisor: 'operador-origen', titulo: 'Diploma' }))
  const [d] = await repo.listar(CEDULA)
  assert.deepEqual([d.clase, d.estado, d.emisor], ['certificado', 'vigente', 'operador-origen'])
})

// HU-13: al confirmarse el Traslado de salida, la proyección de ese ciudadano se borra y la de otros no.
test('trasladado borra la proyección del ciudadano, solo la suya, y es idempotente', { skip: !url }, async () => {
  await limpiar()
  await repo.cargado(cargado(1))
  await repo.cargado(cargado(2, { cedula: '2000000002' }))
  await repo.trasladado({ cedula: CEDULA, trasladadoEn: '2026-09-24T10:00:00Z' })
  await repo.trasladado({ cedula: CEDULA, trasladadoEn: '2026-09-24T10:00:00Z' })
  assert.deepEqual(await repo.listar(CEDULA), [])
  assert.equal((await repo.listar('2000000002')).length, 1)
})
