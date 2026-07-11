// Capa de datos de Roles y Permisos (candidato-scoped) — Etapa 2 del
// pedido (modelo Firestore). Vive separado de firebaseCandidate.js (que
// ya tiene 2400+ líneas) por ser un dominio propio, igual que
// candidateContext.js. Roles nuevos/custom se guardan acá; el campo
// `role` en users NO se toca todavía (Etapa 4 de la migración, sin
// confirmar aún) — esto convive con el sistema viejo sin romperlo.
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  addDoc, query, where, serverTimestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functionsInstance } from './firebase.js'
import { PERMISSIONS, SYSTEM_ROLE_NAMES } from './rbacCatalog.js'

function candidatePath(candidateId, ...rest) {
  return ['candidates', candidateId, ...rest]
}

export async function getRoles(candidateId) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'roles')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getRole(candidateId, roleId) {
  const snap = await getDoc(doc(db, ...candidatePath(candidateId, 'roles', roleId)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function createRole(candidateId, data, actorUid) {
  const ref = doc(collection(db, ...candidatePath(candidateId, 'roles')))
  const payload = {
    name: data.name || '',
    description: data.description || '',
    isSystemRole: false,
    isCustomRole: true,
    isActive: true,
    permissions: data.permissions || {},
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedBy: actorUid,
    updatedAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  await logRoleAudit(candidateId, {
    action: 'role_created', roleId: ref.id, targetUserId: null,
    previousData: null, newData: payload, performedBy: actorUid
  })
  return ref.id
}

export async function updateRolePermissions(candidateId, roleId, permissions, actorUid) {
  const ref = doc(db, ...candidatePath(candidateId, 'roles', roleId))
  const before = await getDoc(ref)
  await updateDoc(ref, { permissions, updatedBy: actorUid, updatedAt: serverTimestamp() })
  await logRoleAudit(candidateId, {
    action: 'permission_scope_changed', roleId, targetUserId: null,
    previousData: before.exists() ? before.data().permissions : null,
    newData: permissions, performedBy: actorUid
  })
}

export async function duplicateRole(candidateId, roleId, actorUid) {
  const original = await getRole(candidateId, roleId)
  if (!original) throw new Error('Rol no encontrado.')
  const ref = doc(collection(db, ...candidatePath(candidateId, 'roles')))
  const payload = {
    name: original.name + ' (copia)', description: original.description || '',
    isSystemRole: false, isCustomRole: true, isActive: true,
    permissions: original.permissions || {},
    createdBy: actorUid, createdAt: serverTimestamp(), updatedBy: actorUid, updatedAt: serverTimestamp()
  }
  await setDoc(ref, payload)
  await logRoleAudit(candidateId, {
    action: 'role_duplicated', roleId: ref.id, targetUserId: null,
    previousData: { sourceRoleId: roleId }, newData: payload, performedBy: actorUid
  })
  return ref.id
}

export async function setRoleActive(candidateId, roleId, isActive, actorUid) {
  const ref = doc(db, ...candidatePath(candidateId, 'roles', roleId))
  await updateDoc(ref, { isActive, updatedBy: actorUid, updatedAt: serverTimestamp() })
  await logRoleAudit(candidateId, {
    action: isActive ? 'role_enabled' : 'role_disabled', roleId, targetUserId: null,
    previousData: { isActive: !isActive }, newData: { isActive }, performedBy: actorUid
  })
}

export async function logRoleAudit(candidateId, { action, roleId, targetUserId, previousData, newData, performedBy, performedByRole = '', reason = '' }) {
  await addDoc(collection(db, ...candidatePath(candidateId, 'roleAuditLogs')), {
    candidateId, roleId: roleId || null, targetUserId: targetUserId || null,
    action, previousData: previousData ?? null, newData: newData ?? null,
    performedBy, performedByRole, reason, createdAt: serverTimestamp()
  })
}

export async function getRoleAuditLogs(candidateId, roleId, pageSize = 50) {
  const q = query(
    collection(db, ...candidatePath(candidateId, 'roleAuditLogs')),
    where('roleId', '==', roleId)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, pageSize)
}

// Vista general de auditoría (pestaña "Auditoría" del módulo, no una
// obligación puntual) — trae las últimas N sin filtrar por rol.
export async function getAllRoleAuditLogs(candidateId, pageSize = 100) {
  const snap = await getDocs(collection(db, ...candidatePath(candidateId, 'roleAuditLogs')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .slice(0, pageSize)
}

// ── Siembra de roles del sistema (Etapa 2) ───────────────────────────
// Construye, para cada rol legacy, un mapa de permisos que reproduce
// EXACTAMENTE lo que ese rol ya puede hacer hoy (auditoría Etapa 0) — no
// la lista aspiracional del pedido. campaign_admin/coordinator quedan en
// all_candidate por ser roles de administración total/operativa; los
// roles de piso (dirigente/chofer/mesario/operador) quedan acotados a los
// alcances que YA aplican en la práctica vía firestore.rules
// (own/assigned/table). Idempotente: si el rol ya existe (mismo id =
// nombre del rol legacy) actualiza sus permisos en vez de duplicar.
function permMap(entries) {
  const out = {}
  entries.forEach(([key, allowed, scope]) => { out[key] = { allowed, scope: allowed ? scope : 'none' } })
  return out
}

function buildSystemRolePermissions() {
  const allKeys = PERMISSIONS.map(p => p.key)
  const allow = (keys, scope) => keys.map(k => [k, true, scope])
  const allAllowed = (scope) => permMap(allow(allKeys, scope))

  const map = {}

  map.campaign_admin = allAllowed('all_candidate')

  map.coordinator = permMap([
    ...allow(['dashboard.view'], 'all_candidate'),
    ...allow(['search_voter.view', 'search_voter.create'], 'all_candidate'),
    ...allow(['my_records.view', 'my_records.edit'], 'own'),
    // records.edit queda afuera a propósito: hoy solo campaign_admin puede
    // editar cualquier registro desde Registros (puedeEditarReg en
    // campaign.js) — coordinator solo ve/exporta.
    ...allow(['records.view', 'records.export'], 'all_candidate'),
    ...allow(['drivers.view', 'drivers.create', 'drivers.edit', 'drivers.delete'], 'all_candidate'),
    ...allow(['table_members.view', 'table_members.create', 'table_members.edit', 'table_members.delete'], 'all_candidate'),
    ...allow(['leaders.view', 'leaders.edit_role', 'leaders.delete'], 'all_candidate'),
    ...allow(['operators.view', 'operators.create', 'operators.manage_payment', 'operators.delete'], 'all_candidate'),
    ...allow(['contact_center.view', 'contact_center.call', 'contact_center.assign_voters', 'contact_center.update_status', 'contact_center.create_followup', 'contact_center.configure'], 'all_candidate'),
    ...allow(['election_day_admin.view_dashboard'], 'all_candidate'),
    ...allow(['election_day_control.view_operations', 'election_day_control.update_status', 'election_day_control.confirm_vote', 'election_day_control.assign_driver', 'election_day_control.assign_leader', 'election_day_control.assign_table_member', 'election_day_control.create_incident', 'election_day_control.configure'], 'all_candidate')
  ])

  map.dirigente = permMap([
    ...allow(['dashboard.view'], 'own'),
    ...allow(['search_voter.view', 'search_voter.create'], 'own'),
    ...allow(['my_records.view', 'my_records.edit'], 'own'),
    ...allow(['election_day_control.view_operations', 'election_day_control.update_status', 'election_day_control.confirm_vote', 'election_day_control.create_incident'], 'assigned')
  ])

  map.chofer = permMap([
    ...allow(['dashboard.view'], 'assigned'),
    ...allow(['election_day_control.view_operations', 'election_day_control.update_status', 'election_day_control.create_incident'], 'assigned')
  ])

  map.mesario = permMap([
    ...allow(['dashboard.view'], 'table'),
    ...allow(['search_voter.view'], 'table'),
    ...allow(['election_day_control.view_operations', 'election_day_control.update_status', 'election_day_control.confirm_vote', 'election_day_control.create_incident'], 'table')
  ])

  map.operador = permMap([
    ...allow(['dashboard.view'], 'assigned'),
    ...allow(['contact_center.view', 'contact_center.call', 'contact_center.update_status', 'contact_center.create_followup'], 'assigned')
  ])

  map.viewer = permMap([
    ...allow(['dashboard.view'], 'all_candidate'),
    ...allow(['records.view'], 'all_candidate')
  ])

  map.auditor = permMap([
    ...allow(['dashboard.view'], 'all_candidate'),
    ...allow(['records.view'], 'all_candidate'),
    ...allow(['audit.view'], 'all_candidate'),
    ...allow(['finance.view', 'finance.view_cash', 'finance.view_audit'], 'all_candidate'),
    ...allow(['roles.view_audit'], 'all_candidate')
  ])

  // NOTA: los 3 roles financieros NO tienen dashboard.view hoy — TAB_ROLES
  // .resumen en campaign.js no los incluye (solo ven la pestaña Finanzas,
  // no el Resumen general de campaña). Confirmado contra el sistema
  // real durante la verificación de esta etapa — no es un permiso
  // aspiracional, es la ausencia real de acceso hoy.
  map.finance_admin = permMap([
    ...allow(['finance.view', 'finance.create_obligation', 'finance.edit_obligation', 'finance.approve', 'finance.reject', 'finance.pay', 'finance.reverse_payment', 'finance.view_cash', 'finance.manage_cash', 'finance.upload_receipt', 'finance.view_audit', 'finance.export', 'finance.configure'], 'all_candidate')
  ])

  map.finance_operator = permMap([
    ...allow(['finance.view', 'finance.create_obligation', 'finance.edit_obligation', 'finance.upload_receipt'], 'all_candidate'),
    ['finance.approve', false, 'none'],
    ['finance.pay', false, 'none']
  ])

  map.cashier = permMap([
    ...allow(['finance.view', 'finance.pay', 'finance.view_cash', 'finance.upload_receipt'], 'all_candidate'),
    ['finance.approve', false, 'none']
  ])

  return map
}

// Idempotente y acotado a un candidato por vez (por defecto se corre
// primero contra candidato-test para verificar, nunca contra producción
// sin confirmación explícita — ver instrucción del usuario).
export async function seedSystemRoles(candidateId, actorUid) {
  const map = buildSystemRolePermissions()
  const creados = []
  for (const [roleKey, permissions] of Object.entries(map)) {
    const ref = doc(db, ...candidatePath(candidateId, 'roles', roleKey))
    const existing = await getDoc(ref)
    const payload = {
      name: SYSTEM_ROLE_NAMES[roleKey] || roleKey,
      description: `Rol del sistema (equivalente al rol legacy "${roleKey}")`,
      isSystemRole: true,
      isCustomRole: false,
      isActive: true,
      legacyRoleKey: roleKey,
      permissions,
      updatedBy: actorUid,
      updatedAt: serverTimestamp()
    }
    if (existing.exists()) {
      await updateDoc(ref, payload)
    } else {
      await setDoc(ref, { ...payload, createdBy: actorUid, createdAt: serverTimestamp() })
    }
    creados.push(roleKey)
  }
  return creados
}

export { buildSystemRolePermissions }

// ── Asignación de roles a usuarios (Etapa 5) ─────────────────────────
// El campo legacy `users.role` (string) sigue siendo lo único que el
// menú/reglas viejas leen hoy. Esta función agrega roleIds/primaryRoleId/
// alcance como campos NUEVOS y ADITIVOS — y si el rol principal elegido
// es un rol de sistema (tiene legacyRoleKey), sincroniza `role` llamando
// a la Cloud Function de siempre (cambiarRolUsuarioCandidato), que ya
// valida auto-elevación y deja auditoría en auditLogs. Si el rol
// principal es personalizado, NO hay forma de sincronizar `role` — se
// devuelve una advertencia explícita en vez de fallar en silencio, para
// que quien lo usa sepa que ese usuario no va a ver nada nuevo en el
// menú hasta que el menú mismo se migre (próxima etapa).
export async function assignUserRoles(candidateId, targetUid, data, actorUid, actorRole) {
  if (targetUid === actorUid) {
    throw new Error('No podés asignarte roles a vos mismo — pedile a otro administrador que lo haga.')
  }
  const { roleIds = [], primaryRoleId = null, zoneIds = [], pollingPlaceIds = [], tableIds = [], leaderId = null, teamId = null } = data

  const targetRef = doc(db, ...candidatePath(candidateId, 'users', targetUid))
  const before = await getDoc(targetRef)
  if (!before.exists()) throw new Error('Usuario no encontrado.')
  const beforeData = before.data()

  const rolesDisponibles = await getRoles(candidateId)
  const rolPrincipal = rolesDisponibles.find(r => r.id === primaryRoleId)

  let legacySincronizado = false
  if (rolPrincipal?.legacyRoleKey && rolPrincipal.legacyRoleKey !== beforeData.role) {
    const cambiarRol = httpsCallable(functionsInstance, 'cambiarRolUsuarioCandidato')
    await cambiarRol({ candidateId, uid: targetUid, newRole: rolPrincipal.legacyRoleKey })
    legacySincronizado = true
  }

  await updateDoc(targetRef, {
    roleIds, primaryRoleId, zoneIds, pollingPlaceIds, tableIds, leaderId, teamId,
    updatedAt: serverTimestamp()
  })

  await logRoleAudit(candidateId, {
    action: 'user_role_assigned', roleId: primaryRoleId, targetUserId: targetUid,
    previousData: { roleIds: beforeData.roleIds || null, primaryRoleId: beforeData.primaryRoleId || null },
    newData: { roleIds, primaryRoleId, zoneIds, pollingPlaceIds, tableIds, leaderId, teamId },
    performedBy: actorUid, performedByRole: actorRole
  })

  return {
    legacySincronizado,
    advertencia: !rolPrincipal?.legacyRoleKey
      ? 'El rol principal es personalizado — el menú actual (que todavía depende del campo "role" viejo) no va a reflejar este cambio hasta que se migre el menú a permisos dinámicos.'
      : null
  }
}
