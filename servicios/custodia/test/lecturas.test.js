import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, nuevoId, repositorioEnMemoria } from './doble.js'

// HU-07 · RI-08: MS-06 decide antes de que MS-04 firme una URL de lectura para un tercero. RF-04.4, RF-04.5.
const CEDULA = '1012345678'
const TERCERO = 'entidad:universidad-demo'

function conDocumento(documentos, extra = {}) {
  const id = nuevoId()
  documentos.filas.set(id, { id, titular: CEDULA, titulo: 'Diploma de Ingeniería', clase: 'temporal', estado: 'cargado', tipo: 'application/pdf', tamano: 100, creado: new Date(), ...extra })
  return id
}
const leer = (pedir, cuerpo, servicio = true) => pedir('/interno/lecturas', { metodo: 'POST', cuerpo, servicio })

test('con autorización vigente entrega una URL de 5 minutos y registra el acceso del tercero', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen, autorizaciones }) => {
    autorizaciones.permitir(CEDULA, id, TERCERO)
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    const r = await leer(pedir, { documentoId: id, tercero: TERCERO })
    assert.equal(r.status, 200)
    assert.match(r.cuerpo.url, /^https:/)
    assert.equal(r.cuerpo.titulo, 'Diploma de Ingeniería')
    assert.ok(new Date(r.cuerpo.venceEn) - Date.now() <= 300_000)
    assert.deepEqual(autorizaciones.consultas, [{ cedula: CEDULA, documentoId: id, tercero: TERCERO }], 'pregunta a MS-06 con el titular real del documento')
    assert.equal(almacen.llamadas.urlLectura[0][1].vida, 300)
    assert.deepEqual(documentos.eventos, [{ nombre: 'acceso.registrado', datos: {
      documentoId: id, cedula: CEDULA, titulo: 'Diploma de Ingeniería', accion: 'lectura-tercero', actor: { tipo: 'tercero', id: TERCERO },
    } }])
  }, { documentos })
})

test('sin autorización vigente (no concedida, revocada o vencida) no firma nada ni registra acceso: 403', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen, autorizaciones }) => {
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    const r = await leer(pedir, { documentoId: id, tercero: TERCERO })
    assert.equal(r.status, 403)
    assert.match(r.tipo, /problem\+json/)
    assert.equal(autorizaciones.consultas.length, 1, 'la decisión se pidió antes de firmar')
    assert.equal(almacen.llamadas.urlLectura.length, 0)
    assert.equal(documentos.eventos.length, 0)
    autorizaciones.permitir(CEDULA, id, 'entidad:otra')
    assert.equal((await leer(pedir, { documentoId: id, tercero: TERCERO })).status, 403, 'la autorización es para otro tercero')
  }, { documentos })
})

test('si MS-06 no responde la custodia no firma: falla cerrada con 503', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen, autorizaciones }) => {
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    autorizaciones.permitir(CEDULA, id, TERCERO)
    autorizaciones.caido = true
    const r = await leer(pedir, { documentoId: id, tercero: TERCERO })
    assert.equal(r.status, 503)
    assert.equal(almacen.llamadas.urlLectura.length, 0)
    assert.equal(documentos.eventos.length, 0)
  }, { documentos })
})

test('un documento que no está en la Carpeta o no existe: 404 sin consultar autorizaciones', () => {
  const documentos = repositorioEnMemoria()
  const pendiente = conDocumento(documentos, { estado: 'pendiente' })
  const eliminado = conDocumento(documentos, { estado: 'eliminado' })
  return conServicio(async ({ pedir, autorizaciones }) => {
    for (const id of [pendiente, eliminado, nuevoId()]) assert.equal((await leer(pedir, { documentoId: id, tercero: TERCERO })).status, 404)
    assert.equal(autorizaciones.consultas.length, 0)
  }, { documentos })
})

test('un Certificado se lee del bucket de certificados', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos, { clase: 'certificado', estado: 'vigente', tipo: 'image/png' })
  return conServicio(async ({ pedir, almacen, almacenCertificados, autorizaciones }) => {
    autorizaciones.permitir(CEDULA, id, TERCERO)
    almacenCertificados.subir(`${CEDULA}/${id}`, 100, 'image/png')
    assert.equal((await leer(pedir, { documentoId: id, tercero: TERCERO })).status, 200)
    assert.equal(almacenCertificados.llamadas.urlLectura.length, 1)
    assert.equal(almacen.llamadas.urlLectura.length, 0)
  }, { documentos })
})

test('almacén caído: 503 y sin acceso registrado', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen, autorizaciones }) => {
    autorizaciones.permitir(CEDULA, id, TERCERO)
    almacen.caido = true
    assert.equal((await leer(pedir, { documentoId: id, tercero: TERCERO })).status, 503)
    assert.equal(documentos.eventos.length, 0)
  }, { documentos })
})

test('solo la interoperabilidad lee para terceros, y la solicitud se valida', () => conServicio(async ({ pedir }) => {
  const id = nuevoId()
  assert.equal((await pedir('/interno/lecturas', { metodo: 'POST', cuerpo: { documentoId: id, tercero: TERCERO } })).status, 403, 'un ciudadano no')
  assert.equal((await leer(pedir, { documentoId: id, tercero: TERCERO }, 'otro-servicio')).status, 403)
  for (const cuerpo of [{ tercero: TERCERO }, { documentoId: 'no-es-uuid', tercero: TERCERO }, { documentoId: id }, { documentoId: id, tercero: '' }]) {
    assert.equal((await leer(pedir, cuerpo)).status, 422, JSON.stringify(cuerpo))
  }
}))

test('el cliente de MS-06 pide la decisión con su token de servicio y falla si la respuesta no es 200', async () => {
  const { crearAutorizaciones } = await import('../src/autorizaciones.js')
  const { createServer } = await import('node:http')
  let visto
  const srv = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      visto = { ruta: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(cuerpo) }
      res.writeHead(req.headers['x-falla'] ? 500 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ permitida: true }))
    })
  }).listen(0)
  try {
    const url = `http://127.0.0.1:${srv.address().port}`
    const cliente = crearAutorizaciones({ url, token: async () => 'tok' })
    assert.deepEqual(await cliente.decidir({ cedula: CEDULA, documentoId: 'd', tercero: TERCERO }), { permitida: true })
    assert.deepEqual(visto, { ruta: '/interno/decisiones', auth: 'Bearer tok', cuerpo: { cedula: CEDULA, documentoId: 'd', tercero: TERCERO } })
    await assert.rejects(crearAutorizaciones({ url: 'http://127.0.0.1:1', token: async () => 't', timeoutMs: 500 }).decidir({}), /./)
  } finally { srv.close() }
})
