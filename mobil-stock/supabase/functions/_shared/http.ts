import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key, if-none-match',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors, ...extra } });

export const problem = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { error: { code, message, details } });

/** Cliente con privilegios de servicio (salta RLS). Solo dentro de Edge Functions. */
export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

/** Valida el JWT del usuario de la app y devuelve su id. */
export async function requireUser(req: Request): Promise<{ userId: string } | Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return problem(401, 'unauthorized', 'Falta el token');
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return problem(401, 'unauthorized', 'Token inválido o vencido');
  return { userId: data.user.id };
}

export async function requireMember(db: SupabaseClient, userId: string, retailerId: string) {
  const { data } = await db.from('retailer_members').select('role')
    .eq('retailer_id', retailerId).eq('user_id', userId).maybeSingle();
  return data?.role as 'owner' | 'counter' | undefined;
}
