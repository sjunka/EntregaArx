// Bitácora de accesos de MS-02 en su propia base MongoDB (RD-11). Solo-append: el repositorio no ofrece cambiar ni
// borrar, y el índice único por evento hace idempotente la entrega al menos una vez del bus.
// ponytail: la inalterabilidad es por interfaz; en el objetivo se suma un usuario de MongoDB con solo insert y find.
const aAcceso = (d) => ({
  id: String(d._id), documentoId: d.documentoId, titulo: d.titulo, accion: d.accion, actor: d.actor, ...(d.destino && { destino: d.destino }), ocurridoEn: d.ocurridoEn.toISOString(),
})

export function crearRepo(db) {
  const col = db.collection('accesos')
  return {
    indices: () => Promise.all([col.createIndex({ eventoId: 1 }, { unique: true }), col.createIndex({ cedula: 1, ocurridoEn: -1 })]),
    async agregar({ eventoId, documentoId, cedula, titulo, accion, actor, destino, ocurridoEn }) {
      try {
        await col.insertOne({ eventoId, documentoId, cedula, titulo, accion, actor, ...(destino && { destino }), ocurridoEn: new Date(ocurridoEn), registradoEn: new Date() })
      } catch (e) {
        if (e.code !== 11000) throw e // 11000: el evento ya estaba registrado
      }
    },
    listar: async (cedula, { limite = 100 } = {}) => (await col.find({ cedula }).sort({ ocurridoEn: -1 }).limit(limite).toArray()).map(aAcceso),
  }
}
