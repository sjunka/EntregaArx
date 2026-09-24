import { compactVerify } from 'jose'

const CAMPOS = ['idExterno', 'cedula', 'titulo', 'sha256']

// B-01/B-03: sin contrato MinTIC, la entidad firma un JWS compacto (RS256 o ES256) cuyo payload repite los campos que
// el operador debe poder atribuirle. La llave pública de cada entidad está registrada en `emisores`
// (emisor → función de llaves de jose: JWKS remoto en compose, local en pruebas).
export function crearVerificadorFirmas({ emisores }) {
  return {
    conoce: (emisor) => emisores.has(emisor),
    async verificar(emision) {
      let claims
      try {
        const { payload } = await compactVerify(emision.firma, emisores.get(emision.emisor), { algorithms: ['RS256', 'ES256'] })
        claims = JSON.parse(new TextDecoder().decode(payload))
      } catch {
        return { valida: false, motivo: 'La firma no verifica con la llave registrada de la entidad.' }
      }
      if (claims.iss !== emision.emisor) return { valida: false, motivo: 'El emisor de la firma no coincide con el declarado.' }
      const distinto = CAMPOS.find((c) => claims[c] !== emision[c])
      if (distinto) return { valida: false, motivo: `La firma no cubre el campo «${distinto}» tal como se envió: el documento fue alterado.` }
      return { valida: true }
    },
  }
}
