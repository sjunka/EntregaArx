import express from 'express'
import { randomUUID } from 'node:crypto'
import { ErrorPasarela } from './pasarela.js'

export const TIPOS = ['application/pdf', 'image/jpeg', 'image/png']
export const MAX_ARCHIVO = 10 * 1024 * 1024
export const CUOTA = { documentos: 20, bytes: 200 * 1024 * 1024 } // RNF-24

const problema = (res, status, title, detail) =>
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail })

const log = (nivel, mensaje, extra = {}) => console.log(JSON.stringify({ nivel, mensaje, ...extra }))

const aDocumento = (d) => ({
  id: d.id, titulo: d.titulo, clase: d.clase, estado: d.estado, tipo: d.tipo, tamano: d.tamano, sha256: d.sha256 ?? undefined,
  autenticacion: d.autenticacion ?? undefined, emisor: d.emisor ?? undefined, sustituidoPor: d.sustituidoPor ?? undefined,
  motivo: d.estado === 'rechazado' ? d.motivo ?? undefined : undefined, creado: d.creado,
})

const mb = (b) => Math.floor(b / 1048576)

const EXTENSION = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }
const DESCARGABLES = ['cargado', 'sustituido', 'vigente']
export const VIDA_DESCARGA = 60 // segundos: RNF-11, la URL prefirmada dura lo justo para abrirla

export function validarSolicitud({ titulo, tipo, tamano } = {}) {
  if (typeof titulo !== 'string' || !titulo.trim()) return [422, 'Falta el título', 'Escribe un nombre para el documento.']
  if (titulo.length > 120) return [422, 'Título demasiado largo', 'El título admite hasta 120 caracteres.']
  if (!TIPOS.includes(tipo)) return [415, 'Formato no permitido', 'Solo aceptamos PDF, JPG o PNG.']
  if (!Number.isInteger(tamano) || tamano <= 0) return [422, 'Tamaño inválido', 'El archivo está vacío o su tamaño no es válido.']
  if (tamano > MAX_ARCHIVO) return [413, 'Archivo demasiado grande', 'El archivo pesa más de 10 MB. Reduce su tamaño e intenta de nuevo.']
  return null
}

// Validación de lo que la interoperabilidad (MS-07) declara de un Certificado.
export function validarCertificado(c = {}) {
  const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  if (!texto(c.emisor, 80) || !texto(c.idExterno, 120)) return 'Faltan el emisor o el identificador de la entidad.'
  if (!/^[0-9]{6,10}$/.test(c.cedula ?? '')) return 'La cédula del titular no es válida.'
  if (!texto(c.titulo, 120)) return 'Falta el título del documento.'
  if (!TIPOS.includes(c.tipo)) return 'Solo se aceptan PDF, JPG o PNG.'
  if (!Number.isInteger(c.tamano) || c.tamano <= 0 || c.tamano > MAX_ARCHIVO) return 'El tamaño declarado no es válido (máximo 10 MB).'
  if (!/^[0-9a-f]{64}$/.test(c.sha256 ?? '')) return 'El SHA-256 declarado no es válido.'
  if (typeof c.firmaValida !== 'boolean') return 'Falta el resultado de la verificación de la firma.'
  return null
}

