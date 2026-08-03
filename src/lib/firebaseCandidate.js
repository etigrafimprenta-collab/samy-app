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
import { httpsCallable } from 'firebase/functions'
import { db, functionsInstance } from './firebase.js'
import { getGrantedScopes } from './rbac.js'

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

export async function updateCandidateBranding(candidateId, { name, logoUrl, primaryColor, electionName, electionDate, lista, opcion, slogan }) {
  await updateDoc(doc(db, ...candidatePath(candidateId)), {
    ...(name !== undefined && { name }),
    ...(logoUrl !== undefined && { logoUrl }),
    ...(primaryColor !== undefined && { primaryColor }),
    ...(electionName !== undefined && { electionName }),
    ...(electionDate !== undefined && { electionDate }),
    ...(lista !== undefined && { lista }),
    ...(opcion !== undefined && { opcion }),
    ...(slogan !== undefined && { slogan }),
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

// El teléfono del padrón compartido NO viene en los docs de arriba (mejora
// de privacidad: vive en una subcolección que solo superadmin puede leer
// directo). Esta función pide, para un lote de cédulas encontradas en la
// búsqueda, cuáles teléfonos le corresponde ver al usuario actual — la
// Cloud Function decide caso por caso (dueño de su propio savedRecords,
// asignado formalmente, o superadmin) para no filtrar el teléfono cargado
// por el dirigente de OTRO candidato sobre la misma cédula. Devuelve un
// mapa { cedula: telefono|null }, nunca lanza si simplemente no hay nada
// que mostrar (null es una respuesta válida, no un error).
export async function getTelefonosPadron(candidateId, cedulas) {
  if (!cedulas || cedulas.length === 0) return {}
  const fn = httpsCallable(functionsInstance, 'buscarTelefonosPadron')
  const result = await fn({ candidateId, cedulas })
  return result.data?.telefonos || {}
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

// Corre `worker(item)` sobre cada elemento de `items`, con hasta
// `concurrency` invocaciones en simultáneo (pool de tamaño fijo, no todas
// a la vez) — una carga de padrón de 100k+ filas hacía sus tandas de 400
// filas una atrás de la otra (y, dentro de cada tanda, sus 14 consultas
// de "¿esta cédula ya existe?" también una atrás de la otra), lo que la
// hacía tardar 20-30+ minutos. Encontrado en vivo con una carga real de
// 100.700 filas.
async function runWithConcurrency(items, concurrency, worker) {
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
}

// Chequea existencia de cédulas en tandas de 30 (límite del operador "in")
// en vez de descargar el padrón completo para armar un Set (auditoría IV,
// getExistingCedulas). Devuelve el subconjunto de cédulas que YA existen.
// Las tandas de 30 se consultan todas en simultáneo (antes: una por una)
// — con 400 cédulas por lote eso es ~14 consultas en paralelo en vez de
// en serie, el mayor cuello de botella de una carga grande.
async function findExistingCedulasShared(cedulas) {
  const found = new Set()
  const list = [...cedulas].filter(Boolean)
  const chunks = []
  for (let i = 0; i < list.length; i += IN_CHUNK_SIZE) chunks.push(list.slice(i, i + IN_CHUNK_SIZE))
  await Promise.all(chunks.map(async (chunk) => {
    const q = query(collection(db, 'voters'), where('cedula', 'in', chunk))
    const snap = await getDocs(q)
    snap.docs.forEach(d => found.add(d.data().cedula))
  }))
  return found
}

// Igual que findExistingCedulasShared pero devuelve cédula -> {id, data},
// para poder actualizar el doc correcto Y decidir campo por campo si el
// valor nuevo debe pisar al viejo (ver updateSharedVotersBatch).
//
// El teléfono ya NO vive en el doc principal (privacidad — ver
// firestore.rules /voters/{id}/private/data), así que se trae aparte de la
// subcolección privada y se inyecta en `data.telefono` para que
// mergeVoterFields siga funcionando sin enterarse del cambio. Solo
// superadmin llega a esta función (ver importSharedVotersBatch/
// updateSharedVotersBatch), así que esa lectura extra está permitida por
// la regla de /private.
async function findExistingVotersShared(cedulas) {
  const found = new Map()
  const list = [...cedulas].filter(Boolean)
  const chunks = []
  for (let i = 0; i < list.length; i += IN_CHUNK_SIZE) chunks.push(list.slice(i, i + IN_CHUNK_SIZE))
  await Promise.all(chunks.map(async (chunk) => {
    const q = query(collection(db, 'voters'), where('cedula', 'in', chunk))
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(async (d) => {
      const privateSnap = await getDoc(doc(db, 'voters', d.id, 'private', 'data'))
      found.set(d.data().cedula, {
        id: d.id,
        data: { ...d.data(), telefono: privateSnap.exists() ? (privateSnap.data().telefono || '') : '' }
      })
    }))
  }))
  return found
}

// Combina el valor nuevo con el viejo campo por campo: si el archivo
// nuevo trae la celda vacía para un campo, se conserva lo que ya había
// en vez de borrarlo — así un padrón nuevo con teléfonos incompletos o
// desactualizados no le pisa a nadie un dato mejor que ya estaba cargado.
function mergeVoterFields(nuevo, viejo) {
  const out = {}
  for (const key of Object.keys(nuevo)) {
    const valorNuevo = nuevo[key]
    out[key] = (valorNuevo === '' || valorNuevo == null) ? (viejo?.[key] ?? valorNuevo) : valorNuevo
  }
  return out
}

// Quita tildes/diacríticos y homogeneiza mayúsculas/espacios de un
// encabezado de columna — bug real encontrado en vivo: una carga de
// 100.700 filas terminó "Listo. Agregados: 0 · Actualizados: 0 ·
// Errores: 0" sin ningún aviso porque el archivo real traía la columna
// de cédula con una mayúscula/tilde distinta a la que el código esperaba
// EXACTO, así que ninguna fila encontraba su cédula y todo se descartaba
// en silencio. Con esto, "Cedula", "cédula", "CÉDULA", "Cédula " (con
// espacio) etc. calzan todas contra el mismo nombre de columna.
function normalizeHeader(h) {
  return String(h ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

// Arma un lookup normalizado {ENCABEZADO_NORMALIZADO: valor} a partir de
// una fila cruda del Excel (sheet_to_json), para no depender de la
// mayúscula/tilde exacta de cada encabezado.
function normalizeRowKeys(row) {
  const out = {}
  for (const key of Object.keys(row)) out[normalizeHeader(key)] = row[key]
  return out
}

// Devuelve el primer valor no vacío entre los alias dados (ya
// normalizados internamente) — reemplaza los `row['A'] ?? row['B']`
// puntuales de antes, ahora insensible a mayúsculas/tildes/espacios.
function pick(normRow, ...aliases) {
  for (const alias of aliases) {
    const v = normRow[normalizeHeader(alias)]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return ''
}

// Alias aceptados por columna — además de los 2 formatos ya documentados
// (Justicia Electoral / formato de ejemplo), se agregan variantes comunes
// de cédula (CI, C.I.) que aparecen en archivos reales que no calzan
// exacto con ninguno de los dos formatos históricos.
const CEDULA_ALIASES = ['CEDULA', 'Cédula', 'CI', 'C.I.', 'Nro Cedula', 'Numero de Cedula']

// Bug real encontrado en vivo (segunda vuelta, después de arreglar el
// matching de mayúsculas/tildes): un padrón de 106.498 filas seguía
// fallando porque la fila 1 del Excel NO son los encabezados reales, es
// una fila de título ("PRE PADRON DPTO CENTRAL 2023.", típico de
// exportaciones oficiales) — sheet_to_json siempre toma la fila 1 como
// encabezados, así que el título quedaba como si fuera el nombre de una
// columna y la fila con CEDULA/NOMBRE/etc. de verdad quedaba como si
// fuera la primera fila de DATOS, no de encabezados.
//
// `rawRows` = filas leídas como array de arrays (XLSX.utils.sheet_to_json
// con { header: 1 }, sin asumir cuál fila es el encabezado). Devuelve el
// índice de la primera fila (dentro de las primeras MAX_SCAN_ROWS) que
// tenga alguna celda reconocible como columna de cédula, o -1 si ninguna
// de las filas escaneadas califica.
const MAX_HEADER_SCAN_ROWS = 15
export function findHeaderRowIndex(rawRows) {
  const limite = Math.min(rawRows.length, MAX_HEADER_SCAN_ROWS)
  for (let i = 0; i < limite; i++) {
    const fila = rawRows[i] || []
    const tieneColumnaCedula = fila.some(celda => CEDULA_ALIASES.some(alias => normalizeHeader(celda) === normalizeHeader(alias)))
    if (tieneColumnaCedula) return i
  }
  return -1
}

export { CEDULA_ALIASES }

// Lee una fila del Excel del padrón — acepta 2 formatos a la vez:
//   1) El formato real que usa la Justicia Electoral / el candidato hoy:
//      CEDULA, TELEFONO, APELLIDO, NOMBRE, Local de Votacion, MESA, ORDEN,
//      SEXO, FEC_NAC, DIA, MES, Edad, DIRECCION, SECCIONAL, PARTIDO2023,
//      G_2021 (versión anterior tenía SEG/SECC en vez de SECCIONAL — se
//      mantiene el fallback por si queda algún archivo viejo dando vueltas).
//   2) El formato de ejemplo original (Cédula, Apellidos y Nombres,
//      Dirección, Mesa, Orden, Seccional, F. Nacimiento, F. Afiliación) —
//      se mantiene por compatibilidad, no se elimina.
// El matching de encabezados es insensible a mayúsculas/tildes/espacios
// (ver normalizeHeader) — el nombre de columna real puede diferir en
// esos detalles sin que la fila se pierda.
// `nombre` siempre queda como "APELLIDO NOMBRE" combinado (igual que
// siempre) para no romper ninguna pantalla que ya lo lee así — los campos
// nuevos (teléfono, sexo, partido2023, etc.) se agregan aparte.
function parseVoterRow(row) {
  const normRow = normalizeRowKeys(row)
  const cedula = String(pick(normRow, ...CEDULA_ALIASES)).replace('.0', '').trim()
  const apellido = String(pick(normRow, 'APELLIDO', 'Apellidos')).trim()
  const nombreSolo = String(pick(normRow, 'NOMBRE', 'Nombres')).trim()
  const nombre = String(pick(normRow, 'Apellidos y Nombres', 'Nombre completo') || `${apellido} ${nombreSolo}`).trim()
  return {
    cedula,
    nombre,
    nombre_upper: nombre.toUpperCase(),
    apellido,
    nombreSolo,
    telefono: String(pick(normRow, 'TELEFONO', 'Celular')).trim(),
    sexo: String(pick(normRow, 'SEXO', 'Genero')).trim(),
    diaNacimiento: String(pick(normRow, 'DIA')).replace('.0', '').trim(),
    mesNacimiento: String(pick(normRow, 'MES')).replace('.0', '').trim(),
    edad: String(pick(normRow, 'Edad')).replace('.0', '').trim(),
    direccion: String(pick(normRow, 'DIRECCION', 'Dirección')).trim(),
    // FEC_NAC trae la fecha de nacimiento completa (día/mes/año) — más
    // completa que DIA+MES solos, que no traen año. Se guarda en el mismo
    // campo que ya usaba el formato de ejemplo (F. Nacimiento).
    nacimiento: String(pick(normRow, 'FEC_NAC', 'F. Nacimiento')).trim(),
    afiliacion: String(pick(normRow, 'F. Afiliación')).trim(),
    seccional: String(pick(normRow, 'SECCIONAL', 'SECC', 'Seccional')).replace('.0', '').trim(),
    local: String(pick(normRow, 'Local de Votacion')).trim(),
    mesa: String(pick(normRow, 'MESA', 'Mesa')).replace('.0', '').trim(),
    orden: String(pick(normRow, 'ORDEN', 'Orden')).replace('.0', '').trim(),
    // partido2023 = afinidad política declarada en 2023, votoAnterior2021 =
    // si votó en 2021 — se guardan tal cual vienen en el Excel, sin normalizar.
    partido2023: String(pick(normRow, 'PARTIDO2023')).trim(),
    votoAnterior2021: String(pick(normRow, 'G_2021')).trim()
  }
}

// Chequeo defensivo antes de escribir nada: si NINGUNA fila trajo una
// cédula reconocible, el archivo casi seguro tiene la columna de cédula
// con un nombre que no está en CEDULA_ALIASES — cortar acá con un error
// claro (mostrando los encabezados reales del archivo) en vez de
// procesar igual y terminar en "Listo. Agregados: 0 · Errores: 0" sin
// explicar por qué. Ver bug real de la nota en parseVoterRow.
function assertCedulaColumnFound(rows, parsed) {
  if (rows.length === 0) return
  const conCedula = parsed.filter(p => p.cedula).length
  if (conCedula === 0) {
    const headers = rows[0] ? Object.keys(rows[0]) : []
    throw new Error(
      `No se encontró la columna de cédula en ninguna de las ${rows.length} filas del archivo. ` +
      `Se esperaba alguna de estas columnas: ${CEDULA_ALIASES.join(', ')}. ` +
      `Columnas encontradas en el archivo: ${headers.join(', ') || '(el archivo no tiene encabezados)'}.`
    )
  }
}

// Solo superadmin (ver firestore.rules) — carga/actualiza el padrón
// COMPARTIDO. Ningún campaign_admin de ningún candidato tiene su propio
// botón de "importar padrón": todos ven y buscan sobre este mismo origen.
export async function importSharedVotersBatch(rows, onProgress) {
  const BATCH_SIZE = 400
  // Cuántas tandas de 400 filas se procesan en simultáneo — cada una hace
  // su propio chequeo de duplicados + writeBatch, independiente de las
  // demás (no comparten estado salvo `stats`, que se actualiza de forma
  // síncrona así que no hay condición de carrera entre tandas).
  const CONCURRENCY = 6
  const stats = { added: 0, duplicates: 0, errors: 0, total: rows.length, duplicateList: [] }

  // Deduplicar por cédula ANTES de repartir en tandas concurrentes: si la
  // misma cédula aparece más de una vez en el archivo (pasa con padrones
  // grandes reales) y las dos filas caen en tandas distintas que corren al
  // mismo tiempo, ambas podrían chequear "¿existe?" a la vez, ver que no
  // todavía, y crear DOS documentos para la misma persona — con las tandas
  // en serie (como era antes) esto no pasaba porque una terminaba de
  // escribir antes de que la siguiente empezara a chequear. Blancos
  // (cédula vacía) no se tocan acá: no son "la misma persona repetida",
  // se dejan pasar tal cual como ya hacía el código antes de este cambio.
  const seen = new Set()
  const parsed = []
  for (const row of rows) {
    const v = parseVoterRow(row)
    if (v.cedula) {
      if (seen.has(v.cedula)) {
        stats.duplicates++
        stats.duplicateList.push(v.cedula)
        continue
      }
      seen.add(v.cedula)
    }
    parsed.push(v)
  }
  assertCedulaColumnFound(rows, parsed)

  const chunks = []
  for (let i = 0; i < parsed.length; i += BATCH_SIZE) chunks.push(parsed.slice(i, i + BATCH_SIZE))

  await runWithConcurrency(chunks, CONCURRENCY, async (chunkParsed) => {
    const cedulasChunk = chunkParsed.map(p => p.cedula)
    const existing = await findExistingCedulasShared(cedulasChunk)

    const batch = writeBatch(db)
    chunkParsed.forEach((v) => {
      if (existing.has(v.cedula)) {
        stats.duplicates++
        stats.duplicateList.push(v.cedula)
        return
      }
      // telefono NUNCA va al doc principal (privacidad — ver
      // firestore.rules /voters/{id}/private/data): ese doc es de lectura
      // abierta a cualquier autenticado, el teléfono va aparte.
      const { telefono, ...vSinTelefono } = v
      const ref = doc(collection(db, 'voters'))
      batch.set(ref, { ...vSinTelefono, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      if (telefono) batch.set(doc(db, 'voters', ref.id, 'private', 'data'), { telefono })
      stats.added++
    })

    try {
      await batch.commit()
    } catch (err) {
      stats.errors++
    }
    if (onProgress) onProgress(stats.added, stats.duplicates, stats.total)
  })
  return stats
}

// Como importSharedVotersBatch, pero en vez de saltar las cédulas ya
// cargadas, ACTUALIZA sus datos (mesa/local/dirección/etc.) con lo que
// traiga el archivo nuevo — para cuando llega un padrón actualizado de
// la Justicia Electoral (redistritaciones, correcciones) y no querés
// perder lo que ya cargaste, solo refrescarlo. Nunca borra un votante
// que no aparezca en el archivo nuevo (a diferencia de un reemplazo
// total) — así ningún registro ya capturado por un candidato queda
// huérfano si el archivo nuevo tiene menos filas por el motivo que sea.
export async function updateSharedVotersBatch(rows, onProgress) {
  const BATCH_SIZE = 400
  const CONCURRENCY = 6 // ver comentario en importSharedVotersBatch
  const stats = { added: 0, updated: 0, errors: 0, total: rows.length }

  // Mismo motivo que en importSharedVotersBatch: si la misma cédula
  // aparece más de una vez en el archivo, se consolida en una sola fila
  // ANTES de repartir en tandas concurrentes — si no, dos tandas corriendo
  // al mismo tiempo podrían terminar pisándose los cambios entre sí sobre
  // la misma persona. Acá, a diferencia del modo "solo agregar", las
  // repeticiones se FUSIONAN (mergeVoterFields) en vez de descartarse: si
  // una fila trae el teléfono y otra la dirección para la misma cédula,
  // no se quiere perder ninguno de los dos datos. Filas sin cédula se
  // descartan acá mismo (antes se descartaban más abajo, mismo resultado).
  const byCedula = new Map()
  for (const row of rows) {
    const v = parseVoterRow(row)
    if (!v.cedula) continue
    const previo = byCedula.get(v.cedula)
    byCedula.set(v.cedula, previo ? mergeVoterFields(v, previo) : v)
  }
  const parsed = [...byCedula.values()]
  assertCedulaColumnFound(rows, parsed)

  const chunks = []
  for (let i = 0; i < parsed.length; i += BATCH_SIZE) chunks.push(parsed.slice(i, i + BATCH_SIZE))

  await runWithConcurrency(chunks, CONCURRENCY, async (chunkParsed) => {
    const cedulasChunk = chunkParsed.map(p => p.cedula)
    const existingVoters = await findExistingVotersShared(cedulasChunk)

    const batch = writeBatch(db)
    chunkParsed.forEach((v) => {
      const match = existingVoters.get(v.cedula)
      if (match) {
        // match.data.telefono ya viene resuelto desde la subcolección
        // privada (ver findExistingVotersShared) — mergeVoterFields decide
        // si el archivo nuevo lo pisa o se conserva el que ya había, sin
        // enterarse de dónde vive cada uno.
        const merged = mergeVoterFields(v, match.data)
        const { telefono: telefonoMerged, ...mergedSinTelefono } = merged
        batch.set(doc(db, 'voters', match.id), { ...mergedSinTelefono, updatedAt: serverTimestamp() }, { merge: true })
        if (telefonoMerged) batch.set(doc(db, 'voters', match.id, 'private', 'data'), { telefono: telefonoMerged }, { merge: true })
        stats.updated++
      } else {
        const { telefono, ...vSinTelefono } = v
        const ref = doc(collection(db, 'voters'))
        batch.set(ref, { ...vSinTelefono, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        if (telefono) batch.set(doc(db, 'voters', ref.id, 'private', 'data'), { telefono })
        stats.added++
      }
    })

    try {
      await batch.commit()
    } catch (err) {
      stats.errors++
    }
    if (onProgress) onProgress(stats.added + stats.updated, 0, stats.total)
  })
  return stats
}

// Nombre del último .xlsx cargado desde Superadmin — se muestra en el
// Resumen de cada candidato para que quede claro de qué archivo sale el
// padrón compartido. Documento único a nivel raíz (mismo criterio que
// /voters: es metadata del padrón, no de un candidato en particular).
export async function setPadronMeta(fileName, uid) {
  await setDoc(doc(db, 'config', 'padronMeta'), {
    fileName,
    uploadedAt: serverTimestamp(),
    uploadedBy: uid
  })
}

export async function getPadronMeta() {
  const snap = await getDoc(doc(db, 'config', 'padronMeta'))
  return snap.exists() ? snap.data() : null
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

  // teamId se denormaliza del perfil de quien guarda (auditoría RBAC —
  // scopes restringidos): es lo que permite que el scope "Equipo" de un
  // rol personalizado filtre savedRecords con un simple where('teamId','
  // ==',...), sin tener que resolver equipos en cada lectura. Registros
  // guardados ANTES de este cambio quedan sin este campo — no se migran
  // retroactivamente porque nunca se supo antes a qué equipo pertenecían;
  // simplemente no matchean ningún filtro por equipo, no rompen nada.
  const creadorDoc = await getDoc(doc(db, ...candidatePath(candidateId, 'users', uid)))
  const teamId = creadorDoc.exists() ? (creadorDoc.data().teamId || null) : null

  await addDoc(collection(db, ...candidatePath(candidateId, 'savedRecords')), {
    voterId: voter.id || null,
    uid,
    createdBy: uid,
    teamId,
    cedula: voter.cedula,
    nombre: voter.nombre,
    // Mayúsculas para prefix-search (mismo criterio que voters.nombre_upper
    // en el padrón) — sin esto, buscar por nombre en Centro de Contacto a
    // escala (50k-100k) obligaría a descargar todo savedRecords.
    nombre_upper: String(voter.nombre || '').toUpperCase(),
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
    // Espejo directo de callAssignments.assignedUserId sobre el propio
    // registro — permite `where('ccAssignedUserId','==',null)` para el
    // pool de "sin asignar" sin tener que descargar callAssignments
    // completo y cruzarlo en el cliente (ver Centro de Contacto).
    ccAssignedUserId: null,
    savedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  // El padrón compartido solo lo puede escribir el superadmin (ver
  // firestore.rules), así que el teléfono recién capturado se refleja de
  // vuelta ahí vía Cloud Function — no bloquea ni rompe el guardado del
  // registro propio si esto falla (ej. la CI no está en el padrón).
  if (telefono) {
    try {
      const fn = httpsCallable(functionsInstance, 'actualizarTelefonoVotante')
      await fn({ candidateId, cedula: voter.cedula, telefono })
    } catch (err) {
      console.warn('No se pudo actualizar el teléfono en el padrón compartido:', err.message)
    }
  }
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

// ── Reportes > Equipo: counts puntuales por usuario, nunca getAllRecords ──
export async function getUserRecordsCount(candidateId, uid) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where('uid', '==', uid))
  )
  return snap.data().count
}

// Genérica: cuenta savedRecords de un usuario que matchean un valor de
// campo puntual (ej. telefono==''). Dos igualdades sin orderBy — Firestore
// no exige índice compuesto para esto (confirmado con
// getUnassignedCountByDirigente, mismo patrón ya en producción).
export async function getRecordFlagCountForUser(candidateId, uid, field, value) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where('uid', '==', uid), where(field, '==', value))
  )
  return snap.data().count
}

export async function getLastRecordActivityForUser(candidateId, uid) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('uid', '==', uid),
    orderBy('savedAt', 'desc'),
    limit(1)
  )
  const snap = await getDocs(q)
  return snap.docs.length > 0 ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null
}

export async function getCallsCountByOperator(candidateId, operatorUid) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'calls')), where('operatorUserId', '==', operatorUid))
  )
  return snap.data().count
}

