/**
 * MÓDULO: REPORTES (candidato-scoped).
 *
 * Centraliza reportes de votantes/registros/equipo/Día D/finanzas/
 * auditoría. Implementación por etapas (ver plan): Etapa 1 = esta —
 * Resumen General, Votantes, Registros, Equipo. El resto queda como
 * "🚧 Próximamente" hasta sus etapas.
 *
 * Todo acá lee colecciones YA existentes (savedRecords, users,
 * electionStatus, callAssignments, electionDayControl, incidents,
 * mesarios, drivers) — nunca una fuente nueva, y siempre con count()/
 * paginación, nunca getAllRecords/getAllCandidateUsers sin acotar.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import {
  getSharedVotersCount,
  getCandidateCounts,
  getElectionStatusFlagCounts,
  getElectionDayControlStatusCount,
  getOpenIncidentsCount,
  getMesariosCount,
  getCandidateUsersCountByRole
} from '../lib/firebaseCandidate.js'

const TABS = [
  { id: 'resumen-general', label: '📊 Resumen General', ready: true },
  { id: 'votantes', label: '🗳️ Votantes', ready: true },
  { id: 'registros', label: '📋 Registros', ready: true },
  { id: 'equipo', label: '👥 Equipo', ready: true },
  { id: 'centro-contacto', label: '📞 Centro de Contacto', ready: false, etapa: 2 },
  { id: 'dia-d', label: '🗳️ Día D', ready: false, etapa: 2 },
  { id: 'choferes', label: '🚗 Choferes', ready: false, etapa: 2 },
  { id: 'mesarios', label: '🪑 Mesarios', ready: false, etapa: 2 },
  { id: 'dirigentes', label: '🧭 Dirigentes', ready: false, etapa: 2 },
  { id: 'finanzas', label: '💰 Finanzas', ready: false, etapa: 3 },
  { id: 'auditoria', label: '⚠️ Auditoría', ready: false, etapa: 3 },
  { id: 'guardados', label: '💾 Reportes Guardados', ready: false, etapa: 4 }
]

const statCard = (label, value, color, key) => `
  <button class="rep-stat-card" data-key="${key || ''}" style="text-align:left; cursor:${key ? 'pointer' : 'default'}; background:white; border:1px solid #ddd; border-left:4px solid ${color}; border-radius:8px; padding:14px;">
    <div style="font-size:1.5rem; font-weight:800; color:${color};">${value}</div>
    <div style="font-size:.72rem; font-weight:700; color:#666; text-transform:uppercase;">${label}</div>
  </button>`

export async function renderReportesCandidate(container, candidateId, user, myRole, misRoles = []) {
  let tab = 'resumen-general'

  function render() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #283593 0%, #1a237e 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed', sans-serif; font-size: 2rem; text-transform: uppercase;">📊 REPORTES</h2>
        <p style="margin: 6px 0 0 0; font-size: .82rem; opacity: .9;">Votantes, registros, equipo y (próximamente) Día D, finanzas y auditoría</p>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:16px 20px 0;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:2px solid #eee; padding-bottom:10px;">
          ${TABS.map(t => `<button class="rep-tab" data-tab="${t.id}" style="padding:8px 14px; border:none; border-radius:6px 6px 0 0; cursor:pointer; font-weight:600; font-size:.82rem; background:${tab === t.id ? '#283593' : '#f0f0f0'}; color:${tab === t.id ? 'white' : '#333'};">${t.label}${t.ready ? '' : ' 🚧'}</button>`).join('')}
        </div>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px; padding:20px;">
        <div id="rep-body">Cargando...</div>
      </div>
    `
    container.querySelectorAll('.rep-tab').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })
    pintarTab()
  }

  async function pintarTab() {
    const body = document.getElementById('rep-body')
    const tabDef = TABS.find(t => t.id === tab)
    if (!tabDef.ready) {
      body.innerHTML = `
        <div style="text-align:center; padding:50px 20px; color:#999;">
          <div style="font-size:2.5rem; margin-bottom:10px;">🚧</div>
          <div style="font-weight:700; font-size:1.05rem; margin-bottom:6px;">Próximamente</div>
          <div style="font-size:.85rem;">Esta sección llega en la Etapa ${tabDef.etapa} del módulo Reportes.</div>
        </div>`
      return
    }
    if (tab === 'resumen-general') return pintarResumenGeneral(body)
    if (tab === 'votantes') {
      body.innerHTML = 'Cargando...'
      const { renderReporteVotantes } = await import('./reportes-votantes-candidate.js')
      return renderReporteVotantes(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'registros') {
      body.innerHTML = 'Cargando...'
      const { renderReporteRegistros } = await import('./reportes-registros-candidate.js')
      return renderReporteRegistros(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'equipo') {
      body.innerHTML = 'Cargando...'
      const { renderReporteEquipo } = await import('./reportes-equipo-candidate.js')
      return renderReporteEquipo(body, candidateId, user, myRole, misRoles)
    }
  }

  // ── Resumen General — todo con count(), cero descarga de documentos ────
  async function pintarResumenGeneral(body) {
    body.innerHTML = '<div style="color:#999;">Cargando resumen...</div>'
    try {
      const [
        padron,
        counts,
        flags,
        votaron,
        noIran,
        mesariosTotal,
        dirigentesTotal,
        incidenciasAbiertas
      ] = await Promise.all([
        getSharedVotersCount(),
        getCandidateCounts(candidateId),
        getElectionStatusFlagCounts(candidateId, ['contacted', 'confirmedToVote', 'requiresPickup', 'needsAssistance']),
        getElectionDayControlStatusCount(candidateId, 'voted'),
        getElectionDayControlStatusCount(candidateId, 'will_not_vote'),
        getMesariosCount(candidateId),
        getCandidateUsersCountByRole(candidateId, 'dirigente'),
        getOpenIncidentsCount(candidateId)
      ])

      // "Pendientes" se calcula, no se consulta: comprometidos que todavía
      // no tienen un desenlace en electionDayControl (ni votó ni no irá).
      // Evita una query not-in y reusa counts que ya se piden arriba.
      const pendientes = Math.max(0, counts.records - votaron - noIran)

      body.innerHTML = `
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 16px;">
          💡 "Comprometidos" = votantes guardados por tu equipo (no el padrón entero). "Usuarios/Mesarios/Dirigentes" muestran el total del rol, no un corte por "activo" (el dato de actividad no es confiable hoy en todas las cuentas).
        </p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px;">
          ${statCard('Total votantes (padrón)', padron.toLocaleString('es-PY'), '#455a64')}
          ${statCard('Comprometidos', counts.records.toLocaleString('es-PY'), '#1976d2')}
          ${statCard('Contactados', flags.contacted, '#00897b')}
          ${statCard('Confirmados para votar', flags.confirmedToVote, '#2e7d32')}
          ${statCard('Ya votaron', votaron, '#2e7d32')}
          ${statCard('Pendientes', pendientes, '#e65100')}
          ${statCard('Requieren transporte', flags.requiresPickup, '#1565c0')}
          ${statCard('Precisan ayuda', flags.needsAssistance, '#c62828')}
          ${statCard('Choferes', counts.drivers, '#6a1b9a')}
          ${statCard('Mesarios', mesariosTotal, '#6a1b9a')}
          ${statCard('Dirigentes', dirigentesTotal, '#6a1b9a')}
          ${statCard('Usuarios (total)', counts.users, '#455a64')}
          ${statCard('Incidencias abiertas', incidenciasAbiertas, '#c62828')}
        </div>
      `
    } catch (err) {
      body.innerHTML = `<div style="color:#c62828; padding:20px;">Error cargando el resumen: ${escapeHtml(err.message)}</div>`
    }
  }

  render()
}
