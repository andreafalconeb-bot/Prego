import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAbc, demandStats, reorderLevels, normInv, evaluateAlert, buildProposal,
  type DailySeries, type SkuState,
} from '../src/index.ts';

const days = (n: number, v: number) => Array.from({ length: n }, () => v);

test('ABC: Pareto por valor, el SKU que cruza el 80 % queda en A, sin venta = N', () => {
  const series: DailySeries[] = [
    { inventoryId: 'a', qtyOut: days(30, 1), revenueUsd: days(30, 70) }, // 2100 → 70 %
    { inventoryId: 'b', qtyOut: days(30, 1), revenueUsd: days(30, 20) }, //  600 → 90 % acumulado
    { inventoryId: 'c', qtyOut: days(30, 1), revenueUsd: days(30, 7) },  //  210 → 97 %
    { inventoryId: 'd', qtyOut: days(30, 1), revenueUsd: days(30, 3) },  //   90 → 100 %
    { inventoryId: 'e', qtyOut: days(30, 0), revenueUsd: days(30, 0) },
  ];
  const r = Object.fromEntries(classifyAbc(series).map((x) => [x.inventoryId, x.abc]));
  assert.deepEqual(r, { a: 'A', b: 'A', c: 'B', d: 'C', e: 'N' });
});

test('ABC: solo cuenta la ventana reciente', () => {
  const series: DailySeries[] = [
    { inventoryId: 'viejo', qtyOut: [...days(60, 10), ...days(30, 0)] },
    { inventoryId: 'nuevo', qtyOut: [...days(60, 0), ...days(30, 1)] },
  ];
  const r = classifyAbc(series, { basis: 'units', windowDays: 30 });
  assert.equal(r.find((x) => x.inventoryId === 'viejo')!.abc, 'N');
  assert.equal(r.find((x) => x.inventoryId === 'nuevo')!.abc, 'A');
});

test('demanda: los días agotados no cuentan como demanda cero', () => {
  const s: DailySeries = {
    inventoryId: 'x',
    qtyOut: [4, 4, 4, 0, 0, 0],
    stockoutDays: [false, false, false, true, true, true],
  };
  assert.equal(demandStats(s).avgDaily, 4);
  assert.equal(demandStats({ ...s, stockoutDays: undefined }).avgDaily, 2);
});

test('normInv coincide con tablas', () => {
  assert.ok(Math.abs(normInv(0.95) - 1.6449) < 1e-4);
  assert.ok(Math.abs(normInv(0.975) - 1.96) < 1e-3);
  assert.ok(Math.abs(normInv(0.5)) < 1e-9);
});

test('PR = d·LT + SS', () => {
  // 6 L/día, LT 2 días, σ 2, 95 % → SS = 1.645·2·√2 ≈ 4.652; PR ≈ 16.652
  const r = reorderLevels({ avgDaily: 6, stdDaily: 2, leadTimeDays: 2, reviewPeriodDays: 7, serviceLevel: 0.95 });
  assert.ok(Math.abs(r.safetyStock - 4.652) < 0.01);
  assert.ok(Math.abs(r.reorderPoint - 16.652) < 0.01);
  assert.ok(r.orderUpTo > r.reorderPoint);
});

test('PR: override manual del dueño manda', () => {
  const r = reorderLevels({ avgDaily: 6, stdDaily: 2, leadTimeDays: 2, reviewPeriodDays: 7, serviceLevel: 0.95, manualRop: 24 });
  assert.equal(r.reorderPoint, 24);
});

const sku = (o: Partial<SkuState>): SkuState => ({
  inventoryId: 'i', sku: 'S', name: 'Aceite', onHand: 10, onOrder: 0, unitsPerCase: 12,
  unitPriceUsd: 5, abc: 'A', avgDailyDemand: 4, demandStdDaily: 1, reorderPoint: 12, orderUpTo: 40, ...o,
});

test('alerta: usa posición (stock + en camino) para no pedir doble', () => {
  assert.equal(evaluateAlert(sku({ onHand: 10 }), 2).level, 'reorder');
  assert.equal(evaluateAlert(sku({ onHand: 10, onOrder: 24 }), 2).level, 'ok');
  assert.equal(evaluateAlert(sku({ onHand: 0 }), 2).level, 'stockout');
  assert.equal(evaluateAlert(sku({ onHand: 5 }), 2).level, 'critical'); // 1.25 días < LT 2
});

test('propuesta: redondea a caja y llena hasta S sin presupuesto', () => {
  const p = buildProposal([sku({ onHand: 10 })]);
  // necesita 40 − 10 = 30 → 3 cajas de 12 = 36
  assert.equal(p.lines[0].qtyUnits, 36);
  assert.equal(p.totalUsd, 180);
  assert.equal(p.deferred.length, 0);
});

test('propuesta con presupuesto: prioriza cubrir el PR de A antes que llenar o comprar C', () => {
  const items = [
    sku({ inventoryId: 'A1', sku: 'A1', abc: 'A', onHand: 2 }),              // necesita 1 caja para PR
    sku({ inventoryId: 'C1', sku: 'C1', abc: 'C', onHand: 1, avgDailyDemand: 0.2, reorderPoint: 2, orderUpTo: 6 }),
    sku({ inventoryId: 'B1', sku: 'B1', abc: 'B', onHand: 5 }),
  ];
  const p = buildProposal(items, 120); // alcanza para 2 cajas de 60
  assert.deepEqual(p.lines.map((l) => [l.inventoryId, l.cases]), [['A1', 1], ['B1', 1]]);
  assert.deepEqual(p.deferred.map((d) => d.inventoryId), ['C1']);
  assert.ok(p.totalUsd <= 120);
});

test('propuesta ignora SKUs sobre el PR y los sin movimiento', () => {
  const p = buildProposal([sku({ onHand: 50 }), sku({ inventoryId: 'n', abc: 'N', onHand: 0 })]);
  assert.equal(p.lines.length, 0);
});
