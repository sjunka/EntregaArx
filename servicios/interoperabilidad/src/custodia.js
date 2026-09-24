// Clientes de MS-04 (custodia) y de identidad, para llamar a la custodia como servicio (client credentials, ADR-0006).
export class ErrorCustodia extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

// Token de servicio con caché hasta poco antes de vencer.
export function crearProveedorToken({ url, clientId, secreto, ahora = Date.now }) {
  let actual = null
  return async () => {
    if (actual && actual.vence > ahora() + 30_000) return actual.token
    const r = await fetch(`${url}/protocol/openid-connect/token`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secreto }),
    })
    if (!r.ok) throw new Error(`identidad respondió ${r.status} al pedir el token de servicio`)
    const t = await r.json()
    actual = { token: t.access_token, vence: ahora() + t.expires_in * 1000 }
    return actual.token
  }
}

export function crearCustodia({ url, token, timeoutMs = 30_000 }) {
  async function llamar(ruta, cuerpo, metodo = 'POST') {
    const r = await fetch(url + ruta, {
      method: metodo, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${await token()}`, ...(cuerpo && { 'content-type': 'application/json' }) },
      body: cuerpo && JSON.stringify(cuerpo),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErrorCustodia(r.status, json.detail ?? json.title ?? `custodia ${r.status}`)
    return json
  }
  return {
    registrar: (c) => llamar('/interno/certificados', c),
    verificar: (id) => llamar(`/interno/certificados/${id}/verificacion`),
    // URL de lectura de corta vida para un tercero; la custodia consulta a MS-06 antes de firmar (RI-08). 403 si no hay autorización vigente.
    leer: (l) => llamar('/interno/lecturas', l),
    // Qué documentos de la lista son del titular y están en su Carpeta: { documentos: [{ id, titulo }] }.
    comprobar: (c) => llamar('/interno/comprobacion', c),
    // HU-09: la custodia descarga el documento de la URL del origen, comprueba tamaño y SHA-256 y lo guarda. Idempotente por (operador, idExterno).
    recibirTraslado: (d) => llamar('/interno/traslados/documentos', d),
    // El traslado falló: se descarta lo que llegó de ese origen para ese titular. Idempotente.
    descartarTraslado: ({ cedula, operador }) => llamar(`/interno/traslados/${cedula}?operador=${encodeURIComponent(operador)}`, undefined, 'DELETE'),
  }
}
