import { createHmac, timingSafeEqual } from 'node:crypto'

// El enlace de un envío no guarda nada: su firma es un HMAC del envío y el documento, así que un reintento del correo
// reconstruye los mismos enlaces y solo sirven los que MS-07 emitió. Vence con el envío (72 h) y la custodia vuelve a
// preguntar a MS-06 en cada apertura, de modo que revocar la autorización también los corta.
export const firmaEnlace = (secreto, envioId, documentoId) =>
  createHmac('sha256', secreto).update(`${envioId}:${documentoId}`).digest('base64url').slice(0, 32)

export function enlaceValido(secreto, envioId, documentoId, f) {
  const esperada = Buffer.from(firmaEnlace(secreto, envioId, documentoId))
  const recibida = Buffer.from(typeof f === 'string' ? f : '')
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}
