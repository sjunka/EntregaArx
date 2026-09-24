import pg from 'pg'
import { createRemoteJWKSet } from 'jose'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { crearRepo, migrar } from './repo.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await migrar(db)
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de autorizaciones aplicada' }))
  await db.end()
} else {
  const app = crearApp({
    repo: crearRepo(db),
    verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
    horas: Number(env.AUTORIZACION_HORAS ?? 72), // vigencia de una autorización (ADR-0020)
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'autorizaciones', puerto })))
}
