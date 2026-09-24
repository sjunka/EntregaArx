import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { MongoClient } from 'mongodb'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { crearAnonimizador } from '../src/anonimizar.js'
import { armarTablero } from '../src/tablero.js'
import { crearRepo } from '../src/mongo.js'

// HU-12 · MS-10 analítica anonimizada. RF-08.1 solo metadatos, RF-08.2 sin identidad, RF-08.6 tablero, RNF-15 privacidad.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const token = ({ aud = 'analitica', azp = 'portal', ...claims } = { analista: true }) =>
  new SignJWT({ azp, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)

const REGIONES = new Map([['universidad-demo', 'Bogotá D.C.'], ['universidad-caribe', 'Atlántico']])
const evento = (extra = {}) => ({
  id: 'ce-1', datos: {
    id: '2b1f3f6e-9d1c-4a52-8f43-0d5e4f6a7b8c', cedula: '1012345678', clase: 'certificado', titulo: 'Diploma de bachiller',
    emisor: 'universidad-demo', recibidoEn: '2026-09-24T10:00:00Z', ...extra,
  },
})

test('anonimizar guarda solo institución, región y año: nada que identifique al ciudadano ni al documento', () => {
  const r = crearAnonimizador({ regiones: REGIONES, sal: 's' })(evento())
  assert.deepEqual(Object.keys(r).sort(), ['anio', 'emisor', 'h', 'region'])
  assert.deepEqual([r.emisor, r.region, r.anio], ['universidad-demo', 'Bogotá D.C.', 2026])
  const texto = JSON.stringify(r)
  for (const dato of ['1012345678', 'Diploma', '2b1f3f6e', 'ce-1']) assert.ok(!texto.includes(dato), `no debe contener ${dato}`)
})

test('anonimizar: el año es el de Colombia y la llave de deduplicación depende de la sal', () => {
  const a = crearAnonimizador({ regiones: REGIONES, sal: 'a' })
  const b = crearAnonimizador({ regiones: REGIONES, sal: 'b' })
  assert.equal(a(evento({ recibidoEn: '2027-01-01T03:00:00Z' })).anio, 2026) // 31 dic 22:00 en Colombia
  assert.equal(a(evento()).h, a(evento()).h)
  assert.notEqual(a(evento()).h, b(evento()).h)
})

test('anonimizar ignora a un emisor sin región registrada', () => {
  assert.equal(crearAnonimizador({ regiones: REGIONES, sal: 's' })(evento({ emisor: 'otra-entidad' })), null)
})

test('armarTablero suprime las celdas bajo el umbral y no publica el total', () => {
  const t = armarTablero({ celdas: [{ region: 'Bogotá D.C.', total: 12 }, { region: 'Atlántico', total: 3 }], anios: [2026], corte: new Date('2026-09-24T10:00:00Z'), umbral: 10 })
  assert.deepEqual(t.regiones, [{ region: 'Atlántico', diplomas: null, suprimido: true }, { region: 'Bogotá D.C.', diplomas: 12, suprimido: false }])
  assert.equal(t.corte, '2026-09-24T10:00:00.000Z')
  assert.equal(t.umbral, 10)
  assert.equal('total' in t, false)
})

const TABLERO = { corte: null, umbral: 10, anios: [], regiones: [] }
async function pedir(ruta, { t, repo = { celdas: async () => [], anios: async () => [], corte: async () => null }, umbral = 10 } = {}) {
  const srv = crearApp({ repo, umbral, verificar: crearVerificador({ issuer: EMISOR, jwks }) }).listen(0)
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, { headers: t === null ? {} : { authorization: `Bearer ${t ?? await token()}` } })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  } finally { srv.close() }
}

