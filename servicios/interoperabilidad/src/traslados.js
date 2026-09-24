import express from 'express'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { ErrorAfiliacion } from './afiliacion.js'
import { log, problema, sesionCiudadano, texto } from './comun.js'

export const MAX_DOCUMENTOS = 50
export const MAX_INTENTOS_DOCUMENTO = 3 // RF-03.5: un documento se reintenta antes de dar el traslado por fallido
export const MAX_INTENTOS_COMPLETAR = 3
const MAX_ARCHIVO = 10 * 1024 * 1024
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png']
// Retroceso exponencial con tope: 4 s, 8 s… hasta 1 minuto entre documentos; 20 s… hasta 5 minutos para la confirmación.
export const esperaDocumento = (n) => Math.min(2 ** n * 2, 60) * 1000
export const esperaConfirmacion = (n) => Math.min(2 ** n * 10, 300) * 1000

const v4Privada = (ip) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}
const privada = (ip) => {
  if (isIP(ip) === 4) return v4Privada(ip)
  const v6 = ip.toLowerCase()
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  return mapeada ? v4Privada(mapeada[1]) : v6 === '::1' || v6 === '::' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

// La URL de confirmación la pone el operador de origen (firmada): solo https y nunca la red interna, salvo los hosts
// internos que compose permite. ponytail: copia de la política de la custodia (src/traslado.js); extraer si se necesita una tercera.
export async function urlPermitida(url, hostsInternos, resolver) {
  let u
  try { u = new URL(url) } catch { return false }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (hostsInternos.includes(host)) return ['http:', 'https:'].includes(u.protocol)
  if (u.protocol !== 'https:') return false
  try { return (await resolver(host, { all: true })).every((d) => !privada(d.address)) } catch { return false }
}

export function validarTraslado(t = {}) {
  if (!texto(t.operador, 80)) return 'Falta el operador de origen.'
  if (!/^[0-9]{6,10}$/.test(t.id ?? '')) return 'La cédula (id) del ciudadano no es válida.'
  if (!texto(t.nombre, 60) || !texto(t.apellido, 60)) return 'Faltan el nombre y el apellido del ciudadano.'
  if (!texto(t.direccion, 120)) return 'Falta la dirección del ciudadano (GovCarpeta la exige al registrarlo).'
  const correo = (v) => typeof v === 'string' && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
  if (!correo(t.correo)) return 'Falta el correo institucional del ciudadano (su cuenta, que sobrevive al traslado).'
  if (!correo(t.correoContacto)) return 'Falta el correo de contacto del ciudadano.'
  if (typeof t.telefono !== 'string' || !/^3[0-9]{9}$/.test(t.telefono)) return 'Falta el celular del ciudadano (10 dígitos, empieza por 3).'
  if (!texto(t.confirmAPI, 500)) return 'Falta el confirmAPI del operador de origen.'
  if (typeof t.firma !== 'string' || !t.firma) return 'Falta la firma del traslado.'
  if (!Array.isArray(t.documentos) || !t.documentos.length || t.documentos.length > MAX_DOCUMENTOS) return `El traslado debe traer entre 1 y ${MAX_DOCUMENTOS} documentos.`
  for (const d of t.documentos) {
    if (!texto(d?.idExterno, 120) || !texto(d.titulo, 120)) return 'Cada documento necesita su idExterno y su título.'
    if (!['temporal', 'certificado'].includes(d.clase)) return 'La clase de cada documento debe ser temporal o certificado.'
    if (d.clase === 'certificado' && !texto(d.emisor, 80)) return 'Un Certificado necesita su entidad emisora.'
    if (!TIPOS.includes(d.tipo)) return 'Solo se aceptan documentos PDF, JPG o PNG.'
    if (!Number.isInteger(d.tamano) || d.tamano <= 0 || d.tamano > MAX_ARCHIVO) return 'El tamaño de cada documento debe ser de 1 byte a 10 MB.'
    if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? '')) return 'El SHA-256 de cada documento no es válido.'
    if (!texto(d.url, 2000) || !/^https?:\/\//.test(d.url)) return 'La dirección (url) de cada documento no es válida.'
  }
  if (new Set(t.documentos.map((d) => d.idExterno)).size !== t.documentos.length) return 'Los idExterno de los documentos no pueden repetirse.'
  return null
}

