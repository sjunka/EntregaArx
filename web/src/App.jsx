import { useEffect, useState } from 'react'
import { FolderLock, FolderOpen, LogIn, LogOut } from 'lucide-react'
import { sesion } from './sesion.js'
import Tema from './Tema.jsx'

// Una sola promesa: StrictMode corre el efecto dos veces y el código de ingreso solo se canjea una vez.
const inicial = new URLSearchParams(window.location.search).has('code')
  ? sesion.signinRedirectCallback().finally(() => window.history.replaceState(null, '', window.location.pathname))
  : sesion.getUser()

export default function App() {
  const [usuario, setUsuario] = useState(undefined)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    inicial.then((u) => setUsuario(u && !u.expired ? u : null)).catch(() => { setUsuario(null); setFallo(true) })
  }, [])

  let contenido
  if (usuario === undefined) contenido = <p className="text-ink-2" role="status">Abriendo tu carpeta…</p>
  else if (usuario) contenido = <Carpeta nombre={usuario.profile.given_name} />
  else contenido = <Bienvenida fallo={fallo} />

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
            <button type="button" className="btn-secundario" onClick={() => sesion.signoutRedirect()}>
              <LogOut size={20} strokeWidth={1.75} aria-hidden="true" /> Cerrar sesión
            </button>
          ) : (
            <button type="button" className="btn-primario" onClick={() => sesion.signinRedirect()}>
              <LogIn size={20} strokeWidth={1.75} aria-hidden="true" /> Ingresar
            </button>
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

function Bienvenida({ fallo }) {
  return (
    <section aria-labelledby="t-inicio">
      {fallo && (
        <p role="alert" className="mb-6 p-4 rounded-md border border-danger bg-danger-bg text-ink font-semibold">
          No pudimos completar tu ingreso. Intenta ingresar de nuevo.
        </p>
      )}
      <h1 id="t-inicio" className="text-[40px] leading-[48px] font-bold tracking-tight max-w-[18ch] mb-2">
        Tus documentos, en una carpeta que controlas
      </h1>
      <p className="text-lg text-ink-2 max-w-[60ch]">
        Mi Carpeta Segura es tu operador de Carpeta Ciudadana. Guarda tus documentos y compártelos solo con quien tú decidas.
      </p>
    </section>
  )
}

function Carpeta({ nombre }) {
  return (
    <section aria-labelledby="t-carpeta" className="max-w-[840px]">
      <h1 id="t-carpeta" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Hola, {nombre}</h1>
      <p className="text-lg text-ink-2 mb-6">Esta es tu carpeta. Aquí verás tus documentos y las solicitudes que te lleguen.</p>
      <div className="bg-surface border border-border rounded-lg p-10 text-center">
        <FolderOpen className="mx-auto text-ink-2" size={24} strokeWidth={1.75} aria-hidden="true" />
        <p className="mt-2 mb-0">Todavía no tienes documentos.</p>
      </div>
    </section>
  )
}
