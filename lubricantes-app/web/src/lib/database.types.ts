// Tipos escritos a mano que reflejan supabase/migrations/0001_init.sql.
// Si el esquema cambia, regenerar idealmente con:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type UserRole = 'admin' | 'asesor'
export type EstadoVisita = 'en_progreso' | 'completada' | 'cancelada'
export type EstadoPedido = 'sugerido' | 'autorizado' | 'rechazado'
export type OrigenDespacho = 'import_odbc' | 'manual'

export type Profile = {
  id: string
  nombre_completo: string
  role: UserRole
  telefono: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type Producto = {
  id: string
  sku: string
  nombre: string
  categoria: string | null
  unidades_por_caja: number
  costo_unitario: number
  precio_sugerido: number | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type Retailer = {
  id: string
  nombre: string
  direccion: string | null
  ciudad: string | null
  lat: number | null
  lng: number | null
  radio_verificacion_metros: number
  email: string | null
  telefono: string | null
  asesor_id: string | null
  frecuencia_visita_dias: number
  activo: boolean
  created_at: string
  updated_at: string
}

export type Compromiso = {
  id: string
  retailer_id: string
  producto_id: string
  minimo_unidades: number
  objetivo_unidades: number
  activo: boolean
  fecha_inicio: string
  fecha_fin: string | null
  created_at: string
  updated_at: string
}

export type Visita = {
  id: string
  retailer_id: string
  asesor_id: string
  fecha_hora: string
  lat: number | null
  lng: number | null
  distancia_metros: number | null
  gps_verificado: boolean
  estado: EstadoVisita
  notas: string | null
  created_at: string
  updated_at: string
}

export type InventarioContado = {
  id: string
  visita_id: string
  producto_id: string
  unidades_contadas: number
  es_compromiso: boolean
  created_at: string
}

export type Despacho = {
  id: string
  retailer_id: string
  producto_id: string
  fecha: string
  unidades_despachadas: number
  origen: OrigenDespacho
  pedido_id: string | null
  importado_por: string | null
  created_at: string
}

export type PedidoSugerido = {
  id: string
  visita_id: string
  producto_id: string
  inventario_anterior: number
  despachado_desde_visita_anterior: number
  inventario_actual: number
  unidades_vendidas_calculadas: number
  minimo_unidades: number
  objetivo_unidades: number
  unidades_sugeridas: number
  unidades_autorizadas: number | null
  estado: EstadoPedido
  es_fuera_de_compromiso: boolean
  autorizado_por_nombre: string | null
  autorizado_en: string | null
  created_at: string
}

export type CorreoEnviado = {
  id: string
  visita_id: string
  retailer_id: string
  destinatario: string
  asunto: string
  estado: 'enviado' | 'error'
  error_detalle: string | null
  enviado_en: string
}

type TableDef<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile, Partial<Profile> & { id: string }>
      productos: TableDef<Producto, Omit<Producto, 'id' | 'created_at' | 'updated_at'> & { id?: string }>
      retailers: TableDef<Retailer, Omit<Retailer, 'id' | 'created_at' | 'updated_at'> & { id?: string }>
      compromisos: TableDef<Compromiso, Omit<Compromiso, 'id' | 'created_at' | 'updated_at'> & { id?: string }>
      visitas: TableDef<Visita, Omit<Visita, 'id' | 'created_at' | 'updated_at'> & { id?: string }>
      inventario_contado: TableDef<InventarioContado, Omit<InventarioContado, 'id' | 'created_at'> & { id?: string }>
      despachos: TableDef<Despacho, Omit<Despacho, 'id' | 'created_at'> & { id?: string }>
      pedidos_sugeridos: TableDef<PedidoSugerido, Omit<PedidoSugerido, 'id' | 'created_at'> & { id?: string }>
      correos_enviados: TableDef<CorreoEnviado, Omit<CorreoEnviado, 'id'> & { id?: string }>
    }
    Views: {
      compromisos_publicos: {
        Row: {
          retailer_id: string
          retailer_nombre: string
          direccion: string | null
          ciudad: string | null
          lat: number | null
          lng: number | null
          producto_id: string
          sku: string
          producto_nombre: string
          categoria: string | null
        }
        Relationships: []
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
