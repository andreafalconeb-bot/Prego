import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Ruta } from './pages/Ruta'
import { Visita } from './pages/Visita'
import { Catalogo } from './pages/admin/Catalogo'
import { Retailers } from './pages/admin/Retailers'
import { Despachos } from './pages/admin/Despachos'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Ruta />} />
          <Route path="/visita/:retailerId" element={<Visita />} />
          <Route
            path="/admin/catalogo"
            element={
              <ProtectedRoute rolesPermitidos={['admin']}>
                <Catalogo />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/retailers"
            element={
              <ProtectedRoute rolesPermitidos={['admin']}>
                <Retailers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/despachos"
            element={
              <ProtectedRoute rolesPermitidos={['admin']}>
                <Despachos />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
