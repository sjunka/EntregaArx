import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { diplomasPorRegion } from './api.js'
import Aviso from './Aviso.jsx'

const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'
const SIN_FILTROS = { anio: '', region: '' }
const corte = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' })

// HU-12: el analista del Estado consulta diplomas por región con datos anonimizados (MS-10). Nunca ve un ciudadano ni un
// documento; una celda con muy pocos certificados se reserva en vez de publicarse.
export default function Tablero({ alVencer }) {
  const [datos, setDatos] = useState(null)
  const [regiones, setRegiones] = useState([]) // opciones del filtro: las de la primera carga, sin filtros
  const [error, setError] = useState(null)
  const [borrador, setBorrador] = useState(SIN_FILTROS)
  const [filtros, setFiltros] = useState(SIN_FILTROS)

  useEffect(() => {
    setError(null)
    diplomasPorRegion(filtros)
      .then((d) => { setDatos(d); setRegiones((r) => (r.length ? r : d.regiones.map((x) => x.region))) })
      .catch((e) => (e.status === 401 ? alVencer() : setError(e.message)))
  }, [filtros, alVencer])

  const cambiar = (k) => (e) => setBorrador((b) => ({ ...b, [k]: e.target.value }))
  const filtrando = Object.values(filtros).some(Boolean)

  return (
    <section className="max-w-[840px]" aria-labelledby="t-tablero">
      <h1 id="t-tablero" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Diplomas emitidos por región</h1>
      <p className="text-ink-2 mb-4">Datos anonimizados de educación: solo institución, región y año. Nunca hay documentos ni datos de un ciudadano.</p>
      <form
        role="search" aria-label="Filtrar el tablero" noValidate
        onSubmit={(e) => { e.preventDefault(); setFiltros({ ...borrador }) }}
        className="grid gap-3 sm:grid-cols-2 bg-surface border border-border rounded-lg p-4 mb-4"
      >
        <div>
          <label htmlFor="t-anio" className="block font-semibold mb-1">Año</label>
          <select id="t-anio" value={borrador.anio} onChange={cambiar('anio')} className={campo}>
            <option value="">Todos</option>
            {datos?.anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="t-region" className="block font-semibold mb-1">Región</label>
          <select id="t-region" value={borrador.region} onChange={cambiar('region')} className={campo}>
            <option value="">Todas</option>
            {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-3">
          <button type="submit" className="btn-primario"><Search size={20} strokeWidth={1.75} aria-hidden="true" /> Consultar</button>
          {filtrando && (
            <button type="button" className="btn-secundario" onClick={() => { setBorrador(SIN_FILTROS); setFiltros({ ...SIN_FILTROS }) }}>Quitar filtros</button>
          )}
        </div>
      </form>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir el tablero">{error}</Aviso>}
      {!datos && !error && <p className="text-ink-2" role="status">Cargando el tablero…</p>}
      {datos && (
        <>
          <p className="text-ink-2 mb-2">
            {datos.corte ? <>Datos al <time dateTime={datos.corte}>{corte(datos.corte)}</time>.</> : 'Todavía no hay datos consolidados.'}
          </p>
          {datos.regiones.length === 0 ? (
            <p className="text-ink-2">{filtrando ? 'No hay datos con esos filtros.' : 'Todavía no hay diplomas emitidos.'}</p>
          ) : (
            <div className="overflow-x-auto bg-surface border border-border rounded-lg">
              <table className="w-full text-left border-collapse">
                <caption className="text-left font-semibold p-4">Diplomas por región</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-3">Región</th>
                    <th scope="col" className="p-3 text-right">Diplomas</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.regiones.map((r) => (
                    <tr key={r.region} className="border-b border-border last:border-0">
                      <th scope="row" className="p-3 font-normal">{r.region}</th>
                      <td className="p-3 text-right">{r.suprimido ? `Reservado: menos de ${datos.umbral}` : r.diplomas.toLocaleString('es-CO')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
