// Cliente de GovCarpeta con timeout, reintento solo en lecturas y circuit breaker (AD-09).
// Traduce las respuestas del centralizador (códigos + prosa) a un modelo propio.

export class Indisponible extends Error {}
export class Rechazo extends Error {
  constructor(status, detalle) {
    super(detalle)
    this.status = status
  }
}
export class EscrituraDeshabilitada extends Error {
  constructor() { super('La escritura en GovCarpeta está deshabilitada (GOVCARPETA_ESCRITURA)') }
}

// ponytail: estado del breaker por instancia; compartirlo (Memorystore) si hay muchas réplicas.
export function crearBreaker({ umbral = 5, enfriamientoMs = 30_000, ahora = Date.now } = {}) {
  let fallos = 0
  let abiertoHasta = 0
  return {
    abierto: () => ahora() < abiertoHasta,
    exito: () => { fallos = 0 },
    fallo: () => {
      fallos += 1
      if (fallos >= umbral) { abiertoHasta = ahora() + enfriamientoMs; fallos = 0 }
    },
  }
}

// validateCitizen responde 200 con prosa que nombra al operador, o 204 si está libre.
export function leerAfiliacion(status, texto) {
  if (status === 204) return { afiliado: false, operador: null }
  if (status === 200) {
    const m = /operador\s+(.+?)[\s.]*$/i.exec((texto || '').trim())
    return { afiliado: true, operador: m ? m[1].trim() : null }
  }
  throw new Indisponible(`validateCitizen respondió ${status}`)
}

export function crearCliente({ base, escritura = false, fetch = globalThis.fetch, timeoutMs = 8000, esperaMs = 300, breaker = crearBreaker() }) {
  async function llamar(metodo, ruta, cuerpo, intentos = 1) {
    if (breaker.abierto()) throw new Indisponible('Circuito abierto: el centralizador falló repetidamente')
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(base + ruta, {
          method: metodo,
          headers: cuerpo ? { 'content-type': 'application/json' } : undefined,
          body: cuerpo ? JSON.stringify(cuerpo) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        })
        const texto = await r.text()
        if (r.status >= 500 && r.status !== 501) throw new Indisponible(`${ruta} respondió ${r.status}`)
        breaker.exito()
        return { status: r.status, texto }
      } catch (e) {
        if (i >= intentos) {
          breaker.fallo()
          throw e instanceof Indisponible ? e : new Indisponible(e.message)
        }
        await new Promise((ok) => setTimeout(ok, esperaMs * 2 ** i))
      }
    }
  }

  return {
    async consultar(id) {
      const { status, texto } = await llamar('GET', `/apis/validateCitizen/${id}`, null, 3)
      return leerAfiliacion(status, texto)
    },
    async registrar(ciudadano) {
      if (!escritura) throw new EscrituraDeshabilitada()
      const { status, texto } = await llamar('POST', '/apis/registerCitizen', ciudadano)
      if (status !== 201) throw new Rechazo(status, texto)
      return texto
    },
    // unregisterCitizen (HU-13): 200, 201 y 204 dejan libre al ciudadano. Es escritura: exige permiso explícito en el GovCarpeta real.
    async desafiliar(ciudadano) {
      if (!escritura) throw new EscrituraDeshabilitada()
      const { status, texto } = await llamar('DELETE', '/apis/unregisterCitizen', ciudadano)
      if (![200, 201, 204].includes(status)) throw new Rechazo(status, texto)
    },
    // getOperators (HU-13, lectura): solo los que publican transferAPIURL pueden recibir un traslado (B-16); los demás llevan null.
    async operadores() {
      const { status, texto } = await llamar('GET', '/apis/getOperators', null, 3)
      if (status !== 200) throw new Rechazo(status, texto)
      return JSON.parse(texto).map((o) => ({ id: o._id ?? o.OperatorId, nombre: o.operatorName ?? o.OperatorName, transferAPIURL: o.transferAPIURL?.trim() || null }))
    },
    async autenticar(documento) {
      if (!escritura) throw new EscrituraDeshabilitada()
      const { status, texto } = await llamar('PUT', '/apis/authenticateDocument', documento)
      if (status !== 200) throw new Rechazo(status, texto)
      return texto
    },
  }
}