// ── Reportes > Votantes: flags auto-declarados al registrar (distinto de
// electionStatus, que es lo confirmado por Centro de Contacto en una
// llamada) ──────────────────────────────────────────────────────────────
export async function getRecordFlagCounts(candidateId, flags) {
  const { getCountFromServer } = await import('firebase/firestore')
  const entries = await Promise.all(flags.map(async flag => {
    const snap = await getCountFromServer(
      query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where(flag, '==', true))
    )
    return [flag, snap.data().count]
  }))
  return Object.fromEntries(entries)
}

// Drill-down acotado por flag auto-declarado (requiresPickup/needsAssistance/
// canBeDriver/wantsToBeMesario) — mismo criterio de tope que
// getElectionStatusByFlag (300), nunca colección completa.
export async function getRecordsByFlag(candidateId, flag, maxCount = 300) {
  const q = query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where(flag, '==', true), limit(maxCount))
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

// Página de registros filtrada por UN eje (dirigente/local/seccional/mesa)
// — para Reportes > Registros. Un solo filtro a la vez a propósito: cada
// combinación adicional exigiría su propio índice compuesto, y no hace
// falta en Etapa 1. `by` es el nombre del campo tal cual se guarda en
// savedRecords ('uid' para dirigente, 'local', 'seccional' o 'mesa').
// `value` también acepta un array (usa 'in', hasta 30 — límite de
// Firestore) — lo usa getSavedRecordsByScope para zoneIds/pollingPlaceIds/
// tableIds, que son listas (un usuario puede tener más de una zona/local/
// mesa asignada).
export async function listRecordsPageFiltered(candidateId, { by = null, value = null, cursor = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const clauses = []
  if (by && value != null) {
    if (Array.isArray(value)) {
      const valores = value.slice(0, IN_CHUNK_SIZE).map(v => by === 'mesa' ? String(v) : v)
      clauses.push(where(by, 'in', valores))
    } else {
      clauses.push(where(by, '==', by === 'mesa' ? String(value) : value))
    }
  }
  clauses.push(orderBy('savedAt', 'desc'))
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

// Vista propia del chofer (renderChoferView en dia-d-control-candidate.js):
// todo lo que tenga chofer_asignado == su driver.id, sin depender de que
// exista un doc en electionDayControl para cada uno (ese solo se crea al
// tocar un botón de acción, o con el backfill manual "crear control Día
// D") — así un votante recién asignado desde Choferes aparece acá al
// toque, no recién después de ese paso aparte.
export async function getRecordsByDriver(candidateId, driverId) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('chofer_asignado', '==', driverId)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Búsqueda de un savedRecord por cédula, sin acotar por uid — usada para
// autocompletar el formulario de "Crear usuario" (Usuarios) con los datos
// que ese CI ya tiene cargados en Registros, si existen.
export async function getRecordByCedula(candidateId, cedula) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('cedula', '==', String(cedula).trim()),
    limit(1)
  )
  const snap = await getDocs(q)
  return snap.docs.length > 0 ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null
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

// Cédulas guardadas más de una vez por distintos usuarios de ESTE
// candidato — usada por la pestaña Auditoría (campaign.js) y por Reportes
// > Votantes. Un solo punto de verdad para no repetir el agrupamiento.
export async function getDuplicateCedulas(candidateId) {
  const records = await getAllRecords(candidateId)
  const porCedula = {}
  records.forEach(r => {
    if (!porCedula[r.cedula]) porCedula[r.cedula] = []
    porCedula[r.cedula].push(r)
  })
  return Object.entries(porCedula)
    .filter(([, regs]) => regs.length > 1)
    .map(([cedula, registros]) => ({ cedula, registros }))
}

export async function getAllCandidateUsers(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'users')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Crea un operador de Centro de Contacto evitando cuentas duplicadas —
// a diferencia de crearUsuarioCandidato (que sigue usando Usuarios/
// Dirigentes sin cambios), esta Cloud Function vincula el rol a una
// identidad ya existente si el email/CI ya está registrado, y si es
// persona nueva crea la cuenta SIN revelar contraseña (passwordAssigned:
// false) — se asigna después desde la tarjeta ("🔐 Asignar contraseña").
// Ver functions/src/index.ts::crearOperadorCandidato.
export async function crearOperador(candidateId, { nombre, email, cedula, telefono }) {
  const fn = httpsCallable(functionsInstance, 'crearOperadorCandidato')
  const res = await fn({ candidateId, nombre, email, cedula, telefono })
  return res.data
}

export async function updateCandidateUserMesaLocal(candidateId, uid, data) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'users', uid)), {
    seccional: data.seccional || null,
    mesa: data.mesa || null,
    local: data.local || null,
    mesasAsignadas: data.mesasAsignadas || null
  })
}

