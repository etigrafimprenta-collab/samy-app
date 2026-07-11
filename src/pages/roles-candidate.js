/**
 * MÓDULO: ROLES Y PERMISOS (candidato-scoped) — Etapa 4 de la migración
 * RBAC (ver auditoría/entregables de Etapas 0-3 en el chat).
 *
 * Este módulo es 100% aditivo: lee y edita candidates/{candidateId}/roles,
 * pero el campo legacy `users.role` (string) sigue siendo la única fuente
 * real de qué puede hacer un usuario hoy — nada de lo que se edite acá
 * tiene efecto en el sistema viejo todavía. Asignar roles NUEVOS/custom a
 * usuarios llega en la Etapa 5 (requiere migrar users.role a un array de
 * roleIds, y a que las Cloud Functions de cambio de rol acepten roleIds
 * en vez de un string fijo). Por eso la pestaña "Usuarios por rol" es de
 * SOLO LECTURA: cuenta cuántos usuarios tienen cada rol legacy hoy, y
 * deja explícito que los roles personalizados todavía no se pueden
 * asignar — no se finge una función que no existe.
 */
import {
  getRoles,
  createRole,
  updateRolePermissions,
  duplicateRole,
  setRoleActive,
  getAllRoleAuditLogs,
  assignUserRoles
} from '../lib/rolesCandidate.js'
import { getAllCandidateUsers } from '../lib/firebaseCandidate.js'
import { MODULES, PERMISSIONS, SCOPES } from '../lib/rbacCatalog.js'
import { escapeHtml } from '../lib/escapeHtml.js'

const TABS = [
  { id: 'roles', label: '🔑 Roles' },
  { id: 'usuarios-por-rol', label: '👥 Usuarios por rol' },
  { id: 'catalogo', label: '📚 Catálogo de permisos' },
  { id: 'auditoria', label: '🕵️ Auditoría' }
]

