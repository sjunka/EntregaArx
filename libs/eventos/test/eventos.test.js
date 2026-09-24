import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { EVENTOS, crearPublicador, iniciarRelevo } from '../eventos.js'

const CARPETA = new URL('../../../contratos/eventos/', import.meta.url)
// Un Ajv por esquema: cada $id se puede registrar una sola vez.
const compilar = (s) => {
  const ajv = addFormats(new Ajv({ strict: true }), ['uuid', 'email', 'date-time'])
  ajv.addKeyword('x-cloudevent')
  return ajv.compile(s)
}
const esquema = async (archivo) => JSON.parse(await readFile(new URL(archivo, CARPETA), 'utf8'))

const EJEMPLOS = {
  'documento.recibido': {
    id: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', clase: 'certificado', titulo: 'Diploma de ingeniería',
    emisor: 'universidad-demo', sustituyeA: '22222222-2222-4222-8222-222222222222', recibidoEn: '2026-09-24T10:00:00Z',
  },
  'documento.cargado': { id: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', clase: 'temporal', titulo: 'Cédula', tipo: 'application/pdf', tamano: 2048, creadoEn: '2026-09-24T10:00:00Z' },
  'documento.autenticado': { id: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', autenticadoEn: '2026-09-24T10:00:00Z' },
  'documento.eliminado': { id: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', eliminadoEn: '2026-09-24T10:00:00Z' },
  'acceso.registrado': { documentoId: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', titulo: 'Cédula', accion: 'descarga', actor: { tipo: 'titular', id: '1012345678' }, ocurridoEn: '2026-09-24T10:00:00Z' },
  'ciudadano.afiliado': { cedula: '1012345678', cuenta: 'ana.gil.45678@carpetacolombia.co', correoContacto: 'ana@correo.co', telefono: '3001234567', afiliadoEn: '2026-09-24T10:00:00Z' },
}

test('contrato: cada esquema de contratos/eventos es JSON Schema válido y coincide con EVENTOS', async () => {
  const archivos = (await readdir(CARPETA)).filter((f) => f.endsWith('.schema.json'))
  assert.equal(archivos.length, Object.keys(EVENTOS).length)
  for (const archivo of archivos) {
    const s = await esquema(archivo)
    const validar = compilar(s) // falla si el esquema no es válido
    const [nombre, def] = Object.entries(EVENTOS).find(([, d]) => d.tipo === s['x-cloudevent'].type)
    assert.deepEqual({ ...def }, { tipo: s['x-cloudevent'].type, fuente: s['x-cloudevent'].source, tema: s['x-cloudevent'].tema, sujeto: s['x-cloudevent'].sujetoRegistro })
    assert.ok(validar(EJEMPLOS[nombre]), JSON.stringify(validar.errors))
  }
})

test('contrato: un evento con campos de más o con formato malo no valida', async () => {
  const doc = compilar(await esquema('documento-recibido.v1.schema.json'))
  assert.equal(doc({ ...EJEMPLOS['documento.recibido'], contenido: 'AAAA' }), false, 'nunca contenido documental')
  assert.equal(doc({ ...EJEMPLOS['documento.recibido'], cedula: '12a' }), false)
  assert.equal(doc({ ...EJEMPLOS['documento.recibido'], clase: 'temporal' }), false)
  const acc = compilar(await esquema('acceso-registrado.v1.schema.json'))
  assert.equal(acc({ ...EJEMPLOS['acceso.registrado'], accion: 'borrado' }), false, 'la bitácora solo registra lecturas')
  assert.equal(acc({ ...EJEMPLOS['acceso.registrado'], actor: { tipo: 'titular' } }), false)
  const cargado = compilar(await esquema('documento-cargado.v1.schema.json'))
  assert.equal(cargado({ ...EJEMPLOS['documento.cargado'], tipo: 'text/html' }), false)
  const afil = compilar(await esquema('ciudadano-afiliado.v1.schema.json'))
  assert.equal(afil({ ...EJEMPLOS['ciudadano.afiliado'], telefono: '6011234567' }), false)
})

function falsos() {
  const enviados = []
  return {
    enviados,
    productor: { send: async (m) => { enviados.push(m) } },
    registro: { getLatestSchemaId: async () => 7, encode: async (id, datos) => Buffer.from(JSON.stringify({ id, datos })) },
  }
}

test('el publicador emite un CloudEvent 1.0 en modo binario con su esquema registrado', async () => {
  const { productor, registro, enviados } = falsos()
  const publicar = crearPublicador({ productor, registro, urlRegistro: 'http://schema-registry:8081' })
  await publicar({ evento_id: 'e-1', nombre: 'documento.recibido', clave: '1012345678', datos: EJEMPLOS['documento.recibido'], creado: new Date('2026-09-24T10:00:01Z') })
  const [{ topic, messages: [m] }] = enviados
  assert.equal(topic, 'mcs.documento.recibido')
  assert.equal(m.key, '1012345678')
  assert.deepEqual(m.headers, {
    ce_specversion: '1.0', ce_id: 'e-1', ce_type: 'co.carpetasegura.documento.recibido', ce_source: '/mcs/interoperabilidad',
    ce_subject: 'documento/1012345678', ce_time: '2026-09-24T10:00:01.000Z', ce_dataschema: 'http://schema-registry:8081/schemas/ids/7',
    'content-type': 'application/json',
  })
  assert.equal(JSON.parse(m.value).id, 7, 'la data sale serializada con el id de esquema del registro')
})

test('un evento inválido para el registro no sale', async () => {
  const { productor, enviados } = falsos()
  const registro = { getLatestSchemaId: async () => 7, encode: async () => { throw new Error('no cumple el esquema') } }
  await assert.rejects(crearPublicador({ productor, registro })({ evento_id: 'e', nombre: 'documento.recibido', clave: '1', datos: {} }), /esquema/)
  assert.equal(enviados.length, 0)
  await assert.rejects(crearPublicador({ productor, registro })({ evento_id: 'e', nombre: 'otro.evento', clave: '1', datos: {} }), /desconocido/)
})

test('el relevo vacía la bandeja, reintenta tras un fallo y se detiene', async () => {
  const lotes = [new Error('kafka caído'), 2, 0, 0, 0]
  let llamadas = 0
  const bandeja = { drenar: async () => { llamadas++; const v = lotes.shift(); if (v instanceof Error) throw v; return v ?? 0 } }
  const avisos = []
  const parar = iniciarRelevo({ bandeja, publicar: async () => {}, intervaloMs: 5, log: (n, m) => avisos.push(m) })
  await new Promise((ok) => setTimeout(ok, 80))
  parar()
  assert.ok(llamadas >= 3)
  assert.equal(avisos.length, 1)
  const antes = llamadas
  await new Promise((ok) => setTimeout(ok, 30))
  assert.ok(llamadas <= antes + 1, 'después de parar no sigue')
})
