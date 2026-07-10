// Capa de acceso a datos multicandidato. Toda función acá recibe
// `candidateId` como primer parámetro y opera exclusivamente bajo
// /candidates/{candidateId}/... — nunca sobre las colecciones legacy de
// nivel raíz (esas siguen en src/lib/firebase.js hasta que se retire el
// esquema de un solo candidato, ver Fase 6).
//
// Regla dura de esta capa (auditoría IV / mandato de Fase 4): ninguna
// función acá hace getDocs(collection(...)) sin where()/limit(). Las
// vistas grandes (padrón, registros) se paginan con cursores.

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  writeBatch,
  onSnapshot
} from 'firebase/firestore'
import { db } from './firebase.js'

const DEFAULT_PAGE_SIZE = 50
const IN_CHUNK_SIZE = 30 // límite de Firestore para el operador "in"

function candidatePath(candidateId, ...rest) {
  return ['candidates', candidateId, ...rest]
}

// ── Candidato (metadata) ──────────────────────────────────────────────

export async function getCandidate(candidateId) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateCandidateBranding(candidateId, { name, logoUrl, primaryColor, electionName, electionDate, lista, opcion }) {
  await updateDoc(doc(db, ...candidatePath(candidateId)), {
    ...(name !== undefined && { name }),
    ...(logoUrl !== undefined && { logoUrl }),
    ...(primaryColor !== undefined && { primaryColor }),
    ...(electionName !== undefined && { electionName }),
    ...(electionDate !== undefined && { electionDate }),
    ...(lista !== undefined && { lista }),
    ...(opcion !== undefined && { opcion }),
    updatedAt: serverTimestamp()
  })
}

// ── Usuarios del candidato ──────────────────────────────────────────────

