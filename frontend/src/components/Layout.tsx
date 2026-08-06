import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Panel", end: true },
  { to: "/visits", label: "Registros" },
  { to: "/simulator", label: "Simulador de cámara" },
  { to: "/cameras", label: "Cámaras" },
  { to: "/reports", label: "Reportes" },
  { to: "/audit", label: "Tickets y auditoría" },
  { to: "/settings", label: "Configuración" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Control de Estacionamiento</h1>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-box">
          <div>{user?.full_name || user?.username}</div>
          <div className="muted">{user?.role === "ADMIN" ? "Administrador" : "Operador"}</div>
          <button className="logout-btn" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
