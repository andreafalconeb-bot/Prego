import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useSyncStatus } from '../lib/useSyncStatus'

export function Layout() {
  const { profile, cerrarSesion } = useAuth()
  const { enLinea, pendientes } = useSyncStatus()

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="marca">MOBIL Retail</div>
        <div className={`estado-conexion ${enLinea ? 'en-linea' : 'sin-conexion'}`}>
          {enLinea ? 'En línea' : 'Sin conexión'}
          {pendientes > 0 && <span className="badge-pendientes">{pendientes} por sincronizar</span>}
        </div>
        <div className="usuario">
          <span>{profile?.nombre_completo}</span>
          <button onClick={cerrarSesion}>Salir</button>
        </div>
      </header>
      <nav className="layout-nav">
        <NavLink to="/" end>
          Mi ruta
        </NavLink>
        {profile?.role === 'admin' && (
          <>
            <NavLink to="/admin/catalogo">Catálogo</NavLink>
            <NavLink to="/admin/retailers">Retailers</NavLink>
            <NavLink to="/admin/despachos">Despachos</NavLink>
          </>
        )}
      </nav>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  )
}
