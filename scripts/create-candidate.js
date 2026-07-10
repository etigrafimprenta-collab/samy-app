// Crea un candidato NUEVO y vacío, con su primer campaign_admin.
// Nunca copia ni referencia datos de otro candidato.
//
// Uso:
//   node scripts/create-candidate.js \
//     --id=juan-perez \
//     --name="Juan Pérez" \
//     --admin-name="María González" \
//     --admin-email=maria@juanperez2026.com \
//     [--admin-password=algo-seguro]   (si se omite, se genera una)

import crypto from 'crypto'
import { getDb, getAuth } from './lib/adminApp.js'

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : def
}

const candidateId = getArg('id')
const name = getArg('name')
const adminNombre = getArg('admin-name')
const adminEmail = getArg('admin-email')
const adminPassword = getArg('admin-password') || crypto.randomBytes(9).toString('base64url')

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

if (!candidateId || !SLUG_RE.test(candidateId)) {
  console.error('❌ --id inválido. Usá minúsculas, números y guiones, ej: --id=juan-perez')
  process.exit(1)
}
if (!name || !adminNombre || !adminEmail) {
  console.error('❌ Faltan argumentos. Uso: node scripts/create-candidate.js --id=... --name="..." --admin-name="..." --admin-email=...')
  process.exit(1)
}

async function main() {
  const db = getDb()
  const auth = getAuth()

  const candidateRef = db.collection('candidates').doc(candidateId)
  const existing = await candidateRef.get()
  if (existing.exists) {
    console.error(`❌ Ya existe un candidato con id "${candidateId}"`)
    process.exit(1)
  }

  const adminRecord = await auth.createUser({
    email: adminEmail,
    password: adminPassword,
    displayName: adminNombre
  })

  const batch = db.batch()
  batch.set(candidateRef, {
    name,
    slug: candidateId,
    status: 'active',
    plan: 'basic',
    logoUrl: '',
    primaryColor: '',
    electionName: '',
    electionDate: null,
    createdAt: new Date(),
    createdBy: 'create-candidate-script'
  })
  batch.set(candidateRef.collection('users').doc(adminRecord.uid), {
    uid: adminRecord.uid,
    email: adminEmail,
    nombre: adminNombre,
    role: 'campaign_admin',
    status: 'activo',
    createdAt: new Date(),
    createdBy: 'create-candidate-script'
  })
  batch.set(candidateRef.collection('config').doc('electionDay'), {
    enabled: false,
    lastUpdated: new Date(),
    toggledBy: 'create-candidate-script'
  })
  await batch.commit()

  console.log(`\n✅ Candidato "${name}" (${candidateId}) creado, vacío.`)
  console.log(`✅ Administrador de campaña: ${adminEmail}`)
  console.log(`   Contraseña: ${adminPassword}`)
  console.log('   Copiala ahora — no se vuelve a mostrar. El admin puede cambiarla al ingresar.')
  process.exit(0)
}

main().catch(err => {
  if (err.code === 'auth/email-already-exists') {
    console.error(`❌ El email ${adminEmail} ya está registrado en Firebase Auth.`)
  } else {
    console.error('❌ Error creando el candidato:', err)
  }
  process.exit(1)
})
