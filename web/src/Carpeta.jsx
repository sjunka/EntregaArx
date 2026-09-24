import { useEffect, useState } from 'react'
import { BadgeCheck, FilePlus2, FileText, FolderOpen } from 'lucide-react'
import { autenticar, cuota as pedirCuota, listar } from './api.js'
import Aviso from './Aviso.jsx'
import Estado from './Estado.jsx'

const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`)
const mb = (b) => Math.floor(b / 1048576)

// Carpeta del titular: la custodia solo devuelve sus documentos, según el token de la sesión.
export default function Carpeta({ nombre, alVencer }) {
  const [docs, setDocs] = useState(null)
  const [cuota, setCuota] = useState(null)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [fallo, setFallo] = useState(null)

  async function pedirAutenticacion(d) {
    setEnviando(d.id)
    setFallo(null)
    try {
      const nuevo = await autenticar(d.id)
      setDocs((l) => l.map((x) => (x.id === d.id ? nuevo : x)))
    } catch (e) {
      if (e.status === 401) return alVencer()
      setFallo({ id: d.id, mensaje: `${e.message} Tu documento sigue guardado; puedes intentar de nuevo.` })
    } finally {
      setEnviando(null)
    }
  }

  useEffect(() => {
    Promise.all([listar(), pedirCuota()])
      .then(([d, c]) => { setDocs(d); setCuota(c) })
      .catch((e) => (e.status === 401 ? alVencer() : setError(e.message)))
  }, [alVencer])

  return (
    <section aria-labelledby="t-carpeta" className="max-w-[840px]">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 id="t-carpeta" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Hola, {nombre}</h1>
          <p className="text-lg text-ink-2 m-0">Esta es tu carpeta. Aquí verás tus documentos y las solicitudes que te lleguen.</p>
        </div>
        <a className="btn-primario" href="#subir">
          <FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" /> Subir documento
        </a>
      </div>
      {cuota && (
        <p className="text-ink-2 mb-4" data-testid="cuota">
          Te quedan {cuota.documentos.maximo - cuota.documentos.usados} de {cuota.documentos.maximo} documentos
          y {mb(cuota.bytes.maximo - cuota.bytes.usados)} MB de {mb(cuota.bytes.maximo)} MB.
        </p>
      )}
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tu carpeta">{error}</Aviso>}
      {!docs && !error && <p className="text-ink-2" role="status">Cargando tus documentos…</p>}
      {docs?.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-10 text-center">
          <FolderOpen className="mx-auto text-ink-2" size={24} strokeWidth={1.75} aria-hidden="true" />
          <p className="mt-2 mb-0">Todavía no tienes documentos.</p>
        </div>
      )}
      {docs?.length > 0 && (
        <p className="text-ink-2 mb-3" id="ayuda-autenticar">
          Puedes pedir a GovCarpeta que autentique un documento temporal. Le enviamos un enlace que vence en 15 minutos; el archivo no sale de tu carpeta.
        </p>
      )}
      {docs?.length > 0 && (
        <ul className="list-none p-0 grid gap-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-start gap-3 bg-surface border border-border rounded-lg p-4">
              <FileText className="text-ink-2 mt-0.5" size={24} strokeWidth={1.75} aria-hidden="true" />
              <div className="flex-1">
                <h2 className="text-base font-semibold m-0">{d.titulo}</h2>
                <p className="text-sm text-ink-2 my-0.5">Subido por ti · {fecha(d.creado)} · {tamano(d.tamano)}</p>
                <Estado documento={d} />
                {fallo?.id === d.id && <Aviso tipo="peligro" titulo="GovCarpeta no autenticó el documento">{fallo.mensaje}</Aviso>}
                {!d.autenticacion && (
                  <div className="mt-3">
                    <button
                      type="button" className="btn-secundario disabled:opacity-70 disabled:cursor-progress" disabled={enviando !== null}
                      aria-label={`Autenticar con GovCarpeta: ${d.titulo}`} aria-describedby="ayuda-autenticar" onClick={() => pedirAutenticacion(d)}
                    >
                      <BadgeCheck size={20} strokeWidth={1.75} aria-hidden="true" />
                      {enviando === d.id ? 'Esperando a GovCarpeta…' : 'Autenticar con GovCarpeta'}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
