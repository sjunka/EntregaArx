// Repositorio de MS-06 en su propia base Postgres (RD-11): peticiones de terceros y autorizaciones del titular.
const aPeticion = (f) => f && ({ id: f.id, entidad: f.entidad, idExterno: f.id_externo, cedula: f.cedula, proposito: f.proposito, pedidos: f.pedidos, estado: f.estado, creado: f.creado })
const aAutorizacion = (f) => f && ({
  id: f.id, peticionId: f.peticion_id, cedula: f.cedula, tercero: f.tercero, documentoId: f.documento_id,
  concedidaEn: f.concedida_en, venceEn: f.vence_en, revocadaEn: f.revocada_en,
})

// Vigente: sin revocar y sin vencer. Una sola definición para la decisión, el listado y la consulta de la entidad.
const VIGENTE = 'revocada_en IS NULL AND vence_en > now()'

export async function migrar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS peticiones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entidad text NOT NULL,
    id_externo text NOT NULL,
    cedula text NOT NULL,
    proposito text NOT NULL,
    pedidos jsonb NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'atendida', 'rechazada')),
    creado timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entidad, id_externo)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS autorizaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    peticion_id uuid REFERENCES peticiones (id),
    cedula text NOT NULL,
    tercero text NOT NULL,
    documento_id uuid NOT NULL,
    concedida_en timestamptz NOT NULL DEFAULT now(),
    vence_en timestamptz NOT NULL,
    revocada_en timestamptz
  )`)
  await db.query('CREATE INDEX IF NOT EXISTS peticiones_cedula ON peticiones (cedula, creado DESC)')
  await db.query('CREATE INDEX IF NOT EXISTS autorizaciones_cedula ON autorizaciones (cedula)')
  await db.query('CREATE INDEX IF NOT EXISTS autorizaciones_decision ON autorizaciones (documento_id, tercero)')
  await db.query('CREATE INDEX IF NOT EXISTS autorizaciones_peticion ON autorizaciones (peticion_id)')
}

export function crearRepo(db) {
  const filas = async (sql, args) => (await db.query(sql, args)).rows
  const insertar = (c, { cedula, tercero, documentos, venceEn, peticionId }) => c.query(
    `INSERT INTO autorizaciones (peticion_id, cedula, tercero, documento_id, vence_en)
     SELECT $1, $2, $3, d, $5 FROM unnest($4::uuid[]) AS d RETURNING *`, [peticionId, cedula, tercero, documentos, venceEn])
  return {
    // Idempotente por (entidad, idExterno): un reenvío devuelve la petición que ya existe.
    async crearPeticion(p) {
      const { rows: [f] } = await db.query(
        `INSERT INTO peticiones (id, entidad, id_externo, cedula, proposito, pedidos) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (entidad, id_externo) DO NOTHING RETURNING *`, [p.id, p.entidad, p.idExterno, p.cedula, p.proposito, JSON.stringify(p.pedidos)])
      if (f) return { peticion: aPeticion(f), existente: false }
      return { peticion: aPeticion((await filas('SELECT * FROM peticiones WHERE entidad = $1 AND id_externo = $2', [p.entidad, p.idExterno]))[0]), existente: true }
    },
    peticion: async (id) => aPeticion((await filas('SELECT * FROM peticiones WHERE id = $1', [id]))[0]),
    peticionesDe: async (cedula) => (await filas('SELECT * FROM peticiones WHERE cedula = $1 ORDER BY creado DESC LIMIT 50', [cedula])).map(aPeticion),
    // Pasa la petición de pendiente a atendida y concede las autorizaciones en una transacción; null si ya no estaba pendiente.
    async atender(id, cedula, documentos, venceEn) {
      const c = await db.connect()
      try {
        await c.query('BEGIN')
        const { rows: [p] } = await c.query(`UPDATE peticiones SET estado = 'atendida' WHERE id = $1 AND cedula = $2 AND estado = 'pendiente' RETURNING entidad`, [id, cedula])
        if (!p) { await c.query('ROLLBACK'); return null }
        const { rows } = await insertar(c, { cedula, tercero: `entidad:${p.entidad}`, documentos, venceEn, peticionId: id })
        await c.query('COMMIT')
        return rows.map(aAutorizacion)
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
    rechazar: async (id, cedula) => aPeticion((await filas(`UPDATE peticiones SET estado = 'rechazada' WHERE id = $1 AND cedula = $2 AND estado = 'pendiente' RETURNING *`, [id, cedula]))[0]),
    // Autorizaciones sin petición de por medio: el envío a una entidad no afiliada (HU-08).
    conceder: async (a) => (await insertar(db, { peticionId: null, ...a })).rows.map(aAutorizacion),
    deLaPeticion: async (peticionId) => (await filas('SELECT * FROM autorizaciones WHERE peticion_id = $1 ORDER BY concedida_en', [peticionId])).map(aAutorizacion),
    vigentesDeLaPeticion: async (peticionId) => (await filas(`SELECT * FROM autorizaciones WHERE peticion_id = $1 AND ${VIGENTE}`, [peticionId])).map(aAutorizacion),
    vigentesDe: async (cedula) => (await filas(`SELECT * FROM autorizaciones WHERE cedula = $1 AND ${VIGENTE} ORDER BY concedida_en DESC`, [cedula])).map(aAutorizacion),
    // Idempotente: revocar dos veces deja la primera fecha. null si la autorización no es del titular.
    revocar: async (id, cedula) => aAutorizacion((await filas(
      'UPDATE autorizaciones SET revocada_en = coalesce(revocada_en, now()) WHERE id = $1 AND cedula = $2 RETURNING *', [id, cedula]))[0]),
    decidir: async ({ cedula, documentoId, tercero }) => aAutorizacion((await filas(
      `SELECT * FROM autorizaciones WHERE cedula = $1 AND documento_id = $2 AND tercero = $3 AND ${VIGENTE} ORDER BY vence_en DESC LIMIT 1`,
      [cedula, documentoId, tercero]))[0]),
  }
}
