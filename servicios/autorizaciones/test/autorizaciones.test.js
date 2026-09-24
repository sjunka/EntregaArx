import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, nuevoId } from './doble.js'

// HU-07 · autorización documento a documento. RF-04.3, RF-04.4, RF-04.5, RI-08.
const CEDULA = '1012345678'
const OTRA = '2000000002'
const PETICION = { entidad: 'universidad-demo', idExterno: 'pet-001', cedula: CEDULA, proposito: 'Verificar tus estudios para una beca', pedidos: [{ titulo: 'Diploma' }, { titulo: 'Certificado laboral' }] }
const D1 = nuevoId()
const D2 = nuevoId()
const crear = (pedir, cuerpo = PETICION) => pedir('/interno/peticiones', { metodo: 'POST', cuerpo, servicio: 'interoperabilidad' })
const HORA = 3_600_000

test('la entidad pide documentos: queda pendiente, es idempotente y el ciudadano ve entidad, documentos pedidos y propósito', () => conServicio(async ({ pedir }) => {
  const r = await crear(pedir)
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.estado, 'pendiente')
  const otra = await crear(pedir)
  assert.equal(otra.status, 200)
  assert.equal(otra.cuerpo.id, r.cuerpo.id, 'el reenvío no duplica')
  await crear(pedir, { ...PETICION, idExterno: 'pet-002', cedula: OTRA })

  const lista = await pedir('/peticiones')
  assert.equal(lista.status, 200)
  assert.equal(lista.cuerpo.length, 1, 'solo las suyas')
  assert.deepEqual(lista.cuerpo[0], {
    id: r.cuerpo.id, entidad: 'universidad-demo', proposito: PETICION.proposito, pedidos: PETICION.pedidos,
    estado: 'pendiente', creado: '2026-09-24T10:00:00.000Z', autorizaciones: [],
  })
}))

for (const [caso, cambio] of [
  ['sin propósito', { proposito: ' ' }],
  ['sin documentos pedidos', { pedidos: [] }],
  ['más de 10 documentos', { pedidos: Array.from({ length: 11 }, (_, i) => ({ titulo: `d${i}` })) }],
  ['pedido sin título', { pedidos: [{ titulo: '' }] }],
  ['cédula inválida', { cedula: '12a' }],
  ['sin entidad', { entidad: '' }],
]) {
  test(`petición inválida (${caso}): 422 en problem+json`, () => conServicio(async ({ pedir }) => {
    const r = await crear(pedir, { ...PETICION, ...cambio })
    assert.equal(r.status, 422)
    assert.match(r.tipo, /problem\+json/)
  }))
}

test('aprobar por documento: solo lo marcado queda autorizado, con vigencia de 72 h', () => conServicio(async ({ pedir, repo }) => {
  const { cuerpo: { id } } = await crear(pedir)
  const r = await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] } })
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.autorizaciones.length, 1)
  assert.equal(r.cuerpo.autorizaciones[0].documentoId, D1)
  assert.equal(r.cuerpo.autorizaciones[0].venceEn, new Date(Date.parse('2026-09-24T10:00:00Z') + 72 * HORA).toISOString())
  assert.equal((await pedir('/peticiones')).cuerpo[0].estado, 'atendida')
  assert.equal(await repo.decidir({ cedula: CEDULA, documentoId: D2, tercero: 'entidad:universidad-demo' }), null, 'el no marcado no sale')
  assert.equal((await pedir('/autorizaciones')).cuerpo.length, 1)
}))

test('no se autoriza más de lo pedido, ni dos veces, ni la petición de otro ciudadano', () => conServicio(async ({ pedir }) => {
  const { cuerpo: { id } } = await crear(pedir)
  const tres = await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1, D2, nuevoId()] } })
  assert.equal(tres.status, 422)
  const ajena = await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] }, cedula: OTRA })
  assert.equal(ajena.status, 404, 'la petición de otro ciudadano no existe para este')
  assert.equal((await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] } })).status, 201)
  const repetida = await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D2] } })
  assert.equal(repetida.status, 409)
  assert.match(repetida.tipo, /problem\+json/)
  for (const cuerpo of [{ documentos: [D1] }, { peticionId: id, documentos: [] }, { peticionId: id, documentos: ['no-es-uuid'] }, { peticionId: id, documentos: [D1, D1] }]) {
    assert.equal((await pedir('/autorizaciones', { metodo: 'POST', cuerpo })).status, 422, JSON.stringify(cuerpo))
  }
}))

