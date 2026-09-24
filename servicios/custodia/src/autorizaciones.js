// Cliente de MS-06 (autorizaciones) con el token de servicio de la custodia (client credentials, ADR-0006).
// ponytail: mismo proveedor de token que en la interoperabilidad; extraer a un paquete si un tercer servicio lo necesita.
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

export function crearAutorizaciones({ url, token, timeoutMs = 8000 }) {
  return {
    // { permitida, autorizacionId?, venceEn? }. Cualquier fallo lanza: la custodia no firma sin una decisión.
    async decidir({ cedula, documentoId, tercero }) {
      const r = await fetch(`${url}/interno/decisiones`, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ cedula, documentoId, tercero }),
      })
      if (!r.ok) throw new Error(`autorizaciones respondió ${r.status}`)
      return r.json()
    },
  }
}
