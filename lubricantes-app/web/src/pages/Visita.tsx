import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { distanciaMetros, obtenerPosicionActual } from '../lib/geo'
import {
  calcularSugerenciaReposicion,
  calcularUnidadesVendidas,
  calcularValorAproximado,
} from '../lib/reposicion'
import type { Producto, Retailer } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  actualizarUltimaVisitaCache,
  encolarMutacion,
  obtenerCompromisosCache,
  obtenerDespachosCache,
  obtenerProductosCache,
  obtenerRetailersCache,
  obtenerUltimaVisitaCache,
} from '../lib/sync'

type Paso = 'inicio' | 'inventario' | 'resumen' | 'reposicion' | 'upsell' | 'fuera_compromiso' | 'completada'

interface FilaConteo {
  producto: Producto
  esCompromiso: boolean
  minimo: number
  objetivo: number
  inventarioAnterior: number
  despachadoDesdeAnterior: number
  unidadesContadas: number
}

interface FilaPedido {
  producto: Producto
  minimo: number
  objetivo: number
  vendido: number
  valorAproximado: number
  brechaBase: number
  bajoMinimo: boolean
  unidadesSugeridas: number
  unidadesAutorizadas: number
  incluirEnPedido: boolean
}

export function Visita() {
  const { retailerId } = useParams<{ retailerId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [paso, setPaso] = useState<Paso>('inicio')
  const [retailer, setRetailer] = useState<Retailer | null>(null)
  const [catalogo, setCatalogo] = useState<Producto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [visitaId, setVisitaId] = useState<string | null>(null)
  const [gpsVerificado, setGpsVerificado] = useState(false)
  const [distancia, setDistancia] = useState<number | null>(null)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [verificandoGps, setVerificandoGps] = useState(false)

  const [filasConteo, setFilasConteo] = useState<FilaConteo[]>([])
  const [productoExtra, setProductoExtra] = useState('')

  const [filasPedido, setFilasPedido] = useState<FilaPedido[]>([])
  const [autorizadoPor, setAutorizadoPor] = useState('')
  const [correoEnviado, setCorreoEnviado] = useState<'pendiente' | 'enviado' | 'error' | 'omitido'>('pendiente')

  const [nuevoSkuUpsell, setNuevoSkuUpsell] = useState('')
  const [nuevoMinimoUpsell, setNuevoMinimoUpsell] = useState(1)
  const [nuevoObjetivoUpsell, setNuevoObjetivoUpsell] = useState(2)
  const [compromisosAgregados, setCompromisosAgregados] = useState<string[]>([])

  const [skuFueraCompromiso, setSkuFueraCompromiso] = useState('')
  const [unidadesFueraCompromiso, setUnidadesFueraCompromiso] = useState(1)
  const [comprasFueraCompromiso, setComprasFueraCompromiso] = useState<{ producto: Producto; unidades: number }[]>([])

  useEffect(() => {
    if (!retailerId) return
    void (async () => {
      const [retailers, productos] = await Promise.all([obtenerRetailersCache(), obtenerProductosCache()])
      const r = retailers.find((x) => x.id === retailerId) ?? null
      setRetailer(r)
      setCatalogo(productos)
      setCargando(false)
    })()
  }, [retailerId])

  const productosDisponiblesParaExtra = useMemo(
    () => catalogo.filter((p) => !filasConteo.some((f) => f.producto.id === p.id)),
    [catalogo, filasConteo],
  )
  const productosDisponiblesParaUpsell = useMemo(
    () =>
      catalogo.filter(
        (p) => !filasConteo.some((f) => f.esCompromiso && f.producto.id === p.id) && !compromisosAgregados.includes(p.id),
      ),
    [catalogo, filasConteo, compromisosAgregados],
  )
  const productosDisponiblesFueraCompromiso = useMemo(
    () => catalogo.filter((p) => !comprasFueraCompromiso.some((c) => c.producto.id === p.id)),
    [catalogo, comprasFueraCompromiso],
  )

  async function iniciarVisita() {
    if (!retailer || !profile) return
    setVerificandoGps(true)
    setError(null)
    try {
      const pos = await obtenerPosicionActual()
      setGpsCoords({ lat: pos.lat, lng: pos.lng })
      let dist: number | null = null
      let verificado = false
      if (retailer.lat != null && retailer.lng != null) {
        dist = distanciaMetros(pos.lat, pos.lng, retailer.lat, retailer.lng)
        verificado = dist <= retailer.radio_verificacion_metros
      }
      setDistancia(dist)
      setGpsVerificado(verificado)

      const id = await encolarMutacion('visitas', 'insert', {
        retailer_id: retailer.id,
        asesor_id: profile.id,
        fecha_hora: new Date().toISOString(),
        lat: pos.lat,
        lng: pos.lng,
        distancia_metros: dist,
        gps_verificado: verificado,
        estado: 'en_progreso',
        notas: null,
      })
      setVisitaId(id)

      const [compromisos, ultimaVisita] = await Promise.all([
        obtenerCompromisosCache(retailer.id),
        obtenerUltimaVisitaCache(retailer.id),
      ])

      const filas: FilaConteo[] = compromisos.map((c) => {
        const producto = catalogo.find((p) => p.id === c.producto_id)
        const inventarioAnterior = ultimaVisita?.inventario.find((i) => i.producto_id === c.producto_id)?.unidades_contadas ?? 0
        return {
          producto: producto!,
          esCompromiso: true,
          minimo: c.minimo_unidades,
          objetivo: c.objetivo_unidades,
          inventarioAnterior,
          despachadoDesdeAnterior: 0,
          unidadesContadas: 0,
        }
      }).filter((f) => f.producto)

      const despachos = await obtenerDespachosCache(retailer.id)
      const fechaCorte = ultimaVisita?.visita.fecha_hora ? new Date(ultimaVisita.visita.fecha_hora) : null
      for (const fila of filas) {
        fila.despachadoDesdeAnterior = despachos
          .filter((d) => d.producto_id === fila.producto.id && (!fechaCorte || new Date(d.fecha) > fechaCorte))
          .reduce((sum, d) => sum + d.unidades_despachadas, 0)
      }

      setFilasConteo(filas)
      setPaso('inventario')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar la ubicación.')
    } finally {
      setVerificandoGps(false)
    }
  }

  function agregarProductoExtra() {
    const producto = catalogo.find((p) => p.id === productoExtra)
    if (!producto) return
    setFilasConteo((prev) => [
      ...prev,
      {
        producto,
        esCompromiso: false,
        minimo: 0,
        objetivo: 0,
        inventarioAnterior: 0,
        despachadoDesdeAnterior: 0,
        unidadesContadas: 0,
      },
    ])
    setProductoExtra('')
  }

  async function confirmarInventario() {
    if (!visitaId) return
    for (const fila of filasConteo) {
      await encolarMutacion('inventario_contado', 'insert', {
        visita_id: visitaId,
        producto_id: fila.producto.id,
        unidades_contadas: fila.unidadesContadas,
        es_compromiso: fila.esCompromiso,
      })
    }

    const pedidos: FilaPedido[] = filasConteo
      .filter((f) => f.esCompromiso)
      .map((f) => {
        const vendido = calcularUnidadesVendidas(f.inventarioAnterior, f.despachadoDesdeAnterior, f.unidadesContadas)
        const sugerencia = calcularSugerenciaReposicion(f.unidadesContadas, f.minimo, f.objetivo)
        return {
          producto: f.producto,
          minimo: f.minimo,
          objetivo: f.objetivo,
          vendido,
          valorAproximado: calcularValorAproximado(vendido, f.producto.costo_unitario),
          brechaBase: sugerencia.brechaBase,
          bajoMinimo: sugerencia.bajoMinimo,
          unidadesSugeridas: sugerencia.unidadesSugeridas,
          unidadesAutorizadas: sugerencia.unidadesSugeridas,
          incluirEnPedido: sugerencia.unidadesSugeridas > 0,
        }
      })
    setFilasPedido(pedidos)
    setPaso('resumen')
  }

  async function enviarCorreoResumen() {
    if (!visitaId || !retailer) return
    if (!navigator.onLine) {
      setCorreoEnviado('omitido')
      return
    }
    try {
      const { error: fnError } = await supabase.functions.invoke('send-visit-email', {
        body: { visita_id: visitaId },
      })
      setCorreoEnviado(fnError ? 'error' : 'enviado')
    } catch {
      setCorreoEnviado('error')
    }
  }

  async function confirmarReposicion() {
    if (!visitaId) return
    for (const fila of filasPedido) {
      if (!fila.incluirEnPedido) continue
      await encolarMutacion('pedidos_sugeridos', 'insert', {
        visita_id: visitaId,
        producto_id: fila.producto.id,
        inventario_anterior: filasConteo.find((f) => f.producto.id === fila.producto.id)?.inventarioAnterior ?? 0,
        despachado_desde_visita_anterior:
          filasConteo.find((f) => f.producto.id === fila.producto.id)?.despachadoDesdeAnterior ?? 0,
        inventario_actual: filasConteo.find((f) => f.producto.id === fila.producto.id)?.unidadesContadas ?? 0,
        unidades_vendidas_calculadas: fila.vendido,
        minimo_unidades: fila.minimo,
        objetivo_unidades: fila.objetivo,
        unidades_sugeridas: fila.unidadesSugeridas,
        unidades_autorizadas: fila.unidadesAutorizadas,
        estado: 'autorizado',
        es_fuera_de_compromiso: false,
        autorizado_por_nombre: autorizadoPor || null,
        autorizado_en: new Date().toISOString(),
      })
    }
    setPaso('upsell')
  }

  function agregarCompromisoUpsell() {
    const producto = catalogo.find((p) => p.id === nuevoSkuUpsell)
    if (!producto || !retailer) return
    void encolarMutacion('compromisos', 'insert', {
      retailer_id: retailer.id,
      producto_id: producto.id,
      minimo_unidades: nuevoMinimoUpsell,
      objetivo_unidades: nuevoObjetivoUpsell,
      activo: true,
      fecha_inicio: new Date().toISOString().slice(0, 10),
      fecha_fin: null,
    })
    setCompromisosAgregados((prev) => [...prev, producto.id])
    setNuevoSkuUpsell('')
  }

  function agregarCompraFueraCompromiso() {
    const producto = catalogo.find((p) => p.id === skuFueraCompromiso)
    if (!producto) return
    setComprasFueraCompromiso((prev) => [...prev, { producto, unidades: unidadesFueraCompromiso }])
    setSkuFueraCompromiso('')
    setUnidadesFueraCompromiso(1)
  }

  async function finalizarVisita() {
    if (!visitaId || !retailer || !profile) return

    for (const compra of comprasFueraCompromiso) {
      await encolarMutacion('pedidos_sugeridos', 'insert', {
        visita_id: visitaId,
        producto_id: compra.producto.id,
        inventario_anterior: 0,
        despachado_desde_visita_anterior: 0,
        inventario_actual: 0,
        unidades_vendidas_calculadas: 0,
        minimo_unidades: 0,
        objetivo_unidades: 0,
        unidades_sugeridas: compra.unidades,
        unidades_autorizadas: compra.unidades,
        estado: 'autorizado',
        es_fuera_de_compromiso: true,
        autorizado_por_nombre: autorizadoPor || null,
        autorizado_en: new Date().toISOString(),
      })
    }

    await encolarMutacion('visitas', 'update', { id: visitaId, estado: 'completada' })

    await actualizarUltimaVisitaCache({
      retailer_id: retailer.id,
      visita: {
        id: visitaId,
        retailer_id: retailer.id,
        asesor_id: profile.id,
        fecha_hora: new Date().toISOString(),
        lat: gpsCoords?.lat ?? null,
        lng: gpsCoords?.lng ?? null,
        distancia_metros: distancia,
        gps_verificado: gpsVerificado,
        estado: 'completada',
        notas: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      inventario: filasConteo.map((f, i) => ({
        id: `local-${i}`,
        visita_id: visitaId,
        producto_id: f.producto.id,
        unidades_contadas: f.unidadesContadas,
        es_compromiso: f.esCompromiso,
        created_at: new Date().toISOString(),
      })),
      pedidos: [],
    })

    setPaso('completada')
  }

  if (cargando) return <p>Cargando…</p>
  if (!retailer) {
    return (
      <div>
        <p>No se encontró este retailer en los datos descargados.</p>
        <button onClick={() => navigate('/')}>Volver a mi ruta</button>
      </div>
    )
  }

  return (
    <div className="visita-wizard">
      <h2>{retailer.nombre}</h2>
      <p className="subtitulo">{retailer.direccion}</p>
      {error && <p className="mensaje-error">{error}</p>}

      {paso === 'inicio' && (
        <div className="paso">
          <p>Al iniciar se verifica tu ubicación GPS contra la del punto de venta registrado.</p>
          <button onClick={iniciarVisita} disabled={verificandoGps} className="boton-primario">
            {verificandoGps ? 'Verificando ubicación…' : 'Verificar ubicación y comenzar'}
          </button>
        </div>
      )}

      {paso === 'inventario' && (
        <div className="paso">
          {!gpsVerificado && (
            <p className="mensaje-advertencia">
              {distancia == null
                ? 'Este retailer no tiene coordenadas GPS registradas: no se pudo verificar la cercanía.'
                : `Estás a ${Math.round(distancia)} m del punto registrado (máximo ${retailer.radio_verificacion_metros} m). La visita queda marcada como no verificada.`}
            </p>
          )}
          <h3>Conteo de inventario (en unidades, no cajas)</h3>
          <table className="tabla-conteo">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Compromiso</th>
                <th>Unidades contadas</th>
              </tr>
            </thead>
            <tbody>
              {filasConteo.map((f, idx) => (
                <tr key={f.producto.id}>
                  <td>
                    {f.producto.nombre}
                    <div className="detalle-visita">{f.producto.sku}</div>
                  </td>
                  <td>{f.esCompromiso ? `mín. ${f.minimo} / obj. ${f.objetivo}` : 'sin compromiso'}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={f.unidadesContadas}
                      onChange={(e) => {
                        const valor = Number(e.target.value)
                        setFilasConteo((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unidadesContadas: valor } : row)),
                        )
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="fila-agregar">
            <select value={productoExtra} onChange={(e) => setProductoExtra(e.target.value)}>
              <option value="">+ contar otro producto sin compromiso…</option>
              {productosDisponiblesParaExtra.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <button onClick={agregarProductoExtra} disabled={!productoExtra}>
              Agregar
            </button>
          </div>

          <button onClick={confirmarInventario} className="boton-primario" disabled={filasConteo.length === 0}>
            Calcular ventas y reposición
          </button>
        </div>
      )}

      {paso === 'resumen' && (
        <div className="paso">
          <h3>Resumen de la visita</h3>
          <table className="tabla-conteo">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Vendido</th>
                <th>Valor aprox. (costo)</th>
                <th>Reposición sugerida</th>
              </tr>
            </thead>
            <tbody>
              {filasPedido.map((f) => (
                <tr key={f.producto.id}>
                  <td>{f.producto.nombre}</td>
                  <td>{f.vendido}</td>
                  <td>${f.valorAproximado.toFixed(2)}</td>
                  <td>
                    {f.unidadesSugeridas} {f.bajoMinimo && <span className="etiqueta-alerta">bajo mínimo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Total vendido a costo:</strong> $
            {filasPedido.reduce((sum, f) => sum + f.valorAproximado, 0).toFixed(2)}
          </p>

          <button onClick={enviarCorreoResumen} disabled={correoEnviado === 'enviado'}>
            {correoEnviado === 'enviado'
              ? 'Correo enviado ✓'
              : correoEnviado === 'omitido'
                ? 'Sin conexión: se reenviará más tarde'
                : correoEnviado === 'error'
                  ? 'Error al enviar, reintentar'
                  : 'Enviar correo al retail con este cálculo'}
          </button>

          <button onClick={() => setPaso('reposicion')} className="boton-primario">
            Continuar a la reposición
          </button>
        </div>
      )}

      {paso === 'reposicion' && (
        <div className="paso">
          <h3>Reposición sugerida — pedir autorización</h3>
          {filasPedido
            .filter((f) => f.unidadesSugeridas > 0)
            .map((f) => (
              <div key={f.producto.id} className="fila-pedido">
                <label>
                  <input
                    type="checkbox"
                    checked={f.incluirEnPedido}
                    onChange={(e) =>
                      setFilasPedido((prev) =>
                        prev.map((row) =>
                          row.producto.id === f.producto.id ? { ...row, incluirEnPedido: e.target.checked } : row,
                        ),
                      )
                    }
                  />
                  {f.producto.nombre} — sugerido: {f.unidadesSugeridas}
                </label>
                <input
                  type="number"
                  min={0}
                  disabled={!f.incluirEnPedido}
                  value={f.unidadesAutorizadas}
                  onChange={(e) => {
                    const valor = Number(e.target.value)
                    setFilasPedido((prev) =>
                      prev.map((row) => (row.producto.id === f.producto.id ? { ...row, unidadesAutorizadas: valor } : row)),
                    )
                  }}
                />
              </div>
            ))}
          {filasPedido.every((f) => f.unidadesSugeridas === 0) && <p>No hay reposición sugerida en esta visita.</p>}

          <label className="campo-texto">
            Autorizado por (nombre en el retail)
            <input value={autorizadoPor} onChange={(e) => setAutorizadoPor(e.target.value)} />
          </label>

          <button onClick={confirmarReposicion} className="boton-primario">
            Convertir en pedido y continuar
          </button>
        </div>
      )}

      {paso === 'upsell' && (
        <div className="paso">
          <h3>¿Sumamos alguna referencia nueva al compromiso?</h3>
          <div className="fila-agregar">
            <select value={nuevoSkuUpsell} onChange={(e) => setNuevoSkuUpsell(e.target.value)}>
              <option value="">Elegir producto…</option>
              {productosDisponiblesParaUpsell.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              placeholder="mínimo"
              value={nuevoMinimoUpsell}
              onChange={(e) => setNuevoMinimoUpsell(Number(e.target.value))}
            />
            <input
              type="number"
              min={nuevoMinimoUpsell}
              placeholder="objetivo"
              value={nuevoObjetivoUpsell}
              onChange={(e) => setNuevoObjetivoUpsell(Number(e.target.value))}
            />
            <button onClick={agregarCompromisoUpsell} disabled={!nuevoSkuUpsell}>
              Agregar al compromiso
            </button>
          </div>
          {compromisosAgregados.length > 0 && <p>{compromisosAgregados.length} referencia(s) nueva(s) agregada(s).</p>}
          <button onClick={() => setPaso('fuera_compromiso')} className="boton-primario">
            Continuar
          </button>
        </div>
      )}

      {paso === 'fuera_compromiso' && (
        <div className="paso">
          <h3>¿Alguna compra fuera de compromiso?</h3>
          <div className="fila-agregar">
            <select value={skuFueraCompromiso} onChange={(e) => setSkuFueraCompromiso(e.target.value)}>
              <option value="">Elegir producto…</option>
              {productosDisponiblesFueraCompromiso.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={unidadesFueraCompromiso}
              onChange={(e) => setUnidadesFueraCompromiso(Number(e.target.value))}
            />
            <button onClick={agregarCompraFueraCompromiso} disabled={!skuFueraCompromiso}>
              Agregar
            </button>
          </div>
          <ul>
            {comprasFueraCompromiso.map((c) => (
              <li key={c.producto.id}>
                {c.producto.nombre}: {c.unidades} unidades
              </li>
            ))}
          </ul>
          <button onClick={finalizarVisita} className="boton-primario">
            Finalizar visita
          </button>
        </div>
      )}

      {paso === 'completada' && (
        <div className="paso">
          <p>Visita completada. Los datos se sincronizan automáticamente cuando hay conexión.</p>
          <button onClick={() => navigate('/')} className="boton-primario">
            Volver a mi ruta
          </button>
        </div>
      )}
    </div>
  )
}
