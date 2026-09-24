import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Copy } from 'lucide-react'
import { registrar } from './api.js'
import { sesion } from './sesion.js'
import Aviso from './Aviso.jsx'

const PASOS = [
  {
    titulo: 'Tu identidad',
    campos: [
      { id: 'cedula', etiqueta: 'Número de cédula', ayuda: 'Solo números, sin puntos. Lo usamos para confirmar que no tengas carpeta en otro operador.', inputMode: 'numeric', autoComplete: 'off', patron: /^[0-9]{6,10}$/, error: 'Escribe entre 6 y 10 números, sin puntos ni espacios.' },
      { id: 'nombre', etiqueta: 'Nombres', autoComplete: 'given-name', patron: /^.{1,60}$/, error: 'Escribe tus nombres.' },
      { id: 'apellido', etiqueta: 'Apellidos', autoComplete: 'family-name', patron: /^.{1,60}$/, error: 'Escribe tus apellidos.' },
    ],
  },
  {
    titulo: 'Contacto',
    campos: [
      { id: 'direccion', etiqueta: 'Dirección de residencia', ayuda: 'El directorio nacional la exige para registrar tu afiliación.', autoComplete: 'street-address', patron: /^.{1,120}$/, error: 'Escribe tu dirección.' },
      { id: 'correoContacto', etiqueta: 'Correo personal', ayuda: 'Te escribiremos aquí. Tu cuenta en la carpeta será un correo institucional distinto.', type: 'email', autoComplete: 'email', patron: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, error: 'Escribe un correo válido, por ejemplo ana@correo.co.' },
    ],
  },
  {
    titulo: 'Tu clave',
    campos: [
      { id: 'clave', etiqueta: 'Crea una clave', ayuda: 'Mínimo 12 caracteres. Después de 5 intentos fallidos bloqueamos el ingreso por unos minutos.', type: 'password', autoComplete: 'new-password', patron: /^.{12,64}$/, error: 'La clave debe tener entre 12 y 64 caracteres.' },
    ],
  },
]

const mensaje = (e) => ({
  409: `${e.message} Para cambiarte de operador debes pedir el traslado.`,
  422: 'No pudimos verificar tu identidad con esos datos. Revisa tu cédula, nombres y apellidos.',
  503: 'El directorio nacional no responde. No podemos confirmar tu afiliación todavía; intenta en unos minutos.',
  429: 'Hiciste demasiados intentos desde esta conexión. Intenta de nuevo en una hora.',
}[e.status] ?? e.message)

export default function Registro() {
  const [paso, setPaso] = useState(0)
  const [datos, setDatos] = useState({})
  const [errores, setErrores] = useState({})
  const [estado, setEstado] = useState({ tipo: 'editando' })
  const titulo = useRef(null)

  const actual = PASOS[paso]

  function validar() {
    const e = {}
    for (const c of actual.campos) if (!c.patron.test((datos[c.id] ?? '').trim())) e[c.id] = c.error
    setErrores(e)
    const primero = Object.keys(e)[0]
    if (primero) document.getElementById(primero).focus()
    return !primero
  }

  function irA(n) {
    setPaso(n)
    setTimeout(() => titulo.current?.focus())
  }

  async function siguiente(ev) {
    ev.preventDefault()
    if (!validar()) return
    if (paso < PASOS.length - 1) return irA(paso + 1)
    setEstado({ tipo: 'enviando' })
    try {
      const r = await registrar(Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, k === 'clave' ? v : v.trim()])))
      setEstado({ tipo: 'listo', cuenta: r.cuenta })
    } catch (e) {
      setEstado({ tipo: 'error', mensaje: mensaje(e) })
    }
  }

  if (estado.tipo === 'listo') {
    return (
      <section className="max-w-[640px]" aria-labelledby="t-listo">
        <div className="bg-surface border border-border rounded-lg p-6">
          <CheckCircle2 className="text-success" size={24} strokeWidth={1.75} aria-hidden="true" />
          <h1 id="t-listo" tabIndex={-1} ref={(n) => n?.focus()} className="text-[32px] leading-10 font-bold my-2">Ya estás afiliado</h1>
          <p className="mb-3">Tu carpeta quedó registrada en el directorio nacional. Ingresa con esta cuenta institucional y la clave que creaste:</p>
          <p className="font-mono font-semibold text-lg break-all p-3 bg-surface-2 rounded-md" data-testid="cuenta">{estado.cuenta}</p>
          <div className="flex flex-wrap gap-3 mt-6">
            <button type="button" className="btn-primario" onClick={() => sesion.signinRedirect({ login_hint: estado.cuenta })}>Ingresar a mi carpeta</button>
            <button type="button" className="btn-secundario" onClick={() => navigator.clipboard?.writeText(estado.cuenta)}>
              <Copy size={20} strokeWidth={1.75} aria-hidden="true" /> Copiar cuenta
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-[640px]" aria-labelledby="t-registro">
      <p className="text-sm font-semibold text-ink-2 mb-1">Paso {paso + 1} de {PASOS.length} · Crear mi carpeta</p>
      <h1 id="t-registro" tabIndex={-1} ref={titulo} className="text-[32px] leading-10 font-bold">{actual.titulo}</h1>
      <ol className="flex gap-1.5 my-3 mb-6" aria-hidden="true">
        {PASOS.map((p, i) => <li key={p.titulo} className={`flex-1 h-1 rounded-sm ${i <= paso ? 'bg-brand' : 'bg-border'}`} />)}
      </ol>
      {paso === 0 && (
        <Aviso tipo="info" titulo="Verificación de identidad simulada">
          Este prototipo no se conecta con la Registraduría: tu identidad se da por verificada.
        </Aviso>
      )}
      {estado.tipo === 'error' && <Aviso tipo="peligro" titulo="No pudimos afiliarte">{estado.mensaje}</Aviso>}
      <form onSubmit={siguiente} noValidate className="grid gap-5 mt-4">
        {actual.campos.map((c) => (
          <div key={c.id}>
            <label htmlFor={c.id} className="block font-semibold mb-1">{c.etiqueta}</label>
            {c.ayuda && <p id={`${c.id}-ayuda`} className="text-sm text-ink-2 mb-1.5">{c.ayuda}</p>}
            <input
              id={c.id} name={c.id} type={c.type ?? 'text'} inputMode={c.inputMode} autoComplete={c.autoComplete}
              value={datos[c.id] ?? ''} onChange={(e) => setDatos({ ...datos, [c.id]: e.target.value })}
              aria-invalid={!!errores[c.id]} aria-describedby={[c.ayuda && `${c.id}-ayuda`, errores[c.id] && `${c.id}-error`].filter(Boolean).join(' ') || undefined}
              className="w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md aria-invalid:border-2 aria-invalid:border-danger"
            />
            {errores[c.id] && <p id={`${c.id}-error`} className="text-danger text-sm font-semibold mt-1.5">{errores[c.id]}</p>}
          </div>
        ))}
        <div className="flex flex-wrap gap-3 my-2">
          {paso > 0 && (
            <button type="button" className="btn-secundario" onClick={() => irA(paso - 1)}>
              <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Volver
            </button>
          )}
          <button type="submit" className="btn-primario disabled:opacity-70 disabled:cursor-progress" disabled={estado.tipo === 'enviando'}>
            {paso < PASOS.length - 1 ? 'Continuar' : estado.tipo === 'enviando' ? 'Confirmando con el directorio nacional…' : 'Afiliarme'}
            {paso < PASOS.length - 1 && <ArrowRight size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </form>
    </section>
  )
}
