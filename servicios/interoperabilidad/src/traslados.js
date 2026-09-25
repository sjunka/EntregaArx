import express from 'express'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { ErrorAfiliacion } from './afiliacion.js'
import { log, problema, sesionCiudadano, texto } from './comun.js'

export const MAX_DOCUMENTOS = 50
export const MAX_INTENTOS_DOCUMENTO = 3 // RF-03.5: un documento se reintenta antes de dar el traslado por fallido
export const MAX_INTENTOS_COMPLETAR = 3
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

// La URL de confirmación y las de los documentos las pone el operador de origen: solo https y nunca la red interna, salvo los hosts
// internos que compose permite. ponytail: copia de la política de la custodia (src/traslado.js); extraer si se necesita una tercera.
export async function urlPermitida(url, hostsInternos, resolver) {
  let u
  try { u = new URL(url) } catch { return false }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (hostsInternos.includes(host)) return ['http:', 'https:'].includes(u.protocol)
  if (u.protocol !== 'https:') return false
  try { return (await resolver(host, { all: true })).every((d) => !privada(d.address)) } catch { return false }
}

// Formato del curso (ADR-0027): { id, citizenName, citizenEmail, urlDocuments: { título: [url] }, confirmAPI }. Devuelve el traslado
// en los términos de aquí o el motivo por el que no sirve. El operador de origen es el host de confirmAPI.
export function leerTraslado(t = {}) {
  const cedula = String(t.id ?? '')
  if (!/^[0-9]{6,10}$/.test(cedula)) return { error: 'La cédula (id) del ciudadano no es válida.' }
  if (!texto(t.citizenName, 120) || !t.citizenName.trim()) return { error: 'Falta el nombre del ciudadano (citizenName).' }
  if (typeof t.citizenEmail !== 'string' || t.citizenEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.citizenEmail)) return { error: 'Falta el correo del ciudadano (citizenEmail).' }
  let operador
  try { operador = new URL(t.confirmAPI).hostname } catch { return { error: 'Falta el confirmAPI del operador de origen.' } }
  const docs = t.urlDocuments
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return { error: 'Faltan los documentos (urlDocuments).' }
  const documentos = []
  for (const [titulo, urls] of Object.entries(docs)) {
    if (!texto(titulo, 120) || !titulo.trim()) return { error: 'Cada documento necesita un título.' }
    if (!Array.isArray(urls) || !urls.length) return { error: `«${titulo}» no trae su URL.` }
    for (const [i, url] of urls.entries()) {
      if (typeof url !== 'string' || url.length > 2000 || !/^https?:\/\//.test(url)) return { error: `La URL de «${titulo}» no es válida.` }
      documentos.push({ idExterno: `${titulo.trim()}#${i}`, titulo: titulo.trim(), clase: 'temporal', url })
    }
  }
  if (!documentos.length || documentos.length > MAX_DOCUMENTOS) return { error: `El traslado debe traer entre 1 y ${MAX_DOCUMENTOS} documentos.` }
  const [nombre, ...resto] = t.citizenName.trim().split(/\s+/)
  const correo = t.citizenEmail.trim().toLowerCase()
  return { cedula, operador, confirmAPI: t.confirmAPI, documentos, cuenta: { cedula, nombre, apellido: resto.join(' ') || undefined, cuenta: correo, correoContacto: correo } }
}

const aTraslado = (t) => ({
  id: t.id, operador: t.operador, estado: t.estado, total: t.total, recibidos: t.recibidos, creado: new Date(t.creado).toISOString(),
  ...(t.completadoEn && { completadoEn: new Date(t.completadoEn).toISOString() }),
})

