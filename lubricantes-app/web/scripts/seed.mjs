#!/usr/bin/env node
// Carga datos de demostración en un proyecto Supabase que ya tiene aplicada
// la migración supabase/migrations/0001_init.sql. Es idempotente: se puede
// correr varias veces sin duplicar usuarios/productos/retailer/compromisos.
//
// Uso:
//   SUPABASE_URL=https://tu-proyecto.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key \
//   node scripts/seed.mjs
//
// El service_role key nunca debe usarse en el frontend (salta RLS) — solo
// para scripts administrativos como este, corridos localmente.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  process.exit(1)
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function crearUsuario(email, password, nombreCompleto, role) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre_completo: nombreCompleto, role },
  })
  if (error) {
    const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers()
    if (errorLista) throw errorLista
    const existente = lista.users.find((u) => u.email === email)
    if (existente) {
      console.log(`  Usuario ${email} ya existe, lo reuso.`)
      return existente.id
    }
    throw error
  }
  console.log(`  Usuario creado: ${email}`)
  return data.user.id
}

async function main() {
  console.log('Creando usuarios de demostración...')
  const adminId = await crearUsuario('admin@demo.mobilretail.com', 'CambiarEsta123!', 'Admin Demo', 'admin')
  const asesorId = await crearUsuario('asesor@demo.mobilretail.com', 'CambiarEsta123!', 'Asesor Demo', 'asesor')
  void adminId

  console.log('Creando catálogo de productos...')
  const productos = [
    {
      sku: 'MOB-SUPER-5W30-1L',
      nombre: 'Mobil Super 5W30 1L',
      categoria: 'Aceite de motor',
      unidades_por_caja: 12,
      costo_unitario: 8.5,
      precio_sugerido: 12.0,
    },
    {
      sku: 'MOB-ATF-DEX3-1L',
      nombre: 'Mobil ATF Dexron III 1L',
      categoria: 'Fluido de transmisión',
      unidades_por_caja: 12,
      costo_unitario: 7.0,
      precio_sugerido: 10.0,
    },
    {
      sku: 'MOB-ATF-DEX4-1L',
      nombre: 'Mobil ATF Dexron IV 1L',
      categoria: 'Fluido de transmisión',
      unidades_por_caja: 12,
      costo_unitario: 7.5,
      precio_sugerido: 10.5,
    },
  ]
  const productoIds = {}
  for (const p of productos) {
    const { data: existente } = await supabase.from('productos').select('id').eq('sku', p.sku).maybeSingle()
    if (existente) {
      productoIds[p.sku] = existente.id
      console.log(`  Producto ${p.sku} ya existe, lo reuso.`)
      continue
    }
    const { data, error } = await supabase.from('productos').insert(p).select('id').single()
    if (error) throw error
    productoIds[p.sku] = data.id
    console.log(`  Producto creado: ${p.sku}`)
  }

  console.log('Creando retailer de demostración...')
  const nombreRetailer = 'Repuestos Don José (demo)'
  const { data: retailerExistente } = await supabase
    .from('retailers')
    .select('id')
    .eq('nombre', nombreRetailer)
    .maybeSingle()
  let retailerId = retailerExistente?.id
  if (!retailerId) {
    const { data, error } = await supabase
      .from('retailers')
      .insert({
        nombre: nombreRetailer,
        direccion: 'Av. Principal, Local 12',
        ciudad: 'Caracas',
        lat: 10.4806,
        lng: -66.9036,
        radio_verificacion_metros: 150,
        email: 'retailer-demo@example.com',
        telefono: '+58 212 555 0100',
        asesor_id: asesorId,
        frecuencia_visita_dias: 14,
        activo: true,
      })
      .select('id')
      .single()
    if (error) throw error
    retailerId = data.id
    console.log('  Retailer creado.')
  } else {
    console.log('  Retailer ya existe, lo reuso.')
  }

  console.log('Creando compromisos (referencias del documento de negocio)...')
  const compromisos = [
    { sku: 'MOB-SUPER-5W30-1L', minimo: 7, objetivo: 12 },
    { sku: 'MOB-ATF-DEX3-1L', minimo: 3, objetivo: 6 },
    { sku: 'MOB-ATF-DEX4-1L', minimo: 2, objetivo: 4 },
  ]
  for (const c of compromisos) {
    const { data: existente } = await supabase
      .from('compromisos')
      .select('id')
      .eq('retailer_id', retailerId)
      .eq('producto_id', productoIds[c.sku])
      .maybeSingle()
    if (existente) {
      console.log(`  Compromiso ${c.sku} ya existe, lo dejo como está.`)
      continue
    }
    const { error } = await supabase.from('compromisos').insert({
      retailer_id: retailerId,
      producto_id: productoIds[c.sku],
      minimo_unidades: c.minimo,
      objetivo_unidades: c.objetivo,
      activo: true,
      fecha_inicio: new Date().toISOString().slice(0, 10),
    })
    if (error) throw error
    console.log(`  Compromiso creado: ${c.sku} (mín. ${c.minimo} / obj. ${c.objetivo})`)
  }

  console.log('\nListo. Iniciá sesión en la app con:')
  console.log('  admin:  admin@demo.mobilretail.com  / CambiarEsta123!')
  console.log('  asesor: asesor@demo.mobilretail.com / CambiarEsta123!')
  console.log('(cambiá estas contraseñas antes de usar el sistema con datos reales)')
}

main().catch((err) => {
  console.error('Error corriendo el seed:', err)
  process.exit(1)
})
