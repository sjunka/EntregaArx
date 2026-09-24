import express from 'express'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

// El enlace de activación es `{id del traslado}.{HMAC}`: no guarda nada y solo sirve para ese traslado.
export const tokenActivacion = (secreto, trasladoId) => `${trasladoId}.${createHmac('sha256', secreto).update(trasladoId).digest('base64url').slice(0, 32)}`
const tokenValido = (secreto, token) => {
  const [id] = typeof token === 'string' ? token.split('.') : []
  if (!UUID.test(id ?? '')) return null
  const esperado = Buffer.from(tokenActivacion(secreto, id))
  const recibido = Buffer.from(token)
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado) ? id : null
}

export function validarTraslado(c = {}) {
  const errores = []
  if (!/^[0-9]{6,10}$/.test(c.cedula ?? '')) errores.push('cedula')
  for (const [k, max] of [['nombre', 60], ['apellido', 60], ['direccion', 120]]) if (!texto(c[k], max)) errores.push(k)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.cuenta ?? '') || c.cuenta.length > 254) errores.push('cuenta')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.correoContacto ?? '')) errores.push('correoContacto')
  if (typeof c.telefono !== 'string' || !/^3[0-9]{9}$/.test(c.telefono)) errores.push('telefono')
  return errores
}

// HU-09 · Traslado de entrada en MS-03. La cuenta institucional (RF-01.5) se crea al recibir el traslado, con una clave
// aleatoria que nadie conoce: el ciudadano la fija con el enlace de activación. La afiliación en GovCarpeta cambia solo
// cuando MS-07 avisa que la Carpeta está completa (RI-03: nunca dos operadores a la vez).
// dependencias: repo (porCedula, porTraslado, crear, activar, afiliar, borrar), keycloak (buscar, crearDeshabilitado, habilitar,
// fijarClave, borrar), pasarela (consultar, registrar), verificar(token) → claims (audiencia afiliacion).
export function rutasTraslados({ repo, keycloak, pasarela, verificar, secreto, operador = 'Mi Carpeta Segura', vigenciaHoras = 24, ahora = () => new Date() }) {
  const vence = (creado) => new Date(new Date(creado).getTime() + vigenciaHoras * 3_600_000)

  // Servicio a servicio: solo la interoperabilidad recibe traslados.
  const interno = express.Router()
  interno.use(express.json({ limit: '4kb' }))
  interno.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Autenticación de servicio requerida')
    try {
      req.claims = await verificar(token)
    } catch {
      return problema(res, 401, 'Token de servicio inválido o vencido')
    }
    req.claims.azp === 'interoperabilidad' ? next() : problema(res, 403, 'Solo para servicios del operador')
  })

  interno.post('/', async (req, res, next) => {
    const errores = validarTraslado(req.body)
    if (errores.length) return problema(res, 422, 'Traslado inválido', `Revisa: ${errores.join(', ')}`)
    const c = req.body
    try {
      const previo = await repo.porCedula(c.cedula)
      if (previo?.estado === 'afiliado') return problema(res, 409, 'Ya está afiliado', 'El ciudadano ya tiene su carpeta en este operador.')
      if (previo?.estado === 'traslado') return res.json({ activacion: tokenActivacion(secreto, previo.trasladoId), venceEn: vence(previo.creado).toISOString() })
      const cuenta = c.cuenta.trim().toLowerCase()
      const usuario = await keycloak.buscar(cuenta)
      if (usuario && usuario.cedula !== c.cedula) return problema(res, 409, 'La cuenta institucional ya existe', 'Esa cuenta pertenece a otra persona en este operador.')
      if (usuario) await keycloak.borrar(usuario.id) // resto de un intento anterior sin completar
      // La clave viaja a nadie: es aleatoria y el ciudadano fija la suya con el enlace de activación.
      const keycloakId = await keycloak.crearDeshabilitado({
        cuenta, nombre: c.nombre.trim(), apellido: c.apellido.trim(), correoContacto: c.correoContacto, telefono: c.telefono, cedula: c.cedula, clave: randomBytes(24).toString('base64url'),
      })
      const fila = await repo.crear({
        cedula: c.cedula, cuenta, keycloakId, creado: ahora(),
        datos: { nombre: c.nombre.trim(), apellido: c.apellido.trim(), direccion: c.direccion.trim(), correoContacto: c.correoContacto, telefono: c.telefono },
      })
      res.status(201).json({ activacion: tokenActivacion(secreto, fila.trasladoId), venceEn: vence(ahora()).toISOString() })
    } catch (e) { next(e) }
  })

  // La Carpeta llegó completa: recién ahora GovCarpeta pasa al ciudadano a este operador.
  interno.post('/:cedula/completar', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      if (!f) return problema(res, 404, 'Traslado no encontrado')
      if (f.estado === 'afiliado') return res.json({ estado: 'afiliado' })
      let afiliacion
      try {
        afiliacion = await pasarela.consultar(f.cedula)
      } catch {
        return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar la afiliación ahora. Reintenta en unos minutos.')
      }
      if (afiliacion.afiliado && afiliacion.operador !== operador) return problema(res, 409, 'Afiliado a otro operador', `GovCarpeta lo reporta en ${afiliacion.operador ?? 'otro operador'}: no se registra una segunda afiliación.`)
      if (!afiliacion.afiliado) {
        try {
          await pasarela.registrar({ id: f.cedula, nombre: `${f.datos.nombre} ${f.datos.apellido}`, direccion: f.datos.direccion, correo: f.cuenta })
        } catch (e) {
          log('warn', 'registro del traslado en GovCarpeta fallido', { status: e.status, detalle: e.message })
          return problema(res, e.status === 503 ? 503 : 502, 'GovCarpeta no registró la afiliación', e.status === 503 ? 'GovCarpeta no respondió a tiempo.' : e.message)
        }
      }
      // El hecho y su evento (el contacto viaja a MS-09 por el bus, nunca a GovCarpeta) se escriben en una transacción.
      await repo.afiliar(f.cedula, { cedula: f.cedula, cuenta: f.cuenta, correoContacto: f.datos.correoContacto, telefono: f.datos.telefono, afiliadoEn: ahora().toISOString() })
      log('info', 'ciudadano afiliado por traslado')
      res.json({ estado: 'afiliado' })
    } catch (e) { next(e) }
  })

  // El traslado falló: se deshace lo creado aquí. Un ciudadano ya afiliado no se toca.
  interno.post('/:cedula/cancelar', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      if (f?.estado === 'afiliado') return problema(res, 409, 'Ya está afiliado', 'Un ciudadano afiliado no se cancela por esta ruta.')
      if (f?.estado === 'traslado') {
        await keycloak.borrar(f.keycloakId)
        await repo.borrar(f.cedula)
      }
      res.json({})
    } catch (e) { next(e) }
  })

  // Enlace de activación: sin sesión, la credencial es el token. Sirve una sola vez y vence a las 24 horas.
  const publico = express.Router()
  publico.use(express.json({ limit: '1kb' }))
  publico.post('/activacion', async (req, res, next) => {
    const { token, clave } = req.body ?? {}
    try {
      const id = tokenValido(secreto, token)
      const f = id && await repo.porTraslado(id)
      if (!f) return problema(res, 404, 'Enlace no válido', 'Este enlace de activación no existe. Pide uno nuevo a tu operador anterior.')
      if (f.activadoEn) return problema(res, 409, 'La cuenta ya fue activada', 'Ingresa con tu cuenta institucional y la clave que elegiste.')
      if (vence(f.creado) <= ahora()) return problema(res, 410, 'El enlace venció', 'Los enlaces de activación duran 24 horas.')
      if (typeof clave !== 'string' || clave.length < 12 || clave.length > 64) return problema(res, 422, 'Clave inválida', 'La clave debe tener entre 12 y 64 caracteres.')
      await keycloak.fijarClave(f.keycloakId, clave)
      await keycloak.habilitar(f.keycloakId)
      await repo.activar(f.trasladoId)
      res.json({ cuenta: f.cuenta })
    } catch (e) { next(e) }
  })
  return { interno, publico }
}

