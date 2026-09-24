// Repositorio de documentos en la base de custodia (RD-11). Un documento es del titular por cédula.
const aDocumento = (f) => f && ({
  id: f.id, titular: f.titular, titulo: f.titulo, clase: f.clase, estado: f.estado, tipo: f.tipo, tamano: Number(f.tamano),
  sha256: f.sha256, creado: f.creado,
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
  await db.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_estado')
  await db.query("ALTER TABLE documentos ADD CONSTRAINT documentos_estado CHECK (estado IN ('pendiente', 'cargado'))")
  await db.query('CREATE INDEX IF NOT EXISTS documentos_titular ON documentos (titular)')
}

export function crearRepositorio(db) {
  const uno = async (sql, args) => aDocumento((await db.query(sql, args)).rows[0])
  return {
    uso: async (titular) => {
      const { rows: [u] } = await db.query(
        `SELECT count(*)::int AS documentos, coalesce(sum(tamano), 0)::bigint AS bytes
         FROM documentos WHERE titular = $1 AND clase = 'temporal' AND (${RESERVA})`, [titular])
      return { documentos: u.documentos, bytes: Number(u.bytes) }
    },
    crear: (d) => db.query(
      `INSERT INTO documentos (id, titular, titulo, tipo, tamano, clase, estado) VALUES ($1, $2, $3, $4, $5, 'temporal', 'pendiente')`,
      [d.id, d.titular, d.titulo, d.tipo, d.tamano]),
    buscar: (id) => uno('SELECT * FROM documentos WHERE id = $1', [id]),
    confirmar: (id, sha256) => uno(`UPDATE documentos SET estado = 'cargado', sha256 = $2 WHERE id = $1 RETURNING *`, [id, sha256]),
    descartar: (id) => db.query('DELETE FROM documentos WHERE id = $1', [id]),
    listar: async (titular) => (await db.query(
      `SELECT * FROM documentos WHERE titular = $1 AND estado = 'cargado' ORDER BY creado DESC`, [titular])).rows.map(aDocumento),
  }
}
