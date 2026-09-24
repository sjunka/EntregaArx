import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { CompactSign, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { crearVerificadorFirmas } from '../src/firma.js'
import { crearProcesador, MAX_INTENTOS_DOCUMENTO, rutasTraslados } from '../src/traslados.js'
import { ErrorAfiliacion } from '../src/afiliacion.js'
import { ErrorCustodia } from '../src/custodia.js'

// HU-09 · Traslado de entrada: MS-07 recibe transferCitizen, orquesta la descarga de cada documento (idempotente y con
// reintento), registra la afiliación solo con la Carpeta completa y confirma al origen. RF-01.8, RF-03.3, RF-03.5, RF-03.8, RI-03, RNF-22.
const OPERADOR = 'Mi Carpeta Segura'
const EMISOR = 'http://localhost:8081/realms/carpeta'
const SPA = 'http://localhost:4173'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const intruso = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const firmar = (claims, llave = privateKey) => new CompactSign(new TextEncoder().encode(JSON.stringify(claims))).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)
const tokenCiudadano = (cedula = '1012345678') => new SignJWT({ azp: 'portal', cedula }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('interoperabilidad').setIssuedAt().setExpirationTime('5m').sign(privateKey)

const sha = (n) => String(n).repeat(64).slice(0, 64)
const DOCS = [
  { idExterno: 'a1', titulo: 'Cédula', clase: 'temporal', tipo: 'application/pdf', tamano: 100, sha256: sha(1), url: 'https://origen.test/d/a1?firma=1' },
  { idExterno: 'a2', titulo: 'Diploma', clase: 'certificado', emisor: 'universidad-original', tipo: 'application/pdf', tamano: 200, sha256: sha(2), url: 'https://origen.test/d/a2?firma=1' },
  { idExterno: 'a3', titulo: 'Recibo', clase: 'temporal', tipo: 'image/png', tamano: 300, sha256: sha(3), url: 'https://origen.test/d/a3?firma=1' },
]
const TRASLADO = {
  operador: 'operador-origen', id: '1012345678', nombre: 'Ana', apellido: 'Gil', direccion: 'Calle 10 # 20-30, Bogotá', correo: 'ana.gil.45678@carpetacolombia.co',
  correoContacto: 'ana@correo.co', telefono: '3001234567', confirmAPI: 'https://origen.test/api/transferCitizenConfirm', documentos: DOCS,
}
const firmaDe = (t = TRASLADO, llave) => firmar({ iss: t.operador, id: t.id, confirmAPI: t.confirmAPI, sha256: t.documentos.map((d) => d.sha256) }, llave)

// Doble en memoria del repositorio Postgres (src/traslados.js), con el mismo contrato y un reloj que la prueba controla.
function repoEnMemoria(reloj) {
  const filas = new Map()
  const docs = new Map()
  return {
    filas, docs,
    async crear(t) {
      const previo = [...filas.values()].find((x) => x.operador === t.operador && x.cedula === t.cedula && x.estado !== 'fallido')
      if (previo) return { traslado: previo, existente: true }
      filas.set(t.id, { estado: 'en-curso', recibidos: 0, siguiente: reloj.ahora, creado: reloj.ahora, confirmadoEn: null, intentosCompletar: 0, intentosConfirmacion: 0, ...t, total: t.documentos.length })
      docs.set(t.id, t.documentos.map((d) => ({ ...d, estado: 'pendiente', intentos: 0 })))
      return { traslado: filas.get(t.id), existente: false }
    },
    obtener: async (id) => filas.get(id) ?? null,
    activoDe: async (operador, cedula) => [...filas.values()].find((x) => x.operador === operador && x.cedula === cedula && x.estado !== 'fallido') ?? null,
    ultimoDe: async (cedula) => [...filas.values()].filter((t) => t.cedula === cedula).sort((a, b) => b.creado - a.creado)[0] ?? null,
    documentos: async (id) => docs.get(id).map((d) => ({ ...d })),
    async reclamar() {
      const t = [...filas.values()].find((x) => (x.estado === 'en-curso' || (['completo', 'fallido'].includes(x.estado) && !x.confirmadoEn)) && x.siguiente <= reloj.ahora)
      if (!t) return null
      t.siguiente = new Date(reloj.ahora.getTime() + 300_000)
      return { ...t }
    },
    async documentoRecibido(id, idExterno) { docs.get(id).find((d) => d.idExterno === idExterno).estado = 'recibido'; filas.get(id).recibidos++ },
    async documentoFallo(id, idExterno) { const d = docs.get(id).find((x) => x.idExterno === idExterno); return ++d.intentos },
    async programar(id, siguiente) { filas.get(id).siguiente = siguiente },
    async falloCompletar(id, siguiente) { const t = filas.get(id); t.intentosCompletar++; t.siguiente = siguiente; return t.intentosCompletar },
    async completo(id) { Object.assign(filas.get(id), { estado: 'completo', completadoEn: reloj.ahora }) },
    async fallido(id, motivo) { Object.assign(filas.get(id), { estado: 'fallido', error: motivo }) },
    async confirmado(id) { filas.get(id).confirmadoEn = reloj.ahora },
    async falloConfirmacion(id, siguiente) { const t = filas.get(id); t.intentosConfirmacion++; t.siguiente = siguiente; return t.intentosConfirmacion },
  }
}

function montar({ centralizador = { afiliado: false, operador: null } } = {}) {
  const reloj = { ahora: new Date('2026-09-24T10:00:00Z') }
  const f = { reloj, repo: repoEnMemoria(reloj), orden: [], recibidos: [], confirmaciones: [], descartes: [], cancelaciones: [], iniciados: [], enlaces: new Map(), fallas: new Map(), confirmarFalla: 0, completarFalla: [] }
  f.pasarela = { consultar: async () => { if (centralizador instanceof Error) throw centralizador; return centralizador } }
  f.afiliacion = {
    // Idempotente por cédula, como MS-03: devuelve el mismo enlace.
    iniciar: async (c) => { f.iniciados.push(c); if (f.iniciarError) throw f.iniciarError; if (!f.enlaces.has(c.cedula)) f.enlaces.set(c.cedula, `${randomUUID()}.${'m'.repeat(32)}`); return { activacion: f.enlaces.get(c.cedula), venceEn: 'v' } },
    completar: async (cedula) => { f.orden.push('completar'); const e = f.completarFalla.shift(); if (e) throw e; return { estado: 'afiliado' } },
    cancelar: async (cedula) => { f.orden.push('cancelar'); f.cancelaciones.push(cedula) },
  }
  f.custodia = {
    recibirTraslado: async (d) => {
      f.orden.push(`recibir:${d.idExterno}`)
      f.recibidos.push(d)
      const n = f.fallas.get(d.idExterno) ?? 0
      if (n > 0) { f.fallas.set(d.idExterno, n - 1); throw new ErrorCustodia(502, 'El origen no respondió') }
      return { documento: { id: randomUUID() } }
    },
    descartarTraslado: async (d) => { f.orden.push('descartar'); f.descartes.push(d) },
  }
  f.confirmar = async (url, cuerpo) => { f.orden.push(`confirmar:${cuerpo.req_status}`); if (f.confirmarFalla-- > 0) throw new Error('el origen no responde'); f.confirmaciones.push({ url, ...cuerpo }) }
  f.procesador = crearProcesador({ repo: f.repo, custodia: f.custodia, afiliacion: f.afiliacion, confirmar: f.confirmar, ahora: () => reloj.ahora })
  const traslados = rutasTraslados({
    firmas: crearVerificadorFirmas({ emisores: new Map([['operador-origen', jwks]]) }), pasarela: f.pasarela, afiliacion: f.afiliacion, repo: f.repo,
    verificar: crearVerificador({ issuer: EMISOR, jwks }), spaUrl: SPA, operador: OPERADOR, hostsInternos: [],
    resolver: async (host) => [{ address: isIP(host) ? host : '93.184.216.34' }], // los nombres de prueba resuelven a una dirección pública
  })
  f.app = () => crearApp({ traslados, custodia: {}, autorizaciones: {}, pasarela: f.pasarela, bandeja: { encolar: async () => {} }, firmas: crearVerificadorFirmas({ emisores: new Map() }), operador: OPERADOR })
  f.avanzar = async (ms = 0) => { reloj.ahora = new Date(reloj.ahora.getTime() + ms); await f.procesador.pendientes() }
  return f
}

async function con(f, prueba) {
  const srv = f.app().listen(0)
  const pedir = async (ruta, { metodo = 'GET', cuerpo, t } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, headers: { ...(cuerpo && { 'content-type': 'application/json' }), ...(t && { authorization: `Bearer ${t}` }) }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const transferir = async (pedir, cambio = {}) => {
  const t = { ...TRASLADO, ...cambio }
  return pedir('/api/transferCitizen', { metodo: 'POST', cuerpo: { ...t, firma: cambio.firma ?? await firmaDe(t) } })
}

test('recibe el traslado firmado: crea la cuenta por MS-03, deja el traslado en curso y devuelve el enlace de activación', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const r = await transferir(pedir)
    assert.equal(r.status, 202)
    assert.equal(r.cuerpo.estado, 'en-curso')
    assert.equal(r.cuerpo.total, 3)
    assert.match(r.cuerpo.activacion, new RegExp(`^${SPA}/#activar/[0-9a-f-]{36}\\.m{32}$`))
    assert.deepEqual(f.iniciados, [{
      cedula: '1012345678', nombre: 'Ana', apellido: 'Gil', direccion: 'Calle 10 # 20-30, Bogotá', cuenta: 'ana.gil.45678@carpetacolombia.co',
      correoContacto: 'ana@correo.co', telefono: '3001234567',
    }])
    assert.equal(f.recibidos.length, 0, 'recibir la solicitud no descarga nada: lo hace el procesador')
    assert.deepEqual(f.orden, [])
  })
})

