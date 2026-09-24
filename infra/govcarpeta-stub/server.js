// Doble local de GovCarpeta con las respuestas del real (códigos + prosa), para que compose y e2e
// nunca escriban en el centralizador. validateCitizen, registerCitizen, authenticateDocument, unregisterCitizen (la baja que hace el
// operador origen en un traslado, HU-09 y HU-13) y getOperators (HU-13); crece con cada HU.
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
  if (req.method === 'PUT' && req.url === '/apis/authenticateDocument') {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      let d
      try { d = JSON.parse(cuerpo) } catch { return responder(res, 400, 'JSON inválido') }
      // Como el real: recibe la URL del documento, no el binario, y responde en prosa.
      if (!d.idCitizen || !d.UrlDocument || !d.documentTitle) return responder(res, 400, 'Faltan idCitizen, UrlDocument o documentTitle')
      if (!afiliados.has(String(d.idCitizen))) return responder(res, 501, `El ciudadano ${d.idCitizen} no se encuentra registrado`)
      responder(res, 200, `Documento ${d.documentTitle} autenticado para el ciudadano ${d.idCitizen}`)
    })
    return
  }
  // Baja del ciudadano: la hace el operador de origen al empezar un traslado (secuencia 4.5, paso 1).
  if (req.method === 'DELETE' && req.url === '/apis/unregisterCitizen') {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      let c
      try { c = JSON.parse(cuerpo) } catch { return responder(res, 400, 'JSON inválido') }
      const id = String(c.id)
      if (!afiliados.has(id)) return responder(res, 501, `El ciudadano ${id} no se encuentra registrado`)
      afiliados.delete(id)
      responder(res, 200, `Ciudadano ${id} dado de baja`)
    })
    return
  }
  // Directorio de operadores (HU-13). Como el real, solo algunos publican transferAPIURL (B-16). OPERADORES reemplaza la lista.
  if (req.method === 'GET' && req.url === '/apis/getOperators') {
    return responder(res, 200, JSON.stringify(process.env.OPERADORES ? JSON.parse(process.env.OPERADORES) : [
      { _id: 'mcs-local', operatorName: 'Mi Carpeta Segura', transferAPIURL: 'http://interoperabilidad:8080/api/transferCitizen' },
      { _id: 'operador-destino', operatorName: 'Operador Destino', transferAPIURL: 'http://operador-destino:8080/api/transferCitizen' },
      { _id: 'operador-sin-traslado', operatorName: 'Operador Sin Traslado', transferAPIURL: '' },
    ]))
  }
  if (req.url === '/salud') return responder(res, 200, 'ok')
  responder(res, 404)
}).listen(Number(process.env.PORT ?? 8080))
