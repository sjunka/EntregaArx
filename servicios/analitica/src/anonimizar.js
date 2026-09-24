import { createHash } from 'node:crypto'

// RF-08.2: de un `documento.recibido` solo pasan institución, región y año. La cédula, el título y los ids del documento
// se descartan aquí; la llave de deduplicación es un hash con sal del id del evento (la entrega del bus es al menos una vez)
// y no permite volver al evento ni al documento sin la sal. El año es el de Colombia (UTC-5).
// ponytail: se cuentan Certificados, no personas (no hay seudónimo por persona a propósito); el umbral es una cota superior de personas.
export const crearAnonimizador = ({ regiones, sal }) => ({ id, datos }) => {
  const region = regiones.get(datos.emisor)
  if (!region) return null // emisor fuera del contexto educativo del directorio: no entra a la analítica
  return {
    h: createHash('sha256').update(`${sal}:${id}`).digest('hex'),
    emisor: datos.emisor,
    region,
    anio: new Date(Date.parse(datos.recibidoEn) - 5 * 3_600_000).getUTCFullYear(),
  }
}
