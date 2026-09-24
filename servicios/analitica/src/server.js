import { createRemoteJWKSet } from 'jose'
import { Kafka } from 'kafkajs'
import { MongoClient } from 'mongodb'
import { crearRegistro, iniciarConsumidor } from '@mcs/eventos'
import { crearApp } from './app.js'
import { crearAnonimizador } from './anonimizar.js'
import { crearVerificador } from './auth.js'
import { crearRepo } from './mongo.js'

const env = process.env
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const mongo = await new MongoClient(env.MONGO_URL).connect()
const repo = crearRepo(mongo.db(env.MONGO_BASE ?? 'analitica'))
await repo.indices()

// REGIONES_EMISORES = "emisor=Región;emisor2=Región2": región de cada institución emisora (ADR-0023).
const regiones = new Map((env.REGIONES_EMISORES ?? '').split(';').filter(Boolean).map((par) => par.split('=').map((s) => s.trim())))
if (!env.ANALITICA_SAL) throw new Error('Falta ANALITICA_SAL: sin sal la llave de deduplicación no es opaca')
const anonimizar = crearAnonimizador({ regiones, sal: env.ANALITICA_SAL })

// MS-10 consume los Certificados vigentes y consolida solo metadatos anonimizados; no está en el camino crítico de la carpeta.
await iniciarConsumidor({
  kafka: new Kafka({ clientId: 'analitica', brokers: env.KAFKA_BROKERS.split(',') }),
  registro: crearRegistro(env.SCHEMA_REGISTRY_URL), grupo: 'analitica', log,
  manejadores: { 'mcs.documento.recibido': async (e) => { const r = anonimizar(e); if (r) await repo.agregar(r) } },
})

const app = crearApp({
  repo,
  umbral: Number(env.UMBRAL_ANONIMATO ?? 10),
  verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
  origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => log('info', 'analitica', { puerto, regiones: [...regiones.values()] }))