test('reenvío idempotente: 200 con el mismo traslado, sin crear otra cuenta ni otro registro', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const a = await transferir(pedir)
    const b = await transferir(pedir)
    assert.equal(b.status, 200)
    assert.equal(b.cuerpo.id, a.cuerpo.id)
    assert.equal(b.cuerpo.activacion, a.cuerpo.activacion, 'el mismo enlace: MS-03 no crea otra cuenta')
    assert.equal(f.repo.filas.size, 1)
    assert.equal(f.enlaces.size, 1)
  })
})

for (const [caso, cambio] of [
  ['sin documentos', { documentos: [] }],
  ['más de 50 documentos', { documentos: Array.from({ length: 51 }, (_, i) => ({ ...DOCS[0], idExterno: `d${i}` })) }],
  ['idExterno repetido', { documentos: [DOCS[0], { ...DOCS[1], idExterno: 'a1' }] }],
  ['Certificado sin emisor', { documentos: [{ ...DOCS[1], emisor: undefined }] }],
  ['tipo no permitido', { documentos: [{ ...DOCS[0], tipo: 'application/zip' }] }],
  ['huella inválida', { documentos: [{ ...DOCS[0], sha256: 'zz' }] }],
  ['URL de documento inválida', { documentos: [{ ...DOCS[0], url: 'no-es-url' }] }],
  ['sin teléfono', { telefono: undefined }],
  ['teléfono no celular', { telefono: '6011234567' }],
  ['sin correo institucional', { correo: 'no-es-correo' }],
  ['sin dirección', { direccion: '' }],
  ['cédula inválida', { id: '12a' }],
  ['sin confirmAPI', { confirmAPI: undefined }],
]) {
  test(`traslado inválido (${caso}): 422 en problem+json y sin crear nada`, async () => {
    const f = montar()
    await con(f, async (pedir) => {
      const r = await transferir(pedir, { ...cambio, firma: 'x.y.z' })
      assert.equal(r.status, 422)
      assert.match(r.tipo, /problem\+json/)
    })
    assert.equal(f.iniciados.length, 0)
    assert.equal(f.repo.filas.size, 0)
  })
}

