import { initializeApp } from 'firebase/app'
import { getFirestore, collection, doc, writeBatch } from 'firebase/firestore'
import XLSX from 'xlsx'
import path from 'path'
import { fileURLToPath } from 'url'

// ── NECESARIO PARA __dirname EN ES6 ────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// ────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyD3kNTmqRpTqXBjCJI0yDwhcGY543bPBbI",
  authDomain: "samy-fidabel.firebaseapp.com",
  projectId: "samy-fidabel",
  storageBucket: "samy-fidabel.firebasestorage.app",
  messagingSenderId: "184842107847",
  appId: "1:184842107847:web:75dfb34197774edfbff7e2"
}
const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

// ── CONFIGURAR AQUÍ ─────────────────────────────────────
const EXCEL_PATH = path.join(__dirname, 'padron_fernando_de_la_mora (1).xlsx')
const SALTAR_PRIMEROS = 20000  // Último punto donde paró
const BATCH_SIZE = 10  // MUY pequeño para evitar rate limit
const MIN_DELAY_MS = 3000  // Mínimo 3 segundos
const MAX_DELAY_MS = 6000  // Máximo 6 segundos (jitter)
// ────────────────────────────────────────────────────────

// ── FUNCIÓN PARA ESPERAR CON JITTER ────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getRandomDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
}
// ────────────────────────────────────────────────────────

async function importar() {
  console.log('📂 Leyendo Excel...')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  
  // Limpiar y filtrar
  const clean = rows
    .map(row => {
      const nombre = String(row['Apellidos y Nombres'] || '').replace(/#/g, 'Ñ').replace(/\s+/g, ' ').trim()
      const cedula = String(row['Cédula'] || '').replace('.0','').trim()
      return { nombre, cedula, row }
    })
    .filter(r => r.nombre.length > 0)
  
  const total = clean.length
  console.log(`📊 ${total} registros válidos (saltando primeros ${SALTAR_PRIMEROS})`)
  
  const pendientes = clean.slice(SALTAR_PRIMEROS)
  console.log(`🚀 Subiendo ${pendientes.length} registros (batch ${BATCH_SIZE}, delay ${MIN_DELAY_MS}-${MAX_DELAY_MS}ms)...\n`)
  
  let subidos = SALTAR_PRIMEROS
  const inicio = Date.now()
  let intentos_fallidos = 0
  let batches_exitosos = 0
  
  for (let i = 0; i < pendientes.length; i += BATCH_SIZE) {
    try {
      const batch = writeBatch(db)
      const chunk = pendientes.slice(i, i + BATCH_SIZE)
      
      chunk.forEach(({ nombre, cedula, row }) => {
        const ref = doc(collection(db, 'voters'))
        batch.set(ref, {
          cedula,
          nombre,
          nombre_upper: nombre.toUpperCase(),
          direccion: String(row['Dirección'] || '').trim(),
          nacimiento: String(row['F. Nacimiento'] || '').trim(),
          afiliacion: String(row['F. Afiliación'] || '').trim(),
          seccional: String(row['Seccional'] || '').replace('.0','').trim(),
          local: String(row['Local de Votacion'] || '').trim(),
          mesa: String(row['Mesa'] || '').replace('.0','').trim(),
          orden: String(row['Orden'] || '').replace('.0','').trim()
        })
      })
      
      await batch.commit()
      intentos_fallidos = 0  // Reset contador si tuvo éxito
      batches_exitosos++
      
      subidos += chunk.length
      const pct = Math.round((subidos / total) * 100)
      const seg = ((Date.now() - inicio) / 1000).toFixed(0)
      const rate = (subidos - SALTAR_PRIMEROS) / Math.max((Date.now() - inicio) / 1000, 1)
      const restante = Math.round((total - subidos) / Math.max(rate, 1))
      const delay = getRandomDelay().toFixed(0)
      process.stdout.write(`\r  ✅ ${subidos}/${total} (${pct}%) | ${seg}s | ~${restante}s | Esperando ${delay}ms   `)
      
      // Esperar con jitter (delays aleatorios)
      await sleep(getRandomDelay())
      
    } catch (error) {
      intentos_fallidos++
      
      // Si hay error de cuota
      if (error.message.includes('RESOURCE_EXHAUSTED') || error.code === 8) {
        const espera_adicional = 8000 + (intentos_fallidos * 3000)  // 8s, 11s, 14s, etc
        console.log(`\n⚠️  Cuota excedida. Esperando ${espera_adicional}ms (intento ${intentos_fallidos})...`)
        await sleep(espera_adicional)
        i -= BATCH_SIZE  // Reintentar este batch
      } else {
        console.error(`\n❌ Error en batch: ${error.message}`)
        throw error
      }
      
      // Si hay demasiados intentos fallidos, detener
      if (intentos_fallidos > 15) {
        console.error('\n❌ Demasiados errores de cuota. Deteniendo.')
        console.log(`\n📊 Estadísticas:`)
        console.log(`   Registros subidos: ${subidos}/${total}`)
        console.log(`   Batches exitosos: ${batches_exitosos}`)
        console.log(`   Progreso: ${Math.round((subidos / total) * 100)}%`)
        console.log(`\n💡 Para continuar, edita el archivo y cambia:`)
        console.log(`   const SALTAR_PRIMEROS = ${subidos}`)
        process.exit(1)
      }
    }
  }
  
  const total_seg = ((Date.now() - inicio) / 1000).toFixed(1)
  console.log(`\n\n🎉 ¡Completado! ${subidos} registros en ${total_seg}s`)
  process.exit(0)
}

importar().catch(err => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})
