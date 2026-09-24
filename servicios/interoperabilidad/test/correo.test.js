import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { crearCorreo } from '../src/correo.js'

// Un SMTP que acepta la conexión y nunca saluda no debe colgar la solicitud: falla al vencer el plazo.
test('un servidor de correo mudo hace fallar el envío al vencer el plazo, sin colgarlo', async () => {
  const srv = createServer(() => {}).listen(0, '127.0.0.1')
  await new Promise((ok) => srv.once('listening', ok))
  try {
    const correo = crearCorreo({ url: `smtp://127.0.0.1:${srv.address().port}`, remitente: 'a@b.co', plazoMs: 300 })
    const t0 = Date.now()
    await assert.rejects(correo.enviar({ destino: 'c@d.co', asunto: 'x', texto: 'y' }), /./)
    assert.ok(Date.now() - t0 < 3000)
  } finally { srv.close(); srv.closeAllConnections?.() }
})

// nodemailer ignora los plazos si se pasan como segundo argumento de createTransport: deben cerrar la conexión sin saludo.
test('sin saludo del servidor, nodemailer cierra la conexión por su propio plazo (5 s) antes que el plazo duro', async () => {
  const srv = createServer(() => {}).listen(0, '127.0.0.1')
  await new Promise((ok) => srv.once('listening', ok))
  try {
    const correo = crearCorreo({ url: `smtp://127.0.0.1:${srv.address().port}`, remitente: 'a@b.co', plazoMs: 30_000 })
    const t0 = Date.now()
    await assert.rejects(correo.enviar({ destino: 'c@d.co', asunto: 'x', texto: 'y' }), (e) => !/a tiempo/.test(e.message))
    assert.ok(Date.now() - t0 < 8000, `tardó ${Date.now() - t0} ms`)
  } finally { srv.close(); srv.closeAllConnections?.() }
})