test('operador sin llave registrada: 403; firma que no cubre los documentos o el confirmAPI: 401', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await transferir(pedir, { operador: 'operador-desconocido' })).status, 403)
    assert.equal((await transferir(pedir, { firma: await firmaDe(TRASLADO, intruso.privateKey) })).status, 401)
    const otroDoc = { ...TRASLADO, documentos: [DOCS[0], DOCS[1], { ...DOCS[2], sha256: sha(9) }] }
    const alterado = await transferir(pedir, { firma: await firmaDe(TRASLADO), documentos: otroDoc.documentos })
    assert.equal(alterado.status, 401)
    assert.match(alterado.cuerpo.detail, /sha256/)
    assert.equal((await transferir(pedir, { firma: await firmaDe({ ...TRASLADO, confirmAPI: 'https://otro.test/confirm' }) })).status, 401, 'el confirmAPI también va firmado')
  })
  assert.equal(f.iniciados.length, 0)
})

test('el confirmAPI no puede apuntar a la red interna ni a http', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    for (const confirmAPI of ['http://origen.test/confirm', 'https://127.0.0.1/confirm', 'https://10.0.0.5/confirm', 'https://169.254.169.254/latest']) {
      const t = { ...TRASLADO, confirmAPI }
      const r = await pedir('/api/transferCitizen', { metodo: 'POST', cuerpo: { ...t, firma: await firmaDe(t) } })
      assert.equal(r.status, 422, confirmAPI)
    }
  })
  assert.equal(f.iniciados.length, 0)
})

