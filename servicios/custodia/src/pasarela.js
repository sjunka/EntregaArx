// Cliente de la pasarela del centralizador (MS-08). Solo le entrega URL y datos mínimos (RI-01, RNF-21).
// ponytail: sin identidad de servicio hacia la pasarela; en Cloud Run privada se adjunta un ID token de Google.
export class ErrorPasarela extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

export function crearPasarela({ url, timeoutMs = 30_000 }) {
  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(url + ruta, {
      method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(timeoutMs),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErrorPasarela(r.status, json.detail ?? json.title ?? `pasarela ${r.status}`)
    return json
  }
  return { autenticar: (d) => llamar('PUT', '/centralizador/documentos/autenticacion', d) }
}
