// Inicialización compartida del Admin SDK para todos los scripts de
// scripts/*.js. Nunca hardcodea una ruta de credencial: la clave de
// servicio NUNCA debe volver a versionarse en git (ver auditoría V.2).
//
// Uso:
//   FIREBASE_SERVICE_ACCOUNT_PATH=/ruta/a/clave.json node scripts/backup.js
// o, si el archivo está en la raíz del repo con alguno de los nombres
// convencionales de abajo, no hace falta setear nada.

import admin from 'firebase-admin'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..', '..')

const CANDIDATE_PATHS = [
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  path.join(repoRoot, 'firebase-service-account.json'),
  path.join(repoRoot, 'serviceAccountKey.json')
].filter(Boolean)

let app = null

export function getAdminApp() {
  if (app) return app

  const found = CANDIDATE_PATHS.find(p => fs.existsSync(p))
  if (!found) {
    console.error('❌ No se encontró una clave de servicio de Firebase Admin.')
    console.error('   Probé en:')
    CANDIDATE_PATHS.forEach(p => console.error('     - ' + p))
    console.error('')
    console.error('   Descargá una nueva desde Firebase Console → Configuración del')
    console.error('   proyecto → Cuentas de servicio → Generar nueva clave privada,')
    console.error('   y guardala como firebase-service-account.json en la raíz del')
    console.error('   repo (ya está en .gitignore, nunca se va a commitear), o')
    console.error('   pasá la ruta con FIREBASE_SERVICE_ACCOUNT_PATH=...')
    process.exit(1)
  }

  const serviceAccount = JSON.parse(fs.readFileSync(found, 'utf8'))
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  console.log(`🔑 Admin SDK inicializado con ${path.basename(found)} (proyecto: ${serviceAccount.project_id})`)
  return app
}

export function getDb() {
  return getAdminApp().firestore()
}

export function getAuth() {
  return getAdminApp().auth()
}

export const repoRootPath = repoRoot
