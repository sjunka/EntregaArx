import pg from 'pg'
import { createRemoteJWKSet } from 'jose'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await db.query(`CREATE TABLE IF NOT EXISTS documentos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titular text NOT NULL,
    titulo text NOT NULL,
    creado timestamptz NOT NULL DEFAULT now()
  )`)
  await db.query('CREATE INDEX IF NOT EXISTS documentos_titular ON documentos (titular)')
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de custodia aplicada' }))
  await db.end()
} else {
  // El JWKS se lee por la URL interna; el emisor esperado es el público, el que ve el navegador (ADR-0014).
  const app = crearApp({
    db,
    verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'custodia', puerto })))
}