// Repositorio de traslados en la base de MS-03 (RD-11), junto a los ciudadanos.
const aFila = (f) => f && ({
  cedula: f.cedula, cuenta: f.cuenta, estado: f.estado, trasladoId: f.traslado_id, keycloakId: f.keycloak_id, datos: f.datos, creado: f.creado, activadoEn: f.activado_en,
})

export async function migrarTraslados(db) {
  await db.query('ALTER TABLE ciudadanos DROP CONSTRAINT IF EXISTS ciudadanos_estado_check')
  await db.query("ALTER TABLE ciudadanos ADD CONSTRAINT ciudadanos_estado_check CHECK (estado IN ('pendiente', 'afiliado', 'traslado'))")
  await db.query('ALTER TABLE ciudadanos ADD COLUMN IF NOT EXISTS traslado_id uuid UNIQUE')
  await db.query('ALTER TABLE ciudadanos ADD COLUMN IF NOT EXISTS keycloak_id text')
  await db.query('ALTER TABLE ciudadanos ADD COLUMN IF NOT EXISTS datos jsonb')
  await db.query('ALTER TABLE ciudadanos ADD COLUMN IF NOT EXISTS activado_en timestamptz')
}

export function crearRepoTraslados(db) {
  const uno = async (sql, args) => aFila((await db.query(sql, args)).rows[0])
  return {
    porCedula: (cedula) => uno('SELECT * FROM ciudadanos WHERE cedula = $1', [cedula]),
    porTraslado: (id) => uno('SELECT * FROM ciudadanos WHERE traslado_id = $1', [id]),
    // Un registro pendiente de un intento anterior se reutiliza.
    crear: (f) => uno(
      `INSERT INTO ciudadanos (cedula, cuenta, estado, traslado_id, keycloak_id, datos, creado) VALUES ($1, $2, 'traslado', gen_random_uuid(), $3, $4, $5)
       ON CONFLICT (cedula) DO UPDATE SET cuenta = $2, estado = 'traslado', traslado_id = gen_random_uuid(), keycloak_id = $3, datos = $4, creado = $5, activado_en = NULL
       RETURNING *`, [f.cedula, f.cuenta, f.keycloakId, JSON.stringify(f.datos), f.creado]),
    activar: (id) => uno('UPDATE ciudadanos SET activado_en = now() WHERE traslado_id = $1 AND activado_en IS NULL RETURNING *', [id]),
    afiliar: (cedula, evento) => db.query(
      `WITH c AS (UPDATE ciudadanos SET estado = 'afiliado' WHERE cedula = $1 AND estado = 'traslado' RETURNING cedula)
       INSERT INTO bandeja (nombre, clave, datos) SELECT 'ciudadano.afiliado', cedula, $2::jsonb FROM c`, [cedula, JSON.stringify(evento)]),
    borrar: (cedula) => db.query("DELETE FROM ciudadanos WHERE cedula = $1 AND estado = 'traslado'", [cedula]),
  }
}
