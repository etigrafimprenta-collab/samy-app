// Migra los datos legacy (un solo candidato) a /candidates/{candidateId}/...
//
// Por defecto corre en DRY RUN: lee todo, imprime el plan y los conteos,
// y NO escribe nada. Solo escribe si se pasa --confirm explícitamente.
// Nunca borra las colecciones viejas (eso es una tarea aparte de Fase 6,
// una vez que se validó que la migración quedó bien).
//
// Uso:
//   node scripts/migrate-to-candidate.js                  → dry run
//   node scripts/migrate-to-candidate.js --confirm         → migra de verdad
//   node scripts/migrate-to-candidate.js --confirm --candidate-id=otro-id --candidate-name="Otro Nombre"

import fs from 'fs'
import path from 'path'
import { getDb, repoRootPath } from './lib/adminApp.js'

const args = process.argv.slice(2)
const CONFIRM = args.includes('--confirm')
const getArg = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : def
}
const CANDIDATE_ID = getArg('candidate-id', 'samy-fidabel')
const CANDIDATE_NAME = getArg('candidate-name', 'Samy Fidabel')

const ROLE_MAP = {
  admin: 'campaign_admin',
  militante: 'dirigente',
  mesario: 'mesario',
  veedor: 'viewer',
  user: 'viewer'
}

const PAGE_SIZE = 500

