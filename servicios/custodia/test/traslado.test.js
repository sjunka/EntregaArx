import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { conServicio, repositorioEnMemoria } from './doble.js'
import { crearDescargador, ErrorOrigen } from '../src/traslado.js'

// HU-09 · Traslado de entrada: MS-04 descarga cada documento de la URL del origen y lo guarda en su almacén.
// RF-03.3, RF-03.5, RF-03.8, RNF-22, RI-03. El formato del curso no declara tipo, tamaño ni huella: los calcula la custodia (ADR-0027).
const CEDULA = '1012345678'
const ORIGEN = 'operador-origen'
const bytes = (t) => Buffer.from(`%PDF-1.4\n% ${t}\n`)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const URL_DOC = (n) => `https://origen.test/documentos/${n}?firma=1`
const doc = (n, _b, extra = {}) => ({ operador: ORIGEN, idExterno: `doc-${n}`, cedula: CEDULA, titulo: `Documento ${n}`, clase: 'temporal', url: URL_DOC(n), ...extra })
const recibir = (pedir, cuerpo, servicio = true) => pedir('/interno/traslados/documentos', { metodo: 'POST', cuerpo, servicio })

test('un Temporal llega Cargado, al bucket de Temporales, sin consumir cuota y con su evento hacia el índice', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, documentos, almacen, almacenCertificados, descargador }) => {
    descargador.paginas.set(URL_DOC(1), b)
    const r = await recibir(pedir, doc(1, b))
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.documento.estado, 'cargado')
    assert.equal(r.cuerpo.documento.clase, 'temporal')
    const clave = `${CEDULA}/${r.cuerpo.documento.id}`
    assert.equal(almacen.objetos.get(clave).sha256, sha(b), 'el archivo quedó íntegro en el almacén')
    assert.equal(almacenCertificados.objetos.size, 0)
    assert.deepEqual(documentos.eventos.map((e) => e.nombre), ['documento.cargado'])
    assert.deepEqual(documentos.eventos[0].datos, { id: r.cuerpo.documento.id, cedula: CEDULA, clase: 'temporal', titulo: 'Documento 1', tipo: 'application/pdf', tamano: b.length })
    assert.deepEqual((await pedir('/cuota')).cuerpo.documentos, { usados: 0, maximo: 20 }, 'el traslado no consume la cuota')
    assert.equal((await pedir('/documentos')).cuerpo.length, 1, 'está en su Carpeta')
  })
})

test('un Certificado conserva su clase: queda Vigente en el bucket de certificados con su emisor original', () => {
  const b = bytes('diploma')
  return conServicio(async ({ pedir, documentos, almacen, almacenCertificados, descargador }) => {
    descargador.paginas.set(URL_DOC(2), b)
    const r = await recibir(pedir, doc(2, b, { clase: 'certificado', emisor: 'universidad-original', titulo: 'Diploma' }))
    assert.equal(r.status, 201)
    assert.deepEqual([r.cuerpo.documento.clase, r.cuerpo.documento.estado, r.cuerpo.documento.emisor], ['certificado', 'vigente', 'universidad-original'])
    assert.equal(almacenCertificados.objetos.size, 1)
    assert.equal(almacen.objetos.size, 0)
    assert.equal(documentos.eventos[0].datos.emisor, 'universidad-original')
    const eliminar = await pedir(`/documentos/${r.cuerpo.documento.id}`, { metodo: 'DELETE' })
    assert.equal(eliminar.status, 409, 'sigue sin poder eliminarse')
  })
})

