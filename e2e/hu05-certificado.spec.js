import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, CUSTODIA, NOTIFICACIONES, ENTIDAD, MAILPIT } from './ciudadano.js'

// HU-05 · Recepción de Certificado. Compose trae una entidad simulada (universidad-demo) que firma y entrega.
const PDF = { name: 'diploma.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% diploma de prueba\n') }

const emitir = async (request, datos) => (await request.post(`${ENTIDAD}/emitir`, { data: datos })).json()
const correosDe = async (request, correo) => (await (await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:${correo}` } })).json()).messages

// MS-09 recibe el contacto por Kafka de forma asíncrona: se espera a que ya lo tenga.
const conContacto = (request, token) => expect.poll(async () => (await request.get(`${NOTIFICACIONES}/preferencias`, { headers: conToken(token) })).status(), { timeout: 30_000 }).toBe(200)

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles(PDF)
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible()
}

test('HU-05 · el Certificado llega Vigente, sustituye al Temporal equivalente y el ciudadano recibe el aviso por los canales que eligió', async ({ page, request }) => {
  const { cuenta, cedula, correo } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de Ingeniería')
  await conContacto(request, await tokenDe(page))

  // El ciudadano elige correo y SMS.
  await page.getByRole('link', { name: 'Avisos' }).click()
  await expect(page.getByRole('heading', { name: 'Avisos', exact: true })).toBeVisible()
  await expect(page.getByLabel('Correo electrónico')).toBeChecked() // canal por defecto
  await page.getByLabel('Mensaje de texto (SMS)').check()
  await sinViolaciones(page, 'preferencias de aviso')
  await page.getByRole('button', { name: 'Guardar preferencias' }).click()
  await expect(page.getByText('Guardamos tus preferencias')).toBeVisible()
  await expect(page.getByText('Todavía no te hemos enviado avisos.')).toBeVisible()

  // La entidad anuncia, sube por URL prefirmada y confirma.
  const t0 = Date.now()
  const r = await emitir(request, { cedula, titulo: 'diploma de ingenieria' })
  expect(r.anuncio.status).toBe(201)
  expect(r.anuncio.cuerpo.estado).toBe('recibido')
  expect(r.anuncio.cuerpo.urlCarga).toMatch(/^http:\/\/localhost:9000\/mcs-certificados\/.+X-Amz-Signature=/)
  expect(r.carga).toBe(200)
  expect(r.confirmacion.status).toBe(200)
  expect(r.confirmacion.cuerpo.estado).toBe('vigente')
  expect(r.confirmacion.cuerpo.sustituyeA).toBeTruthy()

  // RNF-05: el aviso llega al ciudadano en menos de 2 minutos (correo en Mailpit, SMS en el historial).
  await expect.poll(async () => (await correosDe(request, correo)).length, { timeout: 60_000 }).toBe(1)
  expect(Date.now() - t0).toBeLessThan(120_000)
  const [correoRecibido] = await correosDe(request, correo)
  expect(correoRecibido.Subject).toBe('Recibiste un documento en tu carpeta')
  const detalle = await (await request.get(`${MAILPIT}/api/v1/message/${correoRecibido.ID}`)).json()
  expect(detalle.Text).toContain('diploma de ingenieria')
  expect(detalle.Text).toContain('universidad-demo')

  // La Carpeta muestra el Certificado y el Temporal Sustituido, enlazado; solo el Certificado no cuenta cuota.
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'diploma de ingenieria' })).toBeVisible()
  await expect(page.getByText('Certificado · Vigente · emitido por universidad-demo')).toBeVisible()
  await expect(page.getByText('Temporal · Sustituido por el certificado')).toBeVisible()
  await expect(page.getByRole('link', { name: '«diploma de ingenieria»' })).toBeVisible()
  await expect(page.getByTestId('cuota')).toContainText('Te quedan 20 de 20 documentos')
  await expect(page.getByRole('button', { name: /Autenticar con GovCarpeta/ })).toHaveCount(0)
  await sinViolaciones(page, 'carpeta con certificado y temporal sustituido')

  await page.goto('./#avisos')
  await expect(page.getByText('Por correo · Enviado')).toBeVisible()
  await expect(page.getByText('Por SMS · Enviado')).toBeVisible()
  await sinViolaciones(page, 'avisos con historial')

  // El Certificado no consume cuota ni se puede eliminar.
  const headers = conToken(await tokenDe(page))
  const docs = await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()
  const cert = docs.find((d) => d.clase === 'certificado')
  expect(cert).toMatchObject({ estado: 'vigente', emisor: 'universidad-demo' })
  const del = await request.delete(`${CUSTODIA}/documentos/${cert.id}`, { headers })
  expect(del.status()).toBe(409)
  expect(del.headers()['content-type']).toContain('application/problem+json')
  expect(docs.find((d) => d.clase === 'temporal')).toMatchObject({ estado: 'sustituido', sustituidoPor: cert.id })

  // Los esquemas del bus están registrados en Schema Registry.
  const sujetos = await (await request.get('http://localhost:8085/subjects')).json()
  expect(sujetos).toEqual(expect.arrayContaining(['mcs.documento.recibido-value', 'mcs.ciudadano.afiliado-value']))
})

test('HU-05 · recepción idempotente: un reenvío no duplica el documento ni el aviso', async ({ page, request }) => {
  const { cuenta, cedula, correo } = await afiliar(request)
  await ingresar(page, cuenta)
  await conContacto(request, await tokenDe(page))
  const idExterno = `dip-${Date.now()}`
  const primera = await emitir(request, { cedula, titulo: 'Título profesional', idExterno })
  expect(primera.confirmacion.status).toBe(200)
  const segunda = await emitir(request, { cedula, titulo: 'Título profesional', idExterno })
  expect(segunda.anuncio.status).toBe(200)
  expect(segunda.anuncio.cuerpo.id).toBe(primera.anuncio.cuerpo.id)

  await expect.poll(async () => (await correosDe(request, correo)).length, { timeout: 60_000 }).toBe(1)
  await page.waitForTimeout(3000) // un evento duplicado tendría tiempo de llegar
  expect(await correosDe(request, correo)).toHaveLength(1)
  const docs = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()
  expect(docs.filter((d) => d.clase === 'certificado')).toHaveLength(1)
})

test('HU-05 · alterno: firma inválida queda Rechazado, la entidad recibe el motivo y no entra a la Carpeta', async ({ page, request }) => {
  const { cuenta, cedula, correo } = await afiliar(request)
  await ingresar(page, cuenta)
  const r = await emitir(request, { cedula, titulo: 'Diploma falso', firmaInvalida: true })
  expect(r.anuncio.status).toBe(422)
  expect(r.anuncio.cuerpo).toMatchObject({ estado: 'rechazado', title: 'Documento rechazado' })
  expect(r.anuncio.cuerpo.detail).toContain('firma')
  expect(r.carga).toBeUndefined()

  await page.goto('./')
  await expect(page.getByText('Todavía no tienes documentos.')).toBeVisible()
  await page.waitForTimeout(2000)
  expect(await correosDe(request, correo)).toHaveLength(0)
})

test('HU-05 · alterno: un archivo distinto al firmado queda Rechazado en la confirmación', async ({ page, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  const r = await emitir(request, { cedula, titulo: 'Diploma alterado', alterarArchivo: true })
  expect(r.anuncio.status).toBe(201)
  expect(r.confirmacion.status).toBe(422)
  expect(r.confirmacion.cuerpo).toMatchObject({ estado: 'rechazado' })
  expect(r.confirmacion.cuerpo.detail).toContain('SHA-256')
  await page.goto('./')
  await expect(page.getByText('Todavía no tienes documentos.')).toBeVisible()
})

test('HU-05 · alterno: un destinatario que no es de este operador o una entidad desconocida se rechazan', async ({ request }) => {
  const r = await emitir(request, { cedula: '1000000001', titulo: 'Diploma' }) // afiliado a otro operador en el doble de GovCarpeta
  expect(r.anuncio.status).toBe(422)
  expect(r.anuncio.cuerpo.title).toBe('Destinatario no afiliado')
})
