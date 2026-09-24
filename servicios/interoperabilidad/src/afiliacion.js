// Cliente de MS-03 (afiliación) para el Traslado de entrada (HU-09), con el token de servicio de la interoperabilidad.
export class ErrorAfiliacion extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}

export function crearAfiliacion({ url, token, timeoutMs = 40_000 }) {
  async function llamar(ruta, cuerpo, metodo = 'POST') {
    const r = await fetch(url + ruta, {
      method: metodo, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${await token()}`, ...(metodo === 'POST' && { 'content-type': 'application/json' }) }, ...(metodo === 'POST' && { body: JSON.stringify(cuerpo ?? {}) }),
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
    // HU-13 · Traslado de salida. Lo que se manda al destino: { cedula, cuenta, nombre, estado }.
    consultarSalida: (cedula) => llamar(`/interno/salida/${cedula}`, undefined, 'GET'),
    // Baja en GovCarpeta (unregisterCitizen). Idempotente.
    baja: (cedula) => llamar(`/interno/salida/${cedula}/baja`),
    // El destino rechazó: MS-03 vuelve a registrar al ciudadano en GovCarpeta. Idempotente.
    reafiliar: (cedula) => llamar(`/interno/salida/${cedula}/reafiliacion`),
    // El destino confirmó: MS-03 borra la cuenta y los datos. Idempotente.
    cierre: (cedula) => llamar(`/interno/salida/${cedula}/cierre`),
  }
}
