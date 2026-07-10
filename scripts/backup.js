// Exporta TODAS las colecciones legacy (esquema de un solo candidato) a
// JSON local, antes de correr la migración. Nunca borra nada en Firestore.
//
// Uso:
//   node scripts/backup.js
//
// Salida: backups/<timestamp>/<coleccion>.json (backups/ está en .gitignore)

import fs from 'fs'
import path from 'path'
import { getDb, repoRootPath } from './lib/adminApp.js'

const LEGACY_COLLECTIONS = [
  'users',
  'voters',
  'savedRecords',
  'dia_d_votos',
  'mesa_votacion2025',
  'votationMarks',
  'choferes',
  'dia_d_choferes',
  'campaignDrivers2025',
  'dia_d_transporte',
  'dia_d_estado'
]
const LEGACY_CONFIG_DOCS = [['config', 'electionDay']]

const PAGE_SIZE = 500

async function exportCollection(db, name) {
  const out = []
  let last = null
  while (true) {
    let q = db.collection(name).orderBy('__name__').limit(PAGE_SIZE)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    snap.docs.forEach(d => out.push({ id: d.id, data: d.data() }))
    last = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < PAGE_SIZE) break
  }
  return out
}

async function main() {
  const db = getDb()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(repoRootPath, 'backups', stamp)
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`📦 Backup → ${outDir}\n`)

  const summary = {}
  for (const name of LEGACY_COLLECTIONS) {
    process.stdout.write(`  ${name} ... `)
    const docs = await exportCollection(db, name)
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(docs, null, 2))
    summary[name] = docs.length
    console.log(`${docs.length} docs`)
  }

  const configOut = {}
  for (const [coll, id] of LEGACY_CONFIG_DOCS) {
    const snap = await db.collection(coll).doc(id).get()
    configOut[`${coll}/${id}`] = snap.exists ? snap.data() : null
  }
  fs.writeFileSync(path.join(outDir, 'config.json'), JSON.stringify(configOut, null, 2))

  fs.writeFileSync(
    path.join(outDir, '_summary.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), counts: summary, config: configOut }, null, 2)
  )

  console.log(`\n✅ Backup completo. Guardá esta carpeta fuera del repo también (${outDir}).`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error durante el backup:', err)
  process.exit(1)
})
