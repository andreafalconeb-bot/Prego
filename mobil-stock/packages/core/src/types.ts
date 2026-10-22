// Tipos compartidos por el motor de inventario.
// El mismo código corre en el teléfono (offline), en el job nocturno y en la Edge Function.

export type AbcClass = 'A' | 'B' | 'C' | 'N'; // N = sin movimiento en la ventana

/** Serie diaria de salidas de un SKU (días sin venta = 0, NO omitidos). */
export interface DailySeries {
  inventoryId: string;
  /** Unidades base vendidas/consumidas por día, del más antiguo al más reciente. */
  qtyOut: number[];
  /** Ingreso en USD por día (para ABC por valor). Mismo largo que qtyOut. */
  revenueUsd?: number[];
  /**
   * true en los días en que el SKU estuvo agotado. Esos días se EXCLUYEN del
   * cálculo de demanda: un 0 por quiebre de stock no es "no hubo demanda".
   */
  stockoutDays?: boolean[];
}

export interface SkuState {
  inventoryId: string;
  sku: string;
  name: string;
  onHand: number;
  onOrder: number;
  unitsPerCase: number;
  unitPriceUsd: number; // precio de compra B2B por unidad base
  abc: AbcClass;
  avgDailyDemand: number;
  demandStdDaily: number;
  reorderPoint: number;
  orderUpTo: number;
}
