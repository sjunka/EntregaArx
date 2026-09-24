import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio } from './doble.js'

// HU-13 · Traslado de salida en MS-04: la Carpeta se congela (solo lectura), el destino recibe URL prefirmadas de solo
// lectura (nunca credenciales del almacén) y los documentos se borran solo al cerrar. RF-03.2, RF-03.5, RI-01, RI-06.
const CEDULA = '1012345678'
const PDF = { titulo: 'Cédula', tipo: 'application/pdf', tamano: 100 }

async function subir(pedir, almacen, cedula = CEDULA, extra = PDF) {
  const { cuerpo: { id } } = await pedir('/documentos', { metodo: 'POST', cuerpo: extra, cedula })
  almacen.subir(`${cedula}/${id}`, extra.tamano, extra.tipo)
  await pedir(`/documentos/${id}/confirmacion`, { metodo: 'POST', cedula })
  return id
}
const congelar = (pedir, cedula = CEDULA, servicio = true) => pedir(`/interno/salida/${cedula}/congelacion`, { metodo: 'POST', servicio })

test('congelar entrega una URL de lectura por documento de la Carpeta, con la clase y sin credenciales del almacén', () =>
  conServicio(async ({ pedir, almacen, almacenCertificados, documentos }) => {
    const temporal = await subir(pedir, almacen)
    documentos.filas.set('c1', { id: 'c1', titular: CEDULA, titulo: 'Diploma', clase: 'certificado', estado: 'vigente', tipo: 'application/pdf', tamano: 5, emisor: 'universidad-demo' })
    documentos.filas.set('x1', { id: 'x1', titular: CEDULA, titulo: 'Rechazado', clase: 'certificado', estado: 'rechazado', tipo: 'application/pdf', tamano: 5 })
    const r = await congelar(pedir)
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo.documentos.map((d) => [d.id, d.titulo, d.clase]).sort(), [[temporal, 'Cédula', 'temporal'], ['c1', 'Diploma', 'certificado']].sort())
    for (const d of r.cuerpo.documentos) assert.match(d.url, /^https:\/\/almacen\.test\/.+\?firma=2$/)
    assert.ok(!JSON.stringify(r.cuerpo).match(/secret|accessKey|credential/i))
    assert.ok(almacen.llamadas.urlLectura.some(([c, o]) => c === `${CEDULA}/${temporal}` && o.vida === 24 * 3600), 'vida configurable, 24 horas por defecto')
    assert.ok(almacenCertificados.llamadas.urlLectura.length === 1, 'el Certificado se lee de su propio bucket')
    assert.equal(documentos.eventos.filter((e) => e.nombre === 'acceso.registrado').length, 0, 'el traslado no es un acceso de tercero')
  }))

test('con la Carpeta congelada el titular solo lee: subir, confirmar, autenticar y eliminar responden 409', () =>
  conServicio(async ({ pedir, almacen }) => {
    const id = await subir(pedir, almacen)
    await congelar(pedir)
    for (const [ruta, metodo, cuerpo] of [['/documentos', 'POST', PDF], [`/documentos/${id}/confirmacion`, 'POST'], [`/documentos/${id}/autenticacion`, 'POST'], [`/documentos/${id}`, 'DELETE']]) {
      const r = await pedir(ruta, { metodo, cuerpo })
      assert.equal(r.status, 409, `${metodo} ${ruta}`)
      assert.match(r.tipo, /problem\+json/)
    }
    assert.equal((await pedir('/documentos')).cuerpo.length, 1, 'la lista sigue disponible')
    assert.equal((await pedir(`/documentos/${id}/descarga`)).status, 200, 'y la descarga')
    assert.equal((await pedir('/documentos', { cedula: '2000000002' })).status, 200)
    assert.equal((await pedir('/documentos', { metodo: 'POST', cuerpo: PDF, cedula: '2000000002' })).status, 201, 'otra Carpeta no se afecta')
  }))

test('un Certificado que llega durante el traslado se rechaza con 409: no se pierde con el borrado', () =>
  conServicio(async ({ pedir }) => {
    await congelar(pedir)
    const r = await pedir('/interno/certificados', { metodo: 'POST', servicio: true, cuerpo: { emisor: 'universidad-demo', idExterno: 'x', cedula: CEDULA, titulo: 'Diploma', tipo: 'application/pdf', tamano: 5, sha256: 'a'.repeat(64), firmaValida: true } })
    assert.equal(r.status, 409)
  }))

test('reabrir devuelve la Carpeta a lectura y escritura (el destino rechazó el traslado)', () =>
  conServicio(async ({ pedir }) => {
    await congelar(pedir)
    assert.equal((await pedir(`/interno/salida/${CEDULA}/congelacion`, { metodo: 'DELETE', servicio: true })).status, 200)
    assert.equal((await pedir('/documentos', { metodo: 'POST', cuerpo: PDF })).status, 201)
  }))

test('cerrar borra documentos y archivos de la Carpeta congelada, y solo de esa', () =>
  conServicio(async ({ pedir, almacen, documentos }) => {
    const id = await subir(pedir, almacen)
    const ajeno = await subir(pedir, almacen, '2000000002')
    await congelar(pedir)
    assert.equal((await pedir(`/interno/salida/${CEDULA}`, { metodo: 'DELETE', servicio: true })).status, 200)
    assert.equal(almacen.objetos.has(`${CEDULA}/${id}`), false)
    assert.equal(documentos.filas.has(id), false)
    assert.equal(almacen.objetos.has(`2000000002/${ajeno}`), true)
    assert.equal((await pedir(`/interno/salida/${CEDULA}`, { metodo: 'DELETE', servicio: true })).status, 200, 'idempotente')
  }))

test('cerrar una Carpeta que no está congelada responde 409: nada se borra sin el traslado en curso', () =>
  conServicio(async ({ pedir, almacen, documentos }) => {
    const id = await subir(pedir, almacen)
    const r = await pedir(`/interno/salida/${CEDULA}`, { metodo: 'DELETE', servicio: true })
    assert.equal(r.status, 409)
    assert.ok(documentos.filas.has(id))
  }))

test('las rutas de salida son solo del servicio de interoperabilidad', () =>
  conServicio(async ({ pedir }) => {
    assert.equal((await congelar(pedir, CEDULA, false)).status, 403, 'un ciudadano no llama a /interno')
    assert.equal((await pedir(`/interno/salida/${CEDULA}/congelacion`, { metodo: 'POST', servicio: 'premium' })).status, 403)
    assert.equal((await congelar(pedir, 'abc')).status, 422)
  }))
