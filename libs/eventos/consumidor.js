const cabecera = (m, nombre) => m.headers?.[nombre]?.toString()

// Un mensaje: decodifica la data con Schema Registry y llama al manejador del tema. Lo ilegible se omite con aviso
// (reintentarlo no lo arreglaría); si el manejador falla el error sube y Kafka reintenta el mensaje.
export async function procesar({ topic, message }, { registro, manejadores, log }) {
  const id = cabecera(message, 'ce_id')
  let datos
  try {
    if (!id) throw new Error('falta ce_id')
    datos = await registro.decode(message.value)
  } catch (e) {
    log('error', 'evento ilegible; se omite', { topic, detalle: e.message })
    return
  }
  await manejadores[topic]({ id, tipo: cabecera(message, 'ce_type'), fuente: cabecera(message, 'ce_source'), datos })
}

// Los temas se crean si faltan (el consumidor puede arrancar antes que el productor) y se lee desde el inicio:
// un evento publicado antes de que el grupo exista no se pierde. Los manejadores deben ser idempotentes.
export async function iniciarConsumidor({ kafka, registro, grupo, manejadores, log }) {
  const temas = Object.keys(manejadores)
  const admin = kafka.admin()
  await admin.connect()
  await admin.createTopics({ topics: temas.map((topic) => ({ topic, numPartitions: 1 })), waitForLeaders: true })
  await admin.disconnect()
  const consumidor = kafka.consumer({ groupId: grupo })
  await consumidor.connect()
  for (const topic of temas) await consumidor.subscribe({ topic, fromBeginning: true })
  await consumidor.run({ eachMessage: (m) => procesar(m, { registro, manejadores, log }) })
  return () => consumidor.disconnect()
}
