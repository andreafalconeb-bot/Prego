// POST /api/v1/b2b/create-auto-order
// Recibe la propuesta aceptada por el taller y la convierte en pedido en la tienda B2B.
//
// Reglas de oro:
//  - El cliente NUNCA fija precios: se re-cotiza contra b2b_catalog en el servidor.
//  - Idempotente por idempotency_key: un doble toque o un reintento offline no duplica.
//  - Si la tienda falla, el pedido queda 'failed' (reintentable) y el vendedor se entera:
//    el taller nunca se queda sin respuesta.
import { admin, cors, json, problem, requireMember, requireUser } from '../_shared/http.ts';
import { storeAdapterFromEnv } from '../_shared/b2b-adapter.ts';

interface Body {
  retailer_id: string;
  idempotency_key: string;
  trigger: 'auto_alert' | 'manual' | 'sales_rep';
  payment_currency: 'USD' | 'VES';
  notes?: string;
  lines: { product_id: string; qty_units: number; suggested_units?: number; reason?: unknown }[];
}

// 'rep_review': el vendedor confirma (crédito, sustitutos) antes de enviar. Recomendado al inicio.
// 'direct': se envía directo a la tienda.
const SUBMIT_MODE = Deno.env.get('ORDER_SUBMIT_MODE') ?? 'rep_review';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return problem(405, 'method_not_allowed', 'Use POST');

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let body: Body;
  try { body = await req.json(); } catch { return problem(400, 'invalid_json', 'JSON inválido'); }
  const v = validate(body);
  if (v) return problem(422, 'validation_error', v);

  const db = admin();
  if (!(await requireMember(db, auth.userId, body.retailer_id))) {
    return problem(403, 'forbidden', 'No perteneces a este comercio');
  }

  // 1. Idempotencia
  const existing = await db.from('b2b_orders_bridge')
    .select('id, status, b2b_order_ref, subtotal_usd, subtotal_ves, ves_per_usd')
    .eq('idempotency_key', body.idempotency_key).maybeSingle();
  if (existing.data) return json(200, { order: existing.data, replayed: true });

  // 2. Re-cotizar en servidor
  const productIds = body.lines.map((l) => l.product_id);
  const [{ data: catalog }, { data: rate }, { data: retailer }] = await Promise.all([
    db.from('b2b_catalog')
      .select('product_id, price_usd, available, min_order_units, products!inner(distributor_sku, units_per_case, name)')
      .in('product_id', productIds),
    db.from('exchange_rates').select('rate_date, ves_per_usd').order('rate_date', { ascending: false }).limit(1).single(),
    db.from('retailers').select('b2b_customer_id, trade_name, business_name, sales_reps(full_name, phone_whatsapp)')
      .eq('id', body.retailer_id).single(),
  ]);
  if (!rate) return problem(503, 'no_rate', 'No hay tasa cargada; intente en unos minutos');
  if (!retailer?.b2b_customer_id) return problem(409, 'not_linked', 'El comercio no está vinculado a la tienda B2B');

  const byId = new Map((catalog ?? []).map((c: any) => [c.product_id, c]));
  const lines = [];
  const unavailable: string[] = [];
  for (const l of body.lines) {
    const c: any = byId.get(l.product_id);
    if (!c || !c.available) { unavailable.push(c?.products?.name ?? l.product_id); continue; }
    const perCase = c.products.units_per_case as number;
    const qty = Math.max(c.min_order_units, Math.ceil(l.qty_units / perCase) * perCase); // múltiplo de caja
    lines.push({
      product_id: l.product_id,
      distributor_sku: c.products.distributor_sku,
      qty_units: qty,
      suggested_units: l.suggested_units ?? null,
      unit_price_usd: Number(c.price_usd),
      reason: l.reason ?? null,
    });
  }
  if (lines.length === 0) return problem(409, 'nothing_available', 'Ningún producto está disponible', { unavailable });
  const subtotal = round2(lines.reduce((a, l) => a + l.qty_units * l.unit_price_usd, 0));

  // 3. Persistir (pedido + líneas). Si la inserción de líneas falla, se borra la cabecera.
  const { data: order, error: oErr } = await db.from('b2b_orders_bridge').insert({
    retailer_id: body.retailer_id,
    idempotency_key: body.idempotency_key,
    trigger: body.trigger,
    status: SUBMIT_MODE === 'direct' ? 'draft' : 'pending_rep',
    rate_date: rate.rate_date,
    ves_per_usd: rate.ves_per_usd,
    subtotal_usd: subtotal,
    payment_currency: body.payment_currency,
    notes: body.notes,
    created_by: auth.userId,
  }).select('id').single();
  if (oErr) {
    if (oErr.code === '23505') return problem(409, 'duplicate', 'Pedido ya registrado; reintente la consulta');
    return problem(500, 'db_error', oErr.message);
  }
  const { error: lErr } = await db.from('b2b_order_lines').insert(lines.map((l) => ({ ...l, order_id: order.id })));
  if (lErr) {
    await db.from('b2b_orders_bridge').delete().eq('id', order.id);
    return problem(500, 'db_error', lErr.message);
  }

  // 4. Marcar mercancía "en camino" para que la alerta no vuelva a pedir lo mismo
  await db.rpc('add_on_order', { p_order_id: order.id });

  // 5. Enviar a la tienda (modo directo) o dejar para revisión del vendedor
  let status = SUBMIT_MODE === 'direct' ? 'submitted' : 'pending_rep';
  let orderRef: string | null = null;
  if (SUBMIT_MODE === 'direct') {
    try {
      const r = await storeAdapterFromEnv().createOrder({
        bridgeOrderId: order.id,
        idempotencyKey: body.idempotency_key,
        b2bCustomerId: retailer.b2b_customer_id,
        paymentCurrency: body.payment_currency,
        vesPerUsd: Number(rate.ves_per_usd),
        notes: body.notes,
        lines: lines.map((l) => ({ distributorSku: l.distributor_sku, qtyUnits: l.qty_units, unitPriceUsd: l.unit_price_usd })),
      });
      orderRef = r.orderRef;
      status = r.status;
    } catch (e) {
      status = 'failed';
      await db.from('b2b_orders_bridge').update({ last_error: String(e) }).eq('id', order.id);
    }
  }
  await db.from('b2b_orders_bridge').update({
    status, b2b_order_ref: orderRef,
    submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id);

  // 6. Aviso al vendedor de zona: enlace wa.me (gratis). Migrar a WhatsApp Cloud API en fase 2.
  const rep: any = retailer.sales_reps;
  const shop = retailer.trade_name ?? retailer.business_name;
  const waText = encodeURIComponent(
    `Pedido app ${shop}: ${lines.length} productos, USD ${subtotal.toFixed(2)}. ` +
    `Estado: ${status}. Ref: ${orderRef ?? order.id.slice(0, 8)}`);
  const repWhatsappUrl = rep?.phone_whatsapp ? `https://wa.me/${rep.phone_whatsapp.replace(/\D/g, '')}?text=${waText}` : null;

  return json(201, {
    order: {
      id: order.id,
      status,
      b2b_order_ref: orderRef,
      rate_date: rate.rate_date,
      ves_per_usd: Number(rate.ves_per_usd),
      subtotal_usd: subtotal,
      subtotal_ves: round2(subtotal * Number(rate.ves_per_usd)),
      lines,
    },
    unavailable,
    rep_whatsapp_url: repWhatsappUrl,
  });
});

function validate(b: Body): string | null {
  if (!b || typeof b !== 'object') return 'Cuerpo vacío';
  if (!isUuid(b.retailer_id)) return 'retailer_id inválido';
  if (typeof b.idempotency_key !== 'string' || b.idempotency_key.length < 16 || b.idempotency_key.length > 100) {
    return 'idempotency_key debe tener 16–100 caracteres';
  }
  if (!['auto_alert', 'manual', 'sales_rep'].includes(b.trigger)) return 'trigger inválido';
  if (!['USD', 'VES'].includes(b.payment_currency)) return 'payment_currency inválida';
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 100) return 'lines debe tener 1–100 ítems';
  for (const l of b.lines) {
    if (!isUuid(l.product_id)) return 'product_id inválido';
    if (!(typeof l.qty_units === 'number' && l.qty_units > 0 && l.qty_units <= 10_000)) return 'qty_units fuera de rango';
  }
  return null;
}

const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const round2 = (x: number) => Math.round(x * 100) / 100;
