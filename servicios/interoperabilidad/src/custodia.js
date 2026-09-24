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
  async function llamar(ruta, cuerpo) {
    const r = await fetch(url + ruta, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
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
  }
}
