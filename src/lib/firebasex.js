import { initializeApp } from 'firebase/app'
import {
  getAuth,
  createUserWithEmailAndPassword,
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
  query,
  where,
  limit,
  deleteDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyD3kNTmqRpTqXBjCJI0yDwhcGY543bPBbI",
  authDomain: "samy-fidabel.firebaseapp.com",
  projectId: "samy-fidabel",
  storageBucket: "samy-fidabel.firebasestorage.app",
  messagingSenderId: "184842107847",
  appId: "1:184842107847:web:75dfb34197774edfbff7e2"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

export const loginUser = (email, password) =>
  signInWithEmailAndPassword(auth, email, password)

export const registerUser = (email, password) =>
  createUserWithEmailAndPassword(auth, email, password)

export const logoutUser = () => signOut(auth)

export const onAuthChange = (cb) => onAuthStateChanged(auth, cb)

export const getUserProfile = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

export const createUserProfile = async (uid, data) => {
  await setDoc(doc(db, 'users', uid), {
    ...data,
    role: 'user',
    createdAt: serverTimestamp()
  }, { merge: true })
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

export const saveRecord = async (uid, voter, telefono = '', nota = '', transporte = '') => {
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

export const setUserRole = async (uid, role) => {
  await setDoc(doc(db, 'users', uid), { role }, { merge: true })
}

/**
 * Obtiene todas las cédulas existentes en la colección voters
 * para detectar duplicados rápidamente
 */
export const getExistingCedulas = async () => {
  const snap = await getDocs(collection(db, 'voters'))
  return new Set(snap.docs.map(d => d.data().cedula))
}

/**
 * Importa votantes desde Excel con detección de duplicados
 * Evita sobrescribir datos existentes y reporta duplicados
 * 
 * @param {Array} rows - Filas del Excel
 * @param {Function} onProgress - Callback de progreso: (added, duplicates, total)
 * @returns {Object} Reporte con statisticas de la importación
 */
export const importVotersBatch = async (rows, onProgress) => {
  const BATCH_SIZE = 400
  const stats = {
    added: 0,
    duplicates: 0,
    errors: 0,
    total: rows.length,
    duplicateList: [] // Lista de cédulas duplicadas encontradas
  }

  // Obtener todas las cédulas existentes
  const existingCedulas = await getExistingCedulas()

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + BATCH_SIZE)
    
    chunk.forEach(row => {
      const cedula = String(row['Cédula'] || '').replace('.0', '').trim()
      
      // Si la cédula ya existe, no la agregamos (es duplicado)
      if (existingCedulas.has(cedula)) {
        stats.duplicates++
        stats.duplicateList.push(cedula)
        return
      }

      // Si no existe, la agregamos
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
      existingCedulas.add(cedula) // Agregar a la lista local para evitar duplicados dentro del mismo lote
    })

    try {
      await batch.commit()
    } catch (err) {
      stats.errors++
    }

    // Reportar progreso: (agregados, duplicados, total)
    if (onProgress) {
      onProgress(stats.added, stats.duplicates, stats.total)
    }
  }

  return stats
}

export async function createUserFromAdmin(email, password, userData) {
  try {
    const { httpsCallable, getFunctions } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-functions.js')
    const functions = getFunctions(app)
    const crearNuevoUsuario = httpsCallable(functions, 'crearNuevoUsuario')
    
    const result = await crearNuevoUsuario({
      nombre: userData.displayName || '',
      email: email,
      password: password,
      rol: userData.role || 'user'
    })
    
    return result.data.uid
  } catch (err) {
    throw err
  }
}
