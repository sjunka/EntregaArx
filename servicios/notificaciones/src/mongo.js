// Repositorios de MS-09 en su propia base MongoDB (RD-11): contactos y preferencias, e historial de avisos.
export function crearRepos(db) {
  const contactos = db.collection('contactos')
  const avisos = db.collection('notificaciones')
  return {
    indices: () => avisos.createIndex({ eventoId: 1, canal: 1 }, { unique: true }),
    contactos: {
      obtener: async (cedula) => {
        const d = await contactos.findOne({ _id: cedula })
        return d && { cedula: d._id, correo: d.correo, telefono: d.telefono, canales: d.canales }
      },
      // Inserta con el correo como canal por defecto; si ya existe actualiza el contacto y respeta los canales elegidos.
      guardarContacto: ({ cedula, correo, telefono }) => contactos.updateOne(
        { _id: cedula }, { $set: { correo, telefono, actualizado: new Date() }, $setOnInsert: { canales: ['correo'] } }, { upsert: true }),
      guardarCanales: async (cedula, canales) => {
        const d = await contactos.findOneAndUpdate({ _id: cedula }, { $set: { canales, actualizado: new Date() } }, { returnDocument: 'after' })
        return d && { cedula: d._id, correo: d.correo, telefono: d.telefono, canales: d.canales }
      },
    },
    historial: {
      yaEnviado: async (eventoId, canal) => (await avisos.countDocuments({ eventoId, canal, estado: 'enviado' })) > 0,
      registrar: (h) => avisos.replaceOne({ eventoId: h.eventoId, canal: h.canal }, { ...h, creado: new Date() }, { upsert: true }),
      ultimos: (cedula, n = 50) => avisos.find({ cedula }).sort({ creado: -1 }).limit(n).toArray(),
    },
  }
}
