import express from 'express'
import { lookup } from 'node:dns/promises'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { ErrorAfiliacion } from './afiliacion.js'
import { ErrorCustodia } from './custodia.js'
import { log, problema, sesionCiudadano, UUID } from './comun.js'
import { esperaDocumento, urlPermitida } from './traslados.js'

export const MAX_INTENTOS_BAJA = 3
export const MAX_INTENTOS_ENVIO = 3 // RF-03.5: transferCitizen se reintenta antes de revertir
export const MAX_INTENTOS_REVERTIR = 5 // después, el caso queda en atención (escala)
const esperaCierre = (n) => Math.min(2 ** n * 10, 300) * 1000

// El enlace de confirmación es `{id del traslado}.{HMAC}`: solo el destino que lo recibió puede confirmar ese traslado.
export const tokenConfirmacion = (secreto, id) => `${id}.${createHmac('sha256', secreto).update(`salida:${id}`).digest('base64url').slice(0, 32)}`
const idDeToken = (secreto, token) => {
  const [id] = typeof token === 'string' ? token.split('.') : []
  if (!UUID.test(id ?? '')) return null
  const esperado = Buffer.from(tokenConfirmacion(secreto, id))
  const recibido = Buffer.from(token)
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado) ? id : null
}

// Lo que ve el ciudadano: los pasos internos son «en curso».
const EXTERNO = { iniciado: 'en-curso', baja: 'en-curso', enviado: 'en-curso', cierre: 'en-curso', revertir: 'en-curso', completo: 'completo', fallido: 'fallido', atencion: 'atencion' }
const aTraslado = (t) => ({
  id: t.id, estado: EXTERNO[t.estado], operador: t.operadorNombre, creado: new Date(t.creado).toISOString(),
  ...(['fallido', 'atencion'].includes(t.estado) && t.error && { motivo: t.error }),
})