export async function getCandidateUser(candidateId, uid) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId, 'users', uid)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Página de usuarios del candidato, opcionalmente filtrada por rol.
// cursor = último doc de la página anterior (snapshot), o null en la 1ra página.
export async function listCandidateUsersPage(candidateId, { role = null, cursor = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const base = collection(db, ...candidatePath(candidateId, 'users'))
  const clauses = role ? [where('role', '==', role)] : []
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))

  const snap = await getDocs(query(base, ...clauses))
  return {
    users: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

// ── Votantes (padrón — COMPARTIDO entre todos los candidatos) ──────────
// El padrón vive en /voters (colección de nivel raíz, la de siempre) —
// NO en /candidates/{candidateId}/voters. Es el mismo registro electoral
// para cualquier candidato, así que estas funciones no reciben
// candidateId. Ver firestore.rules: lectura abierta a cualquier usuario
// autenticado, escritura solo admin legacy/superadmin.

export async function searchVoterByCedula(cedula) {
  const q = query(
    collection(db, 'voters'),
    where('cedula', '==', String(cedula).trim()),
    limit(1)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Mínimo 3 caracteres — evita disparar consultas por cada tecla sobre
// nombres de 1-2 letras que devolverían de a cientos.
export async function searchVotersByName(termino) {
  const upper = String(termino).trim().toUpperCase()
  if (upper.length < 3) return []
  const q = query(
    collection(db, 'voters'),
    where('nombre_upper', '>=', upper),
    where('nombre_upper', '<=', upper + ''),
    limit(50)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Reemplaza al viejo patrón de "traer todo voters y filtrar en el cliente"
// (auditoría IV.1) — esta es la única forma correcta de traer los
// votantes de una mesa.
export async function getVotersByMesa(seccional, mesa) {
  const q = query(
    collection(db, 'voters'),
    where('seccional', '==', seccional),
    where('mesa', '==', String(mesa)),
    limit(1000) // tope de seguridad; una mesa real ronda 300-400 votantes
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Chequea existencia de cédulas en tandas de 30 (límite del operador "in")
// en vez de descargar el padrón completo para armar un Set (auditoría IV,
// getExistingCedulas). Devuelve el subconjunto de cédulas que YA existen.
async function findExistingCedulasShared(cedulas) {
  const found = new Set()
  const list = [...cedulas]
  for (let i = 0; i < list.length; i += IN_CHUNK_SIZE) {
    const chunk = list.slice(i, i + IN_CHUNK_SIZE)
    if (chunk.length === 0) continue
    const q = query(collection(db, 'voters'), where('cedula', 'in', chunk))
    const snap = await getDocs(q)
    snap.docs.forEach(d => found.add(d.data().cedula))
  }
  return found
}

// Solo superadmin (ver firestore.rules) — carga/actualiza el padrón
// COMPARTIDO. Ningún campaign_admin de ningún candidato tiene su propio
// botón de "importar padrón": todos ven y buscan sobre este mismo origen.
export async function importSharedVotersBatch(rows, onProgress) {
  const BATCH_SIZE = 400
  const stats = { added: 0, duplicates: 0, errors: 0, total: rows.length, duplicateList: [] }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const cedulasChunk = chunk.map(row => String(row['Cédula'] || '').replace('.0', '').trim())
    const existing = await findExistingCedulasShared(cedulasChunk)

    const batch = writeBatch(db)
    chunk.forEach((row, idx) => {
      const cedula = cedulasChunk[idx]
      if (existing.has(cedula)) {
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
        orden: String(row['Orden'] || '').replace('.0', '').trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      stats.added++
    })

    try {
      await batch.commit()
    } catch (err) {
      stats.errors++
    }
    if (onProgress) onProgress(stats.added, stats.duplicates, stats.total)
  }
  return stats
}

// ── Registros guardados (savedRecords) ──────────────────────────────────

// candidateId siempre viene de la sesión resuelta en el login (ver
// candidateContext.resolveCandidateAccess → main.js → campaign.js), nunca
// de un campo editable por el usuario — y aunque alguien lo manipulara
// desde la consola, firestore.rules exige que el uid que llama tenga una
// membresía real en ESE candidateId (hasCandidateRole), así que jamás
// puede escribir en el árbol de otro candidato aunque lo intente.
export async function saveRecord(candidateId, uid, voter, {
  telefono = '',
  nota = '',
  direccion = '',
  latitude = null,
  longitude = null,
  googleMapsUrl = '',
  requiresPickup = false,
  needsAssistance = false,
  canBeDriver = false,
  wantsToBeMesario = false,
  allowDuplicate = false,
  militanteName = ''
} = {}) {
  if (!allowDuplicate) {
    const q = query(
      collection(db, ...candidatePath(candidateId, 'savedRecords')),
      where('uid', '==', uid),
      where('cedula', '==', voter.cedula)
    )
    const snap = await getDocs(q)
    if (snap.docs.length > 0) {
      throw new Error(`⚠️ Este votante (CI ${voter.cedula}) ya fue guardado por ti. No se puede duplicar.`)
    }
  }

  await addDoc(collection(db, ...candidatePath(candidateId, 'savedRecords')), {
    voterId: voter.id || null,
    uid,
    createdBy: uid,
    cedula: voter.cedula,
    nombre: voter.nombre,
    // dirección manual del militante si la cargó; si no, la del padrón.
    direccion: direccion || voter.direccion || '',
    seccional: voter.seccional || '',
    local: voter.local || '',
    mesa: voter.mesa || '',
    orden: voter.orden || '',
    telefono,
    nota,
    latitude,
    longitude,
    googleMapsUrl,
    requiresPickup,
    needsAssistance,
    canBeDriver,
    wantsToBeMesario,
    militanteName,
    savedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

export async function getUserRecords(candidateId, uid) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('uid', '==', uid),
    orderBy('savedAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Página de registros para el panel de campaña (reemplaza a getAllRecords
// sin límite — auditoría IV).
export async function listRecordsPage(candidateId, { cursor = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const clauses = [orderBy('savedAt', 'desc')]
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'savedRecords')), ...clauses))
  return {
    records: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

export async function getRecordsByMesa(candidateId, seccional, mesa) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('seccional', '==', seccional),
    where('mesa', '==', String(mesa))
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getRecordsBySeccional(candidateId, seccional) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('seccional', '==', seccional)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Todos los registros del candidato — se usa en los dashboards de Día D
// (ranking/local/mesa), que necesitan agregar sobre el total. No tiene
// límite explícito porque estos paneles ya son de uso ocasional/admin,
// no una vista que se repita en cada tecla; igual queda acotado por
// candidato (nunca "todos los registros de todos los candidatos").
export async function getAllRecords(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'savedRecords')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getAllCandidateUsers(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'users')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function updateCandidateUserMesaLocal(candidateId, uid, data) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'users', uid)), {
    seccional: data.seccional || null,
    mesa: data.mesa || null,
    local: data.local || null,
    mesasAsignadas: data.mesasAsignadas || null
  })
}

// Igual que el legacy deleteUserAccount: borra el perfil, no la cuenta de
// Firebase Auth en sí (esa parte requiere Admin SDK y ya era así antes).
export async function deleteCandidateUser(candidateId, uid) {
  await deleteDoc(doc(db, ...candidatePath(candidateId, 'users', uid)))
}

// Suscripción en vivo a TODOS los savedRecords del candidato, con
// docChanges() para que quien escucha pueda aplicar solo el delta en vez
// de reconstruir todo (usado por el panel de Control de Día D).
export function listenAllRecords(candidateId, onChange) {
  return onSnapshot(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    snap => onChange(snap.docChanges().map(c => ({
      type: c.type,
      id: c.doc.id,
      data: { id: c.doc.id, ...c.doc.data() }
    }))),
    err => console.error('Error escuchando registros:', err)
  )
}

export async function updateRecord(candidateId, id, updates) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'savedRecords', id)), {
    ...updates,
    updatedAt: serverTimestamp()
  })
}

export async function deleteRecord(candidateId, id) {
  await deleteDoc(doc(db, ...candidatePath(candidateId, 'savedRecords', id)))
}

// ── Día D ────────────────────────────────────────────────────────────

const DIA_D_DOC = 'current'

export function onElectionDayChange(candidateId, callback) {
  return onSnapshot(
    doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC)),
    snap => callback(snap.exists() ? !!snap.data().enabled : false),
    err => console.error('Error escuchando Día D:', err)
  )
}

