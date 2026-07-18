// Auditoría RBAC (scopes restringidos): computeScopedPermissions
// (src/lib/rolesCandidate.js) solo se ejecuta cuando alguien vuelve a
// tocar assignUserRoles/updateRolePermissions/setRoleActive — usuarios
// que ya tenían roleIds asignados de ANTES de este cambio (o del cambio
// anterior, effectivePermissionKeys) se quedan sin scopedPermissions
// hasta que alguien los reasigne a mano. Este script recalcula ese campo
// para todos los usuarios de un candidato, una sola vez, reusando la
// MISMA lógica (getGrantedScopes) que ya usa el motor de permisos — no la
// reimplementa. Importa solo funciones puras (rbac.js/rbacCatalog.js, sin
// dependencias de Firebase client SDK) para no inicializar una app
// cliente en un script que solo necesita Admin SDK.
//
// Reemplaza a backfill-effective-permission-keys.js (campo viejo,
// effectivePermissionKeys, solo alcance amplio) — ese campo queda
// obsoleto y sin uso; firestore.rules ya no lo lee.
//
// Uso:
//   node scripts/backfill-scoped-permissions.js candidato-test
//
// Por diseño solo corre contra el candidato que le pases como argumento —
// nunca "todos los candidatos" de una — para poder probar primero contra
// candidato-test antes de tocar un candidato real.

import { getDb } from './lib/adminApp.js'
import { getGrantedScopes } from '../src/lib/rbac.js'
import { PERMISSIONS } from '../src/lib/rbacCatalog.js'

const candidateId = process.argv[2]
if (!candidateId) {
  console.error('Uso: node scripts/backfill-scoped-permissions.js <candidateId>')
  process.exit(1)
}

function computeScopedPermissions(roleDocs) {
  const out = {}
  for (const key of PERMISSIONS.map(p => p.key)) {
    const scopes = getGrantedScopes(roleDocs, key)
    if (scopes.length > 0) out[key] = scopes
  }
  return out
}

async function main() {
  const db = getDb()
  const rolesSnap = await db.collection('candidates').doc(candidateId).collection('roles').get()
  const allRoles = rolesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  const usersSnap = await db.collection('candidates').doc(candidateId).collection('users').get()
  let actualizados = 0
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data()
    const roleIds = data.roleIds || []
    if (roleIds.length === 0) continue
    const misRoleDocs = allRoles.filter(r => roleIds.includes(r.id))
    const scopedPermissions = computeScopedPermissions(misRoleDocs)
    await userDoc.ref.update({ scopedPermissions })
    console.log(`  ${data.email || userDoc.id}: roleIds=${JSON.stringify(roleIds)} → scopedPermissions=${JSON.stringify(scopedPermissions)}`)
    actualizados++
  }
  console.log(`\n✅ Listo. ${actualizados} usuario(s) de "${candidateId}" actualizados.`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
