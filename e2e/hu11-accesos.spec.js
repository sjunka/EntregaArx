import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, AUDITORIA } from './ciudadano.js'

// HU-11 · Consulta de accesos. RF-09.4 lista con actor y fecha, RF-09.5 filtros, RNF-14 bitácora solo-append.
async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles({ name: `${titulo}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${titulo}\n`) })
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

async function descargar(page, titulo) {
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible({ timeout: 20_000 })
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Descargar: ${titulo}` }).click()])
}

test('HU-11 · el titular ve quién consultó sus documentos y cuándo, filtra por documento y fechas, y nadie más lo ve', async ({ page, browser, request }) => {
  test.setTimeout(90_000)
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de bachiller')
  await subirTemporal(page, 'Cédula de ciudadanía')
  await descargar(page, 'Diploma de bachiller')
  await descargar(page, 'Cédula de ciudadanía')

  await page.getByRole('link', { name: 'Accesos' }).click()
  await expect(page.getByRole('heading', { name: 'Accesos a mis documentos' })).toBeVisible()
  // La bitácora se alimenta por el bus: puede tardar unos segundos.
  await expect(async () => {
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect(page.getByRole('heading', { name: 'Descargaste Diploma de bachiller' })).toBeVisible({ timeout: 1500 })
    await expect(page.getByRole('heading', { name: 'Descargaste Cédula de ciudadanía' })).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 30_000 })
  await expect(page.getByText('Quién: Tú').first()).toBeVisible()
  await expect(page.getByText(/Cuándo:/).first()).toBeVisible()
  await sinViolaciones(page, 'accesos con formulario de filtros')

  // Filtro por documento.
  await page.getByLabel('Documento', { exact: true }).selectOption({ label: 'Cédula de ciudadanía' })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByRole('heading', { name: 'Descargaste Cédula de ciudadanía' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Descargaste Diploma de bachiller' })).toHaveCount(0)

  // Filtro por rango: uno pasado no trae nada y lo dice; el de hoy trae todo.
  await page.getByLabel('Documento', { exact: true }).selectOption('')
  await page.getByLabel('Desde').fill('2020-01-01')
  await page.getByLabel('Hasta').fill('2020-12-31')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByText('No encontramos accesos con esos filtros.')).toBeVisible()
  await sinViolaciones(page, 'accesos sin resultados')
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  await page.getByLabel('Desde').fill(hoy)
  await page.getByLabel('Hasta').fill(hoy)
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByRole('heading', { name: 'Descargaste Diploma de bachiller' })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar filtros' }).click()
  await expect(page.getByRole('heading', { name: 'Descargaste Cédula de ciudadanía' })).toBeVisible()

  // Otro ciudadano no ve nada de esta bitácora, ni pidiendo un documento ajeno.
  const suyo = await (await request.get(`${AUDITORIA}/accesos`, { headers: conToken(await tokenDe(page)) })).json()
  const otro = await afiliar(request)
  const p2 = await (await browser.newContext()).newPage()
  await ingresar(p2, otro.cuenta)
  const h2 = conToken(await tokenDe(p2))
  expect(await (await request.get(`${AUDITORIA}/accesos?documentoId=${suyo[0].documentoId}`, { headers: h2 })).json()).toEqual([])
  expect(await (await request.get(`${AUDITORIA}/accesos`, { headers: h2 })).json()).toEqual([])
  // Sin sesión: 401; filtros mal formados: 422; sin operación de cambio (405).
  expect((await request.get(`${AUDITORIA}/accesos`)).status()).toBe(401)
  expect((await request.get(`${AUDITORIA}/accesos?desde=ayer`, { headers: h2 })).status()).toBe(422)
  expect((await request.delete(`${AUDITORIA}/accesos/${suyo[0].id}`, { headers: conToken(await tokenDe(page)) })).status()).toBe(405)
})
