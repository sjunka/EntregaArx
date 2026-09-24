import express from 'express'
import { cuentaInstitucional, validarRegistro, cedulaEnmascarada } from './cuenta.js'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

// B-06: no existe API de la Registraduría; la verificación de identidad se simula y siempre aprueba.
export const registraduriaSimulada = { verificar: async () => true }

// ponytail: límite por IP en memoria de la instancia; pasar a Cloud Armor en la arquitectura objetivo.
export function crearLimite({ max = 5, ventanaMs = 3_600_000, ahora = Date.now } = {}) {
  const hits = new Map()
  return (ip) => {
    const t = ahora()
    // ponytail: barrido completo al crecer; basta mientras el mapa quepa en memoria de sobra.
    if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.at(-1) >= ventanaMs) hits.delete(k)
    const lista = (hits.get(ip) ?? []).filter((x) => t - x < ventanaMs)
    lista.push(t)
    hits.set(ip, lista)
    return lista.length <= max
  }
}

// dependencias: db (query), pasarela (consultar, registrar), keycloak (Admin API: existe, crearDeshabilitado, habilitar, borrar),
// registraduria (verificar), traslados ({ interno, publico } de rutasTraslados). confiarProxy: saltos de proxy de confianza para req.ip (0 si se publica directo).
export function crearApp({
  db, pasarela, keycloak, registraduria = registraduriaSimulada, limite = crearLimite(), origenes = [],
  operador = 'Mi Carpeta Segura', confiarProxy = 0, traslados, salida,
}) {
  const app = express()
  app.set('trust proxy', confiarProxy)
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  app.use(express.json({ limit: '4kb' }))
  // HU-09: traslado de entrada (rutas de servicio de MS-07 y enlace de activación del ciudadano).
  if (traslados) {
    app.use('/interno/traslados', traslados.interno)
    app.use('/traslados', traslados.publico)
  }
  // HU-13: traslado de salida (baja en GovCarpeta, reafiliación y cierre de la cuenta; solo MS-07).
  if (salida) app.use('/interno/salida', salida)

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.post('/ciudadanos', async (req, res) => {
    const errores = validarRegistro(req.body)
    if (errores.length) return problema(res, 400, 'Datos inválidos', `Revisa: ${errores.join(', ')}`)
    if (!limite(req.ip)) return problema(res, 429, 'Demasiados registros', 'Intenta de nuevo en una hora')

    const d = req.body
    const cedula = cedulaEnmascarada(d.cedula)
    if (!(await registraduria.verificar(d))) {
      return problema(res, 422, 'No pudimos verificar tu identidad', 'Los datos no coinciden con los de la Registraduría.')
    }

    let afiliacion
    try {
      afiliacion = await pasarela.consultar(d.cedula)
    } catch {
      await db.query(`INSERT INTO ciudadanos (cedula, estado) VALUES ($1, 'pendiente') ON CONFLICT (cedula) DO NOTHING`, [d.cedula])
      log('warn', 'centralizador no disponible; registro pendiente', { cedula })
      return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar que no estés afiliado a otro operador. Intenta más tarde.')
    }
    // Afiliado aquí sin cuenta activa: un registro anterior se interrumpió después de escribir en GovCarpeta.
    const propio = afiliacion.afiliado && afiliacion.operador === operador
    if (afiliacion.afiliado && !propio) {
      return problema(res, 409, 'Ya estás afiliado', `GovCarpeta te reporta en el operador ${afiliacion.operador ?? 'de otro proveedor'}.`)
    }

    // La cuenta sale de la cédula; los intentos resuelven colisiones con cuentas de otras personas.
    let cuenta, previo
    for (let i = 0; i < 5; i++) {
      cuenta = cuentaInstitucional(d, i)
      previo = await keycloak.buscar(cuenta)
      if (!previo || previo.cedula === d.cedula) break
    }
    if (previo?.cedula !== d.cedula) previo = null
    if (previo?.habilitado) return problema(res, 409, 'Ya estás afiliado', `Ya tienes carpeta en ${operador}. Ingresa con tu cuenta institucional.`)
    // Cuenta deshabilitada de un intento anterior: se rehace con la clave de esta solicitud.
    if (previo) await keycloak.borrar(previo.id)

    const idUsuario = await keycloak.crearDeshabilitado({ ...d, cuenta })
    if (!propio) {
      try {
        // RF-06.2 y RNF-21: a GovCarpeta solo viajan id, nombre, dirección y correo institucional.
        await pasarela.registrar({ id: d.cedula, nombre: `${d.nombre} ${d.apellido}`, direccion: d.direccion, correo: cuenta })
      } catch (e) {
        // Con 503 (timeout) GovCarpeta pudo registrarlo: la cuenta queda deshabilitada y el reintento la repara.
        if (e.status !== 503) await keycloak.borrar(idUsuario) // compensación: sin registro central no hay cuenta
        log('warn', 'registro central fallido', { cedula, status: e.status, detalle: e.message })
        return problema(res, e.status === 503 ? 503 : 502, 'GovCarpeta no registró la afiliación',
          e.status === 503 ? 'GovCarpeta no respondió a tiempo. Intenta de nuevo en unos minutos.' : e.message)
      }
    }
    await keycloak.habilitar(idUsuario)
    // El hecho y su evento se escriben en una sola sentencia (bandeja de salida): nunca uno sin el otro. El contacto
    // viaja solo por el bus interno hacia MS-09, nunca a GovCarpeta (RD-15, RNF-21).
    const evento = { cedula: d.cedula, cuenta, correoContacto: d.correoContacto, telefono: d.telefono, afiliadoEn: new Date().toISOString() }
    await db.query(
      `WITH c AS (
         INSERT INTO ciudadanos (cedula, cuenta, estado, direccion) VALUES ($1, $2, 'afiliado', $4)
         ON CONFLICT (cedula) DO UPDATE SET cuenta = $2, estado = 'afiliado', direccion = $4 RETURNING cedula)
       INSERT INTO bandeja (nombre, clave, datos) SELECT 'ciudadano.afiliado', cedula, $3::jsonb FROM c`,
      [d.cedula, cuenta, JSON.stringify(evento), d.direccion.trim()])
    log('info', 'ciudadano afiliado', { cedula })
    res.status(201).json({ cedula: d.cedula, cuenta, estado: 'afiliado', identidad: 'simulada' })
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande')
    log('error', err.message)
    problema(res, 500, 'Error interno')
  })
  return app
}
