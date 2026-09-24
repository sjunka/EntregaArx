import { FileClock } from 'lucide-react'

// El estado se dice con texto e icono, nunca solo con color.
export default function Estado() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2">
      <FileClock size={16} strokeWidth={2} aria-hidden="true" /> Temporal · sin autenticar
    </span>
  )
}
