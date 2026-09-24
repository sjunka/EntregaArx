import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Ban, CheckCheck, ShieldOff } from 'lucide-react'
import { autorizar, buscar, peticiones as pedirPeticiones, rechazar, revocar } from './api.js'
import Aviso from './Aviso.jsx'

const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })

// HU-07: el ciudadano decide documento por documento qué comparte con la entidad que le pide documentos. Nada sale sin
// esa decisión explícita: no hay casillas marcadas de antemano. Revocar surte efecto de inmediato.
export default function Solicitudes({ alVencer }) {
  const [lista, setLista] = useState(null)
  const [docs, setDocs] = useState([])
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [elegidos, setElegidos] = useState({}) // peticionId → documentos marcados
  const [ocupado, setOcupado] = useState(null)

  // El índice de carpeta se pone al día por eventos: se refresca cada 4 s para que un documento recién guardado aparezca.
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const cargar = useCallback(() => Promise.all([pedirPeticiones(), buscar()])
    .then(([p, d]) => { setLista((x) => (igual(x, p) ? x : p)); setDocs((x) => (igual(x, d) ? x : d)); setError(null) })
    .catch((e) => (e.status === 401 ? alVencer() : setError(e.message))), [alVencer])
  useEffect(() => {
    cargar()
    const ciclo = setInterval(cargar, 4000)
    return () => clearInterval(ciclo)
  }, [cargar])

  const titulos = useMemo(() => new Map(docs.map((d) => [d.id, d.titulo])), [docs])
  // Un Temporal sustituido ya lo reemplazó su Certificado: no se ofrece para compartir.
  const compartibles = docs.filter((d) => d.estado !== 'sustituido')

  async function actuar(id, accion, mensaje) {
    setOcupado(id)
    setAviso(null)
    try {
      await accion()
      setAviso({ tipo: 'exito', titulo: mensaje })
      await cargar()
    } catch (e) {
      if (e.status === 401) return alVencer()
      setAviso({ tipo: 'peligro', titulo: 'No pudimos completar la acción', detalle: e.message })
    } finally {
      setOcupado(null)
    }
  }

  const marcar = (p, id) => setElegidos((m) => {
    const actuales = m[p.id] ?? []
    return { ...m, [p.id]: actuales.includes(id) ? actuales.filter((x) => x !== id) : [...actuales, id] }
  })

  return (
    <section className="max-w-[840px]" aria-labelledby="t-solicitudes">
      <a className="inline-flex items-center gap-1.5 min-h-11 mb-2" href="#">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /> Mi carpeta
      </a>
      <h1 id="t-solicitudes" className="text-[32px] leading-10 font-bold tracking-tight mb-2">Solicitudes</h1>
      <p className="text-ink-2 mb-4">Las entidades te piden documentos y tú decides cuáles compartes. Ningún documento sale sin tu autorización y puedes retirarla cuando quieras.</p>
      {error && <Aviso tipo="peligro" titulo="No pudimos abrir tus solicitudes">{error}</Aviso>}
      {aviso && <Aviso tipo={aviso.tipo} titulo={aviso.titulo}>{aviso.detalle}</Aviso>}
      {!lista && !error && <p className="text-ink-2" role="status">Cargando tus solicitudes…</p>}
      {lista?.length === 0 && <p className="text-ink-2">Todavía no tienes solicitudes.</p>}
      <ul className="list-none p-0 grid gap-4">
        {lista?.map((p) => {
          const marcados = elegidos[p.id] ?? []
          const vigentes = p.autorizaciones.filter((a) => !a.revocada && new Date(a.venceEn) > new Date())
          return (
            <li key={p.id} className="bg-surface border border-border rounded-lg p-4">
              <h2 className="text-lg font-bold m-0">{p.entidad} te pide documentos</h2>
              <p className="my-1"><span className="font-semibold">Para qué:</span> {p.proposito}</p>
              <p className="mt-1 mb-2"><span className="font-semibold">Documentos que pide:</span> {p.pedidos.map((d) => d.titulo).join(', ')}</p>

              {p.estado === 'pendiente' && (
                <form onSubmit={(e) => { e.preventDefault(); actuar(p.id, () => autorizar(p.id, marcados), 'Autorizaste los documentos elegidos.') }} noValidate>
                  <fieldset className="border border-border rounded-lg p-3 grid gap-2">
                    <legend className="px-1 font-semibold">Elige qué compartes (hasta {p.pedidos.length})</legend>
                    {compartibles.length === 0 && <p className="text-ink-2 m-0">No tienes documentos en tu carpeta para compartir.</p>}
                    {compartibles.map((d) => (
                      <label key={d.id} className="flex items-center gap-3 min-h-11 cursor-pointer">
                        <input
                          type="checkbox" className="size-5" checked={marcados.includes(d.id)} onChange={() => marcar(p, d.id)}
                          disabled={!marcados.includes(d.id) && marcados.length >= p.pedidos.length}
                        />
                        <span>{d.titulo}<span className="block text-sm text-ink-2">{d.clase === 'certificado' ? `Certificado de ${d.emisor}` : 'Temporal subido por ti'}</span></span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button type="submit" className="btn-primario disabled:opacity-70" disabled={!marcados.length || ocupado === p.id}>
                      <CheckCheck size={20} strokeWidth={1.75} aria-hidden="true" />
                      {marcados.length === 1 ? `Autorizar «${titulos.get(marcados[0])}»` : marcados.length ? `Autorizar ${marcados.length} documentos` : "Autorizar"}
                    </button>
                    <button type="button" className="btn-secundario" disabled={ocupado === p.id} onClick={() => actuar(p.id, () => rechazar(p.id), 'Rechazaste la petición. La entidad solo sabe que la rechazaste.')}>
                      <Ban size={20} strokeWidth={1.75} aria-hidden="true" /> Rechazar petición de {p.entidad}
                    </button>
                  </div>
                </form>
              )}

              {p.estado === 'atendida' && (
                <div>
                  <p className="font-semibold mb-1">Autorizaste:</p>
                  <ul className="list-none p-0 grid gap-2">
                    {p.autorizaciones.map((a) => {
                      const activa = vigentes.includes(a)
                      return (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-md p-3">
                          <span>
                            {titulos.get(a.documentoId) ?? 'Documento'}
                            <span className="block text-sm text-ink-2">
                              {a.revocada ? 'Retiraste esta autorización.' : activa ? `Vigente hasta el ${fecha(a.venceEn)}` : 'Esta autorización venció.'}
                            </span>
                          </span>
                          {activa && (
                            <button
                              type="button" className="btn-secundario" disabled={ocupado === a.id}
                              aria-label={`Revocar autorización de «${titulos.get(a.documentoId) ?? 'documento'}» a ${p.entidad}`}
                              onClick={() => actuar(a.id, () => revocar(a.id), 'Retiraste la autorización.')}
                            >
                              <ShieldOff size={20} strokeWidth={1.75} aria-hidden="true" /> Revocar
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {p.estado === 'rechazada' && <p className="text-ink-2 mb-0">Rechazaste esta petición. {p.entidad} no recibió ningún documento.</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
