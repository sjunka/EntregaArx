import { test, expect } from '@playwright/test'
import { sinViolaciones } from './axe.js'
import { AFILIACION, CLAVE, NOTIFICACIONES, ORIGEN, GOVCARPETA, cedulaNueva, conToken, tokenDe } from './ciudadano.js'

// HU-09 · Traslado de entrada. RF-01.8, RF-03.3, RF-03.5, RF-03.8, RI-03, RNF-22.
// El operador de origen simulado (infra/operador-origen) da de baja al ciudadano en GovCarpeta, firma transferCitizen y sirve los documentos.
const trasladar = async (request, datos) => (await request.post(`${ORIGEN}/trasladar`, { data: datos, timeout: 60_000 })).json()
const estadoOrigen = async (request, cedula) => (await request.get(`${ORIGEN}/estado/${cedula}`)).json()
const CLAVE_NUEVA = 'clave-del-trasladado-2026'

test('HU-09 · el ciudadano activa su cuenta, ve el avance y GovCarpeta solo cambia cuando la Carpeta está completa', async ({ page, request }) => {
  test.setTimeout(120_000)
  const cedula = cedulaNueva()
  const t = await trasladar(request, {
    cedula, documentos: [
      { titulo: 'Cédula de ciudadanía', demoraMs: 3000 },
      { titulo: 'Diploma de bachiller', clase: 'certificado', emisor: 'universidad-original', demoraMs: 3000 },
      { titulo: 'Recibo de servicios', fallas: 1 }, // el origen falla una vez: se reintenta sin duplicar
    ],
  })
  expect(t.status).toBe(202)
  expect(t.cuerpo).toMatchObject({ estado: 'en-curso', total: 3, recibidos: expect.any(Number) })
  expect(t.cuerpo.activacion).toMatch(/^http:\/\/localhost:4173\/#activar\/[0-9a-f-]{36}\.[\w-]{32}$/)
  const cuenta = t.correo

  // Durante el traslado el ciudadano no está afiliado a ningún operador (RI-03): el origen ya lo dio de baja y aquí aún no lo registran.
  expect((await estadoOrigen(request, cedula)).centralizador.status).toBe(204)

  // Enlace de activación: elige su clave.
  await page.goto(t.cuerpo.activacion)
  await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible()
  await sinViolaciones(page, 'activación de la cuenta trasladada')
  await page.getByLabel('Clave nueva').fill('corta')
  await page.getByLabel('Repite la clave').fill('corta')
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click()
  await expect(page.getByRole('alert')).toContainText('entre 12 y 64 caracteres')
  await page.getByLabel('Clave nueva').fill(CLAVE_NUEVA)
  await page.getByLabel('Repite la clave').fill('otra-clave-distinta')
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click()
  await expect(page.getByRole('alert')).toContainText('no coinciden')
  await page.getByLabel('Repite la clave').fill(CLAVE_NUEVA)
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click()
  await expect(page.getByText('Tu cuenta quedó activa')).toBeVisible()
  await page.getByRole('region', { name: 'Activa tu cuenta' }).getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.locator('#username')).toHaveValue(cuenta)
  await page.locator('#password').fill(CLAVE_NUEVA)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible()

  // El ciudadano ve el avance hasta completar.
  await expect(page.getByRole('heading', { name: 'Estamos trasladando tu carpeta' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/recibimos \d de 3 documentos/)).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Avance del traslado' })).toBeVisible()
  await sinViolaciones(page, 'carpeta con el avance del traslado')
  expect((await estadoOrigen(request, cedula)).centralizador.status, 'antes de completar, GovCarpeta no lo tiene aquí').toBe(204)

  await expect(page.getByText('Tu carpeta llegó completa')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('Trasladamos 3 documentos desde operador-origen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cédula de ciudadanía' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Diploma de bachiller' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recibo de servicios' })).toHaveCount(1, { timeout: 20_000 }) // una sola vez pese al fallo
  await expect(page.getByText('Certificado · Vigente · emitido por universidad-original')).toBeVisible()
  await expect(page.getByText('Temporal · sin autenticar')).toHaveCount(2)
  await expect(page.getByTestId('cuota')).toContainText('Te quedan 20 de 20 documentos') // el traslado no consume la cuota
  await sinViolaciones(page, 'carpeta con el traslado completo')

  // Solo con la Carpeta completa cambió la afiliación, el origen recibió la confirmación 1 y ya no conserva la copia.
  const origen = await estadoOrigen(request, cedula)
  expect(origen.centralizador.texto).toContain('Mi Carpeta Segura')
  expect(origen.confirmaciones.map((c) => c.req_status)).toEqual([1])
  expect(origen.documentosEnOrigen).toBe(0)

  // El ciudadano ya es un afiliado más: su contacto llegó a Notificaciones por el evento ciudadano.afiliado.
  const token = await tokenDe(page)
  await expect.poll(async () => (await request.get(`${NOTIFICACIONES}/preferencias`, { headers: conToken(token) })).status(), { timeout: 30_000 }).toBe(200)

  // El enlace de activación sirvió una sola vez.
  const otra = await request.post(`${AFILIACION}/traslados/activacion`, { data: { token: t.cuerpo.activacion.split('#activar/')[1], clave: 'otra-clave-de-12-o-mas' } })
  expect(otra.status()).toBe(409)
  expect(otra.headers()['content-type']).toContain('application/problem+json')
})

test('HU-09 · alterno: si un documento no llega tras los reintentos el origen recibe req_status 0, conserva la carpeta y aquí no queda nada', async ({ request }) => {
  test.setTimeout(120_000)
  const cedula = cedulaNueva()
  const t = await trasladar(request, { cedula, documentos: [{ titulo: 'Cédula de ciudadanía' }, { titulo: 'Diploma inexistente', noExiste: true }] })
  expect(t.status).toBe(202)
  const token = t.cuerpo.activacion.split('#activar/')[1]

  await expect.poll(async () => (await estadoOrigen(request, cedula)).confirmaciones.map((c) => c.req_status), { timeout: 90_000 }).toEqual([0])
  const origen = await estadoOrigen(request, cedula)
  expect(origen.documentosEnOrigen, 'el origen conserva la carpeta').toBe(2)
  expect(origen.centralizador.texto, 'el ciudadano vuelve a su operador').toContain('Operador Origen')
  // La cuenta creada aquí se canceló: el enlace de activación ya no existe.
  const activar = await request.post(`${AFILIACION}/traslados/activacion`, { data: { token, clave: CLAVE_NUEVA } })
  expect(activar.status()).toBe(404)
})

test('HU-09 · el traslado exige firma del operador y que el origen haya dado de baja al ciudadano (nunca dos operadores a la vez)', async ({ request }) => {
  const invalida = await trasladar(request, { cedula: cedulaNueva(), firmaInvalida: true })
  expect(invalida.status).toBe(401)
  expect(invalida.cuerpo.title).toBe('Firma no válida')
  const sinBaja = await trasladar(request, { cedula: cedulaNueva(), sinBaja: true })
  expect(sinBaja.status).toBe(409)
  expect(sinBaja.cuerpo.title).toBe('Sigue afiliado a otro operador')
  expect(sinBaja.cuerpo.detail).toContain('nunca dos operadores')
  const alterado = await request.post(`http://localhost:8086/api/transferCitizen`, { data: { operador: 'operador-desconocido' } })
  expect(alterado.status()).toBe(422)
  expect(alterado.headers()['content-type']).toContain('application/problem+json')
})
