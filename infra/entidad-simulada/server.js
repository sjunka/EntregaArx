// Entidad emisora simulada (una «universidad») para compose y e2e, como el doble de GovCarpeta: HU-05 no tiene un
// emisor real (B-01). Genera su par de llaves al arrancar, publica la pública en /.well-known/jwks.json (que MS-07
// tiene registrada como directorio de emisores) y, con POST /emitir, hace el recorrido completo de una entidad:
// anuncia el documento firmado, sube el archivo a la URL prefirmada y confirma (HU-05); con POST /peticiones pide documentos
// a un ciudadano y con POST /peticiones/consultar recoge los que autorizó (HU-07). Nunca guarda llaves en el repo.
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto'
import { createServer, request } from 'node:http'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'

const env = process.env
const EMISOR = env.EMISOR ?? 'universidad-demo'
const INTEROP = env.INTEROP_URL ?? 'http://interoperabilidad:8080'
// Las URL prefirmadas se firman con el host que ve el navegador (localhost:9000); dentro de compose el almacén se
// alcanza como minio:9000. Se conecta al segundo y se conserva el primero en la cabecera Host, que es lo que firma SigV4.
// Sin ALMACEN_CONEXION (GCP) la URL prefirmada es pública y se usa tal cual.
const ALMACEN = env.ALMACEN_CONEXION
// En GCP la llave llega de Secret Manager (LLAVE_PRIVADA, PKCS8): sobrevive a un reinicio y MS-07 no queda con una pública vieja.
// Si se define DEMO_CLAVE, /emitir y /peticiones exigen la cabecera x-demo-clave: nadie más firma como la universidad.
const DEMO_CLAVE = env.DEMO_CLAVE

const llave = env.LLAVE_PRIVADA && createPrivateKey(env.LLAVE_PRIVADA)
const propia = llave ? { privateKey: llave, publicKey: createPublicKey(llave) } : await generateKeyPair('RS256')
const ajena = await generateKeyPair('RS256') // para simular una firma que no es de esta entidad
const jwk = { ...(await exportJWK(propia.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }

const firmar = (claims, llave) => new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)

async function json(url, opciones) {
  const r = await fetch(url, opciones)
  return { status: r.status, cuerpo: await r.json().catch(() => null) }
}

async function subir(urlPrefirmada, bytes, tipo) {
  if (!ALMACEN) return (await fetch(urlPrefirmada, { method: 'PUT', headers: { 'content-type': tipo }, body: bytes })).status
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

// HU-07: la entidad pide documentos al ciudadano. Opciones de prueba: firmaInvalida (firma con otra llave), idExterno.
async function pedir({ cedula, proposito = 'Verificar tus estudios para una beca', documentos = [{ titulo: 'Diploma' }], idExterno = randomUUID(), firmaInvalida }) {
  const peticion = { emisor: EMISOR, idExterno, cedula, proposito, documentos }
  peticion.firma = await firmar({ iss: EMISOR, idExterno, cedula, proposito, pedidos: documentos.map((d) => d.titulo) }, firmaInvalida ? ajena.privateKey : propia.privateKey)
  return { idExterno, ...(await json(`${INTEROP}/api/peticiones`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(peticion) })) }
}

// Consulta la petición con un JWS de 2 minutos firmado por la entidad (`sinFirma`: sin credencial; `firmaInvalida`: otra llave).
async function consultar({ id, sinFirma, firmaInvalida }) {
  const t = Math.floor(Date.now() / 1000)
  const bearer = sinFirma ? null : await firmar({ iss: EMISOR, iat: t, exp: t + 120 }, firmaInvalida ? ajena.privateKey : propia.privateKey)
  return json(`${INTEROP}/api/peticiones/${id}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} })
}

createServer(async (req, res) => {
  const responder = (status, cuerpo) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo))
  try {
    if (req.url === '/salud') return responder(200, { estado: 'ok' })
    if (req.url === '/.well-known/jwks.json') return responder(200, { keys: [jwk] })
    if (DEMO_CLAVE && req.headers['x-demo-clave'] !== DEMO_CLAVE) return responder(401, { error: 'falta la cabecera x-demo-clave' })
    if (req.method === 'POST' && req.url === '/emitir') {
      let cuerpo = ''
      for await (const c of req) cuerpo += c
      return responder(200, await emitir(JSON.parse(cuerpo || '{}')))
    }
    if (req.method === 'POST' && (req.url === '/peticiones' || req.url === '/peticiones/consultar')) {
      let cuerpo = ''
      for await (const c of req) cuerpo += c
      const datos = JSON.parse(cuerpo || '{}')
      return responder(200, await (req.url === '/peticiones' ? pedir(datos) : consultar(datos)))
    }
    responder(404, { error: 'no existe' })
  } catch (e) {
    responder(500, { error: e.message })
  }
}).listen(Number(env.PORT ?? 8080), () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'entidad simulada', emisor: EMISOR })))
