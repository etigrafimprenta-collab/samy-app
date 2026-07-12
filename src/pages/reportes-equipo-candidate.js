/**
 * REPORTES > EQUIPO — productividad + calidad por usuario. Roster paginado
 * (nunca getAllCandidateUsers), counts puntuales por usuario (patrón ya
 * usado por Centro de Contacto > Asignación).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { ROLE_LABELS } from '../lib/roleLabels.js'
import {
  listCandidateUsersPage,
  getUserRecordsCount,
  getCallsCountByOperator,
  getElectionStatusFlagCountForOperator,
  getIncidentsCountForOperator,
  getRecordFlagCountForUser,
  getLastRecordActivityForUser
} from '../lib/firebaseCandidate.js'

const MAX_PAGINAS = 10 // tope de seguridad — el equipo real es de decenas, no miles

async function cargarRoster(candidateId) {
  let equipo = []
  let cursor = null
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { users, lastDoc, hasMore } = await listCandidateUsersPage(candidateId, { cursor, pageSize: 100 })
    equipo = [...equipo, ...users]
    cursor = lastDoc
    if (!hasMore) break
  }
  return equipo
}

export async function renderReporteEquipo(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando equipo...</div>'
  try {
    const equipo = await cargarRoster(candidateId)
    if (equipo.length === 0) {
      body.innerHTML = '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay usuarios en el equipo.</div>'
      return
    }

    const stats = await Promise.all(equipo.map(async u => {
      const [registros, llamadas, contactados, confirmados, incidencias, sinTelefono, sinDireccion, ultimo] = await Promise.all([
        getUserRecordsCount(candidateId, u.id),
        getCallsCountByOperator(candidateId, u.id),
        getElectionStatusFlagCountForOperator(candidateId, u.id, 'contacted'),
        getElectionStatusFlagCountForOperator(candidateId, u.id, 'confirmedToVote'),
        getIncidentsCountForOperator(candidateId, u.id),
        getRecordFlagCountForUser(candidateId, u.id, 'telefono', ''),
        getRecordFlagCountForUser(candidateId, u.id, 'direccion', ''),
        getLastRecordActivityForUser(candidateId, u.id)
      ])
      return {
        usuario: u, registros, llamadas, contactados, confirmados, incidencias,
        pctTelefono: registros > 0 ? Math.round((registros - sinTelefono) / registros * 100) : 0,
        pctDireccion: registros > 0 ? Math.round((registros - sinDireccion) / registros * 100) : 0,
        ultimaActividad: ultimo?.savedAt?.toDate ? ultimo.savedAt.toDate() : null
      }
    }))

    stats.sort((a, b) => b.registros - a.registros)

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">👥 Equipo (${stats.length})</h3>
        <button id="re-btn-export" class="btn-compact" style="background:#455a64; color:white;">⬇️ Exportar Excel</button>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Usuario</th><th>Rol</th><th>Registros</th><th>Llamadas</th><th>Contactados</th><th>Confirmados</th><th>Incidencias</th><th>% con tel.</th><th>% con dir.</th><th>Última actividad</th>
          </tr></thead>
          <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px;"><strong>${escapeHtml(s.usuario.nombre || s.usuario.email)}</strong></td>
            <td>${escapeHtml(ROLE_LABELS[s.usuario.role] || s.usuario.role)}</td>
            <td>${s.registros}</td><td>${s.llamadas}</td><td>${s.contactados}</td><td>${s.confirmados}</td><td>${s.incidencias}</td>
            <td>${s.pctTelefono}%</td><td>${s.pctDireccion}%</td>
            <td>${s.ultimaActividad ? s.ultimaActividad.toLocaleString('es-PY') : '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `
    document.getElementById('re-btn-export').addEventListener('click', () => {
      exportGenericToExcel(stats.map(s => ({
        Usuario: s.usuario.nombre || s.usuario.email, Rol: ROLE_LABELS[s.usuario.role] || s.usuario.role,
        Registros: s.registros, Llamadas: s.llamadas, Contactados: s.contactados, Confirmados: s.confirmados,
        Incidencias: s.incidencias, '% con teléfono': s.pctTelefono, '% con dirección': s.pctDireccion,
        'Última actividad': s.ultimaActividad ? s.ultimaActividad.toLocaleString('es-PY') : ''
      })), `reporte_equipo_${candidateId}.xlsx`, 'Equipo')
    })
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
