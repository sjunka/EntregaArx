import { test } from 'node:test'
import assert from 'node:assert/strict'
import { almacenFalso, conServicio, nuevoId, repositorioEnMemoria } from './doble.js'

// HU-05 · recepción de Certificado. RF-03.2, RF-03.3, RNF-24.
const CEDULA = '1012345678'
const SHA = 'a'.repeat(64)
const CERT = { emisor: 'universidad-demo', idExterno: 'dip-001', cedula: CEDULA, titulo: 'Diploma de Ingeniería', tipo: 'application/pdf', tamano: 2000, sha256: SHA, firmaValida: true }
const registrar = (pedir, cuerpo = CERT) => pedir('/interno/certificados', { metodo: 'POST', cuerpo, servicio: true })
const verificar = (pedir, id) => pedir(`/interno/certificados/${id}/verificacion`, { metodo: 'POST', servicio: true })

test('firma válida: queda Recibido, con URL al bucket de certificados y fuera de la Carpeta', () =>
  conServicio(async ({ pedir, almacenCertificados, almacen }) => {
    const r = await registrar(pedir)
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.existente, false)
    assert.equal(r.cuerpo.documento.estado, 'recibido')
    assert.equal(r.cuerpo.documento.clase, 'certificado')
    assert.equal(r.cuerpo.documento.emisor, 'universidad-demo')
    assert.match(r.cuerpo.urlCarga, new RegExp(`^http://almacen\\.test/certificados/${CEDULA}/${r.cuerpo.documento.id}\\?`))
    assert.deepEqual(almacenCertificados.llamadas.urlCarga, [[`${CEDULA}/${r.cuerpo.documento.id}`, 'application/pdf']])
    assert.equal(almacen.llamadas.urlCarga.length, 0, 'los certificados no van al bucket de Temporales')
    assert.deepEqual((await pedir('/documentos')).cuerpo, [])
  }))

test('firma inválida: queda Rechazado, sin URL y sin entrar a la Carpeta', () =>
  conServicio(async ({ pedir, almacenCertificados }) => {
    const r = await registrar(pedir, { ...CERT, firmaValida: false, motivo: 'La firma no verifica con la llave del emisor' })
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.documento.estado, 'rechazado')
    assert.equal(r.cuerpo.urlCarga, undefined)
    assert.equal(almacenCertificados.llamadas.urlCarga.length, 0)
    assert.deepEqual((await pedir('/documentos')).cuerpo, [])
    assert.equal(r.cuerpo.documento.motivo, 'La firma no verifica con la llave del emisor')
    assert.equal((await verificar(pedir, r.cuerpo.documento.id)).cuerpo.documento.estado, 'rechazado', 'un rechazado no se revive')
  }))

test('recepción idempotente: el reenvío no duplica y devuelve el mismo documento', () =>
  conServicio(async ({ pedir, documentos }) => {
    const primera = await registrar(pedir)
    const segunda = await registrar(pedir)
    assert.equal(segunda.status, 200)
    assert.equal(segunda.cuerpo.existente, true)
    assert.equal(segunda.cuerpo.documento.id, primera.cuerpo.documento.id)
    assert.match(segunda.cuerpo.urlCarga, /^http/, 'sigue Recibido: puede subir el archivo')
    assert.equal(documentos.filas.size, 1)
    const otro = await registrar(pedir, { ...CERT, idExterno: 'dip-002' })
    assert.equal(otro.status, 201)
    const otroEmisor = await registrar(pedir, { ...CERT, emisor: 'otra-entidad' })
    assert.equal(otroEmisor.status, 201, 'el idExterno es por emisor')
  }))