test('idempotente: el mismo documento del mismo origen no se descarga ni se guarda dos veces', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, documentos, almacen, descargador }) => {
    descargador.paginas.set(URL_DOC(1), b)
    const primera = await recibir(pedir, doc(1, b))
    const segunda = await recibir(pedir, doc(1, b))
    assert.equal(segunda.status, 200)
    assert.equal(segunda.cuerpo.documento.id, primera.cuerpo.documento.id)
    assert.equal(descargador.llamadas.length, 1)
    assert.equal(almacen.objetos.size, 1)
    assert.equal(documentos.eventos.length, 1)
    // Otro origen con el mismo identificador es otro documento.
    descargador.paginas.set(URL_DOC(1), b)
    assert.equal((await recibir(pedir, doc(1, b, { operador: 'otro-operador' }))).status, 201)
  })
})

test('un fallo de descarga responde 502, no guarda nada y el reintento funciona sin duplicar', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, documentos, almacen, descargador }) => {
    const r = await recibir(pedir, doc(1, b)) // el origen respondió 404
    assert.equal(r.status, 502)
    assert.match(r.tipo, /problem\+json/)
    assert.equal(almacen.objetos.size, 0)
    assert.equal(documentos.filas.size, 0)
    descargador.paginas.set(URL_DOC(1), new Error('origen caído'))
    assert.equal((await recibir(pedir, doc(1, b))).status, 502)
    descargador.paginas.set(URL_DOC(1), b)
    assert.equal((await recibir(pedir, doc(1, b))).status, 201)
    assert.equal(documentos.filas.size, 1)
  })
})

test('el tipo sale del contenido: PNG y JPG se reconocen y otro formato se rechaza con 422 sin guardar nada', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')])
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg')])
  return conServicio(async ({ pedir, documentos, almacen, descargador }) => {
    descargador.paginas.set(URL_DOC(1), Buffer.from('PK\x03\x04 un zip'))
    const zip = await recibir(pedir, doc(1))
    assert.equal(zip.status, 422)
    assert.match(zip.cuerpo.detail, /PDF, JPG o PNG/)
    assert.equal(almacen.objetos.size, 0)
    assert.equal(documentos.filas.size, 0)
    descargador.paginas.set(URL_DOC(2), png)
    descargador.paginas.set(URL_DOC(3), jpg)
    assert.equal((await recibir(pedir, doc(2))).cuerpo.documento.tipo, 'image/png')
    assert.equal((await recibir(pedir, doc(3))).cuerpo.documento.tipo, 'image/jpeg')
    assert.equal(almacen.objetos.get(`${CEDULA}/${[...documentos.filas.keys()][0]}`).sha256, sha(png), 'la huella se calcula aquí')
  })
})

test('una URL que la política rechaza (p. ej. la red interna) responde 422 sin descargar', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, descargador }) => {
    descargador.paginas.set(URL_DOC(1), new ErrorOrigen('La dirección del documento no está permitida.', { politica: true }))
    const r = await recibir(pedir, doc(1, b))
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.detail, /no está permitida/)
  })
})

test('si el almacén no responde: 503 y no queda registro del documento', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, documentos, almacen, descargador }) => {
    descargador.paginas.set(URL_DOC(1), b)
    almacen.noGuarda = true
    assert.equal((await recibir(pedir, doc(1, b))).status, 503)
    assert.equal(documentos.filas.size, 0)
    almacen.noGuarda = false
    assert.equal((await recibir(pedir, doc(1, b))).status, 201, 'el reintento sale bien')
  })
})

