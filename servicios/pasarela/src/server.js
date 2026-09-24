import { crearApp } from './app.js'
import { crearCliente } from './govcarpeta.js'

const REAL = 'https://govcarpeta-apis-4905ff3c005b.herokuapp.com'
const env = process.env
const base = env.GOVCARPETA_URL ?? REAL

const app = crearApp({
  // Al GovCarpeta real solo se escribe con permiso explícito; el stub local siempre acepta escrituras.
  cliente: crearCliente({ base, escritura: new URL(base).host !== new URL(REAL).host || env.GOVCARPETA_ESCRITURA === '1' }),
  operador: { id: env.OPERADOR_ID, nombre: env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura' },
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'pasarela', puerto, govcarpeta: base })))
