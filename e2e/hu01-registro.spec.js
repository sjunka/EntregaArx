import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'

// HU-01 · Registro y afiliación. Compose usa el doble de GovCarpeta: nunca escribe en el real.
const CLAVE = 'clave-de-prueba-e2e-2026'

async function llenarRegistro(page, cedula) {
  await page.goto('./#registro')
  await page.getByLabel('Número de cédula').fill(cedula)
  await page.getByLabel('Nombres').fill('Prueba')
  await page.getByLabel('Apellidos').fill('Eetoe')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Dirección de residencia').fill('Calle 10 # 20-30, Bogotá')
  await page.getByLabel('Correo personal').fill('prueba.e2e@example.com')
  await page.getByLabel('Teléfono celular').fill('3001234567')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Crea una clave').fill(CLAVE)
  await page.getByRole('button', { name: 'Afiliarme' }).click()
}

test('HU-01 · registro, afiliación e ingreso con la cuenta institucional', async ({ page }) => {
  const cedula = `99${String(Date.now()).slice(-8)}`
  await page.goto('./')
  await page.getByRole('link', { name: 'Crear mi carpeta' }).click()
  await expect(page.getByText('Verificación de identidad simulada')).toBeVisible()
  await sinViolaciones(page, 'registro')
  await llenarRegistro(page, cedula)

  await expect(page.getByRole('heading', { name: 'Ya estás afiliado' })).toBeVisible()
  const cuenta = (await page.getByTestId('cuenta').textContent()).trim()
  expect(cuenta).toBe(`prueba.eetoe.${cedula.slice(-5)}@carpetacolombia.co`)
  await sinViolaciones(page, 'registro completado')

  await page.getByRole('button', { name: 'Ingresar a mi carpeta' }).click()
  await page.locator('#username').fill(cuenta)
  await page.locator('#password').fill(CLAVE)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
})

test('HU-01 · alterno: ya afiliado a otro operador', async ({ page }) => {
  await llenarRegistro(page, '1000000001')
  await expect(page.getByRole('alert')).toContainText('Operador Ciudadano')
  await sinViolaciones(page, 'registro rechazado')
})

test('HU-01 · alterno: cédula inválida no avanza', async ({ page }) => {
  await page.goto('./#registro')
  await page.getByLabel('Número de cédula').fill('12a')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('Escribe entre 6 y 10 números')).toBeVisible()
  await expect(page.getByLabel('Número de cédula')).toBeFocused()
  await sinViolaciones(page, 'cédula inválida')
})
