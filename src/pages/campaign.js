// Panel de campaña para campaign_admin (y coordinadores/operadores con
// vistas más acotadas — ver renderNav). Todo acá opera exclusivamente
// sobre /candidates/{candidateId}/..., nunca sobre las colecciones legacy.
import { logoutUser } from '../lib/firebase.js'
import { functionsInstance } from '../lib/firebase.js'
import { httpsCallable } from 'firebase/functions'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'
import {
  getCandidate,
  getCandidateUser,
  updateCandidateBranding,
  uploadCandidateLogo,
  deleteCandidateLogo,
  getSharedVotersCount,
  getPadronMeta,
  getAllRecords,
  getSavedRecordsByScope,
  getAllCandidateUsers,
  getDuplicateCedulas,
  getUserRecords,
  saveRecord,
  updateRecord,
  deleteRecord,
  updateCandidateUserMesaLocal,
  deleteCandidateUser,
  getDrivers,
  searchVoterByCedula,
  getRecordByCedula
} from '../lib/firebaseCandidate.js'
import { getCandidateMembershipsForUser, setStoredActiveCandidateId } from '../lib/candidateContext.js'
import { buildRecordatorioVotoMessage } from '../lib/campaignMessages.js'
import { can, getGrantedScopes } from '../lib/rbac.js'
import { ROLE_LABELS } from '../lib/roleLabels.js'
// Los paneles ricos (Día D admin/control, choferes) se importan
// dinámicamente en cada tab — no todo campaign_admin necesita bajarlos
// solo por abrir "Usuarios" (mismo criterio que Fase 4 en app.js/main.js).

// URL pública de la app — se manda tal cual por WhatsApp cuando se le da
// acceso a alguien, así que tiene que ser siempre la real (no
// window.location.origin, que en una sesión de desarrollo sería
// localhost e inservible para la otra persona).
const APP_URL = 'https://fastidious-souffle-150794.netlify.app/'

// Qué pestaña ve cada rol. campaign_admin/superadmin ven todo; el resto
// se acota a lo que realmente les compete (spec de roles del pedido
// original: dirigente carga/edita SUS registros, coordinator ve reportes,
// viewer/auditor son de solo lectura, operador solo el Centro de Contacto).
// dia-d-control ahora también es visible para dirigente/mesario/chofer:
// cada uno ve una vista propia acotada a lo suyo (ver dia-d-control-
// candidate.js), no el panel completo de admin.
const TAB_ROLES = {
  resumen: ['campaign_admin', 'coordinator', 'dirigente', 'mesario', 'operador', 'chofer', 'viewer', 'auditor'],
  votantes: ['campaign_admin', 'coordinator', 'dirigente', 'mesario'],
  'mis-registros': ['campaign_admin', 'coordinator', 'dirigente'],
  usuarios: ['campaign_admin'],
  registros: ['campaign_admin', 'coordinator', 'viewer', 'auditor'],
  auditoria: ['campaign_admin', 'auditor'],
  choferes: ['campaign_admin', 'coordinator'],
  mesarios: ['campaign_admin', 'coordinator'],
  dirigentes: ['campaign_admin', 'coordinator'],
  operadores: ['campaign_admin', 'coordinator'],
  'centro-contacto': ['campaign_admin', 'coordinator', 'operador'],
  'dia-d': ['campaign_admin', 'coordinator'],
  'dia-d-control': ['campaign_admin', 'coordinator', 'dirigente', 'mesario', 'chofer'],
  finanzas: ['campaign_admin', 'finance_admin', 'finance_operator', 'cashier', 'auditor'],
  configuracion: ['campaign_admin'],
  roles: ['campaign_admin'],
  reportes: ['campaign_admin', 'coordinator', 'auditor']
}
const TAB_LABELS = {
  resumen: '📊 Resumen',
  votantes: '🗳️ Buscar votante',
  'mis-registros': '📇 Mis registros',
  usuarios: '👥 Usuarios',
  registros: '📋 Registros',
  auditoria: '⚠️ Auditoría',
  choferes: '🚗 Choferes',
  mesarios: '🪑 Mesarios',
  dirigentes: '🧭 Dirigentes',
  operadores: '📞 Operadores',
  'centro-contacto': '📞 Centro de Contacto',
  'dia-d': '⚙️ Día D Admin',
  'dia-d-control': '🎮 Día D Control',
  finanzas: '💰 Finanzas',
  configuracion: '🛠️ Configuración',
  roles: '🔐 Roles y Permisos',
  reportes: '📊 Reportes'
}

// RBAC (Etapa 6, modo compatibilidad) — mapeo de cada pestaña a su
// permiso "view" representativo del catálogo nuevo (src/lib/rbacCatalog.js).
// Se usa SOLO si el usuario ya tiene roleIds asignados (Etapa 5) y esos
// roles existen en candidates/{candidateId}/roles — si no, se sigue
// usando TAB_ROLES tal cual (así ningún candidato real, que hoy no tiene
// nada sembrado en /roles, ve un cambio de comportamiento).
const TAB_TO_PERMISSION = {
  resumen: 'dashboard.view',
  votantes: 'search_voter.view',
  'mis-registros': 'my_records.view',
  usuarios: 'users.view',
  registros: 'records.view',
  auditoria: 'audit.view',
  choferes: 'drivers.view',
  mesarios: 'table_members.view',
  dirigentes: 'leaders.view',
  operadores: 'operators.view',
  'centro-contacto': 'contact_center.view',
  'dia-d': 'election_day_admin.view_dashboard',
  'dia-d-control': 'election_day_control.view_operations',
  finanzas: 'finance.view',
  configuracion: 'settings.view',
  roles: 'roles.view',
  reportes: 'reports.view'
}

// Qué módulo (catálogo src/lib/rbacCatalog.js) corresponde a cada pestaña
// — usado para que el superadmin pueda habilitar/deshabilitar módulos por
// candidato (candidate.enabledModules) desde el Panel de plataforma. Si
// el candidato no tiene ese campo (todos los candidatos de hoy, incluidos
// los 3 reales recién creados), se trata como "todo habilitado" — cero
// cambio de comportamiento hasta que un superadmin lo configure a mano.
const TAB_TO_MODULE = {
  resumen: 'dashboard', votantes: 'search_voter', 'mis-registros': 'my_records',
  usuarios: 'users', registros: 'records', auditoria: 'audit',
  choferes: 'drivers', mesarios: 'table_members', dirigentes: 'leaders',
  operadores: 'operators', 'centro-contacto': 'contact_center',
  'dia-d': 'election_day_admin', 'dia-d-control': 'election_day_control',
  finanzas: 'finance', configuracion: 'settings', roles: 'roles',
  reportes: 'reports'
}

