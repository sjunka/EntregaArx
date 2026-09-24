import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { crearEntregador, MAX_INTENTOS, rutasEnvios } from '../src/envios.js'
import { ErrorCustodia } from '../src/custodia.js'
import { crearVerificadorFirmas } from '../src/firma.js'

// HU-08 · envío a una entidad no afiliada por correo con enlaces temporales. RF-04.1, RF-04.2, RF-03.4.
const EMISOR = 'http://localhost:8081/realms/carpeta'
const CEDULA = '1012345678'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const token = ({ aud = ['custodia', 'interoperabilidad'], cedula = CEDULA, azp = 'portal' } = {}) =>
  new SignJWT({ azp, cedula, name: 'Ana Gil' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)

const D1 = '22222222-2222-4222-8222-222222222222'
const D2 = '33333333-3333-4333-8333-333333333333'
const BASE = 'https://mcs.test'
const HORA = 3_600_000
const DESTINO = 'Tramites@Entidad.co'

// Doble en memoria del repositorio Postgres (src/envios.js), con el mismo contrato.
function repoEnMemoria(reloj) {
  const filas = new Map()
  const eventos = []
  return {
    filas, eventos,
    async crear(e) {
      const previo = e.clave && [...filas.values()].find((x) => x.cedula === e.cedula && x.clave === e.clave)
      if (previo) return { envio: previo, existente: true }
      filas.set(e.id, { estado: 'pendiente', intentos: 0, siguiente: reloj.ahora, creado: reloj.ahora, ...e })
      return { envio: filas.get(e.id), existente: false }
    },
    obtener: async (id) => filas.get(id) ?? null,
    porClave: async (cedula, clave) => [...filas.values()].find((x) => x.cedula === cedula && x.clave === clave) ?? null,
    de: async (cedula) => [...filas.values()].filter((e) => e.cedula === cedula).sort((a, b) => b.creado - a.creado),
    async reclamar(id) {
      const e = [...filas.values()].filter((x) => x.estado === 'pendiente' && x.siguiente <= reloj.ahora && (!id || x.id === id)).sort((a, b) => a.siguiente - b.siguiente)[0]
      if (!e) return null
      e.siguiente = new Date(reloj.ahora.getTime() + 60_000) // arrendado mientras alguien lo intenta
      return { ...e }
    },
    async entregado(id, evento) {
      const e = filas.get(id)
      Object.assign(e, { estado: 'entregado', entregadoEn: reloj.ahora })
      eventos.push(evento)
    },
    async fallo(id, { error, siguiente, definitivo }) {
      const e = filas.get(id)
      Object.assign(e, { intentos: e.intentos + 1, ultimoError: error, siguiente, estado: definitivo ? 'fallido' : 'pendiente' })
    },
  }
}

function montar({ documentos = [{ id: D1, titulo: 'Cédula de ciudadanía' }, { id: D2, titulo: 'Diploma' }], smtpFalla = 0 } = {}) {
  const reloj = { ahora: new Date('2026-09-24T10:00:00Z') }
  const f = { reloj, repo: repoEnMemoria(reloj), enviados: [], concedidas: [], lecturas: [], orden: [] }
  f.correo = { enviar: async (m) => { if (f.correo.fallas-- > 0) throw new Error('smtp caído'); f.orden.push('correo'); f.enviados.push(m) }, fallas: smtpFalla }
  f.custodia = {
    comprobar: async ({ cedula, documentos: ids }) => { f.orden.push('comprobar'); return { documentos: documentos.filter((d) => ids.includes(d.id)) } },
    leer: async (l) => { f.lecturas.push(l); if (f.lectura) return f.lectura(l); return { url: `https://almacen.test/${l.documentoId}?firma=1`, venceEn: 'v', titulo: 'x' } },
  }
  f.autorizaciones = { conceder: async (c) => { f.orden.push('conceder'); f.concedidas.push(c); return { autorizaciones: [] } } }
  f.entregador = crearEntregador({ repo: f.repo, correo: f.correo, baseUrl: BASE, secreto: 'secreto-de-prueba', ahora: () => reloj.ahora })
  const envios = rutasEnvios({
    verificar: crearVerificador({ issuer: EMISOR, jwks }), repo: f.repo, entregador: f.entregador, custodia: f.custodia, autorizaciones: f.autorizaciones,
    secreto: 'secreto-de-prueba', horas: 72, ahora: () => reloj.ahora,
  })
  f.app = () => crearApp({
    envios, custodia: f.custodia, autorizaciones: f.autorizaciones, pasarela: {}, bandeja: { encolar: async () => {} },
    firmas: crearVerificadorFirmas({ emisores: new Map() }),
  })
  return f
}

async function con(f, prueba) {
  const srv = f.app().listen(0)
  const pedir = async (ruta, { metodo = 'GET', cuerpo, t, cabeceras } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, redirect: 'manual',
      headers: { ...(t !== null && { authorization: `Bearer ${t ?? await token()}` }), ...(cuerpo && { 'content-type': 'application/json' }), ...cabeceras },
      body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), location: r.headers.get('location'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const enviar = (pedir, cuerpo = { correo: DESTINO, documentos: [D1, D2] }, cabeceras) => pedir('/envios', { metodo: 'POST', cuerpo, cabeceras })

test('el envío pasa por autorizaciones, sale por correo con enlaces temporales y nunca con el archivo, y queda entregado', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const r = await enviar(pedir)
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.estado, 'entregado')
    assert.deepEqual(f.orden, ['comprobar', 'conceder', 'correo'], 'la decisión de autorizaciones va antes de enviar')
    assert.deepEqual(f.concedidas, [{ cedula: CEDULA, tercero: 'correo:tramites@entidad.co', documentos: [D1, D2] }])

    const [m] = f.enviados
    assert.equal(m.destino, 'tramites@entidad.co')
    assert.equal(m.adjuntos, undefined, 'el archivo nunca va adjunto')
    for (const id of [D1, D2]) assert.match(m.texto, new RegExp(`${BASE}/api/enlaces/${r.cuerpo.id}/${id}\\?f=[A-Za-z0-9_-]{32}`))
    assert.match(m.texto, /Cédula de ciudadanía/)
    assert.match(m.texto, /Ana Gil/)
    assert.match(m.texto, /27 de septiembre de 2026/, 'dice hasta cuándo valen los enlaces (72 h)')
    assert.match(m.texto, /no lleva archivos adjuntos/i)
    assert.equal(f.repo.eventos.length, 1)
    assert.deepEqual(f.repo.eventos[0], { nombre: 'envio.entregado', datos: {
      id: r.cuerpo.id, cedula: CEDULA, correo: 'tramites@entidad.co', documentos: [{ id: D1, titulo: 'Cédula de ciudadanía' }, { id: D2, titulo: 'Diploma' }], entregadoEn: '2026-09-24T10:00:00.000Z',
    }, dedupe: `envio.entregado:${r.cuerpo.id}` })
  })
})