// HU-09 · Traslado de entrada. `peer`: POST /api/transferCitizen, de un operador par en el formato del curso (ADR-0027). No hay
// firma: la confianza viene de GovCarpeta, que debe mostrar al ciudadano sin operador (RI-03). `ciudadano`: GET /traslados/actual,
// el avance que ve el ciudadano. MS-07 no toca el contenido (RI-06): la custodia descarga.
// dependencias: pasarela (consultar), afiliacion (iniciar), repo, correo (enviar), verificar(token) → claims.
export function rutasTraslados({ pasarela, afiliacion, repo, correo, verificar, spaUrl, operador, hostsInternos = [], resolver = lookup }) {
  const enlace = (activacion) => `${spaUrl}/#activar/${activacion}`
  const peer = express.Router()
  peer.post('/', async (req, res, next) => {
    const t = leerTraslado(req.body)
    if (t.error) return problema(res, 422, 'Traslado inválido', t.error)
    try {
      if (!(await urlPermitida(t.confirmAPI, hostsInternos, resolver))) return problema(res, 422, 'confirmAPI no permitido', 'El confirmAPI debe ser una dirección https pública.')
      for (const d of t.documentos) {
        if (!(await urlPermitida(d.url, hostsInternos, resolver))) return problema(res, 422, 'Dirección de documento no permitida', `La URL de «${d.titulo}» debe ser una dirección https pública.`)
      }

      // Reenvío idempotente: el mismo operador y ciudadano con un traslado activo devuelve ese traslado.
      const previo = await repo.activoDe(t.operador, t.cedula)
      if (previo) {
        const { activacion } = await afiliacion.iniciar(t.cuenta) // idempotente en MS-03: devuelve el mismo enlace
        return res.status(200).json({ ...aTraslado(previo), activacion: enlace(activacion) })
      }

      // RI-03: nunca dos operadores a la vez. El origen ya debió dar de baja al ciudadano en GovCarpeta (secuencia del traslado).
      let afiliacionCentral
      try {
        afiliacionCentral = await pasarela.consultar(t.cedula)
      } catch (err) {
        log('warn', 'centralizador no disponible al recibir un traslado', { detalle: err.message })
        return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar la afiliación del ciudadano ahora. Reintenta en unos minutos.')
      }
      if (afiliacionCentral.afiliado) {
        return problema(res, 409, afiliacionCentral.operador === operador ? 'Ya está afiliado' : 'Sigue afiliado a otro operador',
          afiliacionCentral.operador === operador ? 'El ciudadano ya tiene su carpeta en este operador.' : 'GovCarpeta lo reporta en otro operador: el origen debe darlo de baja antes de trasladar (nunca dos operadores a la vez).')
      }
      const { activacion, venceEn } = await afiliacion.iniciar(t.cuenta)
      const { traslado } = await repo.crear({ id: randomUUID(), operador: t.operador, cedula: t.cedula, confirmApi: t.confirmAPI, documentos: t.documentos })
      // El formato del curso no dice cómo llega el enlace al ciudadano: se le envía a su correo. Si el correo falla, el
      // traslado sigue y el enlace queda en la respuesta al origen. ponytail: sin reintento del correo; agregarlo si se pierden.
      await correo.enviar({
        destino: t.cuenta.cuenta, asunto: 'Activa tu cuenta en Mi Carpeta Segura',
        texto: `Hola, ${t.cuenta.nombre}.\n\nTu operador anterior está trasladando tu carpeta a Mi Carpeta Segura. Para terminar, activa tu cuenta: elige una clave y escribe tu dirección y tu celular en este enlace:\n\n${enlace(activacion)}\n\nEl enlace vence el ${new Date(venceEn).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (hora de Colombia). Si no esperabas este mensaje, puedes ignorarlo.`,
      }).catch((e) => log('warn', 'no se pudo enviar el enlace de activación', { detalle: e.message }))
      res.status(202).json({ ...aTraslado(traslado), activacion: enlace(activacion) })
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
      // 425: el ciudadano aún no activa su cuenta (ADR-0027). Se espera sin gastar intentos; MS-03 responde 410 si vence.
      if (e instanceof ErrorAfiliacion && e.status === 425) return repo.programar(t.id, en(60_000))
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
  // El formato del curso no declara tipo, tamaño ni huella (ADR-0027): los calcula la custodia al descargar.
  for (const c of ['tipo', 'tamano', 'sha256']) await db.query(`ALTER TABLE traslado_documentos ALTER COLUMN ${c} DROP NOT NULL`)
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
      .map((d) => ({ idExterno: d.id_externo, titulo: d.titulo, clase: d.clase, emisor: d.emisor ?? undefined, url: d.url, estado: d.estado, intentos: d.intentos })),
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
