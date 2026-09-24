import { useEffect, useState } from 'react'
import { ArrowLeft, Bell } from 'lucide-react'
import { avisos as pedirAvisos, guardarPreferencias, preferencias } from './api.js'
import Aviso from './Aviso.jsx'

const CANALES = [
  { id: 'correo', etiqueta: 'Correo electrónico', destino: (p) => p.correo },
  { id: 'sms', etiqueta: 'Mensaje de texto (SMS)', destino: (p) => p.telefono },
]
const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })

// Preferencias de canal de MS-09 (ADR-0016): el ciudadano elige por dónde le avisamos y ve sus últimos avisos.
export default function Avisos({ alVencer }) {
  const [prefs, setPrefs] = useState(null)
  const [elegidos, setElegidos] = useState([])
  const [historial, setHistorial] = useState([])
  const [estado, setEstado] = useState({ tipo: 'cargando' })

  useEffect(() => {
    Promise.all([preferencias(), pedirAvisos()])
      .then(([p, h]) => { setPrefs(p); setElegidos(p.canales); setHistorial(h); setEstado({ tipo: 'listo' }) })
      .catch((e) => (e.status === 401 ? alVencer() : setEstado({ tipo: 'error', mensaje: e.message })))
  }, [alVencer])

  async function guardar(ev) {
    ev.preventDefault()
    if (!elegidos.length) return setEstado({ tipo: 'error', mensaje: 'Elige al menos un canal para que podamos avisarte.' })
    setEstado({ tipo: 'guardando' })
    try {
      setPrefs(await guardarPreferencias(elegidos))
      setEstado({ tipo: 'guardado' })
    } catch (e) {
      if (e.status === 401) return alVencer()
      setEstado({ tipo: 'error', mensaje: e.message })
    }
  }

  const alternar = (id) => {
    setEstado({ tipo: 'listo' })
    setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  }

  return (
    <section className="max-w-[640px]" aria-labelledby="t-avisos">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-avisos" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Avisos</h1>
      <p className="text-ink-2 mb-4">Te avisamos cuando una entidad envíe un documento a tu carpeta. Elige por dónde quieres enterarte.</p>
      {estado.tipo === 'error' && <Aviso tipo="peligro" titulo="No pudimos completar la acción">{estado.mensaje}</Aviso>}
      {estado.tipo === 'guardado' && <Aviso tipo="exito" titulo="Guardamos tus preferencias" />}
      {estado.tipo === 'cargando' && <p className="text-ink-2" role="status">Cargando tus preferencias…</p>}
      {prefs && (
        <form onSubmit={guardar} noValidate>
          <fieldset className="border border-border rounded-lg p-4 grid gap-3">
            <legend className="px-1 font-semibold">Canales de aviso</legend>
            {CANALES.map((c) => (
              <label key={c.id} className="flex items-start gap-3 min-h-11 cursor-pointer">
                <input type="checkbox" className="mt-1 size-5" checked={elegidos.includes(c.id)} onChange={() => alternar(c.id)} />
                <span>
                  {c.etiqueta}
                  <span className="block text-sm text-ink-2">{c.destino(prefs) || 'Sin datos de contacto'}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-4">
            <button type="submit" className="btn-primario disabled:opacity-70" disabled={estado.tipo === 'guardando'}>
              <Bell size={20} strokeWidth={1.75} aria-hidden="true" /> Guardar preferencias
            </button>
          </div>
        </form>
      )}
      {estado.tipo !== 'cargando' && (
        <>
          <h2 className="text-xl font-bold mt-8 mb-2">Últimos avisos</h2>
          {historial.length === 0 ? (
            <p className="text-ink-2">Todavía no te hemos enviado avisos.</p>
          ) : (
            <ul className="list-none p-0 grid gap-2">
              {historial.map((h, i) => (
                <li key={`${h.creado}-${h.canal}`} className="bg-surface border border-border rounded-lg p-3">
                  <span className="font-semibold">{h.asunto}</span>
                  <span className="block text-sm text-ink-2">
                    {{ correo: 'Por correo', sms: 'Por SMS', ninguno: 'Sin canal disponible' }[h.canal]} · {h.estado === 'enviado' ? 'Enviado' : 'No se pudo enviar'} · {fecha(h.creado)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
