import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken } from './ciudadano.js'

// HU-10 · Caso PQRS Premium. RF-07.2, RF-07.3, RI-07, RI-08.
const PREMIUM = process.env.PREMIUM_URL ?? 'http://localhost:8095'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const CLAVE_EMPRESA = process.env.USUARIO_DEMO_CLAVE

async function ingresarEmpresa(page, cuenta, nombre) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill(cuenta)
  await page.locator('#password').fill(CLAVE_EMPRESA)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: nombre, level: 1 })).toBeVisible()
}

async function subirTemporal(page, titulo) {
  await page.goto('./#subir')
  await page.getByLabel('Nombre del documento').fill(titulo)
  await page.getByLabel('Archivo').setInputFiles({ name: `${titulo}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${titulo}\n`) })
  await page.getByRole('button', { name: 'Guardar en mi carpeta' }).click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

test('HU-10 · la empresa Premium abre un caso, pide documentos, el ciudadano decide y el uso se mide', async ({ page, browser, request }) => {
  const { cuenta, cedula } = await afiliar(request)
  await ingresar(page, cuenta)
  await subirTemporal(page, 'Factura de energía')

  const ctx = await browser.newContext({ baseURL: BASE, locale: 'es-CO' })
  const empresa = await ctx.newPage()
  await ingresarEmpresa(empresa, 'tramites@premium.carpetacolombia.co', 'Trámites Premium S.A.S.')
  const usoAntes = async (servicio) => Number((await empresa.getByRole('row', { name: new RegExp(`^${servicio}`) }).getByRole('cell').nth(1).textContent()))
  const casosAntes = await usoAntes('Caso PQRS')
  const peticionesAntes = await usoAntes('Petición de documentos')

  // Abre el caso y ve su estado.
  const asunto = `Reclamo ${Date.now()}`
  await empresa.getByLabel('Asunto del caso').fill(asunto)
  await empresa.getByRole('button', { name: 'Abrir caso' }).click()
  await expect(empresa.getByText('Abrimos el caso.')).toBeVisible()
  await expect(empresa.getByRole('heading', { name: asunto })).toBeVisible()
  const caso = empresa.getByRole('listitem').filter({ has: empresa.getByRole('heading', { name: asunto }) })
  await expect(caso.getByText('Caso abierto')).toBeVisible()

  // Pide desde el caso.
  await empresa.getByLabel(`Cédula del ciudadano en «${asunto}»`).fill(cedula)
  await empresa.getByLabel(`Documentos que pides en «${asunto}», separados por coma`).fill('Factura de energía')
  await empresa.getByLabel(`Para qué los necesitas en «${asunto}»`).fill('Resolver tu reclamo de facturación')
  await sinViolaciones(empresa, 'consola de empresa con caso')
  await empresa.getByRole('button', { name: `Pedir documentos en «${asunto}»` }).click()
  await expect(empresa.getByText('Enviamos la petición al ciudadano.')).toBeVisible()
  await expect(caso.getByText('Esperando la decisión del ciudadano')).toBeVisible()

  // El uso se mide por empresa: un caso y una petición más.
  await expect.poll(() => usoAntes('Caso PQRS')).toBe(casosAntes + 1)
  await expect.poll(() => usoAntes('Petición de documentos')).toBe(peticionesAntes + 1)
  await sinViolaciones(empresa, 'consola de empresa con petición')

  // La petición llega al ciudadano por la misma autorización de HU-07: nada marcado de antemano, decide documento a documento.
  await page.goto('./#solicitudes')
  await expect(page.getByRole('heading', { name: 'tramites-premium te pide documentos' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Resolver tu reclamo de facturación')).toBeVisible()
  await expect(page.getByLabel('Factura de energía')).not.toBeChecked({ timeout: 20_000 })
  await page.getByLabel('Factura de energía').check()
  await page.getByRole('button', { name: 'Autorizar «Factura de energía»' }).click()
  await expect(page.getByText('Autorizaste los documentos elegidos.')).toBeVisible()

  // La empresa ve la decisión sin recargar.
  await expect(caso.getByText('El ciudadano autorizó documentos')).toBeVisible({ timeout: 15_000 })

  // Una empresa no entra a la carpeta del ciudadano ni un ciudadano a la consola de la empresa.
  const tokenCiudadano = await tokenDe(page)
  const ajeno = await request.get(`${PREMIUM}/casos`, { headers: conToken(tokenCiudadano) })
  expect(ajeno.status()).toBe(401) // el token del ciudadano no lleva la audiencia premium
  expect(ajeno.headers()['content-type']).toContain('application/problem+json')
  await ctx.close()
})

test('HU-10 · alterno: la empresa sin plan Premium no crea el caso y se le ofrece el catálogo', async ({ page }) => {
  await ingresarEmpresa(page, 'servicios@basico.carpetacolombia.co', 'Servicios Básicos Ltda.')
  await expect(page.getByText('Tu empresa no tiene un plan Premium activo.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Catálogo Premium' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Caso PQRS' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir caso' })).toHaveCount(0)
  await sinViolaciones(page, 'consola de empresa sin plan')

  // Aunque llame a la API directo, no se crea el caso ni se mide nada.
  const jwt = await tokenDe(page)
  const r = await page.request.post(`${PREMIUM}/casos`, { headers: conToken(jwt), data: { asunto: 'Sin plan' } })
  expect(r.status()).toBe(403)
  expect(r.headers()['content-type']).toContain('application/problem+json')
  expect((await r.json()).title).toBe('Plan Premium requerido')
  const uso = await (await page.request.get(`${PREMIUM}/uso`, { headers: conToken(jwt) })).json()
  expect(uso.every((u) => u.total === 0)).toBe(true)
})
