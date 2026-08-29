// Lógica de cálculo de ventas y sugerencia de reposición, descrita en el
// documento de negocio: "si una referencia bajó del inventario mínimo que
// debería tener se debe sugerir aumentar un poco las compras, si está por
// arriba ajustar el algoritmo a vender menos".
//
// Funciones puras (sin I/O) para poder razonarlas/testearlas fácil.

/** Si cae bajo el mínimo, se sugiere un 10% más para no volver a quedar corto. */
const FACTOR_AJUSTE_BAJO_MINIMO = 1.1
/** Si está en o sobre el mínimo, se sugiere un 10% menos: se está vendiendo
 * más lento que lo previsto, no conviene sobre-stockear al retailer. */
const FACTOR_AJUSTE_SOBRE_MINIMO = 0.9

export function calcularUnidadesVendidas(
  inventarioAnterior: number,
  despachadoDesdeVisitaAnterior: number,
  inventarioActual: number,
): number {
  return Math.max(0, inventarioAnterior + despachadoDesdeVisitaAnterior - inventarioActual)
}

export interface SugerenciaReposicion {
  /** Unidades para llegar al objetivo, antes de ajustar por tendencia. */
  brechaBase: number
  /** Sugerencia final, redondeada, con el ajuste de tendencia aplicado. */
  unidadesSugeridas: number
  /** true si el conteo actual está por debajo del mínimo comprometido. */
  bajoMinimo: boolean
}

export function calcularSugerenciaReposicion(
  inventarioActual: number,
  minimoUnidades: number,
  objetivoUnidades: number,
): SugerenciaReposicion {
  const bajoMinimo = inventarioActual < minimoUnidades
  const brechaBase = Math.max(0, objetivoUnidades - inventarioActual)
  const factor = bajoMinimo ? FACTOR_AJUSTE_BAJO_MINIMO : FACTOR_AJUSTE_SOBRE_MINIMO
  const unidadesSugeridas = brechaBase === 0 ? 0 : Math.round(brechaBase * factor)
  return { brechaBase, unidadesSugeridas, bajoMinimo }
}

export function calcularValorAproximado(unidades: number, costoUnitario: number): number {
  return Math.round(unidades * costoUnitario * 100) / 100
}
