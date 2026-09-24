// Cliente de MS-03 (afiliación) para el Traslado de entrada (HU-09), con el token de servicio de la interoperabilidad.
export class ErrorAfiliacion extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

export function crearAfiliacion({ url, token, timeoutMs = 40_000 }) {
  async function llamar(ruta, cuerpo) {
    const r = await fetch(url + ruta, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErrorAfiliacion(r.status, json.detail ?? json.title ?? `afiliación ${r.status}`)
    return json
  }
  return {
    // Crea la cuenta institucional deshabilitada y devuelve { activacion, venceEn }. Idempotente por cédula.
    iniciar: (c) => llamar('/interno/traslados', c),
    // La Carpeta llegó completa: MS-03 registra la afiliación en GovCarpeta. Idempotente.
    completar: (cedula) => llamar(`/interno/traslados/${cedula}/completar`),
    // El traslado falló: MS-03 borra la cuenta creada. Idempotente.
    cancelar: (cedula) => llamar(`/interno/traslados/${cedula}/cancelar`),
  }
}
