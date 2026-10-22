# Stock & Reorden

App de inventario offline-first para talleres y lubricentros, más un puente API hacia la tienda B2B de la distribuidora (pedidos de reposición "1-Clic").

📘 **Guía completa (diagnóstico, modelo de negocio y los 6 módulos):** [`docs/GUIA.md`](docs/GUIA.md)

## Estructura

```
mobil-stock/
├── docs/GUIA.md                      Guía técnica y de negocio
├── api/openapi.yaml                  Contrato de la API (OpenAPI 3.1, validado con Redocly)
├── packages/core/                    Motor de inventario en TypeScript (sin dependencias)
│   ├── src/abc.ts                    Clasificación ABC (Pareto)
│   ├── src/reorder.ts                Demanda, stock de seguridad, punto de reorden, nivel S
│   ├── src/alerts.ts                 Disparador Stock + Tránsito ≤ PR
│   ├── src/proposal.ts               Propuesta de pedido con presupuesto de caja
│   └── test/core.test.ts             10 tests (node:test)
└── supabase/
    ├── migrations/0001_core_schema.sql      Tablas, triggers, RLS, RPC de sincronización
    ├── migrations/0002_order_lifecycle.sql  on_order, estados, recepción por QR
    ├── functions/create-auto-order/         POST /b2b/create-auto-order
    ├── functions/catalog-sync/              GET  /b2b/catalog-sync
    ├── functions/b2b-webhook/               Webhooks firmados desde la tienda
    ├── functions/ocr-delivery-note/         OCR de notas (fase 2, Claude Vision)
    ├── functions/_shared/                   Adaptador de tienda B2B, utilidades HTTP
    └── tests/run.sh                         Valida migraciones contra Postgres real
```

## Probar

```bash
# Motor de inventario (Node ≥ 22.18, sin npm install)
cd packages/core && npm test

# Esquema SQL contra un Postgres local
./supabase/tests/run.sh
```

## Qué está probado y qué no

| Componente | Estado |
|---|---|
| `packages/core` | ✅ 10 tests pasando |
| Migraciones SQL | ✅ Aplicadas en Postgres 16, con smoke test de libro, conteo, costo promedio, inmutabilidad, idempotencia, ciclo de pedido y tasa VES |
| `openapi.yaml` | ✅ Validado con Redocly |
| Edge Functions (Deno) | ⚠️ Escritas contra las APIs de Supabase/Deno, pero **no ejecutadas** (falta un proyecto Supabase y la tienda B2B real) |
| PWA | 📄 Especificada (módulo 5, con fragmentos de código); se construye en las semanas 1–2 del roadmap |
