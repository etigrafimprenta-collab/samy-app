/**
 * MÓDULO: DÍA D - PANEL CONTROL (candidato-scoped)
 *
 * UPGRADE (conserva lo que ya andaba: stats globales, ranking por
 * dirigente, detalle/búsqueda, botones de estado, asignar chofer, todo
 * eso sigue en renderAdminView). Se agregó:
 *   - vistas propias para chofer/dirigente/mesario (antes el tab ni
 *     siquiera era visible para esos roles)
 *   - electionDayControl como fuente rica de estado operativo, sincronizada
 *     con savedRecords.estado_dia_d/chofer_asignado y diaD/votes (antes
 *     Control pisaba estado_dia_d sin tocar diaD/votes, así que un voto
 *     marcado acá no aparecía en Día D Admin — bug real encontrado en la
 *     auditoría, corregido en setDiaDStatus)
 *   - dashboard con más tarjetas clickeables + filtros combinables
 *   - alertas e informes periódicos (client-computed, persistidos)
 *   - incidencias (reutiliza la colección `incidents` del Centro de
 *     Contacto en vez de crear una nueva — mismo shape, mismo flujo)
 *
 * Día D Control = operación electoral EN VIVO. No confundir con el Centro
 * de Contacto (src/pages/contactCenter.js), que es llamadas PREVIAS.
 */
import { debounce } from '../lib/debounce.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import {
  getCandidate,
  getAllRecords,
  getUserRecords,
  getRecordsByIds,
  getRecordsByDriver,
  getAllCandidateUsers,
  getDrivers,
  listenAllRecords,
  updateRecord,
  getElectionDayControl,
  getAllElectionDayControl,
  listenAllElectionDayControl,
  getElectionDayControlByLeader,
  getElectionDayControlByTableUser,
  getElectionDayControlByDriver,
  getDriverByUsuario,
  setDiaDStatus,
  setDiaDFlags,
  assignDriverToVoter,
  assignLeaderToVoter,
  assignTableUserToVoter,
  sincronizarElectionDayControlDesdeRegistros,
  getDiaDMovements,
  getAllElectionStatuses,
  createDiaDAlert,
  getOpenDiaDAlerts,
  resolveDiaDAlert,
  createDiaDReport,
  getRecentDiaDReports,
  getDiaDControlSettings,
  updateDiaDControlSettings,
  createIncident,
  getAllIncidents,
  updateIncidentStatus
} from '../lib/firebaseCandidate.js'

const STATUS_LABELS = {
  committed: '📌 Comprometido',
  pending: '⏳ Pendiente',
  contacted: '📞 Contactado',
  on_the_way: '🚐 En camino',
  pickup_required: '🚏 Requiere que lo busquen',
  driver_assigned: '🚗 Chofer asignado',
  picked_up: '🚙 En traslado',
  arrived_polling_place: '📍 Llegó al local',
  arrived_table: '🪑 Llegó a mesa',
  voted: '✅ Votó',
  no_answer: '🔇 No responde',
  not_found: '❓ No encontrado',
  will_not_vote: '🚫 No irá',
  incident: '⚠️ Incidencia',
  resolved: '✔️ Resuelto'
}

