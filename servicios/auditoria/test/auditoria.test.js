import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { MongoClient } from 'mongodb'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { crearRepo } from '../src/mongo.js'
import { registrosDeEnvio } from '../src/envios.js'

// HU-06 · MS-02 auditoría solo-append. RF-02.7 el acceso queda registrado; RNF-14 la bitácora no se puede alterar.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const token = ({ aud = ['custodia', 'auditoria'], cedula = '1012345678', azp = 'portal' } = {}) =>
  new SignJWT({ azp, cedula }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)

const ACCESOS = [
  { id: '1', documentoId: 'd1', titulo: 'Diploma', accion: 'descarga', actor: { tipo: 'titular', id: '1012345678' }, ocurridoEn: '2026-09-24T10:00:00.000Z' },
]
async function pedir(ruta, { metodo = 'GET', t, repo = { listar: async () => ACCESOS } } = {}) {
  const srv = crearApp({ repo, verificar: crearVerificador({ issuer: EMISOR, jwks }) }).listen(0)
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, { method: metodo, headers: t === null ? {} : { authorization: `Bearer ${t ?? await token()}` } })
    return { status: r.status, allow: r.headers.get('allow'), tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  } finally { srv.close() }
}

test('GET /accesos devuelve los accesos a la Carpeta del titular del token', async () => {
  const pedidos = []
  const r = await pedir('/accesos', { repo: { listar: async (c) => { pedidos.push(c); return ACCESOS } } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, ACCESOS)
  assert.deepEqual(pedidos, ['1012345678'])
})

for (const metodo of ['PUT', 'PATCH', 'DELETE', 'POST']) {
  test(`${metodo} sobre la bitácora: 405, no hay forma de alterarla`, async () => {
    for (const ruta of ['/accesos', '/accesos/1']) {
      const r = await pedir(ruta, { metodo, repo: { listar: async () => assert.fail('no debe leer') } })
      assert.equal(r.status, 405, ruta)
      assert.equal(r.allow, 'GET')
      assert.match(r.tipo, /problem\+json/)
    }
  })
}

test('sin token o con un token de otra audiencia: 401', async () => {
  assert.equal((await pedir('/accesos', { t: null })).status, 401)
  assert.equal((await pedir('/accesos', { t: await token({ aud: 'custodia' }) })).status, 401)
})

test('el repositorio solo puede agregar y listar', async () => {
  const repo = crearRepo({ collection: () => ({}) })
  assert.deepEqual(Object.keys(repo).sort(), ['agregar', 'indices', 'listar'])
})

// Contra un MongoDB real: MONGO_URL_TEST=mongodb://localhost:27018 npm test (se omite sin él).
test('agregar es idempotente por evento y listar solo devuelve los del titular, del más reciente al más antiguo', { skip: !process.env.MONGO_URL_TEST }, async () => {
  const cliente = await new MongoClient(process.env.MONGO_URL_TEST).connect()
  try {
    const db = cliente.db('auditoria_test')
    await db.dropDatabase()
    const repo = crearRepo(db)
    await repo.indices()
    const base = { documentoId: 'd1', cedula: '1012345678', titulo: 'Diploma', accion: 'descarga', actor: { tipo: 'titular', id: '1012345678' } }
    await repo.agregar({ ...base, eventoId: 'e1', ocurridoEn: '2026-09-24T10:00:00Z' })
    await repo.agregar({ ...base, eventoId: 'e1', ocurridoEn: '2026-09-24T10:00:00Z' }) // entrega repetida
    await repo.agregar({ ...base, eventoId: 'e2', accion: 'lectura-tercero', actor: { tipo: 'tercero', id: 'entidad:universidad-demo' }, ocurridoEn: '2026-09-24T11:00:00Z' })
    await repo.agregar({ ...base, eventoId: 'e3', cedula: '2000000002', ocurridoEn: '2026-09-24T12:00:00Z' })
    const lista = await repo.listar('1012345678')
    assert.deepEqual(lista.map((a) => [a.accion, a.actor.tipo]), [['lectura-tercero', 'tercero'], ['descarga', 'titular']])
    await db.dropDatabase()
  } finally { await cliente.close() }
})

test('un envío entregado deja un registro por documento, con el titular como actor y el correo como destino', () => {
  const envio = { id: 'ce-1', datos: { id: 'e1', cedula: '1012345678', correo: 'tramites@entidad.co', documentos: [{ id: 'd1', titulo: 'Cédula' }, { id: 'd2', titulo: 'Diploma' }], entregadoEn: '2026-09-24T10:00:00Z' } }
  const filas = registrosDeEnvio(envio)
  assert.deepEqual(filas.map((f) => [f.eventoId, f.documentoId, f.titulo]), [['ce-1:d1', 'd1', 'Cédula'], ['ce-1:d2', 'd2', 'Diploma']])
  assert.deepEqual(filas[0], {
    eventoId: 'ce-1:d1', documentoId: 'd1', cedula: '1012345678', titulo: 'Cédula', accion: 'envio',
    actor: { tipo: 'titular', id: '1012345678' }, destino: 'correo:tramites@entidad.co', ocurridoEn: '2026-09-24T10:00:00Z',
  })
})

test('la bitácora conserva el destino de un envío y lo devuelve al titular', { skip: !process.env.MONGO_URL_TEST }, async () => {
  const cliente = await new MongoClient(process.env.MONGO_URL_TEST).connect()
  try {
    const db = cliente.db('auditoria_test_envio')
    await db.dropDatabase()
    const repo = crearRepo(db)
    await repo.indices()
    for (const r of registrosDeEnvio({ id: 'ce-1', datos: { id: 'e1', cedula: '1012345678', correo: 'tramites@entidad.co', documentos: [{ id: 'd1', titulo: 'Cédula' }], entregadoEn: '2026-09-24T10:00:00Z' } })) {
      await repo.agregar(r)
      await repo.agregar(r)
    }
    const lista = await repo.listar('1012345678')
    assert.equal(lista.length, 1)
    assert.deepEqual([lista[0].accion, lista[0].destino], ['envio', 'correo:tramites@entidad.co'])
    await db.dropDatabase()
  } finally { await cliente.close() }
})
