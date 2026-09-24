import pg from 'pg'
import { createRemoteJWKSet } from 'jose'
import { Kafka, Partitioners } from 'kafkajs'
import { crearApp } from './app.js'
import { crearAutorizaciones } from './autorizaciones.js'
import { crearCustodia, crearProveedorToken } from './custodia.js'
import { crearBandeja, crearPublicador, crearRegistro, iniciarRelevo } from '@mcs/eventos'
import { crearVerificadorFirmas } from './firma.js'
import { crearPasarela } from './pasarela.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })
const bandeja = crearBandeja(db)
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await bandeja.migrar()
  log('info', 'migración de interoperabilidad aplicada')
  await db.end()
} else {
  // EMISORES = "id=urlJWKS;id2=urlJWKS2": directorio de entidades y de la llave pública con la que firman (B-01).
  const emisores = new Map((env.EMISORES ?? '').split(';').filter(Boolean).map((par) => {
    const [id, ...url] = par.split('=')
    return [id.trim(), createRemoteJWKSet(new URL(url.join('=').trim()))]
  }))

  const productor = new Kafka({ clientId: 'interoperabilidad', brokers: env.KAFKA_BROKERS.split(',') }).producer({ createPartitioner: Partitioners.DefaultPartitioner })
  await productor.connect()
  iniciarRelevo({ bandeja, log, publicar: crearPublicador({ productor, registro: crearRegistro(env.SCHEMA_REGISTRY_URL), urlRegistro: env.SCHEMA_REGISTRY_URL }) })

  const token = crearProveedorToken({ url: env.OIDC_INTERNO_URL, clientId: 'interoperabilidad', secreto: env.KC_INTEROP_SECRETO })
  const app = crearApp({
    firmas: crearVerificadorFirmas({ emisores }),
    pasarela: crearPasarela({ url: env.PASARELA_URL }),
    custodia: crearCustodia({ url: env.CUSTODIA_URL, token }),
    autorizaciones: crearAutorizaciones({ url: env.AUTORIZACIONES_URL, token }),
    bandeja,
    operador: env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura',
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => log('info', 'interoperabilidad', { puerto, emisores: [...emisores.keys()] }))
}
