import { useCallback, useEffect, useState } from 'react'
import { Bell, Eye, FolderLock, Inbox, LogIn, LogOut, Send, UserPlus } from 'lucide-react'
import { sesion } from './sesion.js'
import Tema from './Tema.jsx'
import Registro from './Registro.jsx'
import Carpeta from './Carpeta.jsx'
import Subir from './Subir.jsx'
import Avisos from './Avisos.jsx'
import Solicitudes from './Solicitudes.jsx'
import Enviar from './Enviar.jsx'
import Activar from './Activar.jsx'
import Accesos from './Accesos.jsx'
import Empresa from './Empresa.jsx'

// Una sola promesa: StrictMode corre el efecto dos veces y el código de ingreso solo se canjea una vez.
const inicial = new URLSearchParams(window.location.search).has('code')
  ? sesion.signinRedirectCallback().finally(() => window.history.replaceState(null, '', window.location.pathname))
  : sesion.getUser()

// Sin router: la vista vive en el hash (#registro).
function useHash() {
  const [hash, setHash] = useState(window.location.hash.slice(1))
  useEffect(() => {
    const cambiar = () => { setHash(window.location.hash.slice(1)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', cambiar)
    return () => window.removeEventListener('hashchange', cambiar)
  }, [])
  return hash
}

export default function App() {
  const hash = useHash()
  const [usuario, setUsuario] = useState(undefined)
  const [fallo, setFallo] = useState(false)
  const [vencida, setVencida] = useState(false)
  const alVencer = useCallback(() => { setVencida(true); setUsuario(null) }, [])

  useEffect(() => {
    inicial.then((u) => setUsuario(u && !u.expired ? u : null)).catch(() => { setUsuario(null); setFallo(true) })
  }, [])

  let contenido
  if (usuario === undefined) contenido = <p className="text-ink-2" role="status">Abriendo tu carpeta…</p>
  else if (usuario?.profile.empresa) contenido = <Empresa alVencer={alVencer} />
  else if (usuario && hash === 'subir') contenido = <Subir alVencer={alVencer} />
  else if (usuario && hash === 'avisos') contenido = <Avisos alVencer={alVencer} />
  else if (usuario && hash === 'solicitudes') contenido = <Solicitudes alVencer={alVencer} />
  else if (usuario && hash === 'accesos') contenido = <Accesos alVencer={alVencer} />
  else if (usuario && hash === 'enviar') contenido = <Enviar alVencer={alVencer} />
  else if (usuario) contenido = <Carpeta nombre={usuario.profile.given_name} alVencer={alVencer} />
  else if (hash.startsWith('activar/')) contenido = <Activar token={hash.slice('activar/'.length)} />
  else if (hash === 'registro') contenido = <Registro />
  else contenido = <Bienvenida fallo={fallo} vencida={vencida} />

  return (
    <div className="min-h-screen flex flex-col">
      <a
        className="absolute -left-[9999px] focus:left-4 focus:top-2 z-10 bg-surface px-3 py-2"
        href="#principal"
        onClick={(e) => { e.preventDefault(); document.getElementById('principal').focus() }}
      >
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8 bg-surface border-b border-border">
        <a className="inline-flex items-center gap-2 min-h-11 font-bold text-ink no-underline" href="./">
          <FolderLock className="text-brand-text" size={24} strokeWidth={1.75} aria-hidden="true" />
          <span>Mi Carpeta Segura</span>
        </a>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Cuenta">
          <Tema />
          {usuario ? (
            <>
              {!usuario.profile.empresa && (<>
              <a className="btn-secundario" href="#enviar">
                <Send size={20} strokeWidth={1.75} aria-hidden="true" /> Enviar
              </a>
              <a className="btn-secundario" href="#solicitudes">
                <Inbox size={20} strokeWidth={1.75} aria-hidden="true" /> Solicitudes
              </a>
              <a className="btn-secundario" href="#accesos">
                <Eye size={20} strokeWidth={1.75} aria-hidden="true" /> Accesos
              </a>
              <a className="btn-secundario" href="#avisos">
                <Bell size={20} strokeWidth={1.75} aria-hidden="true" /> Avisos
              </a>
              </>)}
              <button type="button" className="btn-secundario" onClick={() => sesion.signoutRedirect()}>
                <LogOut size={20} strokeWidth={1.75} aria-hidden="true" /> Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <a className="btn-secundario" href="#registro">
                <UserPlus size={20} strokeWidth={1.75} aria-hidden="true" /> Afiliarme
              </a>
              <button type="button" className="btn-primario" onClick={() => sesion.signinRedirect()}>
                <LogIn size={20} strokeWidth={1.75} aria-hidden="true" /> Ingresar
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="principal" tabIndex={-1} className="flex-1 px-4 pt-8 pb-16 md:px-8 md:pt-12 md:pb-20">
        <div className="max-w-[1200px] mx-auto">{contenido}</div>
      </main>
      <footer className="px-4 py-6 text-center text-sm text-ink-3 border-t border-border">
        Operador de Carpeta Ciudadana · Arquitecturas Avanzadas de Software
      </footer>
    </div>
  )
}

function Bienvenida({ fallo, vencida }) {
  return (
    <section aria-labelledby="t-inicio">
      {fallo && (
        <p role="alert" className="mb-6 p-4 rounded-md border border-danger bg-danger-bg text-ink font-semibold">
          No pudimos completar tu ingreso. Intenta ingresar de nuevo.
        </p>
      )}
      {vencida && (
        <p role="alert" className="mb-6 p-4 rounded-md border border-warning bg-warning-bg text-ink font-semibold">
          Tu sesión venció. Ingresa de nuevo para ver tu carpeta.
        </p>
      )}
      <h1 id="t-inicio" className="text-[40px] leading-[48px] font-bold tracking-tight max-w-[18ch] mb-2">
        Tus documentos, en una carpeta que controlas
      </h1>
      <p className="text-lg text-ink-2 max-w-[60ch]">
        Mi Carpeta Segura es tu operador de Carpeta Ciudadana. Guarda tus documentos y compártelos solo con quien tú decidas.
      </p>
      <div className="flex flex-wrap gap-3 my-6">
        <a className="btn-primario" href="#registro">Crear mi carpeta</a>
      </div>
    </section>
  )
}
