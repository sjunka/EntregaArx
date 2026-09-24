import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, Download, FilePlus2, FileText, FolderOpen, Search, ShieldCheck } from 'lucide-react'
import { autenticar, buscar, cuota as pedirCuota, descargar } from './api.js'
import Aviso from './Aviso.jsx'
import Estado from './Estado.jsx'

const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`)
const mb = (b) => Math.floor(b / 1048576)
const SIN_FILTROS = { q: '', clase: '', desde: '', hasta: '' }
const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'

// Carpeta del titular: el índice (MS-05) solo devuelve sus documentos, según el token de la sesión.
export default function Carpeta({ nombre, alVencer }) {
  const [docs, setDocs] = useState(null)
  const [cuota, setCuota] = useState(null)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [descargando, setDescargando] = useState(null)
  const [fallo, setFallo] = useState(null)
  const [borrador, setBorrador] = useState(SIN_FILTROS)
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  // El índice se actualiza por eventos, unos instantes después de la custodia: lo que el ciudadano acaba de hacer
  // aquí (autenticar) se conserva hasta que el índice lo alcance.
  const locales = useRef(new Map())

  async function pedirAutenticacion(d) {
    setEnviando(d.id)
    setFallo(null)
    try {
      const nuevo = await autenticar(d.id)
      locales.current.set(d.id, nuevo)
      setDocs((l) => l.map((x) => (x.id === d.id ? nuevo : x)))
    } catch (e) {
      if (e.status === 401) return alVencer()
      setFallo({ id: d.id, mensaje: `${e.message} Tu documento sigue guardado; puedes intentar de nuevo.` })
    } finally {
      setEnviando(null)
    }
  }

  async function pedirDescarga(d) {
    setDescargando(d.id)
    setFallo(null)
    try {
      const { url } = await descargar(d.id)
      window.location.assign(url) // la respuesta del almacén trae Content-Disposition: attachment, la página no cambia
    } catch (e) {
      if (e.status === 401) return alVencer()
      setFallo({ id: d.id, descarga: true, mensaje: e.message })
    } finally {
      setDescargando(null)
    }
  }

  useEffect(() => {
    let vivo = true
    const cargar = () => buscar(filtros)
      .then((lista) => {
        if (!vivo) return
        setError(null)
        const nuevos = lista.map((d) => (d.autenticacion ? d : locales.current.get(d.id) ?? d))
        setDocs((previo) => (JSON.stringify(previo) === JSON.stringify(nuevos) ? previo : nuevos))
      })
      .catch((e) => vivo && (e.status === 401 ? alVencer() : setError(e.message)))
    cargar()
    const ciclo = setInterval(cargar, 4000)
    return () => { vivo = false; clearInterval(ciclo) }
  }, [alVencer, filtros])

  useEffect(() => {
    pedirCuota().then(setCuota).catch((e) => e.status === 401 && alVencer())
  }, [alVencer, docs?.length])

  const filtrando = Object.values(filtros).some(Boolean)
  const cambiar = (k) => (e) => setBorrador((b) => ({ ...b, [k]: e.target.value }))

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
          y {mb(cuota.bytes.maximo - cuota.bytes.usados)} MB de {mb(cuota.bytes.maximo)} MB. Los certificados no cuentan.
        </p>
      )}
      <form
        role="search" aria-label="Buscar en mi carpeta" noValidate
        onSubmit={(e) => { e.preventDefault(); setFiltros(borrador) }}
        className="grid gap-3 sm:grid-cols-2 bg-surface border border-border rounded-lg p-4 mb-4"
      >
        <div className="sm:col-span-2">
          <label htmlFor="f-q" className="block font-semibold mb-1">Título</label>
          <input id="f-q" type="search" value={borrador.q} maxLength={120} onChange={cambiar('q')} className={campo} placeholder="Diploma" />
        </div>
        <div>
          <label htmlFor="f-clase" className="block font-semibold mb-1">Clase</label>
          <select id="f-clase" value={borrador.clase} onChange={cambiar('clase')} className={campo}>
            <option value="">Todas</option>
            <option value="temporal">Temporal</option>
            <option value="certificado">Certificado</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-desde" className="block font-semibold mb-1">Desde</label>
            <input id="f-desde" type="date" value={borrador.desde} onChange={cambiar('desde')} className={campo} />
          </div>
          <div>
            <label htmlFor="f-hasta" className="block font-semibold mb-1">Hasta</label>
            <input id="f-hasta" type="date" value={borrador.hasta} onChange={cambiar('hasta')} className={campo} />
          </div>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-3">
          <button type="submit" className="btn-primario"><Search size={20} strokeWidth={1.75} aria-hidden="true" /> Buscar</button>
          {filtrando && (
            <button type="button" className="btn-secundario" onClick={() => { setBorrador(SIN_FILTROS); setFiltros(SIN_FILTROS) }}>Quitar filtros</button>
          )}
        </div>
      </form>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tu carpeta">{error}</Aviso>}
      {!docs && !error && <p className="text-ink-2" role="status">Cargando tus documentos…</p>}
      {docs?.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-10 text-center">
          <FolderOpen className="mx-auto text-ink-2" size={24} strokeWidth={1.75} aria-hidden="true" />
          <p className="mt-2 mb-0">{filtrando ? 'No encontramos documentos con esos filtros.' : 'Todavía no tienes documentos.'}</p>
        </div>
      )}
      {docs?.some((d) => d.clase === 'temporal' && d.estado === 'cargado') && (
        <p className="text-ink-2 mb-3" id="ayuda-autenticar">
          Puedes pedir a GovCarpeta que autentique un documento temporal. Le enviamos un enlace que vence en 15 minutos; el archivo no sale de tu carpeta.
        </p>
      )}
      {docs?.length > 0 && (
        <ul className="list-none p-0 grid gap-3">
          {docs.map((d) => (
            <li key={d.id} id={`doc-${d.id}`} className="flex items-start gap-3 bg-surface border border-border rounded-lg p-4">
              {d.clase === 'certificado'
                ? <ShieldCheck className="text-success mt-0.5" size={24} strokeWidth={1.75} aria-hidden="true" />
                : <FileText className="text-ink-2 mt-0.5" size={24} strokeWidth={1.75} aria-hidden="true" />}
              <div className="flex-1">
                <h2 className="text-base font-semibold m-0">{d.titulo}</h2>
                <p className="text-sm text-ink-2 my-0.5">
                  {d.clase === 'certificado' ? `Recibido de ${d.emisor}` : 'Subido por ti'} · {fecha(d.creado)}{d.tamano ? ` · ${tamano(d.tamano)}` : ''}
                </p>
                <Estado documento={d} certificado={docs.find((x) => x.id === d.sustituidoPor)} />
                {d.clase === 'certificado' && <p className="text-sm text-ink-2 mt-1 mb-0">Se custodia sin alteración y no se puede eliminar.</p>}
                {fallo?.id === d.id && (fallo.descarga
                  ? <Aviso tipo="peligro" titulo="No pudimos preparar la descarga">{fallo.mensaje}</Aviso>
                  : <Aviso tipo="peligro" titulo="GovCarpeta no autenticó el documento">{fallo.mensaje}</Aviso>)}
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button" className="btn-secundario disabled:opacity-70 disabled:cursor-progress" disabled={descargando !== null}
                    aria-label={`${fallo?.id === d.id && fallo.descarga ? 'Reintentar la descarga' : 'Descargar'}: ${d.titulo}`} onClick={() => pedirDescarga(d)}
                  >
                    <Download size={20} strokeWidth={1.75} aria-hidden="true" />
                    {descargando === d.id ? 'Preparando…' : fallo?.id === d.id && fallo.descarga ? 'Reintentar descarga' : 'Descargar'}
                  </button>
                  {d.clase === 'temporal' && d.estado === 'cargado' && !d.autenticacion && (
                    <button
                      type="button" className="btn-secundario disabled:opacity-70 disabled:cursor-progress" disabled={enviando !== null}
                      aria-label={`Autenticar con GovCarpeta: ${d.titulo}`} aria-describedby="ayuda-autenticar" onClick={() => pedirAutenticacion(d)}
                    >
                      <BadgeCheck size={20} strokeWidth={1.75} aria-hidden="true" />
                      {enviando === d.id ? 'Esperando a GovCarpeta…' : 'Autenticar con GovCarpeta'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
