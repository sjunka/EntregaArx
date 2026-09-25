import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { crearApp } from '../src/app.js'
import { crearVerificador } from '../src/auth.js'
import { crearProcesadorSalida, MAX_INTENTOS_ENVIO, MAX_INTENTOS_REVERTIR, rutasSalida } from '../src/salida.js'
import { ErrorAfiliacion } from '../src/afiliacion.js'
import { ErrorCustodia } from '../src/custodia.js'

// HU-13 · Traslado de salida: MS-07 congela la Carpeta, da de baja en GovCarpeta, envía transferCitizen con URL prefirmadas y
// espera transferCitizenConfirm. La cuenta se cierra solo tras req_status 1; con 0 se reafilia y se reabre la Carpeta.
// RF-01.7, RF-01.8, RF-03.1, RF-03.2, RF-03.5, RF-03.8, RI-01, RD-15.
const OPERADOR = 'Mi Carpeta Segura'
const EMISOR = 'http://localhost:8081/realms/carpeta'
const URL_PUBLICA = 'https://mcs.test'
const CEDULA = '1012345678'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] })
const tokenCiudadano = (cedula = CEDULA) => new SignJWT({ azp: 'portal', cedula }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(EMISOR).setAudience('interoperabilidad').setIssuedAt().setExpirationTime('5m').sign(privateKey)

const OPERADORES = [
  { id: 'nuestro', nombre: OPERADOR, transferAPIURL: 'https://mcs.test/api/transferCitizen' },
  { id: 'destino', nombre: 'Operador Destino', transferAPIURL: 'https://destino.test/api/transferCitizen' },
  { id: 'sin-url', nombre: 'Operador Sin Traslado', transferAPIURL: null },
  { id: 'http', nombre: 'Operador Sin TLS', transferAPIURL: 'http://destino.test/api/transferCitizen' },
]
const DOCUMENTOS = [
  { id: 'd1', titulo: 'Cédula', clase: 'temporal', url: 'https://almacen.test/1?firma=1' },
  { id: 'd2', titulo: 'Diploma', clase: 'certificado', url: 'https://almacen.test/2?firma=1' },
  { id: 'd3', titulo: 'Cédula', clase: 'temporal', url: 'https://almacen.test/3?firma=1' },
]

// Doble en memoria del repositorio Postgres (src/salida.js), con el mismo contrato y un reloj que la prueba controla.
function repoEnMemoria(reloj) {
  const filas = new Map()
  const ACTIVOS = ['iniciado', 'baja', 'enviado', 'cierre', 'revertir']
  return {
    filas, eventos: [],
    async crear(t) {
      const previo = [...filas.values()].find((x) => x.cedula === t.cedula && ACTIVOS.includes(x.estado))
      if (previo) return { traslado: previo, existente: true }
      filas.set(t.id, { estado: 'iniciado', intentos: 0, siguiente: reloj.ahora, creado: reloj.ahora, ...t })
      return { traslado: filas.get(t.id), existente: false }
    },
    obtener: async (id) => filas.get(id) ?? null,
    activoDe: async (cedula) => [...filas.values()].find((x) => x.cedula === cedula && ACTIVOS.includes(x.estado)) ?? null,
    ultimoDe: async (cedula) => [...filas.values()].filter((t) => t.cedula === cedula).sort((a, b) => b.creado - a.creado)[0] ?? null,
    async reclamar() {
      const t = [...filas.values()].find((x) => ['iniciado', 'baja', 'cierre', 'revertir'].includes(x.estado) && x.siguiente <= reloj.ahora)
      if (!t) return null
      t.siguiente = new Date(reloj.ahora.getTime() + 300_000)
      return { ...t }
    },
    async paso(id, estado) { Object.assign(filas.get(id), { estado, intentos: 0, siguiente: reloj.ahora }) },
    async fallo(id, siguiente) { const t = filas.get(id); t.intentos++; t.siguiente = siguiente; return t.intentos },
    async revertir(id, motivo) { Object.assign(filas.get(id), { estado: 'revertir', intentos: 0, siguiente: reloj.ahora, error: motivo }) },
    async confirmar(id) { const t = filas.get(id); if (t.estado !== 'enviado') return false; Object.assign(t, { estado: 'cierre', intentos: 0, siguiente: reloj.ahora }); return true },
    async completo(id, evento) { Object.assign(filas.get(id), { estado: 'completo' }); this.eventos.push(evento) },
    async fallido(id) { filas.get(id).estado = 'fallido' },
    async atencion(id, motivo) { Object.assign(filas.get(id), { estado: 'atencion', error: motivo }) },
  }
}

function montar({ centralizador = { afiliado: true, operador: OPERADOR }, operadores = OPERADORES } = {}) {
  const reloj = { ahora: new Date('2026-09-24T10:00:00Z') }
  const f = { reloj, repo: repoEnMemoria(reloj), orden: [], envios: [], centralizador: centralizador instanceof Error ? centralizador : { ...centralizador }, fallas: { enviar: 0, baja: [], reafiliar: 0 }, respuestaEnvio: { ok: true, status: 200 }, salidaConsulta: { cedula: CEDULA, cuenta: 'ana.gil.45678@carpetacolombia.co', nombre: 'Ana Gil', estado: 'afiliado' } }
  f.pasarela = {
    consultar: async () => { if (f.centralizador instanceof Error) throw f.centralizador; return f.centralizador },
    operadores: async () => { if (f.operadoresError) throw f.operadoresError; return operadores },
  }
  f.afiliacion = {
    consultarSalida: async () => f.salidaConsulta,
    baja: async () => { f.orden.push('baja'); const e = f.fallas.baja.shift(); if (e) throw e; f.centralizador = { afiliado: false, operador: null } },
    reafiliar: async () => { f.orden.push('reafiliar'); if (f.fallas.reafiliar-- > 0) throw new ErrorAfiliacion(503, 'GovCarpeta no responde'); f.centralizador = { afiliado: true, operador: OPERADOR } },
    cierre: async () => { f.orden.push('cierre-cuenta') },
  }
  f.custodia = {
    congelar: async (cedula) => { f.orden.push('congelar'); return { documentos: DOCUMENTOS } },
    reabrir: async () => { f.orden.push('reabrir') },
    cerrar: async () => { f.orden.push('cierre-documentos') },
  }
  f.enviar = async (url, cuerpo) => {
    f.orden.push('enviar')
    f.envios.push({ url, cuerpo })
    if (f.fallas.enviar-- > 0) throw new Error('el destino no responde')
    return f.respuestaEnvio
  }
  f.procesador = crearProcesadorSalida({ repo: f.repo, custodia: f.custodia, afiliacion: f.afiliacion, enviar: f.enviar, urlPublica: URL_PUBLICA, secreto: 's3cr3t0-de-prueba', ahora: () => reloj.ahora, aviso: () => {} })
  const salida = rutasSalida({
    repo: f.repo, pasarela: f.pasarela, afiliacion: f.afiliacion, verificar: crearVerificador({ issuer: EMISOR, jwks }), operador: OPERADOR, secreto: 's3cr3t0-de-prueba', hostsInternos: [],
    resolver: async (host) => [{ address: isIP(host) ? host : '93.184.216.34' }],
  })
  f.app = () => crearApp({ salida, custodia: {}, autorizaciones: {}, pasarela: f.pasarela, bandeja: { encolar: async () => {} }, firmas: {}, operador: OPERADOR })
  f.avanzar = async (ms = 0) => { reloj.ahora = new Date(reloj.ahora.getTime() + ms); await f.procesador.pendientes() }
  return f
}

async function con(f, prueba) {
  const srv = f.app().listen(0)
  const pedir = async (ruta, { metodo = 'GET', cuerpo, t = null, conToken = true } = {}) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, {
      method: metodo, headers: { ...(cuerpo && { 'content-type': 'application/json' }), ...(conToken && { authorization: `Bearer ${t ?? await tokenCiudadano()}` }) }, body: cuerpo && JSON.stringify(cuerpo),
    })
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json().catch(() => null) }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const iniciar = (pedir, operadorId = 'destino') => pedir('/traslados/salida', { metodo: 'POST', cuerpo: { operadorId } })
// Confirmación del destino: el enlace que recibió en confirmAPI.
const confirmar = (pedir, f, cuerpo, url = f.envios.at(-1).cuerpo.confirmAPI) => pedir(new URL(url).pathname, { metodo: 'POST', cuerpo, conToken: false })

