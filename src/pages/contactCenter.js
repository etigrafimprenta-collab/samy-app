// MÓDULO: Centro de Contacto Electoral (candidato-scoped) — llamadas de
// pre-campaña, seguimiento e incidencias, y monitoreo rápido Día D.
//
// voterId en TODO este módulo es el id de un doc de savedRecords de este
// candidato (donde ya viven teléfono/dirección/flags), NUNCA del padrón
// compartido /voters — ver firebaseCandidate.js. candidateId siempre
// llega desde la sesión resuelta en campaign.js, nunca se lee de un
// campo editable acá.
//
// ESCALA (50k-100k votantes): la vista de admin/coordinador NO precarga
// savedRecords/callAssignments/electionStatus completos — cada pestaña
// trae solo lo que necesita, con where()+limit() o count(). La vista de
// operador sigue precargando todo en cargarDatos() porque ya está acotada
// de por sí (getMyCallAssignments/getMyElectionStatuses/getMyIncidents
// solo traen lo asignado a ese operador, nunca el pool completo).
import {
  getAllCandidateUsers,
  getRecordsByIds,
  getMyCallAssignments,
  assignVoterToOperator,
  assignVotersToOperatorBulk,
  reassignVoter,
  updateCallAssignmentStatus,
  getMyElectionStatuses,
  upsertElectionStatus,
  getCallHistory,
  getMyCallHistory,
  getCallsSince,
  registerCall,
  getPendingFollowUps,
  getMyPendingFollowUps,
  completeFollowUp,
  getAllIncidents,
  getMyIncidents,
  createIncident,
  updateIncidentStatus,
  getCallAssignmentStatusCount,
  getElectionStatusFlagCounts,
  getOpenIncidentsCount,
  getCallAssignmentsPage,
  getElectionStatusByFlag,
  getOpenIncidents,
  getElectionStatusesByIds,
  getCallAssignmentsByIds,
  getRecentCallAssignments,
  getCallAssignmentCountForOperator,
  getElectionStatusFlagCountForOperator,
  getIncidentsCountForOperator,
  getUnassignedCount,
  getUnassignedCountByDirigente,
  getUnassignedRecordsByDirigente,
  getUnassignedRecordsByLocal,
  getUnassignedRecordsPage,
  searchRecordsForContactCenter,
  setDiaDStatus
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'
import { can } from '../lib/rbac.js'

const ESTADOS_ELECTORALES = [
  { key: 'contacted', label: 'Contactado', emoji: '📞' },
  { key: 'confirmedToVote', label: 'Confirmó que votará', emoji: '✅' },
  { key: 'noAnswer', label: 'No contesta', emoji: '🔇' },
  { key: 'wrongNumber', label: 'Número incorrecto', emoji: '☎️' },
  { key: 'moved', label: 'Se mudó', emoji: '📦' },
  { key: 'deceased', label: 'Falleció', emoji: '🕊️' },
  { key: 'willNotVote', label: 'No votará', emoji: '🚫' },
  { key: 'undecided', label: 'Está indeciso', emoji: '🤔' },
  { key: 'requiresPickup', label: 'Requiere transporte', emoji: '🚐' },
  { key: 'needsAssistance', label: 'Precisa ayuda', emoji: '🦽' },
  { key: 'hasTransport', label: 'Ya tiene transporte', emoji: '🚗' },
  { key: 'driverAssigned', label: 'Chofer asignado', emoji: '🧑‍✈️' },
  { key: 'arrivedAtPollingPlace', label: 'Fue al local', emoji: '📍' },
  { key: 'voted', label: 'Ya votó', emoji: '🗳️' },
  { key: 'couldNotVote', label: 'No pudo votar', emoji: '⛔' }
]

const RESULTADOS_LLAMADA = ['Contestó', 'No contestó', 'Número incorrecto', 'Confirmó voto', 'Está indeciso', 'No votará', 'Requiere transporte', 'Requiere ayuda', 'Otro']

const TIPOS_INCIDENCIA = ['No encontró transporte', 'Documento perdido', 'Mesa equivocada', 'No apareció el chofer', 'Necesita silla de ruedas', 'Está esperando', 'No contesta', 'Otro']

// Efectos automáticos al registrar una llamada: mueve el estado grueso de
// la asignación y prende las banderas de electionStatus que correspondan,
// para que el operador no tenga que marcar todo dos veces a mano.
function efectosDeLlamada(resultado) {
  const map = {
    'Contestó': { assignmentStatus: 'in_progress', statusUpdates: { contacted: true, lastStatus: 'contacted' } },
    'No contestó': { assignmentStatus: 'in_progress', statusUpdates: { noAnswer: true, lastStatus: 'no_answer' } },
    'Número incorrecto': { assignmentStatus: 'incident', statusUpdates: { wrongNumber: true, lastStatus: 'wrong_number' } },
    'Confirmó voto': { assignmentStatus: 'confirmed', statusUpdates: { contacted: true, confirmedToVote: true, lastStatus: 'confirmed' } },
    'Está indeciso': { assignmentStatus: 'contacted', statusUpdates: { contacted: true, undecided: true, lastStatus: 'undecided' } },
    'No votará': { assignmentStatus: 'closed', statusUpdates: { contacted: true, willNotVote: true, lastStatus: 'will_not_vote' } },
    'Requiere transporte': { assignmentStatus: 'contacted', statusUpdates: { contacted: true, requiresPickup: true, lastStatus: 'requires_pickup' } },
    'Requiere ayuda': { assignmentStatus: 'contacted', statusUpdates: { contacted: true, needsAssistance: true, lastStatus: 'needs_assistance' } },
    'Otro': { assignmentStatus: 'contacted', statusUpdates: { contacted: true } }
  }
  return map[resultado] || { assignmentStatus: 'contacted', statusUpdates: { contacted: true } }
}

function fmtFecha(v) {
  if (!v) return '—'
  const d = v.toDate ? v.toDate() : new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function normalizarTelefonoPY(tel) {
  if (!tel) return ''
  const digits = String(tel).replace(/\D/g, '')
  if (!digits) return ''
  return '595' + digits.replace(/^0/, '')
}

export async function renderContactCenter(container, candidateId, user, myRole, misRoles = []) {
  // Etapa 7 RBAC (modo compatibilidad) — ver nota igual en finanzas-candidate.js.
  const isAdminView = can(misRoles, 'contact_center.assign_voters') || ['campaign_admin', 'coordinator'].includes(myRole)
  let tab = 'pendientes'
  let filtroDashboard = null
  // Con el padrón esperado (50.000-100.000 votantes) asignar uno por uno
  // no escala — modoAsignacion deja elegir entre el flujo manual de
  // siempre y una asignación masiva automática (por dirigente, por local
  // de votación, o repartido parejo entre operadores).
  let modoAsignacion = 'manual'
  let cursorPendientes = null

  // Estos arrays SOLO contienen "lo que corresponde a la vista actual":
  // para operador, todo lo suyo (precargado una vez, ya acotado). Para
  // admin/coordinador, se repueblan en cada pestaña con datos ya
  // filtrados/paginados server-side — nunca el padrón completo.
  let registros = []
  let asignaciones = []
  let estados = []
  let usuarios = []
  let incidencias = []

  const operadores = () => usuarios.filter(u => u.role === 'operador')
  // Para operador (no admin), `usuarios` nunca se carga (firestore.rules no
  // deja listar todo el equipo desde ese rol) — como sus asignaciones/
  // llamadas son siempre propias, el único uid que necesita resolver es el
  // suyo.
  const usuarioNombre = (uid) => {
    const u = usuarios.find(x => x.id === uid)
    if (u) return u.nombre || u.email
    if (uid === user.uid) return user.displayName || user.email
    return '—'
  }
  const registroPorId = (id) => registros.find(r => r.id === id)
  const asignacionPorVoterId = (id) => asignaciones.find(a => a.voterId === id)
  const estadoPorVoterId = (id) => estados.find(e => e.voterId === id)

  async function cargarDatos() {
    // getAllCandidateUsers() hace un list() sin filtro sobre todo el
    // roster: firestore.rules solo lo permite a campaign_admin/coordinator/
    // superadmin. Un operador que lo llamara recibiría permission-denied y
    // rompería toda la carga del módulo (antes pasaba justo esto).
    if (isAdminView) usuarios = await getAllCandidateUsers(candidateId)
    if (!isAdminView) {
      const [asigs, ests, incs] = await Promise.all([
        getMyCallAssignments(candidateId, user.uid),
        getMyElectionStatuses(candidateId, user.uid),
        getMyIncidents(candidateId, user.uid)
      ])
      asignaciones = asigs; estados = ests; incidencias = incs
      registros = await getRecordsByIds(candidateId, asigs.map(a => a.voterId))
    }
    // admin/coordinador: nada acá — cada pestaña carga lo suyo, acotado.
  }

  function tabBtn(id, label) {
    const active = tab === id
    return `<button class="cc-tab-btn btn-tab btn-tab--pill btn-tab--on-dark${active ? ' active' : ''}" data-tab="${id}" style="--tab-color:#7b1fa2;">${label}</button>`
  }

  function render() {
    const tabs = [
      ['pendientes', '📋 Pendientes'],
      ['seguimiento', '🔄 En seguimiento'],
      ['confirmados', '✅ Confirmados'],
      ...(isAdminView ? [['asignacion', '👥 Asignación']] : []),
      ['incidencias', '⚠️ Incidencias'],
      ['diad', '🗳️ Día D']
    ]
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #6a1b9a 0%, #4a148c 100%); color: white; padding: 20px 20px 0; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0 0 14px; font-family: 'Barlow Condensed', sans-serif; font-size: 1.8rem; text-transform: uppercase;">📞 Centro de Contacto Electoral</h2>
        <div style="display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 12px;">
          ${tabs.map(([id, label]) => tabBtn(id, label)).join('')}
        </div>
      </div>
      <div id="cc-tab-body" style="background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;"></div>
    `
    container.querySelectorAll('.cc-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; filtroDashboard = null; cursorPendientes = null; renderTab() })
    })
    renderTab()
  }

  function renderTab() {
    const body = document.getElementById('cc-tab-body')
    if (tab === 'pendientes') renderPendientes(body)
    else if (tab === 'seguimiento') renderSeguimiento(body)
    else if (tab === 'confirmados') renderConfirmados(body)
    else if (tab === 'asignacion') renderAsignacion(body)
    else if (tab === 'incidencias') renderIncidencias(body)
    else if (tab === 'diad') renderDiaD(body)
  }

  async function recargarYRenderizar() {
    await cargarDatos()
    renderTab()
  }

  // ── Ficha del votante (modal compartido por todas las pestañas) ───────
  function abrirModal(html, maxWidth = '560px') {
    const modal = document.createElement('div')
    modal.style.cssText = `position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.65); display:flex; justify-content:center; align-items:flex-start; z-index:9999; overflow-y:auto; padding:20px;`
    modal.innerHTML = `<div style="background:white; border-radius:8px; max-width:${maxWidth}; width:100%; padding:24px; margin:auto;">${html}</div>`
    document.body.appendChild(modal)
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
    return modal
  }

  // asignacion/estado se pasan explícitos (el llamador ya los tiene a mano
  // de la lista que se está mostrando) en vez de resolverlos desde un
  // array global — a escala, ese array ya no contiene "todo", solo lo de
  // la vista actual.
  async function abrirFichaVotante(registro, asignacionInicial, estadoInicial) {
    const asignacion = asignacionInicial
    let estado = estadoInicial
    const telLimpio = normalizarTelefonoPY(registro.telefono)

    const modal = abrirModal(`
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div>
          <h2 style="margin:0; font-size:1.3rem;">${escapeHtml(registro.nombre)}</h2>
          <div style="color:#666; font-size:.85rem;">CI ${escapeHtml(registro.cedula)}</div>
        </div>
        <button id="btn-cerrar-ficha" style="background:#999; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">✕</button>
      </div>

      <div style="background:#f9f9f9; border-radius:6px; padding:12px; margin-bottom:14px; font-size:.85rem; display:grid; gap:4px;">
        <div>📱 <strong>Teléfono:</strong> ${escapeHtml(registro.telefono) || 'sin teléfono'} ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="margin-left:8px; text-decoration:none; background:#25d366; color:white; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">💬 WhatsApp</a>` : ''}</div>
        <div>🏠 <strong>Dirección:</strong> ${escapeHtml(registro.direccion) || '—'}</div>
        <div>🗳️ <strong>Local/zona:</strong> ${escapeHtml(registro.local) || '—'} · Mesa ${escapeHtml(registro.mesa) || '—'} · Orden ${escapeHtml(registro.orden) || '—'}</div>
        ${registro.googleMapsUrl ? `<div>📍 <a href="${escapeHtml(registro.googleMapsUrl)}" target="_blank" rel="noopener">Ver ubicación en Maps</a></div>` : ''}
        <div>👤 <strong>Referente:</strong> ${escapeHtml(registro.militanteName) || '—'}</div>
        <div>📝 <strong>Nota del dirigente:</strong> ${escapeHtml(registro.nota) || '—'}</div>
        <div style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">
          ${registro.requiresPickup ? '<span style="background:#eef3f8; color:#1f4b7a; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">🚐 Requiere que se le busque</span>' : ''}
          ${registro.needsAssistance ? '<span style="background:#eef3f8; color:#1f4b7a; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">🦽 Precisa ayuda</span>' : ''}
          ${registro.canBeDriver ? '<span style="background:#eef3f8; color:#1f4b7a; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">🚗 Puede ser chofer</span>' : ''}
        </div>
        <div style="margin-top:4px;">👷 <strong>Operador asignado:</strong> ${asignacion ? escapeHtml(usuarioNombre(asignacion.assignedUserId)) : 'Sin asignar'}</div>
      </div>

      <h3 style="margin:0 0 8px; font-size:.95rem;">ESTADO ELECTORAL</h3>
      <div id="ficha-estado-electoral" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:6px; margin-bottom:10px;"></div>
      <button id="btn-guardar-estado" style="background:#6a1b9a; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.82rem; margin-bottom:20px;">💾 Guardar estado</button>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0; font-size:.95rem;">📞 Historial de llamadas</h3>
        <button id="btn-registrar-llamada" style="background:#2196f3; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">📞 Registrar llamada</button>
      </div>
      <div id="ficha-form-llamada"></div>
      <div id="ficha-historial-llamadas" style="font-size:.82rem;">Cargando historial...</div>
    `, '640px')

    modal.querySelector('#btn-cerrar-ficha').addEventListener('click', () => modal.remove())

    function pintarEstadoElectoral() {
      const box = modal.querySelector('#ficha-estado-electoral')
      box.innerHTML = ESTADOS_ELECTORALES.map(e => `
        <label style="display:flex; align-items:center; gap:6px; font-size:.8rem; background:#f5f5f5; padding:6px 8px; border-radius:4px; cursor:pointer;">
          <input type="checkbox" class="chk-estado" data-key="${e.key}" ${estado?.[e.key] ? 'checked' : ''}>
          ${e.emoji} ${e.label}
        </label>
      `).join('')
    }
    pintarEstadoElectoral()

    modal.querySelector('#btn-guardar-estado').addEventListener('click', async () => {
      const updates = {}
      modal.querySelectorAll('.chk-estado').forEach(chk => { updates[chk.dataset.key] = chk.checked })
      try {
        await upsertElectionStatus(candidateId, registro.id, asignacion?.assignedUserId || user.uid, updates, user.uid)
        estado = { ...(estado || {}), ...updates }
        const idx = estados.findIndex(e => e.voterId === registro.id)
        if (idx >= 0) estados[idx] = { ...estados[idx], ...updates }
        alert('✅ Estado guardado')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

    async function pintarHistorial() {
      const box = modal.querySelector('#ficha-historial-llamadas')
      const calls = isAdminView
        ? await getCallHistory(candidateId, registro.id)
        : await getMyCallHistory(candidateId, registro.id, user.uid)
      box.innerHTML = calls.length === 0 ? '<div style="color:#999;">Sin llamadas registradas todavía.</div>' : calls.map(c => `
        <div style="border-left:3px solid #6a1b9a; padding:6px 10px; margin-bottom:8px; background:#faf5ff;">
          <div style="font-weight:700;">${escapeHtml(c.result)} <span style="font-weight:400; color:#666; font-size:.75rem;">— ${fmtFecha(c.createdAt)} · ${escapeHtml(usuarioNombre(c.operatorUserId))}</span></div>
          ${c.observation ? `<div style="color:#444;">📝 ${escapeHtml(c.observation)}</div>` : ''}
          ${c.nextAction ? `<div style="color:#444;">➡️ Próxima acción: ${escapeHtml(c.nextAction)}</div>` : ''}
          ${c.followUpAt ? `<div style="color:#e65100;">⏰ Volver a llamar: ${fmtFecha(c.followUpAt)}</div>` : ''}
        </div>
      `).join('')
    }
    pintarHistorial()

    modal.querySelector('#btn-registrar-llamada').addEventListener('click', () => {
      const formBox = modal.querySelector('#ficha-form-llamada')
      formBox.innerHTML = `
        <div style="background:#f0f4ff; border-radius:6px; padding:14px; margin-bottom:14px; display:grid; gap:8px;">
          <select id="inp-resultado" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            ${RESULTADOS_LLAMADA.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
          </select>
          <textarea id="inp-observacion" placeholder="Observación" rows="2" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-family:inherit;"></textarea>
          <input id="inp-proxima-accion" placeholder="Próxima acción (opcional)" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <label style="font-size:.8rem; color:#555;">Volver a llamar en (opcional):
            <input id="inp-followup" type="datetime-local" style="padding:8px; border:1px solid #ccc; border-radius:4px; width:100%; margin-top:4px; box-sizing:border-box;">
          </label>
          <div style="display:flex; gap:8px;">
            <button id="btn-confirmar-llamada" style="flex:1; background:#4caf50; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">✅ Guardar llamada</button>
            <button id="btn-cancelar-llamada" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      formBox.querySelector('#btn-cancelar-llamada').addEventListener('click', () => { formBox.innerHTML = '' })
      formBox.querySelector('#btn-confirmar-llamada').addEventListener('click', async () => {
        const result = formBox.querySelector('#inp-resultado').value
        const observation = formBox.querySelector('#inp-observacion').value.trim()
        const nextAction = formBox.querySelector('#inp-proxima-accion').value.trim()
        const followUpVal = formBox.querySelector('#inp-followup').value
        const followUpAt = followUpVal ? new Date(followUpVal) : null
        const assignedUserId = asignacion?.assignedUserId || user.uid
        try {
          await registerCall(candidateId, registro.id, assignedUserId, user.uid, { result, observation, nextAction, followUpAt })
          const { assignmentStatus, statusUpdates } = efectosDeLlamada(result)
          await updateCallAssignmentStatus(candidateId, registro.id, assignmentStatus)
          await upsertElectionStatus(candidateId, registro.id, assignedUserId, statusUpdates, user.uid)
          formBox.innerHTML = ''
          pintarHistorial()
          pintarEstadoElectoral()
          alert('✅ Llamada registrada')
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  // Tarjeta compacta de votante reutilizada en varias pestañas.
  function pintarListaVotantes(box, items, mensajeVacio) {
    if (!box) return
    if (items.length === 0) {
      box.innerHTML = `<div style="color:#999; padding:20px; text-align:center;">${mensajeVacio}</div>`
      return
    }
    box.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px;">
      ${items.map(({ registro, asignacion, estado }) => `
        <div class="cc-voter-card" data-id="${registro.id}" style="border:1px solid #eee; border-radius:8px; padding:12px; cursor:pointer; background:#fafafa;">
          <div style="font-weight:700;">${escapeHtml(registro.nombre)}</div>
          <div style="font-size:.78rem; color:#666;">CI ${escapeHtml(registro.cedula)} · 📱 ${escapeHtml(registro.telefono) || 'sin tel.'}</div>
          <div style="font-size:.78rem; color:#666;">🗳️ ${escapeHtml(registro.local) || 'sin local'}</div>
          <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
            <span style="background:#eee; color:#555; padding:2px 8px; border-radius:10px; font-size:.68rem; font-weight:700;">${escapeHtml(asignacion?.status || 'sin asignar')}</span>
            ${estado?.lastStatus ? `<span style="background:#ede7f6; color:#4527a0; padding:2px 8px; border-radius:10px; font-size:.68rem; font-weight:700;">${escapeHtml(estado.lastStatus)}</span>` : ''}
          </div>
          <div style="font-size:.72rem; color:#999; margin-top:4px;">👷 ${asignacion ? escapeHtml(usuarioNombre(asignacion.assignedUserId)) : '—'}</div>
        </div>
      `).join('')}
    </div>`
    box.querySelectorAll('.cc-voter-card').forEach(card => {
      card.addEventListener('click', () => {
        const item = items.find(x => x.registro.id === card.dataset.id)
        if (item) abrirFichaVotante(item.registro, item.asignacion, item.estado)
      })
    })
  }

  // ── Pestaña Pendientes (incluye el dashboard de tarjetas) ─────────────
  async function renderPendientes(body) {
    body.innerHTML = '<div style="color:#999;">Cargando...</div>'

    let conteos
    if (isAdminView) {
      const [pendientes, flagCounts, incidenciasCount] = await Promise.all([
        getCallAssignmentStatusCount(candidateId, 'pending'),
        getElectionStatusFlagCounts(candidateId, ['contacted', 'confirmedToVote', 'noAnswer', 'wrongNumber', 'undecided', 'requiresPickup', 'needsAssistance']),
        getOpenIncidentsCount(candidateId)
      ])
      conteos = {
        pendientes,
        contactados: flagCounts.contacted,
        confirmados: flagCounts.confirmedToVote,
        noContestan: flagCounts.noAnswer,
        numeroIncorrecto: flagCounts.wrongNumber,
        indecisos: flagCounts.undecided,
        requierenTransporte: flagCounts.requiresPickup,
        precisanAyuda: flagCounts.needsAssistance,
        incidencias: incidenciasCount
      }
    } else {
      conteos = {
        pendientes: asignaciones.filter(a => a.status === 'pending').length,
        contactados: estados.filter(e => e.contacted).length,
        confirmados: estados.filter(e => e.confirmedToVote).length,
        noContestan: estados.filter(e => e.noAnswer).length,
        numeroIncorrecto: estados.filter(e => e.wrongNumber).length,
        indecisos: estados.filter(e => e.undecided).length,
        requierenTransporte: estados.filter(e => e.requiresPickup).length,
        precisanAyuda: estados.filter(e => e.needsAssistance).length,
        incidencias: incidencias.filter(i => i.status === 'open' || i.status === 'in_progress').length
      }
    }

    const tarjeta = (key, emoji, label, valor, color) => `
      <button class="cc-dash-card" data-filtro="${key}" style="text-align:left; cursor:pointer; background:${filtroDashboard === key ? color : 'white'}; border:1px solid ${color}; border-radius:8px; padding:14px; transition:background .15s;">
        <div style="font-size:1.6rem; font-weight:800; color:${filtroDashboard === key ? 'white' : color};">${valor}</div>
        <div style="font-size:.75rem; font-weight:700; color:${filtroDashboard === key ? 'white' : '#555'}; text-transform:uppercase;">${emoji} ${label}</div>
      </button>`

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">📊 Resumen</h3>
      <div class="stats-grid" style="margin-bottom:24px;">
        ${tarjeta('pending', '📋', 'Pendientes', conteos.pendientes, '#6a1b9a')}
        ${tarjeta('llamadosHoy', '📞', 'Llamados hoy', '…', '#2196f3')}
        ${tarjeta('contacted', '☎️', 'Contactados', conteos.contactados, '#00897b')}
        ${tarjeta('confirmedToVote', '✅', 'Confirmados', conteos.confirmados, '#4caf50')}
        ${tarjeta('noAnswer', '🔇', 'No contestan', conteos.noContestan, '#ff9800')}
        ${tarjeta('wrongNumber', '☎️', 'Número incorrecto', conteos.numeroIncorrecto, '#795548')}
        ${tarjeta('undecided', '🤔', 'Indecisos', conteos.indecisos, '#607d8b')}
        ${tarjeta('requiresPickup', '🚐', 'Requieren transporte', conteos.requierenTransporte, '#1976d2')}
        ${tarjeta('needsAssistance', '🦽', 'Precisan ayuda', conteos.precisanAyuda, '#c62828')}
        ${tarjeta('incidents', '⚠️', 'Incidencias', conteos.incidencias, '#e65100')}
      </div>
      <h3 style="margin:0 0 12px; font-size:1.05rem;">Votantes ${filtroDashboard ? '(filtrado)' : 'pendientes'}</h3>
      <div id="cc-pendientes-lista"></div>
      <div id="cc-pendientes-cargar-mas" style="text-align:center; margin-top:12px;"></div>
    `

    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0)
    getCallsSince(candidateId, inicioHoy, isAdminView ? null : user.uid).then(calls => {
      const el = body.querySelector('[data-filtro="llamadosHoy"] div')
      if (el) el.textContent = calls.length
    }).catch(() => {})

    body.querySelectorAll('.cc-dash-card').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroDashboard = filtroDashboard === btn.dataset.filtro ? null : btn.dataset.filtro
        cursorPendientes = null
        renderPendientes(body)
      })
    })

    await cargarYPintarListaPendientes(body, { append: false })
  }

  // Único punto que arma "la lista de abajo" de Pendientes, acotado según
  // corresponda: página de pendientes (con "cargar más"), o un drill-down
  // acotado a 300 cuando se clickea una tarjeta puntual del dashboard.
  async function cargarYPintarListaPendientes(body, { append }) {
    const listaBox = document.getElementById('cc-pendientes-lista')
    const cargarMasBox = document.getElementById('cc-pendientes-cargar-mas')
    if (!append) listaBox.innerHTML = '<div style="color:#999; padding:20px;">Cargando...</div>'

    let items = []
    let hayMas = false

    if (isAdminView) {
      if (!filtroDashboard || filtroDashboard === 'pending' || filtroDashboard === 'llamadosHoy') {
        const { assignments, lastDoc, hasMore } = await getCallAssignmentsPage(candidateId, { status: 'pending', cursor: append ? cursorPendientes : null, pageSize: 50 })
        const ids = assignments.map(a => a.voterId)
        const [regs, ests] = await Promise.all([getRecordsByIds(candidateId, ids), getElectionStatusesByIds(candidateId, ids)])
        if (append) { asignaciones = [...asignaciones, ...assignments]; registros = [...registros, ...regs]; estados = [...estados, ...ests] }
        else { asignaciones = assignments; registros = regs; estados = ests }
        cursorPendientes = lastDoc
        hayMas = hasMore
        // Siempre se pinta desde el array acumulado (no solo la página
        // nueva) para que "Cargar más" muestre todo lo traído hasta ahora.
        items = asignaciones.map(a => ({ asignacion: a, registro: registroPorId(a.voterId), estado: estadoPorVoterId(a.voterId) })).filter(x => x.registro)
      } else if (filtroDashboard === 'incidents') {
        incidencias = await getOpenIncidents(candidateId, 300)
        const ids = incidencias.map(i => i.voterId)
        const [regs, asigs, ests] = await Promise.all([getRecordsByIds(candidateId, ids), getCallAssignmentsByIds(candidateId, ids), getElectionStatusesByIds(candidateId, ids)])
        registros = regs; asignaciones = asigs; estados = ests
        items = ids.map(id => ({ registro: registroPorId(id), asignacion: asignacionPorVoterId(id), estado: estadoPorVoterId(id) })).filter(x => x.registro)
      } else {
        estados = await getElectionStatusByFlag(candidateId, filtroDashboard, 300)
        const ids = estados.map(e => e.voterId)
        const [regs, asigs] = await Promise.all([getRecordsByIds(candidateId, ids), getCallAssignmentsByIds(candidateId, ids)])
        registros = regs; asignaciones = asigs
        items = ids.map(id => ({ registro: registroPorId(id), asignacion: asignacionPorVoterId(id), estado: estadoPorVoterId(id) })).filter(x => x.registro)
      }
    } else {
      const asignadosConDatos = asignaciones.map(a => ({ asignacion: a, registro: registroPorId(a.voterId), estado: estadoPorVoterId(a.voterId) })).filter(x => x.registro)
      function pasaFiltro(x) {
        if (!filtroDashboard || filtroDashboard === 'llamadosHoy') return true
        if (filtroDashboard === 'pending') return x.asignacion.status === 'pending'
        if (filtroDashboard === 'incidents') return incidencias.some(i => i.voterId === x.registro.id && (i.status === 'open' || i.status === 'in_progress'))
        return !!x.estado?.[filtroDashboard]
      }
      items = asignadosConDatos.filter(pasaFiltro)
    }

    pintarListaVotantes(listaBox, items, 'Sin votantes en este filtro.')

    cargarMasBox.innerHTML = hayMas
      ? `<button id="btn-cargar-mas-pendientes" style="background:#6a1b9a; color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:700;">Cargar más</button>`
      : ''
    const btnMas = document.getElementById('btn-cargar-mas-pendientes')
    if (btnMas) btnMas.addEventListener('click', () => cargarYPintarListaPendientes(body, { append: true }))
  }

  // ── Pestaña En seguimiento ──────────────────────────────────────────
  async function renderSeguimiento(body) {
    body.innerHTML = '<div style="color:#999;">Cargando...</div>'
    const followUps = isAdminView
      ? await getPendingFollowUps(candidateId)
      : await getMyPendingFollowUps(candidateId, user.uid)

    if (isAdminView) {
      const ids = followUps.map(f => f.voterId)
      registros = await getRecordsByIds(candidateId, ids)
    }

    if (followUps.length === 0) {
      body.innerHTML = '<h3 style="margin:0 0 12px; font-size:1.05rem;">🔄 En seguimiento</h3><div style="color:#999; padding:20px; text-align:center;">No hay seguimientos pendientes.</div>'
      return
    }

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">🔄 En seguimiento (${followUps.length})</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Votante</th><th>Próxima llamada</th><th>Operador</th><th>Nota</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${followUps.map(f => {
              const registro = registroPorId(f.voterId)
              const dueDate = f.dueAt?.toDate ? f.dueAt.toDate() : new Date(f.dueAt)
              const vencido = !isNaN(dueDate.getTime()) && dueDate < new Date()
              return `<tr style="border-bottom:1px solid #eee; ${vencido ? 'background:#fff3e0;' : ''}">
                <td style="padding:6px;"><strong>${registro ? escapeHtml(registro.nombre) : f.voterId}</strong>${registro ? `<br><span style="color:#999; font-size:.75rem;">CI ${escapeHtml(registro.cedula)}</span>` : ''}</td>
                <td style="${vencido ? 'color:#e65100; font-weight:700;' : ''}">${fmtFecha(f.dueAt)} ${vencido ? '⚠️' : ''}</td>
                <td>${escapeHtml(usuarioNombre(f.assignedUserId))}</td>
                <td>${escapeHtml(f.note) || '—'}</td>
                <td>
                  <div style="display:flex; gap:4px;">
                    ${registro ? `<button class="btn-ver-ficha-seg" data-id="${registro.id}" style="background:#2196f3; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem;">Ver</button>` : ''}
                    <button class="btn-marcar-realizado" data-id="${f.id}" style="background:#4caf50; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✓ Marcar realizado</button>
                  </div>
                </td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
    `

    body.querySelectorAll('.btn-ver-ficha-seg').forEach(btn => {
      btn.addEventListener('click', () => { const r = registroPorId(btn.dataset.id); if (r) abrirFichaVotante(r, asignacionPorVoterId(r.id), estadoPorVoterId(r.id)) })
    })
    body.querySelectorAll('.btn-marcar-realizado').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await completeFollowUp(candidateId, btn.dataset.id)
          renderSeguimiento(body)
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  // ── Pestaña Confirmados ──────────────────────────────────────────────
  async function renderConfirmados(body) {
    body.innerHTML = '<div style="color:#999;">Cargando...</div>'
    let confirmados
    let capado = false
    if (isAdminView) {
      estados = await getElectionStatusByFlag(candidateId, 'confirmedToVote', 300)
      capado = estados.length === 300
      const ids = estados.map(e => e.voterId)
      const [regs, asigs] = await Promise.all([getRecordsByIds(candidateId, ids), getCallAssignmentsByIds(candidateId, ids)])
      registros = regs; asignaciones = asigs
      confirmados = ids.map(id => ({ estado: estadoPorVoterId(id), registro: registroPorId(id), asignacion: asignacionPorVoterId(id) })).filter(x => x.registro)
    } else {
      confirmados = estados
        .filter(e => e.confirmedToVote)
        .map(e => ({ estado: e, registro: registroPorId(e.voterId), asignacion: asignacionPorVoterId(e.voterId) }))
        .filter(x => x.registro)
    }

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">✅ Confirmados (${confirmados.length}${capado ? '+' : ''})</h3>
      ${capado ? '<p style="font-size:.78rem; color:#999; margin:0 0 12px;">Mostrando los primeros 300 — usá Excel en Registros para el listado completo.</p>' : ''}
      <div id="cc-confirmados-lista"></div>
    `
    pintarListaVotantes(document.getElementById('cc-confirmados-lista'), confirmados, 'Todavía no hay votantes confirmados.')
  }

  // ── Pestaña Asignación (solo admin/coordinador) ──────────────────────
  async function renderAsignacion(body) {
    const ops = operadores()
    body.innerHTML = '<div style="color:#999;">Cargando estadísticas...</div>'

    const stats = await Promise.all(ops.map(async op => {
      const [total, pendientes, contactados, confirmados, incidenciasCount] = await Promise.all([
        getCallAssignmentCountForOperator(candidateId, op.id),
        getCallAssignmentCountForOperator(candidateId, op.id, 'pending'),
        getElectionStatusFlagCountForOperator(candidateId, op.id, 'contacted'),
        getElectionStatusFlagCountForOperator(candidateId, op.id, 'confirmedToVote'),
        getIncidentsCountForOperator(candidateId, op.id)
      ])
      return { operador: op, total, pendientes, contactados, confirmados, incidencias: incidenciasCount }
    }))

    const modoBtn = (id, label) => `<button class="cc-modo-asig-btn" data-modo="${id}" style="padding:8px 16px; border:1px solid #6a1b9a; border-radius:6px; cursor:pointer; font-weight:700; font-size:.85rem; background:${modoAsignacion === id ? '#6a1b9a' : 'white'}; color:${modoAsignacion === id ? 'white' : '#6a1b9a'};">${label}</button>`

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">👥 Operadores</h3>
      ${ops.length === 0 ? '<div style="color:#999; margin-bottom:20px;">Todavía no hay usuarios con rol "Operador de contacto". Creá uno en la pestaña Usuarios.</div>' : `
      <div style="overflow-x:auto; margin-bottom:24px;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Operador</th><th>Asignados</th><th>Pendientes</th><th>Contactados</th><th>Confirmados</th><th>Incidencias</th>
          </tr></thead>
          <tbody>
            ${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(s.operador.nombre || s.operador.email)}</strong></td>
              <td>${s.total}</td><td>${s.pendientes}</td><td>${s.contactados}</td><td>${s.confirmados}</td><td>${s.incidencias}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}

      <div style="background:#f5f0fa; border-radius:8px; padding:14px; margin-bottom:20px;">
        <div style="font-weight:700; font-size:.85rem; margin-bottom:8px; color:#4a148c;">¿Cómo querés asignar los votantes sin operador?</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${modoBtn('manual', '✋ Manual (uno por uno / por zona)')}
          ${modoBtn('automatica', '🤖 Automática (masiva)')}
        </div>
      </div>

      <div id="cc-asignacion-body"></div>
    `

    body.querySelectorAll('.cc-modo-asig-btn').forEach(btn => {
      btn.addEventListener('click', () => { modoAsignacion = btn.dataset.modo; renderAsignacion(body) })
    })

    if (modoAsignacion === 'automatica') pintarAsignacionAutomatica(document.getElementById('cc-asignacion-body'), ops)
    else pintarAsignacionManual(document.getElementById('cc-asignacion-body'), ops)
  }

  // ── Asignación manual: por zona (query puntual, sin escanear todo) +
  // por CI/nombre (búsqueda indexada, nunca filtra el padrón completo) ──
  function pintarAsignacionManual(box, ops) {
    box.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">📍 Asignar por local/zona</h3>
      <p style="font-size:.78rem; color:#999; margin:0 0 8px;">Escribí el local tal cual figura en Registros (sensible a mayúsculas/tildes exactas).</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px;">
        <input id="inp-zona-asignar" placeholder="Ej: ESC. Bo REPUBLICA DOMINICANA" style="flex:1; min-width:220px; padding:8px; border:1px solid #ccc; border-radius:4px;">
        <select id="sel-operador-zona" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <option value="">Elegí un operador</option>
          ${ops.map(o => `<option value="${o.id}">${escapeHtml(o.nombre || o.email)}</option>`).join('')}
        </select>
        <button id="btn-asignar-zona" style="background:#6a1b9a; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">Asignar sin asignar de esa zona</button>
      </div>
      <div id="cc-zona-msg" style="font-size:.85rem; margin:-16px 0 20px;"></div>

      <h3 style="margin:0 0 12px; font-size:1.05rem;">🔎 Asignar / reasignar por CI o nombre</h3>
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
      <div class="filter-input-wrap" style="margin-bottom:12px;"><input id="inp-buscar-asignacion" class="filter-input" placeholder="Buscar votante por CI o nombre..."></div>
      <div id="cc-lista-asignacion" style="max-height:420px; overflow-y:auto; border:1px solid #eee; border-radius:6px;"></div>
    `

    box.querySelector('#btn-asignar-zona').addEventListener('click', async () => {
      const zona = box.querySelector('#inp-zona-asignar').value.trim()
      const operadorId = box.querySelector('#sel-operador-zona').value
      const msgEl = box.querySelector('#cc-zona-msg')
      if (!zona || !operadorId) { alert('Escribí la zona/local y elegí un operador.'); return }
      msgEl.textContent = '🔎 Buscando votantes sin asignar en esa zona...'
      try {
        const registrosZona = await getUnassignedRecordsByLocal(candidateId, zona, 5000)
        if (registrosZona.length === 0) {
          msgEl.textContent = '❌ No hay votantes sin asignar con ese local exacto.'
          return
        }
        if (!confirm(`¿Asignar ${registrosZona.length} votante(s) de "${zona}" a este operador?`)) { msgEl.textContent = ''; return }
        msgEl.textContent = `Asignando ${registrosZona.length} votante(s)...`
        await assignVotersToOperatorBulk(candidateId, registrosZona.map(r => r.id), operadorId, user.uid)
        msgEl.textContent = `✅ ${registrosZona.length} votante(s) asignado(s).`
      } catch (err) {
        msgEl.textContent = '❌ Error: ' + err.message
      }
    })

    async function pintarListaAsignacion(filtro = '') {
      const listaBox = document.getElementById('cc-lista-asignacion')
      const termino = filtro.trim()
      if (!termino) {
        listaBox.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Escribí una CI o nombre para buscar.</div>'
        return
      }
      listaBox.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Buscando...</div>'
      const encontrados = await searchRecordsForContactCenter(candidateId, termino)
      if (encontrados.length === 0) {
        listaBox.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Sin resultados.</div>'
        return
      }
      const asigs = await getCallAssignmentsByIds(candidateId, encontrados.map(r => r.id))
      const asigPorId = new Map(asigs.map(a => [a.voterId, a]))

      listaBox.innerHTML = encontrados.map(r => {
        const asig = asigPorId.get(r.id)
        return `
        <div style="padding:8px 12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:.85rem;">
            <strong>${escapeHtml(r.nombre)}</strong> (CI ${escapeHtml(r.cedula)})
            <br><span style="color:#666; font-size:.75rem;">${asig ? '👷 ' + escapeHtml(usuarioNombre(asig.assignedUserId)) : 'Sin asignar'}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <select class="sel-op-fila" data-id="${r.id}" style="padding:6px; border:1px solid #ccc; border-radius:4px; font-size:.78rem;">
              <option value="">-- Operador --</option>
              ${ops.map(o => `<option value="${o.id}" ${asig?.assignedUserId === o.id ? 'selected' : ''}>${escapeHtml(o.nombre || o.email)}</option>`).join('')}
            </select>
            <button class="btn-asignar-fila" data-id="${r.id}" style="background:${asig ? '#ff9800' : '#4caf50'}; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.75rem; font-weight:600;">${asig ? 'Reasignar' : 'Asignar'}</button>
          </div>
        </div>`
      }).join('')

      listaBox.querySelectorAll('.btn-asignar-fila').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sel = listaBox.querySelector(`.sel-op-fila[data-id="${btn.dataset.id}"]`)
          const operadorId = sel.value
          if (!operadorId) { alert('Elegí un operador.'); return }
          const asig = asigPorId.get(btn.dataset.id)
          try {
            if (asig) await reassignVoter(candidateId, btn.dataset.id, operadorId, user.uid)
            else await assignVoterToOperator(candidateId, btn.dataset.id, operadorId, user.uid)
            pintarListaAsignacion(termino)
          } catch (err) {
            alert('Error: ' + err.message)
          }
        })
      })
    }
    box.querySelector('#inp-buscar-asignacion').addEventListener('input', debounce(e => pintarListaAsignacion(e.target.value), 250))
  }

  // ── Asignación automática (masiva): agrupa a los votantes sin operador
  // por el criterio elegido (dirigente / local de votación / ninguno) y
  // reparte los grupos entre los operadores seleccionados con un greedy
  // bin-packing (cada grupo entero va al operador con menos carga en ese
  // momento). Nunca descarga el padrón completo:
  // - "dirigente": el universo de dirigentes es chico (equipo, no
  //   votantes) — se pide/asigna de a un dirigente por vez.
  // - "local"/"equitativo": se pagina savedRecords en bloques (ver
  //   getUnassignedRecordsPage) y se reparte página por página,
  //   manteniendo la carga acumulada entre páginas.
  function pintarAsignacionAutomatica(box, ops) {
    box.innerHTML = '<div style="color:#999;">Cargando...</div>'

    getUnassignedCount(candidateId).then(total => pintarUI(total)).catch(err => {
      box.innerHTML = `<div style="color:#c62828;">Error cargando: ${escapeHtml(err.message)}</div>`
    })

    function pintarUI(totalSinAsignar) {
      box.innerHTML = `
        <h3 style="margin:0 0 8px; font-size:1.05rem;">🤖 Asignación automática masiva</h3>
        <p style="font-size:.85rem; color:#666; margin:0 0 14px;">Reparte los <strong>${totalSinAsignar}</strong> votantes sin operador entre los operadores que elijas, según el criterio.</p>

        ${ops.length === 0 ? '<div style="color:#999;">No hay operadores creados todavía.</div>' : totalSinAsignar === 0 ? '<div style="color:#999;">No hay votantes sin asignar en este momento.</div>' : `
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:16px;">
            <div>
              <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Criterio de reparto:</label>
              <select id="sel-criterio-auto" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
                <option value="dirigente">Por dirigente (todos los votantes de un mismo dirigente van al mismo operador)</option>
                <option value="local">Por local de votación (todos los votantes de un mismo local van al mismo operador)</option>
                <option value="equitativo">Distribución equitativa (sin agrupar, parejo votante por votante)</option>
              </select>
            </div>
            <div>
              <label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">Operadores que participan:</label>
              <div style="border:1px solid #ccc; border-radius:4px; padding:8px; max-height:120px; overflow-y:auto;">
                ${ops.map(o => `
                  <label style="display:flex; align-items:center; gap:6px; font-size:.82rem; padding:2px 0; cursor:pointer;">
                    <input type="checkbox" class="chk-op-auto" value="${o.id}" checked> ${escapeHtml(o.nombre || o.email)}
                  </label>
                `).join('')}
              </div>
            </div>
          </div>

          <div id="cc-preview-auto" style="margin-bottom:16px; font-size:.85rem; color:#666;"></div>

          <button id="btn-ejecutar-auto" style="background:#6a1b9a; color:white; border:none; padding:12px 20px; border-radius:6px; cursor:pointer; font-weight:700;">🚀 Ejecutar asignación automática</button>
          <div id="cc-progreso-auto" style="margin-top:10px; font-size:.85rem; font-weight:700;"></div>
        `}
      `

      if (ops.length === 0 || totalSinAsignar === 0) return

      function operadoresSeleccionados() {
        return [...box.querySelectorAll('.chk-op-auto:checked')].map(chk => chk.value)
      }

      // Preview exacto solo para "dirigente" (cuesta poco: count() por
      // cada usuario del equipo, no por votante). Para "local"/
      // "equitativo" no hay forma barata de adelantar el reparto exacto
      // sin escanear — se avisa así en vez de fingir precisión.
      async function pintarPreview() {
        const criterio = box.querySelector('#sel-criterio-auto').value
        const opIds = operadoresSeleccionados()
        const previewBox = box.querySelector('#cc-preview-auto')
        if (opIds.length === 0) {
          previewBox.innerHTML = '<div style="color:#e65100;">Elegí al menos un operador.</div>'
          return
        }
        if (criterio !== 'dirigente') {
          previewBox.innerHTML = '<div>No hay vista previa exacta para este criterio (se calcula al ejecutar) — el reparto se hace en bloques, manteniendo la carga pareja entre operadores.</div>'
          return
        }
        previewBox.innerHTML = 'Calculando vista previa...'
        const carga = new Map(opIds.map(id => [id, 0]))
        for (const u of usuarios) {
          const count = await getUnassignedCountByDirigente(candidateId, u.id)
          if (count === 0) continue
          const opMenorCarga = opIds.reduce((min, id) => carga.get(id) < carga.get(min) ? id : min, opIds[0])
          carga.set(opMenorCarga, carga.get(opMenorCarga) + count)
        }
        previewBox.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px;">Vista previa del reparto:</div>
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:4px;">Operador</th><th>Votantes a asignar</th></tr></thead>
            <tbody>${opIds.map(id => `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:4px;">${escapeHtml(usuarioNombre(id))}</td><td>${carga.get(id)}</td></tr>`).join('')}</tbody>
          </table>
        `
      }
      pintarPreview()
      box.querySelector('#sel-criterio-auto').addEventListener('change', pintarPreview)
      box.querySelectorAll('.chk-op-auto').forEach(chk => chk.addEventListener('change', pintarPreview))

      box.querySelector('#btn-ejecutar-auto').addEventListener('click', async () => {
        const criterio = box.querySelector('#sel-criterio-auto').value
        const opIds = operadoresSeleccionados()
        if (opIds.length === 0) { alert('Elegí al menos un operador.'); return }
        if (!confirm(`¿Ejecutar la asignación automática por "${criterio}" entre ${opIds.length} operador(es)? Con muchos votantes puede tardar unos minutos.`)) return

        const progresoEl = box.querySelector('#cc-progreso-auto')
        const btn = box.querySelector('#btn-ejecutar-auto')
        btn.disabled = true
        try {
          const total = criterio === 'dirigente'
            ? await ejecutarPorDirigente(opIds, progresoEl)
            : await ejecutarPorLocalOEquitativo(criterio, opIds, progresoEl)
          progresoEl.textContent = `✅ Listo: ${total} votante(s) asignado(s) entre ${opIds.length} operador(es).`
          renderAsignacion(document.getElementById('cc-tab-body'))
        } catch (err) {
          progresoEl.textContent = `❌ Error: ${err.message}`
          btn.disabled = false
        }
      })
    }

    async function ejecutarPorDirigente(operadorIds, progresoEl) {
      const carga = new Map(operadorIds.map(id => [id, 0]))
      let total = 0
      for (const u of usuarios) {
        const grupo = await getUnassignedRecordsByDirigente(candidateId, u.id, 5000)
        if (grupo.length === 0) continue
        const opMenorCarga = operadorIds.reduce((min, id) => carga.get(id) < carga.get(min) ? id : min, operadorIds[0])
        progresoEl.textContent = `Asignando ${grupo.length} votante(s) de ${usuarioNombre(u.id)} a ${usuarioNombre(opMenorCarga)}... (total hasta ahora: ${total})`
        await assignVotersToOperatorBulk(candidateId, grupo.map(r => r.id), opMenorCarga, user.uid)
        carga.set(opMenorCarga, carga.get(opMenorCarga) + grupo.length)
        total += grupo.length
      }
      return total
    }

    async function ejecutarPorLocalOEquitativo(criterio, operadorIds, progresoEl) {
      const carga = new Map(operadorIds.map(id => [id, 0]))
      let cursor = null
      let total = 0
      let indiceRoundRobin = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { records, lastDoc, hasMore } = await getUnassignedRecordsPage(candidateId, { cursor, pageSize: 1000 })
        if (records.length === 0) break

        if (criterio === 'equitativo') {
          const porOperador = new Map(operadorIds.map(id => [id, []]))
          records.forEach(r => {
            const opId = operadorIds[indiceRoundRobin % operadorIds.length]
            porOperador.get(opId).push(r.id)
            indiceRoundRobin++
          })
          for (const [opId, ids] of porOperador) {
            if (ids.length === 0) continue
            await assignVotersToOperatorBulk(candidateId, ids, opId, user.uid)
            total += ids.length
          }
        } else {
          const porLocal = new Map()
          records.forEach(r => {
            const key = r.local || 'Sin local asignado'
            if (!porLocal.has(key)) porLocal.set(key, [])
            porLocal.get(key).push(r.id)
          })
          const grupos = [...porLocal.values()].sort((a, b) => b.length - a.length)
          for (const grupoIds of grupos) {
            const opMenorCarga = operadorIds.reduce((min, id) => carga.get(id) < carga.get(min) ? id : min, operadorIds[0])
            await assignVotersToOperatorBulk(candidateId, grupoIds, opMenorCarga, user.uid)
            carga.set(opMenorCarga, carga.get(opMenorCarga) + grupoIds.length)
            total += grupoIds.length
          }
        }

        progresoEl.textContent = `Progreso: ${total} votante(s) asignado(s) hasta ahora...`
        cursor = lastDoc
        if (!hasMore) break
      }
      return total
    }
  }

  // ── Pestaña Incidencias ──────────────────────────────────────────────
  // El volumen de incidencias lo genera actividad humana puntual (un
  // operador marcando un problema), no el tamaño del padrón — se puede
  // seguir trayendo completo sin escalar mal, a diferencia de savedRecords.
  async function renderIncidencias(body) {
    body.innerHTML = '<div style="color:#999;">Cargando...</div>'
    if (isAdminView) {
      incidencias = await getAllIncidents(candidateId)
      const ids = incidencias.map(i => i.voterId)
      registros = await getRecordsByIds(candidateId, ids)
    }

    const abiertas = incidencias.filter(i => i.status === 'open')
    const enProceso = incidencias.filter(i => i.status === 'in_progress')
    const resueltas = incidencias.filter(i => i.status === 'resolved' || i.status === 'cancelled')

    const filaIncidencia = (i) => {
      const registro = registroPorId(i.voterId)
      return `
      <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <div>
            <strong>${escapeHtml(i.type)}</strong>
            <div style="font-size:.78rem; color:#666;">${registro ? escapeHtml(registro.nombre) + ' · CI ' + escapeHtml(registro.cedula) : i.voterId}</div>
            ${i.description ? `<div style="font-size:.8rem; color:#444; margin-top:4px;">${escapeHtml(i.description)}</div>` : ''}
            <div style="font-size:.7rem; color:#999; margin-top:4px;">Reportado ${fmtFecha(i.createdAt)} por ${escapeHtml(usuarioNombre(i.reportedBy))}</div>
          </div>
          <div style="display:flex; gap:4px; align-self:flex-start;">
            ${i.status === 'open' ? `<button class="btn-en-proceso" data-id="${i.id}" style="background:#ff9800; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">En proceso</button>` : ''}
            ${i.status !== 'resolved' && i.status !== 'cancelled' ? `<button class="btn-resolver" data-id="${i.id}" style="background:#4caf50; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✓ Resuelta</button>` : ''}
          </div>
        </div>
      </div>`
    }

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">⚠️ Incidencias</h3>
        <button id="btn-nueva-incidencia" style="background:#e65100; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">➕ Nueva incidencia</button>
      </div>
      <div id="cc-form-incidencia"></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px;">
        <div><h4 style="margin:0 0 8px; font-size:.85rem; color:#e65100; text-transform:uppercase;">Abiertas (${abiertas.length})</h4>${abiertas.map(filaIncidencia).join('') || '<div style="color:#999; font-size:.85rem;">Ninguna.</div>'}</div>
        <div><h4 style="margin:0 0 8px; font-size:.85rem; color:#1976d2; text-transform:uppercase;">En proceso (${enProceso.length})</h4>${enProceso.map(filaIncidencia).join('') || '<div style="color:#999; font-size:.85rem;">Ninguna.</div>'}</div>
        <div><h4 style="margin:0 0 8px; font-size:.85rem; color:#4caf50; text-transform:uppercase;">Resueltas (${resueltas.length})</h4>${resueltas.map(filaIncidencia).join('') || '<div style="color:#999; font-size:.85rem;">Ninguna.</div>'}</div>
      </div>
    `

    body.querySelectorAll('.btn-en-proceso').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateIncidentStatus(candidateId, btn.dataset.id, 'in_progress', user.uid)
        renderIncidencias(body)
      })
    })
    body.querySelectorAll('.btn-resolver').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateIncidentStatus(candidateId, btn.dataset.id, 'resolved', user.uid)
        renderIncidencias(body)
      })
    })

    body.querySelector('#btn-nueva-incidencia').addEventListener('click', () => {
      const formBox = body.querySelector('#cc-form-incidencia')
      formBox.innerHTML = `
        <div style="background:#fff3e0; border-radius:6px; padding:14px; margin-bottom:16px; display:grid; gap:8px;">
          <div style="font-size:.72rem; color:#856404;">💡 Si buscás por nombre, utilizá el primer apellido.</div>
          <div class="filter-input-wrap"><input id="inp-buscar-votante-inc" class="filter-input" placeholder="Buscar votante por CI o nombre..."></div>
          <div id="cc-sugerencias-votante-inc" style="max-height:160px; overflow-y:auto; border:1px solid #eee; border-radius:4px; display:none;"></div>
          <input type="hidden" id="inp-votante-id-inc">
          <div id="cc-votante-elegido-inc" style="font-size:.8rem; color:#555;"></div>
          <select id="inp-tipo-incidencia" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            ${TIPOS_INCIDENCIA.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
          <textarea id="inp-desc-incidencia" placeholder="Descripción" rows="2" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-family:inherit;"></textarea>
          <div style="display:flex; gap:8px;">
            <button id="btn-guardar-incidencia" style="flex:1; background:#e65100; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">✅ Registrar</button>
            <button id="btn-cancelar-incidencia" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `
      formBox.querySelector('#btn-cancelar-incidencia').addEventListener('click', () => { formBox.innerHTML = '' })
      let ultimosMatches = []
      formBox.querySelector('#inp-buscar-votante-inc').addEventListener('input', debounce(async (e) => {
        const termino = e.target.value.trim()
        const sugBox = formBox.querySelector('#cc-sugerencias-votante-inc')
        if (termino.length < 2) { sugBox.style.display = 'none'; return }
        ultimosMatches = isAdminView
          ? await searchRecordsForContactCenter(candidateId, termino)
          : registros.filter(r => String(r.cedula).toLowerCase().includes(termino.toLowerCase()) || String(r.nombre).toLowerCase().includes(termino.toLowerCase())).slice(0, 15)
        sugBox.style.display = ultimosMatches.length ? 'block' : 'none'
        sugBox.innerHTML = ultimosMatches.map(r => `<div class="cc-sug-item" data-id="${r.id}" style="padding:6px 10px; cursor:pointer; font-size:.82rem; border-bottom:1px solid #f0f0f0;">${escapeHtml(r.nombre)} — CI ${escapeHtml(r.cedula)}</div>`).join('')
        sugBox.querySelectorAll('.cc-sug-item').forEach(item => {
          item.addEventListener('click', () => {
            const r = ultimosMatches.find(x => x.id === item.dataset.id)
            if (!registroPorId(r.id)) registros.push(r)
            formBox.querySelector('#inp-votante-id-inc').value = r.id
            formBox.querySelector('#cc-votante-elegido-inc').textContent = `Elegido: ${r.nombre} (CI ${r.cedula})`
            sugBox.style.display = 'none'
            formBox.querySelector('#inp-buscar-votante-inc').value = ''
          })
        })
      }, 250))
      formBox.querySelector('#btn-guardar-incidencia').addEventListener('click', async () => {
        const voterId = formBox.querySelector('#inp-votante-id-inc').value
        if (!voterId) { alert('Elegí un votante de la lista de sugerencias.'); return }
        const type = formBox.querySelector('#inp-tipo-incidencia').value
        const description = formBox.querySelector('#inp-desc-incidencia').value.trim()
        try {
          const [asig] = await getCallAssignmentsByIds(candidateId, [voterId])
          await createIncident(candidateId, voterId, asig?.assignedUserId || null, user.uid, { type, description })
          formBox.innerHTML = ''
          renderIncidencias(body)
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  // ── Pestaña Día D — uso rápido con botones grandes ───────────────────
  // Para admin/coordinador se acota a las asignaciones más recientes (ver
  // getRecentCallAssignments) — el día de la elección, para operar sobre
  // el padrón completo está el módulo dedicado Día D Control.
  async function renderDiaD(body) {
    body.innerHTML = '<div style="color:#999;">Cargando...</div>'
    let asignadosConDatos

    if (isAdminView) {
      asignaciones = await getRecentCallAssignments(candidateId, 300)
      const ids = asignaciones.map(a => a.voterId)
      const [regs, ests] = await Promise.all([getRecordsByIds(candidateId, ids), getElectionStatusesByIds(candidateId, ids)])
      registros = regs; estados = ests
      asignadosConDatos = asignaciones.map(a => ({ asignacion: a, registro: registroPorId(a.voterId), estado: estadoPorVoterId(a.voterId) })).filter(x => x.registro)
    } else {
      asignadosConDatos = asignaciones.map(a => ({ asignacion: a, registro: registroPorId(a.voterId), estado: estadoPorVoterId(a.voterId) })).filter(x => x.registro)
    }

    body.innerHTML = `
      <h3 style="margin:0 0 14px; font-size:1.05rem;">🗳️ Día D — Monitoreo rápido (${asignadosConDatos.length}${isAdminView ? ', más recientes' : ''})</h3>
      ${isAdminView ? '<p style="font-size:.78rem; color:#999; margin:-8px 0 14px;">Para operar sobre todo el padrón el día de la elección, usá el módulo dedicado "Día D Control".</p>' : ''}
      <div id="cc-diad-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px;"></div>
    `
    pintarGridDiaD()

    function pintarGridDiaD() {
      const grid = document.getElementById('cc-diad-grid')
      if (asignadosConDatos.length === 0) {
        grid.innerHTML = '<div style="color:#999; padding:20px;">No hay votantes asignados.</div>'
        return
      }
      grid.innerHTML = asignadosConDatos.map(({ registro, estado }) => {
        const telLimpio = normalizarTelefonoPY(registro.telefono)
        const e = estado || {}
        const botonEstado = (activo) => `background:${activo ? '#4caf50' : '#eee'}; color:${activo ? 'white' : '#333'};`
        return `
        <div class="cc-diad-card" data-id="${registro.id}" style="border:1px solid #ddd; border-radius:10px; padding:14px; background:${e.voted ? '#e8f5e9' : 'white'};">
          <div style="font-weight:700; font-size:1rem;">${escapeHtml(registro.nombre)}</div>
          <div style="font-size:.78rem; color:#666;">CI ${escapeHtml(registro.cedula)} · 📱 ${escapeHtml(registro.telefono) || 'sin tel.'}</div>
          <div style="font-size:.78rem; color:#666; margin-bottom:6px;">🏠 ${escapeHtml(registro.direccion) || '—'} ${registro.googleMapsUrl ? `· <a href="${escapeHtml(registro.googleMapsUrl)}" target="_blank" rel="noopener">📍 Maps</a>` : ''}</div>
          <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;">
            ${e.requiresPickup || registro.requiresPickup ? '<span style="background:#eef3f8; color:#1f4b7a; padding:2px 6px; border-radius:8px; font-size:.68rem; font-weight:600;">🚐 Transporte</span>' : ''}
            ${e.needsAssistance || registro.needsAssistance ? '<span style="background:#eef3f8; color:#1f4b7a; padding:2px 6px; border-radius:8px; font-size:.68rem; font-weight:600;">🦽 Ayuda</span>' : ''}
            ${registro.chofer_asignado ? '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:8px; font-size:.68rem; font-weight:600;">🧑‍✈️ Chofer asignado</span>' : ''}
            ${e.lastStatus ? `<span style="background:#ede7f6; color:#4527a0; padding:2px 6px; border-radius:8px; font-size:.68rem; font-weight:600;">${escapeHtml(e.lastStatus)}</span>` : ''}
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="btn-diad" data-id="${registro.id}" data-accion="voted" style="${botonEstado(e.voted)} border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">🗳️ Ya votó</button>
            <button class="btn-diad" data-id="${registro.id}" data-accion="couldNotVote" style="${botonEstado(e.couldNotVote)} border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">⛔ No pudo votar</button>
            <button class="btn-diad" data-id="${registro.id}" data-accion="arrivedAtPollingPlace" style="${botonEstado(e.arrivedAtPollingPlace)} border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">📍 Fue al local</button>
            <button class="btn-diad" data-id="${registro.id}" data-accion="requiresPickup" style="${botonEstado(e.requiresPickup)} border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">🚐 Necesita transporte</button>
            <button class="btn-diad" data-id="${registro.id}" data-accion="needsAssistance" style="${botonEstado(e.needsAssistance)} border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">🦽 Necesita ayuda</button>
            <button class="btn-diad-incidencia" data-id="${registro.id}" style="background:#e65100; color:white; border:none; padding:10px 6px; border-radius:6px; cursor:pointer; font-weight:700; font-size:.78rem;">⚠️ Incidencia</button>
          </div>
          ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="display:block; text-align:center; margin-top:6px; text-decoration:none; background:#25d366; color:white; padding:6px; border-radius:6px; font-size:.75rem; font-weight:600;">💬 WhatsApp</a>` : ''}
        </div>`
      }).join('')

      grid.querySelectorAll('.btn-diad').forEach(btn => {
        btn.addEventListener('click', async () => {
          const registro = registroPorId(btn.dataset.id)
          const campo = btn.dataset.accion
          const asig = asignacionPorVoterId(registro.id)
          const nuevoValor = !(estadoPorVoterId(registro.id)?.[campo])
          const lastStatusMap = { voted: 'voted', couldNotVote: 'could_not_vote', arrivedAtPollingPlace: 'arrived', requiresPickup: 'requires_pickup', needsAssistance: 'needs_assistance' }
          try {
            await upsertElectionStatus(candidateId, registro.id, asig?.assignedUserId || user.uid, { [campo]: nuevoValor, lastStatus: nuevoValor ? lastStatusMap[campo] : (estadoPorVoterId(registro.id)?.lastStatus || null) }, user.uid)
            // "Ya votó" es la única fuente de verdad compartida con Día D
            // Control (electionDayControl.status==='voted', ver auditoría
            // Día D) — marcarlo acá también actualiza esa fuente en vez de
            // quedar solo en electionStatus, que ningún otro panel lee.
            if (campo === 'voted' && nuevoValor) {
              try {
                await setDiaDStatus(candidateId, registro, 'voted', user.uid, myRole)
              } catch (err) {
                console.warn('No se pudo sincronizar con Día D Control (electionDayControl):', err.message)
              }
            }
            const idx = estados.findIndex(e => e.voterId === registro.id)
            if (idx >= 0) estados[idx] = { ...estados[idx], [campo]: nuevoValor }
            else estados.push({ id: registro.id, voterId: registro.id, assignedUserId: asig?.assignedUserId || user.uid, [campo]: nuevoValor })
            pintarGridDiaD()
          } catch (err) {
            alert('Error: ' + err.message)
          }
        })
      })
      grid.querySelectorAll('.btn-diad-incidencia').forEach(btn => {
        btn.addEventListener('click', () => {
          const registro = registroPorId(btn.dataset.id)
          const tipo = prompt(`Tipo de incidencia para ${registro.nombre}:\n(${TIPOS_INCIDENCIA.join(', ')})`, TIPOS_INCIDENCIA[0])
          if (!tipo) return
          const descripcion = prompt('Descripción (opcional):', '') || ''
          const asig = asignacionPorVoterId(registro.id)
          createIncident(candidateId, registro.id, asig?.assignedUserId || null, user.uid, { type: tipo, description: descripcion })
            .then(() => alert('✅ Incidencia registrada'))
            .catch(err => alert('Error: ' + err.message))
        })
      })
    }
  }

  container.innerHTML = '<div style="padding:40px; text-align:center; color:#999;">Cargando Centro de Contacto...</div>'
  await cargarDatos()
  render()
}
