// POST /api/v1/ocr/delivery-note   (FASE 2 — no es parte del MVP)
// Foto de una nota de entrega de un proveedor TERCERO → líneas estructuradas para confirmar.
// Las notas de la propia distribuidora NO pasan por aquí: se reciben escaneando su QR
// (receive_b2b_order), que es exacto, gratis e instantáneo.
//
// Usa visión de Claude con salida estructurada (JSON Schema). El resultado SIEMPRE se muestra
// al usuario para confirmar antes de crear movimientos: un OCR nunca escribe inventario solo.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { admin, cors, json, problem, requireMember, requireUser } from '../_shared/http.ts';

const client = new Anthropic(); // lee ANTHROPIC_API_KEY de los secretos de la función

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'document_number', 'date', 'currency', 'lines', 'legible'],
  properties: {
    supplier: { type: ['string', 'null'] },
    document_number: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    currency: { type: ['string', 'null'], enum: ['USD', 'VES', null] },
    legible: { type: 'boolean', description: 'false si la foto no permite leer las líneas con confianza' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'description', 'qty', 'unit_price', 'confidence'],
        properties: {
          code: { type: ['string', 'null'], description: 'Código o SKU tal como aparece' },
          description: { type: 'string' },
          qty: { type: 'number' },
          unit_price: { type: ['number', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
} as const;

const PROMPT = `Eres un asistente que transcribe notas de entrega de lubricantes y repuestos en Venezuela.
Extrae cada línea de producto de la imagen. Reglas:
- Transcribe códigos y descripciones tal cual; no inventes SKUs ni completes datos ilegibles (usa null).
- "qty" es la cantidad entregada en la unidad del documento (unidades, cajas, litros); si dice "CJ x12", escribe la cantidad de cajas y deja "x12" en la descripción.
- Montos con coma decimal venezolana ("1.234,50") → número 1234.5.
- Marca confidence "low" en cualquier línea con dígitos dudosos.
- Si la foto está borrosa o cortada, legible=false.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const { retailer_id, image_base64, media_type } = await req.json();
  if (!(await requireMember(admin(), auth.userId, retailer_id))) return problem(403, 'forbidden', 'Sin permiso');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(media_type)) return problem(422, 'validation_error', 'Formato no soportado');
  if (typeof image_base64 !== 'string' || image_base64.length > 7_000_000) {
    return problem(413, 'too_large', 'Comprima la foto en el teléfono (máx. ~5 MB)');
  }

  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      // Si un clasificador de seguridad rechaza la solicitud (falso positivo), la API la
      // re-ejecuta en el modelo de respaldo recomendado en la misma llamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    } as any);

    if (res.stop_reason === 'refusal') return problem(422, 'ocr_refused', 'No se pudo procesar la imagen');
    if (res.stop_reason === 'max_tokens') return problem(422, 'ocr_truncated', 'Nota demasiado larga; tome fotos por partes');
    const text = res.content.find((b: any) => b.type === 'text') as { text: string } | undefined;
    if (!text) return problem(502, 'ocr_empty', 'Respuesta vacía');
    const parsed = JSON.parse(text.text);

    // Emparejar con el catálogo por código de barras / SKU; lo que no case queda para elegir a mano.
    const codes = parsed.lines.map((l: any) => l.code).filter(Boolean);
    const { data: matches } = await admin().from('products').select('id, distributor_sku, name').in('distributor_sku', codes);
    const bySku = new Map((matches ?? []).map((m: any) => [m.distributor_sku, m]));
    parsed.lines = parsed.lines.map((l: any) => ({ ...l, match: l.code ? bySku.get(l.code) ?? null : null }));

    return json(200, { draft: parsed, requires_confirmation: true });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return problem(429, 'busy', 'Servicio ocupado, reintente en 1 minuto');
    if (e instanceof Anthropic.APIError) return problem(502, 'ocr_upstream', `Error del servicio OCR (${e.status})`);
    throw e;
  }
});
