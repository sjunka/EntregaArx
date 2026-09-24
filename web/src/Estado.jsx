import { ArrowRightLeft, BadgeCheck, FileClock, ShieldCheck } from 'lucide-react'

const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

// El estado se dice con texto e icono, nunca solo con color. Autenticado es una marca del Temporal, no otro estado:
// el sello es de GovCarpeta y nunca se llama «certificado» (B-03); «Certificado» es la clase que emite y firma una entidad.
export default function Estado({ documento, certificado }) {
  if (documento.clase === 'certificado') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
        <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" /> Certificado · Vigente · emitido por {documento.emisor}
      </span>
    )
  }
  if (documento.estado === 'sustituido') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-info">
        <ArrowRightLeft size={16} strokeWidth={2} aria-hidden="true" />
        Temporal · Sustituido por el certificado{' '}
        {certificado ? <a href={`#doc-${certificado.id}`}>«{certificado.titulo}»</a> : 'que llegó a tu carpeta'}
      </span>
    )
  }
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
