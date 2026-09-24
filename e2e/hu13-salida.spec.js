import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, CLAVE, CUSTODIA, ENTIDAD, GOVCARPETA } from './ciudadano.js'

// HU-13 · Traslado de salida. RF-01.7, RF-01.8, RF-03.1, RF-03.2, RF-03.5, RF-03.8, RI-01. El destino es infra/operador-destino:
// un operador simulado que descarga las URL prefirmadas, afilia al ciudadano en el GovCarpeta simulado y confirma.
const RAIZ = new URL('..', import.meta.url).pathname
const DESTINO = process.env.DESTINO_URL ?? 'http://localhost:8097'
const PDF = { name: 'cedula.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% cédula de prueba para el traslado de salida\n') }

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles(PDF)
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

// Un ciudadano afiliado con dos Temporales y un Certificado, y el destino configurado con `modo`.
async function preparar(page, request, modo) {
  const a = await afiliar(request)
  await ingresar(page, a.cuenta)
  await subirTemporal(page, 'Cédula de ciudadanía')
  await subirTemporal(page, 'Diploma de bachiller')
  expect((await (await request.post(`${ENTIDAD}/emitir`, { data: { cedula: a.cedula, titulo: 'Certificado laboral' } })).json()).confirmacion.status).toBe(200)
  await expect(page.getByRole('heading', { name: 'Certificado laboral' })).toBeVisible({ timeout: 20_000 })
  if (modo) expect((await request.post(`${DESTINO}/configurar`, { data: { cedula: a.cedula, modo } })).status()).toBe(200)
  return a
}

async function trasladar(page, nombre = 'Operador Destino') {
  await page.getByRole('link', { name: 'Trasladarme' }).click()
  await expect(page.getByRole('heading', { name: 'Trasladar mi carpeta' })).toBeVisible()
  await page.getByLabel(nombre).check()
  await page.getByLabel(/Entiendo que mi cuenta y mis documentos se borrarán/).check()
  await page.getByRole('button', { name: 'Trasladar mi carpeta' }).click()
}

const afiliacionCentral = async (request, cedula) => {
  const r = await request.get(`${GOVCARPETA}/apis/validateCitizen/${cedula}`)
  return r.status() === 204 ? null : (await r.text()).replace(/.*operador\s+/, '').trim()
}
const estadoDestino = async (request, cedula) => (await request.get(`${DESTINO}/estado/${cedula}`)).json()

test('HU-13 · el ciudadano se traslada: el destino recibe los documentos, GovCarpeta lo afilia allá y solo entonces se cierra la cuenta', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { cuenta, cedula } = await preparar(page, request)
  const headers = conToken(await tokenDe(page))
  const antes = await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()
  expect(antes).toHaveLength(3)

  await page.getByRole('link', { name: 'Trasladarme' }).click()
  await expect(page.getByLabel('Operador Sin Traslado')).toBeDisabled()
  await expect(page.getByText('no publica su dirección en GovCarpeta')).toBeVisible()
  await sinViolaciones(page, 'traslado de salida: elegir operador')
  // Sin elegir ni confirmar no empieza nada.
  await page.getByRole('button', { name: 'Trasladar mi carpeta' }).click()
  await expect(page.getByRole('alert')).toContainText('Elige el operador')
  await page.getByLabel('Operador Destino').check()
  await page.getByRole('button', { name: 'Trasladar mi carpeta' }).click()
  await expect(page.getByRole('alert')).toContainText('Confirma que entiendes')
  expect(await afiliacionCentral(request, cedula)).toBe('Mi Carpeta Segura')
  await page.getByLabel(/Entiendo que mi cuenta y mis documentos se borrarán/).check()
  await page.getByRole('button', { name: 'Trasladar mi carpeta' }).click()

  await expect(page.getByText('Tu carpeta ya está con Operador Destino', { exact: true })).toBeVisible({ timeout: 60_000 })
  await sinViolaciones(page, 'traslado de salida completo')

  // El destino tiene los tres documentos, íntegros, y solo recibió afiliación y URL (RI-01, RD-15).
  const destino = await estadoDestino(request, cedula)
  expect(destino.carpeta.documentos.map((d) => d.titulo).sort()).toEqual(['Cédula de ciudadanía', 'Certificado laboral', 'Diploma de bachiller'].sort())
  expect(destino.carpeta.documentos.every((d) => d.tamano > 0 && /^[0-9a-f]{64}$/.test(d.sha256))).toBe(true)
  expect(destino.claves).toEqual(['citizenEmail', 'citizenName', 'confirmAPI', 'id', 'urlDocuments'])
  expect(destino.confirmaciones[0]).toMatchObject({ req_status: 1, respuesta: { status: 200 } })
  expect(await afiliacionCentral(request, cedula)).toBe('Operador Destino')

  // El evento ciudadano.trasladado hace que MS-05 (índice) y MS-09 (contacto y avisos) borren lo suyo, cada uno en su base.
  const contar = (base, coleccion, filtro) => Number(execSync(`docker compose exec -T mongo mongosh --quiet ${base} --eval 'db.${coleccion}.countDocuments(${filtro})'`, { cwd: RAIZ }).toString().trim())
  await expect.poll(() => contar('indice', 'carpeta', `{ cedula: "${cedula}" }`), { timeout: 30_000 }).toBe(0)
  await expect.poll(() => contar('notificaciones', 'contactos', `{ _id: "${cedula}" }`), { timeout: 30_000 }).toBe(0)

  // Cerrado: los documentos ya no están aquí y la cuenta no ingresa más.
  expect(await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()).toEqual([])
  const p2 = await page.context().browser().newContext().then((c) => c.newPage())
  await p2.goto('./')
  await p2.getByRole('button', { name: 'Ingresar' }).click()
  await p2.locator('#username').fill(cuenta)
  await p2.locator('#password').fill(CLAVE)
  await p2.locator('#kc-login').click()
  await expect(p2.getByRole('heading', { name: 'Hola, Prueba' })).toHaveCount(0)
  await expect(p2.locator('.error')).toBeVisible()
})

