import { test } from 'node:test'
import assert from 'node:assert/strict'
import { procesar } from '../src/consumidor.js'

const mensaje = (extra = {}) => ({
  value: Buffer.from('cuerpo'),
  headers: { ce_id: Buffer.from('e-1'), ce_type: Buffer.from('co.carpetasegura.documento.recibido'), ce_source: Buffer.from('/mcs/interoperabilidad'), ...extra },
})

test('decodifica con Schema Registry y entrega el evento con sus atributos CloudEvents al manejador del tema', async () => {
  const recibidos = []
  await procesar({ topic: 'mcs.documento.recibido', message: mensaje() }, {
    registro: { decode: async (b) => ({ dato: b.toString() }) },
    manejadores: { 'mcs.documento.recibido': async (e) => recibidos.push(e) },
    log: () => {},
  })
  assert.deepEqual(recibidos, [{ id: 'e-1', tipo: 'co.carpetasegura.documento.recibido', fuente: '/mcs/interoperabilidad', datos: { dato: 'cuerpo' } }])
})

test('un mensaje ilegible o sin identificador se omite con aviso, sin detener el consumo', async () => {
  const avisos = []
  const opciones = { registro: { decode: async () => { throw new Error('no cumple el esquema') } }, manejadores: { t: async () => assert.fail('no debe llegar') }, log: (n, m) => avisos.push([n, m]) }
  await procesar({ topic: 't', message: mensaje() }, opciones)
  await procesar({ topic: 't', message: mensaje({ ce_id: undefined }) }, { ...opciones, registro: { decode: async () => ({}) } })
  assert.equal(avisos.length, 2)
  assert.ok(avisos.every(([n]) => n === 'error'))
})

test('si el manejador falla, el error sube para que Kafka reintente el mensaje', async () => {
  await assert.rejects(procesar({ topic: 't', message: mensaje() }, {
    registro: { decode: async () => ({}) }, manejadores: { t: async () => { throw new Error('mongo caído') } }, log: () => {},
  }), /mongo caído/)
})