// dependencias: documentos (repositorio, src/documentos.js), verificar(token) → claims,
// almacen y almacenCertificados (urlCarga, urlLectura, cabecera, sha256, borrar), pasarela (autenticar).
// Los Certificados van a su propio bucket: en el objetivo con retención bloqueada (ADR-0004).
export function crearApp({ documentos, verificar, almacen, almacenCertificados, pasarela, origenes = [] }) {
  const app = express()
  app.use((req, res, next) => {
    const o = req.headers.origin
    if (o && origenes.includes(o)) {
      res.set({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', vary: 'origin' })
    }
    req.method === 'OPTIONS' ? res.sendStatus(204) : next()
  })
  // RI-06: el binario nunca llega aquí, solo metadatos.
  app.use(express.json({ limit: '2kb' }))

  app.get('/salud', (_req, res) => res.json({ estado: 'ok' }))

  // Firma, emisor, audiencia y vigencia (RNF-11); después cada ruta pide el tipo de cliente que le corresponde.
  app.use(async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return problema(res, 401, 'Sesión requerida', 'Ingresa con tu cuenta institucional.')
    try {
      req.claims = await verificar(token)
      next()
    } catch {
      problema(res, 401, 'Sesión inválida o vencida', 'Vuelve a ingresar.')
    }
  })

  // Servicio a servicio (client credentials): solo la interoperabilidad registra y verifica Certificados.
  const conTitular = (d) => ({ ...aDocumento(d), titular: d.titular }) // la interoperabilidad necesita a quién pertenece
  const interno = express.Router()
  interno.use((req, res, next) => (req.claims.azp === 'interoperabilidad' ? next() : problema(res, 403, 'Solo para servicios del operador')))

  interno.post('/certificados', async (req, res, next) => {
    const invalido = validarCertificado(req.body)
    if (invalido) return problema(res, 422, 'Certificado inválido', invalido)
    try {
      const c = req.body
      const id = randomUUID()
      const { documento, existente } = await documentos.crearCertificado({
        id, titular: c.cedula, titulo: c.titulo.trim(), tipo: c.tipo, tamano: c.tamano, sha256: c.sha256, emisor: c.emisor, idExterno: c.idExterno,
        estado: c.firmaValida ? 'recibido' : 'rechazado', motivo: c.firmaValida ? null : (c.motivo ?? 'La firma no verifica'),
      })
      // Recibido: la entidad sube el archivo directo al bucket de certificados (RI-06). Rechazado: no se emite URL.
      const urlCarga = documento.estado === 'recibido' ? await almacenCertificados.urlCarga(`${documento.titular}/${documento.id}`, documento.tipo) : undefined
      res.status(existente ? 200 : 201).json({ documento: conTitular(documento), existente, urlCarga })
    } catch (e) { next(e) }
  })

  interno.post('/certificados/:id/verificacion', async (req, res, next) => {
    try {
      const d = /^[0-9a-f-]{36}$/.test(req.params.id) ? await documentos.buscar(req.params.id) : null
      if (d?.clase !== 'certificado') return problema(res, 404, 'Certificado no encontrado')
      if (!['recibido', 'verificado'].includes(d.estado)) return res.json({ documento: conTitular(d), cambio: false })
      const clave = `${d.titular}/${d.id}`
      const cab = await almacenCertificados.cabecera(clave)
      if (!cab) return problema(res, 409, 'El archivo aún no llegó', 'Sube el archivo a la URL de carga y vuelve a confirmar.')
      const rechazar = async (motivo) => {
        await almacenCertificados.borrar(clave)
        return res.json({ documento: conTitular(await documentos.rechazar(d.id, motivo)), cambio: false })
      }
      if (cab.tamano !== d.tamano || cab.tipo !== d.tipo) return rechazar('El tamaño o el tipo del archivo no coinciden con lo declarado')
      if ((await almacenCertificados.sha256(clave)) !== d.sha256) return rechazar('El SHA-256 del archivo no coincide con el declarado y firmado')
      if (d.estado === 'recibido') await documentos.marcarVerificado(d.id)
      const activado = await documentos.activarCertificado(d.id)
      if (!activado) return res.json({ documento: conTitular(await documentos.buscar(d.id)), cambio: false }) // otra petición lo activó primero
      res.json({ documento: conTitular(activado.documento), cambio: true, sustituyeA: activado.sustituyeA })
    } catch (e) { next(e) }
  })
  app.use('/interno', interno)

  // Ciudadano con sesión del portal: el resto de las rutas.
  app.use((req, res, next) => {
    if (req.claims.azp !== 'portal' || !req.claims.cedula) return problema(res, 401, 'Token no válido para custodia')
    req.titular = { cedula: req.claims.cedula, cuenta: req.claims.preferred_username }
    next()
  })

  // Documento del titular o 403: ajeno e inexistente responden igual para no revelar qué hay en otras carpetas.
  async function propio(req, res) {
    const d = /^[0-9a-f-]{36}$/.test(req.params.id) ? await documentos.buscar(req.params.id) : null
    if (d?.titular === req.titular.cedula) return d
    problema(res, 403, 'Sin acceso al documento', 'Este documento no está en tu carpeta.')
    return null
  }

  app.get('/documentos', async (req, res, next) => {
    try { res.json((await documentos.listar(req.titular.cedula)).map(aDocumento)) } catch (e) { next(e) }
  })

  app.get('/cuota', async (req, res, next) => {
    try {
      const u = await documentos.uso(req.titular.cedula)
      res.json({ documentos: { usados: u.documentos, maximo: CUOTA.documentos }, bytes: { usados: u.bytes, maximo: CUOTA.bytes } })
    } catch (e) { next(e) }
  })

  app.post('/documentos', async (req, res, next) => {
    const invalido = validarSolicitud(req.body)
    if (invalido) return problema(res, ...invalido)
    try {
      const u = await documentos.uso(req.titular.cedula)
      if (u.documentos >= CUOTA.documentos) {
        return problema(res, 422, 'Carpeta llena', `Tu carpeta admite ${CUOTA.documentos} documentos temporales y ya tienes ${u.documentos}. Elimina alguno para subir otro.`)
      }
      if (u.bytes + req.body.tamano > CUOTA.bytes) {
        return problema(res, 422, 'Carpeta llena', `Tu carpeta admite ${mb(CUOTA.bytes)} MB y te quedan ${mb(CUOTA.bytes - u.bytes)} MB, menos de lo que pesa este archivo.`)
      }
      const id = randomUUID()
      await documentos.crear({ id, titular: req.titular.cedula, titulo: req.body.titulo.trim(), tipo: req.body.tipo, tamano: req.body.tamano })
      res.status(201).json({ id, urlCarga: await almacen.urlCarga(`${req.titular.cedula}/${id}`, req.body.tipo) })
    } catch (e) { next(e) }
  })

  app.post('/documentos/:id/confirmacion', async (req, res, next) => {
    try {
      const d = await propio(req, res)
      if (!d) return
      if (d.estado !== 'pendiente') return res.json(aDocumento(d))
      const clave = `${d.titular}/${d.id}`
      const cab = await almacen.cabecera(clave)
      if (!cab || cab.tamano !== d.tamano || cab.tipo !== d.tipo) {
        if (cab) await almacen.borrar(clave)
        await documentos.descartar(d.id)
        return problema(res, 422, 'El archivo no llegó completo', cab
          ? 'El tamaño o el tipo del archivo subido no coinciden con lo declarado. Vuelve a subirlo.'
          : 'No recibimos el archivo. Vuelve a subirlo.')
      }
      res.json(aDocumento(await documentos.confirmar(d.id, await almacen.sha256(clave))))
    } catch (e) { next(e) }
  })

  // RF-02.7: entrega una URL de lectura de corta vida. Si el almacén no responde no se firma nada ni se registra un
  // acceso que no ocurrió; el documento sigue en la lista y el ciudadano puede reintentar.
  app.get('/documentos/:id/descarga', async (req, res, next) => {
    try {
      const d = await propio(req, res)
      if (!d) return
      if (!DESCARGABLES.includes(d.estado)) return problema(res, 409, 'El documento no está disponible', 'Este documento no está guardado en tu carpeta.')
      const alm = d.clase === 'certificado' ? almacenCertificados : almacen
      const clave = `${d.titular}/${d.id}`
      let cabecera
      try { cabecera = await alm.cabecera(clave) } catch (e) { log('warn', 'almacén no disponible al descargar', { documento: d.id, detalle: e.message }) }
      if (!cabecera) return problema(res, 503, 'El almacén no responde', 'No pudimos preparar la descarga. Tu documento sigue en tu carpeta; intenta de nuevo en unos minutos.')
      await documentos.registrarAcceso(d, { accion: 'descarga', actor: { tipo: 'titular', id: d.titular } })
      const url = await alm.urlLectura(clave, { vida: VIDA_DESCARGA, nombre: `${d.titulo.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').trim()}${EXTENSION[d.tipo] ?? ''}` })
      res.json({ url, venceEn: new Date(Date.now() + VIDA_DESCARGA * 1000).toISOString() })
    } catch (e) { next(e) }
  })

  app.post('/documentos/:id/autenticacion', async (req, res, next) => {
    try {
      const d = await propio(req, res)
      if (!d) return
      if (d.estado !== 'cargado') return problema(res, 409, 'El documento aún no está cargado', 'Termina de subir el archivo antes de autenticarlo.')
      if (d.autenticacion) return res.json(aDocumento(d))
      // RI-01: a GovCarpeta viaja una URL de lectura de 15 minutos, nunca el contenido.
      const url = await almacen.urlLectura(`${d.titular}/${d.id}`)
      let r
      try {
        r = await pasarela.autenticar({ idCiudadano: d.titular, url, titulo: d.titulo })
      } catch (e) {
        log('warn', 'autenticación no completada', { documento: d.id, detalle: e.message })
        if (e instanceof ErrorPasarela && e.status !== 503) return problema(res, 502, 'GovCarpeta no autenticó el documento', e.message)
        return problema(res, 503, 'GovCarpeta no responde', 'No pudimos contactar a GovCarpeta. Tu documento sigue guardado; intenta de nuevo en unos minutos.')
      }
      res.json(aDocumento(await documentos.marcarAutenticado(d.id, r.respuesta)))
    } catch (e) { next(e) }
  })

  // RF-02.10: solo los Temporales se eliminan. Un Certificado se custodia a perpetuidad y sin alteración (RNF-03).
  app.delete('/documentos/:id', async (req, res, next) => {
    try {
      const d = await propio(req, res)
      if (!d) return
      if (d.clase === 'certificado') return problema(res, 409, 'Un certificado no se puede eliminar', 'Los certificados se custodian a perpetuidad y sin alteración.')
      if (!['cargado', 'sustituido'].includes(d.estado)) return problema(res, 409, 'El documento no se puede eliminar', 'Solo se eliminan los documentos temporales guardados en tu carpeta.')
      await almacen.borrar(`${d.titular}/${d.id}`)
      await documentos.eliminar(d.id)
      res.sendStatus(204)
    } catch (e) { next(e) }
  })

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return problema(res, 400, 'JSON inválido')
    if (err.type === 'entity.too.large') return problema(res, 413, 'Cuerpo demasiado grande', 'La custodia solo recibe metadatos: el archivo se sube directo al almacén con la URL prefirmada.')
    log('error', err.message)
    problema(res, 500, 'Error interno')
  })
  return app
}
