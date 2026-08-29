import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Compromiso, Producto, Profile, Retailer } from '../../lib/database.types'

const vacio = {
  nombre: '',
  direccion: '',
  ciudad: '',
  lat: '',
  lng: '',
  radio_verificacion_metros: 150,
  email: '',
  telefono: '',
  asesor_id: '',
  frecuencia_visita_dias: 14,
}

export function Retailers() {
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [asesores, setAsesores] = useState<Profile[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [form, setForm] = useState(vacio)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [retailerSeleccionado, setRetailerSeleccionado] = useState<string | null>(null)
  const [compromisos, setCompromisos] = useState<Compromiso[]>([])
  const [nuevoCompromiso, setNuevoCompromiso] = useState({ producto_id: '', minimo_unidades: 1, objetivo_unidades: 2 })

  const cargar = async () => {
    const [{ data: r, error: e1 }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('retailers').select('*').order('nombre'),
      supabase.from('profiles').select('*').eq('role', 'asesor'),
      supabase.from('productos').select('*').eq('activo', true).order('nombre'),
    ])
    if (e1) setError(e1.message)
    setRetailers(r ?? [])
    setAsesores(a ?? [])
    setProductos(p ?? [])
  }

  useEffect(() => {
    void cargar()
  }, [])

  const cargarCompromisos = async (retailerId: string) => {
    const { data } = await supabase.from('compromisos').select('*').eq('retailer_id', retailerId).order('created_at')
    setCompromisos(data ?? [])
  }

  const seleccionar = async (retailerId: string) => {
    setRetailerSeleccionado(retailerId)
    await cargarCompromisos(retailerId)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    const { error } = await supabase.from('retailers').insert({
      nombre: form.nombre,
      direccion: form.direccion || null,
      ciudad: form.ciudad || null,
      lat: form.lat ? Number(form.lat) : null,
      lng: form.lng ? Number(form.lng) : null,
      radio_verificacion_metros: form.radio_verificacion_metros,
      email: form.email || null,
      telefono: form.telefono || null,
      asesor_id: form.asesor_id || null,
      frecuencia_visita_dias: form.frecuencia_visita_dias,
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

  const agregarCompromiso = async () => {
    if (!retailerSeleccionado || !nuevoCompromiso.producto_id) return
    const { error } = await supabase.from('compromisos').insert({
      retailer_id: retailerSeleccionado,
      producto_id: nuevoCompromiso.producto_id,
      minimo_unidades: nuevoCompromiso.minimo_unidades,
      objetivo_unidades: nuevoCompromiso.objetivo_unidades,
      activo: true,
      fecha_inicio: new Date().toISOString().slice(0, 10),
      fecha_fin: null,
    })
    if (error) {
      setError(error.message)
      return
    }
    setNuevoCompromiso({ producto_id: '', minimo_unidades: 1, objetivo_unidades: 2 })
    await cargarCompromisos(retailerSeleccionado)
  }

  const toggleCompromiso = async (c: Compromiso) => {
    await supabase.from('compromisos').update({ activo: !c.activo }).eq('id', c.id)
    if (retailerSeleccionado) await cargarCompromisos(retailerSeleccionado)
  }

  return (
    <div>
      <h2>Retailers</h2>
      {error && <p className="mensaje-error">{error}</p>}

      <form className="tarjeta-form" onSubmit={onSubmit}>
        <h3>Nuevo retailer</h3>
        <div className="grid-form">
          <label>
            Nombre
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </label>
          <label>
            Dirección
            <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          </label>
          <label>
            Ciudad
            <input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} />
          </label>
          <label>
            Latitud
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="10.4806" />
          </label>
          <label>
            Longitud
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="-66.9036" />
          </label>
          <label>
            Radio de verificación (m)
            <input
              type="number"
              min={10}
              value={form.radio_verificacion_metros}
              onChange={(e) => setForm({ ...form, radio_verificacion_metros: Number(e.target.value) })}
            />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Teléfono
            <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          </label>
          <label>
            Asesor asignado
            <select value={form.asesor_id} onChange={(e) => setForm({ ...form, asesor_id: e.target.value })}>
              <option value="">Sin asignar</option>
              {asesores.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre_completo}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frecuencia de visita (días)
            <input
              type="number"
              min={1}
              value={form.frecuencia_visita_dias}
              onChange={(e) => setForm({ ...form, frecuencia_visita_dias: Number(e.target.value) })}
            />
          </label>
        </div>
        <button type="submit" disabled={guardando} className="boton-primario">
          {guardando ? 'Guardando…' : 'Agregar retailer'}
        </button>
      </form>

      <table className="tabla-conteo">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Asesor</th>
            <th>Ciudad</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {retailers.map((r) => (
            <tr key={r.id}>
              <td>{r.nombre}</td>
              <td>{asesores.find((a) => a.id === r.asesor_id)?.nombre_completo ?? '—'}</td>
              <td>{r.ciudad}</td>
              <td>
                <button onClick={() => seleccionar(r.id)}>Ver compromisos</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {retailerSeleccionado && (
        <div className="tarjeta-form">
          <h3>Compromisos de {retailers.find((r) => r.id === retailerSeleccionado)?.nombre}</h3>
          <table className="tabla-conteo">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Mínimo</th>
                <th>Objetivo</th>
                <th>Activo</th>
              </tr>
            </thead>
            <tbody>
              {compromisos.map((c) => (
                <tr key={c.id}>
                  <td>{productos.find((p) => p.id === c.producto_id)?.nombre ?? c.producto_id}</td>
                  <td>{c.minimo_unidades}</td>
                  <td>{c.objetivo_unidades}</td>
                  <td>
                    <button onClick={() => toggleCompromiso(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fila-agregar">
            <select
              value={nuevoCompromiso.producto_id}
              onChange={(e) => setNuevoCompromiso({ ...nuevoCompromiso, producto_id: e.target.value })}
            >
              <option value="">Elegir producto…</option>
              {productos
                .filter((p) => !compromisos.some((c) => c.producto_id === p.id && c.activo))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
            </select>
            <input
              type="number"
              min={0}
              placeholder="mínimo"
              value={nuevoCompromiso.minimo_unidades}
              onChange={(e) => setNuevoCompromiso({ ...nuevoCompromiso, minimo_unidades: Number(e.target.value) })}
            />
            <input
              type="number"
              min={0}
              placeholder="objetivo"
              value={nuevoCompromiso.objetivo_unidades}
              onChange={(e) => setNuevoCompromiso({ ...nuevoCompromiso, objetivo_unidades: Number(e.target.value) })}
            />
            <button onClick={agregarCompromiso} disabled={!nuevoCompromiso.producto_id}>
              Agregar compromiso
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
