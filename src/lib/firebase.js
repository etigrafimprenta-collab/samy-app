import { initializeApp } from 'firebase/app'
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth'
import {
   getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  limit,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  onSnapshot
} from 'firebase/firestore'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'
import { connectFirestoreEmulator } from 'firebase/firestore'
import { connectAuthEmulator } from 'firebase/auth'

// Hardening Fase 2.5 §3: modo Emulator Suite, EXCLUSIVAMENTE opt-in vía
// `npm run dev:emulator` (VITE_USE_FIREBASE_EMULATOR=true en .env.emulator,
// ver package.json/vite.config.js) — `npm run dev`/`npm run build`
// normales NUNCA activan esto, cero cambio de comportamiento para
// producción/desarrollo real. Cuando está activo, se usa un projectId
// "demo-*" DISTINTO del real ("samy-fidabel") en vez de reconectar el
// mismo config real a localhost — así, si por cualquier motivo alguna de
// las 3 líneas connect*Emulator no llegara a ejecutarse, el SDK apuntaría
// a un proyecto que no existe (demo-sigev-local) en vez de arriesgarse a
// tocar el proyecto real por accidente. Mismo principio de seguridad ya
// aplicado en las suites de functions/test/ (projectIds demo-*).
// BUG REAL encontrado en el hardening Fase 2.5 (walkthrough + regresión de
// tests): `import.meta.env` solo existe cuando Vite sirve/empaqueta el
// módulo — bajo Node plano (ej. `node --test` importando este archivo de
// forma transitiva, como hace firebaseIncidents.test.js) `import.meta.env`
// es `undefined`, y acceder a `.VITE_USE_FIREBASE_EMULATOR` tiraba
// `TypeError` al importar, no solo al usarlo. `?.` lo resuelve: fuera de
// Vite, USE_EMULATOR cae a `false` (config real) sin romper el import.
const USE_EMULATOR = import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true'
// Staging real (proyecto sigev-staging, autorizado por el usuario —
// "Opción A: crear un proyecto Firebase de staging separado", hardening
// Fase 2.5 §16) — opt-in vía `npm run dev:staging` (.env.staging), NUNCA
// activo por defecto. A diferencia del modo emulador, acá SÍ se habla con
// servicios reales de Google (Firestore/Auth/Functions de sigev-staging),
// pero NUNCA con samy-fidabel — son proyectos GCP distintos, sin relación.
const USE_STAGING = import.meta.env?.VITE_USE_STAGING === 'true'

// Config de producción (samy-fidabel) — YA NO hardcodeada. Netlify tiene
// estas 6 variables configuradas para el contexto `production` (ver
// `netlify env:list --context production`) y, desde este cambio,
// `SECRETS_SCAN_OMIT_KEYS` las excluye explícitamente del secrets
// scanning de Netlify — son el config público del SDK Web de Firebase
// (nunca secreto real: la seguridad la dan las Firestore/Storage rules y
// las restricciones de la apiKey en Google Cloud, no ocultar estos
// valores). Antes estaban hardcodeadas acá y coincidían con esas mismas
// variables salvo `appId`, que en Netlify apuntaba a una Web App que ya
// no existe en el proyecto — corregido en Netlify, verificado contra el
// listado real de Firebase (`projects/samy-fidabel/webApps`) antes de
// este cambio, no asumido.
// Fail-fast genérico — nunca inicializa Firebase en silencio con un
// valor undefined. `where` identifica de dónde debería salir la
// variable faltante (nunca imprime el valor, solo el nombre).
function requireEnv(key, where) {
  const value = import.meta.env?.[key]
  if (!value) {
    throw new Error(`Config de Firebase incompleta: falta la variable de entorno ${key} (${where}).`)
  }
  return value
}
const requireProdEnv = (key) => requireEnv(key, 'definila en Netlify → Site configuration → Environment variables, contexto production')

