// Doble local de GovCarpeta con las respuestas del real (códigos + prosa), para que compose y e2e
// nunca escriban en el centralizador. Solo validateCitizen y registerCitizen; crece con cada HU.
import { createServer } from 'node:http'

// 1000000001 ya está afiliado a otro operador, para el escenario alterno de HU-01.
const afiliados = new Map([['1000000001', 'Operador Ciudadano']])

const responder = (res, status, texto = '') => res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(texto)

createServer((req, res) => {
  const consulta = /^\/apis\/validateCitizen\/(\d+)$/.exec(req.url)
  if (req.method === 'GET' && consulta) {
    const op = afiliados.get(consulta[1])
    return op ? responder(res, 200, `El ciudadano ${consulta[1]} ya se encuentra registrado en el operador ${op}`) : responder(res, 204)
  }
  if (req.method === 'POST' && req.url === '/apis/registerCitizen') {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      let c
      try { c = JSON.parse(cuerpo) } catch { return responder(res, 400, 'JSON inválido') }
      const id = String(c.id)
      if (afiliados.has(id)) return responder(res, 501, `El ciudadano ${id} ya se encuentra registrado`)
      afiliados.set(id, c.operatorName)
      responder(res, 201, `Ciudadano ${id} registrado`)
    })
    return
  }
  if (req.url === '/salud') return responder(res, 200, 'ok')
  responder(res, 404)
}).listen(Number(process.env.PORT ?? 8080))
