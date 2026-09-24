// Registra en Schema Registry los esquemas de contratos/eventos (uno por sujeto, tipo JSON) y falla si el
// registro rechaza uno por incompatibilidad. Idempotente: registrar el mismo esquema devuelve el mismo id.
import { readdir, readFile } from 'node:fs/promises'

const registro = process.env.SCHEMA_REGISTRY_URL ?? 'http://localhost:8085'
const carpeta = process.argv[2] ?? new URL('../contratos/eventos/', import.meta.url).pathname

for (const archivo of (await readdir(carpeta)).filter((f) => f.endsWith('.schema.json'))) {
  const texto = await readFile(`${carpeta}/${archivo}`, 'utf8')
  const sujeto = JSON.parse(texto)['x-cloudevent'].sujetoRegistro
  const r = await fetch(`${registro}/subjects/${sujeto}/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.schemaregistry.v1+json' },
    body: JSON.stringify({ schemaType: 'JSON', schema: texto }),
  })
  const cuerpo = await r.json()
  if (!r.ok) { console.error(`${sujeto}: ${r.status} ${JSON.stringify(cuerpo)}`); process.exit(1) }
  console.log(JSON.stringify({ nivel: 'info', mensaje: 'esquema registrado', sujeto, id: cuerpo.id }))
}
