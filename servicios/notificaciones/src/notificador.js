export const CANALES = ['correo', 'sms']
const DESTINO = { correo: (c) => c.correo, sms: (c) => c.telefono }

const ASUNTO = 'Recibiste un documento en tu carpeta'
const mensaje = (canal, d) => {
  const reemplaza = d.sustituyeA ? ' Reemplaza al documento temporal que habías subido.' : ''
  return canal === 'sms'
    ? `Mi Carpeta Segura: ${d.emisor} te envió «${d.titulo}». Ya está en tu carpeta.${reemplaza}`
    : `Hola. ${d.emisor} emitió «${d.titulo}» y ya está en tu carpeta de Mi Carpeta Segura.${reemplaza}`
}

// contactos y historial: repositorios de MongoDB (src/mongo.js). canales: { correo, sms } → async ({ destino, asunto, texto }), que puede devolver { detalle }.
// Un canal que falla se marca fallido y no se reintenta (ponytail: sin cola de reintentos; en el objetivo, reintento con espera).
export function crearNotificador({ contactos, historial, canales, log = () => {} }) {
  return {
    // Guarda el contacto que MS-03 publicó; no pisa los canales que el ciudadano ya eligió.
    alAfiliar: (d) => contactos.guardarContacto({ cedula: d.cedula, correo: d.correoContacto, telefono: d.telefono }),

    // `id` es el ce_id del evento: repetir la entrega no repite el aviso.
    async alRecibirDocumento({ id, datos }) {
      const c = await contactos.obtener(datos.cedula)
      if (!c) {
        await historial.registrar({ eventoId: id, cedula: datos.cedula, canal: 'ninguno', estado: 'fallido', asunto: ASUNTO, detalle: 'No hay datos de contacto del ciudadano.' })
        log('warn', 'alerta operativa: no hay a dónde avisar al ciudadano', { evento: id })
        return
      }
      let entregados = 0
      for (const canal of c.canales?.length ? c.canales : ['correo']) {
        if (await historial.yaEnviado(id, canal)) { entregados++; continue }
        const base = { eventoId: id, cedula: datos.cedula, canal, asunto: ASUNTO }
        try {
          const destino = DESTINO[canal]?.(c)
          if (!destino) throw new Error('El ciudadano no tiene destino para este canal.')
          const r = await canales[canal]({ destino, asunto: ASUNTO, texto: mensaje(canal, datos) })
          await historial.registrar({ ...base, estado: 'enviado', ...(r?.detalle && { detalle: r.detalle }) })
          entregados++
        } catch (e) {
          await historial.registrar({ ...base, estado: 'fallido', detalle: e.message })
        }
      }
      if (!entregados) log('warn', 'alerta operativa: ningún canal entregó el aviso', { evento: id })
    },
  }
}
