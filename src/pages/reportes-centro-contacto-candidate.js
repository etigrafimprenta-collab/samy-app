/**
 * REPORTES > CENTRO DE CONTACTO — progreso de llamadas pre-electorales.
 * Todo con count() (nunca getAll*): tarjetas globales + tabla por operador,
 * mismo idioma que reportes-equipo-candidate.js pero acotado al rol operador.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import {
  listCandidateUsersPage,
  getCallAssignmentStatusCount,
  getElectionStatusFlagCounts,
  getOpenIncidentsCount,
  getUnassignedCount,
  getPendingFollowUps,
  getCallAssignmentCountForOperator,
  getElectionStatusFlagCountForOperator,
  getCallsCountByOperator,
  getIncidentsCountForOperator
} from '../lib/firebaseCandidate.js'

const MAX_PAGINAS = 10 // tope de seguridad — el equipo real es de decenas, no miles

const FLAGS = ['contacted', 'confirmedToVote', 'noAnswer', 'wrongNumber', 'undecided', 'requiresPickup', 'needsAssistance']
const FLAG_LABELS = {
  contacted: 'Contactados', confirmedToVote: 'Confirmados', noAnswer: 'No contestan',
  wrongNumber: 'Número incorrecto', undecided: 'Indecisos', requiresPickup: 'Requieren transporte', needsAssistance: 'Precisan ayuda'
}

const statCard = (label, value, color) => `
  <div style="background:white; border:1px solid #ddd; border-left:4px solid ${color}; border-radius:8px; padding:14px;">
    <div style="font-size:1.4rem; font-weight:800; color:${color};">${value}</div>
    <div style="font-size:.72rem; font-weight:700; color:#666; text-transform:uppercase;">${label}</div>
  </div>`

async function cargarOperadores(candidateId) {
  let equipo = []
  let cursor = null
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { users, lastDoc, hasMore } = await listCandidateUsersPage(candidateId, { role: 'operador', cursor, pageSize: 100 })
    equipo = [...equipo, ...users]
    cursor = lastDoc
    if (!hasMore) break
  }
  return equipo
}

export async function renderReporteCentroContacto(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const [pendientes, sinAsignar, flags, incidenciasAbiertas, seguimientos, operadores] = await Promise.all([
      getCallAssignmentStatusCount(candidateId, 'pending'),
      getUnassignedCount(candidateId),
      getElectionStatusFlagCounts(candidateId, FLAGS),
      getOpenIncidentsCount(candidateId),
      getPendingFollowUps(candidateId),
      cargarOperadores(candidateId)
    ])

    const stats = await Promise.all(operadores.map(async op => {
      const [asignados, opPendientes, contactados, confirmados, llamadas, opIncidencias] = await Promise.all([
        getCallAssignmentCountForOperator(candidateId, op.id),
        getCallAssignmentCountForOperator(candidateId, op.id, 'pending'),
        getElectionStatusFlagCountForOperator(candidateId, op.id, 'contacted'),
        getElectionStatusFlagCountForOperator(candidateId, op.id, 'confirmedToVote'),
        getCallsCountByOperator(candidateId, op.id),
        getIncidentsCountForOperator(candidateId, op.id)
      ])
      return { operador: op, asignados, pendientes: opPendientes, contactados, confirmados, llamadas, incidencias: opIncidencias }
    }))
    stats.sort((a, b) => b.asignados - a.asignados)

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">📞 Progreso de llamadas</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:24px;">
        ${statCard('Sin asignar', sinAsignar, '#455a64')}
        ${statCard('Pendientes', pendientes, '#6a1b9a')}
        ${FLAGS.map(f => statCard(FLAG_LABELS[f], flags[f] || 0, '#00897b')).join('')}
        ${statCard('Incidencias abiertas', incidenciasAbiertas, '#c62828')}
        ${statCard('Seguimientos pendientes', seguimientos.length, '#e65100')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">👥 Por operador (${stats.length})</h3>
        <button id="rcc-btn-export" style="background:#455a64; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">⬇️ Exportar Excel</button>
      </div>
      ${stats.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay operadores en el equipo.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Operador</th><th>Asignados</th><th>Pendientes</th><th>Contactados</th><th>Confirmados</th><th>Llamadas</th><th>Incidencias</th>
            </tr></thead>
            <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(s.operador.nombre || s.operador.email)}</strong></td>
              <td>${s.asignados}</td><td>${s.pendientes}</td><td>${s.contactados}</td><td>${s.confirmados}</td><td>${s.llamadas}</td><td>${s.incidencias}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    const btn = document.getElementById('rcc-btn-export')
    if (btn) {
      btn.addEventListener('click', () => {
        exportGenericToExcel(stats.map(s => ({
          Operador: s.operador.nombre || s.operador.email, Asignados: s.asignados, Pendientes: s.pendientes,
          Contactados: s.contactados, Confirmados: s.confirmados, Llamadas: s.llamadas, Incidencias: s.incidencias
        })), `reporte_centro_contacto_${candidateId}.xlsx`, 'Centro de Contacto')
      })
    }
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