export async function setElectionDayEnabled(candidateId, enabled, uid) {
  await setDoc(doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC)), {
    enabled,
    lastUpdated: serverTimestamp(),
    toggledBy: uid
  }, { merge: true })
}

// docId determinístico (seccional_mesa_cedula) para que marcar el mismo
// voto dos veces sea idempotente (merge) en vez de crear duplicados.
export async function marcarVoto(candidateId, { voterId, cedula, seccional, mesa, local, markedBy }) {
  const configSnap = await getDoc(doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC)))
  if (!configSnap.exists() || !configSnap.data().enabled) {
    throw new Error('Día D no está habilitado')
  }
  const docId = `${seccional}_${mesa}_${cedula}`
  await setDoc(doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC, 'votes', docId)), {
    voterId: voterId || null,
    cedula,
    seccional,
    mesa: String(mesa),
    local: local || '',
    voted: true,
    markedBy,
    markedAt: serverTimestamp()
  }, { merge: true })
}

// Trae los votos YA marcados de una mesa (bounded — nunca toda la colección).
export async function getVotosDeMesa(candidateId, seccional, mesa) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC, 'votes')),
    where('seccional', '==', seccional),
    where('mesa', '==', String(mesa))
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Suscripción EN VIVO acotada a una sola mesa, usando docChanges() para
// aplicar solo el delta en vez de re-leer/re-renderizar todo (auditoría
// IV.2 — el viejo onSnapshot escuchaba la colección completa de votos).
export function listenVotosDeMesa(candidateId, seccional, mesa, onChange) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC, 'votes')),
    where('seccional', '==', seccional),
    where('mesa', '==', String(mesa))
  )
  return onSnapshot(q, snap => {
    onChange(snap.docChanges().map(c => ({
      type: c.type, // 'added' | 'modified' | 'removed'
      id: c.doc.id,
      data: { id: c.doc.id, ...c.doc.data() }
    })))
  }, err => console.error('Error escuchando votos de mesa:', err))
}

// ── Choferes (drivers) ──────────────────────────────────────────────────

// data se pasa casi tal cual (spread) para no perder los campos "ricos"
// que usa el panel de choferes (celular, vehiculo, tipoVehiculo, seccional,
// usuarioAsignado, roles) además de los mínimos del modelo original.
export async function createDriver(candidateId, data) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'drivers')), {
    nombre: '',
    telefono: '',
    local: '',
    status: 'activo',
    votantesAsignados: 0,
    votantes: [],
    ...data,
    createdAt: serverTimestamp()
  })
}

export async function getDrivers(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'drivers')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
}

// Suscripción en vivo a TODOS los choferes del candidato (dashboard de
// Día D los necesita completos para cruzarlos con registros faltantes).
export function listenDrivers(candidateId, onChange) {
  return onSnapshot(
    collection(db, ...candidatePath(candidateId, 'drivers')),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Error escuchando choferes:', err)
  )
}

// Suscripción en vivo a TODOS los votos de Día D del candidato (para el
// ranking global) — a diferencia de listenVotosDeMesa, no está acotada a
// una mesa porque el ranking necesita el agregado completo.
export function listenAllVotes(candidateId, onChange) {
  return onSnapshot(
    collection(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC, 'votes')),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Error escuchando votos:', err)
  )
}

export async function updateDriver(candidateId, id, data) {
  return updateDoc(doc(db, ...candidatePath(candidateId, 'drivers', id)), {
    ...data,
    updatedAt: serverTimestamp()
  })
}