const aTraslado = (t) => ({
  id: t.id, operador: t.operador, estado: t.estado, total: t.total, recibidos: t.recibidos, creado: new Date(t.creado).toISOString(),
  ...(t.completadoEn && { completadoEn: new Date(t.completadoEn).toISOString() }),
})

// HU-09 · Traslado de entrada. `peer`: POST /api/transferCitizen, de un operador par (JWS del directorio, como las entidades).
// `ciudadano`: GET /traslados/actual, el avance que ve el ciudadano. MS-07 no toca el contenido (RI-06): la custodia descarga.
// dependencias: firmas (conoce, verificarFirma), pasarela (consultar), afiliacion (iniciar), repo, verificar(token) → claims.
export function rutasTraslados({ firmas, pasarela, afiliacion, repo, verificar, spaUrl, operador, hostsInternos = [], resolver = lookup }) {
  const peer = express.Router()
  peer.post('/', async (req, res, next) => {
    const invalido = validarTraslado(req.body)
    if (invalido) return problema(res, 422, 'Traslado inválido', invalido)
    const t = req.body
    if (!firmas.conoce(t.operador)) return problema(res, 403, 'Operador no registrado', 'Este operador no tiene una llave registrada para el operador de origen.')
    try {
      const firma = await firmas.verificarFirma(t.operador, t.firma, { id: t.id, confirmAPI: t.confirmAPI, sha256: t.documentos.map((d) => d.sha256) })
      if (!firma.valida) return problema(res, 401, 'Firma no válida', firma.motivo)
      if (!(await urlPermitida(t.confirmAPI, hostsInternos, resolver))) return problema(res, 422, 'confirmAPI no permitido', 'El confirmAPI debe ser una dirección https pública.')

      // Reenvío idempotente: el mismo operador y ciudadano con un traslado activo devuelve ese traslado.
      const previo = await repo.activoDe(t.operador, t.id)
      const resumen = async (traslado, status) => {
        const { activacion } = await afiliacion.iniciar(cuentaDe(t)) // idempotente en MS-03: devuelve el mismo enlace
        res.status(status).json({ ...aTraslado(traslado), activacion: `${spaUrl}/#activar/${activacion}` })
      }
      if (previo) return await resumen(previo, 200)

      // RI-03: nunca dos operadores a la vez. El origen ya debió dar de baja al ciudadano en GovCarpeta (secuencia del traslado).
      let afiliacionCentral
      try {
        afiliacionCentral = await pasarela.consultar(t.id)
      } catch (err) {
        log('warn', 'centralizador no disponible al recibir un traslado', { detalle: err.message })
        return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar la afiliación del ciudadano ahora. Reintenta en unos minutos.')
      }
      if (afiliacionCentral.afiliado) {
        return problema(res, 409, afiliacionCentral.operador === operador ? 'Ya está afiliado' : 'Sigue afiliado a otro operador',
          afiliacionCentral.operador === operador ? 'El ciudadano ya tiene su carpeta en este operador.' : 'GovCarpeta lo reporta en otro operador: el origen debe darlo de baja antes de trasladar (nunca dos operadores a la vez).')
      }
      const { activacion } = await afiliacion.iniciar(cuentaDe(t))
      const { traslado } = await repo.crear({
        id: randomUUID(), operador: t.operador, cedula: t.id, confirmApi: t.confirmAPI,
        documentos: t.documentos.map((d) => ({ idExterno: d.idExterno, titulo: d.titulo.trim(), clase: d.clase, emisor: d.emisor, tipo: d.tipo, tamano: d.tamano, sha256: d.sha256, url: d.url })),
      })
      res.status(202).json({ ...aTraslado(traslado), activacion: `${spaUrl}/#activar/${activacion}` })
    } catch (err) {
      if (err instanceof ErrorAfiliacion && [409, 422].includes(err.status)) return problema(res, err.status, 'Cuenta no disponible', err.message)
      next(err)
    }
  })

  const ciudadano = express.Router()
  ciudadano.use(sesionCiudadano(verificar, 'traslados'))
  ciudadano.get('/actual', async (req, res, next) => {
    try {
      const t = await repo.ultimoDe(req.claims.cedula)
      t ? res.json(aTraslado(t)) : problema(res, 404, 'Sin traslado', 'No tienes un traslado en curso.')
    } catch (err) { next(err) }
  })
  return { peer, ciudadano }
}

