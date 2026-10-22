import type { AbcClass, DailySeries } from './types.ts';

/** Nivel de servicio objetivo por clase: más protección donde más se pierde. */
export const DEFAULT_SERVICE_LEVEL: Record<AbcClass, number> = { A: 0.97, B: 0.93, C: 0.85, N: 0 };

export interface DemandStats {
  avgDaily: number;
  stdDaily: number;
  observedDays: number; // días válidos (sin quiebre) usados en el cálculo
}

/**
 * Demanda diaria promedio y desviación estándar en la ventana.
 * Excluye días con quiebre de stock (demanda censurada): si no había aceite,
 * el 0 de ese día subestima la demanda real y el PR quedaría corto justo
 * en los SKUs que más se agotan.
 */
export function demandStats(s: DailySeries, windowDays = 60): DemandStats {
  const start = Math.max(0, s.qtyOut.length - windowDays);
  const valid: number[] = [];
  for (let i = start; i < s.qtyOut.length; i++) {
    if (!s.stockoutDays?.[i]) valid.push(Math.max(0, s.qtyOut[i]));
  }
  const n = valid.length;
  if (n === 0) return { avgDaily: 0, stdDaily: 0, observedDays: 0 };
  const avg = valid.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? valid.reduce((a, x) => a + (x - avg) ** 2, 0) / (n - 1) : 0;
  return { avgDaily: avg, stdDaily: Math.sqrt(variance), observedDays: n };
}

export interface ReorderParams {
  avgDaily: number;
  stdDaily: number;
  leadTimeDays: number;     // días desde que se pide hasta que llega al estante
  reviewPeriodDays: number; // cada cuánto se pide (visita del vendedor / ciclo de caja)
  serviceLevel: number;     // probabilidad de NO quebrar durante el lead time
  unitsPerCase?: number;
  /** Override manual del dueño: si viene, manda sobre el cálculo. */
  manualSafetyStock?: number;
  manualRop?: number;
  maxQty?: number;
}

export interface ReorderLevels {
  safetyStock: number;
  /** PR = (Venta diaria × Lead time) + Stock de seguridad */
  reorderPoint: number;
  /** Nivel objetivo al que se repone: cubre lead time + período de revisión. */
  orderUpTo: number;
}

/**
 * Punto de Reorden dinámico.
 *   SS  = z · σ_d · √LT
 *   PR  = d · LT + SS
 *   S   = d · (LT + R) + z · σ_d · √(LT + R)    (nivel "pedir hasta")
 *
 * Con piso: si el SKU rota (d > 0), PR ≥ 1 unidad, para que un SKU A de baja
 * venta diaria no termine con PR = 0 y solo alerte cuando ya está agotado.
 */
export function reorderLevels(p: ReorderParams): ReorderLevels {
  const z = p.serviceLevel > 0 ? normInv(p.serviceLevel) : 0;
  const lt = Math.max(0, p.leadTimeDays);
  const r = Math.max(1, p.reviewPeriodDays);

  const safetyStock = p.manualSafetyStock ?? z * p.stdDaily * Math.sqrt(lt);
  let reorderPoint = p.manualRop ?? p.avgDaily * lt + safetyStock;
  if (p.avgDaily > 0) reorderPoint = Math.max(reorderPoint, 1);

  let orderUpTo = p.avgDaily * (lt + r) + z * p.stdDaily * Math.sqrt(lt + r);
  orderUpTo = Math.max(orderUpTo, reorderPoint + (p.unitsPerCase ?? 1));
  if (p.maxQty != null) orderUpTo = Math.min(orderUpTo, p.maxQty);

  return { safetyStock: round3(safetyStock), reorderPoint: round3(reorderPoint), orderUpTo: round3(orderUpTo) };
}

/**
 * Inversa de la normal estándar (aproximación de Acklam, error relativo < 1.2e-9).
 * Evita depender de una librería estadística en el teléfono.
 */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('p debe estar en (0,1)');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
