import { createRemoteJWKSet } from 'jose'
import { Kafka } from 'kafkajs'
import { MongoClient } from 'mongodb'
import { crearRegistro, iniciarConsumidor } from '@mcs/eventos'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { registrosDeEnvio } from './envios.js'
import { crearRepo } from './mongo.js'

const env = process.env
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const mongo = await new MongoClient(env.MONGO_URL).connect()
const repo = crearRepo(mongo.db(env.MONGO_BASE ?? 'auditoria'))
await repo.indices()

// MS-02 consume los eventos de acceso (lecturas y envíos) y los agrega a la bitácora; `ce_id` es la clave de deduplicación.
await iniciarConsumidor({
  kafka: new Kafka({ clientId: 'auditoria', brokers: env.KAFKA_BROKERS.split(',') }),
  registro: crearRegistro(env.SCHEMA_REGISTRY_URL), grupo: 'auditoria', log,
  manejadores: {
    'mcs.acceso.registrado': (e) => repo.agregar({ eventoId: e.id, ...e.datos }),
    'mcs.envio.entregado': async (e) => { for (const r of registrosDeEnvio(e)) await repo.agregar(r) },
  },
})

const app = crearApp({
  repo,
  verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
  origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => log('info', 'auditoria', { puerto }))
