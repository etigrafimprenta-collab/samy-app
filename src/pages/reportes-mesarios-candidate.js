/**
 * REPORTES > MESARIOS — roster (getMesarios, escala de equipo, mismo
 * criterio que mesario-candidate.js) + capacitación/montos calculados con
 * las mismas funciones puras exportadas por ese módulo (no se reimplementa
 * la lógica).
 *
 * Sin columna de "participación Día D": el roster de `mesarios` y las
 * cuentas de login (role='mesario', asignadas por
 * electionDayControl.assignedTableUserId) son dos estructuras sin campo
 * que las cruce 1:1 (ver comentario en firebaseCandidate.js sobre
 * getDiaDValidationForMesarios) — esa función solo resuelve el cruce vía
 * local+mesa contra TODO electionDayControl (getAllElectionDayControl,
 * no acotado), que es justo el patrón que Reportes evita. Se prioriza no
 * agregar índices/queries nuevos para esta etapa.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { getMesarios } from '../lib/firebaseCandidate.js'
import { estadoPresencia, montoConsolidado, montoDiaD } from './mesario-candidate.js'

const statCard = (label, value, color) => `
  <div class="stat-card stat-card--accent" style="--accent:${color};">
    <div class="stat-num">${value}</div>
    <div class="stat-label">${label}</div>
  </div>`

export async function renderReporteMesarios(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const mesarios = await getMesarios(candidateId)

    const stats = mesarios.map(m => ({ mesario: m, presencia: estadoPresencia(m), monto: montoConsolidado(m), montoDD: montoDiaD(m) }))

    const conCapacitacion = stats.filter(s => s.presencia !== 'sin_capacitacion').length
    const asistieron = stats.filter(s => s.presencia === 'asistio').length
    const totalMonto = stats.reduce((sum, s) => sum + s.monto, 0)
    const totalMontoDD = stats.reduce((sum, s) => sum + s.montoDD, 0)

    body.innerHTML = `
      <div class="stats-grid" style="margin-bottom:24px;">
        ${statCard('Mesarios', stats.length, '#1976d2')}
        ${statCard('Con capacitación cargada', conCapacitacion, '#1976d2')}
        ${statCard('Asistieron a capacitación', asistieron, '#2e7d32')}
        ${statCard('Monto consolidado', 'Gs. ' + totalMonto.toLocaleString('es-PY'), '#6a1b9a')}
        ${statCard('Monto Día D', 'Gs. ' + totalMontoDD.toLocaleString('es-PY'), '#6a1b9a')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🪑 Por mesario (${stats.length})</h3>
        <button id="rme-btn-export" class="btn-compact" style="background:#455a64; color:white;">⬇️ Exportar Excel</button>
      </div>
      ${stats.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay mesarios cargados.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Mesario</th><th>Local</th><th>Mesa</th><th>Capacitación</th><th>Monto</th>
            </tr></thead>
            <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(s.mesario.nombre || '')}</strong></td>
              <td>${escapeHtml(s.mesario.local || '') || '—'}</td><td>${escapeHtml(s.mesario.mesa || '') || '—'}</td>
              <td>${s.presencia === 'asistio' ? '✅ Asistió' : s.presencia === 'no_asistio' ? '❌ No asistió' : '— Sin capacitación'}</td>
              <td>Gs. ${s.monto.toLocaleString('es-PY')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    const btn = document.getElementById('rme-btn-export')
    if (btn) {
      btn.addEventListener('click', () => {
        exportGenericToExcel(stats.map(s => ({
          Mesario: s.mesario.nombre || '', Local: s.mesario.local || '', Mesa: s.mesario.mesa || '',
          Capacitación: s.presencia === 'asistio' ? 'Asistió' : s.presencia === 'no_asistio' ? 'No asistió' : 'Sin capacitación',
          Monto: s.monto
        })), `reporte_mesarios_${candidateId}.xlsx`, 'Mesarios')
      })
    }
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
