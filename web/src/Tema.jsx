import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const leer = () => {
  try { return localStorage.getItem('tema') } catch { return null }
}
// Sin elección guardada manda la preferencia del sistema.
const delSistema = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

export default function Tema() {
  const [tema, setTema] = useState(() => leer() || delSistema())

  useEffect(() => {
    document.documentElement.dataset.theme = tema
  }, [tema])

  // Solo se guarda una elección explícita; sin ella sigue mandando el sistema.
  const cambiar = () => {
    const nuevo = tema === 'dark' ? 'light' : 'dark'
    setTema(nuevo)
    try { localStorage.setItem('tema', nuevo) } catch { /* navegación privada */ }
  }

  const oscuro = tema === 'dark'
  const Icono = oscuro ? Sun : Moon
  return (
    <button
      type="button"
      className="btn-secundario text-sm"
      onClick={cambiar}
      aria-pressed={oscuro}
    >
      <Icono size={20} strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{oscuro ? 'Tema claro' : 'Tema oscuro'}</span>
    </button>
  )
}