test('RI-03: si GovCarpeta lo tiene en otro operador o ya aquí, 409; si el centralizador cae, 503; nada se crea', async () => {
  for (const [centralizador, esperado] of [[{ afiliado: true, operador: 'Operador Ciudadano' }, 409], [{ afiliado: true, operador: OPERADOR }, 409], [new Error('caído'), 503]]) {
    const f = montar({ centralizador })
    await con(f, async (pedir) => {
      const r = await transferir(pedir)
      assert.equal(r.status, esperado)
      assert.match(r.tipo, /problem\+json/)
    })
    assert.equal(f.iniciados.length, 0)
    assert.equal(f.repo.filas.size, 0)
  }
})

test('si MS-03 rechaza la cuenta, el traslado no se crea y el error se propaga', async () => {
  const f = montar()
  f.iniciarError = new ErrorAfiliacion(409, 'La cuenta institucional ya existe')
  await con(f, async (pedir) => {
    const r = await transferir(pedir)
    assert.equal(r.status, 409)
    assert.equal(f.repo.filas.size, 0)
  })
})

test('el ciudadano ve el avance de su traslado y nadie más lo ve', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await pedir('/traslados/actual', { t: await tokenCiudadano() })).status, 404, 'sin traslado')
    await transferir(pedir)
    const antes = await pedir('/traslados/actual', { t: await tokenCiudadano() })
    assert.equal(antes.status, 200)
    assert.deepEqual([antes.cuerpo.estado, antes.cuerpo.recibidos, antes.cuerpo.total, antes.cuerpo.operador], ['en-curso', 0, 3, 'operador-origen'])
    await f.avanzar()
    const despues = await pedir('/traslados/actual', { t: await tokenCiudadano() })
    assert.deepEqual([despues.cuerpo.estado, despues.cuerpo.recibidos, despues.cuerpo.total], ['completo', 3, 3])
    assert.ok(despues.cuerpo.completadoEn)
    assert.equal((await pedir('/traslados/actual', { t: await tokenCiudadano('2000000002') })).status, 404)
    assert.equal((await pedir('/traslados/actual')).status, 401)
  })
})

test('procesar: recibe cada documento, registra la afiliación solo cuando todos llegaron y confirma al origen con req_status 1', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await transferir(pedir)
    await f.avanzar()
    assert.deepEqual(f.orden, ['recibir:a1', 'recibir:a2', 'recibir:a3', 'completar', 'confirmar:1'], 'la afiliación cambia después del último documento')
    assert.deepEqual(f.recibidos.map((d) => [d.idExterno, d.clase, d.emisor, d.cedula, d.operador]), [
      ['a1', 'temporal', undefined, '1012345678', 'operador-origen'], ['a2', 'certificado', 'universidad-original', '1012345678', 'operador-origen'], ['a3', 'temporal', undefined, '1012345678', 'operador-origen'],
    ])
    assert.equal(f.recibidos[0].url, DOCS[0].url)
    assert.deepEqual(f.confirmaciones, [{ url: TRASLADO.confirmAPI, id: '1012345678', req_status: 1 }])
    assert.equal([...f.repo.filas.values()][0].confirmadoEn !== null, true)
    await f.avanzar(60_000)
    assert.equal(f.confirmaciones.length, 1, 'un traslado confirmado no se vuelve a procesar')
  })
})

test('un documento que falla se reintenta sin repetir los que ya llegaron ni duplicar; la afiliación espera', async () => {
  const f = montar()
  f.fallas.set('a2', 2)
  await con(f, async (pedir) => {
    await transferir(pedir)
    await f.avanzar()
    assert.deepEqual(f.orden, ['recibir:a1', 'recibir:a2', 'recibir:a3'], 'a2 falló; a3 sí llegó; nada de afiliación todavía')
    assert.equal([...f.repo.filas.values()][0].recibidos, 2)
    await f.avanzar(1000)
    assert.equal(f.recibidos.length, 3, 'todavía no toca reintentar: espera con retroceso')
    await f.avanzar(60_000)
    assert.equal([...f.repo.filas.values()][0].estado, 'en-curso')
    await f.avanzar(60_000)
    const veces = (id) => f.recibidos.filter((d) => d.idExterno === id).length
    assert.deepEqual([veces('a1'), veces('a2'), veces('a3')], [1, 3, 1])
    assert.deepEqual(f.orden.slice(-2), ['completar', 'confirmar:1'])
    assert.equal(f.confirmaciones.length, 1)
  })
})

