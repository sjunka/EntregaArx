import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, CUSTODIA } from './ciudadano.js'

// HU-03 · Carga de Temporal. RF-02.2, RF-02.3, RNF-24, RI-06.
const PDF = { name: 'diploma.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% diploma de prueba\n') }

test('HU-03 · el Temporal sube directo al almacén y aparece en la carpeta con su cuota', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  await expect(page.getByTestId('cuota')).toContainText('Te quedan 20 de 20 documentos y 200 MB de 200 MB')

  const peticiones = []
  page.on('request', (r) => peticiones.push({ metodo: r.method(), url: r.url(), bytes: r.postDataBuffer()?.length ?? 0 }))

  await page.getByRole('link', { name: 'Subir documento' }).click()
  await expect(page.getByRole('heading', { name: 'Subir documento' })).toBeVisible()
  await sinViolaciones(page, 'subir documento')
  await page.getByLabel('Nombre del documento').fill('Diploma de bachiller')
  await page.getByLabel('Archivo').setInputFiles(PDF)
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()

  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible()
  await expect(page.getByText('Temporal · sin autenticar')).toBeVisible()
  await expect(page.getByTestId('cuota')).toContainText('Te quedan 19 de 20 documentos')
  await sinViolaciones(page, 'carpeta con un Temporal')

  // RI-06: el binario viajó por PUT al almacén (URL prefirmada) y ninguna llamada a la custodia lo llevó.
  const put = peticiones.find((p) => p.metodo === 'PUT')
  expect(put.url).toMatch(/^http:\/\/localhost:9000\/mcs-documentos\/.+X-Amz-Signature=/)
  expect(put.bytes).toBe(PDF.buffer.length)
  expect(peticiones.filter((p) => p.url.startsWith(CUSTODIA)).every((p) => p.bytes < 300)).toBe(true)

  const docs = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()
  expect(docs).toHaveLength(1)
  expect(docs[0]).toMatchObject({ clase: 'temporal', estado: 'cargado', tipo: 'application/pdf', tamano: PDF.buffer.length })
  expect(docs[0].sha256).toMatch(/^[0-9a-f]{64}$/)
})

test('HU-03 · alterno: la SPA explica un formato no permitido sin subir nada', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill('Notas')
  await page.getByLabel('Archivo').setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('alert')).toContainText('Solo aceptamos PDF, JPG o PNG')
  await sinViolaciones(page, 'formato no permitido')
})

test('HU-03 · alternos de la API: 415, 413, 422 y cuota llena', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  const headers = conToken(await tokenDe(page))
  const reservar = (data) => request.post(`${CUSTODIA}/documentos`, { headers, data })
  const pdf = { titulo: 'Doc', tipo: 'application/pdf', tamano: 1000 }

  for (const [data, status] of [
    [{ ...pdf, tipo: 'application/zip' }, 415],
    [{ ...pdf, tamano: 10 * 1024 * 1024 + 1 }, 413],
    [{ ...pdf, titulo: '' }, 422],
  ]) {
    const r = await reservar(data)
    expect(r.status()).toBe(status)
    expect(r.headers()['content-type']).toContain('application/problem+json')
    expect((await r.json()).detail).toBeTruthy()
  }

  for (let i = 0; i < 20; i++) expect((await reservar(pdf)).status()).toBe(201)
  const llena = await reservar(pdf)
  expect(llena.status()).toBe(422)
  expect((await llena.json()).detail).toContain('20 documentos')
})