export async function deleteDriver(candidateId, id) {
  return deleteDoc(doc(db, ...candidatePath(candidateId, 'drivers', id)))
}

export async function assignVotantesToDriver(candidateId, driverId, votantes) {
  return updateDoc(doc(db, ...candidatePath(candidateId, 'drivers', driverId)), {
    votantes: votantes || [],
    votantesAsignados: votantes?.length || 0,
    updatedAt: serverTimestamp()
  })
}

// ── Estadísticas agregadas para el panel superadmin ─────────────────────
// count() evita descargar documentos completos solo para contar filas.

// El padrón NO entra acá — es compartido entre todos los candidatos, no
// tiene sentido "contarlo por candidato" (ver getSharedVotersCount).
export async function getCandidateCounts(candidateId) {
  const { getCountFromServer } = await import('firebase/firestore')
  const [users, records, drivers] = await Promise.all([
    getCountFromServer(collection(db, ...candidatePath(candidateId, 'users'))),
    getCountFromServer(collection(db, ...candidatePath(candidateId, 'savedRecords'))),
    getCountFromServer(collection(db, ...candidatePath(candidateId, 'drivers')))
  ])
  return {
    users: users.data().count,
    records: records.data().count,
    drivers: drivers.data().count
  }
}

// Tamaño del padrón compartido — un solo número para toda la plataforma,
// no uno por candidato.
export async function getSharedVotersCount() {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(collection(db, 'voters'))
  return snap.data().count
}

// ── Auditoría ────────────────────────────────────────────────────────

export async function listAuditLogsPage(candidateId, { cursor = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const clauses = [orderBy('createdAt', 'desc')]
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'auditLogs')), ...clauses))
  return {
    logs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

// ── Centro de Contacto Electoral ─────────────────────────────────────────
// Motor de campaña telefónica sobre los votantes YA guardados por este
// candidato (savedRecords) — voterId acá siempre es el id de un doc de
// savedRecords, nunca del padrón compartido /voters, porque ahí es donde
// ya viven teléfono/dirección/flags por candidato. callAssignments y
// electionStatus se guardan con voterId como id de documento propio: es
// idempotente (asignar/reasignar = sobrescribir el mismo doc, nunca
// duplica) y evita una query extra solo para saber si ya existía.

export async function assignVoterToOperator(candidateId, voterId, operatorUid, assignedByUid) {
  await setDoc(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
    candidateId,
    voterId,
    assignedUserId: operatorUid,
    assignedBy: assignedByUid,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function assignVotersToOperatorBulk(candidateId, voterIds, operatorUid, assignedByUid) {
  const BATCH_SIZE = 400
  for (let i = 0; i < voterIds.length; i += BATCH_SIZE) {
    const chunk = voterIds.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    chunk.forEach(voterId => {
      batch.set(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
        candidateId,
        voterId,
        assignedUserId: operatorUid,
        assignedBy: assignedByUid,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true })
    })
    await batch.commit()
  }
}

// Reasignar es la misma escritura que asignar (sobrescribe assignedUserId
// del mismo doc), pero se expone aparte para que la UI distinga la acción.
export async function reassignVoter(candidateId, voterId, newOperatorUid, reassignedByUid) {
  await setDoc(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
    assignedUserId: newOperatorUid,
    assignedBy: reassignedByUid,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function updateCallAssignmentStatus(candidateId, voterId, status) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
    status,
    updatedAt: serverTimestamp()
  })
}

export async function getAllCallAssignments(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'callAssignments')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMyCallAssignments(candidateId, uid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'callAssignments')), where('assignedUserId', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Trae savedRecords puntuales por id (get() por cada uno, no una query
// masiva) — así el operador solo baja los votantes que tiene asignados,
// nunca el pool completo del candidato (requisito de rendimiento).
export async function getRecordsByIds(candidateId, ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  const docs = await Promise.all(
    unique.map(id => getDoc(doc(db, ...candidatePath(candidateId, 'savedRecords', id))))
  )
  return docs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }))
}

// ── Estado electoral (electionStatus) ────────────────────────────────────

const ELECTION_STATUS_DEFAULTS = {
  contacted: false,
  confirmedToVote: false,
  noAnswer: false,
  wrongNumber: false,
  moved: false,
  deceased: false,
  willNotVote: false,
  undecided: false,
  requiresPickup: false,
  needsAssistance: false,
  hasTransport: false,
  driverAssigned: false,
  arrivedAtPollingPlace: false,
  voted: false,
  couldNotVote: false,
  lastStatus: null
}

