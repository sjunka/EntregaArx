import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificadorFirmas } from '../src/firma.js'
import { ErrorCustodia } from '../src/custodia.js'

// HU-05 · recepción de Certificado. RF-03.2, RF-03.3, RNF-05.
const OPERADOR = 'Mi Carpeta Segura'
const llaves = async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  return { privateKey, jwks: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] }) }
}
const universidad = await llaves()
const intruso = await llaves()

const META = { emisor: 'universidad-demo', idExterno: 'dip-001', cedula: '1012345678', titulo: 'Diploma de Ingeniería', sha256: 'a'.repeat(64) }
const firmar = (claims = META, { llave = universidad.privateKey, iss = 'universidad-demo' } = {}) => {
  const { emisor, ...resto } = claims
  return new CompactSign(new TextEncoder().encode(JSON.stringify({ iss, idExterno: resto.idExterno, cedula: resto.cedula, titulo: resto.titulo, sha256: resto.sha256 })))
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)
}
const EMISION = async (extra = {}, opciones) => ({ ...META, tipo: 'application/pdf', tamano: 2000, firma: await firmar({ ...META, ...extra }, opciones), ...extra })

const ID = '11111111-1111-4111-8111-111111111111'
function falsos({ afiliado = { afiliado: true, operador: OPERADOR }, existente = false, estado = 'recibido', verificacion } = {}) {
  const f = { registros: [], verificados: [], eventos: [] }
  f.custodia = {
    registrar: async (c) => {
      f.registros.push(c)
      const rechazado = !c.firmaValida
      return { documento: { id: ID, estado: rechazado ? 'rechazado' : estado, motivo: c.motivo }, existente, urlCarga: rechazado ? undefined : 'http://almacen/certificados/x?firma=1' }
    },
    verificar: async (id) => { f.verificados.push(id); if (verificacion instanceof Error) throw verificacion; return verificacion ?? { documento: { id, estado: 'vigente', clase: 'certificado', titulo: META.titulo, emisor: 'universidad-demo', creado: '2026-09-24T10:00:00Z', titular: META.cedula }, cambio: true } },
  }
  f.pasarela = { consultar: async (c) => { if (afiliado instanceof Error) throw afiliado; return afiliado } }
  f.bandeja = { encolar: async (...a) => { f.eventos.push(a) } }
  return f
}

async function con(f, prueba) {
  const app = crearApp({
    custodia: f.custodia, pasarela: f.pasarela, bandeja: f.bandeja, operador: OPERADOR,
    firmas: crearVerificadorFirmas({ emisores: new Map([['universidad-demo', universidad.jwks]]) }),
  })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const pedir = async (ruta, cuerpo, metodo = 'POST') => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}

test('firma válida: se registra en la custodia y devuelve la URL de carga', async () => {
  const f = falsos()
  await con(f, async (pedir) => {
    const r = await pedir('/api/documentos', await EMISION())
    assert.equal(r.status, 201)
    assert.deepEqual(r.cuerpo, { id: ID, estado: 'recibido', urlCarga: 'http://almacen/certificados/x?firma=1' })
    assert.equal(f.registros.length, 1)
    assert.deepEqual(f.registros[0], { ...META, tipo: 'application/pdf', tamano: 2000, firmaValida: true })
  })
})

for (const [caso, hacer] of [
  ['firmada con otra llave', () => EMISION({}, { llave: intruso.privateKey })],
  ['con el emisor de la firma distinto', () => EMISION({}, { iss: 'otra-entidad' })],
  ['con el sha256 alterado después de firmar', async () => ({ ...(await EMISION()), sha256: 'b'.repeat(64) })],
  ['con la cédula cambiada después de firmar', async () => ({ ...(await EMISION()), cedula: '2000000002' })],
  ['con el título cambiado después de firmar', async () => ({ ...(await EMISION()), titulo: 'Otro título' })],
  ['con una firma que no es un JWS', async () => ({ ...(await EMISION()), firma: 'basura' })],
]) {
  test(`firma inválida (${caso}): Rechazado, 422 con el motivo y ningún archivo`, async () => {
    const f = falsos()
    await con(f, async (pedir) => {
      const r = await pedir('/api/documentos', await hacer())
      assert.equal(r.status, 422)
      assert.match(r.tipo, /problem\+json/)
      assert.equal(r.cuerpo.estado, 'rechazado')
      assert.equal(r.cuerpo.id, ID)
      assert.ok(r.cuerpo.detail.length > 10)
      assert.equal(f.registros[0].firmaValida, false)
      assert.equal(r.cuerpo.urlCarga, undefined)
      assert.deepEqual(f.eventos, [])
    })
  })
}

test('emisor sin llave registrada: 403 y no se guarda nada', async () => {
  const f = falsos()
  await con(f, async (pedir) => {
    const r = await pedir('/api/documentos', { ...(await EMISION()), emisor: 'desconocida' })
    assert.equal(r.status, 403)
    assert.deepEqual(f.registros, [])
  })
})