// Campos de pago del rol operador (monto entregado + cadencia de entrega).
// No es rol ni password, así que firestore.rules permite que campaign_admin
// lo escriba directo (mismo criterio que updateCandidateUserMesaLocal).
export async function updateCandidateUserPago(candidateId, uid, { montoEntregado, cadenciaPago }) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'users', uid)), {
    montoEntregado: montoEntregado ?? null,
    cadenciaPago: cadenciaPago || null
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
// savedRecordId (id del doc en savedRecords, == la clave de
// electionDayControl) se guarda para que firestore.rules pueda validar al
// mesario por el mecanismo NUEVO (assignedTableUserId) además del viejo
// (seccional+mesa en el perfil) — ver isMesarioOfControlVoter.
export async function marcarVoto(candidateId, { voterId, savedRecordId = null, cedula, seccional, mesa, local, markedBy }) {
  const configSnap = await getDoc(doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC)))
  if (!configSnap.exists() || !configSnap.data().enabled) {
    throw new Error('Día D no está habilitado')
  }
  const docId = `${seccional}_${mesa}_${cedula}`
  await setDoc(doc(db, ...candidatePath(candidateId, 'diaD', DIA_D_DOC, 'votes', docId)), {
    voterId: voterId || null,
    savedRecordId,
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

// ── Mesarios (roster de capacitación/presencia) ─────────────────────────
// Colección separada de savedRecords: acá se trackea proponente +
// capacitaciones/presencia, tanto para gente que vino de "Buscar votante"
// (wantsToBeMesario, se linkea con savedRecordId) como para mesarios
// cargados directamente sin pasar por el padrón. Ver mesario-candidate.js
// para cómo se mergean ambos orígenes en la UI.

export async function createMesario(candidateId, data) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'mesarios')), {
    nombre: '',
    ci: '',
    telefono: '',
    proponente: '',
    local: '',
    mesa: '',
    savedRecordId: null,
    capacitaciones: [],
    pagos: [],
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

export async function getMesarios(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'mesarios')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function updateMesario(candidateId, id, data) {
  return updateDoc(doc(db, ...candidatePath(candidateId, 'mesarios', id)), {
    ...data,
    updatedAt: serverTimestamp()
  })
}

export async function deleteMesario(candidateId, id) {
  return deleteDoc(doc(db, ...candidatePath(candidateId, 'mesarios', id)))
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

// Genérica y reusable para cualquier rol legacy (dirigente/mesario/etc.) —
// usada por Reportes > Resumen General. Cuenta el total del rol, no un
// corte por "activo": el campo `status` de users tiene una inconsistencia
// real ('active' vs 'activo' según la Cloud Function que lo escribió), así
// que un filtro por status subcontaría en silencio.
export async function getCandidateUsersCountByRole(candidateId, role) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'users')), where('role', '==', role))
  )
  return snap.data().count
}

export async function getMesariosCount(candidateId) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(collection(db, ...candidatePath(candidateId, 'mesarios')))
  return snap.data().count
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

// Además de callAssignments, espeja assignedUserId en el propio
// savedRecords (ccAssignedUserId) — así el pool de "sin asignar" se puede
// consultar con where('ccAssignedUserId','==',null) en vez de descargar
// callAssignments completo y cruzarlo con savedRecords en el cliente
// (auditoría de escala, ver Centro de Contacto).
export async function assignVoterToOperator(candidateId, voterId, operatorUid, assignedByUid) {
  const batch = writeBatch(db)
  batch.set(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
    candidateId,
    voterId,
    assignedUserId: operatorUid,
    assignedBy: assignedByUid,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  batch.update(doc(db, ...candidatePath(candidateId, 'savedRecords', voterId)), {
    ccAssignedUserId: operatorUid,
    updatedAt: serverTimestamp()
  })
  await batch.commit()
}

// BATCH_SIZE en 250 (no 400): cada voterId ahora escribe 2 docs
// (callAssignments + savedRecords) en el mismo batch, y el límite de
// Firestore es 500 escrituras por batch — 250*2 = 500, justo en el tope.
export async function assignVotersToOperatorBulk(candidateId, voterIds, operatorUid, assignedByUid) {
  const BATCH_SIZE = 250
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
      batch.update(doc(db, ...candidatePath(candidateId, 'savedRecords', voterId)), {
        ccAssignedUserId: operatorUid,
        updatedAt: serverTimestamp()
      })
    })
    await batch.commit()
  }
}

