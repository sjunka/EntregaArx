import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificadorFirmas } from '../src/firma.js'
import { ErrorAutorizaciones } from '../src/autorizaciones.js'
import { ErrorCustodia } from '../src/custodia.js'

// HU-07 · la entidad pide documentos y, con la autorización del ciudadano, los recibe como URL de corta vida.
// RF-04.3, RF-04.4, RI-08. La entidad se autentica firmando, como en HU-05 (ADR-0017).
const OPERADOR = 'Mi Carpeta Segura'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const intruso = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const firmar = (claims, llave = privateKey) => new CompactSign(new TextEncoder().encode(JSON.stringify(claims))).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)

const PETICION = { emisor: 'universidad-demo', idExterno: 'pet-001', cedula: '1012345678', proposito: 'Verificar tus estudios', documentos: [{ titulo: 'Diploma' }, { titulo: 'Certificado laboral' }] }
const firmaDe = (p = PETICION, llave) => firmar({ iss: p.emisor, idExterno: p.idExterno, cedula: p.cedula, proposito: p.proposito, pedidos: p.documentos.map((d) => d.titulo) }, llave)
const token = (extra = {}, llave) => {
  const t = Math.floor(Date.now() / 1000)
  return firmar({ iss: 'universidad-demo', iat: t, exp: t + 120, ...extra }, llave)
}
const ID = '11111111-1111-4111-8111-111111111111'
const D1 = '22222222-2222-4222-8222-222222222222'
const D2 = '33333333-3333-4333-8333-333333333333'

function falsos({ afiliado = { afiliado: true, operador: OPERADOR }, consulta = { id: ID, estado: 'atendida', autorizaciones: [{ id: 'a1', documentoId: D1, venceEn: 'x' }, { id: 'a2', documentoId: D2, venceEn: 'x' }] }, lectura } = {}) {
  const f = { peticiones: [], consultas: [], lecturas: [] }
  f.autorizaciones = {
    crearPeticion: async (p) => { f.peticiones.push(p); return { id: ID, estado: 'pendiente', existente: false } },
    consultarPeticion: async (id, entidad) => { f.consultas.push([id, entidad]); if (consulta instanceof Error) throw consulta; return consulta },
  }
  f.custodia = {
    leer: async (l) => {
      f.lecturas.push(l)
      if (lectura) return lectura(l)
      return { url: `https://almacen.test/${l.documentoId}?firma=1`, venceEn: '2026-09-24T10:05:00.000Z', titulo: l.documentoId === D1 ? 'Diploma' : 'Certificado laboral' }
    },
  }
  f.pasarela = { consultar: async () => { if (afiliado instanceof Error) throw afiliado; return afiliado } }
  return f
}