// HU-13 · Traslado de salida. El ciudadano elige el operador destino (getOperators) y confirma; MS-07 lo orquesta con el estado en la base
// (RD-02). `ciudadano`: operadores, iniciar y avance. `peer`: POST /api/transferCitizenConfirm/{token}, la confirmación del destino.
// dependencias: repo, pasarela (consultar, operadores), verificar(token) → claims, operador (nuestro nombre en GovCarpeta), secreto.
export function rutasSalida({ repo, pasarela, verificar, operador, secreto, hostsInternos = [], resolver = lookup }) {
  const ciudadano = express.Router()
  ciudadano.use(sesionCiudadano(verificar, 'el traslado de salida'))

  const destinos = async () => (await pasarela.operadores()).filter((o) => o.nombre !== operador)
  const sinCentralizador = (res) => problema(res, 503, 'Centralizador no disponible', 'No podemos consultar a GovCarpeta ahora. Reintenta en unos minutos.')

  ciudadano.get('/operadores', async (_req, res) => {
    try {
      res.json(await Promise.all((await destinos()).map(async (o) => ({
        id: o.id, nombre: o.nombre, disponible: !!o.transferAPIURL && await urlPermitida(o.transferAPIURL, hostsInternos, resolver),
      }))))
    } catch { sinCentralizador(res) }
  })

  ciudadano.post('/', async (req, res, next) => {
    const { operadorId } = req.body ?? {}
    if (typeof operadorId !== 'string' || !operadorId) return problema(res, 422, 'Falta el operador', 'Elige el operador al que te quieres trasladar.')
    try {
      let destino
      try { destino = (await destinos()).find((o) => o.id === operadorId) } catch { return sinCentralizador(res) }
      if (!destino) return problema(res, 422, 'Operador no encontrado', 'Ese operador no figura en GovCarpeta.')
      if (!destino.transferAPIURL) return problema(res, 422, 'Operador sin dirección de traslado', 'Ese operador no publica dónde recibir traslados en GovCarpeta. Elige otro o pídele que la publique.')
      if (!(await urlPermitida(destino.transferAPIURL, hostsInternos, resolver))) return problema(res, 422, 'Dirección de traslado no permitida', 'La dirección de traslado de ese operador no es una dirección https pública.')

      let afiliacion
      try { afiliacion = await pasarela.consultar(req.claims.cedula) } catch { return sinCentralizador(res) }
      if (!afiliacion.afiliado || afiliacion.operador !== operador) return problema(res, 409, 'No estás afiliado aquí', 'GovCarpeta no te reporta en este operador: no hay carpeta que trasladar.')

      const { traslado, existente } = await repo.crear({ id: randomUUID(), cedula: req.claims.cedula, operadorId: destino.id, operadorNombre: destino.nombre, transferUrl: destino.transferAPIURL })
      if (existente) return problema(res, 409, 'Ya hay un traslado en curso', `Tu carpeta ya se está trasladando a ${traslado.operadorNombre}.`)
      res.status(202).json(aTraslado(traslado))
    } catch (err) { next(err) }
  })

  ciudadano.get('/actual', async (req, res, next) => {
    try {
      const t = await repo.ultimoDe(req.claims.cedula)
      t ? res.json(aTraslado(t)) : problema(res, 404, 'Sin traslado', 'No tienes un traslado de salida.')
    } catch (err) { next(err) }
  })

  // transferCitizenConfirm: el destino avisa con req_status 1 (todo llegó y ya lo afilió) o 0 (no pudo). Con 1 no basta su palabra:
  // GovCarpeta debe mostrar al ciudadano en otro operador, y solo entonces se agenda el cierre. Idempotente.
  const peer = express.Router()
  // Sin token: el destino confirma en el endPointConfirm que publicamos en GovCarpeta (ADR-0027); se busca por cédula.
  peer.post('/', async (req, res, next) => {
    try {
      const t = /^[0-9]{6,10}$/.test(String(req.body?.id ?? '')) && await repo.ultimoDe(String(req.body.id))
      if (!t) return problema(res, 404, 'Traslado no encontrado', 'No hay un traslado de salida para esa cédula.')
      await confirmarTraslado(t, req, res)
    } catch (err) { next(err) }
  })
  peer.post('/:token', async (req, res, next) => {
    try {
      const id = idDeToken(secreto, req.params.token)
      const t = id && await repo.obtener(id)
      if (!t) return problema(res, 404, 'Traslado no encontrado', 'Este enlace de confirmación no corresponde a ningún traslado.')
      await confirmarTraslado(t, req, res)
    } catch (err) { next(err) }
  })

  async function confirmarTraslado(t, req, res) {
      const { id: cedula, req_status: resultado } = req.body ?? {}
      if (!/^[0-9]{6,10}$/.test(String(cedula ?? '')) || ![0, 1].includes(resultado)) return problema(res, 422, 'Confirmación inválida', 'Se exige id y req_status 0 o 1.')
      if (String(cedula) !== t.cedula) return problema(res, 422, 'Confirmación inválida', 'La cédula no corresponde a este traslado.')

      if (resultado === 1) {
        if (['cierre', 'completo'].includes(t.estado)) return res.json({ recibido: true })
        if (t.estado !== 'enviado') return problema(res, 409, 'El traslado no espera confirmación')
        let central
        try { central = await pasarela.consultar(t.cedula) } catch { return problema(res, 503, 'Centralizador no disponible', 'No podemos verificar la afiliación ahora. Reintenta la confirmación en unos minutos.') }
        if (!central.afiliado || central.operador === operador) return problema(res, 409, 'Confirmación no verificable', 'GovCarpeta aún no muestra al ciudadano en otro operador.')
        await repo.confirmar(t.id)
        return res.json({ recibido: true })
      }
      if (['revertir', 'fallido'].includes(t.estado)) return res.json({ recibido: true })
      if (t.estado !== 'enviado') return problema(res, 409, 'El traslado no espera confirmación')
      await repo.revertir(t.id, `${t.operadorNombre} rechazó la recepción de tu carpeta. Tu carpeta sigue aquí, con todos tus documentos.`)
      res.json({ recibido: true })
  }
  return { ciudadano, peer }
}

