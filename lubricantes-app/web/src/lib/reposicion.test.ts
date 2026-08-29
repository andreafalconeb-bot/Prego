import { describe, expect, it } from 'vitest'
import { calcularSugerenciaReposicion, calcularUnidadesVendidas, calcularValorAproximado } from './reposicion'

describe('calcularUnidadesVendidas', () => {
  it('vendido = anterior + despachado - actual', () => {
    // Ejemplo del documento de negocio: llegó con 8, se despacharon 12 en el
    // período, ahora cuenta 5 -> vendió 15.
    expect(calcularUnidadesVendidas(8, 12, 5)).toBe(15)
  })

  it('sin despacho ni conteo anterior (primera visita)', () => {
    expect(calcularUnidadesVendidas(0, 0, 3)).toBe(0)
  })

  it('nunca da negativo aunque el conteo actual sea mayor al esperado (posible error de conteo)', () => {
    expect(calcularUnidadesVendidas(2, 0, 10)).toBe(0)
  })
})

describe('calcularSugerenciaReposicion', () => {
  it('bajo el mínimo: sugiere la brecha al objetivo + 10%', () => {
    // Ejemplo del documento: aceite de motor, mínimo 7. Cae a 2.
    const r = calcularSugerenciaReposicion(2, 7, 12)
    expect(r.bajoMinimo).toBe(true)
    expect(r.brechaBase).toBe(10) // objetivo(12) - actual(2)
    expect(r.unidadesSugeridas).toBe(11) // round(10 * 1.1)
  })

  it('en o sobre el mínimo: sugiere la brecha al objetivo - 10%', () => {
    const r = calcularSugerenciaReposicion(8, 7, 12)
    expect(r.bajoMinimo).toBe(false)
    expect(r.brechaBase).toBe(4) // objetivo(12) - actual(8)
    expect(r.unidadesSugeridas).toBe(4) // round(4 * 0.9) = round(3.6) = 4
  })

  it('en el objetivo: no sugiere nada', () => {
    const r = calcularSugerenciaReposicion(12, 7, 12)
    expect(r.unidadesSugeridas).toBe(0)
  })

  it('por encima del objetivo: no sugiere nada (no baja de cero)', () => {
    const r = calcularSugerenciaReposicion(20, 7, 12)
    expect(r.brechaBase).toBe(0)
    expect(r.unidadesSugeridas).toBe(0)
  })

  it('ATF Dexron IV, ejemplo del documento (mínimo 2)', () => {
    const r = calcularSugerenciaReposicion(0, 2, 4)
    expect(r.bajoMinimo).toBe(true)
    expect(r.unidadesSugeridas).toBe(4) // round(4 * 1.1) = round(4.4) = 4
  })
})

describe('calcularValorAproximado', () => {
  it('multiplica unidades por costo unitario, redondeado a centavos', () => {
    expect(calcularValorAproximado(15, 8.5)).toBe(127.5)
  })

  it('redondea a 2 decimales', () => {
    expect(calcularValorAproximado(3, 3.333)).toBe(10) // 3*3.333=9.999 -> 10.00
  })
})