for (const [caso, cambio] of [
  ['tipo no permitido', { tipo: 'application/zip' }], ['tamaño excesivo', { tamano: 10 * 1024 * 1024 + 1 }],
  ['sha256 mal formado', { sha256: 'xyz' }], ['cédula inválida', { cedula: '12a' }], ['sin título', { titulo: ' ' }], ['sin emisor', { emisor: '' }],
]) {
  test(`metadatos inválidos (${caso}): 422 sin registrar nada`, () =>
    conServicio(async ({ pedir, documentos }) => {
      const r = await registrar(pedir, { ...CERT, ...cambio })
      assert.equal(r.status, 422)
      assert.match(r.tipo, /problem\+json/)
      assert.equal(documentos.filas.size, 0)
    }))
}

function subido(almacenCertificados, id, extra = {}) {
  almacenCertificados.subir(`${CEDULA}/${id}`, extra.tamano ?? 2000, extra.tipo ?? 'application/pdf', extra.sha256 ?? SHA)
}

test('verificación: Recibido, Verificado y Vigente; entra a la Carpeta y no consume cuota', () =>
  conServicio(async ({ pedir, almacenCertificados, documentos }) => {
    const { documento } = (await registrar(pedir)).cuerpo
    subido(almacenCertificados, documento.id)
    const r = await verificar(pedir, documento.id)
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.cambio, true)
    assert.equal(r.cuerpo.sustituyeA, undefined)
    assert.equal(r.cuerpo.documento.estado, 'vigente')
    assert.equal(r.cuerpo.documento.titular, CEDULA, 'las rutas internas dicen a quién pertenece')
    assert.deepEqual(documentos.transiciones.map(([, e]) => e), ['recibido', 'verificado', 'vigente'])
    const carpeta = (await pedir('/documentos')).cuerpo
    assert.equal(carpeta.length, 1)
    assert.equal(carpeta[0].clase, 'certificado')
    assert.equal(carpeta[0].emisor, 'universidad-demo')
    assert.deepEqual((await pedir('/cuota')).cuerpo.documentos, { usados: 0, maximo: 20 })
  }))

test('verificar otra vez no cambia nada (cambio: false)', () =>
  conServicio(async ({ pedir, almacenCertificados }) => {
    const { documento } = (await registrar(pedir)).cuerpo
    subido(almacenCertificados, documento.id)
    await verificar(pedir, documento.id)
    const r = await verificar(pedir, documento.id)
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.cambio, false)
    assert.equal(r.cuerpo.documento.estado, 'vigente')
  }))

test('el archivo aún no llegó: 409 y sigue Recibido', () =>
  conServicio(async ({ pedir, documentos }) => {
    const { documento } = (await registrar(pedir)).cuerpo
    const r = await verificar(pedir, documento.id)
    assert.equal(r.status, 409)
    assert.equal((await documentos.buscar(documento.id)).estado, 'recibido')
  }))

for (const [caso, extra] of [
  ['SHA-256 distinto al declarado', { sha256: 'b'.repeat(64) }], ['tamaño distinto', { tamano: 1999 }], ['tipo distinto', { tipo: 'image/png' }],
]) {
  test(`${caso}: Rechazado, se borra el objeto y no entra a la Carpeta`, () =>
    conServicio(async ({ pedir, almacenCertificados, documentos }) => {
      const { documento } = (await registrar(pedir)).cuerpo
      subido(almacenCertificados, documento.id, extra)
      const r = await verificar(pedir, documento.id)
      assert.equal(r.status, 200)
      assert.equal(r.cuerpo.documento.estado, 'rechazado')
      assert.equal(r.cuerpo.cambio, false)
      assert.deepEqual(almacenCertificados.llamadas.borrar, [`${CEDULA}/${documento.id}`])
      assert.equal((await documentos.buscar(documento.id)).estado, 'rechazado')
      assert.deepEqual((await pedir('/documentos')).cuerpo, [])
    }))
}

function conTemporal(documentos, extra = {}) {
  const id = nuevoId()
  documentos.filas.set(id, { id, titular: CEDULA, titulo: 'diploma de ingenieria', tipo: 'application/pdf', tamano: 500, clase: 'temporal', estado: 'cargado', sha256: null, autenticacion: null, creado: new Date('2026-01-01'), ...extra })
  return id
}