const cuentaDe = (t) => ({
  cedula: t.id, nombre: t.nombre, apellido: t.apellido, direccion: t.direccion, cuenta: t.correo, correoContacto: t.correoContacto, telefono: t.telefono,
})

// Procesa los traslados en curso: cada documento por la custodia (idempotente), la afiliación solo con la Carpeta completa y la
// confirmación al origen. Todo el estado está en la base (RD-02); cualquier instancia retoma donde quedó. Un traslado fallido se
// limpia (custodia y cuenta) antes de decirle al origen req_status 0, para que conserve la carpeta sin dejar restos aquí.
// dependencias: repo, custodia (recibirTraslado, descartarTraslado), afiliacion (completar, cancelar), confirmar(url, cuerpo).
export function crearProcesador({ repo, custodia, afiliacion, confirmar, ahora = () => new Date(), aviso = log }) {
  const en = (ms) => new Date(ahora().getTime() + ms)

  async function fallar(t, motivo) {
    aviso('warn', 'traslado fallido', { traslado: t.id, motivo })
    await repo.fallido(t.id, motivo)
    return confirmarOrigen({ ...t, estado: 'fallido' })
  }

  async function confirmarOrigen(t) {
    const ok = t.estado === 'completo'
    try {
      if (!ok) {
        await custodia.descartarTraslado({ cedula: t.cedula, operador: t.operador })
        await afiliacion.cancelar(t.cedula)
      }
      await confirmar(t.confirmApi, { id: t.cedula, req_status: ok ? 1 : 0 })
    } catch (e) {
      // ponytail: sin tope de intentos; con el retroceso a 5 minutos basta hasta que el origen responda.
      aviso('warn', 'confirmación al origen pendiente; se reintenta', { traslado: t.id, detalle: e.message })
      return repo.falloConfirmacion(t.id, en(esperaConfirmacion((t.intentosConfirmacion ?? 0) + 1)))
    }
    await repo.confirmado(t.id)
  }

  async function avanzar(t) {
    let fallo = 0
    for (const d of (await repo.documentos(t.id)).filter((x) => x.estado === 'pendiente')) {
      try {
        await custodia.recibirTraslado({ cedula: t.cedula, operador: t.operador, ...d })
        await repo.documentoRecibido(t.id, d.idExterno)
      } catch (e) {
        const intentos = await repo.documentoFallo(t.id, d.idExterno, e.message)
        aviso('warn', 'documento del traslado no llegó', { traslado: t.id, documento: d.idExterno, intento: intentos, detalle: e.message })
        if (intentos >= MAX_INTENTOS_DOCUMENTO) return fallar(t, `No pudimos recibir «${d.titulo}» del operador de origen después de ${intentos} intentos.`)
        fallo = Math.max(fallo, intentos)
      }
    }
    if (fallo) return repo.programar(t.id, en(esperaDocumento(fallo)))
    try {
      await afiliacion.completar(t.cedula)
    } catch (e) {
      const definitivo = e instanceof ErrorAfiliacion && e.status !== 503
      if (definitivo) return fallar(t, `No pudimos registrar la afiliación: ${e.message}`)
      const intentos = await repo.falloCompletar(t.id, en(esperaDocumento((t.intentosCompletar ?? 0) + 1)))
      return intentos >= MAX_INTENTOS_COMPLETAR ? fallar(t, 'GovCarpeta no respondió al registrar la afiliación.') : undefined
    }
    await repo.completo(t.id)
    return confirmarOrigen({ ...t, estado: 'completo' })
  }

  return {
    procesar: (t) => (t.estado === 'en-curso' ? avanzar(t) : confirmarOrigen(t)),
    async pendientes() { for (let t; (t = await repo.reclamar());) await (t.estado === 'en-curso' ? avanzar(t) : confirmarOrigen(t)) },
  }
}

