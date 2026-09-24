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
  await db.query(`CREATE TABLE IF NOT EXISTS intentos (
    cuenta text PRIMARY KEY,
    n int NOT NULL DEFAULT 0,
    bloqueado_hasta timestamptz
  )`)
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
    cambiarClave: async (id, clave) => esUuid(id) && (await db.query('UPDATE usuarios SET clave = $2 WHERE id = $1', [id, clave])).rowCount > 0,
    // Devuelve la fecha de fin del bloqueo, o null. Un bloqueo vencido reinicia la cuenta.
    bloqueo: async (cuenta) => {
      await db.query('DELETE FROM intentos WHERE cuenta = $1 AND bloqueado_hasta <= now()', [cuenta])
      return (await db.query('SELECT bloqueado_hasta FROM intentos WHERE cuenta = $1', [cuenta])).rows[0]?.bloqueado_hasta ?? null
    },
    fallo: async (cuenta, max, bloqueoMs) => (await db.query(
      `INSERT INTO intentos (cuenta, n) VALUES ($1, 1)
       ON CONFLICT (cuenta) DO UPDATE SET n = intentos.n + 1,
         bloqueado_hasta = CASE WHEN intentos.n + 1 >= $2 THEN now() + $3 * interval '1 millisecond' END
       RETURNING bloqueado_hasta`, [cuenta, max, bloqueoMs])).rows[0].bloqueado_hasta,
    exito: async (cuenta) => { await db.query('DELETE FROM intentos WHERE cuenta = $1', [cuenta]) },
    borrar: async (id) => esUuid(id) && (await db.query('DELETE FROM usuarios WHERE id = $1', [id])).rowCount > 0,
  }
}
