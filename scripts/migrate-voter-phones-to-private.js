// Mejora de privacidad (búsqueda de votantes): mueve el campo `telefono`
// (y sus metadatos de última actualización) del doc principal de cada
// `/voters/{id}` a una subcolección privada `/voters/{id}/private/data`,
// que ahora es la única con reglas restrictivas (solo superadmin la lee
// directo — ver firestore.rules). El doc principal de voters sigue con
// `allow read: if isAuth()` para no romper ningún flujo existente
// (nombre/cedula/direccion/seccional/local/mesa/orden), pero deja de
// contener el teléfono, que es el dato sensible.
//
// Idempotente: si se corre dos veces, los docs ya migrados (sin campo
// `telefono` en el doc principal) se saltean sin tocar nada.
//
// Uso:
//   node scripts/migrate-voter-phones-to-private.js           (dry-run, no escribe nada)
//   node scripts/migrate-voter-phones-to-private.js --apply   (migra de verdad)
//
// Requiere haber corrido scripts/backup.js antes (deja un JSON completo de
// voters, incluido telefono, en backups/<timestamp>/voters.json).

import { getDb } from './lib/adminApp.js'
import admin from 'firebase-admin'

const PAGE_SIZE = 500
const WRITE_CHUNK = 200 // *2 escrituras por doc migrado (set + update) = 400 < límite 500 de un batch

const apply = process.argv.includes('--apply')

async function main() {
  const db = getDb()
  console.log(apply ? '🚀 Migrando de verdad (--apply)\n' : '🔎 Dry-run (no se escribe nada, agregá --apply para migrar)\n')

  let last = null
  let scanned = 0
  let withPhone = 0
  let migrated = 0
  let pending = [] // { ref, telefono, updatedAt, lastPhoneUpdateBy, lastPhoneUpdateCandidateId }

  async function flush() {
    if (pending.length === 0) return
    for (let i = 0; i < pending.length; i += WRITE_CHUNK) {
      const chunk = pending.slice(i, i + WRITE_CHUNK)
      if (apply) {
        const batch = db.batch()
        for (const item of chunk) {
          batch.set(item.ref.collection('private').doc('data'), {
            telefono: item.telefono,
            ...(item.updatedAt !== undefined && { updatedAt: item.updatedAt }),
            ...(item.lastPhoneUpdateBy !== undefined && { lastPhoneUpdateBy: item.lastPhoneUpdateBy }),
            ...(item.lastPhoneUpdateCandidateId !== undefined && { lastPhoneUpdateCandidateId: item.lastPhoneUpdateCandidateId })
          }, { merge: true })
          batch.update(item.ref, {
            telefono: admin.firestore.FieldValue.delete(),
            lastPhoneUpdateBy: admin.firestore.FieldValue.delete(),
            lastPhoneUpdateCandidateId: admin.firestore.FieldValue.delete()
          })
        }
        await batch.commit()
      }
      migrated += chunk.length
      process.stdout.write(`\r  migrados: ${migrated} / detectados con teléfono: ${withPhone} (escaneados: ${scanned})`)
    }
    pending = []
  }

  while (true) {
    let q = db.collection('voters').orderBy('__name__').limit(PAGE_SIZE)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break

    for (const doc of snap.docs) {
      scanned++
      const data = doc.data()
      if (data.telefono) {
        withPhone++
        pending.push({
          ref: doc.ref,
          telefono: String(data.telefono),
          updatedAt: data.updatedAt,
          lastPhoneUpdateBy: data.lastPhoneUpdateBy,
          lastPhoneUpdateCandidateId: data.lastPhoneUpdateCandidateId
        })
        if (pending.length >= WRITE_CHUNK * 2) await flush()
      }
    }

    last = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < PAGE_SIZE) break
  }

  await flush()

  console.log(`\n\n✅ Listo. Escaneados: ${scanned}. Con teléfono: ${withPhone}. ${apply ? 'Migrados' : 'A migrar (dry-run)'}: ${migrated}.`)
  if (!apply) console.log('   Corré de nuevo con --apply para escribir de verdad.')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error durante la migración:', err)
  process.exit(1)
})
