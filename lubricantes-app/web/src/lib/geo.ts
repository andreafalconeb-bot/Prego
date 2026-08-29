const EARTH_RADIUS_M = 6_371_000

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

export interface Coordenadas {
  lat: number
  lng: number
  precisionMetros: number
}

/** Obtiene la posición GPS actual del dispositivo (una sola lectura). */
export function obtenerPosicionActual(timeoutMs = 15_000): Promise<Coordenadas> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Este dispositivo/navegador no soporta geolocalización.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precisionMetros: pos.coords.accuracy,
        }),
      (err) => reject(new Error(`No se pudo obtener la ubicación: ${err.message}`)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}
