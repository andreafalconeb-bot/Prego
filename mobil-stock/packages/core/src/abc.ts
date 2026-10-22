import type { AbcClass, DailySeries } from './types.ts';

export interface AbcOptions {
  /** Días hacia atrás a considerar. Default 30 (pedido de negocio); ver docs/03 sobre 60–90. */
  windowDays?: number;
  /** Corte acumulado para A y B. Default Pareto clásico 80 / 95. */
  aCut?: number;
  bCut?: number;
  /** 'revenue' prioriza lo que deja dinero; 'units' lo que más rota. */
  basis?: 'revenue' | 'units';
}

export interface AbcResult {
  inventoryId: string;
  value: number;
  share: number;      // participación individual (0–1)
  cumShare: number;   // participación acumulada incluyendo este SKU
  abc: AbcClass;
}

/**
 * Clasificación ABC (Pareto) sobre la ventana más reciente.
 *
 * Regla de borde: un SKU es A si la participación acumulada ANTES de sumarlo es
 * menor que aCut. Así el SKU que "cruza" el 80 % queda en A — con catálogos de
 * 15–40 SKUs (un taller típico) la otra convención deja A casi vacío.
 */
export function classifyAbc(series: DailySeries[], opts: AbcOptions = {}): AbcResult[] {
  const { windowDays = 30, aCut = 0.8, bCut = 0.95, basis = 'revenue' } = opts;

  const values = series.map((s) => {
    const src = basis === 'revenue' && s.revenueUsd ? s.revenueUsd : s.qtyOut;
    const value = sum(src.slice(-windowDays));
    return { inventoryId: s.inventoryId, value: Math.max(value, 0) };
  });

  const total = sum(values.map((v) => v.value));
  // Orden estable: valor desc, luego id para que el resultado sea determinista.
  values.sort((a, b) => b.value - a.value || a.inventoryId.localeCompare(b.inventoryId));

  let cum = 0;
  return values.map(({ inventoryId, value }) => {
    if (value === 0 || total === 0) {
      return { inventoryId, value, share: 0, cumShare: total === 0 ? 0 : cum / total, abc: 'N' };
    }
    const before = cum / total;
    cum += value;
    const abc: AbcClass = before < aCut ? 'A' : before < bCut ? 'B' : 'C';
    return { inventoryId, value, share: value / total, cumShare: cum / total, abc };
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
