import pg from 'pg'
import { createRemoteJWKSet } from 'jose'
import { Kafka, Partitioners } from 'kafkajs'
import { crearApp } from './app.js'
import { crearVerificador } from './auth.js'
import { crearCorreo } from './correo.js'
import { crearEntregador, crearRepoEnvios, iniciarReintentos, migrarEnvios, rutasEnvios } from './envios.js'
import { crearAfiliacion } from './afiliacion.js'
import { crearAutorizaciones } from './autorizaciones.js'
import { crearCustodia, crearProveedorToken } from './custodia.js'
import { crearBandeja, crearPublicador, crearRegistro, iniciarRelevo } from '@mcs/eventos'
import { crearVerificadorFirmas } from './firma.js'
import { crearPasarela } from './pasarela.js'
import { crearProcesadorSalida, crearRepoSalida, enviarAlDestino, iniciarSalidas, migrarSalida, rutasSalida } from './salida.js'
import { confirmarAlOrigen, crearProcesador, crearRepoTraslados, iniciarTraslados, migrarTraslados, rutasTraslados } from './traslados.js'

const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })
const bandeja = crearBandeja(db)
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await bandeja.migrar()
  await migrarEnvios(db)
  await migrarTraslados(db)
  await migrarSalida(db)
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
  // HU-08: envío a una entidad sin operador. Los enlaces del correo apuntan a este servicio (ENLACES_URL, la URL que ve la entidad).
  const repoEnvios = crearRepoEnvios(db, bandeja)
  const entregador = crearEntregador({
    repo: repoEnvios, baseUrl: env.ENLACES_URL, secreto: env.ENLACE_SECRETO,
    correo: crearCorreo({ url: env.SMTP_URL, remitente: env.CORREO_REMITENTE ?? 'Mi Carpeta Segura <envios@carpetacolombia.co>' }),
  })
  iniciarReintentos({ entregador, log })
  const autorizaciones = crearAutorizaciones({ url: env.AUTORIZACIONES_URL, token })
  const custodia = crearCustodia({ url: env.CUSTODIA_URL, token })
  // HU-09: traslado de entrada. Un procesador orquesta cada traslado en curso (la custodia descarga, MS-03 afilia, el origen confirma).
  const afiliacion = crearAfiliacion({ url: env.AFILIACION_URL, token })
  const repoTraslados = crearRepoTraslados(db)
  const hostsInternos = (env.TRASLADO_HOSTS_INTERNOS ?? '').split(',').filter(Boolean)
  iniciarTraslados({ procesador: crearProcesador({ repo: repoTraslados, custodia, afiliacion, confirmar: confirmarAlOrigen }), log })
  // HU-13: traslado de salida. El estado vive en la base; el procesador congela, da de baja, envía y, tras la confirmación, cierra.
  const verificarCiudadano = crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) })
  const pasarelaCentralizador = crearPasarela({ url: env.PASARELA_URL })
  const repoSalida = crearRepoSalida(db, bandeja)
  const nombreOperador = env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura'
  iniciarSalidas({ procesador: crearProcesadorSalida({ repo: repoSalida, custodia, afiliacion, enviar: enviarAlDestino, urlPublica: env.URL_PUBLICA, secreto: env.ENLACE_SECRETO }), log })
  const app = crearApp({
    salida: rutasSalida({ repo: repoSalida, pasarela: pasarelaCentralizador, verificar: verificarCiudadano, operador: nombreOperador, secreto: env.ENLACE_SECRETO, hostsInternos }),
    traslados: rutasTraslados({
      firmas: crearVerificadorFirmas({ emisores }), pasarela: crearPasarela({ url: env.PASARELA_URL }), afiliacion, repo: repoTraslados, hostsInternos,
      spaUrl: env.SPA_URL, operador: env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura',
      verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
    }),
    envios: rutasEnvios({
      repo: repoEnvios, entregador, custodia, autorizaciones, secreto: env.ENLACE_SECRETO, horas: Number(env.AUTORIZACION_HORAS ?? 72),
      verificar: crearVerificador({ issuer: env.OIDC_ISSUER, jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) }),
    }),
    origenes: (env.ORIGENES ?? '').split(',').filter(Boolean),
    firmas: crearVerificadorFirmas({ emisores }),
    pasarela: crearPasarela({ url: env.PASARELA_URL }),
    custodia, autorizaciones,
    bandeja,
    operador: env.OPERADOR_NOMBRE ?? 'Mi Carpeta Segura',
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => log('info', 'interoperabilidad', { puerto, emisores: [...emisores.keys()] }))
}
