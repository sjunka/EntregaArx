import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { sinViolaciones } from './axe.js'
import { afiliar, ingresar, tokenDe, conToken, ENTIDAD } from './ciudadano.js'

// HU-12 · Analítica anonimizada. RF-08.1 solo metadatos, RF-08.2 sin identidad, RF-08.6 tablero, RNF-15 privacidad.
const ANALITICA = process.env.ANALITICA_URL ?? 'http://localhost:8096'
const RAIZ = new URL('..', import.meta.url).pathname
const UMBRAL = 10

async function ingresarAnalista(page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill('analista@mintic.carpetacolombia.co')
  await page.locator('#password').fill(process.env.USUARIO_DEMO_CLAVE)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'Diplomas emitidos por región', level: 1 })).toBeVisible()
}

const celdaBogota = (page) => page.getByRole('row', { name: /Bogotá D\.C\./ })

test('HU-12 · el analista ve diplomas por región con datos anonimizados y el ciudadano no accede', async ({ page, browser, request }) => {
  test.setTimeout(180_000)
  // Diez ciudadanos reciben un Certificado de la universidad: la celda de Bogotá D.C. alcanza el umbral de anonimato.
  const cedulas = []
  let primero
  for (let i = 0; i < UMBRAL; i++) {
    const a = await afiliar(request)
    cedulas.push(a.cedula)
    primero ??= a
    const emision = await (await request.post(`${ENTIDAD}/emitir`, { data: { cedula: a.cedula, titulo: `Diploma de pregrado ${i}` } })).json()
    expect(emision.confirmacion.status).toBe(200)
  }

  await ingresarAnalista(page)
  await expect(async () => {
    await page.getByRole('button', { name: 'Consultar' }).click()
    const n = Number((await celdaBogota(page).getByRole('cell').textContent({ timeout: 1500 })).replace(/\D/g, ''))
    expect(n).toBeGreaterThanOrEqual(UMBRAL)
  }).toPass({ timeout: 40_000 })
  await expect(page.getByText(/Datos al /)).toBeVisible()
  await sinViolaciones(page, 'tablero de diplomas por región')

  // Filtros: un año sin datos y una región sin datos no traen filas.
  await page.getByLabel('Año').selectOption(String(new Date().getFullYear()))
  await page.getByRole('button', { name: 'Consultar' }).click()
  await expect(celdaBogota(page)).toBeVisible()
  const headers = conToken(await tokenDe(page))
  const vacio = await (await request.get(`${ANALITICA}/tableros/diplomas?anio=2001`, { headers })).json()
  expect(vacio.regiones).toEqual([])
  await sinViolaciones(page, 'tablero filtrado por año')

  // Nada que identifique a un ciudadano: ni en la respuesta ni en lo que MS-10 guarda.
  const tablero = JSON.stringify(await (await request.get(`${ANALITICA}/tableros/diplomas`, { headers })).json())
  const guardado = execSync(`docker compose exec -T mongo mongosh --quiet analitica --eval 'JSON.stringify(db.diplomas.find().toArray())'`, { cwd: RAIZ }).toString()
  for (const cedula of cedulas) {
    expect(tablero).not.toContain(cedula)
    expect(guardado).not.toContain(cedula)
  }
  expect(guardado).not.toContain('Diploma de pregrado')
  expect(await (await request.put(`${ANALITICA}/tableros/diplomas`, { headers })).status()).toBe(404)

  // El ciudadano no entra a la analítica: su token no lleva esa audiencia; sin sesión tampoco.
  const p2 = await (await browser.newContext()).newPage()
  await ingresar(p2, primero.cuenta)
  expect((await request.get(`${ANALITICA}/tableros/diplomas`, { headers: conToken(await tokenDe(p2)) })).status()).toBe(401)
  expect((await request.get(`${ANALITICA}/tableros/diplomas`)).status()).toBe(401)
})
