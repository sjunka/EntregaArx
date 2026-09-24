import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, CUSTODIA } from './ciudadano.js'

// HU-04 · Autenticación de Temporal vía GovCarpeta. Compose usa el doble de GovCarpeta: nunca escribe en el real.
const PDF = { name: 'diploma.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% diploma de prueba\n') }

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles(PDF)
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible()
}

test('HU-04 · el titular autentica su Temporal y la SPA lo distingue', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de bachiller')
  await subirTemporal(page, 'Recibo de servicios')
  await sinViolaciones(page, 'carpeta con Temporales sin autenticar')

  await page.getByRole('button', { name: 'Autenticar con GovCarpeta: Diploma de bachiller' }).click()
  await expect(page.getByText(/Temporal · Autenticado por GovCarpeta el/)).toBeVisible()
  await expect(page.getByText('Temporal · sin autenticar')).toHaveCount(1) // el otro sigue sin marca
  await expect(page.getByRole('button', { name: /Autenticar con GovCarpeta/ })).toHaveCount(1)
  await expect(page.getByTestId('cuota')).toContainText('Te quedan 18 de 20 documentos') // Autenticado sigue consumiendo cuota
  await sinViolaciones(page, 'carpeta con un Temporal Autenticado')

  const docs = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()
  const auth = docs.find((d) => d.titulo === 'Diploma de bachiller')
  expect(auth).toMatchObject({ clase: 'temporal', estado: 'cargado' })
  expect(auth.autenticacion.respuesta).toContain('autenticado')
  expect(auth.autenticacion.respuesta.toLowerCase()).not.toContain('certificad')
})

test('HU-04 · alterno: otro usuario recibe 403', async ({ page, request }) => {
  const dueno = await afiliar(request)
  await ingresar(page, dueno.cuenta)
  await subirTemporal(page, 'Diploma ajeno')
  const [doc] = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()

  const otro = await afiliar(request)
  await page.evaluate(() => window.sessionStorage.clear())
  await ingresar(page, otro.cuenta)
  const r = await request.post(`${CUSTODIA}/documentos/${doc.id}/autenticacion`, { headers: conToken(await tokenDe(page)) })
  expect(r.status()).toBe(403)
  expect(r.headers()['content-type']).toContain('application/problem+json')

  // El documento del dueño sigue sin marca.
  await page.evaluate(() => window.sessionStorage.clear())
  await ingresar(page, dueno.cuenta)
  const [intacto] = await (await request.get(`${CUSTODIA}/documentos`, { headers: conToken(await tokenDe(page)) })).json()
  expect(intacto.autenticacion).toBeUndefined()
})
