/**
 * REPORTES > CHOFERES — roster (getDrivers, escala de equipo, mismo
 * criterio que chofer-candidate.js) + participación Día D por chofer vía
 * getElectionDayControlByDriver (where-scoped, nunca getAllElectionDayControl).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { getDrivers, getElectionDayControlByDriver } from '../lib/firebaseCandidate.js'

const statCard = (label, value, color) => `
  <div class="stat-card stat-card--accent" style="--accent:${color};">
    <div class="stat-num">${value}</div>
    <div class="stat-label">${label}</div>
  </div>`

export async function renderReporteChoferes(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const choferes = await getDrivers(candidateId)

    const stats = await Promise.all(choferes.map(async c => {
      const control = await getElectionDayControlByDriver(candidateId, c.id)
      const votaron = control.filter(v => v.status === 'voted').length
      const enTraslado = control.filter(v => v.status === 'on_the_way' || v.status === 'picked_up').length
      return { chofer: c, votaron, enTraslado }
    }))

    const totalAsignados = choferes.reduce((sum, c) => sum + (Number(c.votantesAsignados) || 0), 0)
    const totalEntregado = choferes.reduce((sum, c) => sum + (Number(c.montoEntregado) || 0), 0)
    const totalVotaron = stats.reduce((sum, s) => sum + s.votaron, 0)

    body.innerHTML = `
      <div class="stats-grid" style="margin-bottom:24px;">
        ${statCard('Choferes', choferes.length, '#1976d2')}
        ${statCard('Votantes asignados', totalAsignados, '#1976d2')}
        ${statCard('Ya votaron (trasladados)', totalVotaron, '#2e7d32')}
        ${statCard('Monto entregado', 'Gs. ' + totalEntregado.toLocaleString('es-PY'), '#6a1b9a')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🚗 Por chofer (${stats.length})</h3>
        <button id="rch-btn-export" class="btn-compact" style="background:#455a64; color:white;">⬇️ Exportar Excel</button>
      </div>
      ${stats.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay choferes cargados.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Chofer</th><th>Votantes asignados</th><th>En traslado</th><th>Ya votaron</th><th>Monto entregado</th>
            </tr></thead>
            <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(s.chofer.nombre || '')}</strong></td>
              <td>${s.chofer.votantesAsignados || 0}</td><td>${s.enTraslado}</td><td>${s.votaron}</td>
              <td>Gs. ${(Number(s.chofer.montoEntregado) || 0).toLocaleString('es-PY')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    const btn = document.getElementById('rch-btn-export')
    if (btn) {
      btn.addEventListener('click', () => {
        exportGenericToExcel(stats.map(s => ({
          Chofer: s.chofer.nombre || '', 'Votantes asignados': s.chofer.votantesAsignados || 0,
          'En traslado': s.enTraslado, 'Ya votaron': s.votaron, 'Monto entregado': Number(s.chofer.montoEntregado) || 0
        })), `reporte_choferes_${candidateId}.xlsx`, 'Choferes')
      })
    }
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
