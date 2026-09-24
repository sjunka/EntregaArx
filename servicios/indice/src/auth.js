import { jwtVerify } from 'jose'

// RNF-11: firma, emisor, audiencia y vigencia se comprueban aquí; ningún servicio confía en el portal.
export const crearVerificador = ({ issuer, audience = 'indice', jwks }) => async (token) =>
  (await jwtVerify(token, jwks, { issuer, audience })).payload