// Reasignar es la misma escritura que asignar (sobrescribe assignedUserId
// del mismo doc), pero se expone aparte para que la UI distinga la acción.
export async function reassignVoter(candidateId, voterId, newOperatorUid, reassignedByUid) {
  const batch = writeBatch(db)
  batch.set(doc(db, ...candidatePath(candidateId, 'callAssignments', voterId)), {
    assignedUserId: newOperatorUid,
    assignedBy: reassignedByUid,
    updatedAt: serverTimestamp()
  }, { merge: true })
  batch.update(doc(db, ...candidatePath(candidateId, 'savedRecords', voterId)), {
    ccAssignedUserId: newOperatorUid,
    updatedAt: serverTimestamp()
  })
  await batch.commit()
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

// ── Fuente única de consulta por scope para savedRecords (auditoría RBAC
// — scopes restringidos) ────────────────────────────────────────────
// Arma la consulta CORRECTA según el alcance efectivo del usuario para un
// permiso puntual — nunca trae de más para filtrar después en memoria. Si
// el usuario tiene varios alcances otorgados para el mismo permiso, se
// prioriza el más amplio (mismo orden que SCOPE_RANK en rbacCatalog.js);
// mezclar resultados de varios alcances a la vez queda fuera de esta
// función a propósito — un usuario real casi nunca tiene más de un
// alcance activo por permiso, y sumar eso complicaría la paginación sin
// un caso de uso real que lo pida.
//
// `actorUserDoc` es el doc ya cargado de candidates/{id}/users/{uid} del
// que llama (para no volver a pedirlo acá) — necesita zoneIds/
// pollingPlaceIds/tableIds/teamId.
export async function getSavedRecordsByScope(candidateId, actorUid, actorUserDoc, misRoles, permissionKey, { pageSize = DEFAULT_PAGE_SIZE, cursor = null } = {}) {
  const scopes = getGrantedScopes(misRoles, permissionKey)

  if (scopes.includes('all_candidate') || scopes.includes('all_platform')) {
    return listRecordsPageFiltered(candidateId, { cursor, pageSize })
  }
  if (scopes.includes('team') && actorUserDoc?.teamId) {
    return listRecordsPageFiltered(candidateId, { by: 'teamId', value: actorUserDoc.teamId, cursor, pageSize })
  }
  if (scopes.includes('zone') && actorUserDoc?.zoneIds?.length) {
    return listRecordsPageFiltered(candidateId, { by: 'seccional', value: actorUserDoc.zoneIds, cursor, pageSize })
  }
  if (scopes.includes('polling_place') && actorUserDoc?.pollingPlaceIds?.length) {
    return listRecordsPageFiltered(candidateId, { by: 'local', value: actorUserDoc.pollingPlaceIds, cursor, pageSize })
  }
  if (scopes.includes('table') && actorUserDoc?.tableIds?.length) {
    return listRecordsPageFiltered(candidateId, { by: 'mesa', value: actorUserDoc.tableIds, cursor, pageSize })
  }
  if (scopes.includes('own')) {
    return listRecordsPageFiltered(candidateId, { by: 'uid', value: actorUid, cursor, pageSize })
  }
  if (scopes.includes('assigned')) {
    // 'assigned' no vive en el propio savedRecords (electionDayControl,
    // otra colección) — no es list-provable, así que se resuelve en 2
    // pasos: 1) 2 queries doc-independientes a electionDayControl
    // (where('assignedLeaderId'/'assignedTableUserId','==',uid), cada una
    // por su cuenta ya es un patrón probado en el resto del código), 2)
    // get() puntual por id (getRecordsByIds). Sin cursor real — la lista
    // de asignados de una persona es acotada por diseño (no es el padrón
    // completo), no el volumen que justifica paginar con cursores.
    const edcRef = collection(db, ...candidatePath(candidateId, 'electionDayControl'))
    const [porLider, porMesa] = await Promise.all([
      getDocs(query(edcRef, where('assignedLeaderId', '==', actorUid))),
      getDocs(query(edcRef, where('assignedTableUserId', '==', actorUid)))
    ])
    const ids = [...new Set([...porLider.docs, ...porMesa.docs].map(d => d.id))]
    const records = await getRecordsByIds(candidateId, ids)
    return { records, lastDoc: null, hasMore: false }
  }
  return { records: [], lastDoc: null, hasMore: false }
}

// electionStatus y callAssignments usan voterId como id de documento (ver
// upsertElectionStatus/assignVoterToOperator) — igual patrón que
// getRecordsByIds: get() puntual por id, nunca list() sobre la colección
// completa, para poblar solo lo que corresponde a una página ya acotada.
export async function getElectionStatusesByIds(candidateId, ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  const docs = await Promise.all(
    unique.map(id => getDoc(doc(db, ...candidatePath(candidateId, 'electionStatus', id))))
  )
  return docs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }))
}

export async function getCallAssignmentsByIds(candidateId, ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  const docs = await Promise.all(
    unique.map(id => getDoc(doc(db, ...candidatePath(candidateId, 'callAssignments', id))))
  )
  return docs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }))
}

// Incidencias abiertas/en proceso acotadas — para el drill-down del
// dashboard de Pendientes (no reemplaza a getAllIncidents, que sigue
// siendo razonable para la pestaña Incidencias en sí: el volumen de
// incidencias lo genera actividad humana, no el tamaño del padrón).
export async function getOpenIncidents(candidateId, maxCount = 300) {
  const { getDocs: _getDocs } = await import('firebase/firestore')
  const [openSnap, inProgressSnap] = await Promise.all([
    _getDocs(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('status', '==', 'open'), limit(maxCount))),
    _getDocs(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('status', '==', 'in_progress'), limit(maxCount)))
  ])
  return [...openSnap.docs, ...inProgressSnap.docs].map(d => ({ id: d.id, ...d.data() }))
}

// Vista acotada para la pestaña "Día D" del Centro de Contacto (grilla de
// acción rápida): trae las asignaciones actualizadas más recientemente,
// no el histórico completo — para operar sobre todo el padrón el día de
// la elección está el módulo dedicado Día D Control.
export async function getRecentCallAssignments(candidateId, maxCount = 300) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'callAssignments')),
    orderBy('updatedAt', 'desc'),
    limit(maxCount)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Centro de Contacto a escala (50k-100k votantes) ─────────────────────
// Estas funciones reemplazan el patrón "getAllRecords + getAllCallAssignments
// y cruzar en el cliente" para lo que antes vivía en contactCenter.js:
// con un padrón grande eso significaba bajar decenas de miles de docs en
// cada visita al módulo. Acá todo es where()+limit() acotado o count().

export async function getUnassignedCount(candidateId) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where('ccAssignedUserId', '==', null))
  )
  return snap.data().count
}

// count() por dirigente — permite armar una vista previa exacta del
// criterio "por dirigente" (cuántos le tocarían a cada operador) sin
// descargar ni un solo documento, con costo acotado al tamaño del equipo
// (no del padrón).
export async function getUnassignedCountByDirigente(candidateId, dirigenteUid) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(
      collection(db, ...candidatePath(candidateId, 'savedRecords')),
      where('ccAssignedUserId', '==', null),
      where('uid', '==', dirigenteUid)
    )
  )
  return snap.data().count
}

// Paginado ordenado por local: usado por los criterios "local" y
// "equitativo" de la asignación automática — al ordenar por local, los
// votantes de un mismo local quedan contiguos, así una página grande
// (varios miles) casi nunca corta un local a la mitad.
export async function getUnassignedRecordsPage(candidateId, { cursor = null, pageSize = 2000 } = {}) {
  const clauses = [where('ccAssignedUserId', '==', null), orderBy('local')]
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'savedRecords')), ...clauses))
  return {
    records: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

// Criterio "dirigente": el universo de dirigentes es chico (equipo de
// campaña, no el padrón), así que se puede pedir el pool completo de cada
// uno con una query puntual — nunca hace falta escanear savedRecords
// entero para armar los grupos.
export async function getUnassignedRecordsByDirigente(candidateId, dirigenteUid, maxCount = 5000) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('ccAssignedUserId', '==', null),
    where('uid', '==', dirigenteUid),
    limit(maxCount)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Para "Asignar por local/zona" manual: igual idea que por dirigente,
// query puntual acotada en vez de escanear savedRecords entero.
export async function getUnassignedRecordsByLocal(candidateId, local, maxCount = 5000) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'savedRecords')),
    where('ccAssignedUserId', '==', null),
    where('local', '==', local),
    limit(maxCount)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Drill-down acotado para las tarjetas del dashboard de Pendientes (p.ej.
// "Contactados", "Confirmados") — no pagina con cursor, corta en
// maxCount: es para inspección rápida del admin, no para exportar todo
// (eso ya lo cubre Excel en Registros).
export async function getElectionStatusByFlag(candidateId, flag, maxCount = 300) {
  const q = query(collection(db, ...candidatePath(candidateId, 'electionStatus')), where(flag, '==', true), limit(maxCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Búsqueda acotada para Centro de Contacto: CI es match exacto (los
// operadores/dirigentes suelen tener la cédula completa a mano); nombre
// usa prefix-search sobre nombre_upper, igual criterio que el padrón.
// Nunca descarga savedRecords completo para filtrar en el cliente.
export async function searchRecordsForContactCenter(candidateId, termino) {
  const valor = String(termino).trim()
  if (!valor) return []
  const esCedula = /^\d+$/.test(valor)
  const q = esCedula
    ? query(collection(db, ...candidatePath(candidateId, 'savedRecords')), where('cedula', '==', valor), limit(20))
    : query(
        collection(db, ...candidatePath(candidateId, 'savedRecords')),
        where('nombre_upper', '>=', valor.toUpperCase()),
        where('nombre_upper', '<=', valor.toUpperCase() + ''),
        limit(20)
      )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Contadores agregados para el dashboard de Pendientes/Asignación — count()
// no descarga documentos, así que el costo no depende del tamaño del
// padrón. flags es un array de nombres de campo booleano en electionStatus.
export async function getElectionStatusFlagCounts(candidateId, flags) {
  const { getCountFromServer } = await import('firebase/firestore')
  const entries = await Promise.all(flags.map(async flag => {
    const snap = await getCountFromServer(
      query(collection(db, ...candidatePath(candidateId, 'electionStatus')), where(flag, '==', true))
    )
    return [flag, snap.data().count]
  }))
  return Object.fromEntries(entries)
}

export async function getCallAssignmentStatusCount(candidateId, status) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'callAssignments')), where('status', '==', status))
  )
  return snap.data().count
}

export async function getOpenIncidentsCount(candidateId) {
  const { getCountFromServer } = await import('firebase/firestore')
  const [open, inProgress] = await Promise.all([
    getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('status', '==', 'open'))),
    getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('status', '==', 'in_progress')))
  ])
  return open.data().count + inProgress.data().count
}

// ── Estadísticas por operador (tabla de la pestaña Asignación) ──────────
// Antes se calculaban filtrando arrays de asignaciones/estados/incidencias
// completos del candidato en el cliente — a escala (50k-100k) eso obligaba
// a bajar todo. count() con dos igualdades (assignedUserId + el campo que
// corresponda) no necesita índice compuesto y no depende del tamaño total.

export async function getCallAssignmentCountForOperator(candidateId, operatorUid, status = null) {
  const { getCountFromServer } = await import('firebase/firestore')
  const clauses = [where('assignedUserId', '==', operatorUid)]
  if (status) clauses.push(where('status', '==', status))
  const snap = await getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'callAssignments')), ...clauses))
  return snap.data().count
}

export async function getElectionStatusFlagCountForOperator(candidateId, operatorUid, flag) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'electionStatus')), where('assignedUserId', '==', operatorUid), where(flag, '==', true))
  )
  return snap.data().count
}

export async function getIncidentsCountForOperator(candidateId, operatorUid) {
  const { getCountFromServer } = await import('firebase/firestore')
  const [open, inProgress] = await Promise.all([
    getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('assignedUserId', '==', operatorUid), where('status', '==', 'open'))),
    getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'incidents')), where('assignedUserId', '==', operatorUid), where('status', '==', 'in_progress')))
  ])
  return open.data().count + inProgress.data().count
}

// Página de asignaciones por status (p.ej. 'pending') — reemplaza a
// getAllCallAssignments + filtrar en el cliente para la lista de trabajo
// del admin en Centro de Contacto.
export async function getCallAssignmentsPage(candidateId, { status = null, cursor = null, pageSize = 50 } = {}) {
  const clauses = status ? [where('status', '==', status)] : []
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'callAssignments')), ...clauses))
  return {
    assignments: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
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

// Conteo por status — para Reportes > Resumen General. electionDayControl
// es la ÚNICA fuente de verdad de "votó" (ver setDiaDStatus/marcarVoto más
// abajo), nunca leer electionStatus.voted ni diaD/votes para esta métrica.
export async function getElectionDayControlStatusCount(candidateId, status) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(
    query(collection(db, ...candidatePath(candidateId, 'electionDayControl')), where('status', '==', status))
  )
  return snap.data().count
}

