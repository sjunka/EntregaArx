import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, nuevoId, repositorioEnMemoria } from './doble.js'

// HU-06 · consulta y descarga. RF-02.7, RNF-01, RNF-04: URL prefirmada de corta vida y cada descarga queda registrada.
const CEDULA = '1012345678'

function conDocumento(documentos, extra = {}) {
  const id = nuevoId()
  documentos.filas.set(id, { id, titular: CEDULA, titulo: 'Diploma de Ingeniería', clase: 'temporal', estado: 'cargado', tipo: 'application/pdf', tamano: 100, creado: new Date(), ...extra })
  return id
}

test('el titular descarga con una URL prefirmada de 60 s y el acceso queda en la bandeja hacia auditoría', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen }) => {
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    const r = await pedir(`/documentos/${id}/descarga`)
    assert.equal(r.status, 200)
    assert.match(r.cuerpo.url, /^https:\/\/almacen\.test\//)
    assert.ok(new Date(r.cuerpo.venceEn) - Date.now() <= 60_000)
    assert.deepEqual(almacen.llamadas.urlLectura, [[`${CEDULA}/${id}`, { vida: 60, nombre: 'Diploma de Ingeniería.pdf' }]])
    assert.deepEqual(documentos.eventos, [{ nombre: 'acceso.registrado', datos: {
      documentoId: id, cedula: CEDULA, titulo: 'Diploma de Ingeniería', accion: 'descarga', actor: { tipo: 'titular', id: CEDULA },
    } }])
  }, { documentos })
})

test('un Certificado se descarga del bucket de certificados', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos, { clase: 'certificado', estado: 'vigente', emisor: 'universidad-demo', tipo: 'image/jpeg' })
  return conServicio(async ({ pedir, almacen, almacenCertificados }) => {
    almacenCertificados.subir(`${CEDULA}/${id}`, 100, 'image/jpeg')
    const r = await pedir(`/documentos/${id}/descarga`)
    assert.equal(r.status, 200)
    assert.match(r.cuerpo.url, /^https:/)
    assert.equal(almacenCertificados.llamadas.urlLectura[0][1].nombre, 'Diploma de Ingeniería.jpg')
    assert.equal(almacen.llamadas.urlLectura.length, 0)
  }, { documentos })
})

test('el documento de otro titular responde 403 sin firmar URL ni registrar acceso', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen }) => {
    const r = await pedir(`/documentos/${id}/descarga`, { cedula: '2000000002' })
    assert.equal(r.status, 403)
    assert.equal(almacen.llamadas.urlLectura.length, 0)
    assert.equal(documentos.eventos.length, 0)
  }, { documentos })
})

test('solo se descargan documentos que están en la Carpeta', () => {
  const documentos = repositorioEnMemoria()
  const pendiente = conDocumento(documentos, { estado: 'pendiente' })
  const eliminado = conDocumento(documentos, { estado: 'eliminado' })
  return conServicio(async ({ pedir }) => {
    for (const id of [pendiente, eliminado]) {
      const r = await pedir(`/documentos/${id}/descarga`)
      assert.equal(r.status, 409)
      assert.match(r.tipo, /problem\+json/)
    }
    assert.equal(documentos.eventos.length, 0)
  }, { documentos })
})

test('almacén caído: 503 con mensaje para reintentar y sin registrar un acceso que no ocurrió', () => {
  const documentos = repositorioEnMemoria()
  const id = conDocumento(documentos)
  return conServicio(async ({ pedir, almacen }) => {
    almacen.caido = true
    const r = await pedir(`/documentos/${id}/descarga`)
    assert.equal(r.status, 503)
    assert.match(r.tipo, /problem\+json/)
    assert.match(r.cuerpo.detail, /sigue en tu carpeta/)
    assert.equal(documentos.eventos.length, 0)
    almacen.caido = false
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    assert.equal((await pedir(`/documentos/${id}/descarga`)).status, 200, 'reintentar funciona')
  }, { documentos })
})

test('confirmar la carga, autenticar y eliminar dejan su evento en la misma operación', () =>
  conServicio(async ({ pedir, documentos, almacen }) => {
    const { cuerpo: { id } } = await pedir('/documentos', { metodo: 'POST', cuerpo: { titulo: 'Cédula', tipo: 'application/pdf', tamano: 100 } })
    almacen.subir(`${CEDULA}/${id}`, 100, 'application/pdf')
    await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST' })
    await pedir(`/documentos/${id}/autenticacion`, { metodo: 'POST' })
    await pedir(`/documentos/${id}`, { metodo: 'DELETE' })
    assert.deepEqual(documentos.eventos.map((e) => e.nombre), ['documento.cargado', 'documento.autenticado', 'documento.eliminado'])
    assert.deepEqual(documentos.eventos[0].datos, { id, cedula: CEDULA, clase: 'temporal', titulo: 'Cédula', tipo: 'application/pdf', tamano: 100 })
  }))
