import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearNotificador, CANALES } from '../src/notificador.js'

// HU-05 · aviso al ciudadano por el canal que elija. RF-05.1, RNF-05.
const DOC = {
  id: '11111111-1111-4111-8111-111111111111', cedula: '1012345678', clase: 'certificado', titulo: 'Diploma de Ingeniería',
  emisor: 'universidad-demo', recibidoEn: '2026-09-24T10:00:00Z',
}
const AFILIADO = { cedula: '1012345678', cuenta: 'ana.gil.45678@carpetacolombia.co', correoContacto: 'ana@correo.co', telefono: '3001234567', afiliadoEn: '2026-09-24T09:00:00Z' }

// Dobles en memoria de los repositorios de MongoDB (src/mongo.js), con el mismo contrato.
function montar({ canalesFallan = [] } = {}) {
  const contactos = new Map()
  const historial = []
  const enviados = []
  const alertas = []
  const repos = {
    contactos: {
      obtener: async (c) => contactos.get(c) ?? null,
      // Inserta con el canal por defecto o actualiza el contacto sin tocar los canales ya elegidos.
      guardarContacto: async ({ cedula, correo, telefono }) => {
        const previo = contactos.get(cedula)
        contactos.set(cedula, { cedula, correo, telefono, canales: previo?.canales ?? ['correo'] })
      },
      guardarCanales: async (c, canales) => { const x = contactos.get(c); if (x) x.canales = canales; return x ?? null },
    },
    historial: {
      yaEnviado: async (eventoId, canal) => historial.some((h) => h.eventoId === eventoId && h.canal === canal && h.estado === 'enviado'),
      registrar: async (h) => { historial.push({ creado: new Date(), ...h }) },
    },
  }
  const enviar = (canal) => async (m) => { if (canalesFallan.includes(canal)) throw new Error(`${canal} caído`); enviados.push({ canal, ...m }) }
  const n = crearNotificador({ ...repos, canales: { correo: enviar('correo'), sms: enviar('sms') }, log: (nivel, mensaje) => { if (nivel === 'warn') alertas.push(mensaje) } })
  return { n, contactos, historial, enviados, alertas }
}

test('al afiliarse guarda el contacto con el correo como canal por defecto y no pisa lo elegido después', async () => {
  const { n, contactos } = montar()
  await n.alAfiliar(AFILIADO)
  assert.deepEqual(contactos.get('1012345678'), { cedula: '1012345678', correo: 'ana@correo.co', telefono: '3001234567', canales: ['correo'] })
  contactos.get('1012345678').canales = ['sms']
  await n.alAfiliar({ ...AFILIADO, correoContacto: 'nuevo@correo.co' })
  assert.deepEqual(contactos.get('1012345678'), { cedula: '1012345678', correo: 'nuevo@correo.co', telefono: '3001234567', canales: ['sms'] })
})

test('documento recibido: avisa por correo al contacto del titular y lo deja en el historial', async () => {
  const { n, enviados, historial } = montar()
  await n.alAfiliar(AFILIADO)
  await n.alRecibirDocumento({ id: 'e-1', datos: DOC })
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].canal, 'correo')
  assert.equal(enviados[0].destino, 'ana@correo.co')
  assert.match(enviados[0].asunto, /documento/i)
  assert.match(enviados[0].texto, /Diploma de Ingeniería/)
  assert.match(enviados[0].texto, /universidad-demo/)
  assert.deepEqual(historial.map((h) => [h.canal, h.estado, h.eventoId, h.cedula]), [['correo', 'enviado', 'e-1', '1012345678']])
})

test('si el ciudadano eligió correo y SMS, avisa por los dos', async () => {
  const { n, enviados, contactos, historial } = montar()
  await n.alAfiliar(AFILIADO)
  contactos.get('1012345678').canales = ['correo', 'sms']
  await n.alRecibirDocumento({ id: 'e-2', datos: { ...DOC, sustituyeA: '22222222-2222-4222-8222-222222222222' } })
  assert.deepEqual(enviados.map((e) => [e.canal, e.destino]), [['correo', 'ana@correo.co'], ['sms', '3001234567']])
  assert.match(enviados[0].texto, /reemplaza/i, 'dice que sustituye al temporal')
  assert.equal(historial.length, 2)
})

test('un evento repetido (entrega al menos una vez) no avisa dos veces', async () => {
  const { n, enviados } = montar()
  await n.alAfiliar(AFILIADO)
  await n.alRecibirDocumento({ id: 'e-3', datos: DOC })
  await n.alRecibirDocumento({ id: 'e-3', datos: DOC })
  assert.equal(enviados.length, 1)
})

test('un canal que falla se marca fallido y el otro sigue', async () => {
  const { n, enviados, contactos, historial, alertas } = montar({ canalesFallan: ['correo'] })
  await n.alAfiliar(AFILIADO)
  contactos.get('1012345678').canales = ['correo', 'sms']
  await n.alRecibirDocumento({ id: 'e-4', datos: DOC })
  assert.deepEqual(enviados.map((e) => e.canal), ['sms'])
  assert.deepEqual(historial.map((h) => [h.canal, h.estado]), [['correo', 'fallido'], ['sms', 'enviado']])
  assert.match(historial[0].detalle, /caído/)
  assert.deepEqual(alertas, [], 'con un canal entregado no hay alerta')
})

test('si todos los canales fallan queda visible en el historial y se levanta una alerta operativa', async () => {
  const { n, historial, alertas } = montar({ canalesFallan: ['correo'] })
  await n.alAfiliar(AFILIADO)
  await n.alRecibirDocumento({ id: 'e-5', datos: DOC })
  assert.deepEqual(historial.map((h) => [h.canal, h.estado]), [['correo', 'fallido']])
  assert.equal(alertas.length, 1)
  assert.match(alertas[0], /alerta operativa/i)
})

test('sin datos de contacto no hay a dónde avisar: queda registrado como fallido y con alerta', async () => {
  const { n, historial, alertas, enviados } = montar()
  await n.alRecibirDocumento({ id: 'e-6', datos: DOC })
  assert.deepEqual(enviados, [])
  assert.deepEqual(historial.map((h) => [h.canal, h.estado, h.cedula]), [['ninguno', 'fallido', '1012345678']])
  assert.match(historial[0].detalle, /contacto/i)
  assert.equal(alertas.length, 1)
})

test('un canal sin destino (por ejemplo SMS sin celular) no se intenta', async () => {
  const { n, enviados, contactos, historial } = montar()
  await n.alAfiliar(AFILIADO)
  Object.assign(contactos.get('1012345678'), { telefono: '', canales: ['correo', 'sms'] })
  await n.alRecibirDocumento({ id: 'e-7', datos: DOC })
  assert.deepEqual(enviados.map((e) => e.canal), ['correo'])
  assert.deepEqual(historial.map((h) => [h.canal, h.estado]), [['correo', 'enviado'], ['sms', 'fallido']])
})

test('CANALES son correo y sms', () => assert.deepEqual(CANALES, ['correo', 'sms']))
