import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, token } from './doble.js'

// HU-10 · Caso PQRS Premium. RF-07.2, RF-07.3, RI-07, RI-08.
const PETICION = { cedula: '1012345678', proposito: 'Resolver tu reclamo de facturación', documentos: [{ titulo: 'Factura de energía' }] }
const abrir = (pedir, opciones) => pedir('/casos', { metodo: 'POST', cuerpo: { asunto: 'Reclamo 001' }, ...opciones })

test('la empresa Premium abre un caso y lo ve con su estado', () => conServicio(async ({ pedir }) => {
  const r = await abrir(pedir)
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.estado, 'abierto')
  assert.deepEqual((await pedir('/casos')).cuerpo.map((c) => c.asunto), ['Reclamo 001'])
  assert.deepEqual((await pedir('/casos', { empresa: 'servicios-basicos' })).cuerpo, [], 'cada empresa ve solo lo suyo')
}))

test('sin plan Premium no se crea el caso y el problema remite al catálogo', () => conServicio(async ({ pedir, repo }) => {
  const r = await abrir(pedir, { empresa: 'servicios-basicos' })
  assert.equal(r.status, 403)
  assert.match(r.tipo, /problem\+json/)
  assert.equal(r.cuerpo.title, 'Plan Premium requerido')
  assert.equal(repo.casos.length, 0)
  assert.equal(repo.usos.length, 0, 'lo que no se hizo no se mide')
  assert.equal((await pedir('/catalogo', { empresa: 'servicios-basicos' })).cuerpo.length, 2)
  assert.equal((await pedir('/perfil', { empresa: 'servicios-basicos' })).cuerpo.premium, false)
}))

test('la petición del caso llega a MS-06 como la de una entidad y queda pendiente', () => conServicio(async ({ pedir, autorizaciones }) => {
  const { cuerpo: caso } = await abrir(pedir)
  const r = await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: PETICION })
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.estado, 'pendiente')
  const [enviada] = autorizaciones.recibidas.values()
  assert.equal(enviada.entidad, 'tramites-premium')
  assert.deepEqual(enviada.pedidos, [{ titulo: 'Factura de energía' }])
  assert.equal(enviada.cedula, PETICION.cedula)
  const [c] = (await pedir('/casos')).cuerpo
  assert.equal(c.peticiones.length, 1)
}))

test('el estado de la petición sigue la decisión del ciudadano en MS-06', () => conServicio(async ({ pedir, autorizaciones }) => {
  const { cuerpo: caso } = await abrir(pedir)
  await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: PETICION })
  assert.equal((await pedir('/casos')).cuerpo[0].peticiones[0].estado, 'pendiente')
  ;[...autorizaciones.recibidas.values()][0].estado = 'atendida'
  assert.equal((await pedir('/casos')).cuerpo[0].peticiones[0].estado, 'atendida')
}))

test('si MS-06 no responde la petición no se crea ni se mide', () => conServicio(async ({ pedir, repo, autorizaciones }) => {
  const { cuerpo: caso } = await abrir(pedir)
  autorizaciones.falla = true
  const r = await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: PETICION })
  assert.equal(r.status, 502)
  assert.equal(repo.peticiones.length, 0)
  assert.equal(repo.usos.length, 1, 'solo el caso')
}))

test('el uso se mide por empresa: un caso y una petición', () => conServicio(async ({ pedir }) => {
  const { cuerpo: caso } = await abrir(pedir)
  await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: PETICION })
  await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: { ...PETICION, proposito: 'Otra' } })
  const { cuerpo: uso } = await pedir('/uso')
  assert.deepEqual(uso.map((u) => [u.servicio, u.total, u.subtotalCop]), [['caso-pqrs', 1, 5000], ['peticion-documentos', 2, 3000]])
  assert.ok((await pedir('/uso', { empresa: 'servicios-basicos' })).cuerpo.every((u) => u.total === 0))
}))

test('no se pide en el caso de otra empresa', () => conServicio(async ({ pedir }) => {
  const { cuerpo: caso } = await abrir(pedir)
  const r = await pedir(`/casos/${caso.id}/peticiones`, { metodo: 'POST', cuerpo: PETICION, empresa: 'otra-premium' })
  assert.equal(r.status, 404)
}))

for (const [caso, cambio] of [
  ['cédula inválida', { cedula: '12a' }],
  ['sin propósito', { proposito: ' ' }],
  ['sin documentos', { documentos: [] }],
  ['más de 10 documentos', { documentos: Array.from({ length: 11 }, (_, i) => ({ titulo: `d${i}` })) }],
  ['documento sin título', { documentos: [{ titulo: '' }] }],
]) {
  test(`petición inválida (${caso}): 422 en problem+json y no se mide`, () => conServicio(async ({ pedir, repo }) => {
    const { cuerpo: c } = await abrir(pedir)
    const r = await pedir(`/casos/${c.id}/peticiones`, { metodo: 'POST', cuerpo: { ...PETICION, ...cambio } })
    assert.equal(r.status, 422)
    assert.match(r.tipo, /problem\+json/)
    assert.equal(repo.usos.length, 1)
  }))
}

test('un caso sin asunto es inválido', () => conServicio(async ({ pedir }) => {
  assert.equal((await pedir('/casos', { metodo: 'POST', cuerpo: { asunto: ' ' } })).status, 422)
}))

test('solo una empresa con sesión del portal entra: sin token, con token de ciudadano o de otra audiencia', () => conServicio(async ({ pedir }) => {
  assert.equal((await pedir('/casos', { sinToken: true })).status, 401)
  assert.equal((await pedir('/casos', { jwt: await token({ azp: 'portal', cedula: '1012345678' }) })).status, 403, 'un ciudadano no es una empresa')
  assert.equal((await pedir('/casos', { jwt: await token({ azp: 'portal', empresa: 'tramites-premium' }, 'custodia') })).status, 401)
  assert.equal((await pedir('/casos', { empresa: 'desconocida' })).status, 403)
}))
