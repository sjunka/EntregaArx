import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, AUDITORIA, AUTORIZACIONES, INDICE as CUSTODIA_INDICE, NOTIFICACIONES, MAILPIT } from './ciudadano.js'

// HU-08 · Envío a entidad no afiliada. RF-04.1, RF-04.2, RF-03.4.
const INTEROP = process.env.INTEROP_URL ?? 'http://localhost:8086'
const RAIZ = new URL('..', import.meta.url).pathname
const contenido = (titulo) => Buffer.from(`%PDF-1.4\n% ${titulo}\n`)

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles({ name: `${titulo}.pdf`, mimeType: 'application/pdf', buffer: contenido(titulo) })
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

const correosDe = async (request, correo) => (await (await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:${correo}` } })).json()).messages
const conContacto = (request, token) => expect.poll(async () => (await request.get(`${NOTIFICACIONES}/preferencias`, { headers: conToken(token) })).status(), { timeout: 30_000 }).toBe(200)
const entidadDe = (cedula) => `tramites.${cedula}@entidad-sin-operador.gov.co`

async function abrirEnvio(page) {
  await page.goto('./#enviar')
  await expect(page.getByRole('heading', { name: 'Enviar a una entidad' })).toBeVisible()
}

test('HU-08 · el ciudadano envía documentos por correo con enlaces temporales, nunca el archivo, y recibe la confirmación', async ({ page, request }) => {
  const { cuenta, cedula, correo } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Cédula de ciudadanía')
  await subirTemporal(page, 'Diploma de bachiller')
  const token = await tokenDe(page)
  await conContacto(request, token)
  const entidad = entidadDe(cedula)

  await abrirEnvio(page)
  await expect(page.getByLabel('Cédula de ciudadanía')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Diploma de bachiller')).toBeVisible()
  await sinViolaciones(page, 'formulario de envío')
  await page.getByLabel('Correo de la entidad').fill(entidad)
  await page.getByLabel('Cédula de ciudadanía').check()
  await page.getByLabel('Diploma de bachiller').check()
  await page.getByRole('button', { name: 'Enviar documentos' }).click()
  await expect(page.getByText(`Enviamos los enlaces a ${entidad}.`)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Entregado el/)).toBeVisible()
  await sinViolaciones(page, 'envío entregado')

  // El correo a la entidad lleva enlaces temporales, nunca el archivo.
  await expect.poll(async () => (await correosDe(request, entidad)).length, { timeout: 30_000 }).toBe(1)
  const [resumen] = await correosDe(request, entidad)
  const mensaje = await (await request.get(`${MAILPIT}/api/v1/message/${resumen.ID}`)).json()
  expect(mensaje.Attachments ?? []).toHaveLength(0)
  expect(mensaje.Text).toContain('no lleva archivos adjuntos')
  expect(mensaje.Text).toContain('Cédula de ciudadanía')
  const enlaces = [...mensaje.Text.matchAll(/https?:\/\/\S+\/api\/enlaces\/\S+/g)].map((m) => m[0])
  expect(enlaces).toHaveLength(2)

  // Abrir un enlace redirige a una URL prefirmada de 5 minutos y entrega el archivo íntegro.
  const abierto = await request.get(enlaces[0], { maxRedirects: 0 })
  expect(abierto.status()).toBe(302)
  const destino = abierto.headers().location
  expect(destino).toMatch(/X-Amz-Expires=300&/)
  const bajada = await request.get(destino)
  expect(bajada.status()).toBe(200)
  const cuerpo = Buffer.from(await bajada.body())
  expect([contenido('Cédula de ciudadanía'), contenido('Diploma de bachiller')].some((c) => c.equals(cuerpo))).toBe(true)
  // Un enlace con la firma alterada no sirve.
  const alterado = enlaces[0].replace(/f=.{4}/, 'f=AAAA')
  expect((await request.get(alterado, { maxRedirects: 0 })).status()).toBe(404)

  // El ciudadano recibe la confirmación de entrega por su canal (correo), sin los enlaces.
  await expect.poll(async () => (await correosDe(request, correo)).filter((m) => m.Subject === 'Entregamos tus documentos').length, { timeout: 60_000 }).toBe(1)
  const confirmacion = await (await request.get(`${MAILPIT}/api/v1/message/${(await correosDe(request, correo)).find((m) => m.Subject === 'Entregamos tus documentos').ID}`)).json()
  expect(confirmacion.Text).toContain(entidad)
  expect(confirmacion.Text).not.toContain('/api/enlaces/')

  // El envío queda en la bitácora de accesos: uno por documento, y también la apertura del enlace.
  const headers = conToken(token)
  await expect.poll(async () => (await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).filter((a) => a.accion === 'envio').length, { timeout: 30_000 }).toBe(2)
  const accesos = await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()
  expect(accesos.filter((a) => a.accion === 'envio').map((a) => a.destino)).toEqual([`correo:${entidad}`, `correo:${entidad}`])
  await expect.poll(async () => (await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).filter((a) => a.accion === 'lectura-tercero').length, { timeout: 30_000 }).toBe(1)
  expect((await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).find((a) => a.accion === 'lectura-tercero').actor).toEqual({ tipo: 'tercero', id: `correo:${entidad}` })

  // Revocar la autorización del envío corta el enlace de inmediato (RI-08).
  const vigentes = await (await request.get(`${AUTORIZACIONES}/autorizaciones`, { headers })).json()
  expect(vigentes.filter((a) => a.tercero === `correo:${entidad}`)).toHaveLength(2)
  for (const a of vigentes) expect((await request.delete(`${AUTORIZACIONES}/autorizaciones/${a.id}`, { headers })).status()).toBe(204)
  const cortado = await request.get(enlaces[0], { maxRedirects: 0 })
  expect(cortado.status()).toBe(403)
  expect(cortado.headers()['content-type']).toContain('application/problem+json')
})

test('HU-08 · alterno: si el correo no sale el envío queda pendiente y se reintenta solo, sin duplicar el correo', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Cédula de ciudadanía')
  const entidad = entidadDe(cedula)
  await abrirEnvio(page)
  await page.getByLabel('Correo de la entidad').fill(entidad)
  await expect(page.getByLabel('Cédula de ciudadanía')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Cédula de ciudadanía').check()

  // El servidor de correo acepta la conexión y no responde (pausado): el envío debe fallar por plazo, no colgarse.
  execSync('docker compose pause mailpit', { cwd: RAIZ, stdio: 'ignore' })
  try {
    await page.getByRole('button', { name: 'Enviar documentos' }).click()
    await expect(page.getByText(`El correo a ${entidad} no salió todavía.`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Pendiente: el correo no salió todavía/)).toBeVisible()
    await sinViolaciones(page, 'envío pendiente')
  } finally {
    execSync('docker compose unpause mailpit', { cwd: RAIZ, stdio: 'ignore' })
  }
  // El reintento sale con retroceso; sin volver a enviar, queda entregado una sola vez.
  await expect(page.getByText(/Entregado el/)).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => (await correosDe(request, entidad)).length, { timeout: 30_000 }).toBe(1)
  await page.waitForTimeout(4000)
  expect(await correosDe(request, entidad)).toHaveLength(1)
})

test('HU-08 · el envío es idempotente y rechaza documentos ajenos, correos inválidos y sesiones ausentes', async ({ page, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Cédula de ciudadanía')
  const headers = conToken(await tokenDe(page))
  await expect.poll(async () => (await (await request.get(`${CUSTODIA_INDICE}/carpeta`, { headers })).json()).length, { timeout: 20_000 }).toBe(1)
  const [doc] = await (await request.get(`${CUSTODIA_INDICE}/carpeta`, { headers })).json()
  const entidad = entidadDe(cedula)

  const envio = (data, extra = {}) => request.post(`${INTEROP}/envios`, { headers: { ...headers, ...extra }, data })
  const a = await envio({ correo: entidad, documentos: [doc.id] }, { 'idempotency-key': 'clave-e2e-1' })
  expect(a.status()).toBe(201)
  const b = await envio({ correo: entidad, documentos: [doc.id] }, { 'idempotency-key': 'clave-e2e-1' })
  expect(b.status()).toBe(200)
  expect((await b.json()).id).toBe((await a.json()).id)
  await expect.poll(async () => (await correosDe(request, entidad)).length, { timeout: 30_000 }).toBe(1)
  await page.waitForTimeout(2000)
  expect(await correosDe(request, entidad)).toHaveLength(1)

  const ajeno = await envio({ correo: entidad, documentos: ['11111111-1111-4111-8111-111111111111'] })
  expect(ajeno.status()).toBe(422)
  expect(ajeno.headers()['content-type']).toContain('application/problem+json')
  expect((await envio({ correo: 'no-es-correo', documentos: [doc.id] })).status()).toBe(422)
  expect((await request.post(`${INTEROP}/envios`, { data: { correo: entidad, documentos: [doc.id] } })).status()).toBe(401)
  expect(await correosDe(request, entidad)).toHaveLength(1)

  // La SPA explica el correo inválido sin enviar nada.
  await abrirEnvio(page)
  await page.getByLabel('Correo de la entidad').fill('sin-arroba')
  await page.getByRole('button', { name: 'Enviar documentos' }).click()
  await expect(page.getByRole('alert')).toContainText('Escribe el correo de la entidad')
  await sinViolaciones(page, 'envío con error de validación')
})
