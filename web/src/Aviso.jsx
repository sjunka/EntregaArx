import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

const ESTILOS = {
  peligro: ['text-danger bg-danger-bg', XCircle],
  advertencia: ['text-warning bg-warning-bg', AlertTriangle],
  info: ['text-info bg-info-bg', Info],
  exito: ['text-success bg-success-bg', CheckCircle2],
}

export default function Aviso({ tipo = 'info', titulo, children }) {
  const [clases, Icono] = ESTILOS[tipo]
  return (
    <div className={`flex gap-3 p-4 my-4 rounded-md border border-current ${clases}`} role={tipo === 'peligro' ? 'alert' : 'status'}>
      <Icono className="flex-none mt-0.5" size={20} strokeWidth={1.75} aria-hidden="true" />
      <div className="text-ink">
        <p className="font-semibold mb-0.5">{titulo}</p>
        {children && <p className="m-0">{children}</p>}
      </div>
    </div>
  )
}
