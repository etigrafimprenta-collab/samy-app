/**
 * REPORTES > DIRIGENTES — roster paginado (mismo patrón que
 * reportes-equipo-candidate.js, nunca getAllCandidateUsers) + registros
 * captados (getUserRecordsCount, ya reusada en Equipo) + participación
 * Día D vía getElectionDayControlByLeader (where-scoped por dirigente,
 * nunca getAllElectionDayControl).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import {
  listCandidateUsersPage,
  getUserRecordsCount,
  getElectionDayControlByLeader
} from '../lib/firebaseCandidate.js'

const MAX_PAGINAS = 10 // tope de seguridad — el equipo real es de decenas, no miles

const statCard = (label, value, color) => `
  <div style="background:white; border:1px solid #ddd; border-left:4px solid ${color}; border-radius:8px; padding:14px;">
    <div style="font-size:1.4rem; font-weight:800; color:${color};">${value}</div>
    <div style="font-size:.72rem; font-weight:700; color:#666; text-transform:uppercase;">${label}</div>
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

export async function renderReporteDirigentes(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const dirigentes = await cargarDirigentes(candidateId)

    const stats = await Promise.all(dirigentes.map(async d => {
      const [registros, control] = await Promise.all([
        getUserRecordsCount(candidateId, d.id),
        getElectionDayControlByLeader(candidateId, d.id)
      ])
      const votaron = control.filter(c => c.status === 'voted').length
      const noIran = control.filter(c => c.status === 'will_not_vote').length
      return { dirigente: d, registros, votaron, noIran, pendientes: control.length - votaron - noIran }
    }))
    stats.sort((a, b) => b.registros - a.registros)

    const totalRegistros = stats.reduce((sum, s) => sum + s.registros, 0)
    const totalVotaron = stats.reduce((sum, s) => sum + s.votaron, 0)

    body.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:24px;">
        ${statCard('Dirigentes', stats.length, '#6a1b9a')}
        ${statCard('Registros captados', totalRegistros, '#6a1b9a')}
        ${statCard('Ya votaron', totalVotaron, '#2e7d32')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🧭 Por dirigente (${stats.length})</h3>
        <button id="rdg-btn-export" style="background:#455a64; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">⬇️ Exportar Excel</button>
      </div>
      ${stats.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay dirigentes en el equipo.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Dirigente</th><th>Registros captados</th><th>Votaron</th><th>No irán</th><th>Pendientes</th>
            </tr></thead>
            <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(s.dirigente.nombre || s.dirigente.email)}</strong></td>
              <td>${s.registros}</td><td>${s.votaron}</td><td>${s.noIran}</td><td>${s.pendientes}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    const btn = document.getElementById('rdg-btn-export')
    if (btn) {
      btn.addEventListener('click', () => {
        exportGenericToExcel(stats.map(s => ({
          Dirigente: s.dirigente.nombre || s.dirigente.email, 'Registros captados': s.registros,
          Votaron: s.votaron, 'No irán': s.noIran, Pendientes: s.pendientes
        })), `reporte_dirigentes_${candidateId}.xlsx`, 'Dirigentes')
      })
    }
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