test('destinatario no afiliado a este operador: 422; centralizador caído: 503', async () => {
  for (const [afiliado, esperado] of [
    [{ afiliado: false, operador: null }, 422], [{ afiliado: true, operador: 'Otro Operador' }, 422], [new Error('caído'), 503],
  ]) {
    const f = falsos({ afiliado })
    await con(f, async (pedir) => {
      const r = await pedir('/api/documentos', await EMISION())
      assert.equal(r.status, esperado)
      assert.match(r.tipo, /problem\+json/)
      assert.deepEqual(f.registros, [])
    })
  }
})

test('reenvío idempotente: 200 con el mismo documento', async () => {
  const f = falsos({ existente: true })
  await con(f, async (pedir) => {
    const r = await pedir('/api/documentos', await EMISION())
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.id, ID)
  })
})

for (const [caso, cambio] of [
  ['tipo no permitido', { tipo: 'application/zip' }], ['tamaño excesivo', { tamano: 10 * 1024 * 1024 + 1 }], ['sin firma', { firma: '' }],
  ['cédula inválida', { cedula: '12a' }], ['sha256 mal formado', { sha256: 'xyz' }], ['sin idExterno', { idExterno: '' }],
]) {
  test(`metadatos inválidos (${caso}): 422 sin tocar la custodia`, async () => {
    const f = falsos()
    await con(f, async (pedir) => {
      const r = await pedir('/api/documentos', { ...(await EMISION()), ...cambio })
      assert.equal(r.status, 422)
      assert.deepEqual(f.registros, [])
    })
  })
}

test('un cuerpo grande se rechaza: el binario no viaja por este servicio', async () => {
  await con(falsos(), async (pedir) => {
    const r = await pedir('/api/documentos', JSON.stringify({ ...(await EMISION()), contenido: 'x'.repeat(8000) }))
    assert.equal(r.status, 413)
    assert.match(r.tipo, /problem\+json/)
  })
})

const compilar = async () => {
  const ajv = addFormats(new Ajv({ strict: true }), ['uuid', 'email', 'date-time'])
  ajv.addKeyword('x-cloudevent')
  return ajv.compile(JSON.parse(await readFile(new URL('../../../contratos/eventos/documento-recibido.v1.schema.json', import.meta.url), 'utf8')))
}

test('confirmación: el Certificado queda Vigente y se encola un evento que cumple el contrato', async () => {
  const f = falsos({ verificacion: { documento: { id: ID, estado: 'vigente', clase: 'certificado', titulo: 'Diploma de Ingeniería', emisor: 'universidad-demo', titular: '1012345678', creado: '2026-09-24T10:00:00Z' }, cambio: true, sustituyeA: '22222222-2222-4222-8222-222222222222' } })
  await con(f, async (pedir) => {
    const r = await pedir(`/api/documentos/${ID}/confirmacion`, '')
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { id: ID, estado: 'vigente', sustituyeA: '22222222-2222-4222-8222-222222222222' })
    assert.equal(f.eventos.length, 1)
    const [nombre, clave, datos, opciones] = f.eventos[0]
    assert.equal(nombre, 'documento.recibido')
    assert.equal(clave, '1012345678')
    assert.deepEqual(opciones, { dedupe: `documento.recibido:${ID}` })
    const validar = await compilar()
    assert.ok(validar(datos), JSON.stringify(validar.errors))
    assert.equal(datos.sustituyeA, '22222222-2222-4222-8222-222222222222')
    assert.equal(datos.emisor, 'universidad-demo')
    assert.equal('contenido' in datos, false)
  })
})

test('confirmar de nuevo un Vigente responde 200 y vuelve a encolar con la misma clave de deduplicación', async () => {
  const f = falsos({ verificacion: { documento: { id: ID, estado: 'vigente', clase: 'certificado', titulo: 'D', emisor: 'universidad-demo', titular: '1012345678', creado: '2026-09-24T10:00:00Z' }, cambio: false } })
  await con(f, async (pedir) => {
    assert.equal((await pedir(`/api/documentos/${ID}/confirmacion`, '')).status, 200)
    assert.equal(f.eventos[0][3].dedupe, `documento.recibido:${ID}`, 'si el primer intento murió antes de encolar, este lo repara')
  })
})

test('confirmación rechazada (hash distinto): 422 con el motivo y sin evento', async () => {
  const f = falsos({ verificacion: { documento: { id: ID, estado: 'rechazado', motivo: 'El SHA-256 del archivo no coincide' }, cambio: false } })
  await con(f, async (pedir) => {
    const r = await pedir(`/api/documentos/${ID}/confirmacion`, '')
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.estado, 'rechazado')
    assert.match(r.cuerpo.detail, /SHA-256/)
    assert.deepEqual(f.eventos, [])
  })
})

test('confirmación: el archivo aún no llegó (409), documento inexistente (404), custodia caída (503)', async () => {
  for (const [error, esperado] of [[new ErrorCustodia(409, 'El archivo aún no llegó'), 409], [new ErrorCustodia(404, 'no existe'), 404], [new Error('ECONNREFUSED'), 503]]) {
    const f = falsos({ verificacion: error })
    await con(f, async (pedir) => {
      const r = await pedir(`/api/documentos/${ID}/confirmacion`, '')
      assert.equal(r.status, esperado)
      assert.match(r.tipo, /problem\+json/)
      assert.deepEqual(f.eventos, [])
    })
  }
  await con(falsos(), async (pedir) => assert.equal((await pedir('/api/documentos/no-es-uuid/confirmacion', '')).status, 404))
})
