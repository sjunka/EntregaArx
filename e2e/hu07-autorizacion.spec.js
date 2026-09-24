import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, tokenServicio, AUDITORIA, CUSTODIA, ENTIDAD, AUTORIZACIONES } from './ciudadano.js'

// HU-07 · Autorización documento a documento. RF-04.3, RF-04.4, RF-04.5, RI-08.
const contenido = (titulo) => Buffer.from(`%PDF-1.4\n% ${titulo}\n`)
const PDF = (titulo) => ({ name: `${titulo}.pdf`, mimeType: 'application/pdf', buffer: contenido(titulo) })

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles(PDF(titulo))
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

const pedirDocumentos = async (request, datos) => (await request.post(`${ENTIDAD}/peticiones`, { data: datos })).json()
const consultar = async (request, id, opciones = {}) => (await request.post(`${ENTIDAD}/peticiones/consultar`, { data: { id, ...opciones } })).json()

test('HU-07 · el ciudadano autoriza solo un documento, la entidad recibe únicamente ese, el acceso se audita y revocar corta el acceso', async ({ page, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de Ingeniería')
  await subirTemporal(page, 'Certificado laboral')

  // La entidad pide el diploma y el certificado laboral.
  const creada = await pedirDocumentos(request, { cedula, proposito: 'Verificar tus estudios para una beca', documentos: [{ titulo: 'Diploma' }, { titulo: 'Certificado laboral' }] })
  expect(creada.status).toBe(201)
  expect(creada.cuerpo.estado).toBe('pendiente')
  const { id } = creada.cuerpo
  const idem = await pedirDocumentos(request, { cedula, proposito: 'Verificar tus estudios para una beca', documentos: [{ titulo: 'Diploma' }, { titulo: 'Certificado laboral' }], idExterno: creada.idExterno })
  expect(idem.status).toBe(200)
  expect(idem.cuerpo.id).toBe(id)
  expect((await consultar(request, id)).cuerpo).toEqual({ id, estado: 'pendiente', documentos: [] })

  // La petición muestra entidad, documentos pedidos y propósito.
  await page.goto('./#solicitudes')
  await expect(page.getByRole('heading', { name: 'universidad-demo te pide documentos' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Verificar tus estudios para una beca')).toBeVisible()
  await expect(page.getByText('Diploma, Certificado laboral')).toBeVisible()
  await expect(page.getByLabel('Diploma de Ingeniería')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Diploma de Ingeniería')).not.toBeChecked() // nada marcado de antemano
  await sinViolaciones(page, 'solicitud pendiente')

  // Antes de autorizar, la custodia no firma para la entidad aunque se lo pidan directo (RI-08).
  const docs = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()
  const diploma = docs.find((d) => d.titulo === 'Diploma de Ingeniería')
  const laboral = docs.find((d) => d.titulo === 'Certificado laboral')
  const servicio = { authorization: `Bearer ${await tokenServicio(request, 'interoperabilidad', process.env.KC_INTEROP_SECRETO)}` }
  const directa = await request.post(`${CUSTODIA}/interno/lecturas`, { headers: servicio, data: { documentoId: diploma.id, tercero: 'entidad:universidad-demo' } })
  expect(directa.status()).toBe(403)
  expect(directa.headers()['content-type']).toContain('application/problem+json')

  // Marca solo el diploma y autoriza.
  await page.getByLabel('Diploma de Ingeniería').check()
  await page.getByRole('button', { name: 'Autorizar «Diploma de Ingeniería»' }).click()
  await expect(page.getByText('Autorizaste los documentos elegidos.')).toBeVisible()
  await expect(page.getByText(/Vigente hasta el/)).toBeVisible()
  await sinViolaciones(page, 'solicitud atendida')

  // La entidad recibe únicamente ese documento, con una URL de corta vida que entrega el archivo íntegro.
  const recogida = await consultar(request, id)
  expect(recogida.status).toBe(200)
  expect(recogida.cuerpo.estado).toBe('atendida')
  expect(recogida.cuerpo.documentos).toHaveLength(1)
  const [entregado] = recogida.cuerpo.documentos
  expect(entregado).toMatchObject({ id: diploma.id, titulo: 'Diploma de Ingeniería' })
  expect(entregado.url).toMatch(/X-Amz-Expires=300&/)
  const bajada = await request.get(entregado.url)
  expect(bajada.status()).toBe(200)
  expect(Buffer.from(await bajada.body()).equals(contenido('Diploma de Ingeniería'))).toBe(true)
  expect(JSON.stringify(recogida.cuerpo)).not.toContain(laboral.id)
  const otroDirecto = await request.post(`${CUSTODIA}/interno/lecturas`, { headers: servicio, data: { documentoId: laboral.id, tercero: 'entidad:universidad-demo' } })
  expect(otroDirecto.status(), 'el documento no marcado no sale').toBe(403)

  // El acceso del tercero queda en auditoría.
  const headers = conToken(await tokenDe(page))
  await expect.poll(async () => (await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).filter((a) => a.accion === 'lectura-tercero').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
  const accesos = await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()
  expect(accesos.find((a) => a.accion === 'lectura-tercero')).toMatchObject({ titulo: 'Diploma de Ingeniería', actor: { tipo: 'tercero', id: 'entidad:universidad-demo' } })

  // Revocar surte efecto de inmediato.
  await page.getByRole('button', { name: 'Revocar autorización de «Diploma de Ingeniería» a universidad-demo' }).click()
  await expect(page.getByText('Retiraste la autorización.').first()).toBeVisible()
  await expect(page.getByText('Retiraste esta autorización.')).toBeVisible()
  expect((await consultar(request, id)).cuerpo).toEqual({ id, estado: 'atendida', documentos: [] })
  expect((await request.post(`${CUSTODIA}/interno/lecturas`, { headers: servicio, data: { documentoId: diploma.id, tercero: 'entidad:universidad-demo' } })).status()).toBe(403)
})

test('HU-07 · alterno: rechazar la petición completa; la entidad solo recibe el rechazo, sin detalle de la carpeta', async ({ page, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de Ingeniería')
  const { cuerpo: { id } } = await pedirDocumentos(request, { cedula, documentos: [{ titulo: 'Diploma' }] })

  await page.goto('./#solicitudes')
  await page.getByRole('button', { name: 'Rechazar petición de universidad-demo' }).click()
  await expect(page.getByText('Rechazaste la petición.')).toBeVisible()
  await expect(page.getByText('Rechazaste esta petición. universidad-demo no recibió ningún documento.')).toBeVisible()
  await sinViolaciones(page, 'solicitud rechazada')
  expect((await consultar(request, id)).cuerpo).toEqual({ id, estado: 'rechazada', documentos: [] })
})

test('HU-07 · la entidad debe firmar sus peticiones y consultas; el destinatario debe ser de este operador', async ({ request }) => {
  const { cedula } = await afiliar(request)
  const invalida = await pedirDocumentos(request, { cedula, documentos: [{ titulo: 'Diploma' }], firmaInvalida: true })
  expect(invalida.status).toBe(401)
  expect(invalida.cuerpo.title).toBe('Firma no válida')
  const ajeno = await pedirDocumentos(request, { cedula: '1000000001', documentos: [{ titulo: 'Diploma' }] }) // afiliado a otro operador
  expect(ajeno.status).toBe(422)
  const { cuerpo: { id } } = await pedirDocumentos(request, { cedula, documentos: [{ titulo: 'Diploma' }] })
  expect((await consultar(request, id, { sinFirma: true })).status).toBe(401)
  expect((await consultar(request, id, { firmaInvalida: true })).status).toBe(401)
  // Un ciudadano no llega a las rutas de servicio de MS-06 ni a la decisión.
  const ciudadano = await request.post(`${AUTORIZACIONES}/interno/decisiones`, { data: {} })
  expect(ciudadano.status()).toBe(401)
})
