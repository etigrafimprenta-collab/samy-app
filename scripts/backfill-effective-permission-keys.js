// Auditoría RBAC: computeEffectivePermissionKeys (src/lib/rolesCandidate.js)
// solo se ejecuta cuando alguien vuelve a tocar assignUserRoles/
// updateRolePermissions/setRoleActive — usuarios que ya tenían roleIds
// asignados de ANTES de este cambio se quedan con
// effectivePermissionKeys=undefined hasta que alguien los reasigne a
// mano. Este script recalcula ese campo para todos los usuarios de un
// candidato, una sola vez, reusando la MISMA lógica (getGrantedScopes) que
// ya usa el motor de permisos — no la reimplementa.
//
// Uso:
//   node scripts/backfill-effective-permission-keys.js candidato-test
//
// Por diseño solo corre contra el candidato que le pases como argumento —
// nunca "todos los candidatos" de una — para poder probar primero contra
// candidato-test antes de tocar un candidato real.

import { getDb } from './lib/adminApp.js'
import { getGrantedScopes } from '../src/lib/rbac.js'
import { PERMISSIONS } from '../src/lib/rbacCatalog.js'

const candidateId = process.argv[2]
if (!candidateId) {
  console.error('Uso: node scripts/backfill-effective-permission-keys.js <candidateId>')
  process.exit(1)
}

function computeEffectivePermissionKeys(roleDocs) {
  return PERMISSIONS
    .map(p => p.key)
    .filter(key => {
      const scopes = getGrantedScopes(roleDocs, key)
      return scopes.includes('all_candidate') || scopes.includes('all_platform')
    })
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
    const effectivePermissionKeys = computeEffectivePermissionKeys(misRoleDocs)
    await userDoc.ref.update({ effectivePermissionKeys })
    console.log(`  ${data.email || userDoc.id}: roleIds=${JSON.stringify(roleIds)} → effectivePermissionKeys=${JSON.stringify(effectivePermissionKeys)}`)
    actualizados++
  }
  console.log(`\n✅ Listo. ${actualizados} usuario(s) de "${candidateId}" actualizados.`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
