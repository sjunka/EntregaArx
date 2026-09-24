// Entidad emisora simulada (una «universidad») para compose y e2e, como el doble de GovCarpeta: HU-05 no tiene un
// emisor real (B-01). Genera su par de llaves al arrancar, publica la pública en /.well-known/jwks.json (que MS-07
// tiene registrada como directorio de emisores) y, con POST /emitir, hace el recorrido completo de una entidad:
// anuncia el documento firmado, sube el archivo a la URL prefirmada y confirma. Nunca guarda llaves en el repo.
import { createHash, randomUUID } from 'node:crypto'
import { createServer, request } from 'node:http'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'

const env = process.env
const EMISOR = env.EMISOR ?? 'universidad-demo'
const INTEROP = env.INTEROP_URL ?? 'http://interoperabilidad:8080'
// Las URL prefirmadas se firman con el host que ve el navegador (localhost:9000); dentro de compose el almacén se
// alcanza como minio:9000. Se conecta al segundo y se conserva el primero en la cabecera Host, que es lo que firma SigV4.
const ALMACEN = env.ALMACEN_CONEXION ?? 'minio:9000'

const propia = await generateKeyPair('RS256')
const ajena = await generateKeyPair('RS256') // para simular una firma que no es de esta entidad
const jwk = { ...(await exportJWK(propia.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }

const firmar = (claims, llave) => new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)

async function json(url, opciones) {
  const r = await fetch(url, opciones)
  return { status: r.status, cuerpo: await r.json().catch(() => null) }
}

function subir(urlPrefirmada, bytes, tipo) {
  const u = new URL(urlPrefirmada)
  const [host, puerto] = ALMACEN.split(':')
  return new Promise((ok, falla) => {
    const r = request({ host, port: Number(puerto), path: u.pathname + u.search, method: 'PUT', headers: { host: u.host, 'content-type': tipo, 'content-length': bytes.length } }, (res) => { res.resume(); ok(res.statusCode) })
    r.on('error', falla)
    r.end(bytes)
  })
}

// Opciones de prueba: firmaInvalida (firma con otra llave), alterarArchivo (sube otros bytes que los firmados),
// sinSubir (no sube nada), sinConfirmar (deja el documento Recibido).
async function emitir({ cedula, titulo = 'Diploma de ingeniería', idExterno = randomUUID(), firmaInvalida, alterarArchivo, sinSubir, sinConfirmar }) {
  const pdf = Buffer.from(`%PDF-1.4\n% ${EMISOR} certifica: ${titulo} (${idExterno})\n%%EOF\n`)
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  const emision = { emisor: EMISOR, idExterno, cedula, titulo, tipo: 'application/pdf', tamano: pdf.length, sha256 }
  emision.firma = await firmar({ iss: EMISOR, idExterno, cedula, titulo, sha256 }, firmaInvalida ? ajena.privateKey : propia.privateKey)
  const resultado = { idExterno, anuncio: await json(`${INTEROP}/api/documentos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emision) }) }
  const { id, urlCarga } = resultado.anuncio.cuerpo ?? {}
  if (!urlCarga || sinSubir) return resultado
  resultado.carga = await subir(urlCarga, alterarArchivo ? Buffer.from(pdf.toString().toUpperCase()) : pdf, 'application/pdf')
  if (sinConfirmar) return resultado
  resultado.confirmacion = await json(`${INTEROP}/api/documentos/${id}/confirmacion`, { method: 'POST' })
  return resultado
}

createServer(async (req, res) => {
  const responder = (status, cuerpo) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo))
  try {
    if (req.url === '/salud') return responder(200, { estado: 'ok' })
    if (req.url === '/.well-known/jwks.json') return responder(200, { keys: [jwk] })
    if (req.method === 'POST' && req.url === '/emitir') {
      let cuerpo = ''
      for await (const c of req) cuerpo += c
      return responder(200, await emitir(JSON.parse(cuerpo || '{}')))
    }
    responder(404, { error: 'no existe' })
  } catch (e) {
    responder(500, { error: e.message })
  }
}).listen(Number(env.PORT ?? 8080), () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'entidad simulada', emisor: EMISOR })))
