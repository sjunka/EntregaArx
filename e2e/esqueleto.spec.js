import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'

const CUENTA = 'andres.perez.45678@carpetacolombia.co'

test('esqueleto · ingreso con PKCE contra el emisor y cierre de sesión', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Tus documentos, en una carpeta que controlas' })).toBeVisible()
  await sinViolaciones(page, 'bienvenida')

  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('heading', { name: 'Ingresa a tu carpeta' })).toBeVisible()
  await sinViolaciones(page, 'formulario de ingreso')
  await page.locator('#username').fill(CUENTA)
  await page.locator('#password').fill(process.env.USUARIO_DEMO_CLAVE)
  await page.locator('#kc-login').click()

  await expect(page.getByRole('heading', { name: 'Hola, Andrés' })).toBeVisible()
  expect(new URL(page.url()).search, 'el código no queda en la barra').toBe('')
  await sinViolaciones(page, 'carpeta')

  await page.getByRole('button', { name: 'Tema oscuro' }).click()
  await sinViolaciones(page, 'carpeta en tema oscuro')

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
})

test('esqueleto · clave errada muestra el motivo sin entrar', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill(CUENTA)
  await page.locator('#password').fill('no-es-la-clave')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('alert')).toContainText('no coinciden')
  await sinViolaciones(page, 'ingreso fallido')
})