test(`tras ${MAX_INTENTOS_DOCUMENTO} intentos fallidos el traslado se descarta: se borra lo recibido, se cancela la cuenta y el origen recibe req_status 0`, async () => {
  const f = montar()
  f.fallas.set('a2', 99)
  await con(f, async (pedir) => {
    await transferir(pedir)
    for (let i = 0; i < MAX_INTENTOS_DOCUMENTO; i++) await f.avanzar(120_000)
    const t = [...f.repo.filas.values()][0]
    assert.equal(t.estado, 'fallido')
    assert.match(t.error, /Diploma/)
    assert.equal(f.orden.includes('completar'), false, 'nunca se registra la afiliación')
    assert.deepEqual(f.descartes, [{ cedula: '1012345678', operador: 'operador-origen' }])
    assert.deepEqual(f.cancelaciones, ['1012345678'])
    assert.deepEqual(f.confirmaciones, [{ url: TRASLADO.confirmAPI, id: '1012345678', req_status: 0 }])
    assert.ok(t.confirmadoEn)
    assert.ok(f.orden.indexOf('descartar') < f.orden.indexOf('confirmar:0'), 'el origen se entera después de que aquí quede limpio')
  })
})

test('GovCarpeta rechaza la afiliación (409): fallido y req_status 0; si solo tarda (503), se reintenta y sale bien', async () => {
  const rechazo = montar()
  rechazo.completarFalla.push(new ErrorAfiliacion(409, 'Afiliado a otro operador'))
  await con(rechazo, async (pedir) => {
    await transferir(pedir)
    await rechazo.avanzar()
    assert.equal([...rechazo.repo.filas.values()][0].estado, 'fallido')
    assert.deepEqual(rechazo.confirmaciones.map((c) => c.req_status), [0])
  })
  const lento = montar()
  lento.completarFalla.push(new ErrorAfiliacion(503, 'GovCarpeta no respondió'), new ErrorAfiliacion(503, 'GovCarpeta no respondió'))
  await con(lento, async (pedir) => {
    await transferir(pedir)
    await lento.avanzar()
    assert.equal([...lento.repo.filas.values()][0].estado, 'en-curso')
    await lento.avanzar(120_000)
    await lento.avanzar(120_000)
    assert.equal([...lento.repo.filas.values()][0].estado, 'completo')
    assert.deepEqual(lento.confirmaciones.map((c) => c.req_status), [1])
    assert.equal(lento.recibidos.length, 3, 'los documentos no se piden de nuevo al reintentar la afiliación')
  })
})

test('si el origen no recibe la confirmación, se reintenta con retroceso sin repetir el resto y sin confirmar dos veces', async () => {
  const f = montar()
  f.confirmarFalla = 2
  await con(f, async (pedir) => {
    await transferir(pedir)
    await f.avanzar()
    assert.equal([...f.repo.filas.values()][0].confirmadoEn, null)
    assert.equal([...f.repo.filas.values()][0].estado, 'completo')
    await f.avanzar(60_000)
    await f.avanzar(60_000)
    assert.deepEqual(f.confirmaciones.map((c) => c.req_status), [1])
    assert.equal(f.orden.filter((x) => x === 'completar').length, 1, 'la afiliación no se repite')
    assert.equal(f.recibidos.length, 3)
  })
})

test('tras un traslado fallido el origen puede intentarlo de nuevo con un traslado nuevo', async () => {
  const f = montar()
  f.fallas.set('a1', 99)
  await con(f, async (pedir) => {
    await transferir(pedir)
    for (let i = 0; i < MAX_INTENTOS_DOCUMENTO; i++) await f.avanzar(120_000)
    assert.equal([...f.repo.filas.values()][0].estado, 'fallido')
    f.fallas.clear()
    const otra = await transferir(pedir)
    assert.equal(otra.status, 202)
    assert.equal(f.repo.filas.size, 2)
    await f.avanzar(120_000)
    assert.deepEqual(f.confirmaciones.map((c) => c.req_status), [0, 1])
  })
})
