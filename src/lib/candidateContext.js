// Resuelve a qué candidato(s) pertenece el usuario logueado y cuál está
// activo en esta sesión del navegador. No asume que un uid pertenece a un
// solo candidato: un mismo uid puede tener un doc de membresía en varios
// /candidates/{candidateId}/users/{uid} (p.ej. un consultor que colabora
// con dos campañas), de ahí el selector de candidato en Fase 5.

import {
  collection,
  getDocs,
  getDoc,
  doc
} from 'firebase/firestore'
import { db } from './firebase.js'

const STORAGE_KEY = 'activeCandidateId'

export async function isPlatformSuperAdmin(uid) {
  const snap = await getDoc(doc(db, 'platformUsers', uid))
  return snap.exists() && snap.data().globalRole === 'superadmin'
}

// Lee /userCandidateIndex/{uid} (mantenido por las Cloud Functions cada
// vez que se crea un candidato o se agrega/cambia un usuario). No se usa
// una query collectionGroup sobre "users" filtrada por uid porque
// Firestore no puede validarla como segura para list() — confirmado
// probando en vivo contra producción (ver firestore.rules).
export async function getCandidateMembershipsForUser(uid) {
  const snap = await getDoc(doc(db, 'userCandidateIndex', uid))
  if (!snap.exists()) return []
  const data = snap.data()
  return Object.entries(data)
    .map(([candidateId, info]) => ({ candidateId, uid, role: info?.role }))
}

export async function getCandidateById(candidateId) {
  const snap = await getDoc(doc(db, 'candidates', candidateId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function listAllCandidates() {
  // Solo accesible para superadmin (ver firestore.rules).
  const snap = await getDocs(collection(db, 'candidates'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export function getStoredActiveCandidateId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function setStoredActiveCandidateId(candidateId) {
  try {
    if (candidateId) localStorage.setItem(STORAGE_KEY, candidateId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage no disponible (modo privado, etc.) — la sesión igual
    // funciona, solo no persiste la selección entre recargas.
  }
}

// Punto de entrada único que usa main.js al iniciar sesión: resuelve si el
// usuario es superadmin, a qué candidatos pertenece, y cuál queda activo.
// Nunca debe tirar la app: si algo falla acá (reglas, red, lo que sea),
// se trata como "no pertenece a la plataforma nueva" y main.js cae al
// flujo legacy de Samy Fidabel en vez de romper el login para todos.
export async function resolveCandidateAccess(uid) {
  let superadmin = false
  let memberships = []
  try {
    superadmin = await isPlatformSuperAdmin(uid)
  } catch (err) {
    console.error('resolveCandidateAccess: fallo chequeando superadmin, sigo como no-superadmin', err)
  }
  try {
    memberships = await getCandidateMembershipsForUser(uid)
  } catch (err) {
    console.error('resolveCandidateAccess: fallo buscando membresías de candidato, sigo sin ninguna', err)
  }

  let candidates = memberships.map(m => ({ candidateId: m.candidateId, role: m.role }))

  if (superadmin) {
    const all = await listAllCandidates()
    candidates = all.map(c => ({
      candidateId: c.id,
      role: memberships.find(m => m.candidateId === c.id)?.role || 'campaign_admin',
      name: c.name,
      status: c.status
    }))
  }

  const stored = getStoredActiveCandidateId()
  const storedIsValid = stored && (superadmin || candidates.some(c => c.candidateId === stored))
  const activeCandidateId = storedIsValid
    ? stored
    : (candidates[0]?.candidateId || null)

  if (activeCandidateId) setStoredActiveCandidateId(activeCandidateId)

  return { superadmin, candidates, activeCandidateId }
}
