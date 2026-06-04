/**
 * IMPORTAR PADRÓN – Script alternativo para conexión lenta
 * 
 * USO:
 *   1. Ir a Firebase Console → Configuración → Cuentas de servicio
 *   2. Click "Generar nueva clave privada" → guarda como serviceAccount.json
 *   3. Ejecutar:
 *      npm install firebase-admin xlsx
 *      node importar_padron_admin.js
 */

const admin = require('firebase-admin')
const XLSX = require('xlsx')
const path = require('path')

// ── CONFIGURAR AQUÍ ────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = './serviceAccount.json'   // tu archivo de clave
const EXCEL_PATH = './padron_fernando_de_la_mora.xlsx' // el padrón
const BATCH_SIZE = 450  // máximo recomendado por Firestore
// ──────────────────────────────────────────────────────────

const serviceAccount = require(SERVICE_ACCOUNT_PATH)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

async function importar() {
  console.log('📂 Leyendo archivo Excel...')
  const wb = XLSX.readFile(EXCEL_PATH)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  
  console.log(`📊 ${rows.length} registros encontrados.`)
  console.log('🚀 Iniciando importación a Firestore...\n')

  let total = 0
  const start = Date.now()

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const chunk = rows.slice(i, i + BATCH_SIZE)

    chunk.forEach(row => {
      const ref = db.collection('voters').doc()
      batch.set(ref, {
        cedula: String(row['Cédula'] || '').trim(),
        nombre: String(row['Apellidos y Nombres'] || '').trim(),
        nombre_upper: String(row['Apellidos y Nombres'] || '').trim().toUpperCase(),
        direccion: String(row['Dirección'] || '').trim(),
        nacimiento: String(row['F. Nacimiento'] || '').trim(),
        afiliacion: String(row['F. Afiliación'] || '').trim(),
        seccional: String(row['Seccional'] || '').trim()
      })
    })

    await batch.commit()
    total += chunk.length

    const pct = Math.round((total / rows.length) * 100)
    const elapsed = ((Date.now() - start) / 1000).toFixed(0)
    const rate = Math.round(total / ((Date.now() - start) / 1000))
    const remaining = Math.round((rows.length - total) / rate)

    process.stdout.write(
      `\r  ✅ ${total}/${rows.length} (${pct}%) | ${elapsed}s transcurridos | ~${remaining}s restantes   `
    )
  }

  const totalTime = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n\n🎉 Importación completada: ${total} registros en ${totalTime}s`)
  process.exit(0)
}

importar().catch(err => {
  console.error('\n❌ Error:', err.message)
  process.exit(1)
})
