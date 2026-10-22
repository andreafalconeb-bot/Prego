#!/usr/bin/env bash
# Valida las migraciones contra un Postgres local (no requiere Supabase CLI).
# Uso: ./run.sh   (requiere psql y un servidor con usuario postgres)
set -euo pipefail
cd "$(dirname "$0")"
DB=${DB:-stock_test}
PSQL=${PSQL:-"sudo -u postgres psql"}
$PSQL -qc "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase_stub.sql \
  $(printf -- '-f %s ' ../migrations/*.sql) -f smoke_test.sql