// Ciclo que procesa los traslados cada `intervaloMs`; devuelve la función que lo detiene.
export function iniciarTraslados({ procesador, intervaloMs = 1500, log: aviso = () => {} }) {
  let parar = false
  let espera
  ;(async () => {
    while (!parar) {
      try { await procesador.pendientes() } catch (e) { aviso('warn', 'el procesador de traslados falló; reintenta', { detalle: e.message }) }
      if (!parar) await new Promise((ok) => { espera = setTimeout(ok, intervaloMs) })
    }
  })()
  return () => { parar = true; clearTimeout(espera) }
}

// POST del confirmAPI del origen: { id, req_status } con 1 si todo llegó y 0 si falló (acuerdo del traslado, B-02).
export async function confirmarAlOrigen(url, cuerpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`el origen respondió ${r.status} al confirmar`)
}

// Repositorio de traslados en la base de MS-07 (RD-11).
const aFila = (f) => f && ({
  id: f.id, operador: f.operador, cedula: f.cedula, confirmApi: f.confirm_api, estado: f.estado, total: f.total, recibidos: f.recibidos, error: f.error,
  intentosCompletar: f.intentos_completar, intentosConfirmacion: f.intentos_confirmacion, siguiente: f.siguiente, creado: f.creado,
  completadoEn: f.completado_en, confirmadoEn: f.confirmado_en,
})