test('un Temporal equivalente (mismo título normalizado) queda Sustituido y enlazado al Certificado', () => {
  const documentos = repositorioEnMemoria()
  const viejo = conTemporal(documentos, { creado: new Date('2026-01-01') })
  const nuevo = conTemporal(documentos, { creado: new Date('2026-02-01') })
  const otroTitular = conTemporal(documentos, { titular: '2000000002' })
  const otroTitulo = conTemporal(documentos, { titulo: 'Recibo de servicios' })
  const eliminado = conTemporal(documentos, { estado: 'eliminado', creado: new Date('2025-01-01') })
  return conServicio(async ({ pedir, almacenCertificados }) => {
    assert.equal((await pedir('/cuota')).cuerpo.documentos.usados, 3)
    const { documento } = (await registrar(pedir)).cuerpo
    subido(almacenCertificados, documento.id)
    const r = await verificar(pedir, documento.id)
    assert.equal(r.cuerpo.sustituyeA, viejo, 'el más antiguo Cargado')
    assert.equal((await documentos.buscar(viejo)).estado, 'sustituido')
    assert.equal((await documentos.buscar(viejo)).sustituidoPor, documento.id)
    for (const intacto of [nuevo, otroTitular, otroTitulo]) assert.equal((await documentos.buscar(intacto)).estado, 'cargado')
    assert.equal((await documentos.buscar(eliminado)).estado, 'eliminado')
    // El Sustituido sale de la cuota y la Carpeta lo muestra enlazado.
    assert.equal((await pedir('/cuota')).cuerpo.documentos.usados, 2)
    const carpeta = (await pedir('/documentos')).cuerpo
    assert.equal(carpeta.find((d) => d.id === viejo).sustituidoPor, documento.id)
    assert.equal(carpeta.find((d) => d.id === viejo).estado, 'sustituido')
  }, { documentos })
})

test('un Certificado no se puede eliminar; un Temporal sí y libera cuota', () => {
  const documentos = repositorioEnMemoria()
  const temporal = conTemporal(documentos, { titulo: 'Otro papel' })
  return conServicio(async ({ pedir, almacenCertificados, almacen }) => {
    const { documento } = (await registrar(pedir)).cuerpo
    subido(almacenCertificados, documento.id)
    await verificar(pedir, documento.id)
    const c = await pedir(`/documentos/${documento.id}`, { metodo: 'DELETE' })
    assert.equal(c.status, 409)
    assert.match(c.tipo, /problem\+json/)
    assert.match(c.cuerpo.detail, /perpetuidad/)
    assert.equal((await documentos.buscar(documento.id)).estado, 'vigente')

    assert.equal((await pedir(`/documentos/${temporal}`, { metodo: 'DELETE', cedula: '2000000002' })).status, 403)
    const t = await pedir(`/documentos/${temporal}`, { metodo: 'DELETE' })
    assert.equal(t.status, 204)
    assert.deepEqual(almacen.llamadas.borrar, [`${CEDULA}/${temporal}`])
    assert.equal((await pedir('/cuota')).cuerpo.documentos.usados, 0)
  }, { documentos })
})

test('las rutas internas exigen token de servicio; el ciudadano recibe 403 y el servicio no ve la Carpeta', () =>
  conServicio(async ({ pedir }) => {
    const ciudadano = await pedir('/interno/certificados', { metodo: 'POST', cuerpo: CERT })
    assert.equal(ciudadano.status, 403)
    assert.equal((await registrar(pedir, {})).status, 422)
    assert.equal((await pedir('/interno/certificados', { metodo: 'POST', cuerpo: CERT, servicio: 'otro-servicio' })).status, 403)
    assert.equal((await pedir('/documentos', { servicio: true })).status, 401, 'un token de servicio no es de ciudadano')
    assert.equal((await pedir(`/interno/certificados/${nuevoId()}/verificacion`, { metodo: 'POST', servicio: true })).status, 404)
  }))