export async function getElectionStatus(candidateId, voterId) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId, 'electionStatus', voterId)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function getAllElectionStatuses(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'electionStatus')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMyElectionStatuses(candidateId, uid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'electionStatus')), where('assignedUserId', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Upsert parcial: lee primero para no pisar defaults sobre flags que ya
// habían quedado marcadas en una llamada anterior (un merge ciego con los
// defaults completos resetearía todo lo no incluido en `updates` a false).
export async function upsertElectionStatus(candidateId, voterId, assignedUserId, updates, actorUid) {
  const ref = doc(db, ...candidatePath(candidateId, 'electionStatus', voterId))
  const existing = await getDoc(ref)
  const base = existing.exists()
    ? {}
    : { candidateId, voterId, assignedUserId: assignedUserId || null, ...ELECTION_STATUS_DEFAULTS, createdAt: serverTimestamp() }
  await setDoc(ref, {
    ...base,
    ...updates,
    lastUpdatedBy: actorUid,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

// ── Historial de llamadas (calls) ────────────────────────────────────────

export async function registerCall(candidateId, voterId, assignedUserId, operatorUid, { result, observation = '', nextAction = '', followUpAt = null }) {
  await addDoc(collection(db, ...candidatePath(candidateId, 'calls')), {
    candidateId,
    voterId,
    assignedUserId,
    operatorUserId: operatorUid,
    result,
    observation,
    nextAction,
    followUpAt,
    createdAt: serverTimestamp()
  })
  if (followUpAt) {
    await createFollowUp(candidateId, voterId, assignedUserId, operatorUid, followUpAt, nextAction)
  }
}

// Para la tarjeta "Llamados hoy" del dashboard — acotado por fecha (y por
// operador si se pasa uid) en vez de traer todo el historial de calls.
// Filtra por assignedUserId (no operatorUserId) a propósito: es el campo
// que firestore.rules exige para que un operador pueda listar — un query
// list() solo es "demostrable" como seguro si el equality filter coincide
// exactamente con el campo que usa la regla (probado en vivo: filtrar acá
// por operatorUserId, que la regla no conoce, tira permission-denied).
export async function getCallsSince(candidateId, sinceDate, operatorUid = null) {
  const clauses = operatorUid ? [where('assignedUserId', '==', operatorUid)] : []
  clauses.push(where('createdAt', '>=', sinceDate))
  clauses.push(orderBy('createdAt', 'desc'))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'calls')), ...clauses))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Uso admin/coordinator: su rol es puramente auth-based en la regla de
// calls (no depende de resource.data), así que Firestore puede probar
// CUALQUIER query sobre esta colección para ellos, sin necesitar filtrar
// por assignedUserId.
export async function getCallHistory(candidateId, voterId) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'calls')),
    where('voterId', '==', voterId),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Uso operador: acá SÍ hace falta el equality filter por assignedUserId
// (mismo motivo que getCallsSince) para que la regla de calls pueda
// demostrar el list() como seguro.
export async function getMyCallHistory(candidateId, voterId, operatorUid) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'calls')),
    where('voterId', '==', voterId),
    where('assignedUserId', '==', operatorUid),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Agenda de seguimiento (followUps) ────────────────────────────────────

export async function createFollowUp(candidateId, voterId, assignedUserId, createdByUid, dueAt, note = '') {
  return addDoc(collection(db, ...candidatePath(candidateId, 'followUps')), {
    candidateId,
    voterId,
    assignedUserId,
    createdBy: createdByUid,
    dueAt,
    status: 'pending',
    note,
    createdAt: serverTimestamp(),
    completedAt: null
  })
}

export async function getPendingFollowUps(candidateId) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'followUps')),
    where('status', '==', 'pending'),
    orderBy('dueAt', 'asc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMyPendingFollowUps(candidateId, uid) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'followUps')),
    where('assignedUserId', '==', uid),
    where('status', '==', 'pending'),
    orderBy('dueAt', 'asc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function completeFollowUp(candidateId, followUpId) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'followUps', followUpId)), {
    status: 'completed',
    completedAt: serverTimestamp()
  })
}

// ── Incidencias (incidents) ──────────────────────────────────────────────

export async function createIncident(candidateId, voterId, assignedUserId, reportedByUid, { type, description = '' }) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'incidents')), {
    candidateId,
    voterId,
    assignedUserId,
    reportedBy: reportedByUid,
    type,
    description,
    status: 'open',
    createdAt: serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null
  })
}

