/**
 * REPORTES > DÍA D — estado global (count() por status, mismo subconjunto
 * que ya destaca el dashboard de Día D Control), último informe periódico
 * y alertas abiertas (ambos precalculados por ese módulo, se reusan tal
 * cual), y ranking de participación por dirigente. Choferes y Mesarios
 * tienen su propio detalle de participación Día D en sus tabs de Reportes.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import {
  listCandidateUsersPage,
  getElectionDayControlStatusCount,
  getRecentDiaDReports,
  getOpenDiaDAlerts,
  getElectionDayControlByLeader
} from '../lib/firebaseCandidate.js'

const MAX_PAGINAS = 10 // tope de seguridad — el equipo real es de decenas, no miles

const STATUS_CARDS = [
  { status: 'pending', label: 'Pendientes', emoji: '⏳', color: '#e65100' },
  { status: 'voted', label: 'Ya votaron', emoji: '✅', color: '#2e7d32' },
  { status: 'will_not_vote', label: 'No irán', emoji: '🚫', color: '#c62828' },
  { status: 'on_the_way', label: 'En camino', emoji: '🚐', color: '#1976d2' },
  { status: 'picked_up', label: 'En traslado', emoji: '🚙', color: '#1976d2' },
  { status: 'arrived_polling_place', label: 'Llegaron al local', emoji: '📍', color: '#00897b' },
  { status: 'arrived_table', label: 'Llegaron a mesa', emoji: '🪑', color: '#00897b' }
]

const statCard = (label, value, color, emoji) => `
  <div style="background:white; border:1px solid #ddd; border-left:4px solid ${color}; border-radius:8px; padding:14px;">
    <div style="font-size:1.4rem; font-weight:800; color:${color};">${value}</div>
    <div style="font-size:.72rem; font-weight:700; color:#666; text-transform:uppercase;">${emoji} ${label}</div>
  </div>`

async function cargarDirigentes(candidateId) {
  let equipo = []
  let cursor = null
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { users, lastDoc, hasMore } = await listCandidateUsersPage(candidateId, { role: 'dirigente', cursor, pageSize: 100 })
    equipo = [...equipo, ...users]
    cursor = lastDoc
    if (!hasMore) break
  }
  return equipo
}

export async function renderReporteDiaD(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const [statusCounts, informes, alertas, dirigentes] = await Promise.all([
      Promise.all(STATUS_CARDS.map(c => getElectionDayControlStatusCount(candidateId, c.status))),
      getRecentDiaDReports(candidateId, 1),
      getOpenDiaDAlerts(candidateId),
      cargarDirigentes(candidateId)
    ])

    const ranking = await Promise.all(dirigentes.map(async d => {
      const votantes = await getElectionDayControlByLeader(candidateId, d.id)
      const votaron = votantes.filter(v => v.status === 'voted').length
      const noIran = votantes.filter(v => v.status === 'will_not_vote').length
      return { dirigente: d, asignados: votantes.length, votaron, noIran, pendientes: votantes.length - votaron - noIran }
    }))
    ranking.sort((a, b) => b.asignados - a.asignados)

    const ultimoInforme = informes[0]

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">🗳️ Estado global</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:24px;">
        ${STATUS_CARDS.map((c, i) => statCard(c.label, statusCounts[i], c.color, c.emoji)).join('')}
      </div>

      <h3 style="margin:0 0 10px; font-size:1.05rem;">📄 Último informe generado</h3>
      <div style="background:#eef3f8; border:1px solid #cfe0ee; border-radius:8px; padding:14px; margin-bottom:24px; font-size:.85rem;">
        ${!ultimoInforme ? 'Todavía no se generó ningún informe (se genera manualmente desde Día D Control).' : `
          <div style="color:#999; font-size:.72rem; margin-bottom:4px;">${ultimoInforme.generatedAt?.toDate ? ultimoInforme.generatedAt.toDate().toLocaleString('es-PY') : ''}</div>
          <div><strong>${ultimoInforme.totalVoted}</strong>/${ultimoInforme.totalCommitted} votaron (${ultimoInforme.reportData?.porcentajeVotado || 0}%) · ${ultimoInforme.totalPending} pendientes · ${ultimoInforme.totalInTransit} en tránsito · ${ultimoInforme.totalIncidents} incidencias abiertas</div>
        `}
      </div>

      <h3 style="margin:0 0 10px; font-size:1.05rem;">🚨 Alertas abiertas (${alertas.length})</h3>
      ${alertas.length === 0 ? '<div style="color:#999; padding:12px 0; margin-bottom:24px;">No hay alertas abiertas.</div>' : `
        <div style="overflow-x:auto; margin-bottom:24px;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Tipo</th><th>Mensaje</th><th>Fecha</th></tr></thead>
            <tbody>${alertas.map(a => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;">${escapeHtml(a.type || '')}</td><td>${escapeHtml(a.message || '')}</td>
              <td>${a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString('es-PY') : ''}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🧭 Participación por dirigente (${ranking.length})</h3>
        <button id="rdd-btn-export" style="background:#455a64; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">⬇️ Exportar Excel</button>
      </div>
      <p style="font-size:.78rem; color:#666; margin:0 0 10px;">Choferes y Mesarios tienen su propio detalle de participación Día D en sus tabs de Reportes.</p>
      ${ranking.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay dirigentes en el equipo.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Dirigente</th><th>Asignados</th><th>Votaron</th><th>No irán</th><th>Pendientes</th><th>%</th>
            </tr></thead>
            <tbody>${ranking.map(r => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(r.dirigente.nombre || r.dirigente.email)}</strong></td>
              <td>${r.asignados}</td><td>${r.votaron}</td><td>${r.noIran}</td><td>${r.pendientes}</td>
              <td>${r.asignados > 0 ? Math.round(r.votaron / r.asignados * 100) : 0}%</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    const btn = document.getElementById('rdd-btn-export')
    if (btn) {
      btn.addEventListener('click', () => {
        exportGenericToExcel(ranking.map(r => ({
          Dirigente: r.dirigente.nombre || r.dirigente.email, Asignados: r.asignados, Votaron: r.votaron,
          'No irán': r.noIran, Pendientes: r.pendientes, '%': r.asignados > 0 ? Math.round(r.votaron / r.asignados * 100) : 0
        })), `reporte_dia_d_dirigentes_${candidateId}.xlsx`, 'Día D - Dirigentes')
      })
    }
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