test('descartar un traslado borra solo lo que llegó de ese origen para ese titular, con sus objetos y eventos, y es idempotente', () => {
  const b = bytes('cédula')
  const documentos = repositorioEnMemoria()
  return conServicio(async ({ pedir, almacen, descargador }) => {
    for (const n of [1, 2]) { descargador.paginas.set(URL_DOC(n), b); await recibir(pedir, doc(n, b)) }
    descargador.paginas.set(URL_DOC(3), b)
    await recibir(pedir, doc(3, b, { operador: 'otro-operador' }))
    const { cuerpo: { id: propio } } = await pedir('/documentos', { metodo: 'POST', cuerpo: { titulo: 'Subido por mí', tipo: 'application/pdf', tamano: 5 } })
    documentos.eventos.length = 0
    const r = await pedir(`/interno/traslados/${CEDULA}?operador=${ORIGEN}`, { metodo: 'DELETE', servicio: true })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.descartados, 2)
    assert.deepEqual(documentos.eventos.map((e) => e.nombre), ['documento.eliminado', 'documento.eliminado'])
    assert.equal(almacen.llamadas.borrar.length, 2)
    assert.equal(documentos.filas.size, 2, 'quedan el de otro origen y el que subió el ciudadano')
    assert.ok(documentos.filas.has(propio))
    assert.equal((await pedir(`/interno/traslados/${CEDULA}?operador=${ORIGEN}`, { metodo: 'DELETE', servicio: true })).cuerpo.descartados, 0)
    assert.equal((await pedir(`/interno/traslados/${CEDULA}`, { metodo: 'DELETE', servicio: true })).status, 422, 'exige el origen')
  }, { documentos })
})

test('solo la interoperabilidad recibe o descarta traslados y el documento se valida', () => {
  const b = bytes('cédula')
  return conServicio(async ({ pedir, descargador }) => {
    descargador.paginas.set(URL_DOC(1), b)
    assert.equal((await recibir(pedir, doc(1, b), 'otro-servicio')).status, 403)
    assert.equal((await pedir('/interno/traslados/documentos', { metodo: 'POST', cuerpo: doc(1, b) })).status, 403, 'un ciudadano no')
    for (const cambio of [{ clase: 'otra' }, { clase: 'certificado' }, { titulo: '' }, { cedula: 'abc' }, { url: 'no-es-url' }, { idExterno: '' }, { operador: '' }]) {
      const r = await recibir(pedir, doc(1, b, cambio))
      assert.equal(r.status, 422, JSON.stringify(cambio))
    }
    assert.equal(descargador.llamadas.length, 0, 'nada inválido llega a descargarse')
  })
})

// El descargador real: política de URL, límite de tamaño y sin redirecciones.
async function conOrigen(respuesta, prueba) {
  const srv = createServer(respuesta).listen(0, '127.0.0.1')
  await new Promise((ok) => srv.once('listening', ok))
  try { await prueba(`http://127.0.0.1:${srv.address().port}`) } finally { srv.close(); srv.closeAllConnections?.() }
}

test('descargador: solo https salvo hosts internos permitidos, y nunca direcciones privadas por su cuenta', async () => {
  const d = crearDescargador({ hostsInternos: [] })
  for (const url of ['http://origen.test/x', 'ftp://origen.test/x', 'file:///etc/passwd', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://localhost/x']) {
    await assert.rejects(d(url, { tamano: 10 }), (e) => e instanceof ErrorOrigen && e.politica === true, url)
  }
})

test('descargador: baja el archivo de un host interno permitido y respeta el tope de tamaño', async () => {
  await conOrigen((req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }).end(Buffer.alloc(100, 1)) }, async (base) => {
    const url = `${base}/doc`
    const d = crearDescargador({ hostsInternos: ['127.0.0.1'] })
    assert.equal((await d(url, { tamano: 100 })).length, 100)
    await assert.rejects(d(url, { tamano: 50 }), (e) => e instanceof ErrorOrigen && !e.politica, 'más grande que el tope')
  })
})

test('descargador: un error del origen y una redirección fallan sin seguirla', async () => {
  await conOrigen((req, res) => {
    if (req.url === '/redir') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end()
    res.writeHead(503).end()
  }, async (base) => {
    const d = crearDescargador({ hostsInternos: ['127.0.0.1'] })
    await assert.rejects(d(`${base}/caido`, { tamano: 10 }), (e) => e instanceof ErrorOrigen && !e.politica)
    await assert.rejects(d(`${base}/redir`, { tamano: 10 }), (e) => e instanceof ErrorOrigen)
  })
})