test('rechazar la petición completa: la entidad solo se entera del rechazo, sin detalle de la carpeta', () => conServicio(async ({ pedir }) => {
  const { cuerpo: { id } } = await crear(pedir)
  assert.equal((await pedir(`/peticiones/${id}/rechazo`, { metodo: 'POST', cuerpo: {}, cedula: OTRA })).status, 404)
  const r = await pedir(`/peticiones/${id}/rechazo`, { metodo: 'POST', cuerpo: {} })
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.estado, 'rechazada')
  assert.equal((await pedir(`/peticiones/${id}/rechazo`, { metodo: 'POST', cuerpo: {} })).status, 409)
  assert.equal((await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] } })).status, 409, 'rechazada no se autoriza después')
  const entidad = await pedir(`/interno/peticiones/${id}?entidad=universidad-demo`, { servicio: 'interoperabilidad' })
  assert.deepEqual(entidad.cuerpo, { id, estado: 'rechazada', autorizaciones: [] })
}))

test('la entidad consulta su petición: solo ve las autorizaciones vigentes y solo si es suya', () => conServicio(async ({ pedir }) => {
  const { cuerpo: { id } } = await crear(pedir)
  const pendiente = await pedir(`/interno/peticiones/${id}?entidad=universidad-demo`, { servicio: 'interoperabilidad' })
  assert.deepEqual(pendiente.cuerpo, { id, estado: 'pendiente', autorizaciones: [] })
  await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1, D2] } })
  const atendida = await pedir(`/interno/peticiones/${id}?entidad=universidad-demo`, { servicio: 'interoperabilidad' })
  assert.deepEqual(atendida.cuerpo.autorizaciones.map((a) => a.documentoId).sort(), [D1, D2].sort())
  assert.equal((await pedir(`/interno/peticiones/${id}?entidad=otra-entidad`, { servicio: 'interoperabilidad' })).status, 404)
  assert.equal((await pedir(`/interno/peticiones/${nuevoId()}?entidad=universidad-demo`, { servicio: 'interoperabilidad' })).status, 404)
}))

test('revocar una autorización vigente: la decisión pasa a negativa y deja de listarse', () => conServicio(async ({ pedir }) => {
  const { cuerpo: { id } } = await crear(pedir)
  const { cuerpo: { autorizaciones: [a] } } = await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] } })
  const decidir = () => pedir('/interno/decisiones', { metodo: 'POST', servicio: 'custodia', cuerpo: { cedula: CEDULA, documentoId: D1, tercero: 'entidad:universidad-demo' } })
  assert.equal((await decidir()).cuerpo.permitida, true)
  assert.equal((await pedir(`/autorizaciones/${a.id}`, { metodo: 'DELETE', cedula: OTRA })).status, 404, 'no se revoca lo ajeno')
  assert.equal((await pedir(`/autorizaciones/${a.id}`, { metodo: 'DELETE' })).status, 204)
  assert.equal((await pedir(`/autorizaciones/${a.id}`, { metodo: 'DELETE' })).status, 204, 'revocar dos veces no falla')
  assert.equal((await decidir()).cuerpo.permitida, false)
  assert.deepEqual((await pedir('/autorizaciones')).cuerpo, [])
  assert.equal((await pedir(`/autorizaciones/no-es-uuid`, { metodo: 'DELETE' })).status, 404)
}))

test('la decisión que consulta la custodia (RI-08): solo permite lo autorizado, para ese tercero y mientras esté vigente', () => conServicio(async ({ pedir, reloj }) => {
  const { cuerpo: { id } } = await crear(pedir)
  await pedir('/autorizaciones', { metodo: 'POST', cuerpo: { peticionId: id, documentos: [D1] } })
  const decidir = (cambio = {}) => pedir('/interno/decisiones', { metodo: 'POST', servicio: 'custodia', cuerpo: { cedula: CEDULA, documentoId: D1, tercero: 'entidad:universidad-demo', ...cambio } })
  const ok = await decidir()
  assert.equal(ok.status, 200)
  assert.equal(ok.cuerpo.permitida, true)
  assert.ok(ok.cuerpo.autorizacionId)
  for (const cambio of [{ documentoId: D2 }, { tercero: 'entidad:otra' }, { tercero: 'correo:alguien@correo.co' }, { cedula: OTRA }]) {
    assert.equal((await decidir(cambio)).cuerpo.permitida, false, JSON.stringify(cambio))
  }
  reloj.ahora = new Date(reloj.ahora.getTime() + 72 * HORA + 1000)
  assert.equal((await decidir()).cuerpo.permitida, false, 'vencida')
  assert.equal((await decidir({ tercero: '' })).status, 422)
}))

