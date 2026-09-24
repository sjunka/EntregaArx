import { randomUUID } from 'node:crypto'
import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

// Eventos de dominio como CloudEvents 1.0 sobre Kafka, en modo binario (atributos en cabeceras ce_*) y con la data
// serializada contra Schema Registry (JSON Schema). Los esquemas viven en contratos/eventos y un trabajo de compose
// los registra; el test de contrato comprueba que este mapa coincide con ellos.
// Paquete compartido @mcs/eventos (ADR-0018): lo usan los productores y consumidores del bus.
export const EVENTOS = {
  'documento.recibido': { tipo: 'co.carpetasegura.documento.recibido', fuente: '/mcs/interoperabilidad', tema: 'mcs.documento.recibido', sujeto: 'mcs.documento.recibido-value' },
  'documento.cargado': { tipo: 'co.carpetasegura.documento.cargado', fuente: '/mcs/custodia', tema: 'mcs.documento.cargado', sujeto: 'mcs.documento.cargado-value' },
  'documento.autenticado': { tipo: 'co.carpetasegura.documento.autenticado', fuente: '/mcs/custodia', tema: 'mcs.documento.autenticado', sujeto: 'mcs.documento.autenticado-value' },
  'documento.eliminado': { tipo: 'co.carpetasegura.documento.eliminado', fuente: '/mcs/custodia', tema: 'mcs.documento.eliminado', sujeto: 'mcs.documento.eliminado-value' },
  'acceso.registrado': { tipo: 'co.carpetasegura.acceso.registrado', fuente: '/mcs/custodia', tema: 'mcs.acceso.registrado', sujeto: 'mcs.acceso.registrado-value' },
  'envio.entregado': { tipo: 'co.carpetasegura.envio.entregado', fuente: '/mcs/interoperabilidad', tema: 'mcs.envio.entregado', sujeto: 'mcs.envio.entregado-value' },
  'ciudadano.afiliado': { tipo: 'co.carpetasegura.ciudadano.afiliado', fuente: '/mcs/afiliacion', tema: 'mcs.ciudadano.afiliado', sujeto: 'mcs.ciudadano.afiliado-value' },
}

// Cliente de Schema Registry que valida con los formatos de JSON Schema (uuid, email, date-time) y admite el
// atributo x-cloudevent que llevan nuestros esquemas.
export function crearRegistro(host) {
  const ajv = addFormats(new Ajv({ strict: true }))
  ajv.addKeyword('x-cloudevent')
  return new SchemaRegistry({ host }, { [SchemaType.JSON]: { ajvInstance: ajv } })
}

// productor: kafkajs Producer; registro: @kafkajs/confluent-schema-registry (getLatestSchemaId, encode).
export function crearPublicador({ productor, registro, urlRegistro = '' }) {
  const ids = new Map()
  // fila: { evento_id, nombre, clave, datos, creado? }. `clave` da el orden por titular dentro del tema.
  return async function publicar(fila, ahora = new Date()) {
    const def = EVENTOS[fila.nombre]
    if (!def) throw new Error(`Evento desconocido: ${fila.nombre}`)
    if (!ids.has(def.sujeto)) ids.set(def.sujeto, await registro.getLatestSchemaId(def.sujeto))
    const id = ids.get(def.sujeto)
    const value = await registro.encode(id, fila.datos) // valida contra el esquema: un evento inválido no sale
    await productor.send({
      topic: def.tema,
      messages: [{
        key: String(fila.clave),
        value,
        headers: {
          ce_specversion: '1.0', ce_id: fila.evento_id, ce_type: def.tipo, ce_source: def.fuente,
          ce_subject: `${fila.nombre.split('.')[0]}/${fila.clave}`, ce_time: (fila.creado ?? ahora).toISOString(),
          ce_dataschema: `${urlRegistro}/schemas/ids/${id}`, 'content-type': 'application/json',
        },
      }],
    })
  }
}

// Bandeja de salida transaccional: el evento se guarda en la misma base y con la misma transacción que el hecho
// de negocio; un relevo lo publica después. Entrega al menos una vez: los consumidores deduplican por ce_id.
export function crearBandeja(db) {
  return {
    migrar: () => db.query(`CREATE TABLE IF NOT EXISTS bandeja (
      id bigserial PRIMARY KEY,
      evento_id uuid NOT NULL DEFAULT gen_random_uuid(),
      nombre text NOT NULL,
      clave text NOT NULL,
      datos jsonb NOT NULL,
      dedupe text UNIQUE,
      creado timestamptz NOT NULL DEFAULT now(),
      publicado_en timestamptz
    )`),
    // `dedupe` hace idempotente el encolado: el mismo hecho de negocio produce un solo evento aunque se reintente.
    encolar: (nombre, clave, datos, { dedupe = null, cliente = db } = {}) =>
      cliente.query('INSERT INTO bandeja (nombre, clave, datos, dedupe) VALUES ($1, $2, $3, $4) ON CONFLICT (dedupe) DO NOTHING',
        [nombre, clave, JSON.stringify(datos), dedupe]),
    // Publica hasta `lote` eventos pendientes; si uno falla, ninguno se marca y se reintenta entero.
    async drenar(publicar, lote = 50) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rows } = await c.query(
          'SELECT id, evento_id, nombre, clave, datos, creado FROM bandeja WHERE publicado_en IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED', [lote])
        for (const f of rows) await publicar(f)
        if (rows.length) await c.query('UPDATE bandeja SET publicado_en = now() WHERE id = ANY($1)', [rows.map((f) => f.id)])
        await c.query('COMMIT')
        return rows.length
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
  }
}

// Vacía la bandeja cada `intervaloMs`; devuelve la función que detiene el relevo.
export function iniciarRelevo({ bandeja, publicar, intervaloMs = 1000, log = () => {} }) {
  let parar = false
  let espera
  ;(async () => {
    while (!parar) {
      let n = 0
      try { n = await bandeja.drenar(publicar) } catch (e) { log('warn', 'relevo de bandeja falló; reintenta', { detalle: e.message }) }
      if (!n && !parar) await new Promise((ok) => { espera = setTimeout(ok, intervaloMs) })
    }
  })()
  return () => { parar = true; clearTimeout(espera) }
}

export const nuevoEventoId = randomUUID