async function readAll(db, name) {
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

async function backfillBeforeWrite(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(repoRootPath, 'backups', `pre-migration-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })
  const collections = [
    'users', 'voters', 'savedRecords', 'dia_d_votos', 'mesa_votacion2025',
    'votationMarks', 'choferes', 'dia_d_choferes', 'campaignDrivers2025'
  ]
  console.log(`\n📦 Backup de seguridad previo a escribir → ${outDir}`)
  for (const name of collections) {
    const docs = await readAll(db, name)
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(docs, null, 2))
  }
  const configSnap = await db.collection('config').doc('electionDay').get()
  fs.writeFileSync(
    path.join(outDir, 'config.json'),
    JSON.stringify({ enabled: configSnap.exists ? configSnap.data() : null }, null, 2)
  )
  console.log('   ✅ Backup de seguridad listo.')
  return outDir
}

async function writeInBatches(db, docs, mapFn) {
  const CHUNK = 400
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch()
    docs.slice(i, i + CHUNK).forEach(d => {
      const { ref, data } = mapFn(d)
      batch.set(ref, data)
    })
    await batch.commit()
  }
}

async function main() {
  const db = getDb()
  const candidateRef = db.collection('candidates').doc(CANDIDATE_ID)

  console.log(`\n${CONFIRM ? '🚀 MIGRACIÓN REAL' : '🔎 DRY RUN (nada se va a escribir)'} → candidateId="${CANDIDATE_ID}"\n`)

  // ── 1. Leer todo lo legacy ──────────────────────────────────────────
  // voters NO se migra: el padrón es compartido entre todos los
  // candidatos y se queda donde siempre estuvo (colección /voters de
  // nivel raíz). Se lee igual acá solo para completar seccional/mesa de
  // los votos de dia_d_votos al fusionarlos (paso 3).
  console.log('Leyendo colecciones legacy...')
  const [voters, users, savedRecords, diaDVotos, mesaVotacion, votationMarks, choferes, diaDChoferes, campaignDrivers] =
    await Promise.all([
      readAll(db, 'voters'),
      readAll(db, 'users'),
      readAll(db, 'savedRecords'),
      readAll(db, 'dia_d_votos'),
      readAll(db, 'mesa_votacion2025'),
      readAll(db, 'votationMarks'),
      readAll(db, 'choferes'),
      readAll(db, 'dia_d_choferes'),
      readAll(db, 'campaignDrivers2025')
    ])
  const configSnap = await db.collection('config').doc('electionDay').get()

  // ── 2. Armar el índice cedula → {seccional,mesa,local} para poder
  //      completar los votos de dia_d_votos, que no guardan mesa/seccional. ──
  const votersByCedula = new Map()
  voters.forEach(v => votersByCedula.set(v.data.cedula, v.data))

  // ── 3. Combinar las 3 fuentes de "voto marcado" en una sola, por cédula ──
  const votesByCedula = new Map()
  const mergeVote = (cedula, partial) => {
    if (!cedula) return
    const prev = votesByCedula.get(cedula) || {}
    votesByCedula.set(cedula, { ...prev, ...partial, cedula })
  }
  mesaVotacion.forEach(({ data }) => mergeVote(data.cedula, {
    seccional: data.seccional ?? null,
    mesa: data.mesa != null ? String(data.mesa) : null,
    voted: true,
    markedAt: data.votedAt ?? null,
    _sources: [...(votesByCedula.get(data.cedula)?._sources || []), 'mesa_votacion2025']
  }))
  diaDVotos.forEach(({ data }) => {
    const backfill = votersByCedula.get(data.cedula)
    mergeVote(data.cedula, {
      markedBy: data.militante_uid ?? null,
      voted: true,
      markedAt: votesByCedula.get(data.cedula)?.markedAt ?? data.votedAt ?? null,
      seccional: votesByCedula.get(data.cedula)?.seccional ?? backfill?.seccional ?? null,
      mesa: votesByCedula.get(data.cedula)?.mesa ?? backfill?.mesa ?? null,
      local: backfill?.local ?? null,
      _sources: [...(votesByCedula.get(data.cedula)?._sources || []), 'dia_d_votos']
    })
  })
  votationMarks.forEach(({ data }) => mergeVote(data.cedula, {
    seccional: votesByCedula.get(data.cedula)?.seccional ?? data.seccional ?? null,
    mesa: votesByCedula.get(data.cedula)?.mesa ?? (data.mesa != null ? String(data.mesa) : null),
    voted: true,
    _sources: [...(votesByCedula.get(data.cedula)?._sources || []), 'votationMarks']
  }))

  const mergedVotes = [...votesByCedula.values()]
  const votesMissingMesa = mergedVotes.filter(v => !v.seccional || !v.mesa).length

  // ── 4. Plan / conteos ────────────────────────────────────────────────
  const plan = [
    ['candidates/' + CANDIDATE_ID, 1],
    ['(sin migrar — voters queda compartido)', voters.length],
    ['candidates/' + CANDIDATE_ID + '/users', users.length],
    ['candidates/' + CANDIDATE_ID + '/savedRecords', savedRecords.length],
    ['candidates/' + CANDIDATE_ID + '/diaD/current/votes', mergedVotes.length],
    ['candidates/' + CANDIDATE_ID + '/drivers', choferes.length + diaDChoferes.length + campaignDrivers.length],
    ['candidates/' + CANDIDATE_ID + '/config/electionDay', 1]
  ]
  console.log('\nPlan de migración:')
  plan.forEach(([target, count]) => console.log(`  ${target.padEnd(45)} ${count} doc(s)`))
  if (votesMissingMesa > 0) {
    console.log(`\n⚠️  ${votesMissingMesa} voto(s) migrado(s) sin seccional/mesa reconstruible (cédula no encontrada en voters). Revisalos después en el panel.`)
  }
  const rolesVistos = new Set(users.map(u => u.data.role))
  console.log(`\nRoles legacy encontrados: ${[...rolesVistos].join(', ') || '(ninguno)'}`)
  console.log('Se van a mapear así:', ROLE_MAP)
  const passwordFieldCount = users.filter(u => u.data.password).length
  if (passwordFieldCount > 0) {
    console.log(`⚠️  ${passwordFieldCount} usuario(s) tenían un campo "password" en texto plano en Firestore — NO se va a migrar (las contraseñas viven solo en Firebase Auth).`)
  }

  if (!CONFIRM) {
    console.log('\n🔎 DRY RUN — no se escribió nada. Corré de nuevo con --confirm para migrar de verdad.')
    process.exit(0)
  }

  // ── 5. Backup de seguridad + confirmación explícita ya dada por --confirm ─
  await backfillBeforeWrite(db)

  const existing = await candidateRef.get()
  if (existing.exists) {
    console.log(`\nℹ️  El candidato "${CANDIDATE_ID}" ya existe, no lo piso — sigo migrando datos.`)
  } else {
    await candidateRef.set({
      name: CANDIDATE_NAME,
      slug: CANDIDATE_ID,
      status: 'active',
      plan: 'basic',
      logoUrl: '',
      primaryColor: '',
      electionName: '',
      electionDate: null,
      createdAt: new Date(),
      createdBy: 'migrate-to-candidate-script'
    })
    console.log(`\n✅ Candidato "${CANDIDATE_ID}" creado.`)
  }

  console.log('Migrando users (sin campo password, con rol remapeado)...')
  await writeInBatches(db, users, ({ id, data }) => {
    const { password, ...rest } = data
    return {
      ref: candidateRef.collection('users').doc(id),
      data: { ...rest, uid: id, role: ROLE_MAP[data.role] || 'viewer' }
    }
  })

  console.log('Migrando savedRecords...')
  await writeInBatches(db, savedRecords, ({ id, data }) => ({
    ref: candidateRef.collection('savedRecords').doc(id),
    data: { ...data, updatedAt: data.updatedAt ?? new Date() }
  }))

  console.log('Migrando votos de Día D (fusionados)...')
  await writeInBatches(db, mergedVotes.map((v, i) => ({ id: String(i), data: v })), ({ data }) => {
    const docId = data.seccional && data.mesa
      ? `${data.seccional}_${data.mesa}_${data.cedula}`
      : `sin-mesa_${data.cedula}`
    const { _sources, ...clean } = data
    return {
      ref: candidateRef.collection('diaD').doc('current').collection('votes').doc(docId),
      data: clean
    }
  })

  console.log('Migrando choferes (3 colecciones legacy → drivers, sin deduplicar)...')
  const allDrivers = [
    ...choferes.map(d => ({ ...d, _from: 'choferes' })),
    ...diaDChoferes.map(d => ({ ...d, _from: 'dia_d_choferes' })),
    ...campaignDrivers.map(d => ({ ...d, _from: 'campaignDrivers2025' }))
  ]
  await writeInBatches(db, allDrivers, ({ id, data, _from }) => ({
    ref: candidateRef.collection('drivers').doc(`${_from}_${id}`),
    data: { ...data, status: data.status || 'activo', _migratedFrom: _from }
  }))

  await candidateRef.collection('config').doc('electionDay').set(
    configSnap.exists ? configSnap.data() : { enabled: false, lastUpdated: new Date(), toggledBy: 'migrate-script' }
  )

  console.log('\n✅ Migración completa. Las colecciones viejas NO se borraron.')
  console.log('   Validá con las cuentas de prueba (ver README) antes de correr la limpieza de Fase 6.')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error durante la migración:', err)
  process.exit(1)
})