// Suscripción en vivo a TODO electionDayControl del candidato — usada por
// Día D Admin para que "votó" también cuente lo marcado por vías que no
// pasan por diaD/votes (p.ej. un operador confirmando desde Centro de
// Contacto, que no tiene mesa asociada para el espejo best-effort — ver
// auditoría Día D). Mismo patrón que listenAllVotes/listenDrivers: array
// completo en cada cambio, no docChanges(), para que el consumidor
// simplemente reemplace su copia local.
export function listenAllElectionDayControl(candidateId, onChange) {
  return onSnapshot(
    collection(db, ...candidatePath(candidateId, 'electionDayControl')),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error('Error escuchando electionDayControl:', err)
  )
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
// acción rápida de los 4 roles, y es la ÚNICA fuente de verdad de "votó"
// (electionDayControl.status === 'voted'; ver auditoría Día D). Lee el doc
// actual (para el defaults-on-create y para loguear previousStatus),
// actualiza electionDayControl y deja rastro en electionDayMovements. Si el
// nuevo estado es 'voted', además sincroniza diaD/votes (marcarVoto) para
// que Día D Admin (que calcula "votó" desde ahí) quede consistente —
// firestore.rules acepta al mesario tanto por el mecanismo viejo
// (isMesarioOfMesa, seccional+mesa en el perfil) como por el nuevo
// (isMesarioOfControlVoter, assignedTableUserId acá) desde que se agregó
// savedRecordId al doc de voto. El try/catch queda como red de seguridad
// para casos borde (Día D deshabilitado, etc.), no como parche del
// mecanismo de permisos — eso ya está resuelto.
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
        // Si el registro ya tenía chofer_asignado (por ejemplo, asignado
        // desde la pestaña Choferes en vez de Día D Control), hay que
        // heredarlo acá — si no, firestore.rules rechaza este create para
        // el propio chofer (isDriverOwner exige assignedDriverId != null).
        assignedDriverId: record.chofer_asignado || null,
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
        savedRecordId: record.id,
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
        assignedDriverId: record.chofer_asignado || null,
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

// FIX (hallazgo de la verificación de "fuente única de votó"): antes esta
// función no inicializaba ELECTION_DAY_CONTROL_DEFAULTS al crear el doc
// desde cero (a diferencia de assignDriverToVoter, que sí lo hacía) — si
// era la PRIMERA acción sobre ese voterId, el doc quedaba sin
// assignedDriverId/assignedLeaderId/status, y cualquier update posterior
// de dirigente/mesario/chofer/operador fallaba con permission-denied
// porque la regla compara esos campos entre el doc viejo y el nuevo, y
// Firestore no puede comparar un campo que no existe en ninguno de los
// dos lados. Recibe `record` (no solo voterId) para poder poblar los
// defaults igual que assignDriverToVoter.
export async function assignLeaderToVoter(candidateId, record, leaderUid, actorUid) {
  const voterId = record.id
  const ref = doc(db, ...candidateControlPath(candidateId, voterId))
  const existing = await getDoc(ref)
  const base = existing.exists()
    ? {}
    : { candidateId, voterId, assignedTableUserId: null, ...ELECTION_DAY_CONTROL_DEFAULTS, pollingPlace: record.local || '', tableNumber: record.mesa || '', createdAt: serverTimestamp() }
  await setDoc(ref, {
    ...base,
    assignedLeaderId: leaderUid,
    lastUpdatedBy: actorUid,
    lastUpdatedRole: 'campaign_admin',
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function assignTableUserToVoter(candidateId, record, tableUserUid, actorUid) {
  const voterId = record.id
  const ref = doc(db, ...candidateControlPath(candidateId, voterId))
  const existing = await getDoc(ref)
  const base = existing.exists()
    ? {}
    : { candidateId, voterId, assignedLeaderId: record.uid || null, ...ELECTION_DAY_CONTROL_DEFAULTS, createdAt: serverTimestamp() }
  await setDoc(ref, {
    ...base,
    assignedTableUserId: tableUserUid,
    pollingPlace: record.local || '',
    tableNumber: record.mesa || '',
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

// ═══════════════════════════════════════════════════════════════════
// Finanzas de Campaña — Etapa 1 (modelo de datos, resumen, obligaciones).
// Reutiliza roles existentes (campaign_admin, auditor) y agrega 3 nuevos:
// finance_admin, finance_operator, cashier (ver CANDIDATE_ROLES en
// functions/src/index.ts y firestore.rules). Pagos, comprobantes,
// liquidaciones, caja e integración Día D quedan para etapas siguientes.
// ═══════════════════════════════════════════════════════════════════

const FINANCE_BENEFICIARY_TYPES = ['mesario', 'chofer', 'dirigente', 'operador', 'votante', 'proveedor', 'otro']
const FINANCE_OBLIGATION_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'partially_paid', 'paid', 'cancelled', 'overdue']
const FINANCE_FREQUENCIES = ['one_time', 'weekly', 'monthly', 'election_day', 'custom']

function financeObligationPath(candidateId, obligationId) {
  return candidatePath(candidateId, 'financeObligations', obligationId)
}

// Deja rastro inmutable de toda acción financiera (sección 14 del spec) —
// se llama desde cada función de escritura de este módulo, nunca a mano
// desde la UI, para que no se pueda olvidar loguear una acción.
export async function logFinanceAudit(candidateId, { entityType, entityId, action, previousData = null, newData = null, performedBy, performedByRole, reason = '' }) {
  await addDoc(collection(db, ...candidatePath(candidateId, 'financeAuditLogs')), {
    candidateId, entityType, entityId, action, previousData, newData,
    performedBy, performedByRole, reason,
    createdAt: serverTimestamp()
  })
}

export async function createFinanceObligation(candidateId, data, actorUid, actorRole) {
  const ref = doc(collection(db, ...candidatePath(candidateId, 'financeObligations')))
  const payload = {
    beneficiaryType: data.beneficiaryType,
    beneficiaryUserId: data.beneficiaryUserId || null,
    beneficiaryVoterId: data.beneficiaryVoterId || null,
    beneficiaryName: data.beneficiaryName || '',
    beneficiaryDocument: data.beneficiaryDocument || '',
    beneficiaryPhone: data.beneficiaryPhone || '',
    beneficiaryRole: data.beneficiaryRole || '',
    concept: data.concept || '',
    description: data.description || '',
    amount: Number(data.amount) || 0,
    currency: data.currency || 'PYG',
    frequency: data.frequency || 'one_time',
    periodType: data.periodType || '',
    periodStart: data.periodStart || null,
    periodEnd: data.periodEnd || null,
    dueDate: data.dueDate || null,
    paymentMethodPlanned: data.paymentMethodPlanned || '',
    relatedModule: data.relatedModule || '',
    relatedDiaDId: data.relatedDiaDId || null,
    relatedDriverId: data.relatedDriverId || null,
    relatedTableUserId: data.relatedTableUserId || null,
    relatedLeaderId: data.relatedLeaderId || null,
    relatedVoterId: data.relatedVoterId || null,
    requiresApproval: data.requiresApproval !== false,
    status: data.status === 'draft' ? 'draft' : 'pending',
    candidateId,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  await logFinanceAudit(candidateId, {
    entityType: 'obligation', entityId: ref.id, action: 'create',
    previousData: null, newData: payload, performedBy: actorUid, performedByRole: actorRole
  })
  return ref.id
}

export async function updateFinanceObligation(candidateId, obligationId, updates, actorUid, actorRole) {
  const ref = doc(db, ...financeObligationPath(candidateId, obligationId))
  const before = await getDoc(ref)
  await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'obligation', entityId: obligationId, action: 'edit',
    previousData: before.exists() ? before.data() : null, newData: updates,
    performedBy: actorUid, performedByRole: actorRole
  })
}

// selfApproval=true indica que quien aprueba es la misma persona que creó
// la obligación. El spec (sección 7) dice que esto no "debería" pasar
// salvo excepción de campaign_admin/superadmin — las rules ya se lo
// impiden del todo a finance_operator, así que esto es solo para dejar
// registrada la excepción en auditoría cuando un campaign_admin lo hace.
export async function approveFinanceObligation(candidateId, obligation, actorUid, actorRole, { selfApproval = false } = {}) {
  const ref = doc(db, ...financeObligationPath(candidateId, obligation.id))
  await updateDoc(ref, { status: 'approved', approvedBy: actorUid, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'obligation', entityId: obligation.id, action: 'approve',
    previousData: { status: obligation.status }, newData: { status: 'approved' },
    performedBy: actorUid, performedByRole: actorRole,
    reason: selfApproval ? 'EXCEPCIÓN: mismo usuario creó y aprobó esta obligación' : ''
  })
}

export async function rejectFinanceObligation(candidateId, obligation, actorUid, actorRole, motivo = '') {
  const ref = doc(db, ...financeObligationPath(candidateId, obligation.id))
  await updateDoc(ref, { status: 'rejected', rejectedBy: actorUid, rejectedAt: serverTimestamp(), rejectionReason: motivo, updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'obligation', entityId: obligation.id, action: 'reject',
    previousData: { status: obligation.status }, newData: { status: 'rejected' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
}

export async function cancelFinanceObligation(candidateId, obligation, actorUid, actorRole, motivo = '') {
  const ref = doc(db, ...financeObligationPath(candidateId, obligation.id))
  await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'obligation', entityId: obligation.id, action: 'cancel',
    previousData: { status: obligation.status }, newData: { status: 'cancelled' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
}

export async function getFinanceObligationsPage(candidateId, { status = null, cursor = null, pageSize = 50 } = {}) {
  const clauses = []
  if (status) clauses.push(where('status', '==', status))
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'financeObligations')), ...clauses))
  return {
    obligations: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

export async function getFinanceObligationsCountByStatus(candidateId, status) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'financeObligations')), where('status', '==', status)))
  return snap.data().count
}

export async function getFinanceObligationsSumByStatus(candidateId, status) {
  const { getAggregateFromServer, sum } = await import('firebase/firestore')
  const snap = await getAggregateFromServer(
    query(collection(db, ...candidatePath(candidateId, 'financeObligations')), where('status', '==', status)),
    { total: sum('amount') }
  )
  return snap.data().total || 0
}

export async function getFinanceObligationsCountByFrequency(candidateId, frequency) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'financeObligations')), where('frequency', '==', frequency)))
  return snap.data().count
}

// Resumen del dashboard (sección 4 del spec) — todo por count()/sum() en
// vez de bajar la colección completa, mismo criterio de escala usado en
// Centro de Contacto para 50-100k registros.
export async function getFinanceSummary(candidateId) {
  const [pendingCount, approvedCount, paidCount, rejectedCount,
    pendingSum, approvedSum, paidSum, electionDayCount] = await Promise.all([
    getFinanceObligationsCountByStatus(candidateId, 'pending'),
    getFinanceObligationsCountByStatus(candidateId, 'approved'),
    getFinanceObligationsCountByStatus(candidateId, 'paid'),
    getFinanceObligationsCountByStatus(candidateId, 'rejected'),
    getFinanceObligationsSumByStatus(candidateId, 'pending'),
    getFinanceObligationsSumByStatus(candidateId, 'approved'),
    getFinanceObligationsSumByStatus(candidateId, 'paid'),
    getFinanceObligationsCountByFrequency(candidateId, 'election_day')
  ])
  return { pendingCount, approvedCount, paidCount, rejectedCount, pendingSum, approvedSum, paidSum, electionDayCount }
}

export async function getFinanceAuditLogs(candidateId, entityId, pageSize = 50) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'financeAuditLogs')),
    where('entityId', '==', entityId),
    orderBy('createdAt', 'desc'),
    limit(pageSize)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

const FINANCE_SETTINGS_DEFAULTS = {
  defaultCurrency: 'PYG',
  mesarioRate: 0,
  driverRate: 0,
  leaderRate: 0,
  weeklyRate: 0,
  monthlyRate: 0,
  electionDayRate: 0,
  fuelAllowance: 0,
  mealAllowance: 0,
  maxVoterAssistanceAmount: 0,
  approvalThreshold: 0
}

export async function getFinanceSettings(candidateId) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId, 'config', 'financeSettings')))
  return snap.exists() ? { ...FINANCE_SETTINGS_DEFAULTS, ...snap.data() } : { ...FINANCE_SETTINGS_DEFAULTS }
}

export async function updateFinanceSettings(candidateId, settings, actorUid) {
  await setDoc(doc(db, ...candidatePath(candidateId, 'config', 'financeSettings')), {
    ...settings, updatedBy: actorUid, updatedAt: serverTimestamp()
  }, { merge: true })
}

