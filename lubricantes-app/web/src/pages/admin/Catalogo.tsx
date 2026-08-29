import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Producto } from '../../lib/database.types'

const vacio = { sku: '', nombre: '', categoria: '', unidades_por_caja: 12, costo_unitario: 0, precio_sugerido: 0 }

export function Catalogo() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [form, setForm] = useState(vacio)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    const { data, error } = await supabase.from('productos').select('*').order('nombre')
    if (error) setError(error.message)
    setProductos(data ?? [])
  }

  useEffect(() => {
    void cargar()
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    const { error } = await supabase.from('productos').insert({
      sku: form.sku,
      nombre: form.nombre,
      categoria: form.categoria || null,
      unidades_por_caja: form.unidades_por_caja,
      costo_unitario: form.costo_unitario,
      precio_sugerido: form.precio_sugerido || null,
      activo: true,
    })
    setGuardando(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm(vacio)
    await cargar()
  }

  const toggleActivo = async (p: Producto) => {
    await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id)
    await cargar()
  }

  return (
    <div>
      <h2>Catálogo de productos</h2>
      {error && <p className="mensaje-error">{error}</p>}

      <form className="tarjeta-form" onSubmit={onSubmit}>
        <h3>Nuevo producto</h3>
        <div className="grid-form">
          <label>
            SKU
            <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </label>
          <label>
            Nombre
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </label>
          <label>
            Categoría
            <input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
          </label>
          <label>
            Unidades por caja
            <input
              type="number"
              min={1}
              required
              value={form.unidades_por_caja}
              onChange={(e) => setForm({ ...form, unidades_por_caja: Number(e.target.value) })}
            />
          </label>
          <label>
            Costo unitario
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.costo_unitario}
              onChange={(e) => setForm({ ...form, costo_unitario: Number(e.target.value) })}
            />
          </label>
          <label>
            Precio sugerido
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.precio_sugerido}
              onChange={(e) => setForm({ ...form, precio_sugerido: Number(e.target.value) })}
            />
          </label>
        </div>
        <button type="submit" disabled={guardando} className="boton-primario">
          {guardando ? 'Guardando…' : 'Agregar producto'}
        </button>
      </form>

      <table className="tabla-conteo">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Uds./caja</th>
            <th>Costo</th>
            <th>Activo</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id}>
              <td>{p.sku}</td>
              <td>{p.nombre}</td>
              <td>{p.categoria}</td>
              <td>{p.unidades_por_caja}</td>
              <td>${p.costo_unitario.toFixed(2)}</td>
              <td>
                <button onClick={() => toggleActivo(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
