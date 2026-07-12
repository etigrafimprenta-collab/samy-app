/**
 * REPORTES > VOTANTES — vista agregada/analítica (distinta de Registros:
 * acá no hay tabla paginada, son tarjetas + drill-down acotado a 300).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel } from '../lib/excel.js'
import {
  getRecordFlagCounts,
  getRecordsByFlag,
  getDuplicateCedulas
} from '../lib/firebaseCandidate.js'

const FLAG_LABELS = {
  requiresPickup: '🚐 Requieren que se les busque',
  needsAssistance: '🦽 Precisan ayuda para votar',
  canBeDriver: '🚗 Pueden colaborar como chofer',
  wantsToBeMesario: '🪑 Quieren sentarse en la mesa'
}

function filaExport(r) {
  return { Nombre: r.nombre, Cédula: r.cedula, Teléfono: r.telefono || '', Local: r.local || '', Seccional: r.seccional || '', Mesa: r.mesa || '' }
}

export async function renderReporteVotantes(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const [autoDeclarados, duplicados] = await Promise.all([
      getRecordFlagCounts(candidateId, Object.keys(FLAG_LABELS)),
      getDuplicateCedulas(candidateId)
    ])

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">🗳️ Necesidades declaradas al registrar</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; margin-bottom:24px;">
        ${Object.entries(FLAG_LABELS).map(([flag, label]) => `
          <button class="rv-flag-card" data-flag="${flag}" style="text-align:left; cursor:pointer; background:white; border:1px solid #ddd; border-left:4px solid #1976d2; border-radius:8px; padding:14px;">
            <div style="font-size:1.4rem; font-weight:800; color:#1976d2;">${autoDeclarados[flag] || 0}</div>
            <div style="font-size:.72rem; font-weight:700; color:#666;">${label}</div>
          </button>
        `).join('')}
      </div>
      <div id="rv-drilldown" style="margin-bottom:24px;"></div>

      <h3 style="margin:0 0 12px; font-size:1.05rem;">🔎 Posibles duplicados (${duplicados.length})</h3>
      <p style="font-size:.8rem; color:#666; margin:0 0 10px;">Misma cédula guardada más de una vez por tu equipo. Para borrar duplicados, usá la pestaña <strong>Auditoría</strong>.</p>
      ${duplicados.length === 0 ? '<div style="color:#999; padding:16px;">No hay duplicados detectados.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Cédula</th><th>Cantidad de registros</th></tr></thead>
            <tbody>${duplicados.slice(0, 50).map(d => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(d.cedula)}</td><td>${d.registros.length}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        ${duplicados.length > 50 ? `<div style="color:#999; font-size:.8rem; margin-top:8px;">Mostrando 50 de ${duplicados.length} — ver el detalle completo en Auditoría.</div>` : ''}
      `}
    `

    body.querySelectorAll('.rv-flag-card').forEach(btn => {
      btn.addEventListener('click', () => pintarDrilldown(btn.dataset.flag, FLAG_LABELS[btn.dataset.flag]))
    })
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }

  async function pintarDrilldown(flag, label) {
    const el = document.getElementById('rv-drilldown')
    el.innerHTML = '<div style="color:#999;">Cargando detalle...</div>'
    const registros = await getRecordsByFlag(candidateId, flag, 300)

    el.innerHTML = `
      <div style="background:#eef3f8; border:1px solid #cfe0ee; border-radius:8px; padding:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
          <strong>${label} — ${registros.length}${registros.length === 300 ? '+' : ''}</strong>
          <button id="rv-export" style="background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ Exportar Excel</button>
        </div>
        ${registros.length === 300 ? '<div style="font-size:.78rem; color:#856404; margin-bottom:8px;">Mostrando los primeros 300 — el Excel exporta exactamente estos 300.</div>' : ''}
        <div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Nombre</th><th>Cédula</th><th>Local</th><th>Mesa</th></tr></thead>
            <tbody>${registros.map(r => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.cedula)}</td><td>${escapeHtml(r.local) || '—'}</td><td>${escapeHtml(r.mesa) || '—'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    `
    document.getElementById('rv-export').addEventListener('click', () => {
      exportGenericToExcel(registros.map(filaExport), `reporte_votantes_${flag}_${candidateId}.xlsx`, label.replace(/[^\w]/g, '_').slice(0, 30))
    })
  }
}