test('HU-13 · mientras el destino no confirma la carpeta es de solo lectura y nada se borra; una confirmación sin afiliación real se rechaza', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { cedula } = await preparar(page, request, 'confirmar-sin-afiliar')
  const headers = conToken(await tokenDe(page))
  await trasladar(page)
  await expect(page.getByRole('heading', { name: 'Estamos trasladando tu carpeta' })).toBeVisible()
  await sinViolaciones(page, 'traslado de salida en curso')

  // El destino recibió todo y confirmó 1 sin afiliar al ciudadano: GovCarpeta no lo respalda (409) y no se borra nada.
  await expect.poll(async () => (await estadoDestino(request, cedula)).confirmaciones[0]?.respuesta?.status, { timeout: 40_000 }).toBe(409)
  expect(await afiliacionCentral(request, cedula)).toBeNull()
  expect(await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()).toHaveLength(3)

  // Solo lectura: no hay «Subir documento», la custodia responde 409 a los cambios y la descarga sigue.
  await page.goto('./')
  await expect(page.getByText('Estamos trasladando tu carpeta a Operador Destino')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Subir documento' })).toHaveCount(0)
  await sinViolaciones(page, 'carpeta en solo lectura')
  const subida = await request.post(`${CUSTODIA}/documentos`, { headers, data: { titulo: 'Nuevo', tipo: 'application/pdf', tamano: 10 } })
  expect(subida.status()).toBe(409)
  expect(subida.headers()['content-type']).toContain('application/problem+json')
  const [doc] = await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()
  expect((await request.get(`${CUSTODIA}/documentos/${doc.id}/descarga`, { headers })).status()).toBe(200)

  // El destino ahora informa que no pudo (req_status 0): el ciudadano vuelve a quedar aquí y la carpeta se reabre.
  expect((await request.post(`${DESTINO}/confirmar`, { data: { cedula, req_status: 0 } })).status()).toBe(200)
  await page.getByRole('link', { name: 'Trasladarme' }).click()
  await expect(page.getByText('El traslado no se completó', { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(await afiliacionCentral(request, cedula)).toBe('Mi Carpeta Segura')
})

test('HU-13 · si el destino rechaza, el ciudadano conserva su carpeta y su afiliación, lo ve y puede seguir usándola', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { cedula } = await preparar(page, request, 'rechazar')
  const headers = conToken(await tokenDe(page))
  await trasladar(page)
  await expect(page.getByText('El traslado no se completó', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/Operador Destino rechazó la recepción de tu carpeta/)).toBeVisible()
  await sinViolaciones(page, 'traslado de salida rechazado')
  expect(await afiliacionCentral(request, cedula)).toBe('Mi Carpeta Segura')
  expect(await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()).toHaveLength(3)
  expect((await estadoDestino(request, cedula)).confirmaciones[0]).toMatchObject({ req_status: 0 })
  // La carpeta se reabrió: puede subir de nuevo.
  await page.goto('./')
  await expect(page.getByRole('link', { name: 'Subir documento' })).toBeVisible()
  await subirTemporal(page, 'Otro documento')
})

test('HU-13 · si el destino no acepta transferCitizen, se revierte: sigue afiliado aquí y con su carpeta', async ({ page, request }) => {
  test.setTimeout(150_000)
  const { cedula } = await preparar(page, request, 'no-acepta')
  const headers = conToken(await tokenDe(page))
  await trasladar(page)
  await expect(page.getByText('El traslado no se completó', { exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/no aceptó recibir tu carpeta/)).toBeVisible()
  expect(await afiliacionCentral(request, cedula)).toBe('Mi Carpeta Segura')
  expect(await (await request.get(`${CUSTODIA}/documentos`, { headers })).json()).toHaveLength(3)
})

test('HU-13 · un operador que no publica su dirección de traslado no es elegible: el traslado no empieza (B-16)', async ({ page, request }) => {
  const { cedula } = await preparar(page, request)
  const headers = conToken(await tokenDe(page))
  const INTEROP = process.env.INTEROPERABILIDAD_URL ?? 'http://localhost:8086'
  const r = await request.post(`${INTEROP}/traslados/salida`, { headers, data: { operadorId: 'operador-sin-traslado' } })
  expect(r.status()).toBe(422)
  expect(r.headers()['content-type']).toContain('application/problem+json')
  expect((await request.get(`${INTEROP}/traslados/salida/actual`, { headers })).status()).toBe(404)
  expect(await afiliacionCentral(request, cedula)).toBe('Mi Carpeta Segura')
  expect((await request.post(`${INTEROP}/traslados/salida`, { data: { operadorId: 'operador-destino' } })).status()).toBe(401)
})
