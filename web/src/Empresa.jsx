import { useCallback, useEffect, useState } from 'react'
import { BriefcaseBusiness, FilePlus2, Send } from 'lucide-react'
import { abrirCaso, casos as pedirCasos, catalogo as pedirCatalogo, pedirDocumentos, perfilEmpresa, usoEmpresa } from './api.js'
import Aviso from './Aviso.jsx'

const campo = 'w-full min-h-12 px-3 py-2.5 text-ink bg-surface border border-border-strong rounded-md'
const pesos = (n) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const ESTADOS = {
  pendiente: 'Esperando la decisión del ciudadano',
  atendida: 'El ciudadano autorizó documentos',
  rechazada: 'El ciudadano rechazó la petición',
}

// HU-10: la empresa Premium abre casos PQRS y pide desde ellos documentos al ciudadano. La petición sigue la misma
// autorización documento a documento que cualquier entidad (HU-07); aquí solo ve su estado, nunca la carpeta.
export default function Empresa({ alVencer }) {
  const [perfil, setPerfil] = useState(null)
  const [catalogo, setCatalogo] = useState([])
  const [casos, setCasos] = useState([])
  const [uso, setUso] = useState([])
  const [asunto, setAsunto] = useState('')
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const cargar = useCallback(() => Promise.all([perfilEmpresa(), pedirCatalogo(), pedirCasos(), usoEmpresa()])
    .then(([p, c, k, u]) => { setPerfil(p); setCatalogo((x) => (igual(x, c) ? x : c)); setCasos((x) => (igual(x, k) ? x : k)); setUso((x) => (igual(x, u) ? x : u)); setError(null) })
    .catch((e) => (e.status === 401 ? alVencer() : setError(e.message))), [alVencer])
  useEffect(() => {
    cargar()
    const ciclo = setInterval(cargar, 4000)
    return () => clearInterval(ciclo)
  }, [cargar])

  async function actuar(accion, mensaje) {
    setOcupado(true)
    setAviso(null)
    try {
      await accion()
      setAviso({ tipo: 'exito', titulo: mensaje })
      await cargar()
      return true
    } catch (e) {
      if (e.status === 401) return alVencer()
      setAviso({ tipo: 'peligro', titulo: 'No pudimos completar la acción', detalle: e.message })
    } finally {
      setOcupado(false)
    }
  }

  async function abrir(ev) {
    ev.preventDefault()
    if (!asunto.trim()) return setAviso({ tipo: 'peligro', titulo: 'Escribe el asunto del caso.' })
    if (await actuar(() => abrirCaso(asunto.trim()), 'Abrimos el caso.')) setAsunto('')
  }

  return (
    <section className="max-w-[840px]" aria-labelledby="t-empresa">
      <h1 id="t-empresa" className="text-[32px] leading-10 font-bold tracking-tight mb-2">{perfil ? perfil.nombre : 'Casos PQRS'}</h1>
      <p className="text-ink-2 mb-4">Abre un caso y pide desde él los documentos de un ciudadano. Él decide cuáles comparte; tú solo ves el estado de la petición.</p>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tu consola">{error}</Aviso>}
      {aviso && <Aviso tipo={aviso.tipo} titulo={aviso.titulo}>{aviso.detalle}</Aviso>}
      {!perfil && !error && <p className="text-ink-2" role="status">Cargando tu consola…</p>}

      {perfil && !perfil.premium && (
        <Aviso tipo="advertencia" titulo="Tu empresa no tiene un plan Premium activo.">
          Sin plan no puedes abrir casos. Estos son los servicios que puedes contratar.
        </Aviso>
      )}

      {perfil?.premium && (
        <form onSubmit={abrir} noValidate className="grid gap-3 mb-8">
          <div>
            <label htmlFor="asunto" className="block font-semibold mb-1">Asunto del caso</label>
            <input id="asunto" type="text" autoComplete="off" maxLength={120} value={asunto} onChange={(e) => setAsunto(e.target.value)} className={campo} />
          </div>
          <div>
            <button type="submit" className="btn-primario disabled:opacity-70" disabled={ocupado}>
              <FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" /> Abrir caso
            </button>
          </div>
        </form>
      )}

      {perfil?.premium && (
        <>
          <h2 className="text-xl font-bold mb-2">Casos</h2>
          {casos.length === 0 && <p className="text-ink-2">Todavía no has abierto casos.</p>}
          <ul className="list-none p-0 grid gap-4 mb-8">
            {casos.map((c) => <Caso key={c.id} caso={c} actuar={actuar} ocupado={ocupado} />)}
          </ul>
        </>
      )}

      {perfil && (
        <>
          <h2 className="text-xl font-bold mb-2">{perfil.premium ? 'Uso medido' : 'Catálogo Premium'}</h2>
          {perfil.premium ? (
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Uso medido por servicio</caption>
              <thead><tr className="border-b border-border"><th className="py-2 pr-3">Servicio</th><th className="py-2 pr-3">Usos</th><th className="py-2">A facturar</th></tr></thead>
              <tbody>
                {uso.map((u) => (
                  <tr key={u.servicio} className="border-b border-border"><td className="py-2 pr-3">{u.nombre}</td><td className="py-2 pr-3">{u.total}</td><td className="py-2">{pesos(u.subtotalCop)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="list-none p-0 grid gap-3">
              {catalogo.map((s) => (
                <li key={s.id} className="bg-surface border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 text-lg font-bold m-0"><BriefcaseBusiness size={20} strokeWidth={1.75} aria-hidden="true" /> {s.nombre}</h3>
                  <p className="my-1">{s.descripcion}</p>
                  <p className="m-0 text-ink-2">{pesos(s.tarifaCop)} por uso</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Caso({ caso, actuar, ocupado }) {
  const [cedula, setCedula] = useState('')
  const [proposito, setProposito] = useState('')
  const [documentos, setDocumentos] = useState('')

  async function pedir(ev) {
    ev.preventDefault()
    const titulos = documentos.split(',').map((t) => t.trim()).filter(Boolean)
    if (await actuar(() => pedirDocumentos(caso.id, { cedula: cedula.trim(), proposito: proposito.trim(), documentos: titulos.map((titulo) => ({ titulo })) }), 'Enviamos la petición al ciudadano.')) {
      setCedula(''); setProposito(''); setDocumentos('')
    }
  }
  const id = `caso-${caso.id}`

  return (
    <li className="bg-surface border border-border rounded-lg p-4">
      <h3 className="text-lg font-bold m-0">{caso.asunto}</h3>
      <p className="text-sm text-ink-2 mt-0.5 mb-3">Caso {caso.estado}</p>
      {caso.peticiones.length > 0 && (
        <ul className="list-none p-0 grid gap-2 mb-3">
          {caso.peticiones.map((p) => (
            <li key={p.id} className="border border-border rounded-md p-3">
              <p className="font-semibold m-0">Ciudadano {p.cedula}: {p.pedidos.map((d) => d.titulo).join(', ')}</p>
              <p className="text-sm text-ink-2 my-0.5">{p.proposito}</p>
              <p className="text-sm m-0">{ESTADOS[p.estado]}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={pedir} noValidate className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`${id}-cedula`} className="block font-semibold mb-1">Cédula del ciudadano en «{caso.asunto}»</label>
            <input id={`${id}-cedula`} type="text" inputMode="numeric" autoComplete="off" maxLength={10} value={cedula} onChange={(e) => setCedula(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor={`${id}-docs`} className="block font-semibold mb-1">Documentos que pides en «{caso.asunto}», separados por coma</label>
            <input id={`${id}-docs`} type="text" autoComplete="off" value={documentos} onChange={(e) => setDocumentos(e.target.value)} className={campo} />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-para`} className="block font-semibold mb-1">Para qué los necesitas en «{caso.asunto}»</label>
          <input id={`${id}-para`} type="text" autoComplete="off" maxLength={200} value={proposito} onChange={(e) => setProposito(e.target.value)} className={campo} />
        </div>
        <div>
          <button type="submit" className="btn-secundario disabled:opacity-70" disabled={ocupado}>
            <Send size={20} strokeWidth={1.75} aria-hidden="true" /> Pedir documentos en «{caso.asunto}»
          </button>
        </div>
      </form>
    </li>
  )
}