for (const [caso, cuerpo] of [
  ['correo inválido', { correo: 'no-es-correo', documentos: [D1] }],
  ['sin documentos', { correo: DESTINO, documentos: [] }],
  ['documento que no es uuid', { correo: DESTINO, documentos: ['x'] }],
  ['documentos repetidos', { correo: DESTINO, documentos: [D1, D1] }],
  ['más de 10 documentos', { correo: DESTINO, documentos: Array.from({ length: 11 }, () => randomUUID()) }],
]) {
  test(`envío inválido (${caso}): 422 en problem+json y sin conceder ni enviar`, async () => {
    const f = montar()
    await con(f, async (pedir) => {
      const r = await enviar(pedir, cuerpo)
      assert.equal(r.status, 422)
      assert.match(r.tipo, /problem\+json/)
    })
    assert.deepEqual(f.orden, [])
  })
}

test('un documento que no es del titular o no está en su Carpeta: 422 y no se concede ni se envía nada', async () => {
  const f = montar({ documentos: [{ id: D1, titulo: 'Cédula' }] })
  await con(f, async (pedir) => {
    const r = await enviar(pedir)
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.detail, /carpeta/i)
  })
  assert.deepEqual(f.orden, ['comprobar'])
  assert.equal(f.repo.filas.size, 0)
})

test('si el correo falla queda pendiente y se reintenta sin duplicar el envío, el correo ni el aviso', async () => {
  const f = montar({ smtpFalla: 2 })
  await con(f, async (pedir) => {
    const r = await enviar(pedir)
    assert.equal(r.status, 202)
    assert.equal(r.cuerpo.estado, 'pendiente')
    assert.equal(f.enviados.length, 0)
    assert.equal(f.repo.eventos.length, 0, 'sin entrega no hay confirmación')

    await f.entregador.pendientes() // todavía no toca reintentar: espera con retroceso
    assert.equal(f.correo.fallas, 1)
    f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 60_000)
    await f.entregador.pendientes() // segundo fallo
    assert.equal(f.enviados.length, 0)
    f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 10 * 60_000)
    await f.entregador.pendientes() // ya sale
    await f.entregador.pendientes() // repetir no reenvía
    assert.equal(f.enviados.length, 1)
    assert.equal(f.repo.eventos.length, 1)
    assert.equal((await pedir('/envios')).cuerpo[0].estado, 'entregado')
    assert.equal(f.concedidas.length, 1, 'reintentar el correo no concede de nuevo')
  })
})

