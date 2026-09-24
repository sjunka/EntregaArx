// Operador de destino simulado (HU-13): hace de «otro operador» que recibe a un ciudadano que se traslada desde Mi Carpeta Segura,
// como en la secuencia del diseño. No hay operadores reales que implementen el contrato (B-01, B-16). Implementa:
//   POST /api/transferCitizen   { id, citizenName, citizenEmail, urlDocuments, confirmAPI } → responde en el acto y trabaja aparte:
//     descarga cada URL prefirmada, afilia al ciudadano en el GovCarpeta simulado y llama al confirmAPI con req_status 1 (o 0 si falla);
//   POST /configurar            { cedula, modo, demoraMs } opciones de prueba para el siguiente traslado de esa cédula:
//     rechazar (confirma 0), no-acepta (transferCitizen responde 500), sin-confirmar (no llama al confirmAPI),
//     confirmar-sin-afiliar (confirma 1 sin afiliar en GovCarpeta: MS-07 no debe cerrar nada);
//   POST /confirmar             { cedula, req_status } envía ahora una confirmación (por ejemplo la de un traslado en modo sin-confirmar);
//   GET  /estado/:cedula        lo que este operador recibió y las confirmaciones que envió.
// Los archivos se guardan en memoria: es un doble de prueba. Nunca guarda llaves ni credenciales.
import { createHash } from 'node:crypto'
import { createServer, request } from 'node:http'

const env = process.env
const OPERADOR = env.OPERADOR ?? 'operador-destino'
const NOMBRE = env.OPERADOR_NOMBRE ?? 'Operador Destino'
const GOVCARPETA = env.GOVCARPETA_URL ?? 'http://govcarpeta:8080'
// Las URL prefirmadas se firman con el host que ve el navegador (localhost:9000); dentro de compose el almacén se alcanza como
// minio:9000. Se conecta al segundo y se conserva el primero en la cabecera Host, que es lo que firma SigV4 (igual que la entidad simulada).
const ALMACEN = env.ALMACEN_CONEXION ?? 'minio:9000'

const opciones = new Map() // cédula → { modo, demoraMs }
const carpetas = new Map() // cédula → { nombre, correo, documentos: [{ titulo, tamano, sha256 }] }
const confirmaciones = new Map() // cédula → [{ req_status, respuesta }]
const pendientes = new Map() // cédula → confirmAPI de un traslado en modo sin-confirmar
const recibidos = new Map() // cédula → claves del cuerpo de transferCitizen (para comprobar qué viaja)

const govcarpeta = (metodo, ruta, cuerpo) => fetch(GOVCARPETA + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo) }).then(async (r) => ({ status: r.status, texto: await r.text() }))

function descargar(url) {
  const u = new URL(url)
  const [host, puerto] = ALMACEN.split(':')
  return new Promise((ok, falla) => {
    const r = request({ host, port: Number(puerto), path: u.pathname + u.search, method: 'GET', headers: { host: u.host } }, (res) => {
      const trozos = []
      res.on('data', (t) => trozos.push(t))
      res.on('end', () => (res.statusCode === 200 ? ok(Buffer.concat(trozos)) : falla(new Error(`el almacén respondió ${res.statusCode}`))))
    })
    r.on('error', falla)
    r.end()
  })
}

async function recibir({ id, citizenName, citizenEmail, urlDocuments, confirmAPI }, { modo, demoraMs }) {
  const cedula = String(id)
  pendientes.set(cedula, confirmAPI) // /confirmar puede reenviar la confirmación después, con otro req_status
  let estado = 1
  try {
    if (demoraMs) await new Promise((ok) => setTimeout(ok, demoraMs))
    if (modo === 'rechazar') throw new Error('el destino rechaza la recepción')
    const documentos = []
    for (const [titulo, urls] of Object.entries(urlDocuments)) {
      for (const url of urls) {
        const bytes = await descargar(url)
        documentos.push({ titulo, tamano: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      }
    }
    carpetas.set(cedula, { nombre: citizenName, correo: citizenEmail, documentos })
    // Solo con la Carpeta completa este operador afilia al ciudadano en el centralizador y confirma.
    if (modo !== 'confirmar-sin-afiliar') {
      const r = await govcarpeta('POST', '/apis/registerCitizen', { id, name: citizenName, address: 'Sin dirección registrada', email: citizenEmail, operatorId: OPERADOR, operatorName: NOMBRE })
      if (r.status !== 201) throw new Error(`GovCarpeta respondió ${r.status}`)
    }
  } catch (e) {
    console.log(JSON.stringify({ nivel: 'warn', mensaje: 'traslado no recibido', detalle: e.message }))
    carpetas.delete(cedula)
    estado = 0
  }
  if (modo === 'sin-confirmar') return
  await confirmar(cedula, confirmAPI, estado)
}

async function confirmar(cedula, confirmAPI, estado) {
  const r = await fetch(confirmAPI, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: Number(cedula), req_status: estado }) })
    .then(async (x) => ({ status: x.status, cuerpo: await x.json().catch(() => null) })).catch((e) => ({ error: e.message }))
  confirmaciones.set(cedula, [...(confirmaciones.get(cedula) ?? []), { req_status: estado, respuesta: r }])
  return r
}

createServer(async (req, res) => {
  const responder = (status, cuerpo) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo))
  const leer = async () => { let c = ''; for await (const t of req) c += t; return JSON.parse(c || '{}') }
  try {
    if (req.url === '/salud') return responder(200, { estado: 'ok' })
    if (req.method === 'POST' && req.url === '/configurar') {
      const { cedula, modo, demoraMs } = await leer()
      opciones.set(String(cedula), { modo, demoraMs })
      for (const m of [confirmaciones, carpetas, pendientes, recibidos]) m.delete(String(cedula))
      return responder(200, { configurado: true })
    }
    if (req.method === 'POST' && req.url === '/api/transferCitizen') {
      const b = await leer()
      if (!Number.isInteger(b.id) || typeof b.citizenName !== 'string' || typeof b.confirmAPI !== 'string' || typeof b.urlDocuments !== 'object') return responder(400, { error: 'solicitud inválida' })
      recibidos.set(String(b.id), Object.keys(b).sort())
      const o = opciones.get(String(b.id)) ?? {}
      if (o.modo === 'no-acepta') return responder(500, { error: 'el destino no acepta traslados ahora' })
      recibir(b, o).catch((e) => console.log(JSON.stringify({ nivel: 'error', mensaje: e.message })))
      return responder(200, { recibido: true })
    }
    if (req.method === 'POST' && req.url === '/confirmar') {
      const { cedula, req_status } = await leer()
      const url = pendientes.get(String(cedula))
      return url ? responder(200, await confirmar(String(cedula), url, req_status)) : responder(404, { error: 'no hay confirmación pendiente' })
    }
    const estado = /^\/estado\/(\d+)$/.exec(req.url)
    if (req.method === 'GET' && estado) {
      const c = estado[1]
      const central = await fetch(`${GOVCARPETA}/apis/validateCitizen/${c}`).then(async (r) => ({ status: r.status, texto: await r.text() }))
      return responder(200, { carpeta: carpetas.get(c) ?? null, claves: recibidos.get(c) ?? null, confirmaciones: confirmaciones.get(c) ?? [], centralizador: central })
    }
    responder(404, { error: 'no existe' })
  } catch (e) {
    responder(500, { error: e.message })
  }
}).listen(Number(env.PORT ?? 8080), () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'operador de destino simulado', operador: OPERADOR })))