export async function getAllIncidents(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'incidents')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMyIncidents(candidateId, uid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'incidents')), where('assignedUserId', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function updateIncidentStatus(candidateId, incidentId, status, resolvedByUid) {
  const isClosing = status === 'resolved' || status === 'cancelled'
  await updateDoc(doc(db, ...candidatePath(candidateId, 'incidents', incidentId)), {
    status,
    ...(isClosing ? { resolvedAt: serverTimestamp(), resolvedBy: resolvedByUid } : {})
  })
}

// ── Día D Control — operación electoral en vivo ──────────────────────────
// Distinto del Centro de Contacto (que es llamadas PREVIAS a la elección):
// esto es el tablero operativo del día mismo. voterId = id de un doc de
// savedRecords, mismo criterio que el resto del módulo de contacto.
//
// IMPORTANTE — compatibilidad con Día D Admin (dia-d-admin-candidate.js):
// ese panel calcula "votó" leyendo diaD/current/votes (marcarVoto) y
// "faltantes por chofer" leyendo savedRecords.chofer_asignado. Antes de
// este módulo, Día D Control pisaba solo savedRecords.estado_dia_d sin
// tocar ninguna de esas dos fuentes — un voto marcado en Control no se
// veía en Admin (hallazgo de la auditoría). Las funciones de abajo
// escriben en las 3 fuentes a la vez para que ambos paneles coincidan.

const DIA_D_CONTROL_STATUSES = [
  'committed', 'pending', 'contacted', 'on_the_way', 'pickup_required',
  'driver_assigned', 'picked_up', 'arrived_polling_place', 'arrived_table',
  'voted', 'no_answer', 'not_found', 'will_not_vote', 'incident', 'resolved'
]

const ELECTION_DAY_CONTROL_DEFAULTS = {
  assignedDriverId: null,
  assignedLeaderId: null,
  assignedTableUserId: null,
  pollingPlace: '',
  tableNumber: '',
  status: 'pending',
  requiresPickup: false,
  needsAssistance: false,
  incidentOpen: false,
  critical: false
}

function candidateControlPath(candidateId, voterId) {
  return candidatePath(candidateId, 'electionDayControl', voterId)
}

export async function getElectionDayControl(candidateId, voterId) {
  const snap = await getDoc(doc(db, ...candidateControlPath(candidateId, voterId)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function getAllElectionDayControl(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'electionDayControl')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getElectionDayControlByLeader(candidateId, leaderUid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'electionDayControl')), where('assignedLeaderId', '==', leaderUid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getElectionDayControlByTableUser(candidateId, tableUserUid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'electionDayControl')), where('assignedTableUserId', '==', tableUserUid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getElectionDayControlByDriver(candidateId, driverId) {
  const q = query(collection(db, ...candidatePath(candidateId, 'electionDayControl')), where('assignedDriverId', '==', driverId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// El vínculo chofer <-> usuario ya existe (drivers.usuarioAsignado, lo
// pone el panel de Choferes) — esto solo lo resuelve para el lado chofer.
export async function getDriverByUsuario(candidateId, uid) {
  const q = query(collection(db, ...candidatePath(candidateId, 'drivers')), where('usuarioAsignado', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.length > 0 ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null
}

export async function logDiaDMovement(candidateId, voterId, previousStatus, newStatus, updatedByUid, role, note = '', location = null) {
  await addDoc(collection(db, ...candidatePath(candidateId, 'electionDayMovements')), {
    candidateId, voterId, previousStatus, newStatus, updatedBy: updatedByUid, role, note, location,
    createdAt: serverTimestamp()
  })
}

export async function getDiaDMovements(candidateId, voterId) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'electionDayMovements')),
    where('voterId', '==', voterId),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMyDiaDMovements(candidateId, voterId, uid) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'electionDayMovements')),
    where('voterId', '==', voterId),
    where('updatedBy', '==', uid),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Setter genérico de estado operativo — usado por TODOS los botones de
// acción rápida de los 4 roles. Lee el doc actual (para el defaults-on-
// create y para loguear previousStatus), actualiza electionDayControl y
// deja rastro en electionDayMovements. Si el nuevo estado es 'voted',
// intenta además sincronizar diaD/votes (marcarVoto) para que Día D Admin
// (que calcula "votó" desde ahí) quede consistente — PERO ese intento es
// best-effort: marcarVoto exige isMesarioOfMesa (REGLA OBLIGATORIA 5, la
// asignación vieja por seccional+mesa en el perfil del usuario), que es un
// mecanismo distinto de assignedTableUserId acá. Si el mesario no tiene su
// mesa configurada por el camino viejo, el estado operativo nuevo igual
// queda guardado — no se rompe la acción principal por eso.
//
// NOTA: ya no escribe savedRecords.estado_dia_d — nada en el modelo
// candidato-scoped lo lee (solo el panel legacy de un solo candidato lo
// usa, sobre una colección top-level completamente distinta), así que
// mantenerlo solo agregaba un permission-denied innecesario para
// chofer/mesario/dirigente-reasignado, que no pueden escribir savedRecords.
export async function setDiaDStatus(candidateId, record, newStatus, actorUid, actorRole, extraUpdates = {}) {
  const voterId = record.id
  const ref = doc(db, ...candidateControlPath(candidateId, voterId))
  const existing = await getDoc(ref)
  const previousStatus = existing.exists() ? existing.data().status : null
  const base = existing.exists()
    ? {}
    : {
        candidateId, voterId,
        assignedLeaderId: record.uid || null,
        ...ELECTION_DAY_CONTROL_DEFAULTS,
        pollingPlace: record.local || '',
        tableNumber: record.mesa || '',
        createdAt: serverTimestamp()
      }

  await setDoc(ref, {
    ...base,
    ...extraUpdates,
    status: newStatus,
    lastMovementAt: serverTimestamp(),
    lastUpdatedBy: actorUid,
    lastUpdatedRole: actorRole,
    updatedAt: serverTimestamp()
  }, { merge: true })

  await logDiaDMovement(candidateId, voterId, previousStatus, newStatus, actorUid, actorRole)

  if (newStatus === 'voted' && record.seccional && record.mesa) {
    try {
      await marcarVoto(candidateId, {
        voterId: record.voterId || null,
        cedula: record.cedula,
        seccional: record.seccional,
        mesa: record.mesa,
        local: record.local,
        markedBy: actorUid
      })
    } catch (err) {
      console.warn('No se pudo sincronizar el voto con Día D Admin (diaD/votes):', err.message)
    }
  }
}

// Actualiza solo flags (requiresPickup/needsAssistance/incidentOpen/
// critical) sin tocar `status` — para acciones tipo "Necesita transporte"
// que no representan un cambio de fase, solo una marca adicional.
export async function setDiaDFlags(candidateId, record, flags, actorUid, actorRole) {
  const voterId = record.id
  const ref = doc(db, ...candidateControlPath(candidateId, voterId))
  const existing = await getDoc(ref)
  const base = existing.exists()
    ? {}
    : {
        candidateId, voterId,
        assignedLeaderId: record.uid || null,
        ...ELECTION_DAY_CONTROL_DEFAULTS,
        pollingPlace: record.local || '',
        tableNumber: record.mesa || '',
        createdAt: serverTimestamp()
      }
  await setDoc(ref, {
    ...base,
    ...flags,
    lastUpdatedBy: actorUid,
    lastUpdatedRole: actorRole,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

// Reasignación — exclusiva de campaign_admin/coordinator (ver firestore.
// rules). Mirror a savedRecords.chofer_asignado para que Día D Admin siga
// mostrando "faltantes por chofer" correctamente sin tener que migrarlo.
export async function assignDriverToVoter(candidateId, record, driverId, actorUid) {
  const ref = doc(db, ...candidateControlPath(candidateId, record.id))
  const existing = await getDoc(ref)
  const base = existing.exists()
    ? {}
    : { candidateId, voterId: record.id, assignedLeaderId: record.uid || null, ...ELECTION_DAY_CONTROL_DEFAULTS, pollingPlace: record.local || '', tableNumber: record.mesa || '', createdAt: serverTimestamp() }
  await setDoc(ref, {
    ...base,
    assignedDriverId: driverId,
    status: existing.exists() && existing.data().status !== 'pending' ? existing.data().status : 'driver_assigned',
    lastUpdatedBy: actorUid,
    lastUpdatedRole: 'campaign_admin',
    updatedAt: serverTimestamp()
  }, { merge: true })
  await updateRecord(candidateId, record.id, { chofer_asignado: driverId })
  await logDiaDMovement(candidateId, record.id, existing.exists() ? existing.data().status : null, 'driver_assigned', actorUid, 'campaign_admin', `Chofer asignado: ${driverId}`)
}

export async function assignLeaderToVoter(candidateId, voterId, leaderUid, actorUid) {
  await setDoc(doc(db, ...candidateControlPath(candidateId, voterId)), {
    assignedLeaderId: leaderUid,
    lastUpdatedBy: actorUid,
    lastUpdatedRole: 'campaign_admin',
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function assignTableUserToVoter(candidateId, voterId, tableUserUid, pollingPlace, tableNumber, actorUid) {
  await setDoc(doc(db, ...candidateControlPath(candidateId, voterId)), {
    assignedTableUserId: tableUserUid,
    pollingPlace: pollingPlace || '',
    tableNumber: tableNumber || '',
    lastUpdatedBy: actorUid,
    lastUpdatedRole: 'campaign_admin',
    updatedAt: serverTimestamp()
  }, { merge: true })
}

// Puente con lo que ya funcionaba ANTES de este módulo: crea el doc de
// electionDayControl para votantes que ya tenían chofer_asignado o
// estado_dia_d en savedRecords (asignados desde Choferes o Día D Admin,
// mecanismos viejos que se conservan intactos) pero todavía no tienen
// control doc — así un chofer/mesario nuevo en este panel ya ve de
// entrada lo que se venía trabajando, sin perder nada.
export async function sincronizarElectionDayControlDesdeRegistros(candidateId, records, actorUid) {
  const existentes = await getAllElectionDayControl(candidateId)
  const existentesSet = new Set(existentes.map(c => c.voterId))
  const ESTADO_MAP = { voto: 'voted', en_camino: 'on_the_way' }
  const BATCH_SIZE = 400
  const aCrear = records.filter(r => !existentesSet.has(r.id) && (r.chofer_asignado || r.estado_dia_d))
  for (let i = 0; i < aCrear.length; i += BATCH_SIZE) {
    const chunk = aCrear.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    chunk.forEach(r => {
      batch.set(doc(db, ...candidateControlPath(candidateId, r.id)), {
        candidateId,
        voterId: r.id,
        assignedLeaderId: r.uid || null,
        assignedDriverId: r.chofer_asignado || null,
        assignedTableUserId: null,
        pollingPlace: r.local || '',
        tableNumber: r.mesa || '',
        status: ESTADO_MAP[r.estado_dia_d] || 'pending',
        requiresPickup: !!r.requiresPickup,
        needsAssistance: !!r.needsAssistance,
        incidentOpen: false,
        critical: false,
        lastUpdatedBy: actorUid,
        lastUpdatedRole: 'campaign_admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true })
    })
    await batch.commit()
  }
  return aCrear.length
}

// ── Alertas (electionDayAlerts) ──────────────────────────────────────────

export async function createDiaDAlert(candidateId, { type, severity = 'warning', voterId = null, assignedUserId = null, message }) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'electionDayAlerts')), {
    candidateId, type, severity, voterId, assignedUserId, message,
    status: 'open', createdAt: serverTimestamp(), resolvedAt: null, resolvedBy: null
  })
}

export async function getOpenDiaDAlerts(candidateId) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'electionDayAlerts')),
    where('status', '==', 'open'),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function resolveDiaDAlert(candidateId, alertId, resolvedByUid) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'electionDayAlerts', alertId)), {
    status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: resolvedByUid
  })
}

// ── Informes periódicos (electionDayReports) ─────────────────────────────

export async function createDiaDReport(candidateId, reportData) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'electionDayReports')), {
    candidateId,
    generatedAt: serverTimestamp(),
    totalCommitted: reportData.totalCommitted,
    totalVoted: reportData.totalVoted,
    totalPending: reportData.totalPending,
    totalInTransit: reportData.totalInTransit,
    totalIncidents: reportData.totalIncidents,
    criticalPending: reportData.criticalPending,
    reportData,
    createdAt: serverTimestamp()
  })
}

export async function getRecentDiaDReports(candidateId, pageSize = 10) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'electionDayReports')),
    orderBy('generatedAt', 'desc'),
    limit(pageSize)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Configuración del módulo (reutiliza /config/{configId} ya existente) ─

const DIA_D_CONTROL_SETTINGS_DEFAULTS = {
  intervaloAlertasMinutos: 15,
  horaInicioControl: '06:00',
  horaFinControl: '18:00',
  umbralPendientesPorDirigente: 10,
  umbralIncidenciaMinutos: 30,
  umbralSinMovimientoMinutos: 45
}

export async function getDiaDControlSettings(candidateId) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId, 'config', 'diaDControlSettings')))
  return snap.exists() ? { ...DIA_D_CONTROL_SETTINGS_DEFAULTS, ...snap.data() } : { ...DIA_D_CONTROL_SETTINGS_DEFAULTS }
}

export async function updateDiaDControlSettings(candidateId, settings) {
  await setDoc(doc(db, ...candidatePath(candidateId, 'config', 'diaDControlSettings')), {
    ...settings,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export { DIA_D_CONTROL_STATUSES }
export { collectionGroup }
