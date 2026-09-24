// HU-08: un envío entregado deja un registro en la bitácora por cada documento enviado (RF-04.2). El actor es el
// titular que envió y `destino` el correo de la entidad; el id de evento se deriva del `ce_id` y del documento para que
// repetir la entrega del bus no duplique los registros.
export const registrosDeEnvio = ({ id, datos }) => datos.documentos.map((d) => ({
  eventoId: `${id}:${d.id}`, documentoId: d.id, cedula: datos.cedula, titulo: d.titulo, accion: 'envio',
  actor: { tipo: 'titular', id: datos.cedula }, destino: `correo:${datos.correo}`, ocurridoEn: datos.entregadoEn,
}))
