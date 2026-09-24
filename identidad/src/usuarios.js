// Repositorio de usuarios del emisor simulado en su propia base (RD-11). Keycloak real usa la suya.
const aUsuario = (f) => f && ({
  id: f.id, cuenta: f.cuenta, clave: f.clave, habilitado: f.habilitado, nombres: f.nombres, apellidos: f.apellidos,
  cedula: f.cedula, correoContacto: f.correo_contacto, telefono: f.telefono,
})

export async function migrar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cuenta text NOT NULL UNIQUE,
    clave text NOT NULL,
    habilitado boolean NOT NULL DEFAULT false,
    nombres text NOT NULL,
    apellidos text NOT NULL,
    cedula text,
    correo_contacto text,
    creado timestamptz NOT NULL DEFAULT now()
  )`)
  await db.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono text')
}

export function crearUsuarios(db) {
  const esUuid = (id) => /^[0-9a-f-]{36}$/i.test(id)
  return {
    porCuenta: async (cuenta) => aUsuario((await db.query('SELECT * FROM usuarios WHERE cuenta = $1', [cuenta])).rows[0]),
    // null si la cuenta ya existe.
    crear: async (u) => (await db.query(
      `INSERT INTO usuarios (cuenta, clave, habilitado, nombres, apellidos, cedula, correo_contacto, telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (cuenta) DO NOTHING RETURNING id`,
      [u.cuenta, u.clave, u.habilitado, u.nombres, u.apellidos, u.cedula, u.correoContacto, u.telefono])).rows[0]?.id ?? null,
    habilitar: async (id, habilitado) => esUuid(id) && (await db.query('UPDATE usuarios SET habilitado = $2 WHERE id = $1', [id, habilitado])).rowCount > 0,
    borrar: async (id) => esUuid(id) && (await db.query('DELETE FROM usuarios WHERE id = $1', [id])).rowCount > 0,
  }
}