const firebaseConfig = USE_EMULATOR
  ? {
      apiKey: 'demo-key',
      authDomain: 'demo-sigev-local.firebaseapp.com',
      projectId: 'demo-sigev-local',
      storageBucket: 'demo-sigev-local.appspot.com',
      messagingSenderId: '0',
      appId: '1:0:web:0'
    }
  : USE_STAGING
  ? {
      // Detección inteligente de secretos de Netlify (smart detection)
      // encuentra el patrón de API key de Google como texto literal en
      // cualquier archivo del repo clonado, sin importar si el build lo usa o no
      // — SECRETS_SCAN_OMIT_KEYS no la cubre (esa solo suprime la
      // detección "valor de env var apareció en el output"). Resto de
      // la config de staging queda igual: no es lo que el scanner
      // reportó, no hace falta tocarlo.
      apiKey: requireEnv('VITE_STAGING_FIREBASE_API_KEY', 'definila en .env.staging — archivo local, nunca se commitea'),
      authDomain: 'sigev-staging.firebaseapp.com',
      projectId: 'sigev-staging',
      storageBucket: 'sigev-staging.firebasestorage.app',
      messagingSenderId: '130499056486',
      appId: '1:130499056486:web:0e0ebf5c16e7ab56e56ea7'
    }
  : {
      apiKey: requireProdEnv('VITE_FIREBASE_API_KEY'),
      authDomain: requireProdEnv('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: requireProdEnv('VITE_FIREBASE_PROJECT_ID'),
      storageBucket: requireProdEnv('VITE_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: requireProdEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: requireProdEnv('VITE_FIREBASE_APP_ID')
    }

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const functionsInstance = getFunctions(app)

if (USE_EMULATOR) {
  // Conectar INMEDIATAMENTE después de crear cada cliente, antes de
  // cualquier lectura/escritura — connect*Emulator debe llamarse antes
  // del primer uso real del SDK correspondiente.
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFunctionsEmulator(functionsInstance, 'localhost', 5001)
  // eslint-disable-next-line no-console
  console.warn('🧪 Firebase Emulator Suite activo (demo-sigev-local) — NO es producción. Datos ficticios únicamente.')
} else if (USE_STAGING) {
  // eslint-disable-next-line no-console
  console.warn('🧪 Conectado a sigev-staging (proyecto real de staging) — NO es samy-fidabel. Usar solo datos ficticios.')
}

export const loginUser = (email, password) =>
  signInWithEmailAndPassword(auth, email, password)

export const logoutUser = () => signOut(auth)

export const onAuthChange = (cb) => onAuthStateChanged(auth, cb)

export const getUserProfile = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

export async function createUserProfile(uid, data) {
  const userRef = doc(db, 'users', uid)
  await setDoc(userRef, {
    ...data,
    role: data.role || 'militante',
    createdAt: new Date()
  })
}

export const searchByCedula = async (cedula) => {
  const q = query(
    collection(db, 'voters'),
    where('cedula', '==', cedula.trim()),
    limit(1)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export const searchByName = async (termino) => {
  const upper = termino.trim().toUpperCase()
  const q = query(
    collection(db, 'voters'),
    where('nombre_upper', '>=', upper),
    where('nombre_upper', '<=', upper + '\uf8ff'),
    limit(50)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export const saveRecord = async (uid, voter, telefono = '', nota = '', transporte = '', allowDuplicate = false, militanteName = '') => {
  // ✅ VALIDAR DUPLICADOS: Evitar guardar el mismo votante 2 veces
  if (!allowDuplicate) {
    const q = query(
      collection(db, 'savedRecords'),
      where('uid', '==', uid),
      where('cedula', '==', voter.cedula)
    )
    const snap = await getDocs(q)
    if (snap.docs.length > 0) {
      throw new Error(`⚠️ Este votante (CI ${voter.cedula}) ya fue guardado por ti. No se puede duplicar.`)
    }
  }

  // Guardar registro
  await addDoc(collection(db, 'savedRecords'), {
    uid,
    cedula: voter.cedula,
    nombre: voter.nombre,
    direccion: voter.direccion,
    seccional: voter.seccional,
    local: voter.local || '',
    mesa: voter.mesa || '',
    orden: voter.orden || '',
    telefono: telefono || '',
    nota: nota || '',
    transporte: transporte || 'No especificado',
    militanteName: militanteName || '',
    savedAt: serverTimestamp()
  })
}

export const getUserRecords = async (uid) => {
  const q = query(
    collection(db, 'savedRecords'),
    where('uid', '==', uid)
  )
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dateA = a.savedAt?.toDate?.() || new Date(0)
      const dateB = b.savedAt?.toDate?.() || new Date(0)
      return dateB - dateA
    })
}

export const deleteRecord = async (id) => {
  await deleteDoc(doc(db, 'savedRecords', id))
}

export const getAllRecords = async () => {
  const snap = await getDocs(collection(db, 'savedRecords'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dateA = a.savedAt?.toDate?.() || new Date(0)
      const dateB = b.savedAt?.toDate?.() || new Date(0)
      return dateB - dateA
    })
}

export const getAllUsers = async () => {
  const snap = await getDocs(collection(db, 'users'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export const getExistingCedulas = async () => {
  const snap = await getDocs(collection(db, 'voters'))
  return new Set(snap.docs.map(d => d.data().cedula))
}

export const importVotersBatch = async (rows, onProgress) => {
  const BATCH_SIZE = 400
  const stats = {
    added: 0,
    duplicates: 0,
    errors: 0,
    total: rows.length,
    duplicateList: []
  }

  const existingCedulas = await getExistingCedulas()

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + BATCH_SIZE)
    
    chunk.forEach(row => {
      const cedula = String(row['Cédula'] || '').replace('.0', '').trim()
      
      if (existingCedulas.has(cedula)) {
        stats.duplicates++
        stats.duplicateList.push(cedula)
        return
      }

      const ref = doc(collection(db, 'voters'))
      const nombre = String(row['Apellidos y Nombres'] || '').trim()
      
      batch.set(ref, {
        cedula,
        nombre,
        nombre_upper: nombre.toUpperCase(),
        direccion: String(row['Dirección'] || '').trim(),
        nacimiento: String(row['F. Nacimiento'] || '').trim(),
        afiliacion: String(row['F. Afiliación'] || '').trim(),
        seccional: String(row['Seccional'] || '').replace('.0', '').trim(),
        local: String(row['Local de Votacion'] || '').trim(),
        mesa: String(row['Mesa'] || '').replace('.0', '').trim(),
        orden: String(row['Orden'] || '').replace('.0', '').trim()
      })
      
      stats.added++
      existingCedulas.add(cedula)
    })

    try {
      await batch.commit()
    } catch (err) {
      stats.errors++
    }

    if (onProgress) {
      onProgress(stats.added, stats.duplicates, stats.total)
    }
  }

  return stats
}

export async function createUserFromAdmin(email, password, userData) {
  const crearNuevoUsuario = httpsCallable(functionsInstance, 'crearNuevoUsuario')
  const result = await crearNuevoUsuario({
    nombre: userData.displayName || '',
    email: email,
    password: password,
    rol: userData.role || 'user'
  })
  return result.data.uid
}

export const onElectionDayChange = (callback) => {
  return onSnapshot(
    doc(db, 'config', 'electionDay'),
    docSnap => callback(docSnap.exists() ? docSnap.data().enabled : false),
    err => console.error('❌ Error escuchando Día D:', err)
  )
}

export const setElectionDayEnabled = async (enabled, uid) => {
  await setDoc(doc(db, 'config', 'electionDay'), {
    enabled,
    lastUpdated: serverTimestamp(),
    toggledBy: uid
  }, { merge: true })
}

export const saveElectionVote = async (uid, cedula, nombre) => {
  const configSnap = await getDoc(doc(db, 'config', 'electionDay'))
  if (!configSnap.exists() || !configSnap.data().enabled) {
    throw new Error('Día D no está habilitado')
  }
  await setDoc(doc(db, 'dia_d_votos', uid + '_' + cedula), {
    militante_uid: uid,
    cedula,
    nombre,
    voted: true,
    votedAt: serverTimestamp()
  }, { merge: true })
}

export const updateRecord = async (id, updates) => {
  const { updateDoc } = await import('firebase/firestore')
  await updateDoc(doc(db, 'savedRecords', id), {
    ...updates,
    updatedAt: serverTimestamp()
  })
}

export async function createChofer(data) {
  return addDoc(collection(db, 'campaignDrivers2025'), {
    ...data,
    votantesAsignados: data.votantesAsignados || 0,
    votantes: data.votantes || [],
    createdAt: serverTimestamp()
  })
}

export async function getChoferes() {
  const querySnapshot = await getDocs(collection(db, 'campaignDrivers2025'))
  const choferes = []

  querySnapshot.forEach(document => {
    choferes.push({
      id: document.id,
      ...document.data()
    })
  })

  return choferes.sort((a, b) =>
    String(a.nombre || '').localeCompare(String(b.nombre || ''))
  )
}

export async function updateChofer(id, data) {
  return updateDoc(doc(db, 'campaignDrivers2025', id), {
    ...data,
    updatedAt: serverTimestamp()
  })
}

export async function deleteChofer(id) {
  return deleteDoc(doc(db, 'campaignDrivers2025', id))
}

export async function getVotantesPorSeccional(seccional) {
  const q = query(
    collection(db, 'savedRecords'),
    where('seccional', '==', seccional)
  )

  const querySnapshot = await getDocs(q)
  const votantes = []

  querySnapshot.forEach(document => {
    const data = document.data()
    votantes.push({
      id: document.id,
      cedula: data.cedula || '',
      nombre: data.nombre || '',
      celular: data.telefono || '',
      local: data.local || '',
      seccional: data.seccional || ''
    })
  })

  return votantes.sort((a, b) =>
    String(a.nombre || '').localeCompare(String(b.nombre || ''))
  )
}

export async function assignVotantesToChofer(choferId, votantes) {
  return updateDoc(doc(db, 'campaignDrivers2025', choferId), {
    votantes: votantes || [],
    votantesAsignados: votantes?.length || 0,
    updatedAt: serverTimestamp()
  })
}

export async function getChofersVotantes(choferId) {
  const docSnapshot = await getDoc(doc(db, 'campaignDrivers2025', choferId))

  if (docSnapshot.exists()) {
    return docSnapshot.data().votantes || []
  }

  return []
}

export async function getChofersVotantesByUser(uid) {
  const q = query(
    collection(db, 'campaignDrivers2025'),
    where('usuarioAsignado', '==', uid)
  )

  const querySnapshot = await getDocs(q)

  if (querySnapshot.empty) return null

  const document = querySnapshot.docs[0]
  return {
    id: document.id,
    ...document.data()
  }
}

export async function getVotantesDelMesario(seccional, mesa) {
  const q = query(
    collection(db, 'voters'),
    where('seccional', '==', seccional),
    where('mesa', '==', mesa)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getNuestrosVotosDeMesa(seccional, mesa) {
  const q = query(
    collection(db, 'savedRecords'),
    where('seccional', '==', seccional),
    where('mesa', '==', mesa)
  )
  const snap = await getDocs(q)
  return new Set(snap.docs.map(d => d.data().cedula))
}

export async function marcarVoto(seccional, mesa, cedula) {
  const docId = `${seccional}_${mesa}_${cedula}`
  await setDoc(doc(db, 'mesa_votacion2025', docId), {
    seccional,
    mesa,
    cedula,
    votedAt: serverTimestamp()
  }, { merge: true })
}

export async function getVotosDelMesario(seccional, mesa) {
  const q = query(
    collection(db, 'mesa_votacion2025'),
    where('seccional', '==', seccional),
    where('mesa', '==', mesa)
  )
  const snap = await getDocs(q)
  return new Set(snap.docs.map(d => d.data().cedula))
}

// El rol se cambia exclusivamente vía Cloud Function (validación server-side,
// deja registro en auditLogs). firestore.rules ya rechaza que un cliente
// escriba `role` directamente, salvo el propio admin sobre otros usuarios.
export async function updateUserRole(uid, newRole) {
  try {
    const cambiarRolUsuario = httpsCallable(functionsInstance, 'cambiarRolUsuario')
    const result = await cambiarRolUsuario({ uid, newRole })
    return result.data
  } catch (err) {
    throw new Error(`Error actualizando rol: ${err.message}`)
  }
}

// Las contraseñas viven únicamente en Firebase Auth — nunca en Firestore.
// Si no se pasa newPassword, el servidor genera una segura y la devuelve
// una única vez en el resultado (generatedPassword) para mostrarla al admin.
export async function updateUserPassword(uid, newPassword) {
  try {
    const resetearPasswordUsuario = httpsCallable(functionsInstance, 'resetearPasswordUsuario')
    const result = await resetearPasswordUsuario({ uid, newPassword })
    return result.data
  } catch (err) {
    throw new Error(`Error actualizando contraseña: ${err.message}`)
  }
}

export async function updateUserMesaLocal(uid, data) {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      seccional: data.seccional || null,
      mesa: data.mesa || null,
      local: data.local || null,
      mesasAsignadas: data.mesasAsignadas || null
    })
    return { success: true }
  } catch (err) {
    throw new Error(`Error actualizando mesa/local: ${err.message}`)
  }
}

export async function deleteUserAccount(uid) {
  try {
    const userRef = doc(db, 'users', uid)
    await deleteDoc(userRef)
    return { success: true }
  } catch (err) {
    throw new Error(`Error borrando usuario: ${err.message}`)
  }
}

export async function getUserById(uid) {
  try {
    const userRef = doc(db, 'users', uid)
    const userSnap = await getDoc(userRef)
    if (userSnap.exists()) {
      return userSnap.data()
    }
    throw new Error('Usuario no encontrado')
  } catch (err) {
    throw new Error(`Error obteniendo usuario: ${err.message}`)
  }
}

export { deleteDoc, doc, updateDoc, getDoc }