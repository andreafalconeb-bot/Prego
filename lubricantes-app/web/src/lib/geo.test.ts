import { describe, expect, it } from 'vitest'
import { distanciaMetros } from './geo'

describe('distanciaMetros', () => {
  it('el mismo punto da distancia 0', () => {
    expect(distanciaMetros(10.4806, -66.9036, 10.4806, -66.9036)).toBe(0)
  })

  it('un grado de longitud en el ecuador son ~111.2 km', () => {
    const d = distanciaMetros(0, 0, 0, 1)
    expect(d).toBeCloseTo(111_195, -2)
  })

  it('detecta que un punto a ~50 m está dentro de un radio de verificación de 150 m', () => {
    // Retailer de ejemplo (Caracas). Desplazamiento de ~0.00045° en latitud
    // equivale a unos 50 m.
    const retailerLat = 10.4806
    const retailerLng = -66.9036
    const d = distanciaMetros(retailerLat + 0.00045, retailerLng, retailerLat, retailerLng)
    expect(d).toBeLessThan(150)
  })

  it('detecta que un punto a ~1 km está fuera de un radio de verificación de 150 m', () => {
    const retailerLat = 10.4806
    const retailerLng = -66.9036
    const d = distanciaMetros(retailerLat + 0.009, retailerLng, retailerLat, retailerLng)
    expect(d).toBeGreaterThan(150)
  })
})
