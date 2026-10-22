-- =============================================================================
-- Stock & Reorden — Esquema base (PostgreSQL 15+ / Supabase)
-- =============================================================================
-- Principios de diseño:
--   1. El LIBRO DE MOVIMIENTOS (stock_movements) es la fuente de verdad. El stock
--      de inventory.on_hand es un caché mantenido por trigger. Esto hace trivial
--      la sincronización offline: el cliente solo AGREGA eventos, nunca edita.
--   2. Cada movimiento lleva un UUID generado en el teléfono → reintentos de
--      sincronización idempotentes (ON CONFLICT DO NOTHING).
--   3. Dinero siempre en NUMERIC (nunca float). El USD es la moneda de referencia;
--      el VES se calcula con la tasa del día y se CONGELA en cada documento.
--   4. Cantidades en NUMERIC(12,3): los talleres venden aceite a granel por litro
--      (tambor de 208 L, cuñete), no solo por unidad cerrada.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------
create type retailer_type      as enum ('lubricentro', 'taller', 'repuestos', 'autoperiquito', 'flota', 'otro');
create type member_role        as enum ('owner', 'counter');            -- dueño / mostrador
create type uom                as enum ('unit', 'liter');               -- unidad cerrada / granel
create type movement_type      as enum (
  'purchase_in',      -- entrada por compra (nota de entrega)
  'return_in',        -- devolución de cliente
  'service_out',      -- salida por servicio (cambio de aceite)
  'sale_out',         -- venta de mostrador
  'loss_out',         -- merma, derrame, vencido
  'adjustment',       -- ajuste manual con signo
  'count'             -- conteo físico: fija el stock (delta calculado en servidor)
);
create type movement_source    as enum ('manual', 'barcode', 'ocr', 'b2b_delivery_qr', 'count', 'system');
create type abc_class          as enum ('A', 'B', 'C', 'N');           -- N = sin movimiento
create type order_status       as enum (
  'draft', 'pending_rep', 'submitted', 'accepted', 'rejected',
  'partially_fulfilled', 'fulfilled', 'delivered', 'cancelled', 'failed'
);
create type order_trigger      as enum ('auto_alert', 'manual', 'sales_rep');
create type alert_type         as enum ('below_rop', 'stockout', 'negative_stock', 'no_count_30d');

-- ---------------------------------------------------------------------------
-- Estructura comercial de la distribuidora
-- ---------------------------------------------------------------------------
create table zones (
  id            smallserial primary key,
  name          text not null unique,               -- "Valencia Norte", "Maracay"
  state         text not null
);

create table sales_reps (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users (id) on delete set null,
  full_name       text not null,
  phone_whatsapp  text not null,                    -- E.164: +58412...
  zone_id         smallint references zones (id),
  active          boolean not null default true
);

-- ---------------------------------------------------------------------------
-- retailers: el taller / lubricentro (cliente de la distribuidora)
-- ---------------------------------------------------------------------------
create table retailers (
  id                      uuid primary key default gen_random_uuid(),
  b2b_customer_id         text unique,               -- ID del cliente en la tienda B2B
  rif                     text not null unique
                          check (rif ~ '^[JGVEP]-?[0-9]{8}-?[0-9]$'),
  business_name           text not null,             -- razón social
  trade_name              text,                      -- nombre comercial
  type                    retailer_type not null default 'lubricentro',
  phone_whatsapp          text,
  address                 text,
  city                    text,
  zone_id                 smallint references zones (id),
  sales_rep_id            uuid references sales_reps (id),
  -- Parámetros de reposición por defecto (se heredan a cada SKU)
  default_lead_time_days  smallint not null default 2 check (default_lead_time_days between 0 and 30),
  review_period_days      smallint not null default 7 check (review_period_days between 1 and 30),
  weekly_cash_budget_usd  numeric(12,2),             -- tope de compra semanal (flujo de caja)
  -- Gobierno de datos: el taller decide qué ve la distribuidora
  share_consumption_data  boolean not null default false,
  share_consent_at        timestamptz,
  created_at              timestamptz not null default now(),
  constraint consent_has_date check (not share_consumption_data or share_consent_at is not null)
);

create table retailer_members (
  retailer_id  uuid not null references retailers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         member_role not null default 'counter',
  created_at   timestamptz not null default now(),
  primary key (retailer_id, user_id)
);
create index on retailer_members (user_id);

