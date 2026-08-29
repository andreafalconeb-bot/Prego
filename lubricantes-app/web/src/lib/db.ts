import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Compromiso,
  Despacho,
  InventarioContado,
  PedidoSugerido,
  Producto,
  Retailer,
  Visita,
} from './database.types'

const DB_NAME = 'lubricantes-offline'
const DB_VERSION = 1

export type TablaSincronizable = 'visitas' | 'inventario_contado' | 'pedidos_sugeridos' | 'compromisos'

export interface MutacionPendiente {
  id: string
  tabla: TablaSincronizable
  operacion: 'insert' | 'update'
  payload: Record<string, unknown>
  creado_en: string
  intentos: number
  ultimo_error?: string
}

/** Snapshot de la última visita conocida a un retailer: lo que un asesor
 * necesita para calcular ventas/reposición aunque esté sin conexión. */
export interface UltimaVisitaCache {
  retailer_id: string
  visita: Visita
  inventario: InventarioContado[]
  pedidos: PedidoSugerido[]
}

interface LubricantesDB extends DBSchema {
  retailers: { key: string; value: Retailer }
  productos: { key: string; value: Producto }
  compromisos: {
    key: string
    value: Compromiso
    indexes: { por_retailer: string }
  }
  despachos: {
    key: string
    value: Despacho
    indexes: { por_retailer: string }
  }
  ultima_visita: { key: string; value: UltimaVisitaCache }
  cola_mutaciones: {
    key: string
    value: MutacionPendiente
    indexes: { por_fecha: string }
  }
}

let dbPromise: Promise<IDBPDatabase<LubricantesDB>> | null = null

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<LubricantesDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('retailers', { keyPath: 'id' })
        db.createObjectStore('productos', { keyPath: 'id' })
        db.createObjectStore('compromisos', { keyPath: 'id' }).createIndex('por_retailer', 'retailer_id')
        db.createObjectStore('despachos', { keyPath: 'id' }).createIndex('por_retailer', 'retailer_id')
        db.createObjectStore('ultima_visita', { keyPath: 'retailer_id' })
        db.createObjectStore('cola_mutaciones', { keyPath: 'id' }).createIndex('por_fecha', 'creado_en')
      },
    })
  }
  return dbPromise
}
