import { createRemoteJWKSet } from 'jose'
import { Kafka } from 'kafkajs'
import { MongoClient } from 'mongodb'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { crearCorreo, crearSmsSimulado } from './canales.js'
import { crearRegistro, iniciarConsumidor } from '@mcs/eventos'
import { crearRepos } from './mongo.js'
import { crearNotificador } from './notificador.js'

const env = process.env
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const mongo = await new MongoClient(env.MONGO_URL).connect()
const repos = crearRepos(mongo.db(env.MONGO_BASE ?? 'notificaciones'))
await repos.indices()

const notificador = crearNotificador({
  ...repos, log,
  canales: { correo: crearCorreo({ url: env.SMTP_URL, remitente: env.CORREO_REMITENTE ?? 'Mi Carpeta Segura <avisos@carpetacolombia.co>' }), sms: crearSmsSimulado({ log }) },
})

await iniciarConsumidor({
  kafka: new Kafka({ clientId: 'notificaciones', brokers: env.KAFKA_BROKERS.split(',') }),
  registro: crearRegistro(env.SCHEMA_REGISTRY_URL), grupo: 'notificaciones', log,
  manejadores: {
    'mcs.ciudadano.afiliado': (e) => notificador.alAfiliar(e.datos),
    'mcs.documento.recibido': (e) => notificador.alRecibirDocumento(e),
    'mcs.envio.entregado': (e) => notificador.alEntregarEnvio(e),
    'mcs.ciudadano.trasladado': (e) => repos.contactos.borrar(e.datos.cedula),
  },
})

const app = crearApp({
  ...repos,
  verificar: crearVerificador({ issuer: env.OIDC_ISSUER, audience: 'notificaciones', jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
  origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
})
const puerto = Number(env.PORT ?? 8080)
app.listen(puerto, () => log('info', 'notificaciones', { puerto }))
