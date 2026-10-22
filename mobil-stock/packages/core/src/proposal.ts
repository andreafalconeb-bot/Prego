import type { AbcClass, SkuState } from './types.ts';

export interface ProposalLine {
  inventoryId: string;
  sku: string;
  name: string;
  /** Lo que pide la matemática (S − posición), sin redondear. */
  rawNeed: number;
  /** Cantidad final en unidades base, múltiplo de unitsPerCase. */
  qtyUnits: number;
  cases: number;
  lineUsd: number;
  reason: string;
}

export interface Proposal {
  lines: ProposalLine[];
  totalUsd: number;
  budgetUsd: number | null;
  /** SKUs que necesitaban reposición pero no cupieron en el presupuesto. */
  deferred: { inventoryId: string; name: string; missingUnits: number }[];
}

const CLASS_RANK: Record<AbcClass, number> = { A: 0, B: 1, C: 2, N: 3 };

/**
 * Propuesta de pedido "1-Clic" con presupuesto de caja.
 *
 * Los talleres compran "al día": el límite real no es el PR sino el efectivo
 * disponible. Por eso se reparte el presupuesto en dos pasadas:
 *   1. CUBRIR: por prioridad (A→B→C, menos días de cobertura primero), lo mínimo
 *      en cajas para sacar cada SKU por encima de su PR. Evita quiebres.
 *   2. LLENAR: con lo que sobre, completar hasta el nivel objetivo S, en el mismo orden.
 * Los SKU C nunca entran en la pasada 2 si hay A/B sin llenar.
 */
export function buildProposal(items: SkuState[], budgetUsd: number | null = null): Proposal {
  const candidates = items
    .filter((s) => s.abc !== 'N' && s.onHand + s.onOrder <= s.reorderPoint)
    .sort((x, y) =>
      CLASS_RANK[x.abc] - CLASS_RANK[y.abc] ||
      cover(x) - cover(y) ||
      x.sku.localeCompare(y.sku));

  let remaining = budgetUsd ?? Infinity;
  const cases = new Map<string, number>();
  const casePrice = (s: SkuState) => s.unitsPerCase * s.unitPriceUsd;

  // Pasada 1 — cubrir el punto de reorden
  for (const s of candidates) {
    const gap = s.reorderPoint - (s.onHand + s.onOrder);
    const need = Math.max(1, Math.ceil((gap + 1e-9) / s.unitsPerCase)); // al menos 1 caja
    const affordable = Math.min(need, Math.floor(remaining / casePrice(s)));
    if (affordable > 0) {
      cases.set(s.inventoryId, affordable);
      remaining -= affordable * casePrice(s);
    }
  }

  // Pasada 2 — llenar hasta S
  for (const s of candidates) {
    const have = cases.get(s.inventoryId) ?? 0;
    const target = Math.ceil(Math.max(0, s.orderUpTo - (s.onHand + s.onOrder)) / s.unitsPerCase);
    const extra = Math.min(Math.max(0, target - have), Math.floor(remaining / casePrice(s)));
    if (extra > 0) {
      cases.set(s.inventoryId, have + extra);
      remaining -= extra * casePrice(s);
    }
  }

  const lines: ProposalLine[] = [];
  const deferred: Proposal['deferred'] = [];
  for (const s of candidates) {
    const rawNeed = Math.max(0, s.orderUpTo - (s.onHand + s.onOrder));
    const n = cases.get(s.inventoryId) ?? 0;
    const qtyUnits = n * s.unitsPerCase;
    if (n > 0) {
      lines.push({
        inventoryId: s.inventoryId, sku: s.sku, name: s.name,
        rawNeed: round2(rawNeed), qtyUnits, cases: n,
        lineUsd: round2(qtyUnits * s.unitPriceUsd),
        reason: `Clase ${s.abc} · stock ${s.onHand} + en camino ${s.onOrder} ≤ PR ${s.reorderPoint}`,
      });
    }
    // Sigue en o bajo el PR después del pedido → no cupo en la caja de hoy
    const shortfall = s.reorderPoint - (s.onHand + s.onOrder + qtyUnits);
    if (shortfall >= 0) {
      deferred.push({ inventoryId: s.inventoryId, name: s.name, missingUnits: round2(shortfall) });
    }
  }

  return {
    lines,
    totalUsd: round2(lines.reduce((a, l) => a + l.lineUsd, 0)),
    budgetUsd,
    deferred,
  };
}

const cover = (s: SkuState) => (s.avgDailyDemand > 0 ? s.onHand / s.avgDailyDemand : Infinity);
const round2 = (x: number) => Math.round(x * 100) / 100;
