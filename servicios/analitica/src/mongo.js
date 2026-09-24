// Almacén analítico de MS-10 en su propia base MongoDB, aparte de la operacional (RD-11, RF-08). Solo guarda metadatos
// anonimizados. El índice único por `h` hace idempotente la entrega al menos una vez del bus. Sin operación de cambio ni borrado.
export function crearRepo(db) {
  const col = db.collection('diplomas')
  return {
    indices: () => Promise.all([col.createIndex({ h: 1 }, { unique: true }), col.createIndex({ anio: 1, region: 1 })]),
    async agregar(registro) {
      try {
        await col.insertOne({ ...registro, registradoEn: new Date() })
      } catch (e) {
        if (e.code !== 11000) throw e // 11000: el evento ya estaba consolidado
      }
    },
    async celdas({ anio, region } = {}) {
      const filtro = { ...(anio && { anio }), ...(region && { region }) }
      return (await col.aggregate([{ $match: filtro }, { $group: { _id: '$region', total: { $sum: 1 } } }]).toArray()).map((c) => ({ region: c._id, total: c.total }))
    },
    anios: async () => (await col.distinct('anio')).sort((a, b) => a - b),
    corte: async () => (await col.find().sort({ registradoEn: -1 }).limit(1).next())?.registradoEn ?? null,
  }
}
