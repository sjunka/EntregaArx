// Smoke contra las URL públicas del despliegue en GCP (ADR-0015). No corre en local: exige SMOKE_URLS.
// Uso: SMOKE_URLS="$(terraform -chdir=infra/terraform output -json urls)" \
//      BASE_URL=https://usuario.github.io/repo/ USUARIO_DEMO_CLAVE=$(terraform -chdir=infra/terraform output -raw usuario_demo_clave) npx playwright test smoke-gcp
import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'

const urls = JSON.parse(process.env.SMOKE_URLS ?? '{}')
test.skip(!process.env.SMOKE_URLS, 'define SMOKE_URLS con `terraform output -json urls`')
if (process.env.SMOKE_URLS && !process.env.USUARIO_DEMO_CLAVE) throw new Error('define USUARIO_DEMO_CLAVE (terraform output -raw usuario_demo_clave)')

const SERVICIOS = ['pasarela', 'afiliacion', 'autorizaciones', 'premium', 'custodia', 'interoperabilidad', 'notificaciones', 'indice', 'auditoria', 'analitica']

for (const s of SERVICIOS) {
  test(`${s} responde /salud por su URL pública`, async ({ request }) => {
    const r = await request.get(`${urls[s]}/salud`)
    expect(r.status()).toBe(200)
  })
}

test('Keycloak publica el realm «carpeta» con PKCE S256', async ({ request }) => {
  const d = await (await request.get(`${urls.emisor}/.well-known/openid-configuration`)).json()
  expect(d.issuer).toBe(urls.emisor)
  expect(d.code_challenge_methods_supported).toContain('S256')
})

test('la SPA carga, es accesible y el ciudadano de demostración ingresa con Keycloak', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
  await sinViolaciones(page, 'SPA publicada')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill('andres.perez.45678@carpetacolombia.co')
  await page.locator('#password').fill(process.env.USUARIO_DEMO_CLAVE)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'Hola, Andrés' })).toBeVisible()
})
