// Repositorio de MS-11 en su propia base Postgres (RD-11): catálogo Premium, casos PQRS, sus peticiones y el uso medido.
// No guarda documentos ni títulos de la carpeta: los pedidos son los que escribe la empresa.
const aCaso = (f) => ({ id: f.id, asunto: f.asunto, estado: f.estado, creado: f.creado, peticiones: [] })
const aPeticion = (f) => ({ id: f.id, casoId: f.caso_id, cedula: f.cedula, proposito: f.proposito, pedidos: f.pedidos, estado: f.estado, creado: f.creado })

export async function migrar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS empresas (
    id text PRIMARY KEY, nombre text NOT NULL, premium boolean NOT NULL DEFAULT false)`)
  await db.query(`CREATE TABLE IF NOT EXISTS catalogo (
    id text PRIMARY KEY, nombre text NOT NULL, descripcion text NOT NULL, tarifa_cop integer NOT NULL)`)
  await db.query(`CREATE TABLE IF NOT EXISTS casos (
    id uuid PRIMARY KEY, empresa text NOT NULL REFERENCES empresas (id), asunto text NOT NULL,
    estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')), creado timestamptz NOT NULL DEFAULT now())`)
  await db.query(`CREATE TABLE IF NOT EXISTS peticiones (
    id uuid PRIMARY KEY, caso_id uuid NOT NULL REFERENCES casos (id), cedula text NOT NULL, proposito text NOT NULL, pedidos jsonb NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'atendida', 'rechazada')), creado timestamptz NOT NULL DEFAULT now())`)
  await db.query(`CREATE TABLE IF NOT EXISTS uso (
    id bigserial PRIMARY KEY, empresa text NOT NULL REFERENCES empresas (id), servicio text NOT NULL REFERENCES catalogo (id),
    caso_id uuid REFERENCES casos (id), peticion_id uuid REFERENCES peticiones (id), medido timestamptz NOT NULL DEFAULT now())`)
  await db.query('CREATE INDEX IF NOT EXISTS casos_empresa ON casos (empresa, creado DESC)')
  await db.query('CREATE INDEX IF NOT EXISTS peticiones_caso ON peticiones (caso_id, creado)')
  await db.query('CREATE INDEX IF NOT EXISTS uso_empresa ON uso (empresa, servicio)')
  // Catálogo y empresas de demostración: no hay consola de contratación todavía (RF-07.1 no entra en HU-10).
  await db.query(`INSERT INTO catalogo (id, nombre, descripcion, tarifa_cop) VALUES
    ('caso-pqrs', 'Caso PQRS', 'Abre un caso de soporte y reúne en él las peticiones de documentos.', 5000),
    ('peticion-documentos', 'Petición de documentos', 'Pide documentos a un ciudadano desde un caso; el ciudadano decide qué comparte.', 1500)
    ON CONFLICT (id) DO NOTHING`)
  await db.query(`INSERT INTO empresas (id, nombre, premium) VALUES
    ('tramites-premium', 'Trámites Premium S.A.S.', true),
    ('servicios-basicos', 'Servicios Básicos Ltda.', false)
    ON CONFLICT (id) DO NOTHING`)
}

export function crearRepo(db) {
  const filas = async (sql, args) => (await db.query(sql, args)).rows
  // El caso o la petición y su renglón de uso se escriben juntos: el uso medido nunca difiere de lo hecho.
  async function conTransaccion(fn) {
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      const r = await fn(c)
      await c.query('COMMIT')
      return r
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }
  return {
    empresa: async (id) => (await filas('SELECT id, nombre, premium FROM empresas WHERE id = $1', [id]))[0] ?? null,
    catalogo: async () => (await filas('SELECT id, nombre, descripcion, tarifa_cop FROM catalogo ORDER BY tarifa_cop DESC')).map((f) => ({ id: f.id, nombre: f.nombre, descripcion: f.descripcion, tarifaCop: f.tarifa_cop })),
    abrirCaso: ({ id, empresa, asunto }) => conTransaccion(async (c) => {
      const { rows: [f] } = await c.query('INSERT INTO casos (id, empresa, asunto) VALUES ($1, $2, $3) RETURNING *', [id, empresa, asunto])
      await c.query(`INSERT INTO uso (empresa, servicio, caso_id) VALUES ($1, 'caso-pqrs', $2)`, [empresa, id])
      return aCaso(f)
    }),
    async casosDe(empresa) {
      const casos = (await filas('SELECT * FROM casos WHERE empresa = $1 ORDER BY creado DESC LIMIT 50', [empresa])).map(aCaso)
      const peticiones = (await filas('SELECT * FROM peticiones WHERE caso_id = ANY($1::uuid[]) ORDER BY creado', [casos.map((c) => c.id)])).map(aPeticion)
      for (const c of casos) c.peticiones = peticiones.filter((p) => p.casoId === c.id)
      return casos
    },
    caso: async (id, empresa) => {
      const f = (await filas('SELECT * FROM casos WHERE id = $1 AND empresa = $2', [id, empresa]))[0]
      return f ? aCaso(f) : null
    },
    agregarPeticion: ({ id, casoId, empresa, cedula, proposito, pedidos }) => conTransaccion(async (c) => {
      const { rows: [f] } = await c.query(
        'INSERT INTO peticiones (id, caso_id, cedula, proposito, pedidos) VALUES ($1, $2, $3, $4, $5) RETURNING *', [id, casoId, cedula, proposito, JSON.stringify(pedidos)])
      await c.query(`INSERT INTO uso (empresa, servicio, caso_id, peticion_id) VALUES ($1, 'peticion-documentos', $2, $3)`, [empresa, casoId, id])
      return aPeticion(f)
    }),
    actualizarEstado: async (id, estado) => { await db.query('UPDATE peticiones SET estado = $2 WHERE id = $1', [id, estado]) },
    uso: async (empresa) => (await filas(
      `SELECT c.id AS servicio, c.nombre, c.tarifa_cop, count(u.id)::int AS total FROM catalogo c
       LEFT JOIN uso u ON u.servicio = c.id AND u.empresa = $1 GROUP BY c.id ORDER BY c.tarifa_cop DESC`, [empresa]))
      .map((f) => ({ servicio: f.servicio, nombre: f.nombre, total: f.total, tarifaCop: f.tarifa_cop, subtotalCop: f.total * f.tarifa_cop })),
  }
}
