// Consulta de afiliación por la pasarela del centralizador (MS-08), RF-03.1.
export function crearPasarela({ url }) {
  return {
    async consultar(cedula) {
      const r = await fetch(`${url}/centralizador/ciudadanos/${cedula}`, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) throw new Error(`pasarela respondió ${r.status}`)
      return r.json()
    },
    // HU-13: directorio de operadores (getOperators): [{ id, nombre, transferAPIURL | null }].
    async operadores() {
      const r = await fetch(`${url}/centralizador/operadores`, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) throw new Error(`pasarela respondió ${r.status}`)
      return r.json()
    },
  }
}
