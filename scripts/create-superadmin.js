// Otorga (o crea) el rol de superadmin de plataforma para un email dado.
// Es el único camino para crear el PRIMER superadmin (después, un
// superadmin existente puede usar el panel para nombrar a otro, ya que
// firestore.rules exige isSuperAdmin() para escribir /platformUsers/*).
//
// Uso:
//   node scripts/create-superadmin.js --email=vos@tuempresa.com [--name="Tu Nombre"] [--password=algo-seguro]

import crypto from 'crypto'
import { getDb, getAuth } from './lib/adminApp.js'

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : def
}

const email = getArg('email')
const displayName = getArg('name', email)
const password = getArg('password') || crypto.randomBytes(9).toString('base64url')

if (!email) {
  console.error('❌ Uso: node scripts/create-superadmin.js --email=vos@tuempresa.com')
  process.exit(1)
}

async function main() {
  const db = getDb()
  const auth = getAuth()

  let userRecord
  let created = false
  try {
    userRecord = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    userRecord = await auth.createUser({ email, password, displayName })
    created = true
  }

  await db.collection('platformUsers').doc(userRecord.uid).set({
    email,
    displayName,
    globalRole: 'superadmin',
    createdAt: new Date(),
    status: 'activo'
  }, { merge: true })

  console.log(`\n✅ ${email} ahora es superadmin de la plataforma.`)
  if (created) {
    console.log(`   Cuenta creada. Contraseña: ${password}`)
    console.log('   Copiala ahora — no se vuelve a mostrar.')
  } else {
    console.log('   La cuenta ya existía en Firebase Auth, solo se agregó el rol de superadmin.')
  }
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error creando el superadmin:', err)
  process.exit(1)
})
