import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LogOut, Truck } from 'lucide-react'
import { iniciarSalida, operadoresDestino, salida as pedirSalida } from './api.js'
import { sesion } from './sesion.js'
import Aviso from './Aviso.jsx'

// HU-13: el ciudadano elige a qué operador se traslada y lo confirma de forma explícita. Nada se borra aquí hasta que el
// nuevo operador confirme que recibió todo: mientras espera, su carpeta queda en solo lectura.
export default function Salida({ alVencer }) {
  const [operadores, setOperadores] = useState(null)
  const [actual, setActual] = useState(undefined) // undefined: cargando; null: sin traslado
  const [elegido, setElegido] = useState('')
  const [entiendo, setEntiendo] = useState(false)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(() => pedirSalida()
    .then((t) => setActual((previo) => (JSON.stringify(previo) === JSON.stringify(t) ? previo : t)))
    .catch((e) => (e.status === 401 ? alVencer() : setError(e.message))), [alVencer])
  useEffect(() => {
    cargar()
    operadoresDestino().then(setOperadores).catch((e) => (e.status === 401 ? alVencer() : setError(e.message)))
    const ciclo = setInterval(cargar, 3000)
    return () => clearInterval(ciclo)
  }, [cargar, alVencer])

  async function enviar(ev) {
    ev.preventDefault()
    if (!elegido) return setError('Elige el operador al que quieres trasladarte.')
    if (!entiendo) return setError('Confirma que entiendes lo que pasará con tu carpeta.')
    setError(null)
    setEnviando(true)
    try {
      setActual(await iniciarSalida(elegido))
    } catch (e) {
      if (e.status === 401) return alVencer()
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const enCurso = actual?.estado === 'en-curso'
  const puedeElegir = actual === null || actual?.estado === 'fallido'

  return (
    <section className="max-w-[640px]" aria-labelledby="t-salida">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-salida" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Trasladar mi carpeta</h1>
      <p className="text-ink-2 mb-4">Cambia de operador sin perder tus documentos. Le enviamos tu carpeta al operador que elijas y solo la borramos de aquí cuando él confirme que la recibió completa.</p>
      {error && <Aviso tipo="peligro" titulo="No pudimos continuar">{error}</Aviso>}
      {actual === undefined && !error && <p className="text-ink-2" role="status">Cargando…</p>}

      {enCurso && (
        <section aria-labelledby="t-en-curso" className="bg-info-bg border border-info rounded-lg p-4 mb-4">
          <h2 id="t-en-curso" className="flex items-center gap-2 text-lg font-bold m-0"><Truck size={20} strokeWidth={1.75} aria-hidden="true" /> Estamos trasladando tu carpeta</h2>
          <p className="my-1" role="status">{actual.operador} está recibiendo tus documentos. Mientras tanto tu carpeta está en solo lectura: puedes consultarla y descargar tus documentos, pero no cambiarla.</p>
          <p className="text-sm text-ink-2 m-0">No hace falta que esperes aquí; te mostraremos el resultado cuando ingreses de nuevo.</p>
        </section>
      )}
      {actual?.estado === 'completo' && (
        <>
          <Aviso tipo="exito" titulo={`Tu carpeta ya está con ${actual.operador}`}>Cerramos tu cuenta y borramos tus documentos de Mi Carpeta Segura. Ya puedes ingresar con tu nuevo operador.</Aviso>
          <button type="button" className="btn-primario" onClick={() => sesion.signoutRedirect()}>
            <LogOut size={20} strokeWidth={1.75} aria-hidden="true" /> Cerrar sesión
          </button>
        </>
      )}
      {actual?.estado === 'fallido' && (
        <Aviso tipo="advertencia" titulo="El traslado no se completó">{actual.motivo ?? 'Tu carpeta sigue aquí, con todos tus documentos.'} Puedes intentarlo de nuevo.</Aviso>
      )}
      {actual?.estado === 'atencion' && (
        <Aviso tipo="peligro" titulo="Necesitamos ayuda para resolver tu traslado">{actual.motivo}</Aviso>
      )}

      {puedeElegir && operadores && (
        <form onSubmit={enviar} noValidate>
          <fieldset className="border border-border rounded-lg p-4 grid gap-3">
            <legend className="px-1 font-semibold">Operador al que te trasladas</legend>
            {operadores.length === 0 && <p className="text-ink-2 m-0">No hay otros operadores disponibles ahora.</p>}
            {operadores.map((o) => (
              <label key={o.id} className={`flex items-start gap-3 min-h-11 ${o.disponible ? 'cursor-pointer' : 'opacity-70'}`}>
                <input type="radio" name="operador" className="mt-1 size-5" value={o.id} disabled={!o.disponible} checked={elegido === o.id} onChange={() => { setElegido(o.id); setError(null) }} />
                <span>
                  {o.nombre}
                  {!o.disponible && <span className="block text-sm text-ink-2">Todavía no puede recibir traslados: no publica su dirección en GovCarpeta.</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-3 min-h-11 cursor-pointer mt-4">
            <input type="checkbox" className="mt-1 size-5" checked={entiendo} onChange={(e) => { setEntiendo(e.target.checked); setError(null) }} />
            <span>Entiendo que mi cuenta y mis documentos se borrarán de Mi Carpeta Segura cuando el nuevo operador confirme que recibió todo.</span>
          </label>
          <div className="mt-4">
            <button type="submit" className="btn-primario disabled:opacity-70" disabled={enviando}>
              <Truck size={20} strokeWidth={1.75} aria-hidden="true" /> {enviando ? 'Iniciando…' : 'Trasladar mi carpeta'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
