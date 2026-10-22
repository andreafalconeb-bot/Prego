// POST /api/v1/b2b/webhooks  (lo llama la TIENDA B2B, no la app)
// Eventos: order.accepted | order.rejected | order.fulfilled | order.cancelled | catalog.updated
// Seguridad: firma HMAC-SHA256 del cuerpo crudo en `x-signature: t=<unix>,v1=<hex>`,
// ventana de 5 minutos contra replay, e idempotencia por event_id.
import { admin, json, problem } from '../_shared/http.ts';

const SECRET = Deno.env.get('B2B_WEBHOOK_SECRET')!;
const STATUS: Record<string, string> = {
  'order.accepted': 'accepted',
  'order.rejected': 'rejected',
  'order.partially_fulfilled': 'partially_fulfilled',
  'order.fulfilled': 'fulfilled',
  'order.cancelled': 'cancelled',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return problem(405, 'method_not_allowed', 'Use POST');
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get('x-signature')))) return problem(401, 'bad_signature', 'Firma inválida');

  const evt = JSON.parse(raw) as {
    event_id: string; type: string;
    data: { external_ref?: string; order_ref?: string; lines?: { sku: string; fulfilled_qty: number }[] };
  };
  const db = admin();

  // Idempotencia: si el event_id ya existe, responder 200 sin reprocesar
  const ins = await db.from('b2b_webhook_events')
    .insert({ event_id: evt.event_id, event_type: evt.type, payload: evt, order_id: evt.data.external_ref ?? null });
  if (ins.error?.code === '23505') return json(200, { ok: true, duplicate: true });
  if (ins.error) return problem(500, 'db_error', ins.error.message);

  const status = STATUS[evt.type];
  if (status && evt.data.external_ref) {
    // Cantidades realmente despachadas (pueden diferir de lo pedido)
    for (const l of evt.data.lines ?? []) {
      await db.from('b2b_order_lines').update({ fulfilled_units: l.fulfilled_qty })
        .eq('order_id', evt.data.external_ref).eq('distributor_sku', l.sku);
    }
    if (evt.data.order_ref) {
      await db.from('b2b_orders_bridge').update({ b2b_order_ref: evt.data.order_ref }).eq('id', evt.data.external_ref);
    }
    const { error } = await db.rpc('apply_order_status', { p_order_id: evt.data.external_ref, p_status: status });
    if (error) return problem(500, 'db_error', error.message); // la tienda reintentará
  }
  await db.from('b2b_webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', evt.event_id);
  return json(200, { ok: true });
});

async function verify(raw: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, parts.v1 ?? '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
