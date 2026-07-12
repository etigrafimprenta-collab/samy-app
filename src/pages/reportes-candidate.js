/**
 * MÓDULO: REPORTES (candidato-scoped).
 *
 * Centraliza reportes de votantes/registros/equipo/Día D/finanzas/
 * auditoría. Implementación por etapas (ver plan): Etapa 1 — Resumen
 * General, Votantes, Registros, Equipo. Etapa 2 — Centro de Contacto,
 * Día D, Choferes, Mesarios, Dirigentes. Etapa 3 — Finanzas, Auditoría
 * (ambas con `roles` en TABS: ninguna colección de Finanzas ni auditLogs
 * permite lectura a coordinator en firestore.rules, así que esos 2 tabs
 * se ocultan para ese rol en vez de romper con permission-denied) + CSV
 * como opción de exportación junto a Excel. Etapa 4 (parcial) — WhatsApp
 * y PDF en Resumen General/Finanzas/Auditoría, Reportes Guardados (presets
 * de filtro para Registros, vía `reportPresets`). Correo y optimización de
 * bundle quedan pendientes (ver plan).
 *
 * Todo acá lee colecciones YA existentes (savedRecords, users,
 * electionStatus, callAssignments, electionDayControl, incidents,
 * mesarios, drivers) — nunca una fuente nueva, y siempre con count()/
 * paginación, nunca getAllRecords/getAllCandidateUsers sin acotar.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { exportGenericToPdf } from '../lib/pdf.js'
import { shareTextViaWhatsApp } from '../lib/whatsapp.js'
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
  { id: 'centro-contacto', label: '📞 Centro de Contacto', ready: true },
  { id: 'dia-d', label: '🗳️ Día D', ready: true },
  { id: 'choferes', label: '🚗 Choferes', ready: true },
  { id: 'mesarios', label: '🪑 Mesarios', ready: true },
  { id: 'dirigentes', label: '🧭 Dirigentes', ready: true },
  // roles: ninguna colección de Finanzas ni auditLogs permite lectura a
  // coordinator en firestore.rules (solo campaign_admin/auditor, mismo
  // criterio que TAB_ROLES.auditoria en campaign.js) — sin este filtro,
  // coordinator vería el tab y se colgaría con permission-denied.
  { id: 'finanzas', label: '💰 Finanzas', ready: true, roles: ['campaign_admin', 'auditor'] },
  { id: 'auditoria', label: '⚠️ Auditoría', ready: true, roles: ['campaign_admin', 'auditor'] },
  { id: 'guardados', label: '💾 Reportes Guardados', ready: true }
]

const statCard = (label, value, color, key) => `
  <button class="rep-stat-card stat-card stat-card--accent" data-key="${key || ''}" style="--accent:${color}; cursor:${key ? 'pointer' : 'default'};">
    <div class="stat-num">${value}</div>
    <div class="stat-label">${label}</div>
  </button>`

export async function renderReportesCandidate(container, candidateId, user, myRole, misRoles = []) {
  let tab = 'resumen-general'
  let presetPendiente = null // seteado por "Abrir" en Reportes Guardados, consumido una vez por pintarTab
  // Tabs sin `roles` = visibles para cualquiera con acceso al módulo
  // (comportamiento de siempre); con `roles`, solo si myRole está en la
  // lista — hoy solo Finanzas/Auditoría lo usan (ver comentario en TABS).
  const visibleTabs = TABS.filter(t => !t.roles || t.roles.includes(myRole))

  function render() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #283593 0%, #1a237e 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed', sans-serif; font-size: 2rem; text-transform: uppercase;">📊 REPORTES</h2>
        <p style="margin: 6px 0 0 0; font-size: .82rem; opacity: .9;">Votantes, registros, equipo, centro de contacto, Día D, choferes, mesarios, dirigentes, finanzas y auditoría</p>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:16px 20px 0;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:2px solid #eee; padding-bottom:10px;">
          ${visibleTabs.map(t => `<button class="rep-tab btn-tab${tab === t.id ? ' active' : ''}" data-tab="${t.id}" style="--tab-color:#283593;">${t.label}${t.ready ? '' : ' 🚧'}</button>`).join('')}
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
      // Capturar y limpiar ANTES del import: si dos renders de este tab se
      // superponen (doble click en "Abrir", o carga inicial del módulo
      // lenta), el import (async) puede resolver en distinto orden entre
      // invocaciones — leer presetPendiente después dejaría que la
      // invocación más lenta pise el preset de la más rápida con null.
      const preset = presetPendiente
      presetPendiente = null
      const { renderReporteRegistros } = await import('./reportes-registros-candidate.js')
      return renderReporteRegistros(body, candidateId, user, myRole, misRoles, preset)
    }
    if (tab === 'equipo') {
      body.innerHTML = 'Cargando...'
      const { renderReporteEquipo } = await import('./reportes-equipo-candidate.js')
      return renderReporteEquipo(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'centro-contacto') {
      body.innerHTML = 'Cargando...'
      const { renderReporteCentroContacto } = await import('./reportes-centro-contacto-candidate.js')
      return renderReporteCentroContacto(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'dia-d') {
      body.innerHTML = 'Cargando...'
      const { renderReporteDiaD } = await import('./reportes-dia-d-candidate.js')
      return renderReporteDiaD(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'choferes') {
      body.innerHTML = 'Cargando...'
      const { renderReporteChoferes } = await import('./reportes-choferes-candidate.js')
      return renderReporteChoferes(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'mesarios') {
      body.innerHTML = 'Cargando...'
      const { renderReporteMesarios } = await import('./reportes-mesarios-candidate.js')
      return renderReporteMesarios(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'dirigentes') {
      body.innerHTML = 'Cargando...'
      const { renderReporteDirigentes } = await import('./reportes-dirigentes-candidate.js')
      return renderReporteDirigentes(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'finanzas') {
      body.innerHTML = 'Cargando...'
      const { renderReporteFinanzas } = await import('./reportes-finanzas-candidate.js')
      return renderReporteFinanzas(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'auditoria') {
      body.innerHTML = 'Cargando...'
      const { renderReporteAuditoria } = await import('./reportes-auditoria-candidate.js')
      return renderReporteAuditoria(body, candidateId, user, myRole, misRoles)
    }
    if (tab === 'guardados') {
      body.innerHTML = 'Cargando...'
      const { renderReporteGuardados } = await import('./reportes-guardados-candidate.js')
      return renderReporteGuardados(body, candidateId, user, myRole, misRoles, (preset) => {
        presetPendiente = preset
        tab = 'registros'
        render()
      })
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

      const filas = [
        { Indicador: 'Total votantes (padrón)', Valor: padron },
        { Indicador: 'Comprometidos', Valor: counts.records },
        { Indicador: 'Contactados', Valor: flags.contacted },
        { Indicador: 'Confirmados para votar', Valor: flags.confirmedToVote },
        { Indicador: 'Ya votaron', Valor: votaron },
        { Indicador: 'Pendientes', Valor: pendientes },
        { Indicador: 'Requieren transporte', Valor: flags.requiresPickup },
        { Indicador: 'Precisan ayuda', Valor: flags.needsAssistance },
        { Indicador: 'Choferes', Valor: counts.drivers },
        { Indicador: 'Mesarios', Valor: mesariosTotal },
        { Indicador: 'Dirigentes', Valor: dirigentesTotal },
        { Indicador: 'Usuarios (total)', Valor: counts.users },
        { Indicador: 'Incidencias abiertas', Valor: incidenciasAbiertas }
      ]
      const textoWhatsApp = `📊 *Resumen de campaña*\n\n` +
        `Comprometidos: ${counts.records}\n` +
        `Contactados: ${flags.contacted}\n` +
        `Confirmados para votar: ${flags.confirmedToVote}\n` +
        `Ya votaron: ${votaron}\n` +
        `Pendientes: ${pendientes}`

      body.innerHTML = `
        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 16px;">
          💡 "Comprometidos" = votantes guardados por tu equipo (no el padrón entero). "Usuarios/Mesarios/Dirigentes" muestran el total del rol, no un corte por "activo" (el dato de actividad no es confiable hoy en todas las cuentas).
        </p>
        <div style="display:flex; justify-content:flex-end; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
          <button id="rg-btn-whatsapp" style="background:#25d366; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">📤 Compartir por WhatsApp</button>
          <button id="rg-btn-excel" style="background:#455a64; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">⬇️ Excel</button>
          <button id="rg-btn-pdf" style="background:#607d8b; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">⬇️ PDF</button>
        </div>
        <div class="stats-grid">
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
      document.getElementById('rg-btn-whatsapp').addEventListener('click', () => shareTextViaWhatsApp(textoWhatsApp))
      document.getElementById('rg-btn-excel').addEventListener('click', () => exportGenericToExcel(filas, `reporte_resumen_general_${candidateId}.xlsx`, 'Resumen General'))
      document.getElementById('rg-btn-pdf').addEventListener('click', () => exportGenericToPdf(filas, `reporte_resumen_general_${candidateId}.pdf`, 'Resumen General'))
    } catch (err) {
      body.innerHTML = `<div style="color:#c62828; padding:20px;">Error cargando el resumen: ${escapeHtml(err.message)}</div>`
    }
  }

  render()
}
