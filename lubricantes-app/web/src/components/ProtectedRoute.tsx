import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../lib/database.types'

export function ProtectedRoute({
  children,
  rolesPermitidos,
}: {
  children: ReactNode
  rolesPermitidos?: UserRole[]
}) {
  const { session, profile, cargando } = useAuth()

  if (cargando) return <div className="pantalla-centrada">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  if (rolesPermitidos && profile && !rolesPermitidos.includes(profile.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
