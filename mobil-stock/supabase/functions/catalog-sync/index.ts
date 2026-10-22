// GET /api/v1/b2b/catalog-sync?since=<ISO-8601>
// Delta del catálogo B2B (precio USD, precio VES a tasa del día, disponibilidad) para el teléfono.
// - `since` → solo cambios desde la última sync (ahorra datos móviles).
// - ETag / If-None-Match → 304 sin cuerpo si nada cambió.
// La tabla b2b_catalog la alimenta un job programado contra la tienda, no esta función.
import { admin, cors, json, problem, requireUser } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'GET') return problem(405, 'method_not_allowed', 'Use GET');
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  if (since && Number.isNaN(Date.parse(since))) return problem(422, 'validation_error', 'since debe ser ISO-8601');

  const db = admin();
  const { data: rate } = await db.from('exchange_rates').select('rate_date, ves_per_usd, source')
    .order('rate_date', { ascending: false }).limit(1).single();
  if (!rate) return problem(503, 'no_rate', 'Tasa no disponible');

  let q = db.from('b2b_catalog')
    .select('price_usd, available, stock_band, min_order_units, updated_at, ' +
            'products!inner(id, distributor_sku, brand, name, category, viscosity, base_uom, volume_l, units_per_case, active, ' +
            'product_barcodes(barcode, pack_units))')
    .order('updated_at', { ascending: true });
  if (since) q = q.gt('updated_at', since);
  const { data, error } = await q;
  if (error) return problem(500, 'db_error', error.message);

  const vesPerUsd = Number(rate.ves_per_usd);
  const items = (data ?? []).map((r: any) => ({
    product_id: r.products.id,
    sku: r.products.distributor_sku,
    brand: r.products.brand,
    name: r.products.name,
    category: r.products.category,
    viscosity: r.products.viscosity,
    base_uom: r.products.base_uom,
    volume_l: r.products.volume_l,
    units_per_case: r.products.units_per_case,
    barcodes: r.products.product_barcodes,
    price_usd: Number(r.price_usd),
    price_ves: Math.round(Number(r.price_usd) * vesPerUsd * 100) / 100,
    available: r.available && r.products.active,
    stock_band: r.stock_band,
    min_order_units: r.min_order_units,
    updated_at: r.updated_at,
  }));

  const cursor = items.at(-1)?.updated_at ?? since ?? null;
  const etag = `W/"${rate.rate_date}-${cursor}-${items.length}"`;
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...cors, etag } });

  return json(200, {
    rate: { date: rate.rate_date, ves_per_usd: vesPerUsd, source: rate.source },
    items,
    next_since: cursor,
    full: !since,
  }, { etag, 'cache-control': 'private, max-age=300' });
});
