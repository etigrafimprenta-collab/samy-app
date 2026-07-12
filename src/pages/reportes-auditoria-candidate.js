/**
 * REPORTES > AUDITORÍA — duplicados de cédula (misma función que ya usan
 * campaign.js::renderAuditoria y reportes-votantes-candidate.js, acá sin
 * el cap de 50 porque esta es la vista dedicada), coincidencias entre
 * candidatos (mismo patrón que campaign.js::renderAuditoria, Cloud
 * Function que nunca expone de qué candidato se trata) y registro de
 * cambios (listAuditLogsPage, ya existía en firebaseCandidate.js pero
 * hasta ahora ningún archivo de src/ lo usaba).
 *
 * Solo visible para campaign_admin/auditor (ver reportes-candidate.js,
 * TABS.auditoria.roles) — mismo criterio que TAB_ROLES.auditoria en
 * campaign.js y que firestore.rules de auditLogs (nunca coordinator).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel, exportGenericToCsv } from '../lib/excel.js'
import { functionsInstance } from '../lib/firebase.js'
import { httpsCallable } from 'firebase/functions'
import { getDuplicateCedulas, listAuditLogsPage } from '../lib/firebaseCandidate.js'

const exportButtons = (id) => `
  <button id="${id}-xlsx" style="background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem; margin-right:6px;">⬇️ Excel</button>
  <button id="${id}-csv" style="background:#607d8b; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ CSV</button>`

function wireExport(id, rows, filenameBase, sheetName) {
  const xlsx = document.getElementById(`${id}-xlsx`)
  const csv = document.getElementById(`${id}-csv`)
  if (xlsx) xlsx.addEventListener('click', () => exportGenericToExcel(rows, `${filenameBase}.xlsx`, sheetName))
  if (csv) csv.addEventListener('click', () => exportGenericToCsv(rows, `${filenameBase}.csv`, sheetName))
}

export async function renderReporteAuditoria(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const [duplicados, logsPage] = await Promise.all([
      getDuplicateCedulas(candidateId),
      listAuditLogsPage(candidateId, { pageSize: 50 })
    ])
    const logs = logsPage.logs

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🔎 Duplicados de cédula (${duplicados.length})</h3>
        ${duplicados.length > 0 ? exportButtons('ra-dup') : ''}
      </div>
      ${duplicados.length === 0 ? '<div style="color:#999; padding:20px; text-align:center; margin-bottom:24px;">No hay duplicados detectados.</div>' : `
        <div style="overflow-x:auto; margin-bottom:24px;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Cédula</th><th>Cantidad de registros</th></tr></thead>
            <tbody>${duplicados.map(d => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px; font-family:monospace;">${escapeHtml(d.cedula)}</td><td>${d.registros.length}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      `}

      <h3 style="margin:0 0 10px; font-size:1.05rem;">🔵 Coincidencias entre candidatos</h3>
      <div id="ra-coincidencias" style="margin-bottom:24px;">Consultando...</div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">📜 Registro de cambios (últimos ${logs.length})</h3>
        ${logs.length > 0 ? exportButtons('ra-logs') : ''}
      </div>
      ${logs.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay actividad registrada.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th></tr></thead>
            <tbody>${logs.map(l => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;">${l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString('es-PY') : ''}</td>
              <td>${escapeHtml(l.actorEmail || l.actorUid || '')}</td>
              <td>${escapeHtml(l.action || '')}</td>
              <td>${escapeHtml(l.entityType || '')}${l.entityId ? ' · ' + escapeHtml(l.entityId) : ''}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    if (duplicados.length > 0) {
      wireExport('ra-dup', duplicados.map(d => ({ Cédula: d.cedula, 'Cantidad de registros': d.registros.length })), `reporte_auditoria_duplicados_${candidateId}`, 'Duplicados')
    }
    if (logs.length > 0) {
      wireExport('ra-logs', logs.map(l => ({
        Fecha: l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString('es-PY') : '',
        Actor: l.actorEmail || l.actorUid || '', Acción: l.action || '', Entidad: l.entityType || '', 'ID entidad': l.entityId || ''
      })), `reporte_auditoria_logs_${candidateId}`, 'Registro de cambios')
    }

    cargarCoincidencias()
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }

  async function cargarCoincidencias() {
    const el = document.getElementById('ra-coincidencias')
    if (!el) return
    try {
      const auditar = httpsCallable(functionsInstance, 'auditarCoincidenciasEntreCandidatos')
      const result = await auditar({ candidateId })
      const { coincidencias, totalPropio } = result.data

      if (coincidencias.length === 0) {
        el.innerHTML = `<div style="background:#d4edda; border:1px solid #28a745; color:#155724; padding:12px; border-radius:4px;"><strong>✅</strong> Ninguno de tus ${totalPropio} votantes guardados coincide con otro candidato de la plataforma.</div>`
        return
      }

      el.innerHTML = `
        <div style="background:#e3f2fd; border:1px solid #1976d2; color:#0d47a1; padding:12px; border-radius:4px; margin-bottom:16px;">
          <strong>🔵</strong> ${coincidencias.length} de tus ${totalPropio} votantes también aparecen en al menos otra campaña.
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Cédula</th><th>Aparece en</th></tr></thead>
            <tbody>
              ${coincidencias.map(c => `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px; font-family:monospace;">${escapeHtml(c.cedula)}</td>
                <td>${c.otrosCandidatos} otro${c.otrosCandidatos === 1 ? '' : 's'} candidato${c.otrosCandidatos === 1 ? '' : 's'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `
    } catch (err) {
      el.innerHTML = `<div style="color:#c62828;">Error: ${escapeHtml(err.message)}</div>`
    }
  }
}
