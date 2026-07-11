// Backfill único: agrega ccAssignedUserId y nombre_upper a los
// savedRecords que ya existían antes de que Centro de Contacto empezara a
// usarlos para escalar a 50k-100k votantes (ver contactCenter.js).
//
// Sin esto, un registro viejo sin ccAssignedUserId sería INVISIBLE para
// where('ccAssignedUserId','==',null) — Firestore no matchea campos
// ausentes ni en == ni en != — así que quedaría "perdido" para la
// asignación automática y el pool de "sin asignar".
//
// Idempotente: si un doc ya tiene ambos campos, se saltea. Corre con
// Admin SDK (bypassa reglas) — hace falta firebase-service-account.json
// válido en la raíz del repo (ver scripts/lib/adminApp.js). Si la clave
// de servicio fue revocada/rotada, hay que generar una nueva desde
// Firebase Console → Configuración del proyecto → Cuentas de servicio.
//
// Uso:
//   node scripts/backfill-contact-center-fields.js --candidate=candidato-test
import { getDb } from './lib/adminApp.js'

const args = process.argv.slice(2)
const getArg = (name) => {
  const found = args.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}

const candidateId = getArg('candidate')
if (!candidateId) {
  console.error('❌ Falta --candidate=<id>. Uso: node scripts/backfill-contact-center-fields.js --candidate=candidato-test')
  process.exit(1)
}

async function main() {
  const db = getDb()
  const recordsRef = db.collection('candidates').doc(candidateId).collection('savedRecords')
  const assignmentsRef = db.collection('candidates').doc(candidateId).collection('callAssignments')

  console.log(`Leyendo savedRecords de ${candidateId}...`)
  const [recordsSnap, assignmentsSnap] = await Promise.all([recordsRef.get(), assignmentsRef.get()])
  console.log(`  ${recordsSnap.size} savedRecords, ${assignmentsSnap.size} callAssignments existentes`)

  const assignedUserIdByVoterId = new Map()
  assignmentsSnap.forEach(doc => {
    assignedUserIdByVoterId.set(doc.id, doc.data().assignedUserId || null)
  })

  let yaMigrados = 0
  let aMigrar = []
  recordsSnap.forEach(doc => {
    const data = doc.data()
    const faltaCc = !('ccAssignedUserId' in data)
    const faltaNombreUpper = !('nombre_upper' in data)
    if (!faltaCc && !faltaNombreUpper) { yaMigrados++; return }
    const updates = {}
    if (faltaCc) updates.ccAssignedUserId = assignedUserIdByVoterId.has(doc.id) ? assignedUserIdByVoterId.get(doc.id) : null
    if (faltaNombreUpper) updates.nombre_upper = String(data.nombre || '').toUpperCase()
    aMigrar.push({ id: doc.id, updates })
  })

  console.log(`  ${yaMigrados} ya migrados (se saltean), ${aMigrar.length} por migrar`)

  const BATCH_SIZE = 400
  let hechos = 0
  for (let i = 0; i < aMigrar.length; i += BATCH_SIZE) {
    const chunk = aMigrar.slice(i, i + BATCH_SIZE)
    const batch = db.batch()
    chunk.forEach(({ id, updates }) => batch.update(recordsRef.doc(id), updates))
    await batch.commit()
    hechos += chunk.length
    console.log(`  Migrados ${hechos}/${aMigrar.length}...`)
  }

  console.log(`\n✅ Backfill completo para ${candidateId}: ${hechos} registro(s) actualizado(s).`)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
