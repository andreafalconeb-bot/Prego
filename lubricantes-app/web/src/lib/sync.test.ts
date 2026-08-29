// Prueba de integración de la cola offline (db.ts + sync.ts) usando
// fake-indexeddb (IndexedDB real en memoria, no un mock de la API) y un
// mock del cliente de Supabase que simula un backend en memoria. El
// objetivo es dar confianza en el mecanismo más delicado del sistema —
// visitas hechas sin conexión que se sincronizan solas — sin depender de
// un dispositivo físico ni de un proyecto de Supabase real.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockOptions {
  failTables: Set<string>
}

function crearMockSupabase(store: Record<string, Record<string, unknown>[]>, options: MockOptions) {
  function builder(table: string) {
    const filtros: ((row: Record<string, unknown>) => boolean)[] = []
    let opType: 'select' | 'insert' | 'update' = 'select'
    let payload: Record<string, unknown> | null = null
    let single = false
    let limitN: number | null = null
    let orderField: string | null = null
    let orderAsc = true

    const api = {
      select: () => api,
      eq(col: string, val: unknown) {
        filtros.push((row) => row[col] === val)
        return api
      },
      in(col: string, vals: unknown[]) {
        filtros.push((row) => vals.includes(row[col]))
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderField = col
        orderAsc = opts?.ascending ?? true
        return api
      },
      limit(n: number) {
        limitN = n
        return api
      },
      maybeSingle() {
        single = true
        return api
      },
      insert(p: Record<string, unknown>) {
        opType = 'insert'
        payload = p
        return api
      },
      update(p: Record<string, unknown>) {
        opType = 'update'
        payload = p
        return api
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return ejecutar().then(resolve, reject)
      },
    }

    async function ejecutar() {
      store[table] = store[table] ?? []
      if (options.failTables.has(table)) {
        return { data: null, error: { message: `fallo de red simulado en ${table}` } }
      }
      if (opType === 'insert') {
        store[table].push({ ...payload })
        return { data: [payload], error: null }
      }
      if (opType === 'update') {
        const coincidencias = store[table].filter((row) => filtros.every((f) => f(row)))
        coincidencias.forEach((row) => Object.assign(row, payload))
        return { data: coincidencias, error: null }
      }
      let filas = store[table].filter((row) => filtros.every((f) => f(row)))
      if (orderField) {
        const campo = orderField
        filas = [...filas].sort((a, b) => {
          const av = a[campo] as string
          const bv = b[campo] as string
          return orderAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
        })
      }
      if (limitN != null) filas = filas.slice(0, limitN)
      if (single) return { data: filas[0] ?? null, error: null }
      return { data: filas, error: null }
    }

    return api
  }

  return { from: builder }
}

const store: Record<string, Record<string, unknown>[]> = {}
const mockOptions: MockOptions = { failTables: new Set() }

vi.mock('./supabase', () => ({
  get supabase() {
    return crearMockSupabase(store, mockOptions)
  },
}))

vi.stubGlobal('navigator', { onLine: true })

const { getDb } = await import('./db')
const { encolarMutacion, sincronizar, contarPendientes, precargarDatosRuta, obtenerRetailersCache, obtenerUltimaVisitaCache } =
  await import('./sync')

async function limpiarTodo() {
  const db = await getDb()
  await db.clear('retailers')
  await db.clear('productos')
  await db.clear('compromisos')
  await db.clear('despachos')
  await db.clear('ultima_visita')
  await db.clear('cola_mutaciones')
  for (const k of Object.keys(store)) delete store[k]
  mockOptions.failTables.clear()
}

beforeEach(async () => {
  await limpiarTodo()
  ;(navigator as unknown as { onLine: boolean }).onLine = true
})

