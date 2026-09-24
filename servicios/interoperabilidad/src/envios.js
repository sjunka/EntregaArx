import express from 'express'
import { randomUUID } from 'node:crypto'
import { ErrorCustodia } from './custodia.js'
import { UUID, log, problema } from './comun.js'
import { enlaceValido, firmaEnlace } from './enlaces.js'

export const MAX_INTENTOS = 5
export const MAX_DOCUMENTOS = 10
// 10 s, 20 s, 40 s… hasta 5 minutos entre intentos.
export const espera = (intentos) => Math.min(2 ** intentos * 5, 300) * 1000

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const fechaLarga = (d) => d.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' })

export function validarEnvio(b = {}) {
  if (typeof b.correo !== 'string' || b.correo.length > 254 || !CORREO.test(b.correo.trim())) return 'Escribe el correo de la entidad que recibirá los documentos.'
  if (!Array.isArray(b.documentos) || !b.documentos.length || b.documentos.length > MAX_DOCUMENTOS) return `Elige entre 1 y ${MAX_DOCUMENTOS} documentos para enviar.`
  if (!b.documentos.every((d) => typeof d === 'string' && UUID.test(d)) || new Set(b.documentos).size !== b.documentos.length) return 'La lista de documentos no es válida.'
  return null
}

const aEnvio = (e) => ({
  id: e.id, correo: e.correo, documentos: e.documentos, estado: e.estado, creado: new Date(e.creado).toISOString(), venceEn: new Date(e.venceEn).toISOString(),
  ...(e.entregadoEn && { entregadoEn: new Date(e.entregadoEn).toISOString() }),
})

export function textoCorreo(e, baseUrl, secreto) {
  const enlaces = e.documentos.map((d) => `- ${d.titulo}: ${baseUrl}/api/enlaces/${e.id}/${d.id}?f=${firmaEnlace(secreto, e.id, d.id)}`)
  return [
    'Hola.', '',
    `${e.remitente} usa Mi Carpeta Segura y te compartió ${e.documentos.length === 1 ? 'este documento' : 'estos documentos'}:`, '',
    ...enlaces, '',
    `Cada enlace es personal y funciona hasta el ${fechaLarga(new Date(e.venceEn))} (hora de Colombia).`,
    'Este correo no lleva archivos adjuntos: los documentos se descargan desde esos enlaces.',
    'Si no esperabas este mensaje, puedes ignorarlo.',
  ].join('\n')
}

// Entrega el correo de un envío. `repo` (reclamar, entregado, fallo) es el de Postgres; el envío se reclama con un
// arriendo corto para que dos instancias no lo envíen a la vez. Entrega al menos una vez: si el correo salió y el
// registro falla, el reintento lo vuelve a enviar (ponytail: sin confirmación de entrega del proveedor, solo aceptación SMTP).
export function crearEntregador({ repo, correo, baseUrl, secreto, ahora = () => new Date() }) {
  async function intentar(e) {
    try {
      await correo.enviar({ destino: e.correo, asunto: `${e.remitente} te compartió documentos`, texto: textoCorreo(e, baseUrl, secreto) })
    } catch (err) {
      const definitivo = e.intentos + 1 >= MAX_INTENTOS
      log('warn', definitivo ? 'envío fallido: se agotaron los intentos' : 'correo de envío no salió; se reintenta', { envio: e.id, intento: e.intentos + 1, detalle: err.message })
      await repo.fallo(e.id, { error: err.message, siguiente: new Date(ahora().getTime() + espera(e.intentos + 1)), definitivo })
      return false
    }
    await repo.entregado(e.id, {
      nombre: 'envio.entregado',
      datos: { id: e.id, cedula: e.cedula, correo: e.correo, documentos: e.documentos, entregadoEn: ahora().toISOString() },
      dedupe: `envio.entregado:${e.id}`,
    })
    return true
  }
  return {
    intentar,
    // Los envíos pendientes cuyo turno ya llegó; los que esperan su retroceso no se tocan.
    async pendientes() { for (let e; (e = await repo.reclamar());) await intentar(e) },
  }
}

