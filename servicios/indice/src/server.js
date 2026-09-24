import { createRemoteJWKSet } from 'jose'
import { Kafka } from 'kafkajs'
import { MongoClient } from 'mongodb'
import { crearRegistro, iniciarConsumidor } from '@mcs/eventos'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { crearRepo } from './mongo.js'

const env = process.env
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const mongo = await new MongoClient(env.MONGO_URL).connect()
const repo = crearRepo(mongo.db(env.MONGO_BASE ?? 'indice'))
await repo.indices()

// MS-05 solo consume: el índice se alimenta de los eventos de documento (AD-05).
await iniciarConsumidor({
  kafka: new Kafka({ clientId: 'indice', brokers: env.KAFKA_BROKERS.split(',') }),
  registro: crearRegistro(env.SCHEMA_REGISTRY_URL), grupo: 'indice', log,
  manejadores: {
    'mcs.documento.cargado': (e) => repo.cargado(e.datos),
    'mcs.documento.autenticado': (e) => repo.autenticado(e.datos),
    'mcs.documento.eliminado': (e) => repo.eliminado(e.datos),
    'mcs.documento.recibido': (e) => repo.recibido(e.datos),
    'mcs.ciudadano.trasladado': (e) => repo.trasladado(e.datos),
  },
})

const app = crearApp({
  repo,
  verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
  origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => log('info', 'indice', { puerto }))