describe('cola de sincronización offline', () => {
  it('encola una mutación sin conexión y no intenta sincronizar', async () => {
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    const id = await encolarMutacion('visitas', 'insert', { retailer_id: 'r1', asesor_id: 'a1', estado: 'en_progreso' })
    expect(await contarPendientes()).toBe(1)
    expect(store.visitas ?? []).toHaveLength(0)
    expect(id).toBeTruthy()
  })

  it('sincroniza automáticamente si hay conexión al encolar', async () => {
    await encolarMutacion('visitas', 'insert', { retailer_id: 'r1', asesor_id: 'a1', estado: 'en_progreso' })
    // encolarMutacion dispara sincronizar() sin esperarlo (fire and forget);
    // esperamos a que termine en segundo plano en vez de asumir que ya
    // terminó apenas encolarMutacion resuelve.
    await vi.waitFor(async () => {
      expect(await contarPendientes()).toBe(0)
    })
    expect(store.visitas).toHaveLength(1)
  })

  it('respeta el orden FIFO: la visita se sincroniza antes que su inventario', async () => {
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    const visitaId = await encolarMutacion('visitas', 'insert', {
      retailer_id: 'r1',
      asesor_id: 'a1',
      estado: 'en_progreso',
    })
    await encolarMutacion('inventario_contado', 'insert', {
      visita_id: visitaId,
      producto_id: 'p1',
      unidades_contadas: 5,
    })
    expect(await contarPendientes()).toBe(2)

    ;(navigator as unknown as { onLine: boolean }).onLine = true
    await sincronizar()

    expect(await contarPendientes()).toBe(0)
    expect(store.visitas).toHaveLength(1)
    expect(store.inventario_contado).toHaveLength(1)
    expect(store.inventario_contado[0].visita_id).toBe(visitaId)
  })

  it('una mutación que falla queda en la cola con el error, sin bloquear a las demás', async () => {
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    await encolarMutacion('visitas', 'insert', { retailer_id: 'r1', asesor_id: 'a1', estado: 'en_progreso' })
    await encolarMutacion('compromisos', 'insert', { retailer_id: 'r1', producto_id: 'p1', minimo_unidades: 3 })

    mockOptions.failTables.add('visitas')
    ;(navigator as unknown as { onLine: boolean }).onLine = true
    await sincronizar()

    expect(store.compromisos).toHaveLength(1)
    expect(store.visitas ?? []).toHaveLength(0)
    expect(await contarPendientes()).toBe(1)

    mockOptions.failTables.delete('visitas')
    await sincronizar()
    expect(await contarPendientes()).toBe(0)
    expect(store.visitas).toHaveLength(1)
  })

  it('una actualización encolada (ej. cerrar la visita) se aplica en el mismo lote que su insert', async () => {
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    const visitaId = await encolarMutacion('visitas', 'insert', {
      retailer_id: 'r1',
      asesor_id: 'a1',
      estado: 'en_progreso',
    })
    await encolarMutacion('visitas', 'update', { id: visitaId, estado: 'completada' })

    ;(navigator as unknown as { onLine: boolean }).onLine = true
    await sincronizar()

    expect(await contarPendientes()).toBe(0)
    expect(store.visitas).toHaveLength(1)
    expect(store.visitas[0].estado).toBe('completada')
  })
})

describe('precargarDatosRuta', () => {
  it('descarga retailers, catálogo, compromisos, despachos y la última visita a caché local', async () => {
    store.retailers = [
      { id: 'r1', nombre: 'Repuestos Don Jose', asesor_id: 'a1', activo: true, frecuencia_visita_dias: 14 },
    ]
    store.productos = [{ id: 'p1', sku: 'MOB-5W30', nombre: 'Mobil 5W30', activo: true, costo_unitario: 8.5 }]
    store.compromisos = [{ id: 'c1', retailer_id: 'r1', producto_id: 'p1', minimo_unidades: 7, objetivo_unidades: 12, activo: true }]
    store.despachos = [
      { id: 'd1', retailer_id: 'r1', producto_id: 'p1', fecha: '2026-08-01', unidades_despachadas: 12 },
    ]
    store.visitas = [
      { id: 'v1', retailer_id: 'r1', asesor_id: 'a1', estado: 'completada', fecha_hora: '2026-08-01T10:00:00Z' },
    ]
    store.inventario_contado = [{ id: 'i1', visita_id: 'v1', producto_id: 'p1', unidades_contadas: 8, es_compromiso: true }]
    store.pedidos_sugeridos = []

    await precargarDatosRuta('a1')

    const retailers = await obtenerRetailersCache()
    expect(retailers).toHaveLength(1)
    expect(retailers[0].nombre).toBe('Repuestos Don Jose')

    const ultima = await obtenerUltimaVisitaCache('r1')
    expect(ultima?.visita.id).toBe('v1')
    expect(ultima?.inventario).toHaveLength(1)
    expect(ultima?.inventario[0].unidades_contadas).toBe(8)
  })
})
