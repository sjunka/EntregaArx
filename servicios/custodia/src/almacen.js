import { createHash } from 'node:crypto'
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Un solo código para MinIO (local) y GCS con HMAC (nube). Las URL prefirmadas se firman con el
// endpoint público, porque el navegador y GovCarpeta no ven la red interna.
export function crearAlmacen({ endpoint, endpointPublico = endpoint, region = 'auto', bucket, accessKeyId, secretAccessKey }) {
  const base = { region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } }
  const interno = new S3Client({ ...base, endpoint })
  const publico = new S3Client({ ...base, endpoint: endpointPublico })

  return {
    urlCarga: (clave, tipo) =>
      getSignedUrl(publico, new PutObjectCommand({ Bucket: bucket, Key: clave, ContentType: tipo }), { expiresIn: 300 }),
    // Lectura de 15 minutos por defecto: la usa GovCarpeta para autenticar (HU-04). `nombre` fuerza la descarga con ese nombre de archivo.
    urlLectura: (clave, { vida = 900, nombre } = {}) =>
      getSignedUrl(publico, new GetObjectCommand({
        Bucket: bucket, Key: clave,
        ...(nombre && { ResponseContentDisposition: `attachment; filename="${nombre.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}` }),
      }), { expiresIn: vida }),
    async cabecera(clave) {
      try {
        const h = await interno.send(new HeadObjectCommand({ Bucket: bucket, Key: clave }))
        return { tamano: h.ContentLength, tipo: h.ContentType }
      } catch (e) {
        if (e.$metadata?.httpStatusCode === 404) return null
        throw e
      }
    },
    async sha256(clave) {
      const { Body } = await interno.send(new GetObjectCommand({ Bucket: bucket, Key: clave }))
      const hash = createHash('sha256')
      for await (const trozo of Body) hash.update(trozo)
      return hash.digest('hex')
    },
    borrar: (clave) => interno.send(new DeleteObjectCommand({ Bucket: bucket, Key: clave })),
  }
}
