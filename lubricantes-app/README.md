# MOBIL Retail — App del asesor

App de campo (PWA, funciona offline) para que los asesores comerciales de un
distribuidor MOBIL visiten físicamente a cada retail con compromiso, cuenten
inventario, calculen ventas y reposición sugerida, pidan autorización, y
mantengan al día el compromiso de referencias de cada punto de venta.

No incluye: el buscador público de distribuidores (lo construye/mantiene un
tercero, leyendo de la misma base de Supabase) ni GO MADDY / la app de
mantenimiento automotriz — ambos fuera de alcance de este trabajo.

## Cómo funciona, en corto

1. El asesor abre su ruta (retailers asignados) y elige uno para visitar.
2. La app verifica su ubicación GPS contra la del punto de venta registrado.
3. Cuenta, en unidades, el inventario de cada SKU comprometido (y opcionalmente
   de SKUs sin compromiso).
4. La app calcula automáticamente:
   - **Vendido** = inventario de la visita anterior + despachado desde
     entonces − inventario actual.
   - **Reposición sugerida**: sube ~10% si el conteo cayó bajo el mínimo
     comprometido, baja ~10% si está en o sobre el mínimo (ver
     `web/src/lib/reposicion.ts`).
5. Envía por correo el resumen al retail (Edge Function `send-visit-email`).
6. Pide autorización para convertir la sugerencia en pedido (el sistema
   **solo sugiere**, nunca ejecuta el pedido en ningún ERP).
7. Ofrece sumar nuevas referencias al compromiso y registrar compras fuera de
   compromiso.
8. Todo lo anterior funciona **sin conexión**: la visita completa se hace
   offline y se sincroniza sola cuando vuelve la señal (ver
   `web/src/lib/sync.ts` y `web/src/lib/db.ts`).

## Arquitectura

Todo corre sobre **Supabase** (Postgres + Auth + Storage + Edge Functions),
sin backend propio — ver `supabase/migrations/0001_init.sql` para el
esquema completo y las políticas de RLS.

```
lubricantes-app/
├── supabase/
│   ├── migrations/0001_init.sql   Esquema, triggers, RLS, vista pública
│   └── functions/send-visit-email Edge Function que envía el correo de resumen
└── web/                            PWA (React + Vite + TS)
    └── src/
        ├── lib/
        │   ├── supabase.ts         Cliente Supabase
        │   ├── database.types.ts   Tipos (a mano; regenerar cuando cambie el esquema)
        │   ├── db.ts, sync.ts      Cola de sincronización offline (IndexedDB)
        │   ├── geo.ts               Verificación GPS (Haversine)
        │   └── reposicion.ts       Cálculo de ventas y sugerencia de reposición
        ├── auth/                   Contexto de sesión + perfil (rol admin/asesor)
        └── pages/
            ├── Ruta.tsx             Ruta del día del asesor
            ├── Visita.tsx           Wizard completo de la visita
            └── admin/                Catálogo, retailers/compromisos, despachos
```

**Por qué todo en Supabase:** el buscador público de distribuidores (de un
tercero) ya va a leer de esta misma base — la vista `compromisos_publicos`
(solo lectura, rol `anon`) es justamente esa interfaz. Evita mantener dos
bases sincronizadas.

**Por qué offline-first:** las visitas son físicas, en locales que pueden
tener mala señal. La cola de mutaciones en IndexedDB genera los IDs de cada
fila en el dispositivo (`crypto.randomUUID()`), así que una visita completa
(con su inventario y pedido) puede crearse sin conexión y sincronizarse en
orden cuando vuelve la red.

## Poner en marcha

### 1. Crear el proyecto de Supabase

En [supabase.com](https://supabase.com), creá un proyecto nuevo. Después,
con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
cd lubricantes-app
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push        # aplica supabase/migrations/0001_init.sql
```

### 2. Crear los primeros usuarios

Los usuarios se crean en Supabase Auth (Dashboard → Authentication → Users,
o `supabase.auth.admin.createUser`). El trigger `handle_new_user` crea el
`profile` automáticamente. Para asignar el rol admin al crear el usuario,
pasá en `raw_user_meta_data`: `{"nombre_completo": "...", "role": "admin"}`
(por defecto el rol es `asesor`).

### 3. Configurar el envío de correos

La Edge Function usa [Resend](https://resend.com) (podés cambiarla por otro
proveedor editando `supabase/functions/send-visit-email/index.ts`):

```bash
npx supabase secrets set RESEND_API_KEY=tu_api_key
npx supabase secrets set REMITENTE_EMAIL=reposicion@tudominio.com
npx supabase functions deploy send-visit-email
```

### 4. Levantar la app web

```bash
cd web
npm install
cp .env.example .env.local   # completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Para producción: `npm run build` genera un PWA instalable en `web/dist/`
(service worker vía `vite-plugin-pwa`) — se puede alojar en cualquier
hosting estático (Vercel, Netlify, Supabase Storage + CDN, etc.).

## Datos de despacho (SAREGO)

Mientras el IT autoriza la conexión directa al SQL de SAREGO, el admin
importa manualmente en **Despachos** un CSV exportado por ODBC/Excel con
columnas `retailer,sku,fecha,unidades` (ver `web/src/pages/admin/Despachos.tsx`).
Esa pantalla también muestra la comparación pedido autorizado vs. despachado
por retailer/producto.

Cuando el IT autorice el acceso automático, lo natural es reemplazar esta
importación manual por una función programada (Supabase cron / Edge
Function) que lea el SQL de SAREGO y escriba directamente en la tabla
`despachos` — el resto del sistema (cálculo de ventas, comparación
pedido/despachado) no cambia.

## Limitaciones conocidas (a tener en cuenta)

- **Offline y datos de despacho**: si hubo despachos nuevos después de la
  última vez que el asesor sincronizó su ruta y antes de una visita hecha
  sin conexión, esos despachos no entran en el cálculo de "vendido" de esa
  visita puntual. Recomendación operativa: sincronizar la ruta (botón
  "Actualizar ruta") al empezar el día, con buena señal.
- El envío de correo requiere conexión en el momento (llama a la Edge
  Function). Si la visita se cierra sin conexión, el correo no se reintenta
  solo — queda pendiente de un reenvío manual (no implementado en esta
  primera entrega).
- El algoritmo de ajuste de reposición (±10% según esté bajo/sobre el
  mínimo) es un punto de partida simple y explicable; convendría afinarlo
  con datos reales de rotación por SKU.

## Pruebas hechas

- El esquema SQL fue validado corriéndolo contra un Postgres real (extensión,
  tipos, triggers, RLS, vista pública, inserciones de punta a punta).
- El frontend compila sin errores de tipos (`npm run build`) y fue probado
  visualmente (pantalla de login, manejo de errores) con un servidor de
  desarrollo real.
- Falta por hacer antes de producción: probar el flujo completo de una
  visita contra un proyecto de Supabase real (con RLS aplicando sobre
  usuarios reales), y probar la sincronización offline→online en un
  dispositivo físico.