export async function renderCampaignPanel(root, user, candidateId, opts = {}) {
  const candidate = await getCandidate(candidateId)
  if (!candidate) {
    root.innerHTML = `<div style="padding:40px; text-align:center;">Candidato no encontrado.</div>`
    return
  }

  const candidateUserDoc = opts.asSuperAdmin ? null : await getCandidateUser(candidateId, user.uid)
  const myRole = opts.asSuperAdmin ? 'campaign_admin' : (candidateUserDoc?.role || 'viewer')

  // Modo compatibilidad: si hay roleIds asignados y esos roles existen de
  // verdad en Firestore, se resuelve la visibilidad con el motor nuevo
  // (can()); si algo de eso falta, se cae exactamente al TAB_ROLES de
  // siempre. Nunca lanza — cualquier error acá (rol borrado, permiso sin
  // catálogo, etc.) también cae al comportamiento viejo en vez de romper
  // el login.
  let visibleTabs = null
  let misRoles = [] // roles Firestore del usuario (Etapa 5/6) — [] si no tiene roleIds o algo falla
  const roleIds = candidateUserDoc?.roleIds
  if (roleIds && roleIds.length > 0) {
    try {
      const { getRole } = await import('../lib/rolesCandidate.js')
      misRoles = (await Promise.all(roleIds.map(rid => getRole(candidateId, rid)))).filter(Boolean)
      if (misRoles.length > 0) {
        visibleTabs = Object.keys(TAB_ROLES).filter(t => {
          const permKey = TAB_TO_PERMISSION[t]
          return permKey ? can(misRoles, permKey) : TAB_ROLES[t].includes(myRole)
        })
      }
    } catch (err) {
      console.warn('RBAC nuevo no disponible, usando TAB_ROLES de siempre:', err.message)
    }
  }
  if (!visibleTabs) {
    visibleTabs = Object.keys(TAB_ROLES).filter(t => TAB_ROLES[t].includes(myRole))
  }

  // Gating por plan/plataforma: el superadmin puede deshabilitar módulos
  // enteros para un candidato puntual (candidate.enabledModules). No se
  // aplica cuando el superadmin está "entrando" a mirar (opts.asSuperAdmin)
  // — ahí necesita ver todo para poder administrar/diagnosticar.
  if (!opts.asSuperAdmin && Array.isArray(candidate.enabledModules)) {
    visibleTabs = visibleTabs.filter(t => {
      const mod = TAB_TO_MODULE[t]
      return !mod || candidate.enabledModules.includes(mod)
    })
  }

  // Etapa 7 (acciones internas, modo compatibilidad): mismo patrón OR que
  // ya se usa para el menú — el permiso nuevo AMPLÍA lo que ya daba
  // `legacyRoles.includes(myRole)`, nunca lo achica. Si `misRoles` está
  // vacío (el caso de todo usuario real hoy sin roleIds), can() siempre
  // da false y esto se comporta idéntico al chequeo viejo.
  function puedeCompat(permKey, legacyRoles) {
    return can(misRoles, permKey) || legacyRoles.includes(myRole)
  }

  let tab = visibleTabs[0] || 'resumen'
  // Se recuerda entre pestañas dentro de la misma sesión — si volvés a
  // Registros después de mirar otra pestaña, seguís viendo lo último que
  // buscaste en vez de que se resetee a la lista completa.
  let ultimoBuscadoRegistros = ''
  const memberships = opts.asSuperAdmin ? [] : await getCandidateMembershipsForUser(user.uid)
  const otherCandidates = memberships.filter(m => m.candidateId !== candidateId)

  function render() {
    root.innerHTML = `
      <div style="background:${candidate.primaryColor || '#1f4b7a'}; color:white; padding:20px;">
        <div style="max-width:1100px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h1 style="margin:0; font-size:1.3rem;">${escapeHtml(candidate.name)}</h1>
            <div style="font-size:.8rem; opacity:.85;">${escapeHtml(candidate.electionName || 'Panel de campaña')} · ${escapeHtml(ROLE_LABELS[myRole] || myRole)}${opts.asSuperAdmin ? ' · viendo como superadmin' : ''}</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${otherCandidates.length > 0 ? `
              <select id="sel-candidato" style="padding:6px; border-radius:4px;">
                <option value="${candidateId}">${escapeHtml(candidate.name)}</option>
                ${otherCandidates.map(m => `<option value="${escapeHtml(m.candidateId)}">${escapeHtml(m.candidateId)}</option>`).join('')}
              </select>
            ` : ''}
            <button id="btn-logout" style="padding:8px 14px; background:rgba(255,255,255,.15); color:#fff; border:1px solid rgba(255,255,255,.3); border-radius:6px; cursor:pointer;">Salir</button>
          </div>
        </div>
        <div class="nav-grid" style="max-width:1100px; margin:14px auto 0; --tile-color:${candidate.primaryColor || '#1f4b7a'};">
          ${visibleTabs.map(t => navBtn(t, TAB_LABELS[t])).join('')}
        </div>
      </div>
      <div id="tab-content" style="max-width:1100px; margin:24px auto; padding:0 16px;"></div>
    `

    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (confirm('¿Cerrar sesión?')) await logoutUser()
    })

    const sel = document.getElementById('sel-candidato')
    if (sel) {
      sel.addEventListener('change', () => {
        setStoredActiveCandidateId(sel.value)
        renderCampaignPanel(root, user, sel.value)
      })
    }

    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })

    const content = document.getElementById('tab-content')
    if (tab === 'resumen') renderResumen(content)
    else if (tab === 'votantes') renderVotantes(content)
    else if (tab === 'mis-registros') renderMisRegistros(content)
    else if (tab === 'usuarios') renderUsuarios(content)
    else if (tab === 'registros') renderRegistros(content)
    else if (tab === 'auditoria') renderAuditoria(content)
    else if (tab === 'choferes') {
      import('./chofer-candidate.js').then(({ renderChoferCandidate }) => renderChoferCandidate(content, candidateId))
    } else if (tab === 'mesarios') {
      import('./mesario-candidate.js').then(({ renderMesarioCandidate }) => renderMesarioCandidate(content, candidateId))
    } else if (tab === 'dirigentes') {
      import('./dirigente-candidate.js').then(({ renderDirigenteCandidate }) => renderDirigenteCandidate(content, candidateId))
    } else if (tab === 'operadores') {
      import('./operador-candidate.js').then(({ renderOperadorCandidate }) => renderOperadorCandidate(content, candidateId))
    } else if (tab === 'dia-d') {
      import('../modules/dia-d-admin-candidate.js').then(({ renderDiaDAdminCandidate }) => renderDiaDAdminCandidate(content, candidateId, user))
    } else if (tab === 'configuracion') {
      renderConfiguracion(content)
    } else if (tab === 'dia-d-control') {
      import('../modules/dia-d-control-candidate.js').then(({ renderDiaDControlCandidate }) => renderDiaDControlCandidate(content, candidateId, user, myRole, misRoles))
    } else if (tab === 'centro-contacto') {
      import('./contactCenter.js').then(({ renderContactCenter }) => renderContactCenter(content, candidateId, user, myRole, misRoles))
    } else if (tab === 'finanzas') {
      import('./finanzas-candidate.js').then(({ renderFinanzasCandidate }) => renderFinanzasCandidate(content, candidateId, user, myRole, misRoles))
    } else if (tab === 'roles') {
      import('./roles-candidate.js').then(({ renderRolesCandidate }) => renderRolesCandidate(content, candidateId, user, myRole))
    } else if (tab === 'reportes') {
      import('./reportes-candidate.js').then(({ renderReportesCandidate }) => renderReportesCandidate(content, candidateId, user, myRole, misRoles))
    }
  }

  function navBtn(id, label) {
    const active = tab === id
    // TAB_LABELS siempre trae "emoji + texto" — se separan para el
    // layout de tile (ícono arriba, texto abajo) del menú compacto.
    const espacio = label.indexOf(' ')
    const icono = espacio === -1 ? label : label.slice(0, espacio)
    const texto = espacio === -1 ? '' : label.slice(espacio + 1)
    return `<button data-tab="${id}" class="nav-tile${active ? ' active' : ''}">
      <span class="nav-tile-icon">${icono}</span>
      <span class="nav-tile-label">${texto}</span>
    </button>`
  }

  async function renderResumen(content) {
    content.innerHTML = '<div style="color:#999;">Cargando...</div>'

    // TAB_ROLES.resumen incluye a TODOS los roles (dirigente, mesario,
    // chofer, operador, viewer, auditor, además de campaign_admin/
    // coordinator) — pero getAllCandidateUsers/getAllRecords son lecturas
    // de colección completa que firestore.rules solo permite a
    // campaign_admin/coordinator. Para el resto, antes esto quedaba
    // colgado en "Cargando..." con un permission-denied silencioso
    // (Promise.all sin try/catch) — se detectó probando cada rol en vivo.
    // Roles sin acceso al dashboard completo ven un resumen acotado a lo
    // suyo, con datos que sus permisos sí alcanzan.
    const puedeVerDashboardCompleto = ['campaign_admin', 'coordinator'].includes(myRole)
    if (!puedeVerDashboardCompleto) {
      const misRegistros = await getUserRecords(candidateId, user.uid).catch(() => [])
      content.innerHTML = `
        <div style="background:white; border:1px solid #e3e3e3; border-radius:10px; padding:28px; text-align:center;">
          <h2 style="margin:0 0 8px; font-size:1.15rem; color:${candidate.primaryColor || '#1f4b7a'};">👋 Bienvenido/a, ${escapeHtml(candidateUserDoc?.nombre || user.email)}</h2>
          <p style="color:#666; font-size:.9rem; margin:0 0 4px;">Tu rol en esta campaña: <strong>${escapeHtml(ROLE_LABELS[myRole] || myRole)}</strong></p>
          ${misRegistros.length > 0 ? `<p style="color:#666; font-size:.85rem; margin-top:12px;">Tenés <strong>${misRegistros.length}</strong> registro(s) propio(s) — los vas a encontrar en la pestaña "Mis registros" si tenés acceso a ella.</p>` : ''}
        </div>
      `
      return
    }

    const [votersCompartidos, padronMeta, users, records, drivers] = await Promise.all([
      getSharedVotersCount(),
      getPadronMeta().catch(() => null),
      getAllCandidateUsers(candidateId),
      getAllRecords(candidateId),
      getDrivers(candidateId)
    ])

    const porRol = {}
    users.forEach(u => { porRol[u.role] = (porRol[u.role] || 0) + 1 })

    const requierenTransporte = records.filter(r => r.requiresPickup).length
    const precisanAyuda = records.filter(r => r.needsAssistance).length
    const puedenSerChofer = records.filter(r => r.canBeDriver).length
    const quierenSerMesario = records.filter(r => r.wantsToBeMesario).length
    const choferesActivos = drivers.filter(d => (d.status || 'activo') === 'activo').length

    const porLocalMap = {}
    records.forEach(r => {
      const local = r.local || 'Sin local asignado'
      porLocalMap[local] = (porLocalMap[local] || 0) + 1
    })
    const porLocal = Object.entries(porLocalMap).sort((a, b) => b[1] - a[1])
    const maxLocal = porLocal.length > 0 ? porLocal[0][1] : 0

    const conTelefono = records.filter(r => (r.telefono || '').trim() !== '').length
    const conUbicacion = records.filter(r => (r.googleMapsUrl || '').trim() !== '' || (r.latitude != null && r.longitude != null)).length
    const conDireccion = records.filter(r => (r.direccion || '').trim() !== '').length

    const color = candidate.primaryColor || '#1f4b7a'

    const sectionTitle = (label) => `<h2 style="margin:28px 0 12px; font-size:.8rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:${color}; display:flex; align-items:center; gap:8px;"><span style="width:20px; height:2px; background:${color}; display:inline-block;"></span>${label}</h2>`

    const bigCard = (label, value, sub) => `
      <div class="stat-card" style="--accent:${color};">
        <div class="stat-num">${value}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<div style="font-size:.72rem; color:#999; margin-top:2px;">${sub}</div>` : ''}
      </div>`

    const needCard = (emoji, label, value, total) => {
      const pct = total > 0 ? Math.round((value / total) * 100) : 0
      return `
      <div style="background:white; border:1px solid #e3e3e3; border-radius:10px; padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:.85rem; font-weight:700; color:#333;">${emoji} ${label}</div>
          <div style="font-size:1.3rem; font-weight:800; color:${color};">${value}</div>
        </div>
        <div style="background:#eee; border-radius:6px; height:8px; overflow:hidden;">
          <div style="background:${color}; height:100%; width:${pct}%; border-radius:6px;"></div>
        </div>
        <div style="font-size:.7rem; color:#999; margin-top:4px;">${pct}% de los registros</div>
      </div>`
    }

    const qualityRow = (emoji, label, value, total, barColor) => {
      const pct = total > 0 ? Math.round((value / total) * 100) : 0
      return `
      <div style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; font-size:.82rem; margin-bottom:4px;">
          <span style="font-weight:600; color:#333;">${emoji} ${label}</span>
          <span style="color:${barColor}; font-weight:800;">${pct}%</span>
        </div>
        <div style="background:#eee; border-radius:5px; height:8px; overflow:hidden;">
          <div style="background:${barColor}; height:100%; width:${pct}%; border-radius:5px;"></div>
        </div>
      </div>`
    }

    const padronSub = padronMeta?.fileName
      ? `${escapeHtml(padronMeta.fileName)}${padronMeta.uploadedAt?.toDate ? ' · actualizado ' + padronMeta.uploadedAt.toDate().toLocaleDateString('es-PY') : ''}`
      : 'Todos los candidatos'

    content.innerHTML = `
      <div class="stats-grid">
        ${bigCard('Padrón', votersCompartidos.toLocaleString('es-PY'), padronSub)}
        ${bigCard('Registros', records.length, 'Contactos guardados')}
        ${bigCard('Usuarios del equipo', users.length)}
        ${bigCard('Choferes', drivers.length, `${choferesActivos} activo${choferesActivos === 1 ? '' : 's'}`)}
      </div>

      ${sectionTitle('👥 Equipo por rol')}
      <div class="stats-grid">
        ${Object.keys(ROLE_LABELS).map(role => bigCard(ROLE_LABELS[role], porRol[role] || 0)).join('')}
      </div>

      ${sectionTitle('🙋 Necesidades de los votantes registrados')}
      <div class="stats-grid">
        ${needCard('🚐', 'Requieren que se les busque (transporte)', requierenTransporte, records.length)}
        ${needCard('🦽', 'Precisan ayuda para votar', precisanAyuda, records.length)}
        ${needCard('🚗', 'Pueden colaborar como chofer', puedenSerChofer, records.length)}
        ${needCard('🪑', 'Quieren sentarse en la mesa', quierenSerMesario, records.length)}
      </div>

      ${sectionTitle('📊 Calidad de los datos')}
      <div style="background:white; border:1px solid #e3e3e3; border-radius:10px; padding:18px 20px;">
        ${qualityRow('✅', 'Con teléfono', conTelefono, records.length, '#2e7d32')}
        ${qualityRow('📍', 'Con ubicación', conUbicacion, records.length, '#2e7d32')}
        ${qualityRow('🏠', 'Con dirección', conDireccion, records.length, '#2e7d32')}
        ${qualityRow('🚗', 'Requiere transporte', requierenTransporte, records.length, '#e65100')}
        ${qualityRow('❤️', 'Requiere ayuda registrada', precisanAyuda, records.length, '#c62828')}
      </div>

      ${sectionTitle('🗳️ Registros por local electoral')}
      <div style="background:white; border:1px solid #e3e3e3; border-radius:10px; padding:16px 18px;">
        ${porLocal.length === 0 ? '<div style="color:#999; font-size:.85rem;">Todavía no hay registros con local asignado.</div>' : porLocal.map(([local, cantidad]) => {
          const pct = maxLocal > 0 ? Math.round((cantidad / maxLocal) * 100) : 0
          return `
          <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; font-size:.8rem; margin-bottom:3px;">
              <span style="font-weight:600; color:#333;">${escapeHtml(local)}</span>
              <span style="color:${color}; font-weight:700;">${cantidad}</span>
            </div>
            <div style="background:#eee; border-radius:5px; height:7px; overflow:hidden;">
              <div style="background:${color}; height:100%; width:${pct}%; border-radius:5px;"></div>
            </div>
          </div>`
        }).join('')}
      </div>
    `
  }

  // Módulo separado (antes vivía adentro de Resumen) — acá se configuran
  // los datos de la campaña, incluida la lista y opción con la que se
  // arma el mensaje de WhatsApp en "Mis registros".
  function renderConfiguracion(content) {
    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px; margin-bottom:16px;">
        <h2 style="margin:0 0 12px; font-size:1.05rem;">🖼️ Logo de campaña</h2>
        <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
          <img id="logo-preview" src="${escapeHtml(candidate.logoUrl || '')}" style="width:90px; height:90px; object-fit:cover; border-radius:8px; border:1px solid #ddd; background:#f5f5f5; ${candidate.logoUrl ? '' : 'display:none;'}">
          <div style="flex:1; min-width:220px;">
            <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">
              📐 Tamaño recomendado: <strong>180x180 píxeles</strong> (imagen cuadrada) · Formato: <strong>JPG o PNG</strong> · Tamaño máximo: 2 MB.
            </p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <input id="inp-logo-file" type="file" accept="image/jpeg,image/png" style="font-size:.85rem;">
              ${candidate.logoUrl ? `<button id="btn-quitar-logo" type="button" style="background:#c62828; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">🗑️ Quitar logo</button>` : ''}
            </div>
            <div id="logo-msg" style="font-size:.82rem; margin-top:8px;"></div>
          </div>
        </div>
      </div>

      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px;">
        <h2 style="margin:0 0 12px; font-size:1.05rem;">🛠️ Configuración de la campaña</h2>
        <form id="form-branding" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;">
          <input name="name" value="${escapeHtml(candidate.name)}" placeholder="Nombre del candidato" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="electionName" value="${escapeHtml(candidate.electionName || '')}" placeholder="Nombre de la elección" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="electionDate" type="date" value="${candidate.electionDate ? String(candidate.electionDate).slice(0, 10) : ''}" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="lista" value="${escapeHtml(candidate.lista || '')}" placeholder="Número de Lista" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="opcion" value="${escapeHtml(candidate.opcion || '')}" placeholder="Número de Opción" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="primaryColor" type="color" value="${candidate.primaryColor || '#1f4b7a'}" style="padding:4px; border:1px solid #ccc; border-radius:4px; height:38px;">
          <button type="submit" style="padding:10px; background:${candidate.primaryColor || '#1f4b7a'}; color:white; border:none; border-radius:4px; font-weight:700; cursor:pointer;">Guardar</button>
        </form>
        <div id="branding-msg" style="margin-top:8px; font-size:.85rem;"></div>
        <p style="font-size:.78rem; color:#666; margin-top:16px;">La Fecha de la elección, la Lista y la Opción se usan para armar el mensaje de WhatsApp de recordatorio de votación ("¡Contamos con tu voto el &lt;fecha&gt;! Vota Lista X Opción Y") en las pestañas Mis registros y Registros. Cualquiera de los tres puede quedar vacío: el mensaje simplemente omite esa parte.</p>
      </div>
    `

    document.getElementById('inp-logo-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const msg = document.getElementById('logo-msg')
      const preview = document.getElementById('logo-preview')

      // Aviso de dimensiones ANTES de subir — informativo, no bloquea la
      // subida (un logo rectangular o un poco más grande igual sirve).
      const dims = await new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve(null)
        img.src = URL.createObjectURL(file)
      })
      let avisoDimensiones = ''
      if (dims && (dims.w !== 180 || dims.h !== 180)) {
        avisoDimensiones = `⚠️ La imagen es de ${dims.w}x${dims.h}px (se recomienda 180x180px) — se va a subir igual, pero puede verse recortada o distorsionada. `
      }

      msg.textContent = 'Subiendo...'
      try {
        // Si Storage todavía no está habilitado en el proyecto, el SDK
        // reintenta en silencio contra un bucket inexistente en vez de
        // fallar rápido — sin este timeout la UI se queda en "Subiendo..."
        // indefinidamente sin ningún mensaje de error.
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado — probablemente Firebase Storage todavía no está habilitado en el proyecto (Firebase Console → Storage → "Comenzar").')), 15000))
        const url = await Promise.race([uploadCandidateLogo(candidateId, file), timeout])
        candidate.logoUrl = url
        preview.src = url
        preview.style.display = ''
        msg.innerHTML = `<span style="color:#2e7d32;">${avisoDimensiones}✅ Logo actualizado.</span>`
        setTimeout(() => renderConfiguracion(content), 1200) // refresca para que aparezca el botón "Quitar logo"
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })

    document.getElementById('btn-quitar-logo')?.addEventListener('click', async () => {
      if (!confirm('¿Quitar el logo de la campaña?')) return
      const msg = document.getElementById('logo-msg')
      const preview = document.getElementById('logo-preview')
      msg.textContent = 'Quitando...'
      try {
        await deleteCandidateLogo(candidateId, candidate.logoUrl)
        candidate.logoUrl = ''
        preview.style.display = 'none'
        preview.src = ''
        msg.innerHTML = '<span style="color:#2e7d32;">✅ Logo quitado.</span>'
        setTimeout(() => renderConfiguracion(content), 1200)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })

    document.getElementById('form-branding').addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const msg = document.getElementById('branding-msg')
      try {
        const cambios = {
          name: fd.get('name').trim(),
          electionName: fd.get('electionName').trim(),
          electionDate: fd.get('electionDate') || null,
          lista: fd.get('lista').trim(),
          opcion: fd.get('opcion').trim(),
          primaryColor: fd.get('primaryColor')
        }
        await updateCandidateBranding(candidateId, cambios)
        Object.assign(candidate, cambios)
        msg.textContent = '✅ Guardado'
        render()
      } catch (err) {
        msg.textContent = `❌ ${err.message}`
      }
    })
  }

  function statCard(label, value) {
    return `<div class="stat-card" style="--accent:${candidate.primaryColor || '#1f4b7a'};">
      <div class="stat-num">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`
  }

  // El padrón es compartido entre TODOS los candidatos (mismo registro
  // electoral) — acá solo se busca/consulta, nunca se importa. La carga
  // del padrón es una operación de plataforma (panel de superadmin), no
  // de cada campaña.
  function renderVotantes(content) {
    const puedeGuardar = puedeCompat('search_voter.create', TAB_ROLES['mis-registros'])
    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px;">
        <h2 style="margin:0 0 12px; font-size:1.05rem;">🗳️ Buscar votante (padrón compartido)</h2>
        <p style="font-size:.85rem; color:#666; margin-bottom:8px;">El padrón electoral es el mismo para todos los candidatos. Buscá por cédula o nombre${puedeGuardar ? ' y guardá el contacto para tu campaña' : ''}.</p>
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin-bottom:16px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
          <input id="inp-buscar-votante" placeholder="Cédula o nombre (mín. 3 letras)" style="flex:1; min-width:220px; padding:8px; border:1px solid #ccc; border-radius:4px;">
          <button id="btn-buscar-votante" style="padding:8px 16px; background:${candidate.primaryColor || '#1f4b7a'}; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:700;">Buscar</button>
        </div>
        <div id="resultado-votantes" style="font-size:.88rem;"></div>
      </div>
    `

    let ultimosResultados = []

    const buscar = async () => {
      const termino = document.getElementById('inp-buscar-votante').value.trim()
      const resultEl = document.getElementById('resultado-votantes')
      if (!termino) return
      resultEl.textContent = 'Buscando...'
      const { searchVoterByCedula, searchVotersByName, getTelefonosPadron } = await import('../lib/firebaseCandidate.js')
      const esCedula = /^\d+$/.test(termino)
      ultimosResultados = esCedula ? await searchVoterByCedula(termino) : await searchVotersByName(termino)
      if (ultimosResultados.length === 0) {
        resultEl.innerHTML = '<div style="color:#999;">Sin resultados.</div>'
        return
      }
      // El teléfono del padrón compartido ya no viaja en el doc de voters
      // (privacidad: ver getTelefonosPadron) — se pide aparte, y el backend
      // solo lo entrega si el votante es propio/asignado del usuario o si
      // es superadmin. Si no corresponde mostrarlo, telefono queda ''.
      try {
        const telefonos = await getTelefonosPadron(candidateId, ultimosResultados.map(v => v.cedula))
        ultimosResultados.forEach(v => { v.telefono = telefonos[v.cedula] || '' })
      } catch (err) {
        console.warn('No se pudieron resolver los teléfonos del padrón:', err.message)
        ultimosResultados.forEach(v => { v.telefono = '' })
      }
      // Antes solo mostraba Nombre/Cédula/Local/Mesa (bug real: hacía
      // parecer que un votante "solo tenía nombre y cédula" cuando en
      // realidad sí tenía teléfono/sexo/dirección/etc. guardados, pero la
      // tabla nunca los mostraba). Ahora muestra todos los campos del
      // padrón en tarjetas (mismo patrón .roster-card que el resto de la
      // app usa para listas en mobile).
      resultEl.innerHTML = `
        <div class="roster-card-grid">
          ${ultimosResultados.map((v, idx) => `
            <div class="roster-card">
              <div class="roster-card-name">${escapeHtml(v.nombre)}</div>
              <div class="roster-card-fields">
                <div class="roster-card-field"><strong>Cédula:</strong> ${escapeHtml(v.cedula)}</div>
                <div class="roster-card-field"><strong>Teléfono:</strong> ${escapeHtml(v.telefono) || '—'}</div>
                <div class="roster-card-field"><strong>Local:</strong> ${escapeHtml(v.local) || '—'}</div>
                <div class="roster-card-field"><strong>Mesa:</strong> ${escapeHtml(v.mesa) || '—'} <strong>Orden:</strong> ${escapeHtml(v.orden) || '—'}</div>
                <div class="roster-card-field"><strong>Seccional:</strong> ${escapeHtml(v.seccional) || '—'}</div>
                <div class="roster-card-field"><strong>Dirección:</strong> ${escapeHtml(v.direccion) || '—'}</div>
              </div>
              ${puedeGuardar ? `<div class="roster-card-actions"><button class="btn-guardar-votante btn-compact" data-idx="${idx}" style="background:#4caf50; color:white;">💾 Guardar</button></div>` : ''}
            </div>
          `).join('')}
        </div>
      `
      if (puedeGuardar) {
        resultEl.querySelectorAll('.btn-guardar-votante').forEach(btn => {
          btn.addEventListener('click', () => modalGuardarVotante(ultimosResultados[Number(btn.dataset.idx)]))
        })
      }
    }

    function modalGuardarVotante(voter) {
      let ubicacion = { latitude: null, longitude: null, googleMapsUrl: '' }

      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px; overflow-y:auto;'
      modal.innerHTML = `
        <div style="background:white; border-radius:8px; padding:24px; max-width:420px; width:100%; margin:20px 0;">
          <h3 style="margin:0 0 4px;">Guardar contacto</h3>
          <p style="margin:0 0 16px; color:#666; font-size:.85rem;">${escapeHtml(voter.nombre)} · CI ${escapeHtml(voter.cedula)}</p>

          <input id="inp-telefono" placeholder="Teléfono (opcional)" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
          <input id="inp-nota" placeholder="Nota (opcional)" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
          <input id="inp-direccion" placeholder="Dirección (opcional)" value="${escapeHtml(voter.direccion || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:12px; box-sizing:border-box;">

          <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:12px;">
            <div style="font-weight:600; font-size:.85rem; margin-bottom:8px;">📍 Ubicación (opcional)</div>
            <button type="button" id="btn-ubicacion-actual" style="width:100%; padding:8px; background:#1976d2; color:white; border:none; border-radius:4px; cursor:pointer; font-size:.82rem; font-weight:600; margin-bottom:8px;">📍 Usar mi ubicación actual</button>
            <div id="ubicacion-estado" style="font-size:.78rem; color:#666; margin-bottom:8px;"></div>
            <input id="inp-maps-link" placeholder="O pegá un link de Google Maps" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; font-size:.85rem;">
          </div>

          <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:16px; display:grid; gap:8px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-pickup"> ¿Requiere que se le busque el Día D?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-assistance"> ¿Precisa ayuda para votar?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-driver"> ¿Puede colaborar como chofer el Día D?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-mesario"> ¿Querés sentarte en la Mesa?
            </label>
          </div>

          <div id="advertencia-telefono" style="display:none; background:#fff3cd; border-left:4px solid #ffc107; color:#856404; padding:10px; border-radius:4px; margin-bottom:12px; font-size:.82rem;">
            Es importante guardar el número de teléfono para poder contactar al votante. ¿Desea guardar igual sin teléfono?
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button type="button" id="btn-volver-telefono" style="flex:1; background:#999; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem;">Volver y cargar teléfono</button>
              <button type="button" id="btn-guardar-igual" style="flex:1; background:#d32f2f; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem; font-weight:700;">Guardar igual</button>
            </div>
          </div>

          <div id="guardar-msg" style="font-size:.85rem; margin-bottom:8px;"></div>
          <div id="botones-guardar" style="display:flex; gap:8px;">
            <button id="btn-confirmar" style="flex:1; background:#4caf50; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
            <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)
      modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())

      modal.querySelector('#btn-ubicacion-actual').addEventListener('click', () => {
        const estadoEl = modal.querySelector('#ubicacion-estado')
        if (!navigator.geolocation) {
          estadoEl.textContent = 'Este navegador no soporta geolocalización. Pegá un link de Google Maps abajo.'
          return
        }
        estadoEl.textContent = 'Obteniendo ubicación...'
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords
            ubicacion = {
              latitude,
              longitude,
              googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`
            }
            modal.querySelector('#inp-maps-link').value = ubicacion.googleMapsUrl
            estadoEl.textContent = `✅ Ubicación capturada (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
          },
          (err) => {
            estadoEl.textContent = 'No se pudo obtener la ubicación (' + err.message + '). Pegá un link de Google Maps abajo.'
          },
          { enableHighAccuracy: true, timeout: 10000 }
        )
      })

      // Si el usuario pega un link a mano, ese gana sobre lo capturado por
      // geolocalización — y si el link trae coordenadas reconocibles
      // (.../@lat,lng... o ...q=lat,lng...), las extraemos también.
      modal.querySelector('#inp-maps-link').addEventListener('input', (e) => {
        const url = e.target.value.trim()
        const match = url.match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/)
        ubicacion = {
          latitude: match ? parseFloat(match[1]) : null,
          longitude: match ? parseFloat(match[2]) : null,
          googleMapsUrl: url
        }
      })

      async function guardar() {
        const msg = modal.querySelector('#guardar-msg')
        modal.querySelector('#advertencia-telefono').style.display = 'none'
        try {
          await saveRecord(candidateId, user.uid, voter, {
            telefono: modal.querySelector('#inp-telefono').value.trim(),
            nota: modal.querySelector('#inp-nota').value.trim(),
            direccion: modal.querySelector('#inp-direccion').value.trim(),
            latitude: ubicacion.latitude,
            longitude: ubicacion.longitude,
            googleMapsUrl: ubicacion.googleMapsUrl,
            requiresPickup: modal.querySelector('#chk-pickup').checked,
            needsAssistance: modal.querySelector('#chk-assistance').checked,
            canBeDriver: modal.querySelector('#chk-driver').checked,
            wantsToBeMesario: modal.querySelector('#chk-mesario').checked,
            militanteName: user.displayName || user.email
          })
          msg.innerHTML = '✅ Guardado'
          setTimeout(() => modal.remove(), 800)
        } catch (err) {
          msg.innerHTML = `❌ ${escapeHtml(err.message)}`
        }
      }

      modal.querySelector('#btn-confirmar').addEventListener('click', () => {
        const telefono = modal.querySelector('#inp-telefono').value.trim()
        if (!telefono) {
          modal.querySelector('#advertencia-telefono').style.display = 'block'
          return
        }
        guardar()
      })

      modal.querySelector('#btn-volver-telefono').addEventListener('click', () => {
        modal.querySelector('#advertencia-telefono').style.display = 'none'
        modal.querySelector('#inp-telefono').focus()
      })

      modal.querySelector('#btn-guardar-igual').addEventListener('click', () => guardar())
    }

    document.getElementById('btn-buscar-votante').addEventListener('click', buscar)
    document.getElementById('inp-buscar-votante').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscar()
    })
  }

  // Port de myRecords.js — los registros propios del usuario logueado,
  // candidato-scoped, con edición/borrado.
  function normalizarTelefonoPY(tel) {
    if (!tel) return ''
    const digits = String(tel).replace(/\D/g, '')
    return '595' + digits.replace(/^0/, '')
  }

  async function renderMisRegistros(content) {
    content.innerHTML = '<div style="color:#999;">Cargando...</div>'
    const [registros, drivers] = await Promise.all([
      getUserRecords(candidateId, user.uid),
      getDrivers(candidateId)
    ])
    const choferesMap = {}
    drivers.forEach(d => { choferesMap[d.id] = d })

    const opcion = (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    const locales = [...new Set(registros.map(r => r.local).filter(Boolean))].sort()
    const mesas = [...new Set(registros.map(r => r.mesa).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))

    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:16px;">
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:10px;">
          <div class="filter-input-wrap"><input id="input-buscar-mis-reg" class="filter-input" placeholder="Buscar por cédula o nombre..."></div>
          <select id="sel-local-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todos los locales</option>
            ${locales.map(opcion).join('')}
          </select>
          <select id="sel-mesa-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todas las mesas</option>
            ${mesas.map(opcion).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:10px;">
          <select id="sel-chofer-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Chofer: todos</option>
            <option value="si">Chofer: Sí</option>
            <option value="no">Chofer: No</option>
          </select>
          <select id="sel-mesario-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Mesario: todos</option>
            <option value="si">Mesario: Sí</option>
            <option value="no">Mesario: No</option>
          </select>
          <select id="sel-ayuda-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Ayuda Gs.: todos</option>
            <option value="si">Ayuda Gs.: Sí</option>
            <option value="no">Ayuda Gs.: No</option>
          </select>
          <select id="sel-transporte-mis-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Transporte: todos</option>
            <option value="si">Transporte: Sí</option>
            <option value="no">Transporte: No</option>
          </select>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-limpiar-mis-reg" style="background:#999; color:white; border:none; padding:10px 18px; border-radius:4px; cursor:pointer; font-weight:600;">✕ Limpiar filtros</button>
          <button id="btn-export-mis-reg" style="background:#d4af37; color:black; border:none; padding:10px 18px; border-radius:4px; font-weight:700; cursor:pointer;">📥 Excel</button>
          <button id="btn-print-mis-reg" style="background:#555; color:white; border:none; padding:10px 18px; border-radius:4px; font-weight:700; cursor:pointer;">🖨️ Imprimir</button>
        </div>
      </div>
      <div class="stats-grid">
        ${statCard('Mis registros', registros.length)}
        ${statCard('Chofer', registros.filter(r => r.canBeDriver).length)}
        ${statCard('Mesario', registros.filter(r => r.wantsToBeMesario).length)}
        ${statCard('Ayuda', registros.filter(r => r.needsAssistance).length)}
        ${statCard('Transporte', registros.filter(r => r.requiresPickup).length)}
      </div>
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px;">
        <div id="tabla-mis-registros"></div>
      </div>
    `

    function pintarTabla() {
      const termino = document.getElementById('input-buscar-mis-reg').value.trim().toLowerCase()
      const local = document.getElementById('sel-local-mis-reg').value
      const mesa = document.getElementById('sel-mesa-mis-reg').value
      const chofer = document.getElementById('sel-chofer-mis-reg').value
      const mesario = document.getElementById('sel-mesario-mis-reg').value
      const ayuda = document.getElementById('sel-ayuda-mis-reg').value
      const transporte = document.getElementById('sel-transporte-mis-reg').value
      const matchSiNo = (valor, flag) => !valor || (valor === 'si' ? !!flag : !flag)

      // Los filtros se combinan con AND, igual que en Registros.
      const filtrados = registros.filter(r => {
        if (termino && !(String(r.cedula).toLowerCase().includes(termino) || String(r.nombre).toLowerCase().includes(termino))) return false
        if (local && r.local !== local) return false
        if (mesa && String(r.mesa) !== mesa) return false
        if (!matchSiNo(chofer, r.canBeDriver)) return false
        if (!matchSiNo(mesario, r.wantsToBeMesario)) return false
        if (!matchSiNo(ayuda, r.needsAssistance)) return false
        if (!matchSiNo(transporte, r.requiresPickup)) return false
        return true
      })

      const hayFiltro = termino || local || mesa || chofer || mesario || ayuda || transporte
      const tablaEl = document.getElementById('tabla-mis-registros')

      if (registros.length === 0) {
        tablaEl.innerHTML = '<div style="text-align:center; padding:30px; color:#999;">Todavía no guardaste ningún contacto.</div>'
        return []
      }

      tablaEl.innerHTML = `
        ${hayFiltro ? `<div style="background:#e3f2fd; border-left:4px solid #1976d2; padding:10px; border-radius:4px; margin-bottom:12px; font-size:.85rem;"><strong>${filtrados.length}</strong> de ${registros.length} registros</div>` : ''}
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Dirección / Ubicación</th><th>Chofer asignado</th><th>Chofer</th><th>Mesario</th><th>Ayuda Gs.</th><th>Transporte</th><th>WhatsApp</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              ${filtrados.map(r => {
                const chofer = r.chofer_asignado ? choferesMap[r.chofer_asignado] : null
                const siNo = (flag) => flag
                  ? '<span style="color:#2e7d32; font-weight:700;">Sí</span>'
                  : '<span style="color:#999;">No</span>'
                const telLimpio = normalizarTelefonoPY(r.telefono)
                const msgSaludo = encodeURIComponent(buildRecordatorioVotoMessage(candidate, r))
                return `<tr style="border-bottom:1px solid #eee; ${hayFiltro ? 'background:#fffacd;' : ''}">
                <td style="padding:6px; font-family:monospace; font-size:.78rem;">${escapeHtml(r.cedula)}</td>
                <td style="padding:6px;"><strong>${escapeHtml(r.nombre)}</strong></td>
                <td>${escapeHtml(r.local) || '—'}</td>
                <td>${escapeHtml(r.mesa) || '—'}</td>
                <td>${escapeHtml(r.orden) || '—'}</td>
                <td>${escapeHtml(r.telefono) || '—'}</td>
                <td>${escapeHtml(r.direccion) || '—'}${r.googleMapsUrl ? ` · <a href="${escapeHtml(r.googleMapsUrl)}" target="_blank" rel="noopener">📍 Maps</a>` : ''}</td>
                <td>${chofer ? escapeHtml(chofer.nombre) : '—'}</td>
                <td>${siNo(r.canBeDriver)}</td>
                <td>${siNo(r.wantsToBeMesario)}</td>
                <td>${Number(r.montoAyuda) > 0 ? `<strong>Gs. ${Number(r.montoAyuda).toLocaleString('es-PY')}</strong>` : siNo(r.needsAssistance)}</td>
                <td>${siNo(r.requiresPickup)}</td>
                <td>
                  ${telLimpio ? `
                    <div style="display:flex; gap:4px;">
                      <a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:4px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">Blanco</a>
                      <a href="https://wa.me/${telLimpio}?text=${msgSaludo}" target="_blank" rel="noopener" style="text-decoration:none; background:#128c7e; color:white; padding:4px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">Mesa</a>
                    </div>
                  ` : '<span style="color:#999; font-size:.75rem;">sin tel.</span>'}
                </td>
                <td>
                  <div style="display:flex; gap:4px;">
                    <button class="btn-editar-registro" data-id="${r.id}" style="background:#ff9800; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✏️</button>
                    <button class="btn-borrar-registro" data-id="${r.id}" style="background:#d32f2f; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">🗑️</button>
                  </div>
                </td>
              </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
        ${filtrados.length === 0 ? '<div style="text-align:center; padding:30px; color:#999;">Sin resultados.</div>' : ''}
      `

      tablaEl.querySelectorAll('.btn-editar-registro').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = registros.find(x => x.id === btn.dataset.id)
          modalEditarMiRegistro(r)
        })
      })
      tablaEl.querySelectorAll('.btn-borrar-registro').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('¿Borrar este registro?')) return
          deleteRecord(candidateId, btn.dataset.id)
            .then(() => renderMisRegistros(content))
            .catch(err => alert('Error: ' + err.message))
        })
      })

      return filtrados
    }

    // Chofer/Mesario/Ayuda/Teléfono editables desde acá. Nota aparte:
    // asignar un chofer implica que el votante necesita transporte, así
    // que en vez de duplicar un toggle "Transporte" acá, asignar chofer
    // fuerza requiresPickup=true por su cuenta (no es bidireccional: sacar
    // el chofer no desmarca transporte, porque puede seguir necesitándolo
    // aunque todavía no tenga chofer asignado).
    function modalEditarMiRegistro(r) {
      // Arranca con la ubicación ya guardada en el registro — si el
      // usuario no toca ni el botón de geolocalización ni el link de
      // Maps, esto se reescribe tal cual al guardar (equivale a "no
      // modificar" el campo, no hace falta trackear un flag aparte).
      let ubicacion = { latitude: r.latitude ?? null, longitude: r.longitude ?? null, googleMapsUrl: r.googleMapsUrl || '' }

      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px; overflow-y:auto;'
      modal.innerHTML = `
        <div style="background:white; border-radius:8px; padding:24px; max-width:440px; width:100%; margin:20px 0;">
          <h3 style="margin:0 0 4px;">Editar registro</h3>
          <p style="margin:0 0 16px; color:#666; font-size:.85rem;">${escapeHtml(r.nombre)} · CI ${escapeHtml(r.cedula)}</p>

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Teléfono:</label>
          <input id="inp-edit-telefono" value="${escapeHtml(r.telefono || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:12px; box-sizing:border-box;">

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Nota:</label>
          <input id="inp-edit-nota" value="${escapeHtml(r.nota || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:12px; box-sizing:border-box;">

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Chofer asignado:</label>
          <select id="sel-edit-chofer" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:12px;">
            <option value="">-- Sin asignar --</option>
            ${drivers.map(d => `<option value="${d.id}" ${r.chofer_asignado === d.id ? 'selected' : ''}>${escapeHtml(d.nombre)}</option>`).join('')}
          </select>

          <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:12px; display:grid; gap:8px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-edit-driver" ${r.canBeDriver ? 'checked' : ''}> Chofer: ¿puede colaborar el Día D?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-edit-mesario" ${r.wantsToBeMesario ? 'checked' : ''}> Mesario: ¿quiere sentarse en la mesa?
            </label>
          </div>

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Ayuda — Editar Monto (Gs.):</label>
          <input id="inp-edit-monto-ayuda" type="number" min="0" step="1000" value="${Number(r.montoAyuda) || 0}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; box-sizing:border-box;">

          <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:16px;">
            <div style="font-weight:600; font-size:.85rem; margin-bottom:8px;">📍 Ubicación (opcional)</div>
            <div id="edit-ubicacion-actual" style="font-size:.78rem; margin-bottom:8px; ${r.googleMapsUrl ? 'color:#1976d2;' : 'color:#999;'}">
              ${r.googleMapsUrl ? `Ubicación actual: <a href="${escapeHtml(r.googleMapsUrl)}" target="_blank" rel="noopener">ver en Maps</a>` : 'Sin ubicación registrada.'}
            </div>
            <button type="button" id="btn-edit-ubicacion-actual" style="width:100%; padding:8px; background:#1976d2; color:white; border:none; border-radius:4px; cursor:pointer; font-size:.82rem; font-weight:600; margin-bottom:8px;">📍 Usar mi ubicación actual</button>
            <div id="edit-ubicacion-estado" style="font-size:.78rem; color:#666; margin-bottom:8px;"></div>
            <input id="inp-edit-maps-link" placeholder="O pegá un link de Google Maps" value="${escapeHtml(r.googleMapsUrl || '')}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; font-size:.85rem; margin-bottom:8px;">
            <button type="button" id="btn-edit-quitar-ubicacion" style="width:100%; padding:6px; background:#c62828; color:white; border:none; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">🗑️ Quitar ubicación</button>
          </div>

          <div id="edit-registro-msg" style="font-size:.85rem; margin-bottom:8px;"></div>
          <div style="display:flex; gap:8px;">
            <button id="btn-confirmar-edit" style="flex:1; background:#4caf50; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
            <button id="btn-cancelar-edit" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)
      modal.querySelector('#btn-cancelar-edit').addEventListener('click', () => modal.remove())

      modal.querySelector('#btn-edit-ubicacion-actual').addEventListener('click', () => {
        const estadoEl = modal.querySelector('#edit-ubicacion-estado')
        if (!navigator.geolocation) {
          estadoEl.textContent = 'Este navegador no soporta geolocalización. Pegá un link de Google Maps abajo.'
          return
        }
        estadoEl.textContent = 'Obteniendo ubicación...'
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords
            ubicacion = {
              latitude,
              longitude,
              googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`
            }
            modal.querySelector('#inp-edit-maps-link').value = ubicacion.googleMapsUrl
            estadoEl.textContent = `✅ Ubicación capturada (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
          },
          (err) => {
            estadoEl.textContent = 'No se pudo obtener la ubicación (' + err.message + '). Pegá un link de Google Maps abajo.'
          },
          { enableHighAccuracy: true, timeout: 10000 }
        )
      })

      // Mismo criterio que al crear el registro: el link pegado a mano
      // gana, y si trae coordenadas reconocibles (.../@lat,lng... o
      // ...q=lat,lng...) las extraemos también.
      modal.querySelector('#inp-edit-maps-link').addEventListener('input', (e) => {
        const url = e.target.value.trim()
        const match = url.match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/)
        ubicacion = {
          latitude: match ? parseFloat(match[1]) : null,
          longitude: match ? parseFloat(match[2]) : null,
          googleMapsUrl: url
        }
      })

      modal.querySelector('#btn-edit-quitar-ubicacion').addEventListener('click', () => {
        ubicacion = { latitude: null, longitude: null, googleMapsUrl: '' }
        modal.querySelector('#inp-edit-maps-link').value = ''
        modal.querySelector('#edit-ubicacion-estado').textContent = '🗑️ Ubicación quitada.'
      })

      modal.querySelector('#btn-confirmar-edit').addEventListener('click', async () => {
        const msg = modal.querySelector('#edit-registro-msg')
        const nuevoChofer = modal.querySelector('#sel-edit-chofer').value
        const montoAyuda = Number(modal.querySelector('#inp-edit-monto-ayuda').value) || 0
        try {
          await updateRecord(candidateId, r.id, {
            telefono: modal.querySelector('#inp-edit-telefono').value.trim(),
            nota: modal.querySelector('#inp-edit-nota').value.trim(),
            chofer_asignado: nuevoChofer || null,
            canBeDriver: modal.querySelector('#chk-edit-driver').checked,
            wantsToBeMesario: modal.querySelector('#chk-edit-mesario').checked,
            montoAyuda,
            needsAssistance: montoAyuda > 0,
            latitude: ubicacion.latitude,
            longitude: ubicacion.longitude,
            googleMapsUrl: ubicacion.googleMapsUrl,
            // Asignar chofer implica que sí o sí pidió transporte — evita
            // el toggle "Transporte" duplicado con "Chofer asignado".
            ...(nuevoChofer ? { requiresPickup: true } : {})
          })
          msg.innerHTML = '✅ Guardado'
          setTimeout(() => { modal.remove(); renderMisRegistros(content) }, 600)
        } catch (err) {
          msg.innerHTML = `❌ ${escapeHtml(err.message)}`
        }
      })
    }

    let ultimosFiltrados = pintarTabla()
    const actualizar = () => { ultimosFiltrados = pintarTabla() }

    document.getElementById('input-buscar-mis-reg').addEventListener('input', debounce(actualizar, 250))
    document.getElementById('sel-local-mis-reg').addEventListener('change', actualizar)
    document.getElementById('sel-mesa-mis-reg').addEventListener('change', actualizar)
    document.getElementById('sel-chofer-mis-reg').addEventListener('change', actualizar)
    document.getElementById('sel-mesario-mis-reg').addEventListener('change', actualizar)
    document.getElementById('sel-ayuda-mis-reg').addEventListener('change', actualizar)
    document.getElementById('sel-transporte-mis-reg').addEventListener('change', actualizar)
    document.getElementById('btn-limpiar-mis-reg').addEventListener('click', () => {
      document.getElementById('input-buscar-mis-reg').value = ''
      document.getElementById('sel-local-mis-reg').value = ''
      document.getElementById('sel-mesa-mis-reg').value = ''
      document.getElementById('sel-chofer-mis-reg').value = ''
      document.getElementById('sel-mesario-mis-reg').value = ''
      document.getElementById('sel-ayuda-mis-reg').value = ''
      document.getElementById('sel-transporte-mis-reg').value = ''
      actualizar()
    })

    document.getElementById('btn-export-mis-reg').addEventListener('click', async () => {
      const XLSX = await import('xlsx')
      const ws = XLSX.utils.json_to_sheet(ultimosFiltrados.map(r => ({
        Nombre: r.nombre, Cedula: r.cedula, Local: r.local, Mesa: r.mesa, Orden: r.orden,
        Telefono: r.telefono, Direccion: r.direccion, Ubicacion: r.googleMapsUrl,
        RequiereTransporte: r.requiresPickup ? 'Sí' : 'No',
        PrecisaAyuda: r.needsAssistance ? 'Sí' : 'No',
        PuedeSerChofer: r.canBeDriver ? 'Sí' : 'No',
        QuiereSerMesario: r.wantsToBeMesario ? 'Sí' : 'No'
      })))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Mis registros')
      XLSX.writeFile(wb, `mis_registros_${candidateId}_${Date.now()}.xlsx`)
    })

    document.getElementById('btn-print-mis-reg').addEventListener('click', () => {
      const printWindow = window.open('', '_blank')
      printWindow.document.write(`
        <html><head><title>Mis registros - ${escapeHtml(candidate.name)}</title>
        <style>body{font-family:sans-serif;font-size:12px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:4px;text-align:left}</style>
        </head><body>
        <h2>${escapeHtml(candidate.name)} — Mis registros (${ultimosFiltrados.length})</h2>
        <table><thead><tr><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Dirección</th></tr></thead>
        <tbody>${ultimosFiltrados.map(r => `<tr><td>${escapeHtml(r.cedula)}</td><td>${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.local)}</td><td>${escapeHtml(r.mesa)}</td><td>${escapeHtml(r.orden)}</td><td>${escapeHtml(r.telefono)}</td><td>${escapeHtml(r.direccion)}</td></tr>`).join('')}</tbody>
        </table></body></html>
      `)
      printWindow.document.close()
      setTimeout(() => { printWindow.focus(); printWindow.print() }, 300)
    })
  }

  async function renderUsuarios(content) {
    // Qué grupos de rol quedan desplegados — sobrevive a los re-renders de
    // loadUsersList() dentro de esta misma visita a la pestaña (crear
    // usuario, cambiar rol, etc. no deben volver a cerrar todo).
    const rolesEquipoExpandidos = new Set()
    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px; margin-bottom:16px;">
        <h2 style="margin:0 0 12px; font-size:1.05rem;">➕ Crear usuario</h2>
        <form id="form-crear-usuario" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
          <input required name="nombre" placeholder="Nombre" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input required name="email" type="email" placeholder="Email" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="cedula" placeholder="CI" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input name="telefono" placeholder="Teléfono (WhatsApp)" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <select name="role" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
          <button type="submit" style="padding:8px; background:${candidate.primaryColor || '#1f4b7a'}; color:white; border:none; border-radius:4px; font-weight:700; cursor:pointer;">Crear</button>
        </form>
        <div id="autocompletar-ci-msg" style="font-size:.78rem; color:#666; margin-top:6px;"></div>
        <div id="advertencia-ci" style="display:none; background:#fff3cd; border-left:4px solid #ffc107; color:#856404; padding:10px; border-radius:4px; margin-top:12px; font-size:.82rem;">
          Esta CI no está en el padrón de votantes. ¿Desea guardarlo igual?
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button type="button" id="btn-volver-ci" style="flex:1; background:#999; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem;">Volver y corregir CI</button>
            <button type="button" id="btn-crear-igual" style="flex:1; background:#d32f2f; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem; font-weight:700;">Crear igual</button>
          </div>
        </div>
        <div id="crear-usuario-msg" style="margin-top:8px; font-size:.85rem;"></div>
      </div>
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px; margin-bottom:16px;">
        <h2 style="margin:0 0 8px; font-size:1.05rem;">🔗 Invitar por link</h2>
        <p style="font-size:.82rem; color:#666; margin:0 0 12px;">Generá un link para que cualquiera que lo reciba cree su propia cuenta con el rol que elijas acá — no hace falta que le generes una contraseña vos. Sirve para varias personas (todas con ese mismo rol) durante 7 días.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <select id="sel-invite-role" style="flex:1; min-width:180px; padding:8px; border:1px solid #ccc; border-radius:4px;">
            <option value="">-- Elegí un rol --</option>
            ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
          <button id="btn-generar-invitacion" style="padding:8px 16px; background:${candidate.primaryColor || '#1f4b7a'}; color:white; border:none; border-radius:4px; font-weight:700; cursor:pointer;">Generar link</button>
        </div>
        <div id="invitacion-resultado" style="margin-top:12px;"></div>
      </div>
      <div id="usuarios-list" style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px;">Cargando...</div>
    `

    document.getElementById('btn-generar-invitacion').addEventListener('click', async () => {
      const rol = document.getElementById('sel-invite-role').value
      const resultEl = document.getElementById('invitacion-resultado')
      // Sin esto, el <select> podía quedar en lo que sea que haya elegido
      // la última persona que generó un link en esta pestaña (o en el
      // primer valor de la lista si nadie tocó nada) y se generaba una
      // invitación con un rol distinto al que se pensaba elegir, sin
      // ningún aviso — bug real reportado en vivo.
      if (!rol) {
        resultEl.innerHTML = `<div class="alert alert-error">❌ Elegí un rol antes de generar el link.</div>`
        return
      }
      resultEl.textContent = 'Generando...'
      try {
        const crearInvitacion = httpsCallable(functionsInstance, 'crearInvitacion')
        const result = await crearInvitacion({ candidateId, rol })
        const link = `${APP_URL}?invite=${result.data.inviteId}`
        resultEl.innerHTML = `
          <div style="background:#f0f7ff; border:1px solid #b3d7ff; border-radius:6px; padding:12px;">
            <div style="font-size:.82rem; color:#333; margin-bottom:8px;">Link para <strong>${escapeHtml(ROLE_LABELS[rol] || rol)}</strong>:</div>
            <input id="inp-invite-link" readonly value="${escapeHtml(link)}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-bottom:8px; box-sizing:border-box; font-size:.8rem;">
            <div style="display:flex; gap:8px;">
              <button id="btn-copiar-invitacion" style="flex:1; background:#4caf50; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem; font-weight:600;">📋 Copiar</button>
              <button id="btn-wa-invitacion" style="flex:1; background:#25d366; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:.8rem; font-weight:600;">📲 WhatsApp</button>
            </div>
          </div>
        `
        document.getElementById('btn-copiar-invitacion').addEventListener('click', async () => {
          await navigator.clipboard.writeText(link)
          const btnCopiar = document.getElementById('btn-copiar-invitacion')
          btnCopiar.textContent = '✅ Copiado'
          setTimeout(() => { btnCopiar.textContent = '📋 Copiar' }, 1500)
        })
        document.getElementById('btn-wa-invitacion').addEventListener('click', () => {
          const msg = `Te invito a sumarte al equipo de ${candidate.name || 'la campaña'} como ${ROLE_LABELS[rol] || rol}. Creá tu cuenta acá: ${link}`
          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
        })
      } catch (err) {
        resultEl.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`
      }
    })

    const form = document.getElementById('form-crear-usuario')

    // Autocompletar por CI: primero busca en Registros (savedRecords) de
    // este candidato — trae nombre y teléfono ya cargados por un
    // dirigente. Si no está ahí, cae al padrón compartido (solo nombre,
    // que es lo único que tiene). Nunca pisa lo que el admin ya escribió
    // a mano en esos campos.
    form.querySelector('[name="cedula"]').addEventListener('blur', async () => {
      const cedula = form.querySelector('[name="cedula"]').value.trim()
      const msgEl = document.getElementById('autocompletar-ci-msg')
      if (!cedula) { msgEl.textContent = ''; return }

      const nombreInput = form.querySelector('[name="nombre"]')
      const telefonoInput = form.querySelector('[name="telefono"]')
      msgEl.textContent = '🔎 Buscando datos de esta CI...'
      try {
        const registro = await getRecordByCedula(candidateId, cedula)
        if (registro) {
          if (!nombreInput.value.trim()) nombreInput.value = registro.nombre || ''
          if (!telefonoInput.value.trim()) telefonoInput.value = registro.telefono || ''
          msgEl.textContent = '✅ Datos completados desde Registros.'
          return
        }
        const enPadron = await searchVoterByCedula(cedula)
        if (enPadron.length > 0) {
          if (!nombreInput.value.trim()) nombreInput.value = enPadron[0].nombre || ''
          msgEl.textContent = '✅ Nombre completado desde el padrón.'
          return
        }
        msgEl.textContent = ''
      } catch (err) {
        msgEl.textContent = ''
      }
    })

    async function crearUsuario() {
      const fd = new FormData(form)
      const msg = document.getElementById('crear-usuario-msg')
      document.getElementById('advertencia-ci').style.display = 'none'
      msg.textContent = 'Creando...'
      const nombre = fd.get('nombre').trim()
      const email = fd.get('email').trim()
      const cedula = fd.get('cedula').trim()
      const telefono = fd.get('telefono').trim()
      const rol = fd.get('role')
      try {
        const crearUsuarioCandidato = httpsCallable(functionsInstance, 'crearUsuarioCandidato')
        const password = cryptoRandomPassword()
        const result = await crearUsuarioCandidato({
          candidateId, nombre, email, rol, cedula, telefono, password
        })
        msg.innerHTML = `✅ ${escapeHtml(result.data.mensaje)}<br>Contraseña: <strong>${escapeHtml(password)}</strong> (copiala ahora)`
        form.reset()
        loadUsersList()
      } catch (err) {
        msg.innerHTML = `❌ ${escapeHtml(err.message)}`
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const cedula = new FormData(form).get('cedula').trim()
      if (cedula) {
        const enPadron = await searchVoterByCedula(cedula)
        if (enPadron.length === 0) {
          document.getElementById('advertencia-ci').style.display = 'block'
          return
        }
      }
      crearUsuario()
    })

    document.getElementById('btn-volver-ci').addEventListener('click', () => {
      document.getElementById('advertencia-ci').style.display = 'none'
      form.querySelector('[name="cedula"]').focus()
    })
    document.getElementById('btn-crear-igual').addEventListener('click', crearUsuario)

    async function loadUsersList() {
      const listEl = document.getElementById('usuarios-list')
      listEl.innerHTML = 'Cargando...'
      const [users, records] = await Promise.all([
        getAllCandidateUsers(candidateId),
        getAllRecords(candidateId)
      ])
      const porUsuario = {}
      records.forEach(r => { porUsuario[r.uid] = (porUsuario[r.uid] || 0) + 1 })
      const ranking = users
        .map(u => ({ ...u, cantidad: porUsuario[u.id] || 0 }))
        .sort((a, b) => b.cantidad - a.cantidad)
      const topUid = ranking.length && ranking[0].cantidad > 0 ? ranking[0].id : null

      listEl.innerHTML = `
        <h2 style="margin:0 0 12px; font-size:1.05rem;">🏆 Equipo (${ranking.length})</h2>
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div class="filter-input-wrap" style="margin-bottom:16px;"><input id="inp-buscar-equipo" class="filter-input" placeholder="Buscar por nombre, CI o rol..."></div>
        <div id="lista-equipo"></div>
      `
      const equipoEl = document.getElementById('lista-equipo')

      function tarjetaUsuario(u) {
        const esTop = u.id === topUid
        return `
            <div style="border:1px solid #eee; border-radius:6px; padding:14px; background:${esTop ? '#fff9c4' : '#f9f9f9'};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <div>
                  <div style="font-weight:700;">${esTop ? '🥇 ' : ''}${escapeHtml(u.nombre || u.email)}</div>
                  <div style="font-size:.75rem; color:#666;">${escapeHtml(u.email)}</div>
                  <span style="display:inline-block; margin-top:4px; background:${roleColor(u.role)}; color:white; padding:2px 8px; border-radius:3px; font-size:.7rem; font-weight:700;">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:1.2rem; font-weight:700; color:${candidate.primaryColor || '#1f4b7a'};">${u.cantidad}</div>
                  <div style="font-size:.7rem; color:#666;">registros</div>
                </div>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:${u.telefono ? '6px' : '0'};">
                <button class="btn-editar-rol" data-uid="${u.id}" style="flex:1; min-width:90px; background:#2196f3; color:white; border:none; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">✏️ Rol</button>
                <button class="btn-cambiar-pass" data-uid="${u.id}" style="flex:1; min-width:90px; background:#ff9800; color:white; border:none; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">🔐 Contraseña</button>
                <button class="btn-asignar-mesa" data-uid="${u.id}" style="flex:1; min-width:90px; background:#4caf50; color:white; border:none; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">📍 Mesa/Local</button>
                <button class="btn-borrar-usuario" data-uid="${u.id}" style="flex:1; min-width:90px; background:#d32f2f; color:white; border:none; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">🗑️ Borrar</button>
              </div>
              ${u.telefono ? `
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <a class="btn-wa-blanco-usuario" data-tel="${escapeHtml(u.telefono)}" href="https://wa.me/${normalizarTelefonoPY(u.telefono)}" target="_blank" rel="noopener" style="flex:1; min-width:90px; text-align:center; text-decoration:none; background:#25d366; color:white; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">💬 Mensaje en blanco</a>
                  <button class="btn-wa-acceso" data-uid="${u.id}" style="flex:1; min-width:90px; background:#128c7e; color:white; border:none; padding:7px 10px; border-radius:4px; cursor:pointer; font-size:.78rem; font-weight:600;">💬 Enviar acceso</button>
                </div>
              ` : ''}
            </div>
        `
      }

      function bindTarjetaHandlers() {
        equipoEl.querySelectorAll('.btn-editar-rol').forEach(btn => {
          btn.addEventListener('click', () => modalEditarRol(ranking.find(u => u.id === btn.dataset.uid)))
        })
        equipoEl.querySelectorAll('.btn-cambiar-pass').forEach(btn => {
          btn.addEventListener('click', () => modalCambiarPassword(ranking.find(u => u.id === btn.dataset.uid)))
        })
        equipoEl.querySelectorAll('.btn-asignar-mesa').forEach(btn => {
          btn.addEventListener('click', () => modalAsignarMesa(ranking.find(u => u.id === btn.dataset.uid)))
        })
        equipoEl.querySelectorAll('.btn-borrar-usuario').forEach(btn => {
          btn.addEventListener('click', () => modalBorrarUsuario(ranking.find(u => u.id === btn.dataset.uid)))
        })
        // No guardamos contraseñas (Fase 1 de seguridad), así que para
        // mandar el acceso por WhatsApp hay que generar una nueva primero
        // — por eso pide confirmación, ya que cambia la que tenía.
        equipoEl.querySelectorAll('.btn-wa-acceso').forEach(btn => {
          btn.addEventListener('click', () => enviarAccesoWhatsapp(ranking.find(u => u.id === btn.dataset.uid)))
        })
      }

      function pintarEquipo(filtro = '') {
        const termino = filtro.trim().toLowerCase()
        const filtrados = !termino ? ranking : ranking.filter(u =>
          String(u.nombre || '').toLowerCase().includes(termino) ||
          String(u.email || '').toLowerCase().includes(termino) ||
          String(u.cedula || '').toLowerCase().includes(termino) ||
          String(u.role || '').toLowerCase().includes(termino) ||
          String(ROLE_LABELS[u.role] || '').toLowerCase().includes(termino)
        )

        if (filtrados.length === 0) {
          equipoEl.innerHTML = `<div style="color:#999;">${ranking.length === 0 ? 'Sin usuarios todavía.' : 'Sin resultados.'}</div>`
          return
        }

        // Buscando algo puntual: lista plana, sin importar el rol. Sin
        // búsqueda: agrupado por rol y comprimido (accordion), para no
        // desplazar una lista larga — el estado abierto/cerrado se
        // recuerda en rolesEquipoExpandidos mientras dura esta visita a
        // la pestaña.
        if (termino) {
          equipoEl.innerHTML = `<div style="display:grid; gap:12px;">${filtrados.map(tarjetaUsuario).join('')}</div>`
          bindTarjetaHandlers()
          return
        }

        const porRol = {}
        filtrados.forEach(u => {
          const key = u.role || 'sin_rol'
          if (!porRol[key]) porRol[key] = []
          porRol[key].push(u)
        })
        const rolesOrdenados = [...Object.keys(ROLE_LABELS), ...Object.keys(porRol)]
          .filter((r, idx, arr) => porRol[r]?.length && arr.indexOf(r) === idx)

        equipoEl.innerHTML = rolesOrdenados.map(rol => {
          const usuariosDelRol = porRol[rol]
          const abierto = rolesEquipoExpandidos.has(rol)
          return `
            <div style="border:1px solid #eee; border-radius:6px; margin-bottom:10px; overflow:hidden;">
              <button class="btn-toggle-rol-equipo" data-rol="${escapeHtml(rol)}" style="width:100%; text-align:left; background:${roleColor(rol)}; color:white; border:none; padding:12px 14px; cursor:pointer; font-weight:700; display:flex; justify-content:space-between; align-items:center; font-size:.9rem;">
                <span>${escapeHtml(ROLE_LABELS[rol] || rol)} (${usuariosDelRol.length})</span>
                <span>${abierto ? '▲' : '▼'}</span>
              </button>
              ${abierto ? `<div style="padding:12px; display:grid; gap:12px;">${usuariosDelRol.map(tarjetaUsuario).join('')}</div>` : ''}
            </div>
          `
        }).join('')

        equipoEl.querySelectorAll('.btn-toggle-rol-equipo').forEach(btn => {
          btn.addEventListener('click', () => {
            const rol = btn.dataset.rol
            if (rolesEquipoExpandidos.has(rol)) rolesEquipoExpandidos.delete(rol)
            else rolesEquipoExpandidos.add(rol)
            pintarEquipo(document.getElementById('inp-buscar-equipo').value)
          })
        })
        bindTarjetaHandlers()
      }

      pintarEquipo()
      document.getElementById('inp-buscar-equipo').addEventListener('input', debounce((e) => pintarEquipo(e.target.value), 250))
    }

    async function enviarAccesoWhatsapp(u) {
      const telLimpio = normalizarTelefonoPY(u.telefono)
      if (!telLimpio) return
      if (!confirm(`Esto va a generar una contraseña nueva para ${u.nombre || u.email} (se pierde la anterior). ¿Continuar?`)) return
      try {
        const resetPass = httpsCallable(functionsInstance, 'resetearPasswordUsuarioCandidato')
        const result = await resetPass({ candidateId, uid: u.id, newPassword: undefined })
        const password = result.data.generatedPassword
        const msgAcceso = encodeURIComponent(
          `Hola ${u.nombre || u.email}, ya tenés acceso al sistema de campaña de "${candidate.name}". ` +
          `Entrá en ${APP_URL} con tu usuario "${u.email}" y contraseña "${password}".`
        )
        window.open(`https://wa.me/${telLimpio}?text=${msgAcceso}`, '_blank')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    }

    function abrirModal(html) {
      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;'
      modal.innerHTML = `<div style="background:white; border-radius:8px; padding:24px; max-width:420px; width:100%;">${html}</div>`
      document.body.appendChild(modal)
      return modal
    }

    function modalEditarRol(u) {
      const modal = abrirModal(`
        <h3 style="margin:0 0 16px;">Editar rol de ${escapeHtml(u.nombre || u.email)}</h3>
        <select id="sel-nuevo-rol" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px;">
          ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}" ${v === u.role ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar" style="flex:1; background:#2196f3; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      `)
      modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
      modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
        const newRole = modal.querySelector('#sel-nuevo-rol').value
        try {
          const cambiarRol = httpsCallable(functionsInstance, 'cambiarRolUsuarioCandidato')
          await cambiarRol({ candidateId, uid: u.id, newRole })
          modal.remove()
          loadUsersList()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }

    function modalCambiarPassword(u) {
      const modal = abrirModal(`
        <h3 style="margin:0 0 16px;">Nueva contraseña para ${escapeHtml(u.nombre || u.email)}</h3>
        <input id="inp-nueva-pass" placeholder="Dejar vacío para generar una segura" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; box-sizing:border-box;">
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar" style="flex:1; background:#ff9800; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      `)
      modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
      modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
        const newPassword = modal.querySelector('#inp-nueva-pass').value.trim()
        try {
          const resetPass = httpsCallable(functionsInstance, 'resetearPasswordUsuarioCandidato')
          const result = await resetPass({ candidateId, uid: u.id, newPassword: newPassword || undefined })
          if (result.data?.generatedPassword) {
            alert(`Contraseña generada: ${result.data.generatedPassword}\n\nCopiala ahora, no se vuelve a mostrar.`)
          } else {
            alert('Contraseña actualizada.')
          }
          modal.remove()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }

    function modalAsignarMesa(u) {
      const modal = abrirModal(`
        <h3 style="margin:0 0 16px;">Mesa/Local de ${escapeHtml(u.nombre || u.email)}</h3>
        <input id="inp-seccional" value="${escapeHtml(u.seccional || '')}" placeholder="Seccional" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
        <input id="inp-local" value="${escapeHtml(u.local || '')}" placeholder="Local" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
        <input id="inp-mesa" value="${escapeHtml(u.mesa || '')}" placeholder="Mesa" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; box-sizing:border-box;">
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar" style="flex:1; background:#4caf50; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      `)
      modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
      modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
        try {
          await updateCandidateUserMesaLocal(candidateId, u.id, {
            seccional: modal.querySelector('#inp-seccional').value.trim(),
            local: modal.querySelector('#inp-local').value.trim(),
            mesa: modal.querySelector('#inp-mesa').value.trim()
          })
          modal.remove()
          loadUsersList()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }

    function modalBorrarUsuario(u) {
      if (!confirm(`¿Borrar el perfil de ${u.nombre || u.email}? No podrá seguir usando el panel de este candidato (su cuenta de login no se borra).`)) return
      deleteCandidateUser(candidateId, u.id)
        .then(loadUsersList)
        .catch(err => alert('Error: ' + err.message))
    }

    loadUsersList()
  }

  function roleColor(role) {
    const colors = {
      campaign_admin: '#ff9800',
      coordinator: '#3f51b5',
      dirigente: '#9c27b0',
      mesario: '#2196f3',
      operador: '#6a1b9a',
      chofer: '#c41e3a',
      viewer: '#607d8b',
      auditor: '#795548'
    }
    return colors[role] || '#999'
  }

  // Port de admin.js:renderResumen/loadAndRenderRecords — todos los
  // registros con búsqueda, stats, exportar e imprimir. listRecordsPage
  // quedó para otros usos paginados; acá se trae todo de una porque el
  // volumen de un candidato individual es chico (a diferencia de Samy).
  async function renderRegistros(content) {
    content.innerHTML = '<div style="color:#999;">Cargando...</div>'
    // Auditoría RBAC (scopes restringidos): un rol personalizado con
    // records.view de alcance angosto (propios/asignados/equipo/zona/
    // local/mesa) NO tiene por qué poder traer TODO el candidato — el
    // getAllRecords de abajo solo es correcto para quien ya tiene alcance
    // amplio (rol legacy de TAB_ROLES, o all_candidate/all_platform vía
    // rol personalizado). Para cualquier otro caso se arma una consulta
    // ya acotada (getSavedRecordsByScope), nunca "traer todo y filtrar".
    const scopesRecordsView = getGrantedScopes(misRoles, 'records.view')
    const tieneAlcanceAmplio = TAB_ROLES.registros.includes(myRole) ||
      scopesRecordsView.includes('all_candidate') || scopesRecordsView.includes('all_platform')
    if (!tieneAlcanceAmplio) {
      return renderRegistrosPorScope(content, scopesRecordsView)
    }

    // Solo campaign_admin: firestore.rules únicamente permite actualizar
    // savedRecords ajenos a campaign_admin (y al propio dirigente dueño) —
    // coordinator/viewer/auditor ven Registros pero no pueden escribir acá,
    // así que ni se les muestra el botón de editar.
    const puedeEditarReg = puedeCompat('records.edit', ['campaign_admin'])
    const [records, users] = await Promise.all([
      getAllRecords(candidateId),
      getAllCandidateUsers(candidateId)
    ])
    const usuariosMap = {}
    users.forEach(u => { usuariosMap[u.id] = u.nombre || u.email || 'N/A' })

    const opcion = (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    const locales = [...new Set(records.map(r => r.local).filter(Boolean))].sort()
    const mesas = [...new Set(records.map(r => r.mesa).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    const dirigentesConRegistros = [...new Set(records.map(r => r.uid).filter(Boolean))]
      .map(uid => ({ uid, nombre: usuariosMap[uid] || 'N/A' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))

    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:16px;">
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:10px;">
          <div class="filter-input-wrap"><input id="input-buscar-reg" class="filter-input" placeholder="Buscar por cédula o nombre..." value="${escapeHtml(ultimoBuscadoRegistros)}"></div>
          <select id="sel-local-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todos los locales</option>
            ${locales.map(opcion).join('')}
          </select>
          <select id="sel-mesa-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todas las mesas</option>
            ${mesas.map(opcion).join('')}
          </select>
          <select id="sel-dirigente-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todos los dirigentes</option>
            ${dirigentesConRegistros.map(d => `<option value="${escapeHtml(d.uid)}">${escapeHtml(d.nombre)}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:10px;">
          <select id="sel-chofer-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Chofer: todos</option>
            <option value="si">Chofer: Sí</option>
            <option value="no">Chofer: No</option>
          </select>
          <select id="sel-mesario-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Mesario: todos</option>
            <option value="si">Mesario: Sí</option>
            <option value="no">Mesario: No</option>
          </select>
          <select id="sel-ayuda-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Ayuda Gs.: todos</option>
            <option value="si">Ayuda Gs.: Sí</option>
            <option value="no">Ayuda Gs.: No</option>
          </select>
          <select id="sel-transporte-reg" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Transporte: todos</option>
            <option value="si">Transporte: Sí</option>
            <option value="no">Transporte: No</option>
          </select>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-limpiar-reg" style="background:#999; color:white; border:none; padding:10px 18px; border-radius:4px; cursor:pointer; font-weight:600;">✕ Limpiar filtros</button>
          <button id="btn-export-records" style="background:#d4af37; color:black; border:none; padding:10px 18px; border-radius:4px; font-weight:700; cursor:pointer;">📥 Excel</button>
          <button id="btn-print-records" style="background:#555; color:white; border:none; padding:10px 18px; border-radius:4px; font-weight:700; cursor:pointer;">🖨️ Imprimir</button>
        </div>
      </div>
      <div class="stats-grid">
        ${statCard('Registros totales', records.length)}
        ${statCard('Usuarios activos', new Set(records.map(r => r.uid)).size)}
        ${statCard('Promedio por usuario', records.length && new Set(records.map(r => r.uid)).size ? Math.round(records.length / new Set(records.map(r => r.uid)).size) : 0)}
      </div>
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px;">
        <div id="tabla-registros"></div>
      </div>
    `

    function pintarTabla() {
      const termino = document.getElementById('input-buscar-reg').value.trim().toLowerCase()
      const local = document.getElementById('sel-local-reg').value
      const mesa = document.getElementById('sel-mesa-reg').value
      const dirigenteUid = document.getElementById('sel-dirigente-reg').value
      const chofer = document.getElementById('sel-chofer-reg').value
      const mesario = document.getElementById('sel-mesario-reg').value
      const ayuda = document.getElementById('sel-ayuda-reg').value
      const transporte = document.getElementById('sel-transporte-reg').value
      const matchSiNo = (valor, flag) => !valor || (valor === 'si' ? !!flag : !flag)

      // Los filtros se combinan con AND: cada uno acota más el resultado
      // del anterior, no reemplaza a los demás.
      const filtrados = records.filter(r => {
        if (termino && !(String(r.cedula).toLowerCase().includes(termino) || String(r.nombre).toLowerCase().includes(termino))) return false
        if (local && r.local !== local) return false
        if (mesa && String(r.mesa) !== mesa) return false
        if (dirigenteUid && r.uid !== dirigenteUid) return false
        if (!matchSiNo(chofer, r.canBeDriver)) return false
        if (!matchSiNo(mesario, r.wantsToBeMesario)) return false
        if (!matchSiNo(ayuda, r.needsAssistance)) return false
        if (!matchSiNo(transporte, r.requiresPickup)) return false
        return true
      })

      const hayFiltro = termino || local || mesa || dirigenteUid || chofer || mesario || ayuda || transporte
      const tablaEl = document.getElementById('tabla-registros')
      tablaEl.innerHTML = `
        ${hayFiltro ? `<div style="background:#e3f2fd; border-left:4px solid #1976d2; padding:10px; border-radius:4px; margin-bottom:12px; font-size:.85rem;"><strong>${filtrados.length}</strong> de ${records.length} registros</div>` : ''}
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Dirección / Ubicación</th><th>Dirigente</th><th>Chofer</th><th>Mesario</th><th>Ayuda Gs.</th><th>Transporte</th><th>WhatsApp</th>${puedeEditarReg ? '<th>Acciones</th>' : ''}
            </tr></thead>
            <tbody>
              ${filtrados.map((r, i) => {
                const siNo = (flag) => flag
                  ? '<span style="color:#2e7d32; font-weight:700;">Sí</span>'
                  : '<span style="color:#999;">No</span>'
                const telLimpio = normalizarTelefonoPY(r.telefono)
                const msgSaludo = encodeURIComponent(buildRecordatorioVotoMessage(candidate, r))
                return `<tr style="border-bottom:1px solid #eee; ${hayFiltro ? 'background:#fffacd;' : ''}" data-idx="${i}">
                <td style="padding:6px; font-family:monospace; font-size:.78rem;">${escapeHtml(r.cedula)}</td>
                <td style="padding:6px;"><strong>${escapeHtml(r.nombre)}</strong></td>
                <td>${escapeHtml(r.local)}</td>
                <td>${escapeHtml(r.mesa)}</td>
                <td>${escapeHtml(r.orden)}</td>
                <td>${escapeHtml(r.telefono)}</td>
                <td>${escapeHtml(r.direccion) || '—'}${r.googleMapsUrl ? ` · <a href="${escapeHtml(r.googleMapsUrl)}" target="_blank" rel="noopener">📍 Maps</a>` : ''}</td>
                <td>${escapeHtml(usuariosMap[r.uid] || 'N/A')}</td>
                <td>${siNo(r.canBeDriver)}</td>
                <td>${siNo(r.wantsToBeMesario)}</td>
                <td>${Number(r.montoAyuda) > 0 ? `<strong>Gs. ${Number(r.montoAyuda).toLocaleString('es-PY')}</strong>` : siNo(r.needsAssistance)}</td>
                <td>${siNo(r.requiresPickup)}</td>
                <td>
                  ${telLimpio ? `
                    <div style="display:flex; gap:4px;">
                      <a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:4px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">Blanco</a>
                      <a href="https://wa.me/${telLimpio}?text=${msgSaludo}" target="_blank" rel="noopener" style="text-decoration:none; background:#128c7e; color:white; padding:4px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">Mesa</a>
                    </div>
                  ` : '<span style="color:#999; font-size:.75rem;">sin tel.</span>'}
                </td>
                ${puedeEditarReg ? `<td><button class="btn-editar-reg" data-idx="${i}" style="background:#ff9800; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✏️</button></td>` : ''}
              </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
        ${filtrados.length === 0 ? '<div style="text-align:center; padding:30px; color:#999;">Sin resultados.</div>' : ''}
      `

      if (puedeEditarReg) {
        tablaEl.querySelectorAll('.btn-editar-reg').forEach(btn => {
          btn.addEventListener('click', () => modalEditarRegistro(filtrados[Number(btn.dataset.idx)]))
        })
      }

      return filtrados
    }

    // Edición rápida desde Registros (admin/coordinator): Chofer/Mesario/
    // Ayuda(monto)/Transporte/Teléfono. A diferencia de Mis Registros, acá
    // no hay "Chofer asignado" (eso se maneja en Choferes), así que
    // Transporte sí es un toggle directo — no hay asignación de la que
    // inferirlo en este modal.
    function modalEditarRegistro(r) {
      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px; overflow-y:auto;'
      modal.innerHTML = `
        <div style="background:white; border-radius:8px; padding:24px; max-width:420px; width:100%; margin:20px 0;">
          <h3 style="margin:0 0 4px;">Editar registro</h3>
          <p style="margin:0 0 16px; color:#666; font-size:.85rem;">${escapeHtml(r.nombre)} · CI ${escapeHtml(r.cedula)}</p>

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Teléfono:</label>
          <input id="inp-editreg-telefono" value="${escapeHtml(r.telefono || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:12px; box-sizing:border-box;">

          <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:12px; display:grid; gap:8px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-editreg-driver" ${r.canBeDriver ? 'checked' : ''}> Chofer: ¿puede colaborar el Día D?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-editreg-mesario" ${r.wantsToBeMesario ? 'checked' : ''}> Mesario: ¿quiere sentarse en la mesa?
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:.85rem; cursor:pointer;">
              <input type="checkbox" id="chk-editreg-transporte" ${r.requiresPickup ? 'checked' : ''}> Transporte: ¿requiere que se le busque?
            </label>
          </div>

          <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Ayuda — Editar Monto (Gs.):</label>
          <input id="inp-editreg-monto-ayuda" type="number" min="0" step="1000" value="${Number(r.montoAyuda) || 0}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; box-sizing:border-box;">

          <div id="editreg-msg" style="font-size:.85rem; margin-bottom:8px;"></div>
          <div style="display:flex; gap:8px;">
            <button id="btn-confirmar-editreg" style="flex:1; background:#4caf50; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
            <button id="btn-cancelar-editreg" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)
      modal.querySelector('#btn-cancelar-editreg').addEventListener('click', () => modal.remove())

      modal.querySelector('#btn-confirmar-editreg').addEventListener('click', async () => {
        const msg = modal.querySelector('#editreg-msg')
        const montoAyuda = Number(modal.querySelector('#inp-editreg-monto-ayuda').value) || 0
        try {
          await updateRecord(candidateId, r.id, {
            telefono: modal.querySelector('#inp-editreg-telefono').value.trim(),
            canBeDriver: modal.querySelector('#chk-editreg-driver').checked,
            wantsToBeMesario: modal.querySelector('#chk-editreg-mesario').checked,
            requiresPickup: modal.querySelector('#chk-editreg-transporte').checked,
            montoAyuda,
            needsAssistance: montoAyuda > 0
          })
          msg.innerHTML = '✅ Guardado'
          setTimeout(() => { modal.remove(); renderRegistros(content) }, 600)
        } catch (err) {
          msg.innerHTML = `❌ ${escapeHtml(err.message)}`
        }
      })
    }

    let ultimosFiltrados = pintarTabla()
    const actualizar = () => { ultimosFiltrados = pintarTabla() }

    document.getElementById('input-buscar-reg').addEventListener('input', debounce((e) => {
      ultimoBuscadoRegistros = e.target.value
      actualizar()
    }, 250))
    document.getElementById('sel-local-reg').addEventListener('change', actualizar)
    document.getElementById('sel-mesa-reg').addEventListener('change', actualizar)
    document.getElementById('sel-dirigente-reg').addEventListener('change', actualizar)
    document.getElementById('sel-chofer-reg').addEventListener('change', actualizar)
    document.getElementById('sel-mesario-reg').addEventListener('change', actualizar)
    document.getElementById('sel-ayuda-reg').addEventListener('change', actualizar)
    document.getElementById('sel-transporte-reg').addEventListener('change', actualizar)
    document.getElementById('btn-limpiar-reg').addEventListener('click', () => {
      document.getElementById('input-buscar-reg').value = ''
      document.getElementById('sel-local-reg').value = ''
      document.getElementById('sel-mesa-reg').value = ''
      document.getElementById('sel-dirigente-reg').value = ''
      document.getElementById('sel-chofer-reg').value = ''
      document.getElementById('sel-mesario-reg').value = ''
      document.getElementById('sel-ayuda-reg').value = ''
      document.getElementById('sel-transporte-reg').value = ''
      ultimoBuscadoRegistros = ''
      actualizar()
    })

    // Si hay una búsqueda/filtro activo, pregunta si exportar solo eso o
    // el listado completo sin filtrar — antes exportaba ultimosFiltrados
    // sin avisar, lo que podía confundir a quien buscó una cédula puntual
    // y esperaba el padrón completo (o viceversa).
    function elegirAlcanceExport(hayFiltro, callback) {
      if (!hayFiltro) { callback(records); return }

      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;'
      modal.innerHTML = `
        <div style="background:white; border-radius:8px; padding:24px; max-width:380px; width:100%;">
          <h3 style="margin:0 0 16px;">¿Qué querés exportar?</h3>
          <div style="display:grid; gap:8px;">
            <button id="btn-export-buscado" style="background:#1976d2; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">🔎 Solo lo buscado (${ultimosFiltrados.length})</button>
            <button id="btn-export-todo" style="background:#555; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">📋 Todo el listado (${records.length})</button>
            <button id="btn-export-cancelar" style="background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)
      modal.querySelector('#btn-export-buscado').addEventListener('click', () => { modal.remove(); callback(ultimosFiltrados) })
      modal.querySelector('#btn-export-todo').addEventListener('click', () => { modal.remove(); callback(records) })
      modal.querySelector('#btn-export-cancelar').addEventListener('click', () => modal.remove())
    }

    document.getElementById('btn-export-records').addEventListener('click', () => {
      const hayFiltro = !!ultimoBuscadoRegistros ||
        document.getElementById('sel-local-reg').value || document.getElementById('sel-mesa-reg').value ||
        document.getElementById('sel-dirigente-reg').value || document.getElementById('sel-chofer-reg').value ||
        document.getElementById('sel-mesario-reg').value || document.getElementById('sel-ayuda-reg').value ||
        document.getElementById('sel-transporte-reg').value

      elegirAlcanceExport(hayFiltro, async (registrosAExportar) => {
        const XLSX = await import('xlsx')
        const ws = XLSX.utils.json_to_sheet(registrosAExportar.map(r => ({
          Nombre: r.nombre, Cedula: r.cedula, Local: r.local, Mesa: r.mesa, Orden: r.orden,
          Dirigente: usuariosMap[r.uid] || '', Telefono: r.telefono, Direccion: r.direccion, Ubicacion: r.googleMapsUrl,
          Chofer: r.canBeDriver ? 'Sí' : 'No',
          Mesario: r.wantsToBeMesario ? 'Sí' : 'No',
          AyudaGs: r.needsAssistance ? 'Sí' : 'No',
          Transporte: r.requiresPickup ? 'Sí' : 'No'
        })))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Registros')
        XLSX.writeFile(wb, `registros_${candidateId}_${Date.now()}.xlsx`)
      })
    })

    document.getElementById('btn-print-records').addEventListener('click', () => {
      const hayFiltro = !!ultimoBuscadoRegistros ||
        document.getElementById('sel-local-reg').value || document.getElementById('sel-mesa-reg').value ||
        document.getElementById('sel-dirigente-reg').value || document.getElementById('sel-chofer-reg').value ||
        document.getElementById('sel-mesario-reg').value || document.getElementById('sel-ayuda-reg').value ||
        document.getElementById('sel-transporte-reg').value

      elegirAlcanceExport(hayFiltro, (registrosAExportar) => {
        const printWindow = window.open('', '_blank')
        printWindow.document.write(`
          <html><head><title>Registros - ${escapeHtml(candidate.name)}</title>
          <style>body{font-family:sans-serif;font-size:12px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:4px;text-align:left}</style>
          </head><body>
          <h2>${escapeHtml(candidate.name)} — Registros (${registrosAExportar.length})</h2>
          <table><thead><tr><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Dirección</th></tr></thead>
          <tbody>${registrosAExportar.map(r => `<tr><td>${escapeHtml(r.cedula)}</td><td>${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.local)}</td><td>${escapeHtml(r.mesa)}</td><td>${escapeHtml(r.orden)}</td><td>${escapeHtml(r.telefono)}</td><td>${escapeHtml(r.direccion)}</td></tr>`).join('')}</tbody>
          </table></body></html>
        `)
        printWindow.document.close()
        setTimeout(() => { printWindow.focus(); printWindow.print() }, 300)
      })
    })
  }

  // Vista de "Registros" para un rol personalizado con records.view de
  // alcance ANGOSTO (propios/asignados/equipo/zona/local/mesa) — auditoría
  // RBAC. A diferencia de renderRegistros (arriba, alcance amplio,
  // getAllRecords + filtrado en memoria), acá la consulta ya nace acotada
  // (getSavedRecordsByScope) y se pagina con cursor — nunca trae más de lo
  // que ese scope autoriza. No tiene los filtros combinables de la vista
  // admin (no hacen falta: el propio scope YA es el filtro).
  async function renderRegistrosPorScope(content, scopes) {
    let registros = []
    let cursor = null
    let hasMore = false

    const etiquetaScope = scopes.includes('team') ? 'de tu equipo'
      : scopes.includes('zone') ? 'de tu zona'
      : scopes.includes('polling_place') ? 'de tu local'
      : scopes.includes('table') ? 'de tu mesa'
      : scopes.includes('assigned') ? 'asignados a vos'
      : scopes.includes('own') ? 'propios'
      : ''

    content.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px;">
        <h2 style="margin:0 0 12px; font-size:1.05rem;">📋 Registros ${etiquetaScope}</h2>
        <div id="rps-lista"><div style="color:#999;">Cargando...</div></div>
        <div style="text-align:center; margin-top:12px;"><button id="rps-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
      </div>
    `

    async function cargar(reset) {
      if (reset) { registros = []; cursor = null }
      try {
        const resultado = await getSavedRecordsByScope(candidateId, user.uid, candidateUserDoc, misRoles, 'records.view', { cursor, pageSize: 50 })
        registros = reset ? resultado.records : [...registros, ...resultado.records]
        cursor = resultado.lastDoc
        hasMore = resultado.hasMore
        pintar()
      } catch (err) {
        document.getElementById('rps-lista').innerHTML = `<div style="color:#c62828;">Error: ${escapeHtml(err.message)}</div>`
      }
    }

    function pintar() {
      const listaEl = document.getElementById('rps-lista')
      if (registros.length === 0) {
        listaEl.innerHTML = '<div style="color:#999; padding:16px; text-align:center;">Sin registros en tu alcance todavía.</div>'
      } else {
        listaEl.innerHTML = `
          <div style="font-size:.82rem; color:#666; margin-bottom:8px;"><strong>${registros.length}</strong> registro${registros.length === 1 ? '' : 's'}</div>
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
              <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Nombre</th><th>Cédula</th><th>Teléfono</th><th>Local</th><th>Mesa</th></tr></thead>
              <tbody>${registros.map(r => `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.cedula)}</td><td>${escapeHtml(r.telefono) || '—'}</td>
                <td>${escapeHtml(r.local) || '—'}</td><td>${escapeHtml(r.mesa) || '—'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        `
      }
      const btnMas = document.getElementById('rps-btn-mas')
      btnMas.style.display = hasMore ? 'inline-block' : 'none'
      btnMas.onclick = () => cargar(false)
    }

    await cargar(true)
  }

  // Port de admin.js:renderAuditoria — detección de cédulas duplicadas
  // entre registros guardados, candidato-scoped.
  async function renderAuditoria(content) {
    content.innerHTML = '<div style="color:#999;">⏳ Analizando registros...</div>'
    try {
      const [duplicados, users] = await Promise.all([
        getDuplicateCedulas(candidateId),
        getAllCandidateUsers(candidateId)
      ])
      const usuariosMap = {}
      users.forEach(u => { usuariosMap[u.id] = u.nombre || u.email || 'N/A' })

      content.innerHTML = `
        <div style="background:#eef3f8; border:1px solid #cfe0ee; border-radius:8px; padding:14px; margin-bottom:16px; font-size:.85rem; color:#1f4b7a;">
          Esta pestaña compara el padrón desde dos ángulos distintos — mirá el color de cada sección para no confundirlos:
          <strong>🟠 naranja</strong> = coincidencias adentro de tu propio equipo, <strong>🔵 azul</strong> = coincidencias con otras campañas de la plataforma.
        </div>

        <div style="background:white; border:2px solid #ffc107; border-radius:8px; padding:20px; margin-bottom:20px;">
          <h2 style="margin:0 0 4px; font-size:1.05rem;">🟠 1. Entre dirigentes y usuarios de tu equipo</h2>
          <p style="margin:0 0 12px; font-size:.8rem; color:#666;">Un mismo votante guardado más de una vez por distintos dirigentes/usuarios de ESTE candidato.</p>
          <div style="background:${duplicados.length > 0 ? '#fff3cd' : '#d4edda'}; border:1px solid ${duplicados.length > 0 ? '#ffc107' : '#28a745'}; color:${duplicados.length > 0 ? '#856404' : '#155724'}; padding:12px; border-radius:4px; margin-bottom:20px;">
            <strong>${duplicados.length > 0 ? '⚠️' : '✅'}</strong> ${duplicados.length === 0 ? 'No hay duplicados detectados' : `Se encontraron ${duplicados.length} cédulas duplicadas`}
          </div>
          ${duplicados.length > 0 ? `
            <div style="display:grid; gap:12px;">
              ${duplicados.map(dup => `
                <div style="border:1px solid #ddd; border-radius:4px; padding:12px; background:#f9f9f9;">
                  <div style="font-weight:700; margin-bottom:8px;">Cédula: ${escapeHtml(dup.cedula)}</div>
                  <div style="font-size:.9rem; color:#666; margin-bottom:12px;">${dup.registros.length} registros encontrados</div>
                  ${dup.registros.map((r, idx) => `
                    <div style="background:white; padding:8px; border-radius:3px; margin-bottom:6px; font-size:.85rem;">
                      <span style="font-weight:600;">Registro ${idx + 1}:</span> ${escapeHtml(r.nombre)} |
                      <span style="color:#666;">Cargado por: ${escapeHtml(usuariosMap[r.uid] || 'N/A')}</span> |
                      <span style="color:#666;">Guardado: ${r.savedAt?.toDate?.().toLocaleString('es-PY') || '—'}</span>
                    </div>
                  `).join('')}
                  <button class="btn-ver-detalles" data-cedula="${escapeHtml(dup.cedula)}" style="background:#2196f3; color:white; border:none; padding:6px 12px; border-radius:3px; cursor:pointer; font-size:.8rem; font-weight:600; margin-top:8px;">👁️ Ver Detalles</button>
                  <div class="detalles-duplicados" data-cedula="${escapeHtml(dup.cedula)}" style="display:none; margin-top:8px; padding-top:8px; border-top:1px solid #ddd;"></div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <div style="background:white; border:2px solid #1976d2; border-radius:8px; padding:20px;">
          <h2 style="margin:0 0 4px; font-size:1.05rem;">🔵 2. Con otros candidatos que usan este sistema</h2>
          <p style="margin:0 0 12px; font-size:.8rem; color:#666;">Votantes de TU padrón que también fueron guardados por otra campaña de la plataforma. Por privacidad, no se muestra de qué candidato se trata ni sus datos — solo que existe la coincidencia.</p>
          <div id="coincidencias-otros-candidatos" style="color:#999;">⏳ Comparando con otros candidatos...</div>
        </div>
      `

      cargarCoincidenciasOtrosCandidatos()

      content.querySelectorAll('.btn-ver-detalles').forEach(btn => {
        btn.addEventListener('click', () => {
          const cedula = btn.dataset.cedula
          const dup = duplicados.find(d => d.cedula === cedula)
          const detailsEl = content.querySelector(`.detalles-duplicados[data-cedula="${cedula}"]`)

          if (detailsEl.style.display === 'none') {
            detailsEl.innerHTML = dup.registros.map(r => `
              <div style="background:#f5f5f5; padding:8px; border-radius:3px; margin-bottom:6px; font-size:.8rem;">
                <span style="font-weight:600;">${escapeHtml(r.nombre)}</span>
                <button class="btn-delete-dup" data-rec-id="${r.id}" style="background:#d32f2f; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.75rem; font-weight:600; float:right;">🗑️ Borrar</button>
              </div>
              <div style="font-size:.85rem; color:#666; margin-bottom:6px;">
                <strong>Cargado por:</strong> ${escapeHtml(usuariosMap[r.uid] || 'N/A')} <br>
                <strong>Guardado:</strong> ${r.savedAt?.toDate?.().toLocaleString('es-PY') || '—'} <br>
                <strong>Teléfono:</strong> ${escapeHtml(r.telefono) || '—'} <br>
                <strong>Nota:</strong> ${escapeHtml(r.nota) || '—'}
              </div>
            `).join('')
            detailsEl.style.display = 'block'
            btn.textContent = '👁️ Ocultar'

            detailsEl.querySelectorAll('.btn-delete-dup').forEach(delBtn => {
              delBtn.addEventListener('click', async () => {
                if (!confirm('⚠️ ¿Borrar este registro duplicado? Esta acción no se puede deshacer.')) return
                try {
                  await deleteRecord(candidateId, delBtn.dataset.recId)
                  renderAuditoria(content)
                } catch (err) {
                  alert('❌ Error al eliminar: ' + err.message)
                }
              })
            })
          } else {
            detailsEl.style.display = 'none'
            btn.textContent = '👁️ Ver Detalles'
          }
        })
      })
    } catch (err) {
      content.innerHTML = `<div style="color:red;"><strong>Error:</strong> ${escapeHtml(err.message)}</div>`
    }
  }

  // Sección 2 de Auditoría — corre server-side (Cloud Function con Admin
  // SDK) porque firestore.rules justamente prohíbe leer savedRecords de
  // otro candidato; el resultado nunca trae de qué candidato se trata,
  // solo cuántos otros tienen la misma cédula.
  async function cargarCoincidenciasOtrosCandidatos() {
    const el = document.getElementById('coincidencias-otros-candidatos')
    if (!el) return
    try {
      const auditar = httpsCallable(functionsInstance, 'auditarCoincidenciasEntreCandidatos')
      const result = await auditar({ candidateId })
      const { coincidencias, totalPropio } = result.data

      if (coincidencias.length === 0) {
        el.innerHTML = `<div style="background:#d4edda; border:1px solid #28a745; color:#155724; padding:12px; border-radius:4px;"><strong>✅</strong> Ninguno de tus ${totalPropio} votantes guardados coincide con otro candidato de la plataforma.</div>`
        return
      }

      el.innerHTML = `
        <div style="background:#e3f2fd; border:1px solid #1976d2; color:#0d47a1; padding:12px; border-radius:4px; margin-bottom:16px;">
          <strong>🔵</strong> ${coincidencias.length} de tus ${totalPropio} votantes también aparecen en al menos otra campaña.
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Cédula</th><th>Aparece en</th></tr></thead>
            <tbody>
              ${coincidencias.map(c => `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px; font-family:monospace;">${escapeHtml(c.cedula)}</td>
                <td>${c.otrosCandidatos} otro${c.otrosCandidatos === 1 ? '' : 's'} candidato${c.otrosCandidatos === 1 ? '' : 's'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `
    } catch (err) {
      el.innerHTML = `<div style="color:red;">Error: ${escapeHtml(err.message)}</div>`
    }
  }

  render()
}

function cryptoRandomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}
