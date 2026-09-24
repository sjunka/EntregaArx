import pg from 'pg'
import { crearApp, crearLimite } from './app.js'
import { crearKeycloak } from './keycloak.js'
import { crearPasarela } from './pasarela.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await db.query(`CREATE TABLE IF NOT EXISTS ciudadanos (
    cedula text PRIMARY KEY,
    cuenta text UNIQUE,
    estado text NOT NULL CHECK (estado IN ('pendiente', 'afiliado')),
    creado timestamptz NOT NULL DEFAULT now()
  )`)
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de afiliacion aplicada' }))
  await db.end()
} else {
  const app = crearApp({
    db,
    pasarela: crearPasarela({ url: env.PASARELA_URL }),
    // Emisor simulado o Keycloak: los dos exponen el mismo Admin API (ADR-0014).
    keycloak: crearKeycloak({
      url: env.KEYCLOAK_URL, realm: env.KEYCLOAK_REALM ?? 'carpeta',
      clientId: env.KEYCLOAK_CLIENTE ?? 'afiliacion-admin', clientSecret: env.KEYCLOAK_SECRETO,
    }),
    limite: crearLimite({ max: Number(env.LIMITE_REGISTROS_HORA ?? 5) }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
    operador: env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura',
    confiarProxy: Number(env.CONFIAR_PROXY ?? 0), // 1 detrás del balanceador de Cloud Run
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'afiliacion', puerto })))
}
