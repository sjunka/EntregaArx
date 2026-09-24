import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// HU-09: en un Traslado de entrada la custodia descarga cada documento de una URL que pone el operador de origen. Esa
// URL es entrada no confiable, así que la política impide usarla para llegar a la red del operador (SSRF): solo https,
// nunca direcciones privadas, sin redirecciones y con el tamaño declarado como tope. Los hosts de `hostsInternos` (el
// origen simulado de compose) son la única excepción explícita.
// ponytail: la dirección se comprueba antes de conectar, no fijada a la conexión; en el objetivo, saldida por un proxy de egreso.
export class ErrorOrigen extends Error {
  constructor(mensaje, { politica = false } = {}) {
    super(mensaje)
    this.politica = politica
  }
}

const v4Privada = (ip) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}
export function direccionPrivada(ip) {
  if (isIP(ip) === 4) return v4Privada(ip)
  const v6 = ip.toLowerCase()
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  if (mapeada) return v4Privada(mapeada[1])
  return v6 === '::1' || v6 === '::' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

export function crearDescargador({ hostsInternos = [], timeoutMs = 30_000 } = {}) {
  const permitidos = new Set(hostsInternos)
  return async function descargar(url, { tamano }) {
    let u
    try { u = new URL(url) } catch { throw new ErrorOrigen('La dirección del documento no es válida.', { politica: true }) }
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const interno = permitidos.has(host)
    if (!['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !interno)) throw new ErrorOrigen('La dirección del documento no está permitida: debe ser https.', { politica: true })
    if (!interno) {
      let direcciones
      try { direcciones = await lookup(host, { all: true }) } catch { throw new ErrorOrigen('No se pudo resolver la dirección del documento.') }
      if (!direcciones.length || direcciones.some((d) => direccionPrivada(d.address))) throw new ErrorOrigen('La dirección del documento no está permitida.', { politica: true })
    }
    let r
    try {
      r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      throw new ErrorOrigen(`No se pudo descargar el documento: ${e.cause?.code ?? e.message}`)
    }
    if (!r.ok) throw new ErrorOrigen(`El origen respondió ${r.status} al pedir el documento.`)
    const trozos = []
    let total = 0
    try {
      for await (const t of r.body) {
        total += t.length
        if (total > tamano) throw new ErrorOrigen('El documento pesa más de lo declarado.')
        trozos.push(t)
      }
    } catch (e) {
      throw e instanceof ErrorOrigen ? e : new ErrorOrigen(`Se interrumpió la descarga del documento: ${e.message}`)
    }
    return Buffer.concat(trozos)
  }
}
