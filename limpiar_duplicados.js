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

async function limpiarDuplicados() {
  try {
    console.log('🔍 Buscando duplicados por cédula...\n')
    
    // Obtener todos los documentos
    const snapshot = await db.collection('voters').get()
    const documentos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    
    console.log(`📊 Total de documentos: ${documentos.length}`)
    
    // Agrupar por cédula
    const porCedula = {}
    documentos.forEach(doc => {
      const cedula = doc.cedula
      if (!porCedula[cedula]) {
        porCedula[cedula] = []
      }
      porCedula[cedula].push(doc)
    })
    
    // Encontrar duplicados
    const duplicados = Object.entries(porCedula).filter(([cedula, docs]) => docs.length > 1)
    console.log(`⚠️  Cédulas con duplicados: ${duplicados.length}`)
    
    let totalAEliminar = 0
    duplicados.forEach(([cedula, docs]) => {
      totalAEliminar += docs.length - 1
    })
    
    console.log(`🗑️  Total de documentos a eliminar: ${totalAEliminar}\n`)
    
    if (totalAEliminar === 0) {
      console.log('✅ No hay duplicados. ¡La base de datos está limpia!')
      process.exit(0)
    }
    
    // Eliminar duplicados (mantener el primero, eliminar el resto)
    console.log('🔄 Eliminando duplicados...\n')
    let eliminados = 0
    
    for (const [cedula, docs] of duplicados) {
      // Mantener el primer documento, eliminar el resto
      for (let i = 1; i < docs.length; i++) {
        await db.collection('voters').doc(docs[i].id).delete()
        eliminados++
        const pct = Math.round((eliminados / totalAEliminar) * 100)
        process.stdout.write(`\r  ✅ Eliminados: ${eliminados}/${totalAEliminar} (${pct}%)   `)
      }
    }
    
    console.log('\n\n🎉 ¡Limpieza completada!')
    console.log(`📊 Documentos eliminados: ${eliminados}`)
    console.log(`✅ Total final en la base de datos: ${documentos.length - eliminados}`)
    process.exit(0)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

limpiarDuplicados()