// Procesa los traslados de salida en curso, un paso por vez y todos idempotentes (cualquier instancia retoma donde quedó, RD-02).
// iniciado: congela la Carpeta y da de baja en GovCarpeta; baja: envía transferCitizen con URL prefirmadas frescas; enviado: espera;
// cierre: solo tras req_status 1, borra los documentos y luego la cuenta; revertir: reafilia y reabre la Carpeta.
// dependencias: repo, custodia (congelar, reabrir, cerrar), afiliacion (consultarSalida, baja, reafiliar, cierre), enviar(url, cuerpo) → { ok, status }.
export function crearProcesadorSalida({ repo, custodia, afiliacion, enviar, urlPublica, secreto, ahora = () => new Date(), aviso = log }) {
  const en = (ms) => new Date(ahora().getTime() + ms)
  const definitivo = (e) => !((e instanceof ErrorAfiliacion || e instanceof ErrorCustodia) && [502, 503].includes(e.status)) && !(e instanceof TypeError) && e.name !== 'TimeoutError'

  async function fallo(t, e, alAgotar, maximo, espera = esperaDocumento) {
    aviso('warn', 'paso del traslado de salida no completado', { traslado: t.id, estado: t.estado, detalle: e.message })
    const n = await repo.fallo(t.id, en(espera((t.intentos ?? 0) + 1)))
    if (n >= maximo) return alAgotar()
  }

  async function iniciado(t) {
    try {
      await custodia.congelar(t.cedula)
      await afiliacion.baja(t.cedula)
    } catch (e) {
      const motivo = 'No pudimos dar de baja tu afiliación en GovCarpeta. Tu carpeta sigue aquí.'
      if (definitivo(e)) return repo.revertir(t.id, motivo)
      return fallo(t, e, () => repo.revertir(t.id, motivo), MAX_INTENTOS_BAJA)
    }
    await repo.paso(t.id, 'baja')
  }

  async function baja(t) {
    const motivo = `${t.operadorNombre} no aceptó recibir tu carpeta. Tu carpeta sigue aquí, con todos tus documentos.`
    try {
      // URL prefirmadas nuevas en cada intento: no se guardan (son la llave de lectura de los documentos).
      const { documentos } = await custodia.congelar(t.cedula)
      const persona = await afiliacion.consultarSalida(t.cedula)
      const urlDocuments = {}
      for (const d of documentos) (urlDocuments[d.titulo] ??= []).push(d.url)
      const r = await enviar(t.transferUrl, {
        id: Number(t.cedula), citizenName: persona.nombre, citizenEmail: persona.cuenta, urlDocuments,
        confirmAPI: `${urlPublica}/api/transferCitizenConfirm/${tokenConfirmacion(secreto, t.id)}`,
      })
      if (!r.ok) throw new Error(`transferCitizen respondió ${r.status}`)
    } catch (e) {
      return fallo(t, e, () => repo.revertir(t.id, motivo), MAX_INTENTOS_ENVIO)
    }
    await repo.paso(t.id, 'enviado')
  }

  async function cierre(t) {
    try {
      await custodia.cerrar(t.cedula)
      await afiliacion.cierre(t.cedula)
    } catch (e) {
      // Los datos deben borrarse tarde o temprano: sin tope, con el retroceso a 5 minutos.
      aviso('warn', 'cierre del traslado de salida pendiente; se reintenta', { traslado: t.id, detalle: e.message })
      return repo.fallo(t.id, en(esperaCierre((t.intentos ?? 0) + 1)))
    }
    await repo.completo(t.id, { cedula: t.cedula, trasladadoEn: ahora().toISOString() })
  }

  async function revertir(t) {
    try {
      await afiliacion.reafiliar(t.cedula) // nunca sin operador (RI-03)
      await custodia.reabrir(t.cedula)
    } catch (e) {
      return fallo(t, e, () => repo.atencion(t.id, 'No pudimos devolverte a este operador en GovCarpeta. Escalamos tu caso: seguirás con la carpeta en solo lectura hasta resolverlo.'), MAX_INTENTOS_REVERTIR, esperaCierre)
    }
    await repo.fallido(t.id)
  }

  const paso = { iniciado, baja, cierre, revertir }
  return {
    procesar: (t) => paso[t.estado]?.(t),
    async pendientes() { for (let t; (t = await repo.reclamar());) await paso[t.estado](t) },
  }
}

// Ciclo que procesa los traslados de salida cada `intervaloMs`; devuelve la función que lo detiene.
export function iniciarSalidas({ procesador, intervaloMs = 1500, log: aviso = () => {} }) {
  let parar = false
  let espera
  ;(async () => {
    while (!parar) {
      try { await procesador.pendientes() } catch (e) { aviso('warn', 'el procesador de traslados de salida falló; reintenta', { detalle: e.message }) }
      if (!parar) await new Promise((ok) => { espera = setTimeout(ok, intervaloMs) })
    }
  })()
  return () => { parar = true; clearTimeout(espera) }
}

// POST de transferCitizen al operador destino: solo id, nombre, correo institucional, URL de los documentos y confirmAPI (RI-01, RD-15).
export async function enviarAlDestino(url, cuerpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), redirect: 'error', signal: AbortSignal.timeout(30_000) })
  return { ok: r.ok, status: r.status }
}

