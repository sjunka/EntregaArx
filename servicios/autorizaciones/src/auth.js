import { jwtVerify } from 'jose'

// RNF-11: firma, emisor, audiencia y vigencia se comprueban aquí; ningún servicio confía en el portal.
// jwks: createRemoteJWKSet (servicio) o createLocalJWKSet (pruebas). El emisor es el que ve el navegador.
export const crearVerificador = ({ issuer, audience = 'autorizaciones', jwks }) => async (token) =>
  (await jwtVerify(token, jwks, { issuer, audience })).payload
