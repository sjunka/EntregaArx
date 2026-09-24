// Cliente de MS-06 (autorizaciones) con el token de servicio de Premium (client credentials, ADR-0006).
export class ErrorAutorizaciones extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

// Token de servicio con caché hasta poco antes de vencer.
// ponytail: tercera copia de este proveedor (custodia, interoperabilidad, premium); extraer a un paquete en el siguiente cambio que lo toque.
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

export function crearAutorizaciones({ url, token, timeoutMs = 15_000 }) {
  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(url + ruta, {
      method: metodo, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${await token()}`, ...(cuerpo && { 'content-type': 'application/json' }) },
      body: cuerpo && JSON.stringify(cuerpo),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErrorAutorizaciones(r.status, json.detail ?? json.title ?? `autorizaciones ${r.status}`)
    return json
  }
  return {
    // La misma petición que hace una entidad (HU-07): idempotente por (entidad, idExterno). Devuelve { id, estado }.
    crearPeticion: (p) => llamar('POST', '/interno/peticiones', p),
    // { id, estado, autorizaciones }; 404 si la petición no es de esa entidad.
    consultarPeticion: (id, entidad) => llamar('GET', `/interno/peticiones/${id}?entidad=${encodeURIComponent(entidad)}`),
  }
}