async function con(f, prueba) {
  const app = crearApp({
    custodia: f.custodia, autorizaciones: f.autorizaciones, pasarela: f.pasarela, bandeja: { encolar: async () => {} }, operador: OPERADOR,
    firmas: crearVerificadorFirmas({ emisores: new Map([['universidad-demo', jwks]]) }),
  })
  const srv = app.listen(0)
  const pedir = async (ruta, { metodo = 'GET', cuerpo, bearer } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, headers: { ...(cuerpo && { 'content-type': 'application/json' }), ...(bearer && { authorization: `Bearer ${bearer}` }) }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const crear = async (pedir, cambio = {}) => {
  const p = { ...PETICION, ...cambio }
  return pedir('/api/peticiones', { metodo: 'POST', cuerpo: { ...p, firma: cambio.firma ?? await firmaDe(p) } })
}

test('firma válida: la petición llega a autorizaciones con lo que se pide y para qué, y queda pendiente', async () => {
  const f = falsos()
  await con(f, async (pedir) => {
    const r = await crear(pedir)
    assert.equal(r.status, 201)
    assert.deepEqual(r.cuerpo, { id: ID, estado: 'pendiente' })
    assert.deepEqual(f.peticiones, [{ entidad: 'universidad-demo', idExterno: 'pet-001', cedula: '1012345678', proposito: 'Verificar tus estudios', pedidos: [{ titulo: 'Diploma' }, { titulo: 'Certificado laboral' }] }])
  })
})

test('reenvío idempotente: responde 200 con la misma petición', async () => {
  const f = falsos()
  f.autorizaciones.crearPeticion = async () => ({ id: ID, estado: 'pendiente', existente: true })
  await con(f, async (pedir) => assert.equal((await crear(pedir)).status, 200))
})

test('firma inválida, de otra llave o que no cubre un campo: 401 y no se guarda nada', async () => {
  const f = falsos()
  await con(f, async (pedir) => {
    assert.equal((await crear(pedir, { firma: await firmaDe(PETICION, intruso.privateKey) })).status, 401)
    const alterada = await crear(pedir, { firma: await firmaDe({ ...PETICION, proposito: 'Otro propósito' }) })
    assert.equal(alterada.status, 401)
    assert.match(alterada.cuerpo.detail, /proposito/)
    assert.equal((await crear(pedir, { documentos: [{ titulo: 'Diploma' }, { titulo: 'Cédula' }], firma: await firmaDe(PETICION) })).status, 401, 'los documentos pedidos también van firmados')
    assert.match((await crear(pedir, { firma: 'no.es.jws' })).tipo, /problem\+json/)
  })
  assert.equal(f.peticiones.length, 0)
})

test('entidad sin llave registrada: 403; destinatario no afiliado: 422; centralizador caído: 503', async () => {
  await con(falsos(), async (pedir) => assert.equal((await crear(pedir, { emisor: 'entidad-desconocida' })).status, 403))
  const f = falsos({ afiliado: { afiliado: true, operador: 'Operador Ciudadano' } })
  await con(f, async (pedir) => {
    assert.equal((await crear(pedir)).status, 422)
    assert.equal(f.peticiones.length, 0)
  })
  await con(falsos({ afiliado: new Error('caído') }), async (pedir) => assert.equal((await crear(pedir)).status, 503))
})

for (const [caso, cambio] of [['sin propósito', { proposito: '' }], ['sin documentos', { documentos: [] }], ['cédula inválida', { cedula: 'abc' }], ['pedido sin título', { documentos: [{ titulo: '' }] }]]) {
  test(`petición inválida (${caso}): 422 en problem+json`, async () => {
    await con(falsos(), async (pedir) => {
      const r = await crear(pedir, cambio)
      assert.equal(r.status, 422)
      assert.match(r.tipo, /problem\+json/)
    })
  })
}

test('con la petición atendida, la entidad recibe solo lo autorizado, como URL de corta vida que pide la custodia por tercero', async () => {
  const f = falsos({ consulta: { id: ID, estado: 'atendida', autorizaciones: [{ id: 'a1', documentoId: D1, venceEn: 'x' }] } })
  await con(f, async (pedir) => {
    const r = await pedir(`/api/peticiones/${ID}`, { bearer: await token() })
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { id: ID, estado: 'atendida', documentos: [{ id: D1, titulo: 'Diploma', url: `https://almacen.test/${D1}?firma=1`, venceEn: '2026-09-24T10:05:00.000Z' }] })
    assert.deepEqual(f.consultas, [[ID, 'universidad-demo']])
    assert.deepEqual(f.lecturas, [{ documentoId: D1, tercero: 'entidad:universidad-demo' }])
  })
})

test('pendiente o rechazada: sin documentos y sin detalle de la carpeta', async () => {
  for (const estado of ['pendiente', 'rechazada']) {
    const f = falsos({ consulta: { id: ID, estado, autorizaciones: [] } })
    await con(f, async (pedir) => {
      const r = await pedir(`/api/peticiones/${ID}`, { bearer: await token() })
      assert.deepEqual(r.cuerpo, { id: ID, estado, documentos: [] })
      assert.equal(f.lecturas.length, 0)
    })
  }
})

test('una autorización revocada entre la consulta y la lectura (403 de la custodia) se omite; si la custodia falla, 503', async () => {
  const revocada = falsos({ lectura: (l) => { if (l.documentoId === D1) throw new ErrorCustodia(403, 'Sin autorización vigente'); return { url: 'https://a.test/2', venceEn: 'v', titulo: 'Certificado laboral' } } })
  await con(revocada, async (pedir) => {
    const r = await pedir(`/api/peticiones/${ID}`, { bearer: await token() })
    assert.deepEqual(r.cuerpo.documentos.map((d) => d.id), [D2])
  })
  const caida = falsos({ lectura: () => { throw new ErrorCustodia(503, 'no responde') } })
  await con(caida, async (pedir) => assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token() })).status, 503))
})

test('la consulta exige el token firmado de la entidad y solo entrega sus propias peticiones', async () => {
  await con(falsos(), async (pedir) => {
    assert.equal((await pedir(`/api/peticiones/${ID}`)).status, 401)
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: 'no-es-un-jws' })).status, 401)
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token({}, intruso.privateKey) })).status, 401)
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token({ exp: Math.floor(Date.now() / 1000) - 10 }) })).status, 401, 'vencido')
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token({ exp: Math.floor(Date.now() / 1000) + 3600 }) })).status, 401, 'vive más de 5 minutos')
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token({ iss: 'otra-entidad' }) })).status, 401, 'iss sin llave registrada')
  })
  await con(falsos({ consulta: new ErrorAutorizaciones(404, 'no existe') }), async (pedir) => {
    assert.equal((await pedir(`/api/peticiones/${ID}`, { bearer: await token() })).status, 404)
    assert.equal((await pedir('/api/peticiones/no-es-uuid', { bearer: await token() })).status, 404)
  })
})
