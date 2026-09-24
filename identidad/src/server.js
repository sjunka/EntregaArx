import pg from 'pg'
import { crearApp, crearLlave, cifrarClave } from './app.js'
import { crearUsuarios, migrar } from './usuarios.js'

const lista = (v = '') => v.split(',').map((s) => s.trim()).filter(Boolean)
const env = process.env
const db = new pg.Pool({ connectionString: env.DATABASE_URL })

if (process.argv.includes('--migrar')) {
  // RD-10: las migraciones corren como proceso aparte, nunca al arrancar el servicio.
  await migrar(db)
  // Ciudadano de demostración (Andrés, del caso de estudio); los afiliados reales los crea Afiliación (HU-01).
  if (env.USUARIO_DEMO_CLAVE) {
    await db.query(
      `INSERT INTO usuarios (cuenta, clave, habilitado, nombres, apellidos, cedula)
       VALUES ('andres.perez.45678@carpetacolombia.co', $1, true, 'Andrés', 'Pérez', '1012345678')
       ON CONFLICT (cuenta) DO UPDATE SET clave = $1`, [await cifrarClave(env.USUARIO_DEMO_CLAVE)])
  }
  // Cuentas de empresas de demostración de MS-11 (HU-10): una con plan Premium y otra sin plan. Mismas empresas que siembra Premium.
  if (env.USUARIO_DEMO_CLAVE) {
    for (const [cuenta, nombres, apellidos, empresa] of [
      ['tramites@premium.carpetacolombia.co', 'Trámites', 'Premium', 'tramites-premium'],
      ['servicios@basico.carpetacolombia.co', 'Servicios', 'Básicos', 'servicios-basicos'],
    ]) {
      await db.query(
        `INSERT INTO usuarios (cuenta, clave, habilitado, nombres, apellidos, empresa) VALUES ($1, $2, true, $3, $4, $5)
         ON CONFLICT (cuenta) DO UPDATE SET clave = $2`, [cuenta, await cifrarClave(env.USUARIO_DEMO_CLAVE), nombres, apellidos, empresa])
    }
  }
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'migración de identidad aplicada' }))
  await db.end()
} else {
  const app = crearApp({
    emisor: env.OIDC_ISSUER ?? 'http://localhost:8081/realms/carpeta',
    llave: await crearLlave(),
    usuarios: crearUsuarios(db),
    clientes: { portal: lista(env.PORTAL_REDIRECTS ?? 'http://localhost:4173/*,http://localhost:5173/*') },
    administradores: env.KC_AFILIACION_SECRETO ? { 'afiliacion-admin': env.KC_AFILIACION_SECRETO } : {},
    // Cada servicio pide token para los servicios que llama: la interoperabilidad a la custodia, autorizaciones (HU-07) y afiliación (HU-09),
    // la custodia a autorizaciones (RI-08) y Premium a autorizaciones (HU-10).
    servicios: {
      ...(env.KC_INTEROP_SECRETO && { interoperabilidad: { secreto: env.KC_INTEROP_SECRETO, audiencia: ['custodia', 'autorizaciones', 'afiliacion'] } }),
      ...(env.KC_CUSTODIA_SECRETO && { custodia: { secreto: env.KC_CUSTODIA_SECRETO, audiencia: 'autorizaciones' } }),
      ...(env.KC_PREMIUM_SECRETO && { premium: { secreto: env.KC_PREMIUM_SECRETO, audiencia: 'autorizaciones' } }),
    },
    origenes: lista(env.ORIGENES ?? 'http://localhost:4173,http://localhost:5173'),
  })
  const puerto = Number(env.PORT ?? 8080)
  app.listen(puerto, () => console.log(JSON.stringify({ nivel: 'info', mensaje: 'emisor OIDC simulado', puerto })))
}