export { FINANCE_BENEFICIARY_TYPES, FINANCE_OBLIGATION_STATUSES, FINANCE_FREQUENCIES }

// ═══════════════════════════════════════════════════════════════════
// Finanzas de Campaña — Etapa 2 (pagos, aprobación de pagos,
// comprobantes). Un pago siempre cuelga de una obligación (obligationId)
// — nunca se paga "suelto". Al marcar un pago como 'paid', se recalcula
// automáticamente el status de la obligación (paid/partially_paid) sumando
// SOLO los pagos en estado 'paid' — así el status de la obligación nunca
// se edita a mano, siempre es un espejo de lo realmente pagado.
// ═══════════════════════════════════════════════════════════════════

const FINANCE_PAYMENT_METHODS = ['cash', 'bank_transfer', 'wallet', 'check', 'card', 'other']
const FINANCE_PAYMENT_STATUSES = ['pending', 'approved', 'paid', 'failed', 'reversed', 'cancelled']

function financePaymentPath(candidateId, paymentId) {
  return candidatePath(candidateId, 'financePayments', paymentId)
}

// REGLA OBLIGATORIA (spec sección 6): no duplicar un pago completo sobre
// una obligación ya paid/cancelled, salvo reversión autorizada explícita
// (authorizedReversal=true, que además queda anotado en auditoría).
export async function createFinancePayment(candidateId, obligation, data, actorUid, actorRole) {
  if (['paid', 'cancelled'].includes(obligation.status) && !data.authorizedReversal) {
    throw new Error('Esta obligación ya está paga o cancelada. Si necesitás corregir un pago, usá Reversión (requiere autorización explícita).')
  }
  const ref = doc(collection(db, ...candidatePath(candidateId, 'financePayments')))
  const payload = {
    obligationId: obligation.id,
    beneficiaryUserId: obligation.beneficiaryUserId || null,
    beneficiaryName: obligation.beneficiaryName || '',
    amount: Number(data.amount) || 0,
    currency: data.currency || obligation.currency || 'PYG',
    paymentMethod: data.paymentMethod || 'cash',
    paymentReference: data.paymentReference || '',
    bankName: data.bankName || '',
    accountOrWallet: data.accountOrWallet || '',
    paymentDate: data.paymentDate || null,
    status: 'pending',
    receiptUrl: null,
    notes: data.notes || '',
    candidateId,
    createdBy: actorUid,
    approvedBy: null,
    paidBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: ref.id, action: 'create',
    previousData: null, newData: payload, performedBy: actorUid, performedByRole: actorRole,
    reason: data.authorizedReversal ? 'Pago registrado como reversión autorizada sobre obligación ya cerrada' : ''
  })
  return ref.id
}

export async function approveFinancePayment(candidateId, payment, actorUid, actorRole) {
  const ref = doc(db, ...financePaymentPath(candidateId, payment.id))
  await updateDoc(ref, { status: 'approved', approvedBy: actorUid, updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: payment.id, action: 'approve',
    previousData: { status: payment.status }, newData: { status: 'approved' },
    performedBy: actorUid, performedByRole: actorRole
  })
}

export async function rejectFinancePayment(candidateId, payment, actorUid, actorRole, motivo = '') {
  const ref = doc(db, ...financePaymentPath(candidateId, payment.id))
  await updateDoc(ref, { status: 'failed', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: payment.id, action: 'reject',
    previousData: { status: payment.status }, newData: { status: 'failed' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
}

// Recalcula el status de la obligación sumando únicamente sus pagos en
// estado 'paid' — se llama después de CUALQUIER cambio a financePayments
// que pueda afectar el total pagado (marcar pagado, revertir, cancelar).
async function recalcularEstadoObligacion(candidateId, obligationId, actorUid, actorRole, reason) {
  const paymentsSnap = await getDocs(query(
    collection(db, ...candidatePath(candidateId, 'financePayments')),
    where('obligationId', '==', obligationId)
  ))
  const totalPagado = paymentsSnap.docs
    .filter(d => d.data().status === 'paid')
    .reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0)

  const obRef = doc(db, ...financeObligationPath(candidateId, obligationId))
  const obSnap = await getDoc(obRef)
  if (!obSnap.exists()) return
  const monto = Number(obSnap.data().amount) || 0
  const statusActual = obSnap.data().status
  if (['rejected', 'cancelled'].includes(statusActual)) return // no reabrir una obligación cerrada por otra vía

  const nuevoStatus = monto > 0 && totalPagado >= monto ? 'paid' : (totalPagado > 0 ? 'partially_paid' : 'approved')
  if (nuevoStatus !== statusActual) {
    await updateDoc(obRef, { status: nuevoStatus, updatedAt: serverTimestamp() })
    await logFinanceAudit(candidateId, {
      entityType: 'obligation', entityId: obligationId, action: 'edit',
      previousData: { status: statusActual }, newData: { status: nuevoStatus },
      performedBy: actorUid, performedByRole: actorRole, reason: reason || 'Recalculado automáticamente desde financePayments'
    })
  }
}

// extra.cashAccountId es opcional (Etapa 3): si se pasa, además de marcar
// el pago como pagado se registra automáticamente el egreso en Caja
// (cashMovements) — un solo click cubre las 2 anotaciones, sin duplicar
// el dato del monto/beneficiario a mano en dos lugares.
export async function markFinancePaymentAsPaid(candidateId, payment, actorUid, actorRole, extra = {}) {
  const ref = doc(db, ...financePaymentPath(candidateId, payment.id))
  const paymentDate = extra.paymentDate || new Date().toISOString().slice(0, 10)
  await updateDoc(ref, {
    status: 'paid', paidBy: actorUid, paymentDate,
    paymentReference: extra.paymentReference || payment.paymentReference || '',
    cashAccountId: extra.cashAccountId || null,
    updatedAt: serverTimestamp()
  })
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: payment.id, action: 'pay',
    previousData: { status: payment.status }, newData: { status: 'paid' },
    performedBy: actorUid, performedByRole: actorRole
  })
  await recalcularEstadoObligacion(candidateId, payment.obligationId, actorUid, actorRole, 'Pago marcado como pagado')

  if (extra.cashAccountId) {
    await createCashMovement(candidateId, {
      cashAccountId: extra.cashAccountId, type: 'expense', category: 'pago_obligacion',
      amount: payment.amount, currency: payment.currency,
      description: `Pago a ${payment.beneficiaryName}`,
      relatedPaymentId: payment.id, relatedObligationId: payment.obligationId,
      movementDate: paymentDate
    }, actorUid, actorRole)
  }
}

// Reversión autorizada — deshace un pago ya marcado como pagado (spec
// sección 6: "salvo reversión autorizada"). Reservado a finance_admin/
// campaign_admin (ver firestore.rules); siempre queda registrada la razón.
export async function reverseFinancePayment(candidateId, payment, actorUid, actorRole, motivo) {
  if (!motivo) throw new Error('Toda reversión de pago requiere un motivo — queda en auditoría.')
  const ref = doc(db, ...financePaymentPath(candidateId, payment.id))
  await updateDoc(ref, { status: 'reversed', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: payment.id, action: 'reverse',
    previousData: { status: payment.status }, newData: { status: 'reversed' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
  await recalcularEstadoObligacion(candidateId, payment.obligationId, actorUid, actorRole, `Pago revertido: ${motivo}`)
}

export async function cancelFinancePayment(candidateId, payment, actorUid, actorRole, motivo = '') {
  const ref = doc(db, ...financePaymentPath(candidateId, payment.id))
  await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'payment', entityId: payment.id, action: 'cancel',
    previousData: { status: payment.status }, newData: { status: 'cancelled' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
}

export async function getFinancePaymentsByObligation(candidateId, obligationId) {
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'financePayments')), where('obligationId', '==', obligationId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
}

export async function getFinancePaymentsPage(candidateId, { status = null, cursor = null, pageSize = 50 } = {}) {
  const clauses = []
  if (status) clauses.push(where('status', '==', status))
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'financePayments')), ...clauses))
  return {
    payments: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

export async function getFinancePaymentsCountByStatus(candidateId, status) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(query(collection(db, ...candidatePath(candidateId, 'financePayments')), where('status', '==', status)))
  return snap.data().count
}

export async function getFinancePaymentsWithoutReceiptCount(candidateId) {
  const { getCountFromServer } = await import('firebase/firestore')
  const snap = await getCountFromServer(query(
    collection(db, ...candidatePath(candidateId, 'financePayments')),
    where('status', '==', 'paid'),
    where('receiptUrl', '==', null)
  ))
  return snap.data().count
}

// ── Comprobantes (Firebase Storage + metadata en Firestore) ──────────
// Requiere que Storage esté habilitado en el proyecto (Firebase Console
// → Storage → "Get Started") — no se puede activar por CLI/API. Import
// dinámico de firebase/storage: nadie más en la app usa Storage todavía,
// así que no vale la pena cargarlo en cada página que importa este
// archivo (mismo criterio que count()/sum() dinámicos más arriba).
const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const RECEIPT_MAX_SIZE = 10 * 1024 * 1024

export async function uploadFinanceReceipt(candidateId, { paymentId = null, obligationId = null, file }, actorUid) {
  if (!RECEIPT_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Subí una imagen (JPG/PNG/WEBP) o un PDF.')
  }
  if (file.size > RECEIPT_MAX_SIZE) {
    throw new Error('El archivo supera el tamaño máximo permitido (10 MB).')
  }

  const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage')
  const storage = getStorage()
  const carpeta = paymentId || obligationId || 'sin-referencia'
  const path = `candidates/${candidateId}/financeReceipts/${carpeta}/${Date.now()}_${file.name}`
  const fileRef = storageRef(storage, path)
  await uploadBytes(fileRef, file)
  const downloadUrl = await getDownloadURL(fileRef)

  const docRef = doc(collection(db, ...candidatePath(candidateId, 'financeReceipts')))
  const payload = {
    candidateId, paymentId, obligationId,
    fileName: file.name, fileType: file.type, fileSize: file.size,
    storagePath: path, downloadUrl,
    uploadedBy: actorUid, uploadedAt: serverTimestamp()
  }
  await setDoc(docRef, payload)

  if (paymentId) {
    await updateDoc(doc(db, ...financePaymentPath(candidateId, paymentId)), { receiptUrl: downloadUrl, updatedAt: serverTimestamp() })
  }
  await logFinanceAudit(candidateId, {
    entityType: 'receipt', entityId: docRef.id, action: 'upload_receipt',
    previousData: null, newData: { fileName: file.name, paymentId, obligationId },
    performedBy: actorUid, performedByRole: ''
  })
  return docRef.id
}

