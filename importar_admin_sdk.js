import admin from 'firebase-admin'
import XLSX from 'xlsx'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// ── NECESARIO PARA __dirname EN ES6 ────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// ────────────────────────────────────────────────────────

// ── INICIALIZAR ADMIN SDK ──────────────────────────────
// Asegúrate de que serviceAccountKey.json esté en la misma carpeta
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json')

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Error: No se encontró serviceAccountKey.json')
  console.error('   Descárgalo de: Firebase Console → Configuración → Cuentas de servicio')
  process.exit(1)
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'samy-fidabel'
})

const db = admin.firestore()

// ── CONFIGURAR AQUÍ ─────────────────────────────────────
const EXCEL_PATH = path.join(__dirname, 'padron_fernando_de_la_mora (1).xlsx')
const SALTAR_PRIMEROS = 0  // Cambiar si necesitas continuar desde un punto
const BATCH_SIZE = 500  // Mucho más grande (Admin SDK no tiene rate limit)
// ────────────────────────────────────────────────────────

// ── FUNCIÓN PARA ESPERAR ───────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
  console.log(`🚀 Subiendo ${pendientes.length} registros con Admin SDK (sin límites)...\n`)
  
  let subidos = SALTAR_PRIMEROS
  const inicio = Date.now()
  
  for (let i = 0; i < pendientes.length; i += BATCH_SIZE) {
    try {
      const batch = db.batch()
      const chunk = pendientes.slice(i, i + BATCH_SIZE)
      
      chunk.forEach(({ nombre, cedula, row }) => {
        const ref = db.collection('voters').doc()
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
          orden: String(row['Orden'] || '').replace('.0','').trim(),
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        })
      })
      
      await batch.commit()
      
      subidos += chunk.length
      const pct = Math.round((subidos / total) * 100)
      const seg = ((Date.now() - inicio) / 1000).toFixed(0)
      const rate = (subidos - SALTAR_PRIMEROS) / Math.max((Date.now() - inicio) / 1000, 1)
      const restante = Math.round((total - subidos) / Math.max(rate, 1))
      process.stdout.write(`\r  ✅ ${subidos}/${total} (${pct}%) | ${seg}s | ~${restante}s restantes | ${rate.toFixed(1)} reg/s   `)
      
      // Pausa mínima para no saturar
      await sleep(100)
      
    } catch (error) {
      console.error(`\n❌ Error en batch: ${error.message}`)
      console.log(`Progreso guardado: ${subidos}/${total} registros`)
      process.exit(1)
    }
  }
  
  const total_seg = ((Date.now() - inicio) / 1000).toFixed(1)
  const velocidad = (subidos / ((Date.now() - inicio) / 1000)).toFixed(0)
  console.log(`\n\n🎉 ¡Completado! ${subidos} registros en ${total_seg}s (${velocidad} reg/s)`)
  process.exit(0)
}

importar().catch(err => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})
