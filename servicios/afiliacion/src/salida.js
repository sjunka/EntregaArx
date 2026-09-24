import express from 'express'

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })
const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

// HU-13 · Traslado de salida en MS-03. MS-07 orquesta el traslado y MS-03 hace lo que le corresponde como dueño de la afiliación:
// dar de baja en GovCarpeta (RF-01.8), reafiliar si el destino rechaza y cerrar la cuenta solo tras la confirmación. A GovCarpeta
// solo viajan datos de afiliación (RI-01). Todas las operaciones son idempotentes: MS-07 las reintenta.
// dependencias: repo (porCedula, estado, borrar), keycloak (buscar, borrar), pasarela (consultar, desafiliar, registrar),
// verificar(token) → claims (audiencia afiliacion), operador (nombre con el que GovCarpeta nos conoce).
export function rutasSalida({ repo, keycloak, pasarela, verificar, operador = 'Mi Carpeta Segura' }) {
  const r = express.Router()
  r.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Autenticación de servicio requerida')
    try { req.claims = await verificar(token) } catch { return problema(res, 401, 'Token de servicio inválido o vencido') }
    req.claims.azp === 'interoperabilidad' ? next() : problema(res, 403, 'Solo para servicios del operador')
  })

  const central = async (cedula, res) => {
    try { return await pasarela.consultar(cedula) } catch {
      problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar la afiliación ahora. Reintenta en unos minutos.')
      return null
    }
  }
  const fallo = (res, e, titulo) => {
    log('warn', titulo, { status: e.status, detalle: e.message })
    return problema(res, e.status === 503 ? 503 : 502, titulo, e.status === 503 ? 'GovCarpeta no respondió a tiempo.' : e.message)
  }

  r.param('cedula', (req, res, next, cedula) => (/^[0-9]{6,10}$/.test(cedula) ? next() : problema(res, 422, 'Cédula inválida')))

  r.get('/:cedula', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      const u = f?.cuenta && await keycloak.buscar(f.cuenta)
      if (!f || !u) return problema(res, 404, 'Ciudadano no encontrado')
      res.json({ cedula: f.cedula, cuenta: f.cuenta, nombre: u.nombre, estado: f.estado })
    } catch (e) { next(e) }
  })

  // Baja en GovCarpeta: el ciudadano queda sin operador hasta que el destino lo afilie (o nosotros lo reafiliemos).
  r.post('/:cedula/baja', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      if (!f || !['afiliado', 'salida'].includes(f.estado)) return problema(res, 404, 'Ciudadano no afiliado')
      const c = await central(f.cedula, res)
      if (!c) return
      if (c.afiliado && c.operador !== operador) return problema(res, 409, 'Afiliado a otro operador', `GovCarpeta lo reporta en ${c.operador ?? 'otro operador'}.`)
      if (c.afiliado) {
        try { await pasarela.desafiliar(f.cedula) } catch (e) { return fallo(res, e, 'GovCarpeta no dio de baja al ciudadano') }
      }
      await repo.estado(f.cedula, 'salida')
      log('info', 'ciudadano dado de baja para un traslado de salida')
      res.json({ estado: 'salida' })
    } catch (e) { next(e) }
  })

  // El destino rechazó: el ciudadano vuelve a quedar con nosotros (nunca sin operador). RI-03: si otro operador ya lo tiene, no se escribe.
  r.post('/:cedula/reafiliacion', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      if (!f || !['afiliado', 'salida'].includes(f.estado)) return problema(res, 404, 'Ciudadano no encontrado')
      const c = await central(f.cedula, res)
      if (!c) return
      if (c.afiliado && c.operador !== operador) return problema(res, 409, 'Afiliado a otro operador', `GovCarpeta lo reporta en ${c.operador ?? 'otro operador'}: no se registra una segunda afiliación.`)
      if (!c.afiliado) {
        const u = await keycloak.buscar(f.cuenta)
        try {
          await pasarela.registrar({ id: f.cedula, nombre: u?.nombre ?? 'Ciudadano', direccion: f.direccion || 'Sin dirección registrada', correo: f.cuenta })
        } catch (e) { return fallo(res, e, 'GovCarpeta no reafilió al ciudadano') }
      }
      await repo.estado(f.cedula, 'afiliado')
      log('info', 'ciudadano reafiliado tras un traslado rechazado')
      res.json({ estado: 'afiliado' })
    } catch (e) { next(e) }
  })

  // El destino confirmó (req_status 1): se borran la cuenta y los datos. Solo con la salida en curso.
  r.post('/:cedula/cierre', async (req, res, next) => {
    try {
      const f = await repo.porCedula(req.params.cedula)
      if (!f) return res.json({ estado: 'cerrada' })
      if (f.estado !== 'salida') return problema(res, 409, 'La cuenta no está en traslado', 'Solo se cierra una cuenta que salió del operador.')
      const u = f.cuenta && await keycloak.buscar(f.cuenta)
      if (u) await keycloak.borrar(u.id)
      await repo.borrar(f.cedula)
      log('info', 'cuenta cerrada tras un traslado de salida')
      res.json({ estado: 'cerrada' })
    } catch (e) { next(e) }
  })
  return r
}

// Repositorio de MS-03 para la salida (RD-11): la tabla de ciudadanos, con la dirección que se guardó al afiliar.
export async function migrarSalida(db) {
  await db.query('ALTER TABLE ciudadanos DROP CONSTRAINT IF EXISTS ciudadanos_estado_check')
  await db.query("ALTER TABLE ciudadanos ADD CONSTRAINT ciudadanos_estado_check CHECK (estado IN ('pendiente', 'afiliado', 'traslado', 'salida'))")
  await db.query('ALTER TABLE ciudadanos ADD COLUMN IF NOT EXISTS direccion text')
}

export function crearRepoSalida(db) {
  return {
    // La dirección de un ciudadano trasladado hacia acá vive en `datos` (HU-09).
    porCedula: async (cedula) => {
      const f = (await db.query("SELECT cedula, cuenta, estado, coalesce(direccion, datos->>'direccion') AS direccion FROM ciudadanos WHERE cedula = $1", [cedula])).rows[0]
      return f ?? null
    },
    estado: (cedula, estado) => db.query('UPDATE ciudadanos SET estado = $2 WHERE cedula = $1', [cedula, estado]),
    borrar: (cedula) => db.query('DELETE FROM ciudadanos WHERE cedula = $1', [cedula]),
  }
}