test('GET /operadores lista los operadores del centralizador, sin el nuestro, y marca los que no publican dirección de traslado', async () => {
  await con(montar(), async (pedir) => {
    const r = await pedir('/traslados/salida/operadores')
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, [
      { id: 'destino', nombre: 'Operador Destino', disponible: true },
      { id: 'sin-url', nombre: 'Operador Sin Traslado', disponible: false },
      { id: 'http', nombre: 'Operador Sin TLS', disponible: false },
    ])
    assert.ok(!JSON.stringify(r.cuerpo).includes('transferAPIURL'))
  })
})

test('destino sin transferAPIURL o con una dirección no permitida: 422 y el traslado no empieza (B-16)', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    for (const id of ['sin-url', 'http']) {
      const r = await iniciar(pedir, id)
      assert.equal(r.status, 422, id)
      assert.match(r.tipo, /problem\+json/)
    }
    assert.equal((await iniciar(pedir, 'no-existe')).status, 422)
    assert.equal((await iniciar(pedir, 'nuestro')).status, 422, 'no se traslada a uno mismo')
    assert.equal(f.repo.filas.size, 0)
    await f.avanzar()
    assert.deepEqual(f.orden, [], 'no se congela ni se da de baja')
  })
})

test('iniciar exige sesión, que el ciudadano esté afiliado aquí y no admite dos traslados a la vez', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await pedir('/traslados/salida', { metodo: 'POST', cuerpo: { operadorId: 'destino' }, conToken: false })).status, 401)
    const a = await iniciar(pedir)
    assert.equal(a.status, 202)
    assert.equal(a.cuerpo.estado, 'en-curso')
    assert.equal((await iniciar(pedir)).status, 409)
  })
  const g = montar({ centralizador: { afiliado: false, operador: null } })
  await con(g, async (pedir) => assert.equal((await iniciar(pedir)).status, 409))
  const h = montar({ centralizador: new Error('caído') })
  await con(h, async (pedir) => assert.equal((await iniciar(pedir)).status, 503))
})

