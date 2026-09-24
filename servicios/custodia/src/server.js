import pg from 'pg'
import { createRemoteJWKSet } from 'jose'
import { Kafka, Partitioners } from 'kafkajs'
import { crearBandeja, crearPublicador, crearRegistro, iniciarRelevo } from '@mcs/eventos'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { crearAlmacen } from './almacen.js'
import { crearPasarela } from './pasarela.js'
import { crearRepositorio, migrar } from './documentos.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await migrar(db)
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de custodia aplicada' }))
  await db.end()
} else {
  const almacenDe = (bucket) => crearAlmacen({
    endpoint: env.S3_ENDPOINT, endpointPublico: env.S3_ENDPOINT_PUBLICO, region: env.S3_REGION ?? 'auto',
    bucket, accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY,
  })
  // Relevo de la bandeja de salida hacia Kafka (CloudEvents con esquema en Schema Registry, ADR-0018).
  const productor = new Kafka({ clientId: 'custodia', brokers: env.KAFKA_BROKERS.split(',') }).producer({ createPartitioner: Partitioners.DefaultPartitioner })
  await productor.connect()
  iniciarRelevo({
    bandeja: crearBandeja(db), log: (nivel, mensaje, extra) => console.log(JSON.stringify({ nivel, mensaje, ...extra })),
    publicar: crearPublicador({ productor, registro: crearRegistro(env.SCHEMA_REGISTRY_URL), urlRegistro: env.SCHEMA_REGISTRY_URL }),
  })
  // El JWKS se lee por la URL interna; el emisor esperado es el público, el que ve el navegador (ADR-0014).
  const app = crearApp({
    documentos: crearRepositorio(db),
    almacen: almacenDe(env.S3_BUCKET),
    almacenCertificados: almacenDe(env.S3_BUCKET_CERTIFICADOS),
    pasarela: crearPasarela({ url: env.PASARELA_URL }),
    verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'custodia', puerto })))
}
