import { BadgeCheck, FileClock } from 'lucide-react'

const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

// El estado se dice con texto e icono, nunca solo con color. Autenticado es una marca del Temporal, no otro estado:
// el sello es de GovCarpeta y nunca se llama «certificado» (B-03).
export default function Estado({ documento }) {
  if (documento.autenticacion) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
        <BadgeCheck size={16} strokeWidth={2} aria-hidden="true" />
        Temporal · Autenticado por GovCarpeta el {fecha(documento.autenticacion.fecha)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2">
      <FileClock size={16} strokeWidth={2} aria-hidden="true" /> Temporal · sin autenticar
    </span>
  )
}