test('camino feliz: congela, da de baja, envía transferCitizen con URL y confirmAPI, y espera; no borra nada antes de la confirmación', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    assert.deepEqual(f.orden, ['congelar', 'baja', 'congelar', 'enviar'], 'la Carpeta se congela antes de la baja y las URL se piden frescas al enviar')
    const { url, cuerpo } = f.envios[0]
    assert.equal(url, 'https://destino.test/api/transferCitizen')
    assert.deepEqual(Object.keys(cuerpo).sort(), ['citizenEmail', 'citizenName', 'confirmAPI', 'id', 'urlDocuments'])
    assert.deepEqual([cuerpo.id, cuerpo.citizenName, cuerpo.citizenEmail], [1012345678, 'Ana Gil', 'ana.gil.45678@carpetacolombia.co'])
    assert.deepEqual(cuerpo.urlDocuments, { Cédula: ['https://almacen.test/1?firma=1', 'https://almacen.test/3?firma=1'], Diploma: ['https://almacen.test/2?firma=1'] })
    assert.match(cuerpo.confirmAPI, new RegExp(`^${URL_PUBLICA}/api/transferCitizenConfirm/[0-9a-f-]{36}\\.[\\w-]{32}$`))
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'en-curso')
    await f.avanzar(600_000)
    assert.deepEqual(f.orden, ['congelar', 'baja', 'congelar', 'enviar'], 'esperando la confirmación no se borra ni se cierra nada')
    assert.equal(f.repo.eventos.length, 0)
  })
})

