// Índice de carpeta de MS-05 en su propia base MongoDB (RD-11): una proyección de solo lectura de los eventos de
// documento. Cada manejador es idempotente y tolera que los eventos de temas distintos lleguen en otro orden.
export const normalizar = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const aDocumento = (d) => ({
  id: d._id, titulo: d.titulo, clase: d.clase, estado: d.estado ?? (d.clase === 'certificado' ? 'vigente' : 'cargado'), tipo: d.tipo, tamano: d.tamano,
  emisor: d.emisor, sustituidoPor: d.sustituidoPor, creado: d.creado.toISOString(),
  ...(d.autenticadoEn && { autenticacion: { fecha: d.autenticadoEn.toISOString() } }),
})

export function crearRepo(db) {
  const col = db.collection('carpeta')
  const poner = (id, $set) => col.updateOne({ _id: id }, { $set }, { upsert: true })
  return {
    indices: () => col.createIndex({ cedula: 1, creado: -1 }),
    // Sin `estado` el documento está Cargado (Temporal) o Vigente (Certificado): solo `sustituido` y `eliminado` lo cambian,
    // y esos eventos pueden llegar antes que el de carga. Un documento sin título aún no recibió su evento base: no se muestra.
    cargado: (d) => poner(d.id, {
      cedula: d.cedula, clase: d.clase, titulo: d.titulo, tituloNorm: normalizar(d.titulo), tipo: d.tipo, tamano: d.tamano,
      creado: new Date(d.creadoEn), ...(d.emisor && { emisor: d.emisor }),
    }),
    autenticado: (d) => poner(d.id, { cedula: d.cedula, autenticadoEn: new Date(d.autenticadoEn) }),
    eliminado: (d) => poner(d.id, { cedula: d.cedula, estado: 'eliminado' }),
    // HU-13: el ciudadano se trasladó a otro operador; sus documentos ya no se custodian aquí.
    // ponytail: un grupo de consumidores nuevo (replay desde el inicio) puede reproyectar lo anterior al traslado; agregar una lápida con fecha si se reinicia el grupo.
    trasladado: (d) => col.deleteMany({ cedula: d.cedula }),
    async recibido(d) {
      await poner(d.id, { cedula: d.cedula, clase: 'certificado', titulo: d.titulo, tituloNorm: normalizar(d.titulo), emisor: d.emisor, creado: new Date(d.recibidoEn) })
      if (d.sustituyeA) await poner(d.sustituyeA, { cedula: d.cedula, estado: 'sustituido', sustituidoPor: d.id })
    },
    async listar(cedula, { q, clase, desde, hasta } = {}) {
      const filtro = { cedula, titulo: { $exists: true }, estado: { $ne: 'eliminado' } }
      if (q) filtro.tituloNorm = { $regex: escapar(normalizar(q)) }
      if (clase) filtro.clase = clase
      if (desde || hasta) {
        filtro.creado = {
          ...(desde && { $gte: new Date(`${desde}T00:00:00-05:00`) }), // día de Colombia (UTC-5, sin horario de verano)
          ...(hasta && { $lt: new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000) }),
        }
      }
      return (await col.find(filtro).sort({ creado: -1 }).limit(200).toArray()).map(aDocumento)
    },
  }
}
