import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'

// HU-02 · Ingreso al operador. RF-09.1, RNF-10, RNF-11.
const CUENTA = 'andres.perez.45678@carpetacolombia.co'
const CLAVE = 'clave-de-prueba-e2e-2026'
const CUSTODIA = process.env.CUSTODIA_URL ?? 'http://localhost:8083'

async function ingresar(page, cuenta, clave) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill(cuenta)
  await page.locator('#password').fill(clave)
  await page.locator('#kc-login').click()
}

test('HU-02 · ingreso con PKCE, carpeta propia y cierre que invalida la sesión', async ({ page }) => {
  await ingresar(page, CUENTA, process.env.USUARIO_DEMO_CLAVE)
  await expect(page.getByRole('heading', { name: 'Hola, Andrés' })).toBeVisible()
  // La carpeta sale de la custodia con el token de la sesión.
  await expect(page.getByText('Todavía no tienes documentos.')).toBeVisible()
  await sinViolaciones(page, 'carpeta desde la custodia')

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
  const guardado = await page.evaluate(() => Object.keys(window.sessionStorage).filter((k) => k.startsWith('oidc.user')))
  expect(guardado, 'la SPA no conserva la sesión').toEqual([])
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hola, Andrés' })).toHaveCount(0)
})

test('HU-02 · la custodia rechaza con 401 tokens ausentes o inválidos', async ({ request }) => {
  for (const cabeceras of [{}, { authorization: 'Bearer abc.def.ghi' }]) {
    const r = await request.get(`${CUSTODIA}/documentos`, { headers: cabeceras })
    expect(r.status()).toBe(401)
    expect(r.headers()['content-type']).toContain('application/problem+json')
  }
})

test('HU-02 · alterno: cinco intentos fallidos bloquean la cuenta sin revelar si existe', async ({ page }) => {
  // Cuenta que no existe: el bloqueo es por nombre, así que la respuesta no delata cuáles hay.
  const cuenta = `nadie.${Date.now()}@carpetacolombia.co`
  await ingresar(page, cuenta, 'una-clave-errada')
  for (let i = 1; i < 4; i++) {
    await expect(page.getByRole('alert')).toContainText('no coinciden')
    await page.locator('#password').fill('una-clave-errada')
    await page.locator('#kc-login').click()
  }
  await expect(page.getByRole('alert')).toContainText('no coinciden')
  await page.locator('#password').fill('una-clave-errada')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('alert')).toContainText('bloqueamos el ingreso')
  await sinViolaciones(page, 'cuenta bloqueada')
})
