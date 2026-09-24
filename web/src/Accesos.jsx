import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { accesos as pedirAccesos, buscar } from './api.js'
import Aviso from './Aviso.jsx'

const SIN_FILTROS = { documentoId: '', desde: '', hasta: '' }
const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'
const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' })
const ACCION = { descarga: 'Descargaste', 'lectura-tercero': 'Consultó', envio: 'Enviaste' }
const quien = (a) => (a.actor.tipo === 'titular' ? 'Tú' : a.actor.id.replace(/^(entidad|correo):/, ''))

// HU-11: el titular ve quién consultó cada documento y cuándo (MS-02, solo lectura) para detectar un acceso indebido.
export default function Accesos({ alVencer }) {
  const [lista, setLista] = useState(null)
  const [docs, setDocs] = useState([])
  const [error, setError] = useState(null)
  const [borrador, setBorrador] = useState(SIN_FILTROS)
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  const fallo = (e) => (e.status === 401 ? alVencer() : setError(e.message))

  useEffect(() => { buscar().then(setDocs).catch(() => {}) }, [])
  useEffect(() => {
    setError(null)
    pedirAccesos(filtros).then(setLista).catch(fallo)
  }, [filtros]) // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = (k) => (e) => setBorrador((b) => ({ ...b, [k]: e.target.value }))
  const filtrando = Object.values(filtros).some(Boolean)

  return (
    <section className="max-w-[840px]" aria-labelledby="t-accesos">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-accesos" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Accesos a mis documentos</h1>
      <p className="text-ink-2 mb-4">Aquí ves quién consultó tus documentos y cuándo. Este registro no se puede modificar ni borrar. Si ves un acceso que no reconoces, revoca la autorización en Solicitudes.</p>
      <form
        role="search" aria-label="Filtrar accesos" noValidate
        onSubmit={(e) => { e.preventDefault(); setFiltros({ ...borrador }) }} // copia: Filtrar de nuevo vuelve a consultar
        className="grid gap-3 sm:grid-cols-2 bg-surface border border-border rounded-lg p-4 mb-4"
      >
        <div className="sm:col-span-2">
          <label htmlFor="a-doc" className="block font-semibold mb-1">Documento</label>
          <select id="a-doc" value={borrador.documentoId} onChange={cambiar('documentoId')} className={campo}>
            <option value="">Todos</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-desde" className="block font-semibold mb-1">Desde</label>
          <input id="a-desde" type="date" value={borrador.desde} onChange={cambiar('desde')} className={campo} />
        </div>
        <div>
          <label htmlFor="a-hasta" className="block font-semibold mb-1">Hasta</label>
          <input id="a-hasta" type="date" value={borrador.hasta} onChange={cambiar('hasta')} className={campo} />
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-3">
          <button type="submit" className="btn-primario"><Search size={20} strokeWidth={1.75} aria-hidden="true" /> Filtrar</button>
          {filtrando && (
            <button type="button" className="btn-secundario" onClick={() => { setBorrador(SIN_FILTROS); setFiltros({ ...SIN_FILTROS }) }}>Quitar filtros</button>
          )}
        </div>
      </form>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tus accesos">{error}</Aviso>}
      {!lista && !error && <p className="text-ink-2" role="status">Cargando tus accesos…</p>}
      {lista?.length === 0 && (
        <p className="text-ink-2">{filtrando ? 'No encontramos accesos con esos filtros.' : 'Todavía nadie ha consultado tus documentos.'}</p>
      )}
      <ul className="list-none p-0 grid gap-2">
        {lista?.map((a) => (
          <li key={a.id} className="bg-surface border border-border rounded-lg p-4">
            <h2 className="text-base font-bold m-0">{ACCION[a.accion]} {a.titulo}</h2>
            <p className="m-0 text-ink-2">Quién: {quien(a)}{a.destino && ` (a ${a.destino.replace(/^correo:/, '')})`}</p>
            <p className="m-0 text-ink-2">Cuándo: <time dateTime={a.ocurridoEn}>{fecha(a.ocurridoEn)}</time></p>
          </li>
        ))}
      </ul>
    </section>
  )
}