test('RI-01, RD-15: lo que sale hacia el destino es solo afiliación y URL, nunca contenido ni contacto', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    const texto = JSON.stringify(f.envios[0].cuerpo)
    for (const dato of ['telefono', 'correoContacto', 'direccion', 'sha256', 'contenido']) assert.ok(!texto.includes(dato), dato)
  })
})

test('req_status 1 con GovCarpeta mostrando al ciudadano en otro operador: cierra documentos y luego la cuenta, y publica ciudadano.trasladado', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    f.centralizador = { afiliado: true, operador: 'Operador Destino' } // el destino ya lo afilió
    const c = await confirmar(pedir, f, { id: CEDULA, req_status: 1 })
    assert.equal(c.status, 200)
    assert.deepEqual(c.cuerpo, { recibido: true })
    assert.ok(!f.orden.includes('cierre-documentos'), 'la confirmación solo agenda el cierre')
    await f.avanzar()
    assert.deepEqual(f.orden.slice(-2), ['cierre-documentos', 'cierre-cuenta'], 'primero los documentos, luego la cuenta')
    assert.equal(f.repo.eventos.length, 1)
    assert.equal(f.repo.eventos[0].cedula, CEDULA)
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'completo')
    assert.equal((await confirmar(pedir, f, { id: CEDULA, req_status: 1 })).status, 200, 'una confirmación repetida es inocua')
    await f.avanzar()
    assert.equal(f.repo.eventos.length, 1)
  })
})

test('req_status 1 sin que GovCarpeta muestre al ciudadano en otro operador: 409 y no se borra nada', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    const c = await confirmar(pedir, f, { id: CEDULA, req_status: 1 }) // el centralizador lo muestra sin operador tras la baja
    assert.equal(c.status, 409)
    assert.match(c.tipo, /problem\+json/)
    await f.avanzar()
    assert.ok(!f.orden.includes('cierre-cuenta') && !f.orden.includes('cierre-documentos'))
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'en-curso')
  })
})

test('la confirmación exige el enlace del traslado y la cédula que corresponde; un ciudadano no la puede dar', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    f.centralizador = { afiliado: true, operador: 'Operador Destino' }
    const enlace = f.envios[0].cuerpo.confirmAPI
    assert.equal((await confirmar(pedir, f, { id: CEDULA, req_status: 1 }, `${URL_PUBLICA}/api/transferCitizenConfirm/${randomUUID()}.${'x'.repeat(32)}`)).status, 404)
    assert.equal((await confirmar(pedir, f, { id: CEDULA, req_status: 1 }, enlace.slice(0, -3) + 'aaa')).status, 404)
    assert.equal((await confirmar(pedir, f, { id: '2000000002', req_status: 1 })).status, 422, 'otra cédula')
    for (const cuerpo of [{ id: CEDULA }, { id: CEDULA, req_status: 2 }, { id: 'x', req_status: 1 }]) assert.equal((await confirmar(pedir, f, cuerpo)).status, 422, JSON.stringify(cuerpo))
    await f.avanzar()
    assert.ok(!f.orden.includes('cierre-cuenta'))
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'en-curso')
  })
})

test('req_status 0: el destino rechazó, se reafilia y se reabre la Carpeta; el ciudadano lo ve y nada se borró', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    assert.equal((await confirmar(pedir, f, { id: CEDULA, req_status: 0 })).status, 200)
    await f.avanzar()
    assert.deepEqual(f.orden.slice(-2), ['reafiliar', 'reabrir'])
    assert.ok(!f.orden.includes('cierre-cuenta') && !f.orden.includes('cierre-documentos'))
    assert.deepEqual(f.centralizador, { afiliado: true, operador: OPERADOR }, 'nunca queda sin operador')
    const estado = (await pedir('/traslados/salida/actual')).cuerpo
    assert.equal(estado.estado, 'fallido')
    assert.match(estado.motivo, /rechaz/i)
    assert.equal((await iniciar(pedir)).status, 202, 'puede intentarlo de nuevo')
  })
})

