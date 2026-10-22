-- Prueba de humo: libro de movimientos, conteo, costo promedio, inmutabilidad, idempotencia.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into retailers (id, rif, business_name) values ('10000000-0000-0000-0000-000000000001', 'J-12345678-9', 'Lubricentro El Pistón');
insert into retailer_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');
insert into products (id, distributor_sku, brand, name, viscosity, volume_l, units_per_case)
  values ('20000000-0000-0000-0000-000000000001', 'MOB-S2000-1030-QT', 'Mobil', 'Mobil Super 2000 10W-30 1 qt', '10W-30', 0.946, 12);
insert into inventory (id, retailer_id, product_id)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

select * from sync_movements('[
 {"id":"40000000-0000-0000-0000-000000000002","retailer_id":"10000000-0000-0000-0000-000000000001","inventory_id":"30000000-0000-0000-0000-000000000001","type":"service_out","qty_delta":-4,"occurred_at":"2026-10-20T10:00:00Z"},
 {"id":"40000000-0000-0000-0000-000000000001","retailer_id":"10000000-0000-0000-0000-000000000001","inventory_id":"30000000-0000-0000-0000-000000000001","type":"purchase_in","qty_delta":24,"unit_cost_usd":5.10,"occurred_at":"2026-10-20T08:00:00Z"},
 {"id":"40000000-0000-0000-0000-000000000003","retailer_id":"10000000-0000-0000-0000-000000000001","inventory_id":"30000000-0000-0000-0000-000000000001","type":"service_out","qty_delta":5,"occurred_at":"2026-10-20T11:00:00Z"}
]'::jsonb);
-- reintento del mismo lote: no debe duplicar
select * from sync_movements('[{"id":"40000000-0000-0000-0000-000000000001","retailer_id":"10000000-0000-0000-0000-000000000001","inventory_id":"30000000-0000-0000-0000-000000000001","type":"purchase_in","qty_delta":24,"unit_cost_usd":5.10,"occurred_at":"2026-10-20T08:00:00Z"}]'::jsonb);

do $$ declare v numeric; begin
  select on_hand into v from inventory where id = '30000000-0000-0000-0000-000000000001';
  assert v = 20, format('on_hand esperado 20, obtenido %s', v);
end $$;

-- conteo físico fija el stock en 18 → delta -2
insert into stock_movements (id, retailer_id, inventory_id, type, qty_delta, counted_qty, occurred_at, source)
values (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'count', 0, 18, now(), 'count');
do $$ declare v numeric; c numeric; begin
  select on_hand, avg_cost_usd into v, c from inventory where id = '30000000-0000-0000-0000-000000000001';
  assert v = 18, format('on_hand tras conteo esperado 18, obtenido %s', v);
  assert c = 5.10, format('costo promedio esperado 5.10, obtenido %s', c);
end $$;

-- inmutabilidad
do $$ begin
  begin
    delete from stock_movements;
    raise exception 'DELETE debió fallar';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

select count(*) as dias_en_vista from v_daily_demand;
select 'SMOKE TEST OK' as resultado;

-- ---- ciclo del pedido: crear → on_order → recibir por QR → on_order baja, stock sube
insert into exchange_rates values (current_date, 215.5, 'BCV', now());
insert into b2b_orders_bridge (id, retailer_id, idempotency_key, trigger, ves_per_usd, rate_date, subtotal_usd, status)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'idem-key-0000000001', 'auto_alert', 215.5, current_date, 122.40, 'submitted');
insert into b2b_order_lines (order_id, product_id, distributor_sku, qty_units, unit_price_usd)
values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'MOB-S2000-1030-QT', 24, 5.10);
select add_on_order('50000000-0000-0000-0000-000000000001');
select receive_b2b_order('50000000-0000-0000-0000-000000000001') as lineas_recibidas;
select receive_b2b_order('50000000-0000-0000-0000-000000000001') as reescaneo_no_duplica;
do $$ declare v numeric; o numeric; s order_status; ves numeric; begin
  select on_hand, on_order into v, o from inventory where id = '30000000-0000-0000-0000-000000000001';
  select status, subtotal_ves into s, ves from b2b_orders_bridge where id = '50000000-0000-0000-0000-000000000001';
  assert v = 42, format('on_hand esperado 42, obtenido %s', v);
  assert o = 0,  format('on_order esperado 0, obtenido %s', o);
  assert s = 'delivered';
  assert ves = 26377.20, format('subtotal_ves esperado 26377.20, obtenido %s', ves);
end $$;
select 'ORDER LIFECYCLE OK' as resultado;
