import { expect } from '@playwright/test'

export const AFILIACION = process.env.AFILIACION_URL ?? 'http://localhost:8082'
export const CUSTODIA = process.env.CUSTODIA_URL ?? 'http://localhost:8083'
export const NOTIFICACIONES = process.env.NOTIFICACIONES_URL ?? 'http://localhost:8087'
export const INDICE = process.env.INDICE_URL ?? 'http://localhost:8091'
export const AUDITORIA = process.env.AUDITORIA_URL ?? 'http://localhost:8092'
export const ENTIDAD = process.env.ENTIDAD_URL ?? 'http://localhost:8088'
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
export const CLAVE = 'clave-de-prueba-e2e-2026'

// Afilia a un ciudadano nuevo por la API real (el doble de GovCarpeta de compose recibe el alta).
export async function afiliar(request) {
  const cedula = `98${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`
  const r = await request.post(`${AFILIACION}/ciudadanos`, {
    data: { cedula, nombre: 'Prueba', apellido: 'Eetoe', direccion: 'Calle 10 # 20-30, Bogotá', correoContacto: `prueba.${cedula}@example.com`, telefono: '3001234567', clave: CLAVE },
  })
  expect(r.status(), await r.text()).toBe(201)
  return { cedula, cuenta: (await r.json()).cuenta, correo: `prueba.${cedula}@example.com` }
}

export async function ingresar(page, cuenta, clave = CLAVE) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill(cuenta)
  await page.locator('#password').fill(clave)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'Hola, Prueba' })).toBeVisible()
}

// Token de acceso de la sesión de la SPA, para llamar a los servicios como el portal.
export const tokenDe = (page) => page.evaluate(() => {
  const k = Object.keys(window.sessionStorage).find((x) => x.startsWith('oidc.user'))
  return JSON.parse(window.sessionStorage.getItem(k)).access_token
})

export const conToken = (token) => ({ authorization: `Bearer ${token}` })
