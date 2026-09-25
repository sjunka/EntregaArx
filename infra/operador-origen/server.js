// Operador de origen simulado (HU-09): hace de «otro operador» que traslada a un ciudadano hacia Mi Carpeta Segura, como en la
// secuencia 4.5 del diseño. No hay operadores reales que implementen el contrato (B-01, B-16). Con POST /trasladar:
//   1. afilia al ciudadano en el GovCarpeta simulado a su nombre (su afiliación anterior) y lo da de baja;
//   2. envía transferCitizen a MS-07 en el formato del curso (ADR-0027) con las URL de sus documentos;
//   3. sirve esos documentos, con opciones de prueba para fallar, demorar o entregar bytes distintos a los declarados;
//   4. recibe transferCitizenConfirm: con req_status 1 «borra» su copia y con 0 conserva la carpeta y recupera la afiliación.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const env = process.env
const OPERADOR = env.OPERADOR ?? 'operador-origen'
const NOMBRE = env.OPERADOR_NOMBRE ?? 'Operador Origen'
const INTEROP = env.INTEROP_URL ?? 'http://interoperabilidad:8080'
const GOVCARPETA = env.GOVCARPETA_URL ?? 'http://govcarpeta:8080'
// URL con la que la custodia de Mi Carpeta Segura alcanza a este servicio dentro de compose.
const PUBLICO = env.URL_PUBLICA ?? 'http://operador-origen:8080'

const documentos = new Map() // token → { cedula, bytes, fallas, demoraMs, noExiste, servidos }
const carpetas = new Map() // cédula → documentos que conserva este operador
const confirmaciones = new Map() // cédula → [{ req_status, recibidoEn }]

async function json(url, opciones) {
  const r = await fetch(url, opciones)
  return { status: r.status, cuerpo: await r.json().catch(() => null) }
}
const govcarpeta = (metodo, ruta, cuerpo) => fetch(GOVCARPETA + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }).then(async (r) => ({ status: r.status, texto: await r.text() }))
const afiliar = (cedula, nombre, apellido, direccion, correo) => govcarpeta('POST', '/apis/registerCitizen', {
  id: Number(cedula), name: `${nombre} ${apellido}`.trim(), address: direccion, email: correo, operatorId: OPERADOR, operatorName: NOMBRE,
})
const dar_de_baja = (cedula) => govcarpeta('DELETE', '/apis/unregisterCitizen', { id: Number(cedula), operatorId: OPERADOR })

// Opciones de prueba por documento: fallas (responde 503 las primeras n veces), demoraMs, noExiste (404). Del traslado: sinBaja
// (no da de baja), nombre, correo. El formato del curso no trae dirección ni celular: el ciudadano los da al activar.
async function trasladar({ cedula, nombre = 'Ana Gil', correo, documentos: pedidos = [{ titulo: 'Cédula de ciudadanía' }], sinBaja }) {
  correo ??= `traslado.${cedula}@carpetacolombia.co`
  await afiliar(cedula, nombre, '', 'Calle 10 # 20-30, Bogotá', correo)
  if (!sinBaja) await dar_de_baja(cedula)
  const urlDocuments = {}
  for (const [i, p] of pedidos.entries()) {
    const token = randomUUID()
    documentos.set(token, { cedula, bytes: Buffer.from(`%PDF-1.4\n% ${NOMBRE} guarda: ${p.titulo} (${cedula}-${i})\n%%EOF\n`), fallas: p.fallas ?? 0, demoraMs: p.demoraMs ?? 0, noExiste: !!p.noExiste })
    ;(urlDocuments[p.titulo] ??= []).push(`${PUBLICO}/documentos/${token}`)
  }
  carpetas.set(cedula, pedidos)
  confirmaciones.delete(cedula)
  const traslado = { id: Number(cedula), citizenName: nombre, citizenEmail: correo, urlDocuments, confirmAPI: `${PUBLICO}/api/transferCitizenConfirm` }
  return { cedula, correo, ...(await json(`${INTEROP}/api/transferCitizen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(traslado) })) }
}

createServer(async (req, res) => {
  const responder = (status, cuerpo, tipo = 'application/json') => res.writeHead(status, { 'content-type': tipo }).end(tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo)
  const leer = async () => { let c = ''; for await (const t of req) c += t; return JSON.parse(c || '{}') }
  try {
    if (req.url === '/salud') return responder(200, { estado: 'ok' })
    if (req.method === 'POST' && req.url === '/trasladar') return responder(200, await trasladar(await leer()))

    const doc = /^\/documentos\/([0-9a-f-]{36})$/.exec(req.url)
    if (req.method === 'GET' && doc) {
      const d = documentos.get(doc[1])
      if (!d || d.noExiste) return responder(404, { error: 'no existe' })
      if (d.demoraMs) await new Promise((ok) => setTimeout(ok, d.demoraMs))
      if (d.fallas > 0) { d.fallas -= 1; return responder(503, { error: 'temporalmente no disponible' }) }
      return responder(200, d.bytes, 'application/pdf')
    }

    // Confirmación del destino (B-02): 1 si todo llegó y la afiliación cambió; 0 si falló y este operador conserva la carpeta.
    if (req.method === 'POST' && req.url === '/api/transferCitizenConfirm') {
      const { id, req_status } = await leer()
      confirmaciones.set(String(id), [...(confirmaciones.get(String(id)) ?? []), { req_status, recibidoEn: new Date().toISOString() }])
      if (req_status === 1) carpetas.delete(String(id))
      // Con 0 el destino no quedó con el ciudadano: este operador recupera su afiliación en el centralizador.
      if (req_status === 0) await afiliar(String(id), 'Ciudadano', 'Recuperado', 'Sin dirección', `recuperado.${id}@carpetacolombia.co`)
      return responder(200, { recibido: true })
    }

    const estado = /^\/estado\/(\d+)$/.exec(req.url)
    if (req.method === 'GET' && estado) {
      const c = estado[1]
      const central = await fetch(`${GOVCARPETA}/apis/validateCitizen/${c}`).then(async (r) => ({ status: r.status, texto: await r.text() }))
      return responder(200, { confirmaciones: confirmaciones.get(c) ?? [], documentosEnOrigen: carpetas.get(c)?.length ?? 0, centralizador: central })
    }
    responder(404, { error: 'no existe' })
  } catch (e) {
    responder(500, { error: e.message })
  }
}).listen(Number(env.PORT ?? 8080), () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'operador de origen simulado', operador: OPERADOR })))
