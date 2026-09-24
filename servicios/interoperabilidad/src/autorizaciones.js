// Cliente de MS-06 (autorizaciones) con el token de servicio de la interoperabilidad (client credentials, ADR-0006).
export class ErrorAutorizaciones extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
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
    return { ...json, status: r.status }
  }
  return {
    // { id, estado, existente }: 201 si es nueva, 200 si la entidad ya la había enviado.
    async crearPeticion(p) {
      const { status, ...r } = await llamar('POST', '/interno/peticiones', p)
      return { ...r, existente: status === 200 }
    },
    // { id, estado, autorizaciones: [{ id, documentoId, venceEn }] }; 404 si la petición no es de esa entidad.
    consultarPeticion: async (id, entidad) => {
      const { status, ...r } = await llamar('GET', `/interno/peticiones/${id}?entidad=${encodeURIComponent(entidad)}`)
      return r
    },
  }
}
