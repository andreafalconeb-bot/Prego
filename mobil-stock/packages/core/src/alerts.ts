import type { SkuState } from './types.ts';

export type AlertLevel = 'ok' | 'reorder' | 'critical' | 'stockout';

export interface StockAlert {
  inventoryId: string;
  level: AlertLevel;
  /** Posición de inventario = en estante + ya pedido y en camino. */
  position: number;
  /** Días que alcanza el stock en estante al ritmo actual (Infinity si no rota). */
  daysOfCover: number;
  message: string;
}

/**
 * Disparador: Stock ≤ PR.
 *
 * Se compara la POSICIÓN (on_hand + on_order), no solo on_hand: si ya hay un
 * pedido en camino y se usara solo on_hand, la app pediría de nuevo cada día
 * hasta que llegue la mercancía (pedido duplicado = caja del taller inmovilizada).
 */
export function evaluateAlert(s: SkuState, leadTimeDays: number): StockAlert {
  const position = s.onHand + s.onOrder;
  const daysOfCover = s.avgDailyDemand > 0 ? s.onHand / s.avgDailyDemand : Infinity;

  let level: AlertLevel = 'ok';
  if (s.onHand <= 0 && s.avgDailyDemand > 0) level = 'stockout';
  else if (position <= s.reorderPoint && daysOfCover < leadTimeDays) level = 'critical';
  else if (position <= s.reorderPoint) level = 'reorder';

  const days = Number.isFinite(daysOfCover) ? Math.floor(daysOfCover) : null;
  const message = {
    ok: `${s.name}: stock suficiente`,
    reorder: `${s.name}: te quedan ${fmt(s.onHand)} (≈${days} días). Toca pedir.`,
    critical: `${s.name}: solo ${fmt(s.onHand)}; no alcanza hasta que llegue el pedido.`,
    stockout: `${s.name}: AGOTADO. Estás perdiendo ventas.`,
  }[level];

  return { inventoryId: s.inventoryId, level, position, daysOfCover, message };
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
