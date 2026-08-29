import { getDb, type MutacionPendiente, type TablaSincronizable, type UltimaVisitaCache } from './db'
import { supabase } from './supabase'

type Listener = () => void
const listeners = new Set<Listener>()

/** Suscribirse a cambios de la cola de sincronización (ver useSyncStatus). */
export function onSyncChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notificar() {
  listeners.forEach((fn) => fn())
}

export async function contarPendientes(): Promise<number> {
  const db = await getDb()
  return db.count('cola_mutaciones')
}

/**
 * Descarga a IndexedDB todo lo que un asesor necesita para hacer sus visitas
 * del día sin conexión: sus retailers, el catálogo, los compromisos activos,
 * los despachos recientes y el snapshot de la última visita completada de
 * cada retailer (para poder calcular "vendido" offline).
 *
 * Debe llamarse mientras hay conexión (idealmente al arrancar el día).
 */
export async function precargarDatosRuta(asesorId: string): Promise<void> {
  const db = await getDb()

  const [{ data: retailers }, { data: productos }] = await Promise.all([
    supabase.from('retailers').select('*').eq('asesor_id', asesorId).eq('activo', true),
    supabase.from('productos').select('*').eq('activo', true),
  ])

  const txRetailers = db.transaction('retailers', 'readwrite')
  await txRetailers.store.clear()
  for (const r of retailers ?? []) await txRetailers.store.put(r)
  await txRetailers.done

  const txProductos = db.transaction('productos', 'readwrite')
  await txProductos.store.clear()
  for (const p of productos ?? []) await txProductos.store.put(p)
  await txProductos.done

  const retailerIds = (retailers ?? []).map((r) => r.id)
  if (retailerIds.length === 0) {
    notificar()
    return
  }

  const { data: compromisos } = await supabase
    .from('compromisos')
    .select('*')
    .in('retailer_id', retailerIds)
    .eq('activo', true)
  const txCompromisos = db.transaction('compromisos', 'readwrite')
  await txCompromisos.store.clear()
  for (const c of compromisos ?? []) await txCompromisos.store.put(c)
  await txCompromisos.done

  const { data: despachos } = await supabase.from('despachos').select('*').in('retailer_id', retailerIds)
  const txDespachos = db.transaction('despachos', 'readwrite')
  await txDespachos.store.clear()
  for (const d of despachos ?? []) await txDespachos.store.put(d)
  await txDespachos.done

  for (const retailerId of retailerIds) {
    const { data: ultimaVisita } = await supabase
      .from('visitas')
      .select('*')
      .eq('retailer_id', retailerId)
      .eq('estado', 'completada')
      .order('fecha_hora', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!ultimaVisita) continue

    const [{ data: inventario }, { data: pedidos }] = await Promise.all([
      supabase.from('inventario_contado').select('*').eq('visita_id', ultimaVisita.id),
      supabase.from('pedidos_sugeridos').select('*').eq('visita_id', ultimaVisita.id),
    ])
    await db.put('ultima_visita', {
      retailer_id: retailerId,
      visita: ultimaVisita,
      inventario: inventario ?? [],
      pedidos: pedidos ?? [],
    })
  }

  notificar()
}

/** Encola una escritura para sincronizar con Supabase. Genera el id del
 * registro localmente (uuid) para que las filas creadas offline puedan
 * referenciarse entre sí (ej. inventario_contado.visita_id) antes de que
 * exista conexión. Intenta sincronizar de inmediato si hay red. */
export async function encolarMutacion(
  tabla: TablaSincronizable,
  operacion: 'insert' | 'update',
  payload: Record<string, unknown>,
): Promise<string> {
  const db = await getDb()
  const id = (payload.id as string | undefined) ?? crypto.randomUUID()
  const mutacion: MutacionPendiente = {
    id,
    tabla,
    operacion,
    payload: { ...payload, id },
    creado_en: new Date().toISOString(),
    intentos: 0,
  }
  await db.add('cola_mutaciones', mutacion)
  notificar()
  if (navigator.onLine) void sincronizar()
  return id
}

let sincronizando = false

/** Procesa la cola en orden de creación (FIFO), para respetar dependencias
 * entre filas (ej. la visita antes que su inventario). Si una mutación
 * falla, queda en la cola con el error registrado y se reintenta en la
 * próxima corrida en vez de bloquear las siguientes. */
export async function sincronizar(): Promise<void> {
  if (sincronizando || !navigator.onLine) return
  sincronizando = true
  try {
    const db = await getDb()
    const pendientes = await db.getAllFromIndex('cola_mutaciones', 'por_fecha')
    for (const m of pendientes) {
      try {
        // `m.tabla` es dinámico (una de varias tablas posibles), así que el
        // tipo de `.insert`/`.update` no puede resolverse estáticamente acá;
        // el resto del código sí pasa por tipos concretos por tabla.
        const tabla = supabase.from(m.tabla) as unknown as {
          insert: (payload: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>
          update: (payload: Record<string, unknown>) => { eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }> }
        }
        const { error } =
          m.operacion === 'insert'
            ? await tabla.insert(m.payload)
            : await tabla.update(m.payload).eq('id', m.payload.id as string)
        if (error) throw error
        await db.delete('cola_mutaciones', m.id)
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err)
        await db.put('cola_mutaciones', { ...m, intentos: m.intentos + 1, ultimo_error: mensaje })
      }
    }
    notificar()
  } finally {
    sincronizando = false
  }
}

export async function actualizarUltimaVisitaCache(snapshot: UltimaVisitaCache): Promise<void> {
  const db = await getDb()
  await db.put('ultima_visita', snapshot)
}

export async function obtenerRetailersCache() {
  const db = await getDb()
  return db.getAll('retailers')
}

export async function obtenerProductosCache() {
  const db = await getDb()
  return db.getAll('productos')
}

export async function obtenerCompromisosCache(retailerId: string) {
  const db = await getDb()
  return db.getAllFromIndex('compromisos', 'por_retailer', retailerId)
}

export async function obtenerDespachosCache(retailerId: string) {
  const db = await getDb()
  return db.getAllFromIndex('despachos', 'por_retailer', retailerId)
}

export async function obtenerUltimaVisitaCache(retailerId: string) {
  const db = await getDb()
  return db.get('ultima_visita', retailerId)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void sincronizar())
}
