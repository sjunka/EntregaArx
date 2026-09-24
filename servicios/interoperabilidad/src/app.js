import express from 'express'
import { ErrorAutorizaciones } from './autorizaciones.js'
import { ErrorCustodia } from './custodia.js'
import { log, problema } from './comun.js'
import { rutasPeticiones } from './peticiones.js'

const TIPOS = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_ARCHIVO = 10 * 1024 * 1024


export function validarEmision(e = {}) {
  const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  if (!texto(e.emisor, 80) || !texto(e.idExterno, 120)) return 'Faltan el emisor o el identificador del documento en la entidad.'
  if (!/^[0-9]{6,10}$/.test(e.cedula ?? '')) return 'La cédula del titular no es válida.'
  if (!texto(e.titulo, 120)) return 'Falta el título del documento.'
  if (!TIPOS.includes(e.tipo)) return 'Solo se aceptan PDF, JPG o PNG.'
  if (!Number.isInteger(e.tamano) || e.tamano <= 0 || e.tamano > MAX_ARCHIVO) return 'El tamaño declarado no es válido (máximo 10 MB).'
  if (!/^[0-9a-f]{64}$/.test(e.sha256 ?? '')) return 'El SHA-256 declarado no es válido.'
  if (typeof e.firma !== 'string' || !e.firma) return 'Falta la firma del documento.'
  return null
}

// dependencias: custodia (registrar, verificar, leer), autorizaciones (crearPeticion, consultarPeticion), pasarela (consultar),
// bandeja (encolar), firmas (conoce, verificar, verificarFirma, verificarToken), envios ({ ciudadano, publico } de rutasEnvios, HU-08),
// traslados ({ peer, ciudadano } de rutasTraslados, HU-09).
export function crearApp({ custodia, autorizaciones, pasarela, bandeja, firmas, envios, traslados, salida, origenes = [], operador = 'Mi Carpeta Segura' }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  // RI-06: aquí solo entran metadatos y una firma; el archivo sube directo al almacén. Un traslado trae hasta 50 documentos con su URL.
  app.use('/api/transferCitizen', express.json({ limit: '256kb' }))
  app.use(express.json({ limit: '8kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  app.post('/api/documentos', async (req, res, next) => {
    const invalido = validarEmision(req.body)
    if (invalido) return problema(res, 422, 'Emisión inválida', invalido)
    const e = req.body
    if (!firmas.conoce(e.emisor)) return problema(res, 403, 'Entidad no registrada', 'Este operador no tiene una llave registrada para esa entidad.')
    try {
      let afiliacion
      try {
        afiliacion = await pasarela.consultar(e.cedula)
      } catch (err) {
        log('warn', 'centralizador no disponible al recibir un documento', { detalle: err.message })
        return problema(res, 503, 'Centralizador no disponible', 'No podemos confirmar el destinatario ahora. Reintenta en unos minutos.')
      }
      if (!afiliacion.afiliado || afiliacion.operador !== operador) {
        return problema(res, 422, 'Destinatario no afiliado', 'El ciudadano no tiene su carpeta en este operador.')
      }
      const firma = await firmas.verificar(e)
      const { documento, existente, urlCarga } = await custodia.registrar({
        emisor: e.emisor, idExterno: e.idExterno, cedula: e.cedula, titulo: e.titulo, tipo: e.tipo, tamano: e.tamano, sha256: e.sha256,
        firmaValida: firma.valida, ...(firma.valida ? {} : { motivo: firma.motivo }),
      })
      if (documento.estado === 'rechazado') {
        return problema(res, 422, 'Documento rechazado', documento.motivo ?? firma.motivo, { id: documento.id, estado: 'rechazado' })
      }
      res.status(existente ? 200 : 201).json({ id: documento.id, estado: documento.estado, urlCarga })
    } catch (err) { next(err) }
  })

  app.post('/api/documentos/:id/confirmacion', async (req, res, next) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return problema(res, 404, 'Documento no encontrado')
    try {
      const { documento: d, sustituyeA } = await custodia.verificar(req.params.id)
      if (d.estado === 'rechazado') return problema(res, 422, 'Documento rechazado', d.motivo, { id: d.id, estado: 'rechazado' })
      if (d.estado !== 'vigente') return problema(res, 409, 'El documento aún no está vigente')
      // Se encola en cada confirmación de un Vigente: la clave de deduplicación deja un solo evento por documento y
      // repara el caso en que un intento anterior murió después de la custodia y antes de la bandeja.
      await bandeja.encolar('documento.recibido', d.titular, {
        id: d.id, cedula: d.titular, clase: 'certificado', titulo: d.titulo, emisor: d.emisor, recibidoEn: new Date().toISOString(),
        ...(sustituyeA && { sustituyeA }),
      }, { dedupe: `documento.recibido:${d.id}` })
      res.json({ id: d.id, estado: 'vigente', ...(sustituyeA && { sustituyeA }) })
    } catch (err) {
      if (err instanceof ErrorCustodia && [404, 409].includes(err.status)) return problema(res, err.status, err.status === 404 ? 'Documento no encontrado' : 'El archivo aún no llegó', err.message)
      log('warn', 'confirmación no completada', { detalle: err.message })
      problema(res, 503, 'Custodia no disponible', 'No pudimos confirmar el documento ahora. Reintenta en unos minutos.')
    }
  })

  // HU-13: traslado de salida (el ciudadano elige y sigue el avance; el destino confirma). Va antes que /traslados.
  if (salida) {
    app.use('/traslados/salida', salida.ciudadano)
    app.use('/api/transferCitizenConfirm', salida.peer)
  }
  if (traslados) {
    app.use('/api/transferCitizen', traslados.peer)
    app.use('/traslados', traslados.ciudadano)
  }
  if (envios) {
    app.use('/envios', envios.ciudadano)
    app.use('/api/enlaces', envios.publico)
  }
  app.use('/api/peticiones', rutasPeticiones({ firmas, pasarela, autorizaciones, custodia, operador }))

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande', 'Este servicio solo recibe metadatos y la firma: el archivo se sube a la URL de carga.')
    log('error', err.message)
    const cae = err instanceof ErrorCustodia || err instanceof ErrorAutorizaciones
    problema(res, cae ? 503 : 500, cae ? 'Servicio del operador no disponible' : 'Error interno')
  })
  return app
}
