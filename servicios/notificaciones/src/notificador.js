export const CANALES = ['correo', 'sms']
const DESTINO = { correo: (c) => c.correo, sms: (c) => c.telefono }

const ASUNTO = 'Recibiste un documento en tu carpeta'
const mensaje = (canal, d) => {
  const reemplaza = d.sustituyeA ? ' Reemplaza al documento temporal que habías subido.' : ''
  return canal === 'sms'
    ? `Mi Carpeta Segura: ${d.emisor} te envió «${d.titulo}». Ya está en tu carpeta.${reemplaza}`
    : `Hola. ${d.emisor} emitió «${d.titulo}» y ya está en tu carpeta de Mi Carpeta Segura.${reemplaza}`
}

const ASUNTO_ENVIO = 'Entregamos tus documentos'
const mensajeEnvio = (canal, d) => {
  const n = d.documentos.length
  return canal === 'sms'
    ? `Mi Carpeta Segura: entregamos ${n === 1 ? '1 documento' : `${n} documentos`} a ${d.correo}.`
    : `Hola. Entregamos por correo a ${d.correo} los enlaces temporales de ${n === 1 ? 'este documento' : 'estos documentos'}: ${d.documentos.map((x) => `«${x.titulo}»`).join(', ')}. Los enlaces vencen a las 72 horas y puedes retirar la autorización cuando quieras.`
}

// contactos y historial: repositorios de MongoDB (src/mongo.js). canales: { correo, sms } → async ({ destino, asunto, texto }), que puede devolver { detalle }.
// Un canal que falla se marca fallido y no se reintenta (ponytail: sin cola de reintentos; en el objetivo, reintento con espera).
export function crearNotificador({ contactos, historial, canales, log = () => {} }) {
  // `eventoId` es el ce_id del evento: repetir la entrega no repite el aviso. Avisa por cada canal que el ciudadano eligió.
  async function avisar({ eventoId, cedula, asunto, texto }) {
    const c = await contactos.obtener(cedula)
    if (!c) {
      await historial.registrar({ eventoId, cedula, canal: 'ninguno', estado: 'fallido', asunto, detalle: 'No hay datos de contacto del ciudadano.' })
      log('warn', 'alerta operativa: no hay a dónde avisar al ciudadano', { evento: eventoId })
      return
    }
    let entregados = 0
    for (const canal of c.canales?.length ? c.canales : ['correo']) {
      if (await historial.yaEnviado(eventoId, canal)) { entregados++; continue }
      const base = { eventoId, cedula, canal, asunto }
      try {
        const destino = DESTINO[canal]?.(c)
        if (!destino) throw new Error('El ciudadano no tiene destino para este canal.')
        const r = await canales[canal]({ destino, asunto, texto: texto(canal) })
        await historial.registrar({ ...base, estado: 'enviado', ...(r?.detalle && { detalle: r.detalle }) })
        entregados++
      } catch (e) {
        await historial.registrar({ ...base, estado: 'fallido', detalle: e.message })
      }
    }
    if (!entregados) log('warn', 'alerta operativa: ningún canal entregó el aviso', { evento: eventoId })
  }

  return {
    // Guarda el contacto que MS-03 publicó; no pisa los canales que el ciudadano ya eligió.
    alAfiliar: (d) => contactos.guardarContacto({ cedula: d.cedula, correo: d.correoContacto, telefono: d.telefono }),

    alRecibirDocumento: ({ id, datos }) => avisar({ eventoId: id, cedula: datos.cedula, asunto: ASUNTO, texto: (canal) => mensaje(canal, datos) }),

    // HU-08: confirmación de entrega del envío a la entidad. El aviso no lleva los enlaces: eso es de quien los recibe.
    alEntregarEnvio: ({ id, datos }) => avisar({ eventoId: id, cedula: datos.cedula, asunto: ASUNTO_ENVIO, texto: (canal) => mensajeEnvio(canal, datos) }),
  }
}
