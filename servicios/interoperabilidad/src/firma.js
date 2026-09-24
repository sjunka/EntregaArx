import { compactVerify, decodeJwt } from 'jose'

const CAMPOS = ['idExterno', 'cedula', 'titulo', 'sha256']

// B-01/B-03: sin contrato MinTIC, la entidad firma un JWS compacto (RS256 o ES256) cuyo payload repite los campos que
// el operador debe poder atribuirle. La llave pública de cada entidad está registrada en `emisores`
// (emisor → función de llaves de jose: JWKS remoto en compose, local en pruebas).
export function crearVerificadorFirmas({ emisores }) {
  const ALGORITMOS = ['RS256', 'ES256']
  // Verifica el JWS con la llave de `emisor` y que su payload repita, campo a campo, lo que se recibió.
  async function verificarFirma(emisor, firma, esperado) {
    let claims
    try {
      const { payload } = await compactVerify(firma, emisores.get(emisor), { algorithms: ALGORITMOS })
      claims = JSON.parse(new TextDecoder().decode(payload))
    } catch {
      return { valida: false, motivo: 'La firma no verifica con la llave registrada de la entidad.' }
    }
    if (claims.iss !== emisor) return { valida: false, motivo: 'El emisor de la firma no coincide con el declarado.' }
    const distinto = Object.keys(esperado).find((c) => JSON.stringify(claims[c]) !== JSON.stringify(esperado[c]))
    if (distinto) return { valida: false, motivo: `La firma no cubre el campo «${distinto}» tal como se envió: el mensaje fue alterado.` }
    return { valida: true }
  }
  return {
    conoce: (emisor) => emisores.has(emisor),
    verificarFirma,
    verificar: (emision) => verificarFirma(emision.emisor, emision.firma, Object.fromEntries(CAMPOS.map((c) => [c, emision[c]]))),
    // Autenticación de una consulta (GET): un JWS de vida corta, `{ iss, iat, exp }`, firmado por la entidad.
    // Devuelve el emisor o null si no verifica, venció o vive más de 5 minutos.
    async verificarToken(jws, ahora = Date.now()) {
      let iss
      try { iss = decodeJwt(jws).iss } catch { return null }
      if (!emisores.has(iss)) return null
      try {
        const { payload } = await compactVerify(jws, emisores.get(iss), { algorithms: ALGORITMOS })
        const c = JSON.parse(new TextDecoder().decode(payload))
        const t = ahora / 1000
        return c.iss === iss && c.exp > t && c.iat <= t + 60 && c.exp - c.iat <= 300 ? iss : null
      } catch { return null }
    },
  }
}
