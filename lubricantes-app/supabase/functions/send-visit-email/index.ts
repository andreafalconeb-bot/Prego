// Edge Function: envía al retailer un correo con el cálculo de ventas y la
// reposición sugerida de una visita. Se invoca desde la app del asesor al
// tocar "Enviar correo al retail con este cálculo" (ver web/src/pages/Visita.tsx).
//
// Variables de entorno requeridas (configurar con `supabase secrets set`):
//   RESEND_API_KEY       - API key de Resend (https://resend.com) para enviar el correo
//   REMITENTE_EMAIL      - dirección "from" verificada en Resend, ej. reposicion@tudominio.com
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente
// en runtime de Edge Functions.

import { createClient } from 'npm:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const REMITENTE_EMAIL = Deno.env.get('REMITENTE_EMAIL') ?? 'reposicion@example.com'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

interface Payload {
  visita_id: string
}

function formatoMoneda(valor: number): string {
  return `$${valor.toFixed(2)}`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 })
  }
  if (!payload.visita_id) {
    return new Response(JSON.stringify({ error: 'falta visita_id' }), { status: 400 })
  }

  const { data: visita, error: errorVisita } = await supabaseAdmin
    .from('visitas')
    .select('*, retailers(nombre, email)')
    .eq('id', payload.visita_id)
    .single()

  if (errorVisita || !visita) {
    return new Response(JSON.stringify({ error: 'visita no encontrada' }), { status: 404 })
  }

  const retailer = visita.retailers as { nombre: string; email: string | null } | null
  if (!retailer?.email) {
    return new Response(JSON.stringify({ error: 'el retailer no tiene email registrado' }), { status: 422 })
  }

  const { data: pedidos } = await supabaseAdmin
    .from('pedidos_sugeridos')
    .select('*, productos(nombre, sku, costo_unitario)')
    .eq('visita_id', payload.visita_id)

  const filas = (pedidos ?? [])
    .map((p) => {
      const producto = p.productos as { nombre: string; sku: string; costo_unitario: number } | null
      const valorAproximado = p.unidades_vendidas_calculadas * (producto?.costo_unitario ?? 0)
      return `<tr>
        <td>${producto?.nombre ?? p.producto_id}</td>
        <td style="text-align:right">${p.unidades_vendidas_calculadas}</td>
        <td style="text-align:right">${formatoMoneda(valorAproximado)}</td>
        <td style="text-align:right">${p.unidades_autorizadas ?? p.unidades_sugeridas}</td>
      </tr>`
    })
    .join('\n')

  const html = `
    <h2>Resumen de visita — ${retailer.nombre}</h2>
    <p>Fecha: ${new Date(visita.fecha_hora).toLocaleString()}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <thead>
        <tr><th>Producto</th><th>Vendido (uds.)</th><th>Valor aprox.</th><th>Reposición autorizada</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <p>Este correo fue generado automáticamente por la app del asesor MOBIL Retail.</p>
  `

  let estado: 'enviado' | 'error' = 'enviado'
  let errorDetalle: string | null = null

  if (!RESEND_API_KEY) {
    estado = 'error'
    errorDetalle = 'RESEND_API_KEY no configurada en las variables de entorno de la función.'
  } else {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: REMITENTE_EMAIL,
          to: retailer.email,
          subject: `Resumen de visita y reposición sugerida — ${retailer.nombre}`,
          html,
        }),
      })
      if (!resp.ok) {
        estado = 'error'
        errorDetalle = `Resend respondió ${resp.status}: ${await resp.text()}`
      }
    } catch (err) {
      estado = 'error'
      errorDetalle = err instanceof Error ? err.message : String(err)
    }
  }

  await supabaseAdmin.from('correos_enviados').insert({
    visita_id: payload.visita_id,
    retailer_id: visita.retailer_id,
    destinatario: retailer.email,
    asunto: `Resumen de visita y reposición sugerida — ${retailer.nombre}`,
    estado,
    error_detalle: errorDetalle,
  })

  return new Response(JSON.stringify({ estado, error: errorDetalle }), {
    status: estado === 'enviado' ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  })
})
