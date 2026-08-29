#!/usr/bin/env bash
# Deja un proyecto de Supabase listo para la app del asesor: aplica el
# esquema, configura el envío de correo y despliega la Edge Function.
#
# Requiere: tener ya creado el proyecto en https://supabase.com/dashboard
# y su project ref (Project Settings -> General -> Reference ID).
#
# Uso:
#   ./scripts/setup.sh <project-ref>
#
# Variables de entorno opcionales (si no se dan, ese paso se salta y te
# avisa cómo hacerlo después a mano):
#   RESEND_API_KEY      - para que la Edge Function pueda enviar correos
#   REMITENTE_EMAIL      - dirección "from" verificada en Resend

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="${1:-}"
if [ -z "$PROJECT_REF" ]; then
  echo "Uso: $0 <project-ref>"
  echo "El project ref está en el dashboard de Supabase: Project Settings -> General -> Reference ID"
  exit 1
fi

SUPABASE="npx --yes supabase"

echo "== 1/5: Iniciando sesión en Supabase (se abre el navegador si hace falta) =="
$SUPABASE login

echo "== 2/5: Vinculando el proyecto $PROJECT_REF =="
$SUPABASE link --project-ref "$PROJECT_REF"

echo "== 3/5: Aplicando el esquema (supabase/migrations/0001_init.sql) =="
$SUPABASE db push

echo "== 4/5: Configurando el envío de correo =="
if [ -n "${RESEND_API_KEY:-}" ]; then
  $SUPABASE secrets set RESEND_API_KEY="$RESEND_API_KEY"
  $SUPABASE secrets set REMITENTE_EMAIL="${REMITENTE_EMAIL:-reposicion@example.com}"
else
  echo "  RESEND_API_KEY no está en el entorno: salteado."
  echo "  Corré esto cuando tengas la cuenta de Resend lista:"
  echo "    npx supabase secrets set RESEND_API_KEY=tu_api_key"
  echo "    npx supabase secrets set REMITENTE_EMAIL=reposicion@tudominio.com"
fi

echo "== 5/5: Desplegando la Edge Function send-visit-email =="
$SUPABASE functions deploy send-visit-email

echo ""
echo "Listo. Próximos pasos:"
echo "  1. Cargar datos de demostración:"
echo "     cd web && SUPABASE_URL=https://$PROJECT_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run seed"
echo "     (la service_role key está en Project Settings -> API)"
echo "  2. Configurar el frontend: cd web && cp .env.example .env.local"
echo "     y completar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (Project Settings -> API)"
echo "  3. npm install && npm run dev"
