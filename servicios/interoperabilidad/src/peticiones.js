import express from 'express'
import { ErrorAutorizaciones } from './autorizaciones.js'
import { ErrorCustodia } from './custodia.js'
import { UUID, log, problema, texto } from './comun.js'

export function validarPeticion(p = {}) {
  if (!texto(p.emisor, 80) || !texto(p.idExterno, 120)) return 'Faltan la entidad o el identificador de la petición.'
  if (!/^[0-9]{6,10}$/.test(p.cedula ?? '')) return 'La cédula del titular no es válida.'
  if (!texto(p.proposito, 200)) return 'Falta el propósito de la petición (hasta 200 caracteres).'
  if (!Array.isArray(p.documentos) || !p.documentos.length || p.documentos.length > 10) return 'La petición debe pedir entre 1 y 10 documentos.'
  if (!p.documentos.every((d) => texto(d?.titulo, 120))) return 'Cada documento pedido necesita un título (hasta 120 caracteres).'
  if (typeof p.firma !== 'string' || !p.firma) return 'Falta la firma de la petición.'
  return null
}

// HU-07: la entidad pide documentos al ciudadano (RF-04.3) y, cuando este autoriza, los recibe como URL de corta vida.
// MS-07 no guarda la petición ni el consentimiento: eso es de MS-06. Tampoco firma URL: la custodia lo hace después de que
// MS-06 decide (RI-08).
export function rutasPeticiones({ firmas, pasarela, autorizaciones, custodia, operador }) {
  const r = express.Router()

  // La entidad se autentica firmando, como en HU-05: el JWS repite los campos y los títulos pedidos.
  r.post('/', async (req, res, next) => {
    const invalido = validarPeticion(req.body)
    if (invalido) return problema(res, 422, 'Petición inválida', invalido)
    const p = req.body
    if (!firmas.conoce(p.emisor)) return problema(res, 403, 'Entidad no registrada', 'Este operador no tiene una llave registrada para esa entidad.')
    try {
      const firma = await firmas.verificarFirma(p.emisor, p.firma, {
        idExterno: p.idExterno, cedula: p.cedula, proposito: p.proposito, pedidos: p.documentos.map((d) => d.titulo),
      })
      if (!firma.valida) return problema(res, 401, 'Firma no válida', firma.motivo)
      let afiliacion
      try {
        afiliacion = await pasarela.consultar(p.cedula)
      } catch (err) {
        log('warn', 'centralizador no disponible al recibir una petición', { detalle: err.message })
        return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar el destinatario ahora. Reintenta en unos minutos.')
      }
      if (!afiliacion.afiliado || afiliacion.operador !== operador) return problema(res, 422, 'Destinatario no afiliado', 'El ciudadano no tiene su carpeta en este operador.')
      const { id, estado, existente } = await autorizaciones.crearPeticion({
        entidad: p.emisor, idExterno: p.idExterno, cedula: p.cedula, proposito: p.proposito.trim(), pedidos: p.documentos.map((d) => ({ titulo: d.titulo.trim() })),
      })
      res.status(existente ? 200 : 201).json({ id, estado })
    } catch (err) { next(err) }
  })

  // La entidad consulta su petición con un JWS de vida corta. Recibe el estado y, si el ciudadano autorizó, solo esos
  // documentos; cada URL la firma la custodia tras la decisión de MS-06 y queda en la bitácora de accesos.
  r.get('/:id', async (req, res, next) => {
    const entidad = await firmas.verificarToken(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    if (!entidad) return problema(res, 401, 'Autenticación de la entidad requerida', 'Envía un JWS de vida corta (máximo 5 minutos) firmado con la llave registrada de la entidad.')
    if (!UUID.test(req.params.id)) return problema(res, 404, 'Petición no encontrada')
    try {
      let peticion
      try { peticion = await autorizaciones.consultarPeticion(req.params.id, entidad) } catch (err) {
        if (err instanceof ErrorAutorizaciones && err.status === 404) return problema(res, 404, 'Petición no encontrada')
        throw err
      }
      const documentos = []
      for (const a of peticion.autorizaciones) {
        try {
          const l = await custodia.leer({ documentoId: a.documentoId, tercero: `entidad:${entidad}` })
          documentos.push({ id: a.documentoId, titulo: l.titulo, url: l.url, venceEn: l.venceEn })
        } catch (err) {
          // Revocada o retirada entre la consulta y la lectura: ya no se entrega. Cualquier otro fallo detiene la respuesta.
          if (!(err instanceof ErrorCustodia && [403, 404].includes(err.status))) throw err
        }
      }
      res.json({ id: peticion.id, estado: peticion.estado, documentos })
    } catch (err) { next(err) }
  })
  return r
}