export async function migrarTraslados(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS traslados (
    id uuid PRIMARY KEY,
    operador text NOT NULL,
    cedula text NOT NULL,
    confirm_api text NOT NULL,
    estado text NOT NULL DEFAULT 'en-curso' CHECK (estado IN ('en-curso', 'completo', 'fallido')),
    total int NOT NULL,
    recibidos int NOT NULL DEFAULT 0,
    error text,
    intentos_completar int NOT NULL DEFAULT 0,
    intentos_confirmacion int NOT NULL DEFAULT 0,
    siguiente timestamptz NOT NULL DEFAULT now(),
    creado timestamptz NOT NULL DEFAULT now(),
    completado_en timestamptz,
    confirmado_en timestamptz
  )`)
  // Un solo traslado activo por operador y ciudadano; uno fallido no impide reintentar.
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS traslados_activo ON traslados (operador, cedula) WHERE estado <> 'fallido'")
  await db.query('CREATE INDEX IF NOT EXISTS traslados_cedula ON traslados (cedula, creado DESC)')
  await db.query(`CREATE TABLE IF NOT EXISTS traslado_documentos (
    traslado_id uuid NOT NULL REFERENCES traslados (id) ON DELETE CASCADE,
    id_externo text NOT NULL,
    titulo text NOT NULL,
    clase text NOT NULL,
    emisor text,
    tipo text NOT NULL,
    tamano bigint NOT NULL,
    sha256 text NOT NULL,
    url text NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibido')),
    intentos int NOT NULL DEFAULT 0,
    ultimo_error text,
    PRIMARY KEY (traslado_id, id_externo)
  )`)
}

export function crearRepoTraslados(db) {
  const filas = async (sql, args) => (await db.query(sql, args)).rows.map(aFila)
  return {
    // Un traslado activo (no fallido) por (operador, cedula): un reenvío devuelve el que ya existe.
    async crear(t) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rows: [nuevo] } = await c.query(
          `INSERT INTO traslados (id, operador, cedula, confirm_api, total) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (operador, cedula) WHERE estado <> 'fallido' DO NOTHING RETURNING *`,
          [t.id, t.operador, t.cedula, t.confirmApi, t.documentos.length])
        if (!nuevo) {
          await c.query('ROLLBACK')
          return { traslado: await this.activoDe(t.operador, t.cedula), existente: true }
        }
        for (const d of t.documentos) {
          await c.query(
            `INSERT INTO traslado_documentos (traslado_id, id_externo, titulo, clase, emisor, tipo, tamano, sha256, url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [t.id, d.idExterno, d.titulo, d.clase, d.emisor, d.tipo, d.tamano, d.sha256, d.url])
        }
        await c.query('COMMIT')
        return { traslado: aFila(nuevo), existente: false }
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
    activoDe: async (operador, cedula) => (await filas("SELECT * FROM traslados WHERE operador = $1 AND cedula = $2 AND estado <> 'fallido'", [operador, cedula]))[0] ?? null,
    obtener: async (id) => (await filas('SELECT * FROM traslados WHERE id = $1', [id]))[0] ?? null,
    ultimoDe: async (cedula) => (await filas('SELECT * FROM traslados WHERE cedula = $1 ORDER BY creado DESC LIMIT 1', [cedula]))[0] ?? null,
    documentos: async (id) => (await db.query(
      'SELECT id_externo, titulo, clase, emisor, tipo, tamano, sha256, url, estado, intentos FROM traslado_documentos WHERE traslado_id = $1 ORDER BY id_externo', [id])).rows
      .map((d) => ({ idExterno: d.id_externo, titulo: d.titulo, clase: d.clase, emisor: d.emisor ?? undefined, tipo: d.tipo, tamano: Number(d.tamano), sha256: d.sha256, url: d.url, estado: d.estado, intentos: d.intentos })),
    // Toma un traslado cuyo turno llegó y lo arrienda 5 minutos: en curso, o terminado sin confirmar al origen.
    reclamar: async () => (await filas(
      `UPDATE traslados SET siguiente = now() + interval '5 minutes'
       WHERE id = (SELECT id FROM traslados WHERE siguiente <= now() AND (estado = 'en-curso' OR (estado IN ('completo', 'fallido') AND confirmado_en IS NULL))
                   ORDER BY siguiente LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`))[0] ?? null,
    async documentoRecibido(id, idExterno) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rowCount } = await c.query("UPDATE traslado_documentos SET estado = 'recibido' WHERE traslado_id = $1 AND id_externo = $2 AND estado = 'pendiente'", [id, idExterno])
        if (rowCount) await c.query('UPDATE traslados SET recibidos = recibidos + 1 WHERE id = $1', [id])
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
    documentoFallo: async (id, idExterno, error) => (await db.query(
      'UPDATE traslado_documentos SET intentos = intentos + 1, ultimo_error = $3 WHERE traslado_id = $1 AND id_externo = $2 RETURNING intentos', [id, idExterno, error])).rows[0].intentos,
    programar: (id, siguiente) => db.query('UPDATE traslados SET siguiente = $2 WHERE id = $1', [id, siguiente]),
    falloCompletar: async (id, siguiente) => (await db.query('UPDATE traslados SET intentos_completar = intentos_completar + 1, siguiente = $2 WHERE id = $1 RETURNING intentos_completar', [id, siguiente])).rows[0].intentos_completar,
    completo: (id) => db.query("UPDATE traslados SET estado = 'completo', completado_en = now() WHERE id = $1", [id]),
    fallido: (id, motivo) => db.query("UPDATE traslados SET estado = 'fallido', error = $2 WHERE id = $1", [id, motivo]),
    confirmado: (id) => db.query('UPDATE traslados SET confirmado_en = now() WHERE id = $1', [id]),
    falloConfirmacion: (id, siguiente) => db.query('UPDATE traslados SET intentos_confirmacion = intentos_confirmacion + 1, siguiente = $2 WHERE id = $1', [id, siguiente]),
  }
}