test('el destino no acepta transferCitizen: se reintenta y, agotados los intentos, se revierte', async () => {
  const f = montar()
  f.respuestaEnvio = { ok: false, status: 500 }
  await con(f, async (pedir) => {
    await iniciar(pedir)
    for (let i = 0; i < MAX_INTENTOS_ENVIO; i++) await f.avanzar(600_000)
    await f.avanzar(600_000)
    assert.deepEqual(f.orden.slice(-2), ['reafiliar', 'reabrir'])
    assert.equal(f.orden.filter((x) => x === 'enviar').length, MAX_INTENTOS_ENVIO)
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'fallido')
  })
})

test('el destino no responde una vez y luego sí: el traslado sigue sin revertirse', async () => {
  const f = montar()
  f.fallas.enviar = 1
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    await f.avanzar(600_000)
    assert.equal(f.orden.filter((x) => x === 'enviar').length, 2)
    assert.ok(!f.orden.includes('reafiliar'))
    assert.equal(f.repo.filas.values().next().value.estado, 'enviado')
  })
})

test('GovCarpeta no da la baja: se reintenta y, agotados los intentos, se reabre la Carpeta sin enviar nada', async () => {
  const f = montar()
  f.fallas.baja = Array.from({ length: 10 }, () => new ErrorAfiliacion(503, 'GovCarpeta no responde'))
  await con(f, async (pedir) => {
    await iniciar(pedir)
    for (let i = 0; i < 6; i++) await f.avanzar(600_000)
    assert.ok(!f.orden.includes('enviar'), 'sin baja no se envía nada al destino')
    assert.equal(f.orden.at(-1), 'reabrir')
    assert.equal((await pedir('/traslados/salida/actual')).cuerpo.estado, 'fallido')
  })
})

test('si reafiliar no se logra, el caso queda en atención (escala) y la Carpeta sigue congelada', async () => {
  const f = montar()
  f.respuestaEnvio = { ok: false, status: 500 }
  f.fallas.reafiliar = 100
  await con(f, async (pedir) => {
    await iniciar(pedir)
    for (let i = 0; i < MAX_INTENTOS_ENVIO + MAX_INTENTOS_REVERTIR + 3; i++) await f.avanzar(600_000)
    assert.ok(!f.orden.includes('reabrir'), 'no se reabre mientras siga sin operador')
    const estado = (await pedir('/traslados/salida/actual')).cuerpo
    assert.equal(estado.estado, 'atencion')
  })
})

test('sin traslado: 404 en /actual; el estado de otro ciudadano no se ve', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    assert.equal((await pedir('/traslados/salida/actual')).status, 404)
    await iniciar(pedir)
    assert.equal((await pedir('/traslados/salida/actual', { t: await tokenCiudadano('2000000002') })).status, 404)
  })
})

// ADR-0027: un destino puede confirmar en el endPointConfirm publicado en GovCarpeta, sin el token de nuestro confirmAPI.
test('confirmación sin token: se busca el traslado por cédula y se aplican las mismas reglas', async () => {
  const f = montar()
  await con(f, async (pedir) => {
    await iniciar(pedir)
    await f.avanzar()
    const sinToken = (cuerpo) => pedir('/api/transferCitizenConfirm', { metodo: 'POST', cuerpo, conToken: false })
    assert.equal((await sinToken({ id: 2000000002, req_status: 1 })).status, 404, 'cédula sin traslado')
    assert.equal((await sinToken({ id: Number(CEDULA), req_status: 1 })).status, 409, 'GovCarpeta aún no lo muestra en otro operador')
    f.centralizador = { afiliado: true, operador: 'Operador Destino' }
    assert.equal((await sinToken({ id: Number(CEDULA), req_status: 1 })).status, 200)
    await f.avanzar()
    assert.equal(f.repo.eventos.length, 1, 'se cerró la cuenta como con el token')
  })
})
