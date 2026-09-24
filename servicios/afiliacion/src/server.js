import pg from 'pg'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { crearApp, crearLimite } from './app.js'
import { crearKeycloak } from './keycloak.js'
import { crearPasarela } from './pasarela.js'
import { crearRepoTraslados, migrarTraslados, rutasTraslados } from './traslados.js'
import { Kafka, Partitioners } from 'kafkajs'
import { crearBandeja, crearPublicador, crearRegistro, iniciarRelevo } from '@mcs/eventos'

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
  await crearBandeja(db).migrar()
  await migrarTraslados(db)
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de afiliacion aplicada' }))
  await db.end()
} else {
  // Relevo de la bandeja de salida hacia Kafka (CloudEvents con esquema en Schema Registry).
  const productor = new Kafka({ clientId: 'afiliacion', brokers: env.KAFKA_BROKERS.split(',') }).producer({ createPartitioner: Partitioners.DefaultPartitioner })
  await productor.connect()
  iniciarRelevo({
    bandeja: crearBandeja(db), log: (nivel, mensaje, extra) => console.log(JSON.stringify({ nivel, mensaje, ...extra })),
    publicar: crearPublicador({ productor, registro: crearRegistro(env.SCHEMA_REGISTRY_URL), urlRegistro: env.SCHEMA_REGISTRY_URL }),
  })
  const pasarela = crearPasarela({ url: env.PASARELA_URL })
  // Emisor simulado o Keycloak: los dos exponen el mismo Admin API (ADR-0014).
  const keycloak = crearKeycloak({
    url: env.KEYCLOAK_URL, realm: env.KEYCLOAK_REALM ?? 'carpeta',
    clientId: env.KEYCLOAK_CLIENTE ?? 'afiliacion-admin', clientSecret: env.KEYCLOAK_SECRETO,
  })
  const jwks = createRemoteJWKSet(new URL(env.OIDC_JWKS_URL))
  const operador = env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura'
  const app = crearApp({
    db, pasarela, keycloak,
    traslados: rutasTraslados({
      repo: crearRepoTraslados(db), keycloak, pasarela, operador, secreto: env.ACTIVACION_SECRETO,
      verificar: async (token) => (await jwtVerify(token, jwks, { issuer: env.OIDC_ISSUER, audience: 'afiliacion' })).payload,
    }),
    limite: crearLimite({ max: Number(env.LIMITE_REGISTROS_HORA ?? 5) }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
    operador,
    confiarProxy: Number(env.CONFIAR_PROXY ?? 0), // 1 detrás del balanceador de Cloud Run
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'afiliacion', puerto })))
}
