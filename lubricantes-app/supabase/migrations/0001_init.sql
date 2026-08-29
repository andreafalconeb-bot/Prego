-- Esquema inicial: App del vendedor (asesor) para el programa de compromiso
-- de retail de lubricantes MOBIL.
--
-- Diseño: esta base de Supabase es la fuente de verdad de compromisos,
-- catálogo, visitas e inventario. La tabla/vista `compromisos_publicos`
-- es de lectura pública (anon) y es la que alimenta el buscador de
-- distribuidores de terceros ("producto cerca de ti").

-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- Tipos
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'asesor');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_visita') then
    create type estado_visita as enum ('en_progreso', 'completada', 'cancelada');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_pedido') then
    create type estado_pedido as enum ('sugerido', 'autorizado', 'rechazado');
  end if;
  if not exists (select 1 from pg_type where typname = 'origen_despacho') then
    create type origen_despacho as enum ('import_odbc', 'manual');
  end if;
end $$;

-- ============================================================
-- Función auxiliar: updated_at automático
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- profiles (extiende auth.users)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  role user_role not null default 'asesor',
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Crea el profile automáticamente cuando se crea un usuario en auth.users
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nombre_completo, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'asesor')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and activo
  );
$$ language sql stable security definer set search_path = public;

-- ============================================================
-- productos (catálogo)
-- ============================================================
create table productos (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  nombre text not null,
  categoria text,
  unidades_por_caja integer not null check (unidades_por_caja > 0),
  costo_unitario numeric(12,2) not null default 0 check (costo_unitario >= 0),
  precio_sugerido numeric(12,2),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_productos_updated_at
  before update on productos
  for each row execute function set_updated_at();

-- ============================================================
-- retailers (puntos de venta)
-- ============================================================
create table retailers (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  ciudad text,
  lat double precision,
  lng double precision,
  radio_verificacion_metros integer not null default 150 check (radio_verificacion_metros > 0),
  email text,
  telefono text,
  asesor_id uuid references profiles(id),
  frecuencia_visita_dias integer not null default 14 check (frecuencia_visita_dias > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_retailers_updated_at
  before update on retailers
  for each row execute function set_updated_at();

create index idx_retailers_asesor on retailers(asesor_id);

-- ============================================================
-- compromisos (SKU comprometido por retailer, con mínimo de inventario)
-- ============================================================
create table compromisos (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  minimo_unidades integer not null check (minimo_unidades >= 0),
  objetivo_unidades integer not null check (objetivo_unidades >= minimo_unidades),
  activo boolean not null default true,
  fecha_inicio date not null default current_date,
  fecha_fin date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retailer_id, producto_id)
);

create trigger trg_compromisos_updated_at
  before update on compromisos
  for each row execute function set_updated_at();

create index idx_compromisos_retailer on compromisos(retailer_id) where activo;

-- Historial simple de cambios a compromisos (para auditoría del plan de crecimiento)
create table compromisos_historial (
  id uuid primary key default gen_random_uuid(),
  compromiso_id uuid not null references compromisos(id) on delete cascade,
  minimo_unidades integer not null,
  objetivo_unidades integer not null,
  activo boolean not null,
  cambiado_por uuid references profiles(id),
  cambiado_en timestamptz not null default now()
);

create or replace function log_compromiso_change()
returns trigger as $$
begin
  insert into compromisos_historial (compromiso_id, minimo_unidades, objetivo_unidades, activo, cambiado_por)
  values (new.id, new.minimo_unidades, new.objetivo_unidades, new.activo, auth.uid());
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_compromisos_historial
  after insert or update of minimo_unidades, objetivo_unidades, activo on compromisos
  for each row execute function log_compromiso_change();

-- ============================================================
-- visitas (visita física del asesor a un retailer)
-- ============================================================
create table visitas (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailers(id),
  asesor_id uuid not null references profiles(id),
  fecha_hora timestamptz not null default now(),
  lat double precision,
  lng double precision,
  distancia_metros numeric(10,2),
  gps_verificado boolean not null default false,
  estado estado_visita not null default 'en_progreso',
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_visitas_updated_at
  before update on visitas
  for each row execute function set_updated_at();

create index idx_visitas_retailer on visitas(retailer_id, fecha_hora desc);
create index idx_visitas_asesor on visitas(asesor_id, fecha_hora desc);

-- ============================================================
-- inventario_contado (conteo físico por producto en cada visita)
-- ============================================================
create table inventario_contado (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  unidades_contadas integer not null check (unidades_contadas >= 0),
  es_compromiso boolean not null default true,
  created_at timestamptz not null default now(),
  unique (visita_id, producto_id)
);

create index idx_inventario_visita on inventario_contado(visita_id);

-- ============================================================
-- despachos (lo efectivamente despachado al retailer; importado de SAREGO
-- vía ODBC/Excel, o cargado a mano hasta que el IT autorice la conexión
-- automática)
-- ============================================================
create table despachos (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailers(id),
  producto_id uuid not null references productos(id),
  fecha date not null,
  unidades_despachadas integer not null check (unidades_despachadas >= 0),
  origen origen_despacho not null default 'manual',
  pedido_id uuid,
  importado_por uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_despachos_retailer_producto on despachos(retailer_id, producto_id, fecha);

-- ============================================================
-- pedidos_sugeridos (sugerencia de reposición calculada en cada visita;
-- el sistema solo sugiere, nunca ejecuta el pedido)
-- ============================================================
create table pedidos_sugeridos (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  inventario_anterior integer not null default 0,
  despachado_desde_visita_anterior integer not null default 0,
  inventario_actual integer not null,
  unidades_vendidas_calculadas integer not null,
  minimo_unidades integer not null,
  objetivo_unidades integer not null,
  unidades_sugeridas integer not null check (unidades_sugeridas >= 0),
  unidades_autorizadas integer,
  estado estado_pedido not null default 'sugerido',
  es_fuera_de_compromiso boolean not null default false,
  autorizado_por_nombre text,
  autorizado_en timestamptz,
  created_at timestamptz not null default now()
);

create index idx_pedidos_visita on pedidos_sugeridos(visita_id);

alter table despachos
  add constraint fk_despachos_pedido foreign key (pedido_id) references pedidos_sugeridos(id);

-- ============================================================
-- correos_enviados (registro del correo con el cálculo enviado al retailer)
-- ============================================================
create table correos_enviados (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  retailer_id uuid not null references retailers(id),
  destinatario text not null,
  asunto text not null,
  estado text not null check (estado in ('enviado', 'error')),
  error_detalle text,
  enviado_en timestamptz not null default now()
);

create index idx_correos_visita on correos_enviados(visita_id);

-- ============================================================
-- Vista pública (solo lectura, rol anon) para el buscador de distribuidores
-- de terceros: solo compromisos activos de retailers activos.
-- ============================================================
create view compromisos_publicos as
select
  r.id as retailer_id,
  r.nombre as retailer_nombre,
  r.direccion,
  r.ciudad,
  r.lat,
  r.lng,
  p.id as producto_id,
  p.sku,
  p.nombre as producto_nombre,
  p.categoria
from compromisos c
join retailers r on r.id = c.retailer_id
join productos p on p.id = c.producto_id
where c.activo = true
  and r.activo = true
  and p.activo = true;

-- ============================================================
-- RLS
-- ============================================================
alter table profiles enable row level security;
alter table productos enable row level security;
alter table retailers enable row level security;
alter table compromisos enable row level security;
alter table compromisos_historial enable row level security;
alter table visitas enable row level security;
alter table inventario_contado enable row level security;
alter table despachos enable row level security;
alter table pedidos_sugeridos enable row level security;
alter table correos_enviados enable row level security;

-- profiles: cada usuario ve/edita el suyo; admin ve todos
create policy profiles_select_own_or_admin on profiles
  for select using (id = auth.uid() or is_admin());
create policy profiles_update_own_or_admin on profiles
  for update using (id = auth.uid() or is_admin());
create policy profiles_admin_insert on profiles
  for insert with check (is_admin());

-- productos: lectura para cualquier usuario autenticado; escritura solo admin
create policy productos_select_authenticated on productos
  for select using (auth.role() = 'authenticated');
create policy productos_admin_write on productos
  for all using (is_admin()) with check (is_admin());

-- retailers: asesor ve/edita solo los suyos; admin ve/edita todos
create policy retailers_select on retailers
  for select using (asesor_id = auth.uid() or is_admin());
create policy retailers_admin_write on retailers
  for all using (is_admin()) with check (is_admin());
create policy retailers_asesor_update_own on retailers
  for update using (asesor_id = auth.uid()) with check (asesor_id = auth.uid());

-- compromisos: visibles/editables por el asesor dueño del retailer o admin
-- (el asesor puede sumar/ajustar referencias durante la visita, según el
-- flujo de negocio descrito)
create policy compromisos_select on compromisos
  for select using (
    is_admin() or exists (
      select 1 from retailers r where r.id = compromisos.retailer_id and r.asesor_id = auth.uid()
    )
  );
create policy compromisos_write on compromisos
  for all using (
    is_admin() or exists (
      select 1 from retailers r where r.id = compromisos.retailer_id and r.asesor_id = auth.uid()
    )
  ) with check (
    is_admin() or exists (
      select 1 from retailers r where r.id = compromisos.retailer_id and r.asesor_id = auth.uid()
    )
  );

create policy compromisos_historial_select on compromisos_historial
  for select using (
    is_admin() or exists (
      select 1 from compromisos c
      join retailers r on r.id = c.retailer_id
      where c.id = compromisos_historial.compromiso_id and r.asesor_id = auth.uid()
    )
  );

-- visitas: el asesor solo ve/crea las suyas; admin ve todas
create policy visitas_select on visitas
  for select using (asesor_id = auth.uid() or is_admin());
create policy visitas_insert on visitas
  for insert with check (asesor_id = auth.uid() or is_admin());
create policy visitas_update on visitas
  for update using (asesor_id = auth.uid() or is_admin());

-- inventario_contado: ligado a la visita del asesor
create policy inventario_select on inventario_contado
  for select using (
    is_admin() or exists (select 1 from visitas v where v.id = inventario_contado.visita_id and v.asesor_id = auth.uid())
  );
create policy inventario_write on inventario_contado
  for all using (
    is_admin() or exists (select 1 from visitas v where v.id = inventario_contado.visita_id and v.asesor_id = auth.uid())
  ) with check (
    is_admin() or exists (select 1 from visitas v where v.id = inventario_contado.visita_id and v.asesor_id = auth.uid())
  );

-- despachos: el asesor ve los de sus retailers (para comparar pedido vs.
-- despachado); solo admin importa/edita
create policy despachos_select on despachos
  for select using (
    is_admin() or exists (select 1 from retailers r where r.id = despachos.retailer_id and r.asesor_id = auth.uid())
  );
create policy despachos_admin_write on despachos
  for all using (is_admin()) with check (is_admin());

-- pedidos_sugeridos: ligado a la visita del asesor (incluye autorización)
create policy pedidos_select on pedidos_sugeridos
  for select using (
    is_admin() or exists (select 1 from visitas v where v.id = pedidos_sugeridos.visita_id and v.asesor_id = auth.uid())
  );
create policy pedidos_write on pedidos_sugeridos
  for all using (
    is_admin() or exists (select 1 from visitas v where v.id = pedidos_sugeridos.visita_id and v.asesor_id = auth.uid())
  ) with check (
    is_admin() or exists (select 1 from visitas v where v.id = pedidos_sugeridos.visita_id and v.asesor_id = auth.uid())
  );

-- correos_enviados: el asesor ve los de sus visitas; solo el backend
-- (service_role, que salta RLS) inserta desde la Edge Function
create policy correos_select on correos_enviados
  for select using (
    is_admin() or exists (select 1 from visitas v where v.id = correos_enviados.visita_id and v.asesor_id = auth.uid())
  );

-- Vista pública: acceso de lectura para el rol anon (buscador de terceros)
grant select on compromisos_publicos to anon;
grant usage on schema public to anon;