export async function renderRolesCandidate(container, candidateId, user, myRole) {
  let tab = 'roles'
  let roles = []
  let usuarios = []

  async function cargarDatos() {
    const [r, u] = await Promise.all([getRoles(candidateId), getAllCandidateUsers(candidateId)])
    roles = r
    usuarios = u
  }

  function render() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #4527a0 0%, #311b92 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed', sans-serif; font-size: 2rem; text-transform: uppercase;">🔐 ROLES Y PERMISOS</h2>
        <p style="margin: 6px 0 0 0; font-size: .82rem; opacity: .9;">Motor nuevo en paralelo — el sistema de roles actual sigue activo e intacto</p>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:16px 20px 0;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:2px solid #eee; padding-bottom:10px;">
          ${TABS.map(t => `<button class="rp-tab" data-tab="${t.id}" style="padding:8px 14px; border:none; border-radius:6px 6px 0 0; cursor:pointer; font-weight:600; font-size:.82rem; background:${tab === t.id ? '#4527a0' : '#f0f0f0'}; color:${tab === t.id ? 'white' : '#333'};">${t.label}</button>`).join('')}
        </div>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px; padding:20px;">
        <div id="rp-body">Cargando...</div>
      </div>
    `
    container.querySelectorAll('.rp-tab').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })
    pintarTab()
  }

  function pintarTab() {
    const body = document.getElementById('rp-body')
    if (tab === 'roles') return pintarRoles(body)
    if (tab === 'usuarios-por-rol') return pintarUsuariosPorRol(body)
    if (tab === 'catalogo') return pintarCatalogo(body)
    if (tab === 'auditoria') return pintarAuditoria(body)
  }

  // ── ROLES ─────────────────────────────────────────────────────────────
  function contarUsuarios(role) {
    const key = role.legacyRoleKey || role.id
    return usuarios.filter(u => u.role === key).length
  }

  function modulosHabilitados(role) {
    const modKeys = new Set()
    Object.entries(role.permissions || {}).forEach(([permKey, entry]) => {
      if (entry?.allowed) {
        const perm = PERMISSIONS.find(p => p.key === permKey)
        if (perm) modKeys.add(perm.module)
      }
    })
    return [...modKeys]
  }

  function pintarRoles(body) {
    body.innerHTML = `
      <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
        <button id="rp-btn-nuevo-rol" style="background:#4527a0; color:white; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:700;">➕ Nuevo rol personalizado</button>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Nombre</th><th>Descripción</th><th>Usuarios</th><th>Módulos habilitados</th><th>Estado</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${roles.length === 0 ? `<tr><td colspan="6" style="padding:30px; text-align:center; color:#999;">Sin roles todavía.</td></tr>` : roles.map(r => `
              <tr style="border-bottom:1px solid #eee; ${r.isActive === false ? 'opacity:.5;' : ''}" data-id="${r.id}">
                <td style="padding:6px;"><strong>${escapeHtml(r.name)}</strong>${r.isSystemRole ? ' <span style="font-size:.68rem; color:#999;">(sistema)</span>' : ' <span style="font-size:.68rem; color:#4527a0;">(personalizado)</span>'}</td>
                <td style="font-size:.78rem; color:#666;">${escapeHtml(r.description) || '—'}</td>
                <td style="text-align:center; font-weight:700;">${contarUsuarios(r)}</td>
                <td style="font-size:.75rem;">${modulosHabilitados(r).length} de ${MODULES.length}</td>
                <td>${r.isActive === false ? '<span style="color:#999;">⚪ Inactivo</span>' : '<span style="color:#2e7d32;">🟢 Activo</span>'}</td>
                <td>
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <button class="rp-btn-editar" data-id="${r.id}" style="background:#1976d2; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">✏️ Editar</button>
                    <button class="rp-btn-duplicar" data-id="${r.id}" style="background:#455a64; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">📄 Duplicar</button>
                    ${!r.isSystemRole ? `<button class="rp-btn-toggle" data-id="${r.id}" style="background:${r.isActive === false ? '#2e7d32' : '#c62828'}; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">${r.isActive === false ? '✅ Activar' : '⛔ Desactivar'}</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    document.getElementById('rp-btn-nuevo-rol').addEventListener('click', () => mostrarModalEditorRol(null))
    body.querySelectorAll('.rp-btn-editar').forEach(btn => btn.addEventListener('click', () => {
      mostrarModalEditorRol(roles.find(r => r.id === btn.dataset.id))
    }))
    body.querySelectorAll('.rp-btn-duplicar').forEach(btn => btn.addEventListener('click', async () => {
      try { await duplicateRole(candidateId, btn.dataset.id, user.uid); await cargarDatos(); pintarTab() }
      catch (err) { alert('Error: ' + err.message) }
    }))
    body.querySelectorAll('.rp-btn-toggle').forEach(btn => btn.addEventListener('click', async () => {
      const r = roles.find(x => x.id === btn.dataset.id)
      const nuevoEstado = r.isActive === false
      if (!confirm(`¿${nuevoEstado ? 'Activar' : 'Desactivar'} el rol "${r.name}"?`)) return
      try { await setRoleActive(candidateId, r.id, nuevoEstado, user.uid); await cargarDatos(); pintarTab() }
      catch (err) { alert('Error: ' + err.message) }
    }))
  }

  // ── EDITOR DE ROL (modal) ────────────────────────────────────────────
  function mostrarModalEditorRol(role) {
    const esNuevo = !role
    const permisosActuales = role ? { ...role.permissions } : {}

    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 720px; width: 100%; padding: 24px; margin: 20px auto;">
        <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.4rem; text-transform: uppercase; color: #4527a0;">${esNuevo ? '➕ NUEVO ROL' : '✏️ EDITAR: ' + escapeHtml(role.name)}</h2>
        ${esNuevo ? `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
            <input id="rp-nombre" placeholder="Nombre del rol" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <input id="rp-descripcion" placeholder="Descripción" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          </div>
        ` : role.isSystemRole ? `<p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px;">Este es un rol del sistema (equivalente al rol legacy "${escapeHtml(role.legacyRoleKey)}"). Podés ajustar sus permisos acá, pero recordá que el sistema viejo (menú, botones, reglas de Firestore) todavía no lee estos valores — este editor es para preparar la migración, no cambia el comportamiento real todavía.</p>` : ''}

        <div id="rp-modulos" style="max-height:420px; overflow-y:auto; border:1px solid #eee; border-radius:6px; padding:10px;"></div>

        <div id="rp-editor-msg" style="font-size:.85rem; margin-top:12px;"></div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button id="rp-btn-guardar" style="flex:1; background:#4527a0; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">💾 Guardar</button>
          <button id="rp-btn-cancelar" style="flex:1; background:#ccc; color:#333; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    const modulosEl = modal.querySelector('#rp-modulos')
    modulosEl.innerHTML = MODULES.map(mod => {
      const permisosDelModulo = PERMISSIONS.filter(p => p.module === mod.key)
      if (permisosDelModulo.length === 0) return ''
      return `
        <div style="margin-bottom:14px; border-bottom:1px solid #eee; padding-bottom:10px;">
          <div style="font-weight:700; font-size:.88rem; margin-bottom:6px;">${mod.icon} ${escapeHtml(mod.name)}</div>
          ${permisosDelModulo.map(p => {
            const actual = permisosActuales[p.key] || { allowed: false, scope: 'none' }
            return `
            <div style="display:flex; align-items:center; gap:8px; padding:3px 0; flex-wrap:wrap;">
              <label style="display:flex; align-items:center; gap:6px; flex:1; min-width:220px; font-size:.8rem;">
                <input type="checkbox" class="rp-perm-check" data-perm="${p.key}" ${actual.allowed ? 'checked' : ''}>
                ${escapeHtml(p.name)}${p.planned ? ' <span style="color:#999; font-size:.68rem;">(planeado)</span>' : ''}
              </label>
              <select class="rp-perm-scope" data-perm="${p.key}" style="padding:4px; border:1px solid #ccc; border-radius:4px; font-size:.76rem;" ${!actual.allowed ? 'disabled' : ''}>
                ${SCOPES.map(s => `<option value="${s.key}" ${actual.scope === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </div>`
          }).join('')}
        </div>
      `
    }).join('')

    modulosEl.querySelectorAll('.rp-perm-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const scopeSel = modulosEl.querySelector(`.rp-perm-scope[data-perm="${chk.dataset.perm}"]`)
        scopeSel.disabled = !chk.checked
        if (chk.checked && scopeSel.value === 'none') scopeSel.value = 'own'
      })
    })

    modal.querySelector('#rp-btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#rp-btn-guardar').addEventListener('click', async () => {
      const msg = modal.querySelector('#rp-editor-msg')
      const permissions = {}
      modulosEl.querySelectorAll('.rp-perm-check').forEach(chk => {
        const scopeSel = modulosEl.querySelector(`.rp-perm-scope[data-perm="${chk.dataset.perm}"]`)
        permissions[chk.dataset.perm] = { allowed: chk.checked, scope: chk.checked ? scopeSel.value : 'none' }
      })

      try {
        if (esNuevo) {
          const nombre = modal.querySelector('#rp-nombre').value.trim()
          if (!nombre) { msg.innerHTML = '<span style="color:#c62828;">El nombre es obligatorio.</span>'; return }
          await createRole(candidateId, {
            name: nombre,
            description: modal.querySelector('#rp-descripcion').value.trim(),
            permissions
          }, user.uid)
        } else {
          await updateRolePermissions(candidateId, role.id, permissions, user.uid)
        }
        modal.remove()
        await cargarDatos()
        pintarTab()
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }

  // ── USUARIOS POR ROL ──────────────────────────────────────────────────
  function pintarUsuariosPorRol(body) {
    body.innerHTML = `
      <h3 style="margin:0 0 10px; font-size:.9rem;">Resumen por rol (según el campo legacy hoy)</h3>
      <div style="overflow-x:auto; margin-bottom:24px;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Rol</th><th>Usuarios asignados</th><th>Tipo</th></tr></thead>
          <tbody>
            ${roles.map(r => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;"><strong>${escapeHtml(r.name)}</strong></td>
                <td style="font-weight:700;">${contarUsuarios(r)}</td>
                <td>${r.isSystemRole ? 'Sistema' : '<span style="color:#4527a0;">Personalizado</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h3 style="margin:0 0 10px; font-size:.9rem;">Asignación por usuario (roleIds — RBAC nuevo)</h3>
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">
        💡 Esto guarda <code>roleIds</code>/alcance como campos nuevos, en paralelo al <code>role</code> legacy. Si el rol principal que elegís es uno de sistema, se sincroniza automáticamente el <code>role</code> viejo — así el menú actual sigue funcionando.
      </p>
      <p style="font-size:.8rem; color:#c62828; background:#ffebee; border-left:4px solid #c62828; padding:8px 10px; border-radius:4px; margin:0 0 14px;">
        ⚠️ <strong>Importante — todavía no asignar roles adicionales a usuarios reales.</strong> El menú ya lee <code>roleIds</code> (modo compatibilidad, Etapa 6), pero las reglas de Firestore (Etapa 8, pendiente) todavía validan acceso a los datos por el <code>role</code> legacy únicamente. Si a alguien le agregás un rol extra que le abre una pestaña nueva en el menú, esa pestaña le va a quedar cargando indefinidamente (sin datos, sin crash) porque Firestore le va a seguir negando la lectura. Usar esta pantalla solo contra <code>candidato-test</code> hasta que se migren las reglas.
      </p>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Usuario</th><th>Rol legacy</th><th>roleIds asignados</th><th>Acciones</th></tr></thead>
          <tbody>
            ${usuarios.map(u => `
              <tr style="border-bottom:1px solid #eee;" data-uid="${u.id}">
                <td style="padding:6px;"><strong>${escapeHtml(u.nombre || u.email)}</strong><br><span style="color:#999; font-size:.72rem;">${escapeHtml(u.email)}</span></td>
                <td>${escapeHtml(u.role) || '—'}</td>
                <td style="font-size:.78rem;">${(u.roleIds || []).length > 0 ? u.roleIds.map(rid => escapeHtml(roles.find(r => r.id === rid)?.name || rid)).join(', ') : '<span style="color:#999;">Sin migrar</span>'}</td>
                <td><button class="rp-btn-asignar-usuario" data-uid="${u.id}" style="background:#4527a0; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem;">🔧 Asignar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    body.querySelectorAll('.rp-btn-asignar-usuario').forEach(btn => btn.addEventListener('click', () => {
      mostrarModalAsignarUsuario(usuarios.find(u => u.id === btn.dataset.uid))
    }))
  }

  function mostrarModalAsignarUsuario(targetUser) {
    if (targetUser.id === user.uid) {
      alert('No podés asignarte roles a vos mismo — pedile a otro administrador que lo haga.')
      return
    }
    const rolesActivos = roles.filter(r => r.isActive !== false)
    const roleIdsActuales = targetUser.roleIds || []
    const primaryActual = targetUser.primaryRoleId || roles.find(r => r.legacyRoleKey === targetUser.role)?.id || ''

    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 520px; width: 100%; padding: 24px; margin: 20px auto;">
        <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.4rem; text-transform: uppercase; color: #4527a0;">🔧 ASIGNAR ROLES: ${escapeHtml(targetUser.nombre || targetUser.email)}</h2>
        <div style="margin-bottom:14px;">
          <label style="font-weight:700; display:block; margin-bottom:6px; font-size:.85rem;">Roles asignados:</label>
          <div style="display:grid; gap:4px; max-height:180px; overflow-y:auto; border:1px solid #eee; border-radius:6px; padding:8px;">
            ${rolesActivos.map(r => `
              <label style="display:flex; align-items:center; gap:8px; font-size:.85rem;">
                <input type="checkbox" class="rp-check-rol" value="${r.id}" ${roleIdsActuales.includes(r.id) || r.legacyRoleKey === targetUser.role ? 'checked' : ''}>
                ${escapeHtml(r.name)}${r.isSystemRole ? '' : ' <span style="color:#4527a0; font-size:.7rem;">(personalizado)</span>'}
              </label>
            `).join('')}
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Rol principal:</label>
          <select id="rp-sel-principal" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
            ${rolesActivos.map(r => `<option value="${r.id}" ${primaryActual === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
          <div><label style="font-weight:700; display:block; margin-bottom:4px; font-size:.8rem;">Zona:</label>
            <input id="rp-zona" value="${escapeHtml((targetUser.zoneIds || [])[0] || '')}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px; font-size:.8rem;">Equipo:</label>
            <input id="rp-equipo" value="${escapeHtml(targetUser.teamId || '')}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px; font-size:.8rem;">Local:</label>
            <input id="rp-local" value="${escapeHtml((targetUser.pollingPlaceIds || [])[0] || '')}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px; font-size:.8rem;">Mesa:</label>
            <input id="rp-mesa" value="${escapeHtml((targetUser.tableIds || [])[0] || '')}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>
        </div>
        <div id="rp-asignar-msg" style="font-size:.85rem; margin-bottom:10px;"></div>
        <div style="display:flex; gap:8px;">
          <button id="rp-btn-guardar-asignacion" style="flex:1; background:#4527a0; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">💾 Guardar</button>
          <button id="rp-btn-cancelar-asignacion" style="flex:1; background:#ccc; color:#333; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#rp-btn-cancelar-asignacion').addEventListener('click', () => modal.remove())
    modal.querySelector('#rp-btn-guardar-asignacion').addEventListener('click', async () => {
      const msg = modal.querySelector('#rp-asignar-msg')
      const roleIds = Array.from(modal.querySelectorAll('.rp-check-rol:checked')).map(c => c.value)
      const primaryRoleId = modal.querySelector('#rp-sel-principal').value
      if (roleIds.length === 0) { msg.innerHTML = '<span style="color:#c62828;">Elegí al menos un rol.</span>'; return }
      if (!roleIds.includes(primaryRoleId)) { msg.innerHTML = '<span style="color:#c62828;">El rol principal tiene que estar entre los roles asignados.</span>'; return }

      const zona = modal.querySelector('#rp-zona').value.trim()
      const equipo = modal.querySelector('#rp-equipo').value.trim()
      const local = modal.querySelector('#rp-local').value.trim()
      const mesa = modal.querySelector('#rp-mesa').value.trim()

      msg.textContent = 'Guardando...'
      try {
        const resultado = await assignUserRoles(candidateId, targetUser.id, {
          roleIds, primaryRoleId,
          zoneIds: zona ? [zona] : [],
          pollingPlaceIds: local ? [local] : [],
          tableIds: mesa ? [mesa] : [],
          teamId: equipo || null
        }, user.uid, myRole)

        await cargarDatos()
        if (resultado.advertencia) {
          alert('✅ Guardado.\n\n⚠️ ' + resultado.advertencia)
        } else {
          msg.innerHTML = '<span style="color:#2e7d32;">✅ Guardado — rol legacy sincronizado automáticamente.</span>'
        }
        modal.remove()
        pintarTab()
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }

  // ── CATÁLOGO DE PERMISOS ──────────────────────────────────────────────
  function pintarCatalogo(body) {
    body.innerHTML = `
      <p style="font-size:.85rem; color:#555; margin-bottom:14px;">Catálogo central — vive como código (<code>src/lib/rbacCatalog.js</code>), no como colección editable, para que ningún candidato invente sus propias keys técnicas.</p>
      ${MODULES.map(mod => {
        const perms = PERMISSIONS.filter(p => p.module === mod.key)
        if (perms.length === 0) return ''
        return `
          <div style="margin-bottom:16px;">
            <div style="font-weight:700; font-size:.9rem; margin-bottom:6px; color:#4527a0;">${mod.icon} ${escapeHtml(mod.name)} <span style="color:#999; font-weight:400; font-size:.75rem;">(${mod.route})</span></div>
            <div style="display:grid; gap:2px; padding-left:10px;">
              ${perms.map(p => `<div style="font-size:.78rem; color:#555;"><code style="background:#f5f5f5; padding:1px 5px; border-radius:3px;">${p.key}</code> — ${escapeHtml(p.name)}${p.planned ? ' <span style="color:#999;">(planeado)</span>' : ''}</div>`).join('')}
            </div>
          </div>
        `
      }).join('')}
    `
  }

  // ── AUDITORÍA ─────────────────────────────────────────────────────────
  async function pintarAuditoria(body) {
    body.innerHTML = 'Cargando auditoría...'
    const logs = await getAllRoleAuditLogs(candidateId, 100)
    body.innerHTML = `
      ${logs.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Sin movimientos todavía.</div>' : logs.map(l => `
        <div style="border-left:3px solid #4527a0; padding:8px 12px; margin-bottom:8px; background:#f9f8fc; font-size:.83rem; border-radius:0 6px 6px 0;">
          <div><strong>${escapeHtml(l.action)}</strong>${l.roleId ? ` · rol: ${escapeHtml(l.roleId)}` : ''}</div>
          <div style="color:#666; font-size:.72rem;">${l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString('es-PY') : ''}</div>
          ${l.reason ? `<div style="color:#c62828; margin-top:4px;">${escapeHtml(l.reason)}</div>` : ''}
        </div>
      `).join('')}
    `
  }

  await cargarDatos()
  render()
}