test('GET /tableros/diplomas devuelve el conteo por región con la fecha de corte', async () => {
  const filtros = []
  const repo = { celdas: async (f) => { filtros.push(f); return [{ region: 'Bogotá D.C.', total: 14 }] }, anios: async () => [2026], corte: async () => new Date('2026-09-24T10:00:00Z') }
  const r = await pedir('/tableros/diplomas?anio=2026&region=Bogot%C3%A1%20D.C.', { repo })
  assert.equal(r.status, 200)
  assert.deepEqual(r.cuerpo, { corte: '2026-09-24T10:00:00.000Z', umbral: 10, anios: [2026], regiones: [{ region: 'Bogotá D.C.', diplomas: 14, suprimido: false }] })
  assert.deepEqual(filtros, [{ anio: 2026, region: 'Bogotá D.C.' }])
  assert.deepEqual((await pedir('/tableros/diplomas')).cuerpo, TABLERO)
})

test('solo el rol analista: un token de otra audiencia recibe 401 y uno válido sin el claim, 403', async () => {
  assert.equal((await pedir('/tableros/diplomas', { t: null })).status, 401)
  assert.equal((await pedir('/tableros/diplomas', { t: await token({ aud: 'custodia', analista: true }) })).status, 401)
  for (const t of [await token({}), await token({ analista: true, azp: 'otro' })]) {
    const r = await pedir('/tableros/diplomas', { t })
    assert.equal(r.status, 403)
    assert.match(r.tipo, /problem\+json/)
  }
})

test('filtros mal formados: 422 problem+json', async () => {
  for (const q of ['anio=abc', 'anio=1999', 'anio=2026&anio=2027', 'region=' + 'x'.repeat(81)]) {
    const r = await pedir(`/tableros/diplomas?${q}`)
    assert.equal(r.status, 422, q)
    assert.match(r.tipo, /problem\+json/)
  }
})

test('el repositorio solo agrega y consulta; nada que cambie o borre', () => {
  assert.deepEqual(Object.keys(crearRepo({ collection: () => ({}) })).sort(), ['agregar', 'anios', 'celdas', 'corte', 'indices'])
})

// Contra un MongoDB real: MONGO_URL_TEST=mongodb://localhost:27018 npm test (se omite sin él).
test('el almacén agrega una sola vez por evento, cuenta por región con filtros y no guarda identidad', { skip: !process.env.MONGO_URL_TEST }, async () => {
  const cliente = await new MongoClient(process.env.MONGO_URL_TEST).connect()
  try {
    const db = cliente.db('analitica_test')
    await db.dropDatabase()
    const repo = crearRepo(db)
    await repo.indices()
    const anon = crearAnonimizador({ regiones: REGIONES, sal: 's' })
    const evs = [evento(), evento(), { id: 'ce-2', datos: { ...evento().datos, emisor: 'universidad-caribe' } }, { id: 'ce-3', datos: { ...evento().datos, recibidoEn: '2025-03-01T10:00:00Z' } }]
    for (const e of evs) await repo.agregar(anon(e)) // el primero llega repetido
    for (const e of evs.slice(2)) await repo.agregar(anon(e))
    const por = (r) => Object.fromEntries(r.map((c) => [c.region, c.total]))
    assert.deepEqual(por(await repo.celdas({})), { 'Bogotá D.C.': 2, Atlántico: 1 }) // ce-1 llegó dos veces y cuenta una
    assert.deepEqual(por(await repo.celdas({ anio: 2026 })), { 'Bogotá D.C.': 1, Atlántico: 1 })
    assert.deepEqual(por(await repo.celdas({ region: 'Atlántico' })), { Atlántico: 1 })
    assert.deepEqual(await repo.anios(), [2025, 2026])
    assert.ok((await repo.corte()) instanceof Date)
    const guardado = await db.collection('diplomas').findOne({})
    assert.deepEqual(Object.keys(guardado).sort(), ['_id', 'anio', 'emisor', 'h', 'region', 'registradoEn'])
    await db.dropDatabase()
  } finally { await cliente.close() }
})
