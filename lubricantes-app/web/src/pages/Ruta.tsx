import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { Retailer } from '../lib/database.types'
import { obtenerRetailersCache, obtenerUltimaVisitaCache, precargarDatosRuta } from '../lib/sync'

interface RetailerConEstado extends Retailer {
  proximaVisitaVencida: boolean
  ultimaVisitaFecha: string | null
}

function calcularVencida(retailer: Retailer, ultimaVisitaFecha: string | null): boolean {
  if (!ultimaVisitaFecha) return true
  const dias = (Date.now() - new Date(ultimaVisitaFecha).getTime()) / (1000 * 60 * 60 * 24)
  return dias >= retailer.frecuencia_visita_dias
}

export function Ruta() {
  const { profile } = useAuth()
  const [retailers, setRetailers] = useState<RetailerConEstado[]>([])
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargarDesdeCache = useCallback(async () => {
    const base = await obtenerRetailersCache()
    const conEstado = await Promise.all(
      base.map(async (r) => {
        const ultima = await obtenerUltimaVisitaCache(r.id)
        const fecha = ultima?.visita.fecha_hora ?? null
        return { ...r, ultimaVisitaFecha: fecha, proximaVisitaVencida: calcularVencida(r, fecha) }
      }),
    )
    conEstado.sort((a, b) => Number(b.proximaVisitaVencida) - Number(a.proximaVisitaVencida))
    setRetailers(conEstado)
    setCargando(false)
  }, [])

  const actualizarRuta = useCallback(async () => {
    if (!profile) return
    if (!navigator.onLine) {
      setError('Sin conexión: no se puede actualizar la ruta ahora. Se están usando los últimos datos descargados.')
      return
    }
    setSincronizando(true)
    setError(null)
    try {
      await precargarDatosRuta(profile.id)
      await cargarDesdeCache()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la ruta.')
    } finally {
      setSincronizando(false)
    }
  }, [profile, cargarDesdeCache])

  useEffect(() => {
    void cargarDesdeCache().then(async () => {
      // Si no hay nada en caché (primer uso) y hay conexión, precargamos.
      const base = await obtenerRetailersCache()
      if (base.length === 0 && profile && navigator.onLine) {
        await actualizarRuta()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (cargando) return <p>Cargando ruta…</p>

  return (
    <div>
      <div className="encabezado-seccion">
        <h2>Mi ruta</h2>
        <button onClick={actualizarRuta} disabled={sincronizando}>
          {sincronizando ? 'Actualizando…' : 'Actualizar ruta'}
        </button>
      </div>
      {error && <p className="mensaje-error">{error}</p>}
      {retailers.length === 0 && (
        <p>
          No hay retailers descargados todavía. Conectate a internet y tocá &quot;Actualizar ruta&quot; antes de
          salir a visitar.
        </p>
      )}
      <ul className="lista-retailers">
        {retailers.map((r) => (
          <li key={r.id} className={r.proximaVisitaVencida ? 'retailer-vencido' : ''}>
            <div className="retailer-info">
              <strong>{r.nombre}</strong>
              <span>{r.direccion}</span>
              <span className="detalle-visita">
                {r.ultimaVisitaFecha
                  ? `Última visita: ${new Date(r.ultimaVisitaFecha).toLocaleDateString()}`
                  : 'Sin visitas registradas'}
                {r.proximaVisitaVencida && ' · Visita pendiente'}
              </span>
            </div>
            <Link to={`/visita/${r.id}`} className="boton-primario">
              Iniciar visita
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
