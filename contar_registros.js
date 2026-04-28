import admin from 'firebase-admin'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json')
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'samy-fidabel'
})

const db = admin.firestore()

async function contar() {
  try {
    console.log('📊 Contando registros en Firebase...')
    const snapshot = await db.collection('voters').count().get()
    const total = snapshot.data().count
    console.log(`\n✅ Total de registros en la colección 'voters': ${total}`)
    console.log(`\n📈 Progreso: ${total}/56786 registros`)
    console.log(`⏳ Faltan: ${56786 - total} registros`)
    process.exit(0)
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

contar()