function normalizarTelefono(tel) {
  if (!tel) return ''
  const digits = String(tel).replace(/\D/g, '')
  if (!digits) return ''
  return '595' + digits.replace(/^0/, '')
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

function iniciarReloj(intervalKey) {
  actualizarHora()
  if (window[intervalKey]) clearInterval(window[intervalKey])
  window[intervalKey] = setInterval(actualizarHora, 1000)
}

function headerHtml(subtitle) {
  return `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed', sans-serif; font-size: 2rem; text-transform: uppercase;">🎮 CONTROL - DÍA D</h2>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem;">${subtitle} · Actualizado: <span id="hora-actual"></span></p>
    </div>
  `
}

// Auditoría RBAC: antes solo miraba `myRole` (legacy) para elegir la vista
// operativa — un usuario con un rol de sistema ADICIONAL asignado por
// roleIds (ej. alguien con myRole='viewer' que además tiene "dirigente"
// sumado) ya veía esta pestaña (el menú usa can()), pero caía siempre acá
// a renderAdminView, que en firestore.rules exige campaign_admin/
// coordinator — pantalla colgada en vez de su vista operativa real.
// `misRoles` trae los DOCUMENTOS de rol resueltos desde roleIds; solo los
// de sistema tienen `legacyRoleKey` (los personalizados no tienen una
// vista operativa propia acá todavía — ver limitación de roles
// personalizados en la auditoría RBAC).
export async function renderDiaDControlCandidate(container, candidateId, user, myRole, misRoles = []) {
  const rolesEfectivos = new Set([myRole, ...misRoles.map(r => r.legacyRoleKey).filter(Boolean)])
  if (rolesEfectivos.has('chofer')) return renderChoferView(container, candidateId, user)
  if (rolesEfectivos.has('dirigente')) return renderDirigenteView(container, candidateId, user)
  if (rolesEfectivos.has('mesario')) return renderMesarioView(container, candidateId, user)
  return renderAdminView(container, candidateId, user)
}

// ══════════════════════════════════════════════════════════════════════
// Helper compartido: tarjeta de votante con botones grandes de acción
// rápida — usado por las 3 vistas operativas (chofer/dirigente/mesario).
// ══════════════════════════════════════════════════════════════════════
function tarjetaAccionRapida({ record, control, botones, color, incidentTypes, candidateId, user, role, onUpdated, waMessage }) {
  const telLimpio = normalizarTelefono(record.telefono)
  const statusLabel = STATUS_LABELS[control?.status] || STATUS_LABELS.pending
  const waHref = telLimpio
    ? `https://wa.me/${telLimpio}${waMessage ? '?text=' + encodeURIComponent(waMessage(record)) : ''}`
    : null
  return `
    <div class="dd-card" data-id="${record.id}" style="border: 1px solid #ddd; border-radius: 10px; padding: 14px; background: ${control?.status === 'voted' ? '#e8f5e9' : 'white'};">
      <div style="font-weight: 700; font-size: 1rem;">${escapeHtml(record.nombre)}</div>
      <div style="font-size: 0.78rem; color: #666;">CI ${escapeHtml(record.cedula)} · 📱 ${escapeHtml(record.telefono) || 'sin tel.'}</div>
      <div style="font-size: 0.78rem; color: #666; margin-bottom: 6px;">🗳️ ${escapeHtml(record.local) || '—'} · Mesa ${escapeHtml(record.mesa) || '—'} ${record.direccion ? '· 🏠 ' + escapeHtml(record.direccion) : ''}</div>
      <span style="display:inline-block; background:#ede7f6; color:#4527a0; padding:2px 8px; border-radius:8px; font-size:.7rem; font-weight:700; margin-bottom:8px;">${statusLabel}</span>
      ${control?.incidentOpen ? '<span style="display:inline-block; background:#ffebee; color:#c62828; padding:2px 8px; border-radius:8px; font-size:.7rem; font-weight:700; margin-left:4px; margin-bottom:8px;">⚠️ Incidencia abierta</span>' : ''}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px;">
        ${botones.map(b => `<button class="dd-btn-accion" data-id="${record.id}" data-status="${b.status || ''}" data-flag="${b.flag || ''}" style="background: ${color}; color: white; border: none; padding: 10px 6px; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: .76rem;">${b.label}</button>`).join('')}
        <button class="dd-btn-incidencia" data-id="${record.id}" style="background: #e65100; color: white; border: none; padding: 10px 6px; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: .76rem;">⚠️ Incidencia</button>
      </div>
      ${waHref ? `<a href="${waHref}" target="_blank" rel="noopener" style="display:block; text-align:center; margin-top:6px; text-decoration:none; background:#25d366; color:white; padding:6px; border-radius:6px; font-size:.75rem; font-weight:600;">💬 WhatsApp</a>` : ''}
      ${record.googleMapsUrl ? `<a href="${escapeHtml(record.googleMapsUrl)}" target="_blank" rel="noopener" style="display:block; text-align:center; margin-top:4px; text-decoration:none; background:#1976d2; color:white; padding:6px; border-radius:6px; font-size:.75rem; font-weight:600;">📍 Google Maps</a>` : ''}
    </div>
  `
}

function wireAccionRapida(box, { candidateId, user, role, records, controlByVoterId, incidentTypes, onRefresh }) {
  box.querySelectorAll('.dd-btn-accion').forEach(btn => {
    btn.addEventListener('click', async () => {
      const record = records.find(r => r.id === btn.dataset.id)
      const control = controlByVoterId[record.id]
      btn.disabled = true
      try {
        if (btn.dataset.status) {
          await setDiaDStatus(candidateId, record, btn.dataset.status, user.uid, role)
        } else if (btn.dataset.flag) {
          await setDiaDFlags(candidateId, record, { [btn.dataset.flag]: true }, user.uid, role)
        }
        await onRefresh()
      } catch (err) {
        alert('Error: ' + err.message)
      } finally {
        btn.disabled = false
      }
    })
  })
  box.querySelectorAll('.dd-btn-incidencia').forEach(btn => {
    btn.addEventListener('click', () => {
      const record = records.find(r => r.id === btn.dataset.id)
      const tipo = prompt(`Tipo de incidencia para ${record.nombre}:\n(${incidentTypes.join(', ')})`, incidentTypes[0])
      if (!tipo) return
      const descripcion = prompt('Descripción (opcional):', '') || ''
      const control = controlByVoterId[record.id]
      Promise.all([
        createIncident(candidateId, record.id, control?.assignedLeaderId || record.uid || null, user.uid, { type: tipo, description: descripcion }),
        setDiaDFlags(candidateId, record, { incidentOpen: true }, user.uid, role)
      ]).then(onRefresh).catch(err => alert('Error: ' + err.message))
    })
  })
}

// ══════════════════════════════════════════════════════════════════════
// Vista CHOFER — solo sus votantes asignados (drivers.usuarioAsignado).
// ══════════════════════════════════════════════════════════════════════
async function renderChoferView(container, candidateId, user) {
  container.innerHTML = headerHtml('Vista chofer') + '<div id="dd-body" style="color:#999;">Cargando...</div>'
  iniciarReloj('__diaDControlChoferInterval')

  const [driver, candidate] = await Promise.all([
    getDriverByUsuario(candidateId, user.uid),
    getCandidate(candidateId)
  ])
  const body = document.getElementById('dd-body')
  if (!driver) {
    body.innerHTML = '<div style="background:white; border:1px solid #ddd; border-radius:8px; padding:30px; text-align:center; color:#999;">Todavía no tenés un perfil de chofer vinculado a tu usuario. Pedile al administrador que te asigne desde la pestaña Choferes.</div>'
    return
  }

  // Mensaje de WhatsApp pre-cargado — mismo criterio que el resto de la
  // app (campaign.js) para citar lista/opción, así el votante recibe
  // siempre el mismo formato venga de quien venga el mensaje.
  function armarMensajeWhatsapp(record) {
    const listaOpcion = candidate?.lista && candidate?.opcion
      ? ` (Lista "${candidate.lista}", Opción "${candidate.opcion}")`
      : ''
    return `¡Hola ${record.nombre}! Soy ${driver.nombre}, del equipo de ${candidate?.name || 'la campaña'}${listaOpcion}. ` +
      `Ya estoy yendo a buscarte para llevarte a votar${record.local ? ' a ' + record.local : ''}${record.mesa ? ' (mesa ' + record.mesa + ')' : ''}. ¡Te espero!`
  }

  // Lee directo de savedRecords.chofer_asignado (no de electionDayControl):
  // así aparece acá apenas un admin lo asigna desde la pestaña Choferes,
  // sin depender del backfill manual "crear control Día D" de Día D
  // Admin — antes, un votante asignado por ese camino no se veía nunca en
  // esta vista.
  async function cargarYPintar() {
    const [records, controls] = await Promise.all([
      getRecordsByDriver(candidateId, driver.id),
      getElectionDayControlByDriver(candidateId, driver.id)
    ])
    const controlByVoterId = {}
    controls.forEach(c => { controlByVoterId[c.voterId] = c })

    body.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:16px;">
        <strong>🚗 ${escapeHtml(driver.nombre)}</strong> — ${records.length} votante${records.length === 1 ? '' : 's'} asignado${records.length === 1 ? '' : 's'}
      </div>
      <div id="dd-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;"></div>
    `
    const grid = document.getElementById('dd-grid')
    if (records.length === 0) {
      grid.innerHTML = '<div style="color:#999; padding:20px;">No tenés votantes asignados todavía.</div>'
      return
    }
    grid.innerHTML = records.map(r => tarjetaAccionRapida({
      record: r, control: controlByVoterId[r.id],
      botones: [
        { label: '🚐 En camino a buscar', status: 'on_the_way' },
        { label: '🚙 Votante recogido', status: 'picked_up' },
        { label: '📍 Llegó al local', status: 'arrived_polling_place' },
        { label: '❓ No encontrado', status: 'not_found' },
        { label: '🦽 Requiere ayuda', flag: 'needsAssistance' }
      ],
      color: '#1976d2',
      waMessage: armarMensajeWhatsapp
    })).join('')

    wireAccionRapida(grid, {
      candidateId, user, role: 'chofer', records, controlByVoterId,
      incidentTypes: ['No encontró al votante', 'Vehículo con problema', 'Votante no responde', 'Otro'],
      onRefresh: cargarYPintar
    })
  }

  await cargarYPintar()
}

// ══════════════════════════════════════════════════════════════════════
// Vista DIRIGENTE — sus propios votantes (mismo alcance que Mis Registros).
// ══════════════════════════════════════════════════════════════════════
async function renderDirigenteView(container, candidateId, user) {
  container.innerHTML = headerHtml('Vista dirigente') + '<div id="dd-body" style="color:#999;">Cargando...</div>'
  iniciarReloj('__diaDControlDirigenteInterval')

  async function cargarYPintar() {
    // Une los propios (uid == self, lo de siempre) con los que un admin
    // le reasignó desde Día D Control vía assignedLeaderId — sin esto un
    // dirigente reasignado a un votante que no capturó él mismo no lo vería.
    const [propios, controls] = await Promise.all([
      getUserRecords(candidateId, user.uid),
      getElectionDayControlByLeader(candidateId, user.uid)
    ])
    const controlByVoterId = {}
    controls.forEach(c => { controlByVoterId[c.voterId] = c })

    const idsPropios = new Set(propios.map(r => r.id))
    const idsReasignados = controls.map(c => c.voterId).filter(id => !idsPropios.has(id))
    const reasignados = idsReasignados.length > 0 ? await getRecordsByIds(candidateId, idsReasignados) : []
    const records = [...propios, ...reasignados]

    const body = document.getElementById('dd-body')
    body.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:16px;">
        <strong>👤 Mis votantes comprometidos</strong> — ${records.length} total, ${records.filter(r => controlByVoterId[r.id]?.status === 'voted').length} ya votaron
      </div>
      <div id="dd-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;"></div>
    `
    const grid = document.getElementById('dd-grid')
    if (records.length === 0) {
      grid.innerHTML = '<div style="color:#999; padding:20px;">Todavía no guardaste ningún votante.</div>'
      return
    }
    grid.innerHTML = records.map(r => tarjetaAccionRapida({
      record: r, control: controlByVoterId[r.id],
      botones: [
        { label: '📞 Contactado', status: 'contacted' },
        { label: '🚐 Está yendo', status: 'on_the_way' },
        { label: '📍 Ya llegó', status: 'arrived_polling_place' },
        { label: '🔇 No responde', status: 'no_answer' },
        { label: '🚏 Necesita transporte', flag: 'requiresPickup' },
        { label: '🚫 No irá', status: 'will_not_vote' }
      ],
      color: '#9c27b0'
    })).join('')

    wireAccionRapida(grid, {
      candidateId, user, role: 'dirigente', records, controlByVoterId,
      incidentTypes: ['No encontró transporte', 'Documento perdido', 'Está esperando', 'Otro'],
      onRefresh: cargarYPintar
    })
  }

  await cargarYPintar()
}

// ══════════════════════════════════════════════════════════════════════
// Vista MESARIO — votantes de su local/mesa asignada.
// ══════════════════════════════════════════════════════════════════════
async function renderMesarioView(container, candidateId, user) {
  container.innerHTML = headerHtml('Vista mesario') + '<div id="dd-body" style="color:#999;">Cargando...</div>'
  iniciarReloj('__diaDControlMesarioInterval')

  async function cargarYPintar() {
    const controls = await getElectionDayControlByTableUser(candidateId, user.uid)
    const records = await getRecordsByIds(candidateId, controls.map(c => c.voterId))
    const controlByVoterId = {}
    controls.forEach(c => { controlByVoterId[c.voterId] = c })

    const body = document.getElementById('dd-body')
    if (records.length === 0) {
      body.innerHTML = '<div style="background:white; border:1px solid #ddd; border-radius:8px; padding:30px; text-align:center; color:#999;">Todavía no tenés votantes asignados a tu mesa. Pedile al administrador que te asigne desde el panel de Control.</div>'
      return
    }
    body.innerHTML = `
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:16px;">
        <strong>🪑 Mi mesa</strong> — ${records.length} votante${records.length === 1 ? '' : 's'}
      </div>
      <div id="dd-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;"></div>
    `
    const grid = document.getElementById('dd-grid')
    grid.innerHTML = records.map(r => tarjetaAccionRapida({
      record: r, control: controlByVoterId[r.id],
      botones: [
        { label: '📍 Llegó al local', status: 'arrived_polling_place' },
        { label: '🪑 Llegó a mesa', status: 'arrived_table' },
        { label: '✅ Ya votó', status: 'voted' },
        { label: '❓ No figura en mesa', status: 'not_found' },
        { label: '📄 Problema con documento', flag: 'incidentOpen' }
      ],
      color: '#2e7d32'
    })).join('')

    wireAccionRapida(grid, {
      candidateId, user, role: 'mesario', records, controlByVoterId,
      incidentTypes: ['Mesa equivocada', 'Problema con documento', 'No figura en el padrón', 'Otro'],
      onRefresh: cargarYPintar
    })
  }

  await cargarYPintar()
}

// ══════════════════════════════════════════════════════════════════════
// Vista ADMIN/COORDINADOR — panel completo (base conservada + upgrades).
// ══════════════════════════════════════════════════════════════════════
async function renderAdminView(container, candidateId, user) {
  container.innerHTML = headerHtml('Vista administrador') + '<div id="dd-body" style="color:#999;">Cargando...</div>'
  iniciarReloj('__diaDControlAdminInterval')

  let records = []
  let users = []
  let drivers = []
  let controls = []
  let incidents = []
  let estados = []
  let controlByVoterId = {}
  let estadoByVoterId = {}
  let filtroCard = null

  async function cargarDatos() {
    const [regs, eq, chof, ctrl, incs, ests] = await Promise.all([
      getAllRecords(candidateId),
      getAllCandidateUsers(candidateId),
      getDrivers(candidateId),
      getAllElectionDayControl(candidateId),
      getAllIncidents(candidateId),
      getAllElectionStatuses(candidateId)
    ])
    records = regs; users = eq; drivers = chof; controls = ctrl; incidents = incs; estados = ests
    controlByVoterId = {}
    controls.forEach(c => { controlByVoterId[c.voterId] = c })
    estadoByVoterId = {}
    estados.forEach(e => { estadoByVoterId[e.id] = e })
  }

  function render() {
    const body = document.getElementById('dd-body')
    body.innerHTML = `
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <button id="btn-sync-legacy" style="background:#607d8b; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:600; font-size:.8rem;">🔄 Sincronizar asignaciones existentes</button>
        <button id="btn-config-diad" style="background:#455a64; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:600; font-size:.8rem;">⚙️ Configuración</button>
      </div>
      <div id="dd-dashboard"></div>
      <div id="dd-alerts" style="margin-top:20px;"></div>
      <div id="dd-reports" style="margin-top:20px;"></div>

      <div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 24px; margin-top: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed', sans-serif; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">🏆 Ranking por dirigente</h3>
        <div id="ranking-container" style="display: grid; gap: 12px;"></div>
      </div>

      <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 24px; margin-top: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed', sans-serif; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🔍 Lista operativa</h3>
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div id="dd-filtros" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap: 8px; margin-bottom: 16px;"></div>
        <div id="dd-lista-operativa"></div>
      </div>
    `

    document.getElementById('btn-sync-legacy').addEventListener('click', async () => {
      if (!confirm('Esto crea el registro de control Día D para votantes que ya tenían chofer o estado asignado desde antes. ¿Continuar?')) return
      const n = await sincronizarElectionDayControlDesdeRegistros(candidateId, records, user.uid)
      alert(`✅ Sincronizados ${n} votante(s).`)
      await cargarDatos()
      render()
    })
    document.getElementById('btn-config-diad').addEventListener('click', abrirConfiguracion)

    renderDashboard()
    renderAlertas()
    renderInformes()
    renderRanking()
    renderFiltros()
    renderListaOperativa()
  }

  function statCard(key, emoji, label, valor, color) {
    return `<button class="dd-card-stat" data-key="${key}" style="text-align:left; cursor:pointer; background:${filtroCard === key ? color : 'white'}; border:1px solid ${color}; border-radius:8px; padding:14px;">
      <div style="font-size:1.5rem; font-weight:800; color:${filtroCard === key ? 'white' : color};">${valor}</div>
      <div style="font-size:.7rem; font-weight:700; color:${filtroCard === key ? 'white' : '#555'}; text-transform:uppercase;">${emoji} ${label}</div>
    </button>`
  }

  function renderDashboard() {
    const totalComprometidos = records.length
    const yaVotaron = records.filter(r => controlByVoterId[r.id]?.status === 'voted').length
    const pendientes = records.filter(r => !controlByVoterId[r.id] || controlByVoterId[r.id].status === 'pending').length
    const enCamino = records.filter(r => controlByVoterId[r.id]?.status === 'on_the_way').length
    const enTraslado = records.filter(r => controlByVoterId[r.id]?.status === 'picked_up').length
    const llegaronLocal = records.filter(r => controlByVoterId[r.id]?.status === 'arrived_polling_place').length
    const llegaronMesa = records.filter(r => controlByVoterId[r.id]?.status === 'arrived_table').length
    const requierenTransporte = records.filter(r => controlByVoterId[r.id]?.requiresPickup).length
    const sinChofer = records.filter(r => controlByVoterId[r.id]?.requiresPickup && !controlByVoterId[r.id]?.assignedDriverId).length
    const conIncidencia = records.filter(r => controlByVoterId[r.id]?.incidentOpen).length
    const confirmadosMesario = records.filter(r => controlByVoterId[r.id]?.status === 'voted' && controlByVoterId[r.id]?.lastUpdatedRole === 'mesario').length
    const pendientesPorDirigente = records.filter(r => !controlByVoterId[r.id] || (controlByVoterId[r.id].status !== 'voted' && controlByVoterId[r.id].status !== 'will_not_vote')).length

    document.getElementById('dd-dashboard').innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px;">
        ${statCard('all', '📌', 'Comprometidos', totalComprometidos, '#455a64')}
        ${statCard('voted', '✅', 'Ya votaron', yaVotaron, '#2e7d32')}
        ${statCard('pending', '⏳', 'Pendientes', pendientes, '#e65100')}
        ${statCard('on_the_way', '🚐', 'En camino', enCamino, '#1976d2')}
        ${statCard('picked_up', '🚙', 'En traslado', enTraslado, '#1976d2')}
        ${statCard('arrived_polling_place', '📍', 'Llegaron al local', llegaronLocal, '#00897b')}
        ${statCard('arrived_table', '🪑', 'Llegaron a mesa', llegaronMesa, '#00897b')}
        ${statCard('requiresPickup', '🚏', 'Requieren transporte', requierenTransporte, '#6a1b9a')}
        ${statCard('sinChofer', '⚠️', 'Sin chofer asignado', sinChofer, '#c62828')}
        ${statCard('incidentOpen', '🚨', 'Con incidencia abierta', conIncidencia, '#c62828')}
        ${statCard('mesarioConfirmed', '🪑', 'Confirmados por mesario', confirmadosMesario, '#2e7d32')}
        ${statCard('pendientesDirigente', '👤', 'Pendientes por dirigente', pendientesPorDirigente, '#e65100')}
      </div>
    `
    document.querySelectorAll('.dd-card-stat').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroCard = filtroCard === btn.dataset.key ? null : btn.dataset.key
        renderDashboard()
        renderListaOperativa()
      })
    })
  }

  function pasaFiltroCard(record) {
    const c = controlByVoterId[record.id]
    if (!filtroCard || filtroCard === 'all') return true
    if (filtroCard === 'pending') return !c || c.status === 'pending'
    if (filtroCard === 'requiresPickup') return !!c?.requiresPickup
    if (filtroCard === 'sinChofer') return !!c?.requiresPickup && !c?.assignedDriverId
    if (filtroCard === 'incidentOpen') return !!c?.incidentOpen
    if (filtroCard === 'mesarioConfirmed') return c?.status === 'voted' && c?.lastUpdatedRole === 'mesario'
    if (filtroCard === 'pendientesDirigente') return !c || (c.status !== 'voted' && c.status !== 'will_not_vote')
    return c?.status === filtroCard
  }

  function renderFiltros() {
    const opcion = (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    const locales = [...new Set(records.map(r => r.local).filter(Boolean))].sort()
    const mesas = [...new Set(records.map(r => r.mesa).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    const dirigentes = [...new Set(records.map(r => r.uid).filter(Boolean))].map(uid => ({ uid, nombre: users.find(u => u.id === uid)?.nombre || users.find(u => u.id === uid)?.email || 'N/A' }))

    document.getElementById('dd-filtros').innerHTML = `
      <input id="dd-f-texto" placeholder="Buscar por CI o nombre..." style="padding:8px; border:1px solid #ccc; border-radius:4px;">
      <select id="dd-f-local" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
        <option value="">Todos los locales</option>${locales.map(opcion).join('')}
      </select>
      <select id="dd-f-mesa" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
        <option value="">Todas las mesas</option>${mesas.map(opcion).join('')}
      </select>
      <select id="dd-f-dirigente" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
        <option value="">Todos los dirigentes</option>${dirigentes.map(d => `<option value="${escapeHtml(d.uid)}">${escapeHtml(d.nombre)}</option>`).join('')}
      </select>
      <select id="dd-f-chofer" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
        <option value="">Todos los choferes</option>${drivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.nombre)}</option>`).join('')}
      </select>
      <select id="dd-f-estado" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
        <option value="">Todos los estados</option>${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select>
    `
    ;['dd-f-texto'].forEach(id => document.getElementById(id).addEventListener('input', debounce(renderListaOperativa, 250)))
    ;['dd-f-local', 'dd-f-mesa', 'dd-f-dirigente', 'dd-f-chofer', 'dd-f-estado'].forEach(id => document.getElementById(id).addEventListener('change', renderListaOperativa))
  }

  // Checklist de contexto junto al botón "✅ Votó": junta lo que ya marcaron
  // llamado (electionStatus, desde Centro de Contacto), chofer y mesario
  // (electionDayControl) para que quien confirma el estado definitivo de
  // voto en Día D Control no lo haga a ciegas. Solo se muestra si alguno de
  // los 3 ya marcó algo — si todo sigue pendiente, no agrega ruido visual.
  // El mesario es la única de las 3 señales que da certeza total (está
  // físicamente en la mesa), así que se destaca distinto a las demás.
  function chipContexto(texto, color) {
    return `<span style="display:inline-block; background:${color}22; color:${color}; border:1px solid ${color}66; padding:2px 6px; border-radius:6px; font-size:.66rem; font-weight:700; margin:0 3px 3px 0;">${texto}</span>`
  }

  function renderChecklistContexto(control, estado, choferNombre) {
    const chips = []

    if (estado?.confirmedToVote) chips.push(chipContexto('☎️ Confirmó voto por llamada', '#2e7d32'))
    else if (estado?.willNotVote) chips.push(chipContexto('☎️ Dijo que NO irá', '#c62828'))
    else if (estado?.undecided) chips.push(chipContexto('☎️ Indeciso en la llamada', '#e65100'))
    else if (estado?.contacted) chips.push(chipContexto('☎️ Contactado', '#1565c0'))

    if (control?.assignedDriverId) {
      const CHOFER_LABELS = { driver_assigned: 'asignado', on_the_way: 'en camino', picked_up: 'trasladando', arrived_polling_place: 'llegó al local' }
      chips.push(chipContexto(`🚗 Chofer ${CHOFER_LABELS[control.status] || 'asignado'} (${choferNombre})`, '#1976d2'))
    }

    if (control?.assignedTableUserId) {
      if (control.status === 'voted' || control.status === 'arrived_table') {
        chips.push(chipContexto('🪑 Mesario confirma presencia en mesa — certeza total', '#2e7d32'))
      } else {
        chips.push(chipContexto('🪑 Mesario asignado, todavía sin confirmar', '#e65100'))
      }
    }

    if (chips.length === 0) return ''
    return `<div style="max-width:230px; margin-bottom:5px;">${chips.join('')}</div>`
  }

  function renderListaOperativa() {
    const texto = (document.getElementById('dd-f-texto')?.value || '').trim().toLowerCase()
    const local = document.getElementById('dd-f-local')?.value || ''
    const mesa = document.getElementById('dd-f-mesa')?.value || ''
    const dirigente = document.getElementById('dd-f-dirigente')?.value || ''
    const chofer = document.getElementById('dd-f-chofer')?.value || ''
    const estado = document.getElementById('dd-f-estado')?.value || ''

    const filtrados = records.filter(r => {
      const c = controlByVoterId[r.id]
      if (!pasaFiltroCard(r)) return false
      if (texto && !(String(r.cedula).toLowerCase().includes(texto) || String(r.nombre).toLowerCase().includes(texto))) return false
      if (local && r.local !== local) return false
      if (mesa && String(r.mesa) !== mesa) return false
      if (dirigente && r.uid !== dirigente) return false
      if (chofer && c?.assignedDriverId !== chofer) return false
      if (estado && (c?.status || 'pending') !== estado) return false
      return true
    })

    const box = document.getElementById('dd-lista-operativa')
    box.innerHTML = `
      <div style="font-size:.82rem; color:#666; margin-bottom:10px;"><strong>${filtrados.length}</strong> de ${records.length} votantes</div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Votante</th><th>Local/Mesa</th><th>Dirigente</th><th>Chofer</th><th>Estado</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${filtrados.slice(0, 300).map(r => {
              const c = controlByVoterId[r.id]
              const dirigenteNombre = users.find(u => u.id === r.uid)?.nombre || users.find(u => u.id === r.uid)?.email || '—'
              const choferNombre = c?.assignedDriverId ? (drivers.find(d => d.id === c.assignedDriverId)?.nombre || '—') : '—'
              const telLimpio = normalizarTelefono(r.telefono)
              return `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;"><strong>${escapeHtml(r.nombre)}</strong><br><span style="color:#999; font-size:.72rem;">CI ${escapeHtml(r.cedula)}</span></td>
                <td>${escapeHtml(r.local) || '—'} / ${escapeHtml(r.mesa) || '—'}</td>
                <td>${escapeHtml(dirigenteNombre)}</td>
                <td>${escapeHtml(choferNombre)}</td>
                <td><span style="background:#ede7f6; color:#4527a0; padding:2px 6px; border-radius:6px; font-size:.7rem; font-weight:700;">${STATUS_LABELS[c?.status] || STATUS_LABELS.pending}</span>${c?.incidentOpen ? ' ⚠️' : ''}</td>
                <td>
                  ${renderChecklistContexto(c, estadoByVoterId[r.id], choferNombre)}
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <button class="dd-op-votar" data-id="${r.id}" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">✅ Votó</button>
                    <button class="dd-op-noira" data-id="${r.id}" style="background:#999; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🚫 No irá</button>
                    <button class="dd-op-chofer" data-id="${r.id}" style="background:#c41e3a; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🚗 Chofer</button>
                    <button class="dd-op-dirigente" data-id="${r.id}" style="background:#9c27b0; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">👤 Dirigente</button>
                    <button class="dd-op-mesario" data-id="${r.id}" style="background:#2196f3; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🪑 Mesario</button>
                    <button class="dd-op-historial" data-id="${r.id}" style="background:#455a64; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🕐 Historial</button>
                    ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:4px 8px; border-radius:4px; font-size:.7rem; font-weight:600;">💬</a>` : ''}
                  </div>
                </td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      ${filtrados.length > 300 ? `<div style="text-align:center; color:#999; padding:10px; font-size:.8rem;">Mostrando los primeros 300 — afiná los filtros para ver el resto.</div>` : ''}
      ${filtrados.length === 0 ? '<div style="text-align:center; color:#999; padding:30px;">Sin resultados.</div>' : ''}
    `

    box.querySelectorAll('.dd-op-votar').forEach(btn => btn.addEventListener('click', async () => {
      const r = records.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Marcar a ${r.nombre} como YA VOTÓ?`)) return
      try {
        await setDiaDStatus(candidateId, r, 'voted', user.uid, 'campaign_admin')
        await cargarDatos(); render()
      } catch (err) { alert('Error: ' + err.message) }
    }))
    box.querySelectorAll('.dd-op-noira').forEach(btn => btn.addEventListener('click', async () => {
      const r = records.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Marcar a ${r.nombre} como NO IRÁ?`)) return
      try {
        await setDiaDStatus(candidateId, r, 'will_not_vote', user.uid, 'campaign_admin')
        await cargarDatos(); render()
      } catch (err) { alert('Error: ' + err.message) }
    }))
    box.querySelectorAll('.dd-op-chofer').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x => x.id === btn.dataset.id)
      abrirAsignarChofer(r)
    }))
    box.querySelectorAll('.dd-op-dirigente').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x => x.id === btn.dataset.id)
      abrirAsignarDirigente(r)
    }))
    box.querySelectorAll('.dd-op-mesario').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x => x.id === btn.dataset.id)
      abrirAsignarMesario(r)
    }))
    box.querySelectorAll('.dd-op-historial').forEach(btn => btn.addEventListener('click', async () => {
      const r = records.find(x => x.id === btn.dataset.id)
      const movimientos = await getDiaDMovements(candidateId, r.id)
      const modal = abrirModal(`
        <h3 style="margin:0 0 16px;">🕐 Historial de ${escapeHtml(r.nombre)}</h3>
        <div style="max-height:400px; overflow-y:auto;">
          ${movimientos.length === 0 ? '<div style="color:#999;">Sin movimientos registrados.</div>' : movimientos.map(m => `
            <div style="border-left:3px solid #455a64; padding:6px 10px; margin-bottom:8px; background:#f5f5f5; font-size:.82rem;">
              <div><strong>${STATUS_LABELS[m.previousStatus] || '(sin estado)'}</strong> → <strong>${STATUS_LABELS[m.newStatus] || m.newStatus}</strong></div>
              <div style="color:#666; font-size:.72rem;">${m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('es-PY') : ''} · ${escapeHtml(users.find(u => u.id === m.updatedBy)?.nombre || m.role)}</div>
              ${m.note ? `<div style="color:#444;">${escapeHtml(m.note)}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <button id="btn-cerrar-historial" style="margin-top:12px; width:100%; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cerrar</button>
      `, '480px')
      modal.querySelector('#btn-cerrar-historial').addEventListener('click', () => modal.remove())
    }))
  }

  function abrirModal(html, maxWidth = '460px') {
    const modal = document.createElement('div')
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;'
    modal.innerHTML = `<div style="background:white; border-radius:8px; padding:24px; max-width:${maxWidth}; width:100%;">${html}</div>`
    document.body.appendChild(modal)
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
    return modal
  }

  function abrirAsignarChofer(record) {
    const choferesLocal = drivers.filter(d => d.local === record.local)
    const modal = abrirModal(`
      <h3 style="margin:0 0 16px;">🚗 Asignar chofer a ${escapeHtml(record.nombre)}</h3>
      <select id="sel-chofer" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px;">
        <option value="">-- Elegí un chofer --</option>
        ${(choferesLocal.length > 0 ? choferesLocal : drivers).map(d => `<option value="${d.id}">${escapeHtml(d.nombre)} (${escapeHtml(d.telefono || d.celular || '')})</option>`).join('')}
      </select>
      <div style="display:flex; gap:8px;">
        <button id="btn-confirmar" style="flex:1; background:#c41e3a; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Asignar</button>
        <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
      </div>
    `)
    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
      const driverId = modal.querySelector('#sel-chofer').value
      if (!driverId) { alert('Elegí un chofer.'); return }
      try {
        await assignDriverToVoter(candidateId, record, driverId, user.uid)
        modal.remove()
        await cargarDatos(); render()
      } catch (err) { alert('Error: ' + err.message) }
    })
  }

  function abrirAsignarDirigente(record) {
    const modal = abrirModal(`
      <h3 style="margin:0 0 16px;">👤 Asignar dirigente a ${escapeHtml(record.nombre)}</h3>
      <select id="sel-dirigente" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px;">
        <option value="">-- Elegí un dirigente --</option>
        ${users.filter(u => u.role === 'dirigente' || u.role === 'campaign_admin' || u.role === 'coordinator').map(u => `<option value="${u.id}" ${controlByVoterId[record.id]?.assignedLeaderId === u.id ? 'selected' : ''}>${escapeHtml(u.nombre || u.email)}</option>`).join('')}
      </select>
      <div style="display:flex; gap:8px;">
        <button id="btn-confirmar" style="flex:1; background:#9c27b0; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Asignar</button>
        <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
      </div>
    `)
    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
      const leaderUid = modal.querySelector('#sel-dirigente').value
      if (!leaderUid) { alert('Elegí un dirigente.'); return }
      try {
        await assignLeaderToVoter(candidateId, record, leaderUid, user.uid)
        modal.remove()
        await cargarDatos(); render()
      } catch (err) { alert('Error: ' + err.message) }
    })
  }

  function abrirAsignarMesario(record) {
    const modal = abrirModal(`
      <h3 style="margin:0 0 16px;">🪑 Asignar mesario a ${escapeHtml(record.nombre)}</h3>
      <select id="sel-mesario" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px;">
        <option value="">-- Elegí un mesario --</option>
        ${users.filter(u => u.role === 'mesario').map(u => `<option value="${u.id}" ${controlByVoterId[record.id]?.assignedTableUserId === u.id ? 'selected' : ''}>${escapeHtml(u.nombre || u.email)}</option>`).join('')}
      </select>
      <div style="display:flex; gap:8px;">
        <button id="btn-confirmar" style="flex:1; background:#2196f3; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Asignar</button>
        <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
      </div>
    `)
    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
      const tableUserUid = modal.querySelector('#sel-mesario').value
      if (!tableUserUid) { alert('Elegí un mesario.'); return }
      try {
        await assignTableUserToVoter(candidateId, record, tableUserUid, user.uid)
        modal.remove()
        await cargarDatos(); render()
      } catch (err) { alert('Error: ' + err.message) }
    })
  }

  // ── Ranking por dirigente (conservado del panel original) ────────────
  function generarRanking() {
    const map = new Map()
    records.forEach(r => {
      if (!map.has(r.uid)) {
        const u = users.find(x => x.id === r.uid)
        map.set(r.uid, { id: r.uid, nombre: u?.nombre || u?.email || 'Sin nombre', votos: 0, enCamino: 0, pendientes: 0, total: 0 })
      }
      const m = map.get(r.uid)
      m.total += 1
      const status = controlByVoterId[r.id]?.status
      if (status === 'voted') m.votos += 1
      else if (status === 'on_the_way' || status === 'picked_up') m.enCamino += 1
      else m.pendientes += 1
    })
    return Array.from(map.values()).sort((a, b) => b.votos - a.votos || b.enCamino - a.enCamino)
  }

  function renderRanking() {
    const ranking = generarRanking()
    const el = document.getElementById('ranking-container')
    if (ranking.length === 0) { el.innerHTML = '<div style="color:#999; padding:20px;">Sin datos todavía.</div>'; return }
    el.innerHTML = ranking.map((m, idx) => {
      const progreso = m.total > 0 ? ((m.votos / m.total) * 100).toFixed(0) : 0
      return `
      <div style="background: white; border: 2px solid #ddd; border-radius: 8px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: 700;">#${idx + 1} ${escapeHtml(m.nombre)}</span>
          <span style="background: #2e7d32; color: white; padding: 3px 8px; border-radius: 4px; font-size: .75rem; font-weight: 600;">${m.votos}/${m.total}</span>
        </div>
        <div style="background: #f5f5f5; border-radius: 4px; height: 18px; overflow: hidden;">
          <div style="background: linear-gradient(90deg, #2e7d32, #4caf50); height: 100%; width: ${progreso}%;"></div>
        </div>
        <div style="display:flex; gap:16px; margin-top:8px; font-size:.8rem;">
          <span style="color:#2e7d32; font-weight:600;">✅ ${m.votos} votó</span>
          <span style="color:#1976d2; font-weight:600;">🚐 ${m.enCamino} en camino</span>
          <span style="color:#e65100; font-weight:600;">⏳ ${m.pendientes} pendiente${m.pendientes === 1 ? '' : 's'}</span>
        </div>
      </div>`
    }).join('')
  }

  // ── Alertas ────────────────────────────────────────────────────────
  async function computarYGuardarAlertas(settings) {
    const nuevasAlertas = []
    const porDirigente = {}
    records.forEach(r => {
      const c = controlByVoterId[r.id]
      const status = c?.status || 'pending'
      if (status !== 'voted' && status !== 'will_not_vote') {
        porDirigente[r.uid] = (porDirigente[r.uid] || 0) + 1
      }
      if (c?.requiresPickup && !c?.assignedDriverId) {
        nuevasAlertas.push({ type: 'sin_chofer', severity: 'warning', voterId: r.id, assignedUserId: c?.assignedDriverId || null, message: `${r.nombre} requiere transporte y no tiene chofer asignado.` })
      }
    })
    Object.entries(porDirigente).forEach(([uid, cantidad]) => {
      if (cantidad >= settings.umbralPendientesPorDirigente) {
        const nombre = users.find(u => u.id === uid)?.nombre || users.find(u => u.id === uid)?.email || uid
        nuevasAlertas.push({ type: 'dirigente_muchos_pendientes', severity: 'warning', voterId: null, assignedUserId: uid, message: `${nombre} tiene ${cantidad} votantes pendientes.` })
      }
    })
    incidents.filter(i => i.status === 'open').forEach(i => {
      const abiertaHace = i.createdAt?.toDate ? (Date.now() - i.createdAt.toDate().getTime()) / 60000 : 0
      if (abiertaHace >= settings.umbralIncidenciaMinutos) {
        const r = records.find(x => x.id === i.voterId)
        nuevasAlertas.push({ type: 'incidencia_sin_resolver', severity: 'critical', voterId: i.voterId, assignedUserId: i.assignedUserId, message: `Incidencia sin resolver hace más de ${settings.umbralIncidenciaMinutos} min${r ? ' — ' + r.nombre : ''}.` })
      }
    })

    for (const a of nuevasAlertas) {
      await createDiaDAlert(candidateId, a)
    }
    return nuevasAlertas.length
  }

  async function renderAlertas() {
    const el = document.getElementById('dd-alerts')
    el.innerHTML = `
      <div style="background: white; border: 2px solid #e65100; border-radius: 8px; padding: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0; font-family: 'Barlow Condensed', sans-serif; font-size:1.2rem; color:#e65100; text-transform:uppercase;">🔔 Alertas</h3>
          <button id="btn-revisar-alertas" style="background:#e65100; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">Revisar alertas ahora</button>
        </div>
        <div id="dd-alertas-lista">Cargando...</div>
      </div>
    `
    document.getElementById('btn-revisar-alertas').addEventListener('click', async () => {
      const settings = await getDiaDControlSettings(candidateId)
      const n = await computarYGuardarAlertas(settings)
      alert(n > 0 ? `⚠️ Se generaron ${n} alerta(s) nueva(s).` : '✅ Sin novedades.')
      renderAlertas()
    })
    const alertas = await getOpenDiaDAlerts(candidateId)
    const lista = document.getElementById('dd-alertas-lista')
    lista.innerHTML = alertas.length === 0 ? '<div style="color:#999; padding:10px;">Sin alertas abiertas.</div>' : alertas.map(a => `
      <div style="border-left:4px solid ${a.severity === 'critical' ? '#c62828' : '#ff9800'}; background:#fff8e1; padding:10px; border-radius:4px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <div style="font-size:.85rem;"><strong>${escapeHtml(a.type)}</strong><br>${escapeHtml(a.message)}</div>
        <button class="dd-resolver-alerta" data-id="${a.id}" style="background:#4caf50; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✓ Resolver</button>
      </div>
    `).join('')
    lista.querySelectorAll('.dd-resolver-alerta').forEach(btn => {
      btn.addEventListener('click', async () => {
        await resolveDiaDAlert(candidateId, btn.dataset.id, user.uid)
        renderAlertas()
      })
    })
  }

  // ── Informes periódicos ───────────────────────────────────────────────
  async function generarInformeAhora() {
    const yaVotaron = records.filter(r => controlByVoterId[r.id]?.status === 'voted').length
    const pendientes = records.filter(r => !controlByVoterId[r.id] || controlByVoterId[r.id].status === 'pending').length
    const enTransito = records.filter(r => ['on_the_way', 'picked_up'].includes(controlByVoterId[r.id]?.status)).length
    const incidenciasAbiertas = incidents.filter(i => i.status === 'open' || i.status === 'in_progress').length
    const criticos = records.filter(r => controlByVoterId[r.id]?.critical).length

    const porLocal = {}
    records.forEach(r => {
      const local = r.local || 'Sin local'
      if (!porLocal[local]) porLocal[local] = { total: 0, votaron: 0 }
      porLocal[local].total++
      if (controlByVoterId[r.id]?.status === 'voted') porLocal[local].votaron++
    })
    const zonasMenorAvance = Object.entries(porLocal)
      .map(([local, d]) => ({ local, pct: d.total > 0 ? d.votaron / d.total : 0, ...d }))
      .sort((a, b) => a.pct - b.pct).slice(0, 5)

    const reportData = {
      totalCommitted: records.length,
      totalVoted: yaVotaron,
      totalPending: pendientes,
      totalInTransit: enTransito,
      totalIncidents: incidenciasAbiertas,
      criticalPending: criticos,
      porcentajeVotado: records.length > 0 ? ((yaVotaron / records.length) * 100).toFixed(1) : '0',
      choferesActivos: drivers.filter(d => (d.status || 'activo') === 'activo').length,
      zonasMenorAvance
    }
    await createDiaDReport(candidateId, reportData)
    return reportData
  }

  async function renderInformes() {
    const el = document.getElementById('dd-reports')
    el.innerHTML = `
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0; font-family: 'Barlow Condensed', sans-serif; font-size:1.2rem; color:#1976d2; text-transform:uppercase;">📄 Informes periódicos</h3>
          <button id="btn-generar-informe" style="background:#1976d2; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">Generar informe ahora</button>
        </div>
        <div id="dd-informes-lista">Cargando...</div>
      </div>
    `
    document.getElementById('btn-generar-informe').addEventListener('click', async () => {
      await generarInformeAhora()
      renderInformes()
    })
    const reports = await getRecentDiaDReports(candidateId, 5)
    const lista = document.getElementById('dd-informes-lista')
    lista.innerHTML = reports.length === 0 ? '<div style="color:#999; padding:10px;">Sin informes generados todavía.</div>' : reports.map(r => `
      <div style="border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:8px; font-size:.82rem;">
        <div style="color:#999; font-size:.72rem;">${r.generatedAt?.toDate ? r.generatedAt.toDate().toLocaleString('es-PY') : ''}</div>
        <div><strong>${r.totalVoted}</strong>/${r.totalCommitted} votaron (${r.reportData?.porcentajeVotado || 0}%) · ${r.totalPending} pendientes · ${r.totalInTransit} en tránsito · ${r.totalIncidents} incidencias abiertas</div>
      </div>
    `).join('')
  }

  // ── Configuración (intervalo de alertas, horarios, umbrales) ─────────
  async function abrirConfiguracion() {
    const settings = await getDiaDControlSettings(candidateId)
    const modal = abrirModal(`
      <h3 style="margin:0 0 16px;">⚙️ Configuración de Día D Control</h3>
      <div style="display:grid; gap:10px;">
        <label style="font-size:.8rem;">Intervalo de alertas (minutos)
          <input id="cfg-intervalo" type="number" min="1" value="${settings.intervaloAlertasMinutos}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
        <label style="font-size:.8rem;">Hora inicio control
          <input id="cfg-hora-inicio" type="time" value="${settings.horaInicioControl}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
        <label style="font-size:.8rem;">Hora fin control
          <input id="cfg-hora-fin" type="time" value="${settings.horaFinControl}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
        <label style="font-size:.8rem;">Umbral pendientes por dirigente
          <input id="cfg-umbral-pend" type="number" min="1" value="${settings.umbralPendientesPorDirigente}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
        <label style="font-size:.8rem;">Umbral incidencia sin resolver (minutos)
          <input id="cfg-umbral-inc" type="number" min="1" value="${settings.umbralIncidenciaMinutos}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
        <label style="font-size:.8rem;">Umbral sin movimiento (minutos)
          <input id="cfg-umbral-mov" type="number" min="1" value="${settings.umbralSinMovimientoMinutos}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-top:2px;"></label>
      </div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        <button id="btn-guardar-cfg" style="flex:1; background:#455a64; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
        <button id="btn-cancelar-cfg" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
      </div>
    `, '420px')
    modal.querySelector('#btn-cancelar-cfg').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-guardar-cfg').addEventListener('click', async () => {
      const nuevos = {
        intervaloAlertasMinutos: Number(modal.querySelector('#cfg-intervalo').value) || 15,
        horaInicioControl: modal.querySelector('#cfg-hora-inicio').value,
        horaFinControl: modal.querySelector('#cfg-hora-fin').value,
        umbralPendientesPorDirigente: Number(modal.querySelector('#cfg-umbral-pend').value) || 10,
        umbralIncidenciaMinutos: Number(modal.querySelector('#cfg-umbral-inc').value) || 30,
        umbralSinMovimientoMinutos: Number(modal.querySelector('#cfg-umbral-mov').value) || 45
      }
      try {
        await updateDiaDControlSettings(candidateId, nuevos)
        modal.remove()
        alert('✅ Configuración guardada')
        reiniciarTimerAutomatico(nuevos)
      } catch (err) { alert('Error: ' + err.message) }
    })
  }

  // ── Timer automático: revisa alertas y genera informe cada N minutos
  // mientras el panel esté abierto (ver nota en el entregable sobre por
  // qué esto es client-side y no un Cloud Scheduler). ───────────────────
  function reiniciarTimerAutomatico(settings) {
    if (window.__diaDControlAutoTimer) clearInterval(window.__diaDControlAutoTimer)
    window.__diaDControlAutoTimer = setInterval(async () => {
      if (!document.getElementById('dd-body')) { clearInterval(window.__diaDControlAutoTimer); return }
      await cargarDatos()
      await computarYGuardarAlertas(settings)
      await generarInformeAhora()
      render()
    }, Math.max(1, settings.intervaloAlertasMinutos) * 60 * 1000)
  }

  await cargarDatos()
  render()
  const settings = await getDiaDControlSettings(candidateId)
  reiniciarTimerAutomatico(settings)

  // FIX DE RENDIMIENTO (hallazgo real: "está lentísimo" reportado por
  // usuarios): antes, CADA cambio en savedRecords o electionDayControl —
  // algo continuo durante el Día D, con muchos mesarios/dirigentes/
  // choferes escribiendo al mismo tiempo — disparaba (con 800ms de
  // debounce) `cargarDatos()`, que releía las 6 colecciones COMPLETAS
  // desde cero, incluido el padrón entero (`getAllRecords`, potencialmente
  // decenas o cientos de miles de documentos), para CADA admin/coordinador
  // con esta pantalla abierta. Cuanto más grande el padrón y más gente
  // activa, más lento y más caro (lecturas de Firestore) — empeora solo.
  //
  // Ahora: los listeners ya traen el dato que cambió (docChanges de
  // savedRecords, o la lista completa y actualizada de electionDayControl
  // — ver firebaseCandidate.js) — se aplica en memoria, sin ninguna
  // lectura adicional a Firestore. `users`/`drivers`/`incidents`/`estados`
  // (que no cambian tan seguido) los sigue refrescando el timer periódico
  // de `reiniciarTimerAutomatico`, sin tocar esa parte.
  //
  // pendingRecordChanges acumula ENTRE ejecuciones del debounce — si se
  // usara debounce directo sobre la función que aplica los cambios, cada
  // llamada nueva descartaría los `changes` de la llamada anterior (el
  // debounce solo se queda con los argumentos de la última invocación),
  // perdiendo actualizaciones intermedias si 2+ registros cambian dentro
  // de la misma ventana de 800ms.
  let pendingRecordChanges = []
  const flushRecordChanges = debounce(() => {
    pendingRecordChanges.forEach(({ type, id, data }) => {
      const idx = records.findIndex(r => r.id === id)
      if (type === 'removed') {
        if (idx !== -1) records.splice(idx, 1)
      } else if (idx !== -1) {
        records[idx] = data
      } else {
        records.push(data)
      }
    })
    pendingRecordChanges = []
    render()
  }, 800)
  listenAllRecords(candidateId, changes => {
    pendingRecordChanges.push(...changes)
    flushRecordChanges()
  })

  // electionDayControl es una colección chica en comparación con
  // savedRecords (un doc por votante con seguimiento activo de Día D, no
  // por votante del padrón entero) — acá listenAllElectionDayControl ya
  // entrega la lista COMPLETA y actualizada en cada cambio (no un diff),
  // así que no hace falta acumular entre llamadas: la última lista
  // recibida siempre es el estado correcto completo.
  listenAllElectionDayControl(candidateId, debounce(allControls => {
    controls = allControls
    controlByVoterId = {}
    controls.forEach(c => { controlByVoterId[c.voterId] = c })
    render()
  }, 800))
}
