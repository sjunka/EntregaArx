import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conServicio, nuevoId, pasarelaFalsa, repositorioEnMemoria } from './doble.js'
import { ErrorPasarela } from '../src/pasarela.js'

// HU-04 · autenticación de un Temporal vía GovCarpeta. RF-06.6, RF-02.5, RI-01, RNF-21.
const CEDULA = '1012345678'
const ID = nuevoId()
const cargado = (extra = {}) => ({ id: ID, titular: CEDULA, titulo: 'Diploma', tipo: 'application/pdf', tamano: 10, clase: 'temporal', estado: 'cargado', sha256: 'c'.repeat(64), autenticacion: null, creado: new Date(), ...extra })
const con = (doc) => { const r = repositorioEnMemoria(); r.filas.set(doc.id, doc); return r }
const pedirAutenticacion = (pedir, opciones) => pedir(`/documentos/${ID}/autenticacion`, { metodo: 'POST', ...opciones })

test('a GovCarpeta solo viaja la URL de lectura, la cédula y el título; el documento sigue Cargado', () =>
  conServicio(async ({ pedir, pasarela, almacen }) => {
    const r = await pedirAutenticacion(pedir)
    assert.equal(r.status, 200)
    assert.deepEqual(pasarela.enviados, [{ idCiudadano: CEDULA, url: `https://almacen.test/${CEDULA}/${ID}?firma=2`, titulo: 'Diploma' }])
    assert.deepEqual(almacen.llamadas.urlLectura, [`${CEDULA}/${ID}`])
    assert.equal(r.cuerpo.estado, 'cargado', 'Autenticado es una marca, no un estado')
    assert.equal(r.cuerpo.clase, 'temporal')
    assert.equal(r.cuerpo.autenticacion.respuesta, 'Documento autenticado')
    assert.ok(Date.parse(r.cuerpo.autenticacion.fecha))
  }, { documentos: con(cargado()) }))

test('sigue consumiendo cuota después de autenticarse', () => {
  const documentos = con(cargado())
  return conServicio(async ({ pedir }) => {
    await pedirAutenticacion(pedir)
    assert.equal((await pedir('/cuota')).cuerpo.documentos.usados, 1)
    assert.equal((await pedir('/documentos')).cuerpo[0].autenticacion.respuesta, 'Documento autenticado')
  }, { documentos })
})

test('otro usuario o un documento inexistente reciben 403 y nada sale hacia GovCarpeta', () =>
  conServicio(async ({ pedir, pasarela, almacen }) => {
    assert.equal((await pedirAutenticacion(pedir, { cedula: '2000000002' })).status, 403)
    assert.equal((await pedir(`/documentos/${nuevoId()}/autenticacion`, { metodo: 'POST' })).status, 403)
    assert.equal(pasarela.enviados.length, 0)
    assert.equal(almacen.llamadas.urlLectura.length, 0)
  }, { documentos: con(cargado()) }))

test('un documento aún pendiente no se autentica: 409', () =>
  conServicio(async ({ pedir, pasarela }) => {
    const r = await pedirAutenticacion(pedir)
    assert.equal(r.status, 409)
    assert.match(r.tipo, /problem\+json/)
    assert.equal(pasarela.enviados.length, 0)
  }, { documentos: con(cargado({ estado: 'pendiente' })) }))

test('pedirlo otra vez devuelve la constancia guardada sin volver a llamar a GovCarpeta', () =>
  conServicio(async ({ pedir, pasarela }) => {
    const primera = await pedirAutenticacion(pedir)
    const segunda = await pedirAutenticacion(pedir)
    assert.equal(segunda.status, 200)
    assert.deepEqual(segunda.cuerpo.autenticacion, primera.cuerpo.autenticacion)
    assert.equal(pasarela.enviados.length, 1)
  }, { documentos: con(cargado()) }))

for (const [caso, error, esperado] of [
  ['rechazo de GovCarpeta', new ErrorPasarela(502, 'El centralizador rechazó la operación'), 502],
  ['pasarela sin respuesta', new ErrorPasarela(503, 'Centralizador no disponible'), 503],
  ['pasarela caída', new TypeError('fetch failed'), 503],
]) {
  test(`${caso}: ${esperado}, el documento sigue Cargado sin marca y se puede reintentar`, () => {
    const documentos = con(cargado())
    let falla = true
    const pasarela = { autenticar: async () => { if (falla) throw error; return { autenticado: true, respuesta: 'ok' } } }
    return conServicio(async ({ pedir }) => {
      const r = await pedirAutenticacion(pedir)
      assert.equal(r.status, esperado)
      assert.match(r.tipo, /problem\+json/)
      assert.equal((await documentos.buscar(ID)).autenticacion, null)
      assert.equal((await documentos.buscar(ID)).estado, 'cargado')
      falla = false
      assert.equal((await pedirAutenticacion(pedir)).status, 200)
    }, { documentos, pasarela })
  })
}
