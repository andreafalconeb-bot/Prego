import { useEffect, useState } from 'react'
import { contarPendientes, onSyncChange } from './sync'

export function useSyncStatus() {
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    const actualizarPendientes = () => {
      void contarPendientes().then(setPendientes)
    }
    actualizarPendientes()

    const offSync = onSyncChange(actualizarPendientes)
    const onOnline = () => setEnLinea(true)
    const onOffline = () => setEnLinea(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      offSync()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return { enLinea, pendientes }
}
