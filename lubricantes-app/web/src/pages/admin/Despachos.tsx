import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { PedidoSugerido, Producto, Retailer, Visita } from '../../lib/database.types'

interface FilaImport {
  retailer: string
  sku: string
  fecha: string
  unidades: number
}

function parseCsv(texto: string): FilaImport[] {
  const lineas = texto.trim().split(/\r?\n/)
  const [encabezado, ...resto] = lineas
  const columnas = encabezado.split(',').map((c) => c.trim().toLowerCase())
  const idxRetailer = columnas.indexOf('retailer')
  const idxSku = columnas.indexOf('sku')
  const idxFecha = columnas.indexOf('fecha')
  const idxUnidades = columnas.indexOf('unidades')
  if ([idxRetailer, idxSku, idxFecha, idxUnidades].includes(-1)) {
    throw new Error('El CSV debe tener las columnas: retailer,sku,fecha,unidades')
  }
  return resto
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const campos = l.split(',').map((c) => c.trim())
      return {
        retailer: campos[idxRetailer],
        sku: campos[idxSku],
        fecha: campos[idxFecha],
        unidades: Number(campos[idxUnidades]),
      }
    })
}

interface FilaComparacion {
  retailerNombre: string
  productoNombre: string
  autorizado: number
  despachado: number
}

export function Despachos() {
  const { profile } = useAuth()
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [reporte, setReporte] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [comparacion, setComparacion] = useState<FilaComparacion[]>([])
  const [cargandoComparacion, setCargandoComparacion] = useState(true)

  useEffect(() => {
    void (async () => {
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase.from('retailers').select('*'),
        supabase.from('productos').select('*'),
      ])
      setRetailers(r ?? [])
      setProductos(p ?? [])
    })()
  }, [])

  useEffect(() => {
    void cargarComparacion()
  }, [])

  async function cargarComparacion() {
    setCargandoComparacion(true)
    const [{ data: pedidos }, { data: despachos }, { data: visitas }, { data: retailersData }, { data: productosData }] =
      await Promise.all([
        supabase.from('pedidos_sugeridos').select('*').eq('estado', 'autorizado'),
        supabase.from('despachos').select('*'),
        supabase.from('visitas').select('*'),
        supabase.from('retailers').select('*'),
        supabase.from('productos').select('*'),
      ])
    const mapaVisitas = new Map<string, Visita>((visitas ?? []).map((v) => [v.id, v]))
    const totales = new Map<string, FilaComparacion>()

    const clave = (retailerId: string, productoId: string) => `${retailerId}::${productoId}`

    for (const pedido of (pedidos ?? []) as PedidoSugerido[]) {
      const visita = mapaVisitas.get(pedido.visita_id)
      if (!visita) continue
      const k = clave(visita.retailer_id, pedido.producto_id)
      const actual = totales.get(k) ?? {
        retailerNombre: (retailersData ?? []).find((r) => r.id === visita.retailer_id)?.nombre ?? '—',
        productoNombre: (productosData ?? []).find((p) => p.id === pedido.producto_id)?.nombre ?? '—',
        autorizado: 0,
        despachado: 0,
      }
      actual.autorizado += pedido.unidades_autorizadas ?? 0
      totales.set(k, actual)
    }

    for (const despacho of despachos ?? []) {
      const k = clave(despacho.retailer_id, despacho.producto_id)
      const actual = totales.get(k)
      if (!actual) continue
      actual.despachado += despacho.unidades_despachadas
    }

    setComparacion(Array.from(totales.values()))
    setCargandoComparacion(false)
  }

  const onImportar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    if (!archivo || !profile) return
    setError(null)
    setReporte(null)
    setImportando(true)
    try {
      const texto = await archivo.text()
      const filas = parseCsv(texto)
      let importadas = 0
      const noEncontradas: string[] = []
      for (const fila of filas) {
        const retailer = retailers.find((r) => r.nombre.trim().toLowerCase() === fila.retailer.trim().toLowerCase())
        const producto = productos.find((p) => p.sku.trim().toLowerCase() === fila.sku.trim().toLowerCase())
        if (!retailer || !producto || !fila.fecha || Number.isNaN(fila.unidades)) {
          noEncontradas.push(`${fila.retailer} / ${fila.sku}`)
          continue
        }
        const { error } = await supabase.from('despachos').insert({
          retailer_id: retailer.id,
          producto_id: producto.id,
          fecha: fila.fecha,
          unidades_despachadas: fila.unidades,
          origen: 'import_odbc',
          importado_por: profile.id,
          pedido_id: null,
        })
        if (!error) importadas += 1
      }
      setReporte(
        `Importadas ${importadas} de ${filas.length} filas.` +
          (noEncontradas.length > 0 ? ` No encontradas: ${noEncontradas.join(', ')}` : ''),
      )
      await cargarComparacion()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar el archivo.')
    } finally {
      setImportando(false)
      e.target.value = ''
    }
  }

  const comparacionOrdenada = useMemo(
    () => [...comparacion].sort((a, b) => Math.abs(b.autorizado - b.despachado) - Math.abs(a.autorizado - a.despachado)),
    [comparacion],
  )

  return (
    <div>
      <h2>Despachos</h2>
      <p>
        Importá el archivo exportado por ODBC/Excel desde SAREGO. Formato CSV con columnas: <code>retailer,sku,fecha,unidades</code>{' '}
        (fecha en formato YYYY-MM-DD).
      </p>
      <input type="file" accept=".csv" onChange={onImportar} disabled={importando} />
      {error && <p className="mensaje-error">{error}</p>}
      {reporte && <p>{reporte}</p>}

      <h3>Pedido autorizado vs. despachado</h3>
      {cargandoComparacion ? (
        <p>Cargando…</p>
      ) : (
        <table className="tabla-conteo">
          <thead>
            <tr>
              <th>Retailer</th>
              <th>Producto</th>
              <th>Autorizado</th>
              <th>Despachado</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {comparacionOrdenada.map((f, i) => {
              const diferencia = f.despachado - f.autorizado
              return (
                <tr key={i}>
                  <td>{f.retailerNombre}</td>
                  <td>{f.productoNombre}</td>
                  <td>{f.autorizado}</td>
                  <td>{f.despachado}</td>
                  <td className={diferencia !== 0 ? 'etiqueta-alerta' : ''}>{diferencia}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