-- ---------------------------------------------------------------------------
-- Catálogo maestro (Mobil + otras marcas que el taller también vende)
-- ---------------------------------------------------------------------------
create table products (
  id                  uuid primary key default gen_random_uuid(),
  distributor_sku     text unique,                  -- null = producto que la distribuidora no vende
  brand               text not null,                -- 'Mobil', 'Castrol', 'genérico'...
  name                text not null,                -- 'Mobil Super 2000 10W-30 1 qt'
  category            text not null default 'motor_oil'
                      check (category in ('motor_oil','transmission','hydraulic','grease',
                                          'coolant','filter','additive','other')),
  viscosity           text,                         -- '10W-30', '15W-40', '20W-50'
  base_uom            uom not null default 'unit',
  volume_l            numeric(8,3),                 -- litros por unidad (0.946 qt, 4, 18.9, 208)
  units_per_case      integer not null default 1 check (units_per_case > 0),  -- múltiplo de compra
  is_distributor_item boolean generated always as (distributor_sku is not null) stored,
  created_by_retailer uuid references retailers (id),   -- productos "propios" creados en el taller
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Un producto puede tener varios códigos de barra (EAN de unidad, de caja, etiqueta interna)
create table product_barcodes (
  barcode     text primary key,
  product_id  uuid not null references products (id) on delete cascade,
  pack_units  integer not null default 1 check (pack_units > 0)  -- 12 si es el EAN de la caja
);
create index on product_barcodes (product_id);

-- Espejo del catálogo B2B (lo llena catalog-sync, nunca la app)
create table b2b_catalog (
  product_id      uuid primary key references products (id) on delete cascade,
  price_usd       numeric(12,4) not null check (price_usd >= 0),  -- precio por unidad base, sin IVA
  available       boolean not null default true,
  stock_band      text check (stock_band in ('high','low','out')),  -- no exponer stock exacto
  min_order_units integer not null default 1,
  updated_at      timestamptz not null default now()
);

-- Tasa oficial. Fuente de verdad = la tasa con la que FACTURA la distribuidora.
create table exchange_rates (
  rate_date    date primary key,
  ves_per_usd  numeric(18,6) not null check (ves_per_usd > 0),
  source       text not null default 'BCV',
  fetched_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- inventory: stock del taller por SKU
-- ---------------------------------------------------------------------------
create table inventory (
  id              uuid primary key default gen_random_uuid(),
  retailer_id     uuid not null references retailers (id) on delete cascade,
  product_id      uuid not null references products (id),
  on_hand         numeric(12,3) not null default 0,   -- caché: Σ stock_movements.qty_delta
  on_order        numeric(12,3) not null default 0,   -- pedido y no recibido (evita pedir doble)
  avg_cost_usd    numeric(12,4),                      -- costo promedio ponderado
  sale_price_usd  numeric(12,4),
  abc             abc_class not null default 'N',
  last_count_at   timestamptz,
  updated_at      timestamptz not null default now(),
  unique (retailer_id, product_id)
);
create index on inventory (retailer_id, abc);

-- ---------------------------------------------------------------------------
-- stock_movements: libro inmutable (append-only)
-- ---------------------------------------------------------------------------
create table stock_movements (
  id              uuid primary key,                   -- generado en el teléfono (idempotencia)
  retailer_id     uuid not null references retailers (id) on delete cascade,
  inventory_id    uuid not null references inventory (id),
  type            movement_type not null,
  qty_delta       numeric(12,3) not null,             -- con signo; en 'count' lo calcula el servidor
  counted_qty     numeric(12,3),                      -- solo para 'count'
  unit_cost_usd   numeric(12,4),                      -- en entradas
  unit_price_usd  numeric(12,4),                      -- en salidas (para margen / ABC por valor)
  ves_per_usd     numeric(18,6),                      -- tasa congelada al momento del movimiento
  source          movement_source not null default 'manual',
  reference       text,                               -- n° nota de entrega, placa, n° pedido
  b2b_order_id    uuid,                               -- si la entrada viene de un pedido del puente
  occurred_at     timestamptz not null,               -- hora del teléfono
  received_at     timestamptz not null default now(), -- hora del servidor
  device_id       text,
  created_by      uuid references auth.users (id),
  constraint sign_matches_type check (
    case type
      when 'purchase_in' then qty_delta > 0
      when 'return_in'   then qty_delta > 0
      when 'service_out' then qty_delta < 0
      when 'sale_out'    then qty_delta < 0
      when 'loss_out'    then qty_delta < 0
      when 'adjustment'  then qty_delta <> 0
      when 'count'       then counted_qty is not null and counted_qty >= 0
    end
  ),
  constraint occurred_not_future check (occurred_at <= received_at + interval '10 minutes')
);
create index on stock_movements (inventory_id, occurred_at desc);
create index on stock_movements (retailer_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- reorder_rules: parámetros y resultado del cálculo por SKU
-- ---------------------------------------------------------------------------
create table reorder_rules (
  inventory_id        uuid primary key references inventory (id) on delete cascade,
  retailer_id         uuid not null references retailers (id) on delete cascade,
  mode                text not null default 'auto' check (mode in ('auto','manual','off')),
  -- Parámetros (null = heredar del retailer / del algoritmo)
  lead_time_days      smallint check (lead_time_days between 0 and 30),
  service_level       numeric(4,3) check (service_level between 0.5 and 0.999),
  manual_rop          numeric(12,3),                  -- si mode = 'manual'
  manual_safety_stock numeric(12,3),
  max_qty             numeric(12,3),                  -- tope físico / de caja
  -- Resultado del último cálculo (lo escribe el job nocturno)
  avg_daily_demand    numeric(12,4),
  demand_std_daily    numeric(12,4),
  safety_stock        numeric(12,3),
  reorder_point       numeric(12,3),
  order_up_to         numeric(12,3),
  computed_at         timestamptz
);
create index on reorder_rules (retailer_id);

-- ---------------------------------------------------------------------------
-- b2b_orders_bridge: pedidos generados por la app y su vida en la tienda B2B
-- ---------------------------------------------------------------------------
create table b2b_orders_bridge (
  id                uuid primary key default gen_random_uuid(),
  retailer_id       uuid not null references retailers (id),
  idempotency_key   text not null unique,              -- lo genera el teléfono
  status            order_status not null default 'draft',
  trigger           order_trigger not null,
  b2b_order_ref     text unique,                        -- ID/número del pedido en la tienda B2B
  rate_date         date references exchange_rates (rate_date),
  ves_per_usd       numeric(18,6),                      -- tasa congelada
  subtotal_usd      numeric(14,2) not null default 0,
  subtotal_ves      numeric(18,2) generated always as (round(subtotal_usd * coalesce(ves_per_usd, 0), 2)) stored,
  payment_currency  text check (payment_currency in ('USD','VES')),
  notes             text,
  last_error        text,
  submitted_at      timestamptz,
  rep_notified_at   timestamptz,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on b2b_orders_bridge (retailer_id, created_at desc);
create index on b2b_orders_bridge (status) where status in ('draft','pending_rep','submitted','accepted');

create table b2b_order_lines (
  order_id          uuid not null references b2b_orders_bridge (id) on delete cascade,
  product_id        uuid not null references products (id),
  distributor_sku   text not null,
  qty_units         numeric(12,3) not null check (qty_units > 0),   -- ya redondeado a caja
  suggested_units   numeric(12,3),                                   -- lo que propuso el algoritmo
  unit_price_usd    numeric(12,4) not null,
  line_total_usd    numeric(14,2) generated always as (round(qty_units * unit_price_usd, 2)) stored,
  fulfilled_units   numeric(12,3),
  reason            jsonb,                                           -- explicación (stock, PR, ABC)
  primary key (order_id, product_id)
);

-- Bitácora de webhooks recibidos desde la tienda (idempotente por event_id)
create table b2b_webhook_events (
  event_id     text primary key,
  order_id     uuid references b2b_orders_bridge (id),
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- stock_alerts: una alerta abierta por SKU y tipo (no spamear al mecánico)
-- ---------------------------------------------------------------------------
create table stock_alerts (
  id            bigserial primary key,
  retailer_id   uuid not null references retailers (id) on delete cascade,
  inventory_id  uuid not null references inventory (id) on delete cascade,
  type          alert_type not null,
  payload       jsonb,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create unique index stock_alerts_one_open on stock_alerts (inventory_id, type) where resolved_at is null;

-- =============================================================================
-- Lógica en base de datos
-- =============================================================================

-- Completa/valida el movimiento antes de insertarlo y bloquea la fila de inventario
create or replace function trg_movement_before_insert() returns trigger
language plpgsql as $$
declare
  inv inventory%rowtype;
begin
  select * into inv from inventory where id = new.inventory_id for update;
  if not found or inv.retailer_id <> new.retailer_id then
    raise exception 'inventory % no pertenece al retailer %', new.inventory_id, new.retailer_id;
  end if;

  if new.type = 'count' then
    -- Conteo físico: el delta es la diferencia contra el stock del servidor.
    -- Limitación conocida: si hay ventas offline registradas ANTES del conteo
    -- pero sincronizadas DESPUÉS, el conteo queda corrido. Se mitiga con
    -- ordenar el outbox por occurred_at al sincronizar (ver docs/05).
    new.qty_delta := new.counted_qty - inv.on_hand;
  end if;
  return new;
end $$;

-- Aplica el movimiento al caché de inventario y recalcula costo promedio
create or replace function trg_movement_after_insert() returns trigger
language plpgsql as $$
begin
  update inventory i set
    on_hand = i.on_hand + new.qty_delta,
    avg_cost_usd = case
      when new.type = 'purchase_in' and new.unit_cost_usd is not null then
        case when i.on_hand <= 0 or i.avg_cost_usd is null then new.unit_cost_usd
             else round((i.on_hand * i.avg_cost_usd + new.qty_delta * new.unit_cost_usd)
                        / (i.on_hand + new.qty_delta), 4)
        end
      else i.avg_cost_usd
    end,
    -- Una entrada ligada a un pedido del puente descuenta lo "en tránsito"
    on_order = case when new.type = 'purchase_in' and new.b2b_order_id is not null
                    then greatest(i.on_order - new.qty_delta, 0) else i.on_order end,
    last_count_at = case when new.type = 'count' then new.occurred_at else i.last_count_at end,
    updated_at = now()
  where i.id = new.inventory_id;

  -- Stock negativo = el sistema está desfasado de la realidad. No se bloquea la
  -- venta (el aceite está físicamente en el estante); se pide un conteo.
  insert into stock_alerts (retailer_id, inventory_id, type, payload)
  select new.retailer_id, new.inventory_id, 'negative_stock', jsonb_build_object('on_hand', i.on_hand)
  from inventory i where i.id = new.inventory_id and i.on_hand < 0
  on conflict do nothing;

  return null;
end $$;

create trigger movement_before_insert before insert on stock_movements
  for each row execute function trg_movement_before_insert();
create trigger movement_after_insert after insert on stock_movements
  for each row execute function trg_movement_after_insert();

-- El libro es inmutable: correcciones = nuevo movimiento 'adjustment'
create or replace function trg_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements es append-only; registre un ajuste';
end $$;
create trigger movement_immutable before update or delete on stock_movements
  for each row execute function trg_block_mutation();

-- Demanda diaria (salidas) de los últimos 90 días, con días en cero incluidos.
-- Insumo del algoritmo de ABC y punto de reorden (packages/core).
create or replace view v_daily_demand as
with days as (
  select generate_series(current_date - 89, current_date, interval '1 day')::date as day
)
select i.id as inventory_id, i.retailer_id, d.day,
       coalesce(sum(-m.qty_delta) filter (where m.type in ('service_out','sale_out')), 0) as qty_out,
       coalesce(sum(-m.qty_delta * coalesce(m.unit_price_usd, i.sale_price_usd, 0))
                filter (where m.type in ('service_out','sale_out')), 0) as revenue_usd
from inventory i
cross join days d
left join stock_movements m
  on m.inventory_id = i.id
 and m.occurred_at >= d.day
 and m.occurred_at <  d.day + 1
group by i.id, i.retailer_id, d.day;

-- RPC de sincronización por lotes desde el outbox del teléfono.
-- Devuelve los IDs aceptados (incluye duplicados ya existentes → el cliente los borra del outbox).
create or replace function sync_movements(p_movements jsonb)
returns table (id uuid, status text)
language plpgsql security invoker as $$
declare
  m jsonb;
begin
  for m in select * from jsonb_array_elements(p_movements)
           order by (value->>'occurred_at')::timestamptz      -- orden causal
  loop
    begin
      insert into stock_movements (id, retailer_id, inventory_id, type, qty_delta, counted_qty,
                                   unit_cost_usd, unit_price_usd, ves_per_usd, source, reference,
                                   b2b_order_id, occurred_at, device_id, created_by)
      values ((m->>'id')::uuid, (m->>'retailer_id')::uuid, (m->>'inventory_id')::uuid,
              (m->>'type')::movement_type, coalesce((m->>'qty_delta')::numeric, 0),
              (m->>'counted_qty')::numeric, (m->>'unit_cost_usd')::numeric,
              (m->>'unit_price_usd')::numeric, (m->>'ves_per_usd')::numeric,
              coalesce((m->>'source')::movement_source, 'manual'), m->>'reference',
              (m->>'b2b_order_id')::uuid, (m->>'occurred_at')::timestamptz,
              m->>'device_id', auth.uid())
      on conflict on constraint stock_movements_pkey do nothing;
      id := (m->>'id')::uuid; status := 'ok'; return next;
    exception when others then
      -- Un movimiento inválido no debe bloquear el resto del lote
      id := (m->>'id')::uuid; status := 'error: ' || sqlerrm; return next;
    end;
  end loop;
end $$;

-- =============================================================================
-- Row Level Security: cada taller solo ve lo suyo; el vendedor ve su zona
-- SOLO si el taller dio consentimiento.
-- =============================================================================
create or replace function is_member(p_retailer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from retailer_members where retailer_id = p_retailer and user_id = auth.uid());
$$;

create or replace function is_rep_with_consent(p_retailer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from retailers r join sales_reps s on s.id = r.sales_rep_id
    where r.id = p_retailer and s.user_id = auth.uid() and r.share_consumption_data
  );
$$;

alter table retailers         enable row level security;
alter table retailer_members  enable row level security;
alter table inventory         enable row level security;
alter table stock_movements   enable row level security;
alter table reorder_rules     enable row level security;
alter table b2b_orders_bridge enable row level security;
alter table b2b_order_lines   enable row level security;
alter table stock_alerts      enable row level security;
alter table products          enable row level security;
alter table product_barcodes  enable row level security;
alter table b2b_catalog       enable row level security;
alter table exchange_rates    enable row level security;

create policy retailer_read on retailers for select using (is_member(id) or is_rep_with_consent(id));
create policy members_read  on retailer_members for select using (user_id = auth.uid());

create policy inv_read   on inventory for select using (is_member(retailer_id) or is_rep_with_consent(retailer_id));
create policy inv_insert on inventory for insert with check (is_member(retailer_id));
create policy inv_update on inventory for update using (is_member(retailer_id))
  with check (is_member(retailer_id));   -- precio de venta; on_hand lo mueve el trigger

create policy mov_read   on stock_movements for select using (is_member(retailer_id) or is_rep_with_consent(retailer_id));
create policy mov_insert on stock_movements for insert with check (is_member(retailer_id) and created_by = auth.uid());

create policy rules_rw on reorder_rules for all using (is_member(retailer_id)) with check (is_member(retailer_id));

create policy orders_read on b2b_orders_bridge for select using (is_member(retailer_id) or is_rep_with_consent(retailer_id));
create policy lines_read  on b2b_order_lines for select
  using (exists (select 1 from b2b_orders_bridge o where o.id = order_id
                 and (is_member(o.retailer_id) or is_rep_with_consent(o.retailer_id))));
-- Los pedidos se crean SOLO vía Edge Function (service_role), que valida precios.

create policy alerts_read on stock_alerts for select using (is_member(retailer_id));

create policy catalog_read  on products for select using (
  auth.role() = 'authenticated' and (created_by_retailer is null or is_member(created_by_retailer)));
create policy catalog_insert on products for insert with check (
  distributor_sku is null and created_by_retailer is not null and is_member(created_by_retailer));
create policy barcodes_read on product_barcodes for select using (auth.role() = 'authenticated');
create policy b2b_cat_read  on b2b_catalog for select using (auth.role() = 'authenticated');
create policy rates_read    on exchange_rates for select using (auth.role() = 'authenticated');