test('cada ruta exige el tipo de cliente que le corresponde', () => conServicio(async ({ pedir }) => {
  assert.equal((await pedir('/peticiones', { sinToken: true })).status, 401)
  assert.equal((await pedir('/peticiones', { servicio: 'interoperabilidad' })).status, 401, 'un servicio no usa las rutas del ciudadano')
  assert.equal((await pedir('/interno/peticiones', { metodo: 'POST', cuerpo: PETICION })).status, 403, 'un ciudadano no crea peticiones')
  assert.equal((await pedir('/interno/decisiones', { metodo: 'POST', cuerpo: {}, servicio: 'interoperabilidad' })).status, 403, 'solo la custodia decide')
  assert.equal((await pedir('/interno/peticiones', { metodo: 'POST', cuerpo: PETICION, servicio: 'custodia' })).status, 403, 'la custodia no crea peticiones')
}))

// HU-08: el ciudadano que envía documentos a una entidad no afiliada los autoriza para ese correo; el envío pasa por aquí.
test('la interoperabilidad concede al correo destinatario las autorizaciones de un envío, con la misma vigencia', () => conServicio(async ({ pedir, repo }) => {
  const conceder = (cuerpo, servicio = 'interoperabilidad') => pedir('/interno/autorizaciones', { metodo: 'POST', cuerpo, servicio })
  const r = await conceder({ cedula: CEDULA, tercero: 'correo:tramites@entidad.co', documentos: [D1, D2] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.cuerpo.autorizaciones.map((a) => a.documentoId), [D1, D2])
  assert.equal(r.cuerpo.autorizaciones[0].venceEn, new Date(Date.parse('2026-09-24T10:00:00Z') + 72 * HORA).toISOString())
  assert.ok(await repo.decidir({ cedula: CEDULA, documentoId: D1, tercero: 'correo:tramites@entidad.co' }))
  assert.equal(await repo.decidir({ cedula: CEDULA, documentoId: D1, tercero: 'correo:otro@entidad.co' }), null, 'solo ese correo')

  for (const cuerpo of [
    { cedula: CEDULA, tercero: 'tramites@entidad.co', documentos: [D1] },
    { cedula: CEDULA, tercero: 'correo:', documentos: [D1] },
    { cedula: 'abc', tercero: 'correo:a@b.co', documentos: [D1] },
    { cedula: CEDULA, tercero: 'correo:a@b.co', documentos: [] },
    { cedula: CEDULA, tercero: 'correo:a@b.co', documentos: ['no-es-uuid'] },
    { cedula: CEDULA, tercero: 'correo:a@b.co', documentos: [D1, D1] },
    { cedula: CEDULA, tercero: 'correo:a@b.co', documentos: Array.from({ length: 11 }, () => nuevoId()) },
  ]) assert.equal((await conceder(cuerpo)).status, 422, JSON.stringify(cuerpo).slice(0, 80))
  assert.equal((await conceder({ cedula: CEDULA, tercero: 'correo:a@b.co', documentos: [D1] }, 'custodia')).status, 403, 'la custodia decide, no concede')
  assert.equal((await pedir('/interno/autorizaciones', { metodo: 'POST', cuerpo: { cedula: CEDULA, tercero: 'correo:a@b.co', documentos: [D1] } })).status, 403, 'un ciudadano no concede por esta ruta')
}))

test('Premium (MS-11) crea y consulta las peticiones de su empresa como una entidad; la custodia no', () => conServicio(async ({ pedir }) => {
  const r = await pedir('/interno/peticiones', { metodo: 'POST', cuerpo: { ...PETICION, entidad: 'tramites-premium' }, servicio: 'premium' })
  assert.equal(r.status, 201)
  assert.equal((await pedir(`/interno/peticiones/${r.cuerpo.id}?entidad=tramites-premium`, { servicio: 'premium' })).cuerpo.estado, 'pendiente')
  assert.equal((await pedir(`/interno/peticiones/${r.cuerpo.id}?entidad=otra`, { servicio: 'premium' })).status, 404)
  assert.equal((await pedir('/interno/peticiones', { metodo: 'POST', cuerpo: PETICION, servicio: 'custodia' })).status, 403)
  assert.equal((await pedir('/interno/decisiones', { metodo: 'POST', cuerpo: { cedula: CEDULA, documentoId: D1, tercero: 'entidad:tramites-premium' }, servicio: 'premium' })).status, 403, 'Premium no decide')
}))