// Reintenta los pendientes cada `intervaloMs`; devuelve la función que detiene el ciclo.
export function iniciarReintentos({ entregador, intervaloMs = 3000, log: aviso = () => {} }) {
  let parar = false
  let espera_
  ;(async () => {
    while (!parar) {
      try { await entregador.pendientes() } catch (e) { aviso('warn', 'reintento de envíos falló', { detalle: e.message }) }
      if (!parar) await new Promise((ok) => { espera_ = setTimeout(ok, intervaloMs) })
    }
  })()
  return () => { parar = true; clearTimeout(espera_) }
}

// Rutas de HU-08. `ciudadano` (con sesión del portal): POST y GET /envios. `publico`: el enlace que abre la entidad.
// dependencias: verificar(token) → claims (audiencia interoperabilidad), repo, entregador, custodia (comprobar, leer),
// autorizaciones (conceder), secreto de enlaces, horas de vigencia, ahora (reloj).
export function rutasEnvios({ verificar, repo, entregador, custodia, autorizaciones, secreto, horas = 72, ahora = () => new Date() }) {
  const ciudadano = express.Router()
  ciudadano.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    try {
      const c = await verificar(token)
      if (c.azp !== 'portal' || !c.cedula) return problema(res, 401, 'Token no válido para envíos')
      req.titular = { cedula: c.cedula, nombre: c.name ?? c.preferred_username ?? 'Un ciudadano' }
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // RF-04.1 y RF-04.2: el ciudadano arma el paquete y escribe el correo de la entidad; el paquete viaja como enlaces.
  ciudadano.post('/', async (req, res, next) => {
    const invalido = validarEnvio(req.body)
    if (invalido) return problema(res, 422, 'Envío inválido', invalido)
    const clave = req.headers['idempotency-key']
    if (clave !== undefined && !/^[\w-]{1,64}$/.test(clave)) return problema(res, 422, 'Envío inválido', 'La clave de idempotencia admite hasta 64 letras, números, guiones y guiones bajos.')
    try {
      const { cedula, nombre } = req.titular
      if (clave) {
        const previo = await repo.porClave(cedula, clave)
        if (previo) return res.status(200).json(aEnvio(previo))
      }
      const correo = req.body.correo.trim().toLowerCase()
      const { documentos } = await custodia.comprobar({ cedula, documentos: req.body.documentos })
      if (documentos.length !== req.body.documentos.length) {
        return problema(res, 422, 'Documentos no disponibles', 'Alguno de los documentos no está en tu carpeta. Actualiza la lista y elige de nuevo.')
      }
      // El envío pasa por la decisión de autorizaciones: enviar es consentir que ese correo lea esos documentos.
      await autorizaciones.conceder({ cedula, tercero: `correo:${correo}`, documentos: req.body.documentos })
      const { envio } = await repo.crear({
        id: randomUUID(), cedula, remitente: nombre, correo, documentos, clave: clave ?? null, venceEn: new Date(ahora().getTime() + horas * 3_600_000),
      })
      // Primer intento en la solicitud; si falla, el ciclo de reintentos lo retoma sin volver a conceder ni duplicar.
      const turno = await repo.reclamar(envio.id)
      if (turno) await entregador.intentar(turno)
      const actual = await repo.obtener(envio.id)
      res.status(actual.estado === 'entregado' ? 201 : 202).json(aEnvio(actual))
    } catch (e) { next(e) }
  })

  ciudadano.get('/', async (req, res, next) => {
    try { res.json((await repo.de(req.titular.cedula)).map(aEnvio)) } catch (e) { next(e) }
  })

  // El enlace del correo: la entidad no tiene cuenta ni llave, así que el enlace es la credencial. Cada apertura pasa por
  // la custodia, que pregunta a MS-06 (RI-08) y registra el acceso; si todo está en regla redirige a una URL de 5 minutos.
  const publico = express.Router()
  publico.get('/:envioId/:documentoId', async (req, res, next) => {
    const { envioId, documentoId } = req.params
    res.set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    if (!UUID.test(envioId) || !UUID.test(documentoId) || !enlaceValido(secreto, envioId, documentoId, req.query.f)) return problema(res, 404, 'Enlace no válido')
    try {
      const envio = await repo.obtener(envioId)
      if (envio?.estado !== 'entregado' || !envio.documentos.some((d) => d.id === documentoId)) return problema(res, 404, 'Enlace no válido')
      if (new Date(envio.venceEn) <= ahora()) return problema(res, 410, 'El enlace venció', 'Pide a quien te lo envió que comparta el documento de nuevo.')
      try {
        const { url } = await custodia.leer({ documentoId, tercero: `correo:${envio.correo}` })
        res.redirect(302, url)
      } catch (err) {
        if (!(err instanceof ErrorCustodia)) throw err
        if (err.status === 403) return problema(res, 403, 'Acceso retirado', 'Quien te envió el documento retiró su autorización.')
        if (err.status === 404) return problema(res, 404, 'El documento ya no está disponible')
        throw err
      }
    } catch (e) { next(e) }
  })
  return { ciudadano, publico }
}

// Repositorio de envíos en la base de MS-07 (RD-11), con la misma bandeja de salida que HU-05.
const aFila = (f) => f && ({
  id: f.id, cedula: f.cedula, remitente: f.remitente, correo: f.correo, documentos: f.documentos, estado: f.estado, intentos: f.intentos,
  siguiente: f.siguiente, ultimoError: f.ultimo_error, clave: f.clave, creado: f.creado, venceEn: f.vence_en, entregadoEn: f.entregado_en,
})

export async function migrarEnvios(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS envios (
    id uuid PRIMARY KEY,
    cedula text NOT NULL,
    remitente text NOT NULL,
    correo text NOT NULL,
    documentos jsonb NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'entregado', 'fallido')),
    intentos int NOT NULL DEFAULT 0,
    siguiente timestamptz NOT NULL DEFAULT now(),
    ultimo_error text,
    clave text,
    creado timestamptz NOT NULL DEFAULT now(),
    vence_en timestamptz NOT NULL,
    entregado_en timestamptz
  )`)
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS envios_clave ON envios (cedula, clave) WHERE clave IS NOT NULL')
  await db.query('CREATE INDEX IF NOT EXISTS envios_cedula ON envios (cedula, creado DESC)')
  await db.query("CREATE INDEX IF NOT EXISTS envios_pendientes ON envios (siguiente) WHERE estado = 'pendiente'")
}

export function crearRepoEnvios(db, bandeja) {
  const filas = async (sql, args) => (await db.query(sql, args)).rows.map(aFila)
  return {
    // Idempotente por (cedula, clave): un reenvío devuelve el envío que ya existe.
    async crear(e) {
      const [nuevo] = await filas(
        `INSERT INTO envios (id, cedula, remitente, correo, documentos, clave, vence_en) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (cedula, clave) WHERE clave IS NOT NULL DO NOTHING RETURNING *`,
        [e.id, e.cedula, e.remitente, e.correo, JSON.stringify(e.documentos), e.clave, e.venceEn])
      if (nuevo) return { envio: nuevo, existente: false }
      return { envio: (await filas('SELECT * FROM envios WHERE cedula = $1 AND clave = $2', [e.cedula, e.clave]))[0], existente: true }
    },
    obtener: async (id) => (await filas('SELECT * FROM envios WHERE id = $1', [id]))[0] ?? null,
    porClave: async (cedula, clave) => (await filas('SELECT * FROM envios WHERE cedula = $1 AND clave = $2', [cedula, clave]))[0] ?? null,
    de: (cedula) => filas('SELECT * FROM envios WHERE cedula = $1 ORDER BY creado DESC LIMIT 50', [cedula]),
    // Toma un pendiente cuyo turno llegó y lo arrienda 60 s; con `id`, solo ese envío.
    reclamar: async (id) => (await filas(
      `UPDATE envios SET siguiente = now() + interval '60 seconds'
       WHERE id = (SELECT id FROM envios WHERE estado = 'pendiente' AND siguiente <= now() AND ($1::uuid IS NULL OR id = $1)
                   ORDER BY siguiente LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [id ?? null]))[0] ?? null,
    // El estado y el evento de confirmación se escriben en una transacción (ADR-0018).
    async entregado(id, evento) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        await c.query("UPDATE envios SET estado = 'entregado', entregado_en = now() WHERE id = $1", [id])
        await bandeja.encolar(evento.nombre, evento.datos.cedula, evento.datos, { cliente: c, dedupe: evento.dedupe })
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
    fallo: (id, { error, siguiente, definitivo }) => db.query(
      `UPDATE envios SET intentos = intentos + 1, ultimo_error = $2, siguiente = $3, estado = $4 WHERE id = $1`,
      [id, error, siguiente, definitivo ? 'fallido' : 'pendiente']),
  }
}
