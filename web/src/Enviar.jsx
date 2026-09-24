import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Mail, Send } from 'lucide-react'
import { buscar, enviar, envios as pedirEnvios } from './api.js'
import Aviso from './Aviso.jsx'

const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
const MAX = 10
const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'
const ESTADOS = {
  entregado: (e) => `Entregado el ${fecha(e.entregadoEn)}. Los enlaces valen hasta el ${fecha(e.venceEn)}.`,
  pendiente: () => 'Pendiente: el correo no salió todavía y lo reintentamos solos. No tienes que volver a enviarlo.',
  fallido: () => 'No pudimos entregar el correo después de varios intentos. Vuelve a enviarlo.',
}

// HU-08: el paquete viaja como enlaces temporales por correo, nunca como archivo adjunto. Enviar es tu decisión de
// compartir esos documentos con ese correo, y la autorización se puede retirar.
export default function Enviar({ alVencer }) {
  const [docs, setDocs] = useState(null)
  const [lista, setLista] = useState([])
  const [correo, setCorreo] = useState('')
  const [elegidos, setElegidos] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  // Una clave por intento de envío: si la respuesta se pierde y se repite el clic, el servidor devuelve el mismo envío.
  const clave = useRef(crypto.randomUUID())

  // El índice y la lista de envíos se ponen al día solos (el correo pendiente se reintenta en el servidor).
  const cargar = useCallback(() => Promise.all([buscar(), pedirEnvios()])
    .then(([d, e]) => {
      setDocs((x) => (JSON.stringify(x) === JSON.stringify(d) ? x : d))
      setLista((x) => (JSON.stringify(x) === JSON.stringify(e) ? x : e))
    })
    .catch((e) => (e.status === 401 ? alVencer() : setError(e.message))), [alVencer])
  useEffect(() => {
    cargar()
    const ciclo = setInterval(cargar, 4000)
    return () => clearInterval(ciclo)
  }, [cargar])

  const compartibles = (docs ?? []).filter((d) => d.estado !== 'sustituido')
  const marcar = (id) => setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  async function enviarPaquete(ev) {
    ev.preventDefault()
    setResultado(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) return setError('Escribe el correo de la entidad que recibirá los documentos.')
    if (!elegidos.length) return setError('Elige al menos un documento para enviar.')
    setError(null)
    setEnviando(true)
    try {
      const e = await enviar({ correo: correo.trim(), documentos: elegidos, clave: clave.current })
      setResultado(e)
      clave.current = crypto.randomUUID()
      setCorreo('')
      setElegidos([])
      cargar()
    } catch (e) {
      if (e.status === 401) return alVencer()
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="max-w-[840px]" aria-labelledby="t-enviar">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-enviar" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Enviar a una entidad</h1>
      <p className="text-ink-2 mb-4">
        Para entidades que no tienen operador de Carpeta Ciudadana. Les enviamos por correo un enlace temporal por documento, que vale 72 horas.
        El archivo nunca va adjunto.
      </p>
      {error && <Aviso tipo="peligro" titulo="No pudimos enviar los documentos">{error}</Aviso>}
      {resultado?.estado === 'entregado' && <Aviso tipo="exito" titulo={`Enviamos los enlaces a ${resultado.correo}.`}>Te confirmamos también por tu canal de avisos.</Aviso>}
      {resultado && resultado.estado !== 'entregado' && (
        <Aviso tipo="advertencia" titulo={`El correo a ${resultado.correo} no salió todavía.`}>Lo reintentamos automáticamente; no tienes que volver a enviarlo.</Aviso>
      )}
      <form onSubmit={enviarPaquete} noValidate className="grid gap-5 mt-4">
        <div>
          <label htmlFor="correo-entidad" className="block font-semibold mb-1">Correo de la entidad</label>
          <input
            id="correo-entidad" type="email" autoComplete="off" value={correo} maxLength={254} placeholder="tramites@entidad.gov.co"
            onChange={(e) => setCorreo(e.target.value)} className={campo}
          />
        </div>
        <fieldset className="border border-border rounded-lg p-4 grid gap-2">
          <legend className="px-1 font-semibold">Documentos que envías (hasta {MAX})</legend>
          {!docs && <p className="text-ink-2 m-0" role="status">Cargando tus documentos…</p>}
          {docs && compartibles.length === 0 && <p className="text-ink-2 m-0">No tienes documentos en tu carpeta para enviar.</p>}
          {compartibles.map((d) => (
            <label key={d.id} className="flex items-center gap-3 min-h-11 cursor-pointer">
              <input
                type="checkbox" className="size-5" checked={elegidos.includes(d.id)} onChange={() => marcar(d.id)}
                disabled={!elegidos.includes(d.id) && elegidos.length >= MAX}
              />
              <span>{d.titulo}<span className="block text-sm text-ink-2">{d.clase === 'certificado' ? `Certificado de ${d.emisor}` : 'Temporal subido por ti'}</span></span>
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" className="btn-primario disabled:opacity-70 disabled:cursor-progress" disabled={enviando}>
            <Send size={20} strokeWidth={1.75} aria-hidden="true" /> {enviando ? 'Enviando…' : 'Enviar documentos'}
          </button>
        </div>
      </form>

      <h2 className="text-xl font-bold mt-8 mb-2">Envíos</h2>
      {lista.length === 0 ? (
        <p className="text-ink-2">Todavía no has enviado documentos.</p>
      ) : (
        <ul className="list-none p-0 grid gap-2">
          {lista.map((e) => (
            <li key={e.id} className="bg-surface border border-border rounded-lg p-3">
              <p className="flex items-center gap-2 font-semibold m-0"><Mail size={16} strokeWidth={1.75} aria-hidden="true" /> {e.correo}</p>
              <p className="text-sm text-ink-2 my-0.5">{e.documentos.map((d) => d.titulo).join(', ')}</p>
              <p className="text-sm m-0">{ESTADOS[e.estado](e)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
