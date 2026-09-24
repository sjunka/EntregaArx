import { useEffect, useState } from 'react'
import { FileText, FolderOpen } from 'lucide-react'
import { listar } from './api.js'
import Aviso from './Aviso.jsx'

// Carpeta del titular: la custodia solo devuelve sus documentos, según el token de la sesión.
export default function Carpeta({ nombre, alVencer }) {
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listar().then(setDocs).catch((e) => (e.status === 401 ? alVencer() : setError(e.message)))
  }, [alVencer])

  return (
    <section aria-labelledby="t-carpeta" className="max-w-[840px]">
      <h1 id="t-carpeta" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Hola, {nombre}</h1>
      <p className="text-lg text-ink-2 mb-6">Esta es tu carpeta. Aquí verás tus documentos y las solicitudes que te lleguen.</p>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tu carpeta">{error}</Aviso>}
      {!docs && !error && <p className="text-ink-2" role="status">Cargando tus documentos…</p>}
      {docs?.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-10 text-center">
          <FolderOpen className="mx-auto text-ink-2" size={24} strokeWidth={1.75} aria-hidden="true" />
          <p className="mt-2 mb-0">Todavía no tienes documentos.</p>
        </div>
      )}
      {docs?.length > 0 && (
        <ul className="list-none p-0 grid gap-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 bg-surface border border-border rounded-lg p-4">
              <FileText className="text-ink-2" size={24} strokeWidth={1.75} aria-hidden="true" />
              <span className="font-semibold">{d.titulo}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
