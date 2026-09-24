// Cliente HTTP de la pasarela (MS-08).
export class ErrorPasarela extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

export function crearPasarela({ url }) {
  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(url + ruta, {
      method: metodo, headers: { 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(30_000),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErrorPasarela(r.status, json.detail ?? json.title ?? `pasarela ${r.status}`)
    return json
  }
  return {
    consultar: (cedula) => llamar('GET', `/centralizador/ciudadanos/${cedula}`),
    registrar: (c) => llamar('POST', '/centralizador/ciudadanos', c),
  }
}
