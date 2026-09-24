import { useState } from 'react'
import { ArrowLeft, Upload } from 'lucide-react'
import { subir } from './api.js'
import Aviso from './Aviso.jsx'

const TIPOS = ['application/pdf', 'image/jpeg', 'image/png']
const MAX = 10 * 1024 * 1024
const ETAPAS = {
  reservando: 'Preparando espacio en tu carpeta…',
  subiendo: 'Subiendo el archivo…',
  verificando: 'Verificando que el archivo llegó completo…',
}

export default function Subir({ alVencer }) {
  const [titulo, setTitulo] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [error, setError] = useState(null)
  const [etapa, setEtapa] = useState(null)

  async function enviar(ev) {
    ev.preventDefault()
    if (!titulo.trim()) return setError('Escribe un nombre para el documento.')
    if (!archivo) return setError('Elige el archivo que quieres guardar.')
    if (!TIPOS.includes(archivo.type)) return setError('Solo aceptamos PDF, JPG o PNG.')
    if (archivo.size > MAX) return setError('El archivo pesa más de 10 MB. Reduce su tamaño e intenta de nuevo.')
    setError(null)
    try {
      await subir({ titulo: titulo.trim(), archivo }, setEtapa)
      window.location.hash = ''
    } catch (e) {
      setEtapa(null)
      if (e.status === 401) return alVencer()
      setError(e.message)
    }
  }

  return (
    <section className="max-w-[640px]" aria-labelledby="t-subir">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-subir" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Subir documento</h1>
      <p className="text-ink-2 mb-4">Quedará como documento temporal, subido por ti. El archivo va directo a tu almacén; el operador solo guarda sus datos.</p>
      {error && <Aviso tipo="peligro" titulo="No pudimos guardar el documento">{error}</Aviso>}
      <form onSubmit={enviar} noValidate className="grid gap-5 mt-4">
        <div>
          <label htmlFor="titulo" className="block font-semibold mb-1">Nombre del documento</label>
          <input
            id="titulo" value={titulo} maxLength={120} placeholder="Diploma de bachiller" onChange={(e) => setTitulo(e.target.value)}
            className="w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md"
          />
        </div>
        <div>
          <label htmlFor="archivo" className="block font-semibold mb-1">Archivo</label>
          <p id="archivo-ayuda" className="text-sm text-ink-2 mb-1.5">PDF, JPG o PNG de hasta 10 MB.</p>
          <input
            id="archivo" type="file" accept=".pdf,.jpg,.jpeg,.png" aria-describedby="archivo-ayuda"
            onChange={(e) => setArchivo(e.target.files[0] ?? null)}
            className="w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md"
          />
        </div>
        {etapa && <p className="text-ink-2" role="status">{ETAPAS[etapa]}</p>}
        <div>
          <button type="submit" className="btn-primario disabled:opacity-70 disabled:cursor-progress" disabled={!!etapa}>
            <Upload size={20} strokeWidth={1.75} aria-hidden="true" /> Guardar en mi carpeta
          </button>
        </div>
      </form>
    </section>
  )
}
