import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, AUDITORIA, ENTIDAD, INDICE } from './ciudadano.js'

// HU-06 · Consulta y descarga. RF-02.6 búsqueda, RF-02.7 descarga por URL prefirmada de corta vida, RNF-04 lista desde el índice.
const PDF = { name: 'diploma.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% diploma de bachiller de prueba\n') }
const RAIZ = new URL('..', import.meta.url).pathname

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles(PDF)
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: `Hola, Prueba` })).toBeVisible()
}

test('HU-06 · el ciudadano busca por título, clase y fecha, descarga con URL prefirmada y el acceso queda en una bitácora inalterable', async ({ page, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de bachiller')
  await subirTemporal(page, 'Cédula de ciudadanía')
  const emision = await (await request.post(`${ENTIDAD}/emitir`, { data: { cedula, titulo: 'Certificado laboral' } })).json()
  expect(emision.confirmacion.status).toBe(200)

  // La lista sale del índice (MS-05), que se pone al día por eventos.
  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Cédula de ciudadanía' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Certificado laboral' })).toBeVisible()
  await sinViolaciones(page, 'carpeta con formulario de búsqueda')

  // Título: sin tildes ni mayúsculas.
  await page.getByLabel('Título').fill('CEDULA')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByRole('heading', { name: 'Cédula de ciudadanía' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Certificado laboral' })).toHaveCount(0)

  // Clase.
  await page.getByLabel('Título').fill('')
  await page.getByLabel('Clase').selectOption('certificado')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByRole('heading', { name: 'Certificado laboral' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cédula de ciudadanía' })).toHaveCount(0)

  // Fecha: un rango en el pasado no trae nada y lo dice.
  await page.getByLabel('Clase').selectOption('')
  await page.getByLabel('Desde').fill('2020-01-01')
  await page.getByLabel('Hasta').fill('2020-12-31')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByText('No encontramos documentos con esos filtros.')).toBeVisible()
  await sinViolaciones(page, 'búsqueda sin resultados')
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  await page.getByLabel('Desde').fill(hoy)
  await page.getByLabel('Hasta').fill(hoy)
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar filtros' }).click()
  await expect(page.getByRole('heading', { name: 'Certificado laboral' })).toBeVisible()

  // Descarga: URL prefirmada de corta vida, el archivo llega íntegro.
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar: Diploma de bachiller' }).click(),
  ])
  expect(descarga.suggestedFilename()).toBe('Diploma de bachiller.pdf')
  expect(descarga.url()).toMatch(/X-Amz-Expires=60&/)
  const archivo = await descarga.createReadStream()
  const trozos = []
  for await (const t of archivo) trozos.push(t)
  expect(Buffer.concat(trozos).equals(PDF.buffer)).toBe(true)

  // Cada descarga queda en auditoría (MS-02, por el bus) y la bitácora no se puede modificar.
  const headers = conToken(await tokenDe(page))
  await expect.poll(async () => (await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).length, { timeout: 30_000 }).toBe(1)
  const [acceso] = await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()
  expect(acceso).toMatchObject({ titulo: 'Diploma de bachiller', accion: 'descarga', actor: { tipo: 'titular', id: cedula } })
  for (const metodo of ['put', 'patch', 'delete']) {
    const r = await request[metodo](`${AUDITORIA}/accesos/${acceso.id}`, { headers })
    expect(r.status(), metodo).toBe(405)
    expect(r.headers()['content-type']).toContain('application/problem+json')
  }
  expect(await (await request.get(`${AUDITORIA}/accesos`, { headers })).json()).toHaveLength(1)
})

test('HU-06 · alterno: si el almacén no responde el documento sigue en la lista y se puede reintentar', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Diploma de bachiller')
  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible({ timeout: 20_000 })
  const headers = conToken(await tokenDe(page))

  execSync('docker compose stop minio', { cwd: RAIZ, stdio: 'ignore' })
  try {
    await page.getByRole('button', { name: 'Descargar: Diploma de bachiller' }).click()
    await expect(page.getByRole('alert')).toContainText('No pudimos preparar la descarga')
    await expect(page.getByRole('alert')).toContainText('sigue en tu carpeta')
    await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible()
    await sinViolaciones(page, 'descarga fallida con opción de reintentar')
    await page.waitForTimeout(3000)
    expect(await (await request.get(`${AUDITORIA}/accesos`, { headers })).json(), 'un acceso que no ocurrió no se registra').toEqual([])
  } finally {
    execSync('docker compose start minio', { cwd: RAIZ, stdio: 'ignore' })
  }
  const reintento = page.getByRole('button', { name: 'Reintentar la descarga: Diploma de bachiller' })
  await expect(reintento).toBeVisible()
  await expect(async () => {
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), reintento.click()])
    expect(descarga.suggestedFilename()).toBe('Diploma de bachiller.pdf')
  }).toPass({ timeout: 40_000 })
})

test('HU-06 · el índice solo entrega la carpeta del titular del token y exige sesión', async ({ page, request }) => {
  const { cuenta } = await afiliar(request)
  await ingresar(page, cuenta)
  expect((await request.get(`${INDICE}/carpeta`)).status()).toBe(401)
  const r = await request.get(`${INDICE}/carpeta?clase=paloma`, { headers: conToken(await tokenDe(page)) })
  expect(r.status()).toBe(422)
  expect(r.headers()['content-type']).toContain('application/problem+json')
})
