// Motor central de autorización (RBAC) — Etapa 3 del pedido, "can() /
// canWithScope()". Ningún módulo debería volver a escribir
// `['a','b'].includes(myRole)` a mano después de esto — por ahora este
// motor se agrega EN PARALELO al sistema viejo (que sigue intacto) y se
// va adoptando módulo por módulo en etapas posteriores, ya confirmadas
// con el usuario (no se toca el menú ni las reglas todavía).
import { SCOPE_RANK } from './rbacCatalog.js'

// Combina los permisos de N roles para una permissionKey puntual.
//
// Regla (sección 10 del pedido): los permisos permitidos se ACUMULAN
// entre roles; la denegación EXPRESA (allowed:false guardado a propósito
// en algún rol) prevalece sobre cualquier acumulación de otro rol que sí
// lo permita. Nunca se colapsa a un solo "alcance ganador" con una
// comparación numérica simple — se devuelven TODOS los alcances
// otorgados, porque el pedido advierte explícitamente que polling_place
// y table no son comparables entre sí ni con team/zone de forma lineal;
// colapsarlos a uno solo perdería información real (ver canWithScope).
export function getGrantedScopes(roleDocs, permissionKey) {
  const entries = (roleDocs || [])
    .filter(r => r?.isActive !== false)
    .map(r => r?.permissions?.[permissionKey])
    .filter(Boolean)

  if (entries.some(e => e.allowed === false)) return []

  const scopes = new Set(
    entries.filter(e => e.allowed === true).map(e => e.scope || 'none').filter(s => s !== 'none')
  )
  return [...scopes]
}

export function can(roleDocs, permissionKey) {
  return getGrantedScopes(roleDocs, permissionKey).length > 0
}

export function hasAnyPermission(roleDocs, permissionKeys) {
  return permissionKeys.some(k => can(roleDocs, k))
}

export function hasAllPermissions(roleDocs, permissionKeys) {
  return permissionKeys.every(k => can(roleDocs, k))
}

// matchers: { own, assigned, team, zone, polling_place, table } — cada
// uno una función (resource) => boolean que evalúa si el recurso cae en
// ESE alcance para el usuario actual. all_candidate/all_platform no
// necesitan matcher: si están otorgados, siempre pasan sin evaluar el
// recurso (por diseño, ese es justamente su significado).
export function canWithScope(roleDocs, permissionKey, resource, matchers = {}) {
  const scopes = getGrantedScopes(roleDocs, permissionKey)
  if (scopes.length === 0) return false
  if (scopes.includes('all_platform') || scopes.includes('all_candidate')) return true
  return scopes.some(scope => {
    const matcher = matchers[scope]
    return typeof matcher === 'function' ? !!matcher(resource) : false
  })
}

// Uso exclusivo para UI (mostrar UNA etiqueta de alcance en pantalla) —
// nunca para decidir acceso real a un recurso puntual, para eso está
// canWithScope, que evalúa todos los alcances otorgados, no solo el
// "más amplio".
export function getPermissionScope(roleDocs, permissionKey) {
  const scopes = getGrantedScopes(roleDocs, permissionKey)
  if (scopes.length === 0) return 'none'
  return scopes.reduce((best, s) => (SCOPE_RANK[s] ?? -1) > (SCOPE_RANK[best] ?? -1) ? s : best, scopes[0])
}

// Atajo genérico para "¿este recurso puntual cae dentro de ESTE alcance
// ya resuelto?" — sección 9 del pedido. opts trae el contexto propio del
// actor (driverId si es chofer, teamId/zoneId/pollingPlace/mesa si
// aplican) para comparar contra los campos del recurso.
export function canAccessRecord(actorUid, resource, scope, opts = {}) {
  switch (scope) {
    case 'all_platform':
    case 'all_candidate':
      return true
    case 'own':
      return resource?.uid === actorUid || resource?.createdBy === actorUid
    case 'assigned':
      return resource?.assignedUserId === actorUid ||
        resource?.assignedLeaderId === actorUid ||
        resource?.assignedTableUserId === actorUid ||
        (opts.driverId && resource?.assignedDriverId === opts.driverId)
    case 'team':
      return !!opts.teamId && resource?.teamId === opts.teamId
    case 'zone':
      return !!opts.zoneId && resource?.zoneId === opts.zoneId
    case 'polling_place':
      return !!opts.pollingPlace && resource?.local === opts.pollingPlace
    case 'table':
      return !!opts.pollingPlace && !!opts.mesa && resource?.local === opts.pollingPlace && resource?.mesa === opts.mesa
    default:
      return false
  }
}