export async function getFinanceReceiptsByPayment(candidateId, paymentId) {
  const q = query(collection(db, ...candidatePath(candidateId, 'financeReceipts')), where('paymentId', '==', paymentId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export { FINANCE_PAYMENT_METHODS, FINANCE_PAYMENT_STATUSES }

// ═══════════════════════════════════════════════════════════════════
// Finanzas de Campaña — Etapa 3 (liquidaciones, caja, reportes).
// Liquidaciones NO reimplementa el flujo de pago: agrupa obligationIds y,
// al pagarse, llama a createFinancePayment/approveFinancePayment/
// markFinancePaymentAsPaid (mismas funciones de la Etapa 2) una vez por
// obligación — así el histórico de pagos, la auditoría y el recálculo de
// status de obligación siguen siendo una sola fuente de verdad.
// ═══════════════════════════════════════════════════════════════════

const PAYMENT_BATCH_STATUSES = ['draft', 'ready_for_approval', 'approved', 'partially_paid', 'paid', 'cancelled']
const PAYMENT_BATCH_TYPES = ['weekly', 'monthly', 'election_day', 'custom']

function paymentBatchPath(candidateId, batchId) {
  return candidatePath(candidateId, 'paymentBatches', batchId)
}

export async function createPaymentBatch(candidateId, data, actorUid, actorRole) {
  const obligationSnaps = await Promise.all(
    data.obligationIds.map(id => getDoc(doc(db, ...financeObligationPath(candidateId, id))))
  )
  const invalidas = obligationSnaps.filter(s => !s.exists() || !['approved', 'partially_paid'].includes(s.data().status))
  if (invalidas.length > 0) {
    throw new Error('Todas las obligaciones de una liquidación deben estar aprobadas o parcialmente pagadas.')
  }
  const totalAmount = obligationSnaps.reduce((sum, s) => sum + (Number(s.data().amount) || 0), 0)

  const ref = doc(collection(db, ...candidatePath(candidateId, 'paymentBatches')))
  const payload = {
    candidateId,
    batchType: data.batchType || 'custom',
    title: data.title || '',
    periodStart: data.periodStart || null,
    periodEnd: data.periodEnd || null,
    obligationIds: data.obligationIds,
    paymentIds: [],
    totalAmount,
    currency: data.currency || 'PYG',
    status: 'draft',
    createdBy: actorUid,
    approvedBy: null,
    paidBy: null,
    createdAt: serverTimestamp(),
    approvedAt: null,
    paidAt: null
  }
  await setDoc(ref, payload)
  await logFinanceAudit(candidateId, {
    entityType: 'batch', entityId: ref.id, action: 'create',
    previousData: null, newData: payload, performedBy: actorUid, performedByRole: actorRole
  })
  return ref.id
}

export async function submitPaymentBatch(candidateId, batch, actorUid, actorRole) {
  const ref = doc(db, ...paymentBatchPath(candidateId, batch.id))
  await updateDoc(ref, { status: 'ready_for_approval', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'batch', entityId: batch.id, action: 'submit',
    previousData: { status: batch.status }, newData: { status: 'ready_for_approval' },
    performedBy: actorUid, performedByRole: actorRole
  })
}

export async function approvePaymentBatch(candidateId, batch, actorUid, actorRole) {
  const ref = doc(db, ...paymentBatchPath(candidateId, batch.id))
  await updateDoc(ref, { status: 'approved', approvedBy: actorUid, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'batch', entityId: batch.id, action: 'approve',
    previousData: { status: batch.status }, newData: { status: 'approved' },
    performedBy: actorUid, performedByRole: actorRole
  })
}

export async function cancelPaymentBatch(candidateId, batch, actorUid, actorRole, motivo = '') {
  const ref = doc(db, ...paymentBatchPath(candidateId, batch.id))
  await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() })
  await logFinanceAudit(candidateId, {
    entityType: 'batch', entityId: batch.id, action: 'cancel',
    previousData: { status: batch.status }, newData: { status: 'cancelled' },
    performedBy: actorUid, performedByRole: actorRole, reason: motivo
  })
}

// Paga TODA la liquidación: por cada obligación pendiente de cobro dentro
// del lote, registra+aprueba+marca pagado un financePayment por el saldo
// restante (monto - lo ya pagado), reutilizando el motor de la Etapa 2.
// Si alguna obligación individual falla (permisos, ya cancelada, etc.) no
// aborta las demás — el lote queda 'partially_paid' y el error queda en
// consola para que el operador reintente esa obligación puntual.
export async function payPaymentBatch(candidateId, batch, actorUid, actorRole, { cashAccountId = null } = {}) {
  const paymentIds = []
  let algunFallo = false

  for (const obligationId of batch.obligationIds) {
    try {
      const obSnap = await getDoc(doc(db, ...financeObligationPath(candidateId, obligationId)))
      if (!obSnap.exists()) continue
      const obligation = { id: obligationId, ...obSnap.data() }
      if (['paid', 'cancelled', 'rejected'].includes(obligation.status)) continue

      const pagosPrevios = await getFinancePaymentsByObligation(candidateId, obligationId)
      const yaPagado = pagosPrevios.filter(p => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0)
      const saldo = (Number(obligation.amount) || 0) - yaPagado
      if (saldo <= 0) continue

      const paymentId = await createFinancePayment(candidateId, obligation, {
        amount: saldo, paymentMethod: 'bank_transfer', notes: `Pago vía liquidación: ${batch.title || batch.id}`
      }, actorUid, actorRole)

      let pSnap = await getDoc(doc(db, ...financePaymentPath(candidateId, paymentId)))
      await approveFinancePayment(candidateId, { id: paymentId, ...pSnap.data() }, actorUid, actorRole)

      pSnap = await getDoc(doc(db, ...financePaymentPath(candidateId, paymentId)))
      await markFinancePaymentAsPaid(candidateId, { id: paymentId, ...pSnap.data() }, actorUid, actorRole, { cashAccountId })

      paymentIds.push(paymentId)
    } catch (err) {
      algunFallo = true
      console.error(`Error pagando la obligación ${obligationId} de la liquidación ${batch.id}:`, err.message)
    }
  }

  const ref = doc(db, ...paymentBatchPath(candidateId, batch.id))
  const nuevoStatus = algunFallo ? 'partially_paid' : 'paid'
  await updateDoc(ref, {
    paymentIds: [...(batch.paymentIds || []), ...paymentIds],
    status: nuevoStatus, paidBy: actorUid, paidAt: serverTimestamp(), updatedAt: serverTimestamp()
  })
  await logFinanceAudit(candidateId, {
    entityType: 'batch', entityId: batch.id, action: 'pay',
    previousData: { status: batch.status }, newData: { status: nuevoStatus },
    performedBy: actorUid, performedByRole: actorRole,
    reason: algunFallo ? 'Una o más obligaciones del lote no pudieron pagarse — ver consola/auditoría individual' : ''
  })
  return { paymentIds, algunFallo }
}

export async function getPaymentBatchesPage(candidateId, { status = null, cursor = null, pageSize = 30 } = {}) {
  const clauses = []
  if (status) clauses.push(where('status', '==', status))
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'paymentBatches')), ...clauses))
  return {
    batches: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

export { PAYMENT_BATCH_STATUSES, PAYMENT_BATCH_TYPES }

// ── Caja (cashAccounts + cashMovements) ──────────────────────────────
// Spec sección 11: "no calcular saldo únicamente en frontend". El saldo
// nunca se guarda como contador acumulado editable — siempre se recalcula
// sumando server-side (Firestore aggregation) el ledger completo de
// cashMovements sobre el initialBalance de la cuenta.
const CASH_MOVEMENT_TYPES = ['income', 'expense', 'adjustment', 'transfer_in', 'transfer_out']

export async function createCashAccount(candidateId, data, actorUid) {
  const ref = doc(collection(db, ...candidatePath(candidateId, 'cashAccounts')))
  const payload = {
    candidateId,
    name: data.name || 'Caja principal',
    initialBalance: Number(data.initialBalance) || 0,
    currency: data.currency || 'PYG',
    responsibleUserId: data.responsibleUserId || null,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  return ref.id
}

export async function getCashAccounts(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'cashAccounts')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function createCashMovement(candidateId, data, actorUid, actorRole) {
  const ref = doc(collection(db, ...candidatePath(candidateId, 'cashMovements')))
  const payload = {
    candidateId,
    cashAccountId: data.cashAccountId,
    type: data.type,
    category: data.category || '',
    amount: Number(data.amount) || 0,
    currency: data.currency || 'PYG',
    description: data.description || '',
    relatedPaymentId: data.relatedPaymentId || null,
    relatedObligationId: data.relatedObligationId || null,
    movementDate: data.movementDate || new Date().toISOString().slice(0, 10),
    createdBy: actorUid,
    approvedBy: null,
    createdAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  await logFinanceAudit(candidateId, {
    entityType: 'cashMovement', entityId: ref.id, action: 'create',
    previousData: null, newData: payload, performedBy: actorUid, performedByRole: actorRole
  })
  return ref.id
}

export async function getCashMovementsPage(candidateId, { cashAccountId = null, cursor = null, pageSize = 50 } = {}) {
  const clauses = []
  if (cashAccountId) clauses.push(where('cashAccountId', '==', cashAccountId))
  clauses.push(orderBy('createdAt', 'desc'))
  if (cursor) clauses.push(startAfter(cursor))
  clauses.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, ...candidatePath(candidateId, 'cashMovements')), ...clauses))
  return {
    movements: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  }
}

export async function getCashAccountBalance(candidateId, cashAccountId) {
  const { getAggregateFromServer, sum } = await import('firebase/firestore')
  const accSnap = await getDoc(doc(db, ...candidatePath(candidateId, 'cashAccounts', cashAccountId)))
  if (!accSnap.exists()) throw new Error('Cuenta de caja no encontrada.')
  const initial = Number(accSnap.data().initialBalance) || 0

  const sumaPorTipo = async (tipo) => {
    const snap = await getAggregateFromServer(
      query(
        collection(db, ...candidatePath(candidateId, 'cashMovements')),
        where('cashAccountId', '==', cashAccountId),
        where('type', '==', tipo)
      ),
      { total: sum('amount') }
    )
    return snap.data().total || 0
  }

  const [income, expense, adjustment, transferIn, transferOut] = await Promise.all([
    sumaPorTipo('income'), sumaPorTipo('expense'), sumaPorTipo('adjustment'),
    sumaPorTipo('transfer_in'), sumaPorTipo('transfer_out')
  ])
  return initial + income - expense + adjustment + transferIn - transferOut
}

export { CASH_MOVEMENT_TYPES }

// ── Reportes (Etapa 3) — todo bounded/agregado, nunca getAllX() ──────
export async function getFinancePaymentsSumByMethod(candidateId, paymentMethod) {
  const { getAggregateFromServer, sum } = await import('firebase/firestore')
  const snap = await getAggregateFromServer(
    query(
      collection(db, ...candidatePath(candidateId, 'financePayments')),
      where('status', '==', 'paid'),
      where('paymentMethod', '==', paymentMethod)
    ),
    { total: sum('amount') }
  )
  return snap.data().total || 0
}

export async function getFinancePaymentsWithoutReceiptList(candidateId, pageSize = 50) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'financePayments')),
    where('status', '==', 'paid'),
    where('receiptUrl', '==', null),
    limit(pageSize)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ═══════════════════════════════════════════════════════════════════
// Finanzas de Campaña — Etapa 4 (integración Día D + alertas).
//
// REGLA DURA del spec (sección 9): "el sistema NO debe pagar
// automáticamente solo porque exista una asignación". Las funciones
// getDiaDValidationFor*() de acá SOLO calculan señales para que el humano
// decida qué incluir — generateDiaDObligations() siempre crea la
// obligación en 'pending', nunca aprobada ni pagada, así que sigue
// pasando por el mismo circuito de aprobación de siempre (Etapa 1/2).
//
// NOTA IMPORTANTE sobre el roster de mesarios vs. cuentas de login: la
// colección `mesarios` (capacitación/proponente/pagos) y los usuarios con
// role='mesario' que operan Día D Control (asignados vía
// electionDayControl.assignedTableUserId, que guarda un uid) son DOS
// estructuras distintas en este modelo — no hay un campo que las cruce
// 1:1. Por eso la validación de "asistencia el Día D" para un mesario del
// roster se hace por coincidencia de local+mesa contra electionDayControl
// (proxy razonable, no una atribución perfecta por persona) combinada con
// si asistió a alguna capacitación — ambas señales quedan visibles por
// separado en la UI para que el admin las vea y decida, no se ocultan
// detrás de un solo booleano.
// ═══════════════════════════════════════════════════════════════════

