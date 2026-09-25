import { useState } from 'react'
import { KeyRound, LogIn } from 'lucide-react'
import { activar } from './api.js'
import { sesion } from './sesion.js'
import Aviso from './Aviso.jsx'

const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'

// HU-09: el ciudadano trasladado llega con el enlace que le enviamos por correo. Su cuenta ya existe aquí, pero nadie conoce su
// clave: la elige ahora, con su dirección y celular, que el formato de traslado del curso no trae (ADR-0027). El enlace sirve una
// sola vez y vence a las 24 horas.
export default function Activar({ token }) {
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono] = useState('')
  const [error, setError] = useState(null)
  const [cuenta, setCuenta] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(ev) {
    ev.preventDefault()
    if (clave.length < 12 || clave.length > 64) return setError('La clave debe tener entre 12 y 64 caracteres.')
    if (clave !== repetida) return setError('Las dos claves no coinciden. Escríbelas de nuevo.')
    if (!direccion.trim()) return setError('Escribe tu dirección de residencia.')
    if (!/^3[0-9]{9}$/.test(telefono)) return setError('Escribe tu celular: 10 números que empiezan por 3.')
    setError(null)
    setEnviando(true)
    try {
      setCuenta((await activar({ token, clave, direccion: direccion.trim(), telefono })).cuenta)
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="max-w-[640px]" aria-labelledby="t-activar">
      <h1 id="t-activar" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Activa tu cuenta</h1>
      <p className="text-ink-2 mb-4">
        Tu operador anterior está trasladando tu carpeta a Mi Carpeta Segura. Tu cuenta se conserva: elige una clave y completa tus datos para entrar y ver el avance del traslado.
      </p>
      {error && <Aviso tipo="peligro" titulo="No pudimos activar tu cuenta">{error}</Aviso>}
      {cuenta ? (
        <div>
          <Aviso tipo="exito" titulo="Tu cuenta quedó activa">Ingresa con {cuenta} y la clave que elegiste.</Aviso>
          <button type="button" className="btn-primario" onClick={() => sesion.signinRedirect({ login_hint: cuenta })}>
            <LogIn size={20} strokeWidth={1.75} aria-hidden="true" /> Ingresar
          </button>
        </div>
      ) : (
        <form onSubmit={enviar} noValidate className="grid gap-5 mt-4">
          <div>
            <label htmlFor="clave" className="block font-semibold mb-1">Clave nueva</label>
            <p id="clave-ayuda" className="text-sm text-ink-2 mb-1.5">Entre 12 y 64 caracteres.</p>
            <input id="clave" type="password" autoComplete="new-password" value={clave} maxLength={64} aria-describedby="clave-ayuda" onChange={(e) => setClave(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="clave2" className="block font-semibold mb-1">Repite la clave</label>
            <input id="clave2" type="password" autoComplete="new-password" value={repetida} maxLength={64} onChange={(e) => setRepetida(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="direccion" className="block font-semibold mb-1">Dirección de residencia</label>
            <input id="direccion" type="text" autoComplete="street-address" value={direccion} maxLength={120} onChange={(e) => setDireccion(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="telefono" className="block font-semibold mb-1">Teléfono celular</label>
            <p id="telefono-ayuda" className="text-sm text-ink-2 mb-1.5">10 números, empieza por 3. Por aquí te avisamos si lo eliges.</p>
            <input id="telefono" type="tel" inputMode="numeric" autoComplete="tel-national" value={telefono} maxLength={10} aria-describedby="telefono-ayuda" onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))} className={campo} />
          </div>
          <div>
            <button type="submit" className="btn-primario disabled:opacity-70 disabled:cursor-progress" disabled={enviando}>
              <KeyRound size={20} strokeWidth={1.75} aria-hidden="true" /> {enviando ? 'Activando…' : 'Activar mi cuenta'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
