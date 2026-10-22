// Adaptador hacia la tienda B2B existente de la distribuidora.
//
// No sabemos aún sobre qué plataforma corre la tienda (WooCommerce, Shopify B2B,
// Odoo, desarrollo propio...). Por eso el puente habla con una INTERFAZ y cada
// plataforma es una implementación. Cambiar de tienda = cambiar el adaptador,
// no la app del taller.

export interface B2BOrderLine {
  distributorSku: string;
  qtyUnits: number;
  unitPriceUsd: number;
}

export interface B2BCreateOrderInput {
  bridgeOrderId: string;      // nuestro UUID; la tienda lo guarda como referencia externa
  idempotencyKey: string;
  b2bCustomerId: string;
  lines: B2BOrderLine[];
  paymentCurrency: 'USD' | 'VES';
  vesPerUsd: number;
  notes?: string;
}

export interface B2BCreateOrderResult {
  orderRef: string;           // número de pedido en la tienda
  status: 'submitted' | 'accepted';
  storeUrl?: string;
}

export interface B2BCatalogItem {
  distributorSku: string;
  priceUsd: number;
  available: boolean;
  stockBand: 'high' | 'low' | 'out';
  minOrderUnits: number;
}

export interface B2BStoreAdapter {
  createOrder(input: B2BCreateOrderInput): Promise<B2BCreateOrderResult>;
  fetchCatalog(customerId?: string): Promise<B2BCatalogItem[]>;
}

/**
 * Adaptador REST genérico: sirve para una tienda propia o como plantilla.
 * Para WooCommerce: POST /wp-json/wc/v3/orders con `customer_id`, `line_items[{product_id, quantity}]`
 * (requiere mapear SKU → product_id) y `meta_data` con el bridgeOrderId.
 */
export class RestStoreAdapter implements B2BStoreAdapter {
  constructor(private baseUrl: string, private apiKey: string, private timeoutMs = 15_000) {}

  async createOrder(input: B2BCreateOrderInput): Promise<B2BCreateOrderResult> {
    const res = await this.request('POST', '/orders', {
      external_ref: input.bridgeOrderId,
      customer_id: input.b2bCustomerId,
      currency: input.paymentCurrency,
      exchange_rate: input.vesPerUsd,
      notes: input.notes,
      source: 'app-stock-reorden',
      items: input.lines.map((l) => ({ sku: l.distributorSku, qty: l.qtyUnits, unit_price_usd: l.unitPriceUsd })),
    }, input.idempotencyKey);
    return { orderRef: String(res.order_number ?? res.id), status: 'submitted', storeUrl: res.url };
  }

  async fetchCatalog(customerId?: string): Promise<B2BCatalogItem[]> {
    const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
    const res = await this.request('GET', `/catalog${qs}`);
    return (res.items as any[]).map((i) => ({
      distributorSku: i.sku,
      priceUsd: Number(i.price_usd),
      available: Boolean(i.available),
      stockBand: i.stock > 50 ? 'high' : i.stock > 0 ? 'low' : 'out',
      minOrderUnits: Number(i.min_qty ?? 1),
    }));
  }

  private async request(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Tienda B2B ${method} ${path} → ${res.status}: ${await res.text()}`);
    return await res.json();
  }
}

export function storeAdapterFromEnv(): B2BStoreAdapter {
  return new RestStoreAdapter(Deno.env.get('B2B_STORE_URL')!, Deno.env.get('B2B_STORE_API_KEY')!);
}
