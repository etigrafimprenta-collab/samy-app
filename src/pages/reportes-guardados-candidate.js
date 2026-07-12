/**
 * REPORTES > REPORTES GUARDADOS — presets de filtro para Reportes >
 * Registros (único tab de Reportes con un filtro de valor único). No
 * guarda archivos generados (requeriría Firebase Storage, todavía sin
 * inicializar en este proyecto — fuera de alcance).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { listReportPresets, deleteReportPreset } from '../lib/firebaseCandidate.js'

const EJE_LABELS = { uid: 'Dirigente', local: 'Zona / Barrio (Local)', seccional: 'Seccional', mesa: 'Mesa' }

export async function renderReporteGuardados(body, candidateId, user, myRole, misRoles, onOpenInRegistros) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const presets = await listReportPresets(candidateId)
    presets.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    pintar(presets)
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }

  function pintar(presets) {
    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">💾 Filtros guardados de Registros (${presets.length})</h3>
      ${presets.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no guardaste ningún filtro. Andá a Reportes &gt; Registros, aplicá un filtro y usá "💾 Guardar este filtro".</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Nombre</th><th>Filtro</th><th>Guardado por</th><th>Fecha</th><th></th>
            </tr></thead>
            <tbody>${presets.map(p => `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:6px;"><strong>${escapeHtml(p.nombre || '')}</strong></td>
              <td>${escapeHtml(EJE_LABELS[p.eje] || p.eje || '')}: ${escapeHtml(p.valor || '')}</td>
              <td>${escapeHtml(p.createdByName || '')}</td>
              <td>${p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString('es-PY') : ''}</td>
              <td style="white-space:nowrap;">
                <button class="rgd-btn-abrir" data-id="${p.id}" style="background:#283593; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem; margin-right:4px;">▶️ Abrir</button>
                <button class="rgd-btn-borrar" data-id="${p.id}" style="background:#c62828; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem;">🗑️</button>
              </td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `
    body.querySelectorAll('.rgd-btn-abrir').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = presets.find(p => p.id === btn.dataset.id)
        if (preset && onOpenInRegistros) onOpenInRegistros(preset)
      })
    })
    body.querySelectorAll('.rgd-btn-borrar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Borrar este filtro guardado?')) return
        try {
          await deleteReportPreset(candidateId, btn.dataset.id)
          pintar(presets.filter(p => p.id !== btn.dataset.id))
        } catch (err) {
          alert('No se pudo borrar: ' + err.message)
        }
      })
    })
  }
}
