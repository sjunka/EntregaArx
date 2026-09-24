import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import { crearRepos } from '../src/mongo.js'

// HU-13: al confirmarse el Traslado de salida, MS-09 borra el contacto y los avisos del ciudadano. Contra un MongoDB real:
// MONGO_URL_TEST=mongodb://localhost:27018 npm test (se omite sin él).
const url = process.env.MONGO_URL_TEST

test('borrar quita el contacto, las preferencias y el historial del ciudadano, y solo los suyos', { skip: !url }, async () => {
  const cliente = await new MongoClient(url).connect()
  try {
    const db = cliente.db('notificaciones_test')
    await db.dropDatabase()
    const repos = crearRepos(db)
    await repos.indices()
    for (const cedula of ['1012345678', '2000000002']) {
      await repos.contactos.guardarContacto({ cedula, correo: `${cedula}@correo.co`, telefono: '3001234567' })
      await repos.historial.registrar({ eventoId: `e-${cedula}`, cedula, canal: 'correo', estado: 'enviado', asunto: 'Aviso' })
    }
    await repos.contactos.borrar('1012345678')
    await repos.contactos.borrar('1012345678')
    assert.equal(await repos.contactos.obtener('1012345678'), null)
    assert.deepEqual(await repos.historial.ultimos('1012345678'), [])
    assert.equal((await repos.contactos.obtener('2000000002')).correo, '2000000002@correo.co')
    assert.equal((await repos.historial.ultimos('2000000002')).length, 1)
    await db.dropDatabase()
  } finally { await cliente.close() }
})