test(`tras ${MAX_INTENTOS} fallos el envío queda fallido, sin confirmación`, async () => {
  const f = montar({ smtpFalla: 99 })
  await con(f, async (pedir) => {
    const r = await enviar(pedir)
    assert.equal(r.status, 202)
    for (let i = 0; i < MAX_INTENTOS; i++) {
      f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 10 * 60_000)
      await f.entregador.pendientes()
    }
    const [e] = (await pedir('/envios')).cuerpo
    assert.equal(e.estado, 'fallido')
    assert.equal(f.repo.eventos.length, 0)
    assert.equal(f.correo.fallas, 99 - MAX_INTENTOS)
  })
})

test('Idempotency-Key: repetir la solicitud devuelve el mismo envío y no vuelve a conceder ni a enviar', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const clave = { 'idempotency-key': 'clave-unica-1' }
    const a = await enviar(pedir, undefined, clave)
    const b = await enviar(pedir, undefined, clave)
    assert.equal(b.status, 200)
    assert.equal(b.cuerpo.id, a.cuerpo.id)
    assert.equal(f.enviados.length, 1)
    assert.equal(f.concedidas.length, 1)
    assert.equal(f.repo.filas.size, 1)
    assert.equal((await enviar(pedir, undefined, { 'idempotency-key': 'clave-unica-2' })).status, 201, 'otra clave es otro envío')
  })
})

test('GET /envios lista solo los envíos del ciudadano, con destinatario, documentos y estado', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await enviar(pedir)
    const propia = await pedir('/envios')
    assert.equal(propia.status, 200)
    assert.deepEqual(Object.keys(propia.cuerpo[0]).sort(), ['correo', 'creado', 'documentos', 'entregadoEn', 'estado', 'id', 'venceEn'])
    assert.equal(propia.cuerpo[0].correo, 'tramites@entidad.co')
    assert.deepEqual((await pedir('/envios', { t: await token({ cedula: '2000000002' }) })).cuerpo, [])
  })
})

test('enlace válido: redirige a la URL de corta vida que firma la custodia para ese correo (y solo ese)', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    const { cuerpo: { id } } = await enviar(pedir)
    const enlace = /(\/api\/enlaces\/\S+)/.exec(f.enviados[0].texto)[1].split(BASE).pop()
    const r = await pedir(enlace, { t: null })
    assert.equal(r.status, 302)
    assert.equal(r.location, `https://almacen.test/${D1}?firma=1`)
    assert.deepEqual(f.lecturas, [{ documentoId: D1, tercero: 'correo:tramites@entidad.co' }])
    // Un enlace no sirve para otro documento del envío ni con una firma cambiada ni con otro envío.
    const mac = /f=([\w-]{32})/.exec(enlace)[1]
    assert.equal((await pedir(`/api/enlaces/${id}/${D2}?f=${mac}`, { t: null })).status, 404)
    assert.equal((await pedir(`/api/enlaces/${id}/${D1}?f=${'a'.repeat(32)}`, { t: null })).status, 404)
    assert.equal((await pedir(`/api/enlaces/${id}/${D1}`, { t: null })).status, 404)
    assert.equal((await pedir(`/api/enlaces/${randomUUID()}/${D1}?f=${mac}`, { t: null })).status, 404)
    assert.equal(f.lecturas.length, 1)
  })
})

test('enlace vencido (72 h): 410; autorización retirada: 403; custodia caída: 503', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await enviar(pedir)
    const enlace = /(\/api\/enlaces\/\S+)/.exec(f.enviados[0].texto)[1].split(BASE).pop()
    f.lectura = () => { throw new ErrorCustodia(403, 'Sin autorización vigente') }
    const retirada = await pedir(enlace, { t: null })
    assert.equal(retirada.status, 403)
    assert.match(retirada.tipo, /problem\+json/)
    f.lectura = () => { throw new ErrorCustodia(503, 'no responde') }
    assert.equal((await pedir(enlace, { t: null })).status, 503)
    f.lectura = undefined
    f.reloj.ahora = new Date(f.reloj.ahora.getTime() + 72 * HORA + 1000)
    const vencido = await pedir(enlace, { t: null })
    assert.equal(vencido.status, 410)
    assert.equal(f.lecturas.length, 2, 'un enlace vencido ni siquiera llega a la custodia')
  })
})

test('sin sesión o con un token de otra audiencia no se envía ni se lista', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await pedir('/envios', { metodo: 'POST', cuerpo: { correo: DESTINO, documentos: [D1] }, t: null })).status, 401)
    assert.equal((await pedir('/envios', { t: null })).status, 401)
    assert.equal((await pedir('/envios', { t: await token({ aud: 'custodia' }) })).status, 401)
    assert.equal((await pedir('/envios', { t: await token({ azp: 'interoperabilidad' }) })).status, 401)
  })
  assert.deepEqual(f.orden, [])
})
