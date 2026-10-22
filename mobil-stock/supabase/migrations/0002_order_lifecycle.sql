-- =============================================================================
-- Ciclo de vida del pedido B2B ↔ inventario del taller
-- =============================================================================

-- Al crear un pedido: sumar a on_order (crea la fila de inventario si el SKU es nuevo para el taller)
create or replace function add_on_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inventory (retailer_id, product_id)
  select o.retailer_id, l.product_id
  from b2b_order_lines l join b2b_orders_bridge o on o.id = l.order_id
  where o.id = p_order_id
  on conflict (retailer_id, product_id) do nothing;

  update inventory i set on_order = i.on_order + l.qty_units, updated_at = now()
  from b2b_order_lines l join b2b_orders_bridge o on o.id = l.order_id
  where o.id = p_order_id and i.retailer_id = o.retailer_id and i.product_id = l.product_id;
end $$;

-- Cambio de estado recibido por webhook. Cancelado/rechazado libera on_order.
create or replace function apply_order_status(p_order_id uuid, p_status order_status) returns void
language plpgsql security definer set search_path = public as $$
declare
  prev order_status;
begin
  select status into prev from b2b_orders_bridge where id = p_order_id for update;
  if prev is null then raise exception 'pedido % no existe', p_order_id; end if;
  if prev in ('cancelled','rejected','delivered') then return; end if;   -- estados terminales

  if p_status in ('cancelled','rejected') then
    update inventory i set on_order = greatest(i.on_order - l.qty_units, 0), updated_at = now()
    from b2b_order_lines l join b2b_orders_bridge o on o.id = l.order_id
    where o.id = p_order_id and i.retailer_id = o.retailer_id and i.product_id = l.product_id;
  end if;

  update b2b_orders_bridge set status = p_status, updated_at = now() where id = p_order_id;
end $$;

-- Recepción en 1 escaneo: el taller escanea el QR de la nota de entrega
-- (contiene el id del pedido) y se generan las entradas exactas, sin OCR ni tipeo.
-- Idempotente: cada línea genera un movimiento con UUID determinista.
create or replace function receive_b2b_order(p_order_id uuid, p_device_id text default null)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  o b2b_orders_bridge%rowtype;
  n integer;
begin
  select * into o from b2b_orders_bridge where id = p_order_id;
  if not found then raise exception 'pedido no encontrado'; end if;     -- RLS: solo miembros lo ven
  if not is_member(o.retailer_id) then raise exception 'sin permiso'; end if;

  insert into stock_movements (id, retailer_id, inventory_id, type, qty_delta, unit_cost_usd,
                               ves_per_usd, source, reference, b2b_order_id, occurred_at, device_id, created_by)
  select
    -- UUID v5-like determinista (md5 del par pedido+producto) → re-escanear no duplica
    md5(p_order_id::text || l.product_id::text)::uuid,
    o.retailer_id, i.id, 'purchase_in',
    coalesce(l.fulfilled_units, l.qty_units), l.unit_price_usd,
    o.ves_per_usd, 'b2b_delivery_qr', coalesce(o.b2b_order_ref, o.id::text), o.id, now(), p_device_id, auth.uid()
  from b2b_order_lines l
  join inventory i on i.retailer_id = o.retailer_id and i.product_id = l.product_id
  where l.order_id = p_order_id and coalesce(l.fulfilled_units, l.qty_units) > 0
  on conflict on constraint stock_movements_pkey do nothing;
  get diagnostics n = row_count;

  if n > 0 then
    update b2b_orders_bridge set status = 'delivered', updated_at = now() where id = p_order_id;
  end if;
  return n;
end $$;

-- receive_b2b_order inserta como el usuario (RLS aplica); necesita poder actualizar el estado:
create policy orders_mark_delivered on b2b_orders_bridge for update
  using (is_member(retailer_id)) with check (is_member(retailer_id) and status = 'delivered');
