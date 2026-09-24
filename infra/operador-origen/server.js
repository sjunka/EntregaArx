// Operador de origen simulado (HU-09): hace de «otro operador» que traslada a un ciudadano hacia Mi Carpeta Segura, como en la
// secuencia 4.5 del diseño. No hay operadores reales que implementen el contrato (B-01, B-16). Con POST /trasladar:
//   1. afilia al ciudadano en el GovCarpeta simulado a su nombre (su afiliación anterior) y lo da de baja;
//   2. firma y envía transferCitizen a MS-07 con las URL de sus documentos;
//   3. sirve esos documentos, con opciones de prueba para fallar, demorar o entregar bytes distintos a los declarados;
//   4. recibe transferCitizenConfirm: con req_status 1 «borra» su copia y con 0 conserva la carpeta y recupera la afiliación.
// Genera su llave al arrancar y publica el JWKS que MS-07 tiene en su directorio. Nunca guarda llaves en el repo.
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'

const env = process.env
const OPERADOR = env.OPERADOR ?? 'operador-origen'
const NOMBRE = env.OPERADOR_NOMBRE ?? 'Operador Origen'
const INTEROP = env.INTEROP_URL ?? 'http://interoperabilidad:8080'
const GOVCARPETA = env.GOVCARPETA_URL ?? 'http://govcarpeta:8080'
// URL con la que la custodia de Mi Carpeta Segura alcanza a este servicio dentro de compose.
const PUBLICO = env.URL_PUBLICA ?? 'http://operador-origen:8080'

const propia = await generateKeyPair('RS256')
const ajena = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(propia.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const firmar = (claims, llave) => new CompactSign(new TextEncoder().encode(JSON.stringify(claims))).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(llave)

const documentos = new Map() // token → { cedula, bytes, fallas, demoraMs, noExiste, servidos }
const carpetas = new Map() // cédula → documentos que conserva este operador
const confirmaciones = new Map() // cédula → [{ req_status, recibidoEn }]

async function json(url, opciones) {
  const r = await fetch(url, opciones)
  return { status: r.status, cuerpo: await r.json().catch(() => null) }
}
const govcarpeta = (metodo, ruta, cuerpo) => fetch(GOVCARPETA + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }).then(async (r) => ({ status: r.status, texto: await r.text() }))
const afiliar = (cedula, nombre, apellido, direccion, correo) => govcarpeta('POST', '/apis/registerCitizen', {
  id: Number(cedula), name: `${nombre} ${apellido}`, address: direccion, email: correo, operatorId: OPERADOR, operatorName: NOMBRE,
})
const dar_de_baja = (cedula) => govcarpeta('DELETE', '/apis/unregisterCitizen', { id: Number(cedula), operatorId: OPERADOR })

// Opciones de prueba por documento: fallas (responde 503 las primeras n veces), demoraMs, noExiste (404), alterar (entrega bytes
// distintos a los declarados). Del traslado: sinBaja (no da de baja), firmaInvalida, correoContacto, telefono, direccion, nombre, apellido.
async function trasladar({ cedula, nombre = 'Ana', apellido = 'Gil', direccion = 'Calle 10 # 20-30, Bogotá', correo, correoContacto, telefono = '3001234567', documentos: pedidos = [{ titulo: 'Cédula de ciudadanía' }], sinBaja, firmaInvalida }) {
  correo ??= `traslado.${cedula}@carpetacolombia.co`
  correoContacto ??= `traslado.${cedula}@example.com`
  await afiliar(cedula, nombre, apellido, direccion, correo)
  if (!sinBaja) await dar_de_baja(cedula)
  const lista = pedidos.map((p, i) => {
    const bytes = Buffer.from(`%PDF-1.4\n% ${NOMBRE} guarda: ${p.titulo} (${cedula}-${i})\n%%EOF\n`)
    const token = randomUUID()
    documentos.set(token, { cedula, bytes: p.alterar ? Buffer.from(`%PDF-1.4\n% ALTERADO ${token}\n%%EOF\n`) : bytes, fallas: p.fallas ?? 0, demoraMs: p.demoraMs ?? 0, noExiste: !!p.noExiste })
    return {
      idExterno: `${cedula}-${i}`, titulo: p.titulo, clase: p.clase ?? 'temporal', ...(p.clase === 'certificado' && { emisor: p.emisor ?? 'universidad-original' }),
      tipo: 'application/pdf', tamano: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: `${PUBLICO}/documentos/${token}`,
    }
  })
  carpetas.set(cedula, lista)
  confirmaciones.delete(cedula)
  const confirmAPI = `${PUBLICO}/api/transferCitizenConfirm`
  const traslado = { operador: OPERADOR, id: cedula, nombre, apellido, direccion, correo, correoContacto, telefono, confirmAPI, documentos: lista }
  traslado.firma = await firmar({ iss: OPERADOR, id: cedula, confirmAPI, sha256: lista.map((d) => d.sha256) }, firmaInvalida ? ajena.privateKey : propia.privateKey)
  return { cedula, correo, correoContacto, ...(await json(`${INTEROP}/api/transferCitizen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(traslado) })) }
}

createServer(async (req, res) => {
  const responder = (status, cuerpo, tipo = 'application/json') => res.writeHead(status, { 'content-type': tipo }).end(tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo)
  const leer = async () => { let c = ''; for await (const t of req) c += t; return JSON.parse(c || '{}') }
  try {
    if (req.url === '/salud') return responder(200, { estado: 'ok' })
    if (req.url === '/.well-known/jwks.json') return responder(200, { keys: [jwk] })
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
