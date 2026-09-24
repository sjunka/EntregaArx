import { createHash } from 'node:crypto'

const limpiar = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20)

// Cuenta institucional: nombre.apellido.NNNNN@carpetacolombia.co. El sufijo sale de la cédula,
// así que reintentar el mismo registro produce la misma cuenta. `intento` resuelve colisiones.
export function cuentaInstitucional({ cedula, nombre, apellido }, intento = 0) {
  // Sin letras latinas (p. ej. otro alfabeto) la parte queda «ciudadano» para no generar «.gil.NNNNN».
  const parte = (s) => limpiar(s.trim().split(/\s+/)[0]) || 'ciudadano'
  const base = `${parte(nombre)}.${parte(apellido)}`
  const sufijo = intento === 0
    ? cedula.slice(-5).padStart(5, '0')
    : String(parseInt(createHash('sha256').update(`${cedula}:${intento}`).digest('hex').slice(0, 8), 16) % 100000).padStart(5, '0')
  return `${base}.${sufijo}@carpetacolombia.co`
}

export function validarRegistro(b) {
  const errores = []
  if (typeof b?.cedula !== 'string' || !/^[0-9]{6,10}$/.test(b.cedula)) errores.push('cedula')
  for (const [k, max] of [['nombre', 60], ['apellido', 60], ['direccion', 120]]) {
    if (typeof b?.[k] !== 'string' || !b[k].trim() || b[k].length > max) errores.push(k)
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b?.correoContacto ?? '')) errores.push('correoContacto')
  if (typeof b?.clave !== 'string' || b.clave.length < 12 || b.clave.length > 64) errores.push('clave')
  return errores
}

export const cedulaEnmascarada = (c) => `******${String(c).slice(-4)}`