// Repositorio de traslados de salida en la base de MS-07 (RD-11). Un solo traslado activo por ciudadano.
const ACTIVOS = "('iniciado', 'baja', 'enviado', 'cierre', 'revertir')"
const aFila = (f) => f && ({
  id: f.id, cedula: f.cedula, operadorId: f.operador_id, operadorNombre: f.operador_nombre, transferUrl: f.transfer_url, estado: f.estado,
  error: f.error, intentos: f.intentos, siguiente: f.siguiente, creado: f.creado,
})

export async function migrarSalida(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS traslados_salida (
    id uuid PRIMARY KEY,
    cedula text NOT NULL,
    operador_id text NOT NULL,
    operador_nombre text NOT NULL,
    transfer_url text NOT NULL,
    estado text NOT NULL DEFAULT 'iniciado' CHECK (estado IN ('iniciado', 'baja', 'enviado', 'cierre', 'revertir', 'completo', 'fallido', 'atencion')),
    error text,
    intentos int NOT NULL DEFAULT 0,
    siguiente timestamptz NOT NULL DEFAULT now(),
    creado timestamptz NOT NULL DEFAULT now()
  )`)
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS traslados_salida_activo ON traslados_salida (cedula) WHERE estado IN ${ACTIVOS}`)
  await db.query('CREATE INDEX IF NOT EXISTS traslados_salida_cedula ON traslados_salida (cedula, creado DESC)')
}

export function crearRepoSalida(db, bandeja) {
  const filas = async (sql, args) => (await db.query(sql, args)).rows.map(aFila)
  return {
    async crear(t) {
      const [nuevo] = await filas(
        `INSERT INTO traslados_salida (id, cedula, operador_id, operador_nombre, transfer_url) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cedula) WHERE estado IN ${ACTIVOS} DO NOTHING RETURNING *`,
        [t.id, t.cedula, t.operadorId, t.operadorNombre, t.transferUrl])
      if (nuevo) return { traslado: nuevo, existente: false }
      return { traslado: (await filas(`SELECT * FROM traslados_salida WHERE cedula = $1 AND estado IN ${ACTIVOS}`, [t.cedula]))[0], existente: true }
    },
    obtener: async (id) => (await filas('SELECT * FROM traslados_salida WHERE id = $1', [id]))[0] ?? null,
    ultimoDe: async (cedula) => (await filas('SELECT * FROM traslados_salida WHERE cedula = $1 ORDER BY creado DESC LIMIT 1', [cedula]))[0] ?? null,
    // Toma un traslado cuyo turno llegó y lo arrienda 5 minutos. `enviado` no se toma: espera la confirmación del destino.
    reclamar: async () => (await filas(
      `UPDATE traslados_salida SET siguiente = now() + interval '5 minutes'
       WHERE id = (SELECT id FROM traslados_salida WHERE estado IN ('iniciado', 'baja', 'cierre', 'revertir') AND siguiente <= now()
                   ORDER BY siguiente LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`))[0] ?? null,
    paso: (id, estado) => db.query('UPDATE traslados_salida SET estado = $2, intentos = 0, siguiente = now() WHERE id = $1', [id, estado]),
    fallo: async (id, siguiente) => (await db.query('UPDATE traslados_salida SET intentos = intentos + 1, siguiente = $2 WHERE id = $1 RETURNING intentos', [id, siguiente])).rows[0].intentos,
    revertir: (id, motivo) => db.query("UPDATE traslados_salida SET estado = 'revertir', error = $2, intentos = 0, siguiente = now() WHERE id = $1", [id, motivo]),
    // Solo desde `enviado`: dos confirmaciones a la vez agendan el cierre una vez.
    confirmar: async (id) => (await db.query("UPDATE traslados_salida SET estado = 'cierre', intentos = 0, siguiente = now() WHERE id = $1 AND estado = 'enviado'", [id])).rowCount > 0,
    fallido: (id) => db.query("UPDATE traslados_salida SET estado = 'fallido' WHERE id = $1", [id]),
    atencion: (id, motivo) => db.query("UPDATE traslados_salida SET estado = 'atencion', error = $2 WHERE id = $1", [id, motivo]),
    // El traslado queda completo y `ciudadano.trasladado` sale en la misma transacción (bandeja de salida, ADR-0018).
    async completo(id, evento) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        await c.query("UPDATE traslados_salida SET estado = 'completo' WHERE id = $1", [id])
        await bandeja.encolar('ciudadano.trasladado', evento.cedula, evento, { cliente: c, dedupe: `ciudadano.trasladado:${id}` })
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
  }
}
