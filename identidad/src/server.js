import { crearApp, crearLlave } from './app.js'

const lista = (v = '') => v.split(',').map((s) => s.trim()).filter(Boolean)
const env = process.env

// Ciudadano de demostración (Andrés, del caso de estudio). Desde HU-01 los afiliados reales se agregan aquí.
const usuarios = env.USUARIO_DEMO_CLAVE
  ? [{ cuenta: 'andres.perez.45678@carpetacolombia.co', clave: env.USUARIO_DEMO_CLAVE, cedula: '1012345678', nombres: 'Andrés', apellidos: 'Pérez' }]
  : []

const app = crearApp({
  emisor: env.OIDC_ISSUER ?? 'http://localhost:8081/realms/carpeta',
  llave: await crearLlave(),
  usuarios,
  clientes: { portal: lista(env.PORTAL_REDIRECTS ?? 'http://localhost:4173/*,http://localhost:5173/*') },
  origenes: lista(env.ORIGENES ?? 'http://localhost:4173,http://localhost:5173'),
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'emisor OIDC simulado', puerto })))