export async function getDiaDValidationForDrivers(candidateId) {
  const [drivers, controls] = await Promise.all([getDrivers(candidateId), getAllElectionDayControl(candidateId)])
  return drivers.map(d => {
    const actividad = controls.filter(c => c.assignedDriverId === d.id)
    const traslados = actividad.filter(c => ['picked_up', 'arrived_polling_place', 'arrived_table', 'voted'].includes(c.status))
    return {
      id: d.id, nombre: d.nombre || '(sin nombre)', telefono: d.telefono || '',
      asignado: actividad.length > 0,
      actividadRegistrada: traslados.length > 0,
      trasladosRealizados: traslados.length,
      validado: actividad.length > 0 && traslados.length > 0
    }
  })
}

export async function getDiaDValidationForMesarios(candidateId) {
  const [mesarios, controls] = await Promise.all([getMesarios(candidateId), getAllElectionDayControl(candidateId)])
  return mesarios.map(m => {
    const capacitacionConfirmada = (m.capacitaciones || []).some(c => c.asistio)
    const actividadEnMesa = controls.filter(c => c.pollingPlace === m.local && c.tableNumber === m.mesa && ['arrived_table', 'voted'].includes(c.status))
    return {
      id: m.id, nombre: m.nombre || '(sin nombre)', telefono: m.telefono || '', local: m.local || '', mesa: m.mesa || '',
      capacitacionConfirmada,
      actividadEnMesa: actividadEnMesa.length > 0,
      votosConfirmadosEnMesa: actividadEnMesa.length,
      validado: capacitacionConfirmada || actividadEnMesa.length > 0
    }
  })
}

export async function getDiaDValidationForDirigentes(candidateId) {
  const [users, controls] = await Promise.all([getAllCandidateUsers(candidateId), getAllElectionDayControl(candidateId)])
  const dirigentes = users.filter(u => u.role === 'dirigente')
  return dirigentes.map(dg => {
    const asignados = controls.filter(c => c.assignedLeaderId === dg.id)
    const votosConfirmados = asignados.filter(c => c.status === 'voted')
    return {
      id: dg.id, nombre: dg.nombre || dg.email || '(sin nombre)',
      asignado: asignados.length > 0,
      participacionValidada: votosConfirmados.length > 0,
      votosConfirmados: votosConfirmados.length,
      validado: asignados.length > 0 && votosConfirmados.length > 0
    }
  })
}

// Votantes marcados con requiresPickup/needsAssistance en electionDayControl
// — candidatos naturales a "ayuda a votante", con vinculación a voterId ya
// garantizada (spec sección 9: "vinculación con voterId" es obligatoria).
export async function getVotersNeedingAssistanceForFinance(candidateId) {
  const controls = await getAllElectionDayControl(candidateId)
  const flagged = controls.filter(c => c.requiresPickup || c.needsAssistance)
  if (flagged.length === 0) return []
  const records = await getRecordsByIds(candidateId, flagged.map(c => c.voterId))
  return records.map(r => ({ ...r, control: flagged.find(c => c.voterId === r.id) }))
}

// Genera N obligaciones 'election_day' de una sola vez reutilizando
// createFinanceObligation (Etapa 1) — nunca reimplementa el alta.
export async function generateDiaDObligations(candidateId, items, actorUid, actorRole) {
  const created = []
  for (const item of items) {
    const id = await createFinanceObligation(candidateId, {
      beneficiaryType: item.beneficiaryType,
      beneficiaryUserId: item.beneficiaryUserId || null,
      beneficiaryVoterId: item.beneficiaryVoterId || null,
      beneficiaryName: item.beneficiaryName,
      beneficiaryDocument: item.beneficiaryDocument || '',
      beneficiaryPhone: item.beneficiaryPhone || '',
      concept: item.concept || 'Especial Día D',
      amount: item.amount,
      currency: 'PYG',
      frequency: 'election_day',
      relatedModule: 'dia-d',
      relatedDriverId: item.relatedDriverId || null,
      relatedTableUserId: item.relatedTableUserId || null,
      relatedLeaderId: item.relatedLeaderId || null,
      relatedVoterId: item.relatedVoterId || null,
      status: 'pending'
    }, actorUid, actorRole)
    created.push(id)
  }
  return created
}

// ── Alertas (Etapa 4, sección 15 del spec) ───────────────────────────
// Mismo patrón que electionDayAlerts (Día D Control): se calculan client-
// side sobre consultas acotadas y quedan persistidas, no es un listener
// permanente ni un cron — se recalculan cuando el admin abre el panel o
// toca "Actualizar alertas".
const FINANCE_ALERT_TYPES = [
  'overdue_obligation', 'obligation_pending_too_long', 'amount_above_threshold',
  'payment_without_receipt', 'incomplete_bank_data', 'multiple_payments_same_beneficiary'
]

export async function calculateFinanceAlerts(candidateId) {
  const alerts = []
  const settings = await getFinanceSettings(candidateId)
  const hoy = new Date().toISOString().slice(0, 10)
  const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  const { obligations } = await getFinanceObligationsPage(candidateId, { pageSize: 200 })

  obligations
    .filter(o => o.dueDate && o.dueDate < hoy && !['paid', 'cancelled', 'rejected'].includes(o.status))
    .forEach(o => alerts.push({
      type: 'overdue_obligation', severity: 'high',
      message: `Obligación de ${o.beneficiaryName} venció el ${o.dueDate} y sigue sin pagarse`,
      relatedEntityType: 'obligation', relatedEntityId: o.id
    }))

  obligations
    .filter(o => o.status === 'pending' && o.createdAt?.toDate && o.createdAt.toDate() < tresDiasAtras)
    .forEach(o => alerts.push({
      type: 'obligation_pending_too_long', severity: 'medium',
      message: `Obligación de ${o.beneficiaryName} lleva más de 3 días sin aprobarse`,
      relatedEntityType: 'obligation', relatedEntityId: o.id
    }))

  if (Number(settings.approvalThreshold) > 0) {
    obligations
      .filter(o => Number(o.amount) > Number(settings.approvalThreshold) && !['paid', 'cancelled', 'rejected'].includes(o.status))
      .forEach(o => alerts.push({
        type: 'amount_above_threshold', severity: 'medium',
        message: `Obligación de ${o.beneficiaryName} (${o.amount}) supera el umbral configurado (${settings.approvalThreshold})`,
        relatedEntityType: 'obligation', relatedEntityId: o.id
      }))
  }

  const sinComprobante = await getFinancePaymentsWithoutReceiptList(candidateId, 100)
  sinComprobante.forEach(p => alerts.push({
    type: 'payment_without_receipt', severity: 'medium',
    message: `Pago a ${p.beneficiaryName} (${p.amount}) está pagado pero sin comprobante adjunto`,
    relatedEntityType: 'payment', relatedEntityId: p.id
  }))

  const { payments } = await getFinancePaymentsPage(candidateId, { pageSize: 200 })
  payments
    .filter(p => p.paymentMethod === 'bank_transfer' && (!p.bankName || !p.accountOrWallet))
    .forEach(p => alerts.push({
      type: 'incomplete_bank_data', severity: 'low',
      message: `Pago a ${p.beneficiaryName} por transferencia sin banco/cuenta cargados`,
      relatedEntityType: 'payment', relatedEntityId: p.id
    }))

  const porBeneficiario = {}
  payments.forEach(p => { porBeneficiario[p.beneficiaryName] = (porBeneficiario[p.beneficiaryName] || 0) + 1 })
  Object.entries(porBeneficiario)
    .filter(([, n]) => n > 3)
    .forEach(([nombre, n]) => alerts.push({
      type: 'multiple_payments_same_beneficiary', severity: 'medium',
      message: `${nombre} tiene ${n} pagos registrados — revisar por posible duplicación`,
      relatedEntityType: 'beneficiary', relatedEntityId: nombre
    }))

  const abiertas = await getOpenFinanceAlerts(candidateId, 200)
  const yaExiste = (a) => abiertas.some(x => x.type === a.type && x.relatedEntityId === a.relatedEntityId)
  const nuevas = alerts.filter(a => !yaExiste(a))

  for (const a of nuevas) {
    await addDoc(collection(db, ...candidatePath(candidateId, 'financeAlerts')), {
      candidateId, ...a, status: 'open',
      createdAt: serverTimestamp(), resolvedAt: null, resolvedBy: null
    })
  }
  return { generadas: nuevas.length, totalAbiertas: abiertas.length + nuevas.length }
}

export async function getOpenFinanceAlerts(candidateId, pageSize = 100) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'financeAlerts')),
    where('status', '==', 'open'),
    limit(pageSize)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function resolveFinanceAlert(candidateId, alertId, actorUid) {
  await updateDoc(doc(db, ...candidatePath(candidateId, 'financeAlerts', alertId)), {
    status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: actorUid
  })
}

export { FINANCE_ALERT_TYPES }
// ── Logo de campaña (Firebase Storage) ───────────────────────────────
// Mismo criterio que financeReceipts: import dinámico de firebase/storage
// (nadie más en la app lo usa siempre), validación de formato/tamaño
// antes de subir. Reemplaza el campo logoUrl del candidato — no hace
// falta borrar el archivo viejo de Storage, cada subida usa un nombre
// con timestamp propio.
const LOGO_ALLOWED_TYPES = ['image/jpeg', 'image/png']
const LOGO_MAX_SIZE = 2 * 1024 * 1024
const LOGO_RECOMMENDED_SIZE = 180

export async function uploadCandidateLogo(candidateId, file) {
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Subí una imagen JPG o PNG.')
  }
  if (file.size > LOGO_MAX_SIZE) {
    throw new Error('El archivo supera el tamaño máximo permitido (2 MB).')
  }

  const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage')
  const storage = getStorage()
  const path = `candidates/${candidateId}/logo/${Date.now()}_${file.name}`
  const fileRef = storageRef(storage, path)
  await uploadBytes(fileRef, file)
  const downloadUrl = await getDownloadURL(fileRef)

  await updateDoc(doc(db, ...candidatePath(candidateId)), {
    logoUrl: downloadUrl,
    updatedAt: serverTimestamp()
  })

  return downloadUrl
}

// Borra la referencia en Firestore (siempre) y, best-effort, el archivo
// real en Storage (si se puede resolver desde la URL) — un fallo al
// borrar el archivo (Storage deshabilitado, ya no existe, etc.) no debe
// impedir que el candidato se quede sin logo.
export async function deleteCandidateLogo(candidateId, currentLogoUrl) {
  await updateDoc(doc(db, ...candidatePath(candidateId)), {
    logoUrl: '',
    updatedAt: serverTimestamp()
  })

  if (currentLogoUrl) {
    try {
      const { getStorage, ref: storageRef, deleteObject } = await import('firebase/storage')
      const storage = getStorage()
      await deleteObject(storageRef(storage, currentLogoUrl))
    } catch (err) {
      console.warn('No se pudo borrar el archivo de Storage (no crítico):', err.message)
    }
  }
}

export { LOGO_ALLOWED_TYPES, LOGO_MAX_SIZE, LOGO_RECOMMENDED_SIZE }
export { collectionGroup }

// ── Reportes Guardados (Etapa 4) — presets de filtro para Reportes >
// Registros. Escala de "decenas guardadas a mano", mismo criterio ya
// aceptado para getDrivers/getMesarios (lista sin filtro pero acotada).
export async function createReportPreset(candidateId, { nombre, eje, valor, createdBy, createdByName }) {
  return addDoc(collection(db, ...candidatePath(candidateId, 'reportPresets')), {
    candidateId, nombre, eje, valor, createdBy, createdByName,
    createdAt: serverTimestamp()
  })
}

export async function listReportPresets(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'reportPresets')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function deleteReportPreset(candidateId, id) {
  return deleteDoc(doc(db, ...candidatePath(candidateId, 'reportPresets', id)))
}
