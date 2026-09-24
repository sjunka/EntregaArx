import { crearBandeja } from '@mcs/eventos'

// Sin tildes, mayúsculas ni espacios de más: «Diploma de Ingeniería» y «diploma  de ingenieria» son el mismo título.
export const normalizarTitulo = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Repositorio de documentos en la base de custodia (RD-11). Un documento es del titular por cédula.
const aDocumento = (f) => f && ({
  id: f.id, titular: f.titular, titulo: f.titulo, clase: f.clase, estado: f.estado, tipo: f.tipo, tamano: Number(f.tamano), origen: f.origen,
  sha256: f.sha256, creado: f.creado, emisor: f.emisor, idExterno: f.id_externo, sustituidoPor: f.sustituido_por, motivo: f.motivo,
  autenticacion: f.autenticado_en ? { fecha: f.autenticado_en, respuesta: f.respuesta_centralizador } : null,
})

// Una carga pendiente reserva cuota solo mientras la URL prefirmada puede seguir viva (5 min, con holgura).
const RESERVA = "estado = 'cargado' OR (estado = 'pendiente' AND creado > now() - interval '10 minutes')"

export async function migrar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS documentos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titular text NOT NULL,
    titulo text NOT NULL,
    creado timestamptz NOT NULL DEFAULT now()
  )`)
  // HU-03
  await db.query("ALTER TABLE documentos ADD COLUMN IF NOT EXISTS clase text NOT NULL DEFAULT 'temporal' CHECK (clase IN ('temporal', 'certificado'))")
  await db.query("ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'pendiente'")
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tipo text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tamano bigint')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS sha256 text')
  // HU-04: Autenticado es una marca del Temporal, no un estado.
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS autenticado_en timestamptz')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS respuesta_centralizador text')
  await db.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_estado')
  // HU-05: Certificados (Recibido, Verificado, Vigente, Rechazado, Retirado) y Temporales Sustituidos o Eliminados.
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS titulo_norm text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS emisor text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS id_externo text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS motivo text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS sustituido_por uuid REFERENCES documentos (id)')
  await db.query(`ALTER TABLE documentos ADD CONSTRAINT documentos_estado CHECK (estado IN
    ('pendiente', 'cargado', 'sustituido', 'eliminado', 'recibido', 'verificado', 'vigente', 'rechazado', 'retirado'))`)
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS documentos_externo ON documentos (emisor, id_externo) WHERE id_externo IS NOT NULL')
  for (const f of (await db.query('SELECT id, titulo FROM documentos WHERE titulo_norm IS NULL')).rows) {
    await db.query('UPDATE documentos SET titulo_norm = $2 WHERE id = $1', [f.id, normalizarTitulo(f.titulo)])
  }
  await db.query('CREATE INDEX IF NOT EXISTS documentos_titular ON documentos (titular)')
  // HU-09: Traslado de entrada. El documento conserva su clase, no consume cuota (origen IS NOT NULL) y es idempotente por (origen, origen_id).
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS origen text')
  await db.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS origen_id text')
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS documentos_origen ON documentos (origen, origen_id) WHERE origen IS NOT NULL')
  // HU-13: Traslado de salida. Una Carpeta congelada es de solo lectura hasta que el destino confirme (o rechace).
  await db.query('CREATE TABLE IF NOT EXISTS carpetas_congeladas (titular text PRIMARY KEY, desde timestamptz NOT NULL DEFAULT now())')
  // HU-06: bandeja de salida con los eventos hacia MS-05 (índice) y MS-02 (auditoría), ADR-0018.
  await crearBandeja(db).migrar()
}

export function crearRepositorio(db) {
  const bandeja = crearBandeja(db)
  const uno = async (sql, args) => aDocumento((await db.query(sql, args)).rows[0])
  // El hecho y su evento se escriben en una transacción: nunca uno sin el otro (ADR-0018). `evento(fila)` devuelve
  // [nombre, datos] o null; la clave de deduplicación hace idempotente el encolado si el hecho se repite.
  const conEvento = async (sql, args, evento) => {
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      const f = aDocumento((await c.query(sql, args)).rows[0])
      const e = f && evento(f)
      if (e) await bandeja.encolar(e[0], f.titular, e[1], { cliente: c, dedupe: e[2] })
      await c.query('COMMIT')
      return f
    } catch (err) {
      await c.query('ROLLBACK')
      throw err
    } finally {
      c.release()
    }
  }
  const ahora = () => new Date().toISOString()
  return {
    uso: async (titular) => {
      const { rows: [u] } = await db.query(
        `SELECT count(*)::int AS documentos, coalesce(sum(tamano), 0)::bigint AS bytes
         FROM documentos WHERE titular = $1 AND clase = 'temporal' AND origen IS NULL AND (${RESERVA})`, [titular])
      return { documentos: u.documentos, bytes: Number(u.bytes) }
    },
    crear: (d) => db.query(
      `INSERT INTO documentos (id, titular, titulo, titulo_norm, tipo, tamano, clase, estado) VALUES ($1, $2, $3, $4, $5, $6, 'temporal', 'pendiente')`,
      [d.id, d.titular, d.titulo, normalizarTitulo(d.titulo), d.tipo, d.tamano]),
    buscar: (id) => uno('SELECT * FROM documentos WHERE id = $1', [id]),
    confirmar: (id, sha256) => conEvento(`UPDATE documentos SET estado = 'cargado', sha256 = $2 WHERE id = $1 RETURNING *`, [id, sha256],
      (d) => ['documento.cargado', { id: d.id, cedula: d.titular, clase: 'temporal', titulo: d.titulo, tipo: d.tipo, tamano: d.tamano, creadoEn: ahora() }, `documento.cargado:${d.id}`]),
    marcarAutenticado: (id, respuesta) => conEvento(
      'UPDATE documentos SET autenticado_en = now(), respuesta_centralizador = $2 WHERE id = $1 RETURNING *', [id, respuesta],
      (d) => ['documento.autenticado', { id: d.id, cedula: d.titular, autenticadoEn: ahora() }, `documento.autenticado:${d.id}`]),
    // Cada entrega de una URL de lectura es un hecho nuevo para la bitácora de MS-02: sin clave de deduplicación.
    registrarAcceso: (d, acceso) => bandeja.encolar('acceso.registrado', d.titular,
      { documentoId: d.id, cedula: d.titular, titulo: d.titulo, ...acceso, ocurridoEn: ahora() }),
    descartar: (id) => db.query('DELETE FROM documentos WHERE id = $1', [id]),
    eliminar: (id) => conEvento(`UPDATE documentos SET estado = 'eliminado' WHERE id = $1 RETURNING *`, [id],
      (d) => ['documento.eliminado', { id: d.id, cedula: d.titular, eliminadoEn: ahora() }, `documento.eliminado:${d.id}`]),
    // La Carpeta muestra Temporales Cargados o Sustituidos y Certificados Vigentes.
    listar: async (titular) => (await db.query(
      `SELECT * FROM documentos WHERE titular = $1
         AND ((clase = 'temporal' AND estado IN ('cargado', 'sustituido')) OR (clase = 'certificado' AND estado = 'vigente'))
       ORDER BY creado DESC`, [titular])).rows.map(aDocumento),
    // Traslado de salida (HU-13). Cerrar borra todo lo del titular en la misma sentencia (sin eventos por documento: MS-07
    // publica un solo `ciudadano.trasladado`) y devuelve lo borrado para que la custodia elimine los archivos.
    congelar: (titular) => db.query('INSERT INTO carpetas_congeladas (titular) VALUES ($1) ON CONFLICT DO NOTHING', [titular]),
    reabrir: (titular) => db.query('DELETE FROM carpetas_congeladas WHERE titular = $1', [titular]),
    congelada: async (titular) => (await db.query('SELECT 1 FROM carpetas_congeladas WHERE titular = $1', [titular])).rowCount > 0,
    async borrarCarpeta(titular) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rows } = await c.query('DELETE FROM documentos WHERE titular = $1 RETURNING *', [titular])
        await c.query('DELETE FROM carpetas_congeladas WHERE titular = $1', [titular])
        await c.query('COMMIT')
        return rows.map(aDocumento)
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      } finally {
        c.release()
      }
    },
    // Traslado de entrada (HU-09): el documento llega Cargado (Temporal) o Vigente (Certificado) y el evento de carga sale en la misma transacción.
    buscarPorOrigen: (origen, idOrigen) => uno('SELECT * FROM documentos WHERE origen = $1 AND origen_id = $2', [origen, idOrigen]),
    crearTrasladado: (d) => conEvento(
      `INSERT INTO documentos (id, titular, titulo, titulo_norm, tipo, tamano, sha256, clase, estado, emisor, origen, origen_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (origen, origen_id) WHERE origen IS NOT NULL DO NOTHING RETURNING *`,
      [d.id, d.titular, d.titulo, normalizarTitulo(d.titulo), d.tipo, d.tamano, d.sha256, d.clase, d.clase === 'certificado' ? 'vigente' : 'cargado', d.emisor ?? null, d.origen, d.idOrigen],
      (f) => ['documento.cargado', { id: f.id, cedula: f.titular, clase: f.clase, titulo: f.titulo, tipo: f.tipo, tamano: f.tamano, ...(f.clase === 'certificado' && f.emisor && { emisor: f.emisor }), creadoEn: ahora() }, `documento.cargado:${f.id}`]),
    // Un Traslado que falló: se descarta lo que llegó de ese origen para ese titular (y sus eventos de eliminación). Devuelve lo descartado.
    async descartarTraslado(titular, origen) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rows } = await c.query('DELETE FROM documentos WHERE titular = $1 AND origen = $2 RETURNING *', [titular, origen])
        for (const f of rows) await bandeja.encolar('documento.eliminado', titular, { id: f.id, cedula: titular, eliminadoEn: ahora() }, { cliente: c, dedupe: `documento.eliminado:${f.id}` })
        await c.query('COMMIT')
        return rows.map(aDocumento)
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      } finally {
        c.release()
      }
    },
    // Idempotente por (emisor, idExterno): un reenvío devuelve el documento que ya existe.
    async crearCertificado(d) {
      const { rows } = await db.query(
        `INSERT INTO documentos (id, titular, titulo, titulo_norm, tipo, tamano, sha256, clase, estado, emisor, id_externo, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'certificado', $8, $9, $10, $11)
         ON CONFLICT (emisor, id_externo) WHERE id_externo IS NOT NULL DO NOTHING RETURNING *`,
        [d.id, d.titular, d.titulo, normalizarTitulo(d.titulo), d.tipo, d.tamano, d.sha256, d.estado, d.emisor, d.idExterno, d.motivo ?? null])
      if (rows[0]) return { documento: aDocumento(rows[0]), existente: false }
      return { documento: await uno('SELECT * FROM documentos WHERE emisor = $1 AND id_externo = $2', [d.emisor, d.idExterno]), existente: true }
    },
    marcarVerificado: (id) => uno(`UPDATE documentos SET estado = 'verificado' WHERE id = $1 AND estado = 'recibido' RETURNING *`, [id]),
    rechazar: (id, motivo) => uno(`UPDATE documentos SET estado = 'rechazado', motivo = $2 WHERE id = $1 RETURNING *`, [id, motivo]),
    // Vigente y, en la misma sentencia, el Temporal equivalente más antiguo del titular pasa a Sustituido.
    async activarCertificado(id) {
      const { rows: [f] } = await db.query(
        `WITH cert AS (SELECT id, titular, titulo_norm FROM documentos WHERE id = $1 AND estado = 'verificado'),
              eq AS (
                SELECT d.id FROM documentos d, cert
                WHERE d.titular = cert.titular AND d.clase = 'temporal' AND d.estado = 'cargado' AND d.titulo_norm = cert.titulo_norm
                ORDER BY d.creado LIMIT 1 FOR UPDATE OF d),
              sust AS (UPDATE documentos SET estado = 'sustituido', sustituido_por = $1 WHERE id IN (SELECT id FROM eq) RETURNING id),
              vig AS (UPDATE documentos SET estado = 'vigente' WHERE id IN (SELECT id FROM cert) RETURNING *)
         SELECT vig.*, (SELECT id FROM sust) AS sustituye_a FROM vig`, [id])
      return f ? { documento: aDocumento(f), sustituyeA: f.sustituye_a ?? undefined } : null
    },
  }
}
