/**
 * REPORTES > AYUDAS — consolidado de "Ayuda Gs." por dirigente.
 *
 * Fase 1: resumen/por-dirigente/drill-down de solo consulta.
 * Fase 2 (esta versión): control y aprobación — Necesita ayuda → Monto
 * solicitado → Revisión administrativa → Aprobado/Rechazado. `montoAyuda`
 * NUNCA se reinterpreta como aprobado — assistanceStatus/approvedAmount/
 * approvedBy/approvedAt/rejectedBy/rejectedAt/rejectionReason son campos
 * separados (ver src/lib/ayudaGs.js). La seguridad real de quién puede
 * aprobar/rechazar vive en firestore.rules (isAssistanceApprovalActor) —
 * los chequeos de permiso acá son SOLO para no mostrar botones que de
 * todas formas el servidor rechazaría, nunca la única barrera.
 *
 * NO conecta con Cajeros DD/cashierAccounts/cashierMovements ni con
 * financeObligations — "aprobado" acá significa únicamente "Administración
 * autorizó este importe", sin mover ningún dinero.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { getAyudaGsSummary, approveAssistanceRequest, rejectAssistanceRequest, approveAssistanceRequestsBulk, getFinanceAuditLogs } from '../lib/firebaseCandidate.js'
import { can } from '../lib/rbac.js'
import { money } from './finanzas-candidate.js'

const statCard = (label, value, color) => `
  <div class="stat-card stat-card--accent" style="--accent:${color};">
    <div class="stat-num">${value}</div>
    <div class="stat-label">${label}</div>
  </div>`

const ESTADO_LABEL = {
  'ok': null,
  'sin-uid': '⚠️ Sin dirigente',
  'no-disponible': '⚠️ Usuario eliminado'
}

const STATUS_BADGE = {
  pending_amount: '<span style="background:#eee; color:#666; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">Pendiente de monto</span>',
  pending_approval: '<span style="background:#fff3cd; color:#8a6400; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">Pendiente de aprobación</span>',
  approved: '<span style="background:#e3f6e8; color:#2e7d32; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">✅ Aprobado</span>',
  rejected: '<span style="background:#fde3e3; color:#c62828; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600;">❌ Rechazado</span>'
}

const ACTION_LABEL = {
  approve: 'Aprobado', reject: 'Rechazado', reopened_after_edit: 'Reabierto (monto editado)'
}

// Guard de concurrencia (ver Fase 1) — una corrida vieja de
// renderReporteAyuda (doble clic, o un cambio de candidato que vuelve a
// montar este mismo cuerpo) nunca pinta sobre una más nueva.
let renderToken = 0

export async function renderReporteAyuda(body, candidateId, user, myRole, misRoles = []) {
  const myToken = ++renderToken
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'

  // Mismo criterio que firestore.rules/isAssistanceApprovalActor — acá
  // SOLO decide qué botones mostrar, nunca es la barrera real (eso lo
  // hace el servidor). Ocultar el botón a quien no puede de todas formas
  // obtendría un error del servidor, no un bypass.
  const puedeDecidir = ['campaign_admin', 'finance_admin'].includes(myRole) ||
    can(misRoles, 'finance.approve') || can(misRoles, 'finance.reject')

  let data
  try {
    data = await getAyudaGsSummary(candidateId)
  } catch (err) {
    if (myToken !== renderToken) return
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error cargando el resumen de ayudas: ${escapeHtml(err.message)}</div>`
    return
  }
  if (myToken !== renderToken) return

  const { resumen, porDirigente, registrosConAyuda } = data

  body.innerHTML = `
    <p style="font-size:.82rem; color:#666; background:#eef3f8; border-left:4px solid #1f4b7a; padding:8px 10px; border-radius:4px; margin:0 0 16px;">
      ℹ️ "Aprobado" significa únicamente que Administración autorizó este importe — no está conectado con Cajeros Día D ni implica que ya se pagó.
    </p>
    <div class="stats-grid" style="margin-bottom:10px;">
      ${statCard('Necesitan ayuda', resumen.necesitanAyuda, '#6a1b9a')}
      ${statCard('Pendientes de monto', resumen.pendingAmount, '#999')}
      ${statCard('Pendientes de aprobación', resumen.pendingApproval, '#e65100')}
      ${statCard('Aprobados', resumen.approved, '#2e7d32')}
      ${statCard('Rechazados', resumen.rejected, '#c62828')}
    </div>
    <div class="stats-grid" style="margin-bottom:20px;">
      ${statCard('Total solicitado', money(resumen.totalSolicitado), '#1f4b7a')}
      ${statCard('Total aprobado', money(resumen.totalAprobado), '#2e7d32')}
      ${statCard('Diferencia (comparación, no saldo disponible)', money(resumen.diferencia), '#999')}
    </div>

    <h3 style="margin:0 0 10px; font-size:1rem;">Consolidado por dirigente</h3>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
        <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
          <th style="padding:6px;">Dirigente</th><th>Necesitan ayuda</th><th>Sin monto</th><th>Pend. aprobación</th><th>Aprobados</th><th>Rechazados</th><th>Solicitado</th><th>Aprobado</th>
        </tr></thead>
        <tbody>
          ${porDirigente.map((d, i) => `
            <tr class="rep-ayuda-row" data-idx="${i}" style="border-bottom:1px solid #eee; cursor:pointer;" title="Ver votantes">
              <td style="padding:6px;">${escapeHtml(d.nombre)}${ESTADO_LABEL[d.estado] ? ` <span style="color:#e65100; font-size:.72rem;">${ESTADO_LABEL[d.estado]}</span>` : ''}</td>
              <td>${d.necesitanAyuda}</td>
              <td>${d.pendingAmount}</td>
              <td>${d.pendingApproval}</td>
              <td>${d.approved}</td>
              <td>${d.rejected}</td>
              <td><strong>${money(d.totalSolicitado)}</strong></td>
              <td>${money(d.totalAprobado)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div id="rep-ayuda-drilldown"></div>
    <div id="rep-ayuda-review"></div>
  `

  body.querySelectorAll('.rep-ayuda-row').forEach(row => {
    row.addEventListener('click', () => {
      const d = porDirigente[Number(row.dataset.idx)]
      if (d.necesitanAyuda === 0) return
      mostrarDrilldown(d, registrosConAyuda.filter(r => r.groupKey === d.uid))
    })
  })

  function cerrarReview() {
    const el = document.getElementById('rep-ayuda-review')
    if (el) el.innerHTML = ''
  }

  function mostrarDrilldown(dirigente, registros) {
    cerrarReview()
    const el = document.getElementById('rep-ayuda-drilldown')
    const mostrarUidPorFila = dirigente.estado === 'no-disponible'
    const seleccionables = registros.filter(r => r.assistanceStatus === 'pending_approval')

    el.innerHTML = `
      <div style="border:2px solid #6a1b9a; border-radius:8px; padding:16px; margin-top:16px;">
        <h4 style="margin:0 0 10px;">🧑‍🤝‍🧑 Votantes de ${escapeHtml(dirigente.nombre)} que necesitan ayuda (${registros.length})</h4>
        ${puedeDecidir && seleccionables.length > 0 ? `
          <div style="margin-bottom:10px;">
            <button id="rep-ayuda-aprobar-masivo" disabled style="background:#2e7d32; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; opacity:.5;">✅ Aprobar seleccionados por monto solicitado</button>
          </div>` : ''}
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              ${puedeDecidir && seleccionables.length > 0 ? '<th style="padding:6px;"><input type="checkbox" id="rep-ayuda-check-todos"></th>' : ''}
              <th style="padding:6px;">Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Estado</th><th>Monto solicitado</th><th>Monto aprobado</th>${mostrarUidPorFila ? '<th>uid original</th>' : ''}<th></th>
            </tr></thead>
            <tbody>
              ${registros.map((r, i) => `
                <tr style="border-bottom:1px solid #eee;">
                  ${puedeDecidir && seleccionables.length > 0 ? `<td style="padding:6px;">${r.assistanceStatus === 'pending_approval' ? `<input type="checkbox" class="rep-ayuda-check" data-idx="${i}">` : ''}</td>` : ''}
                  <td style="padding:6px; font-family:monospace;">${escapeHtml(r.cedula)}</td>
                  <td>${escapeHtml(r.nombre)}</td>
                  <td>${escapeHtml(r.local)}</td>
                  <td>${escapeHtml(r.mesa)}</td>
                  <td>${escapeHtml(r.orden)}</td>
                  <td>${escapeHtml(r.telefono)}</td>
                  <td>${STATUS_BADGE[r.assistanceStatus] || ''}</td>
                  <td>${r.montoAyuda > 0 ? money(r.montoAyuda) : '<span style="color:#e65100; font-weight:700;">⚠ Pendiente de definir monto</span>'}</td>
                  <td>${r.assistanceStatus === 'approved' ? `<strong>${money(r.approvedAmount || 0)}</strong>` : '—'}</td>
                  ${mostrarUidPorFila ? `<td style="font-family:monospace; font-size:.72rem; color:#999;">${escapeHtml(r.uid || '')}</td>` : ''}
                  <td><button class="rep-ayuda-revisar" data-idx="${i}" style="background:#1f4b7a; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem;">Revisar</button></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr><td colspan="${(puedeDecidir && seleccionables.length > 0 ? 1 : 0) + (mostrarUidPorFila ? 1 : 0) + 9}" style="padding-top:10px; font-size:.83rem;">
                Necesitan ayuda: <strong>${dirigente.necesitanAyuda}</strong> ·
                Pend. aprobación: <strong>${dirigente.pendingApproval}</strong> ·
                Aprobados: <strong>${dirigente.approved}</strong> ·
                Rechazados: <strong>${dirigente.rejected}</strong> ·
                SOLICITADO: <strong>${money(dirigente.totalSolicitado)}</strong> ·
                APROBADO: <strong>${money(dirigente.totalAprobado)}</strong>
                ${dirigente.estado === 'ok' ? `<br><span style="color:#999; font-size:.72rem;">uid: ${escapeHtml(dirigente.uid)}</span>` : ''}
              </td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    `
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

    el.querySelectorAll('.rep-ayuda-revisar').forEach(btn => {
      btn.addEventListener('click', () => mostrarRevisionIndividual(dirigente, registros[Number(btn.dataset.idx)], () => mostrarDrilldown(dirigente, registros)))
    })

    const checkTodos = el.querySelector('#rep-ayuda-check-todos')
    const btnAprobarMasivo = el.querySelector('#rep-ayuda-aprobar-masivo')
    function actualizarBotonMasivo() {
      if (!btnAprobarMasivo) return
      const seleccionados = [...el.querySelectorAll('.rep-ayuda-check:checked')]
      btnAprobarMasivo.disabled = seleccionados.length === 0
      btnAprobarMasivo.style.opacity = seleccionados.length === 0 ? '.5' : '1'
    }
    if (checkTodos) {
      checkTodos.addEventListener('change', (e) => {
        el.querySelectorAll('.rep-ayuda-check').forEach(c => { c.checked = e.target.checked })
        actualizarBotonMasivo()
      })
    }
    el.querySelectorAll('.rep-ayuda-check').forEach(c => c.addEventListener('change', actualizarBotonMasivo))

    if (btnAprobarMasivo) {
      btnAprobarMasivo.addEventListener('click', async () => {
        const idxs = [...el.querySelectorAll('.rep-ayuda-check:checked')].map(c => Number(c.dataset.idx))
        const seleccionados = idxs.map(i => registros[i])
        const total = seleccionados.reduce((acc, r) => acc + (Number(r.montoAyuda) || 0), 0)
        if (!confirm(`${seleccionados.length} solicitud(es) seleccionada(s)\nTotal a aprobar: ${money(total)}\n\n¿Confirmar aprobación por el monto solicitado de cada una?`)) return
        try {
          await approveAssistanceRequestsBulk(candidateId, seleccionados, user.uid, myRole)
          alert(`✅ ${seleccionados.length} solicitud(es) aprobada(s) por un total de ${money(total)}.`)
          return renderReporteAyuda(body, candidateId, user, myRole, misRoles)
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }
  }

  async function mostrarRevisionIndividual(dirigente, registro, onVolver) {
    const el = document.getElementById('rep-ayuda-review')
    el.innerHTML = '<div style="margin-top:16px; color:#999;">Cargando historial...</div>'
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

    let historial = []
    try {
      historial = await getFinanceAuditLogs(candidateId, registro.id)
    } catch (err) {
      // No bloquea la revisión si falla el historial — se informa aparte.
    }

    el.innerHTML = `
      <div style="border:2px solid #1f4b7a; border-radius:8px; padding:16px; margin-top:16px;">
        <h4 style="margin:0 0 10px;">🔎 Revisión individual</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; font-size:.85rem; margin-bottom:14px;">
          <div><strong>Votante:</strong> ${escapeHtml(registro.nombre)}</div>
          <div><strong>Cédula:</strong> ${escapeHtml(registro.cedula)}</div>
          <div><strong>Dirigente:</strong> ${escapeHtml(dirigente.nombre)}</div>
          <div><strong>Monto solicitado:</strong> ${money(registro.montoAyuda)}</div>
          <div><strong>Estado:</strong> ${STATUS_BADGE[registro.assistanceStatus] || ''}</div>
          ${registro.assistanceStatus === 'approved' ? `<div><strong>Monto aprobado:</strong> ${money(registro.approvedAmount || 0)}</div>` : ''}
          ${registro.assistanceStatus === 'rejected' ? `<div><strong>Motivo del rechazo:</strong> ${escapeHtml(registro.rejectionReason || '')}</div>` : ''}
        </div>

        ${puedeDecidir && registro.assistanceStatus === 'pending_approval' ? `
          <div style="display:grid; gap:10px; max-width:360px; margin-bottom:14px;">
            <label style="font-size:.8rem; color:#666;">Monto a aprobar (puede ser igual o distinto al solicitado)</label>
            <input id="rep-ayuda-monto-aprobar" type="number" min="0" step="1000" value="${Number(registro.montoAyuda) || 0}" style="padding:10px; border:1px solid #ccc; border-radius:4px;">
            <button id="rep-ayuda-btn-aprobar" style="background:#2e7d32; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">✅ APROBAR</button>
            <label style="font-size:.8rem; color:#666; margin-top:6px;">Motivo del rechazo (obligatorio si rechazás)</label>
            <textarea id="rep-ayuda-motivo-rechazo" rows="2" style="padding:10px; border:1px solid #ccc; border-radius:4px;"></textarea>
            <button id="rep-ayuda-btn-rechazar" disabled style="background:#c62828; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700; opacity:.5;">❌ RECHAZAR</button>
            <div id="rep-ayuda-decision-msg" style="font-size:.85rem;"></div>
          </div>
        ` : (!puedeDecidir && registro.assistanceStatus === 'pending_approval' ? '<p style="font-size:.82rem; color:#999;">Tu rol no tiene permiso para aprobar/rechazar ayudas.</p>' : '')}

        <h5 style="margin:14px 0 6px; font-size:.85rem;">Historial de auditoría</h5>
        ${historial.length === 0
          ? '<p style="font-size:.8rem; color:#999;">Sin decisiones registradas todavía.</p>'
          : `<ul style="font-size:.78rem; color:#555; padding-left:18px; margin:0;">
              ${historial.map(h => `<li>${ACTION_LABEL[h.action] || h.action} — ${escapeHtml(h.performedByRole || '')} — ${h.reason ? escapeHtml(h.reason) : ''}</li>`).join('')}
            </ul>`
        }
        <button id="rep-ayuda-btn-volver" style="margin-top:14px; background:none; border:1px solid #ccc; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:.8rem;">← Volver al listado</button>
      </div>
    `

    el.querySelector('#rep-ayuda-btn-volver')?.addEventListener('click', () => { cerrarReview(); onVolver() })

    const motivoInput = el.querySelector('#rep-ayuda-motivo-rechazo')
    const btnRechazar = el.querySelector('#rep-ayuda-btn-rechazar')
    if (motivoInput && btnRechazar) {
      motivoInput.addEventListener('input', () => {
        const hayMotivo = motivoInput.value.trim().length > 0
        btnRechazar.disabled = !hayMotivo
        btnRechazar.style.opacity = hayMotivo ? '1' : '.5'
      })
    }

    el.querySelector('#rep-ayuda-btn-aprobar')?.addEventListener('click', async () => {
      const msg = el.querySelector('#rep-ayuda-decision-msg')
      const monto = Number(el.querySelector('#rep-ayuda-monto-aprobar').value)
      try {
        await approveAssistanceRequest(candidateId, registro, monto, user.uid, myRole)
        msg.innerHTML = '<span style="color:#2e7d32;">✅ Aprobado.</span>'
        setTimeout(() => renderReporteAyuda(body, candidateId, user, myRole, misRoles), 900)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })

    el.querySelector('#rep-ayuda-btn-rechazar')?.addEventListener('click', async () => {
      const msg = el.querySelector('#rep-ayuda-decision-msg')
      const motivo = motivoInput.value.trim()
      if (!motivo) return
      try {
        await rejectAssistanceRequest(candidateId, registro, motivo, user.uid, myRole)
        msg.innerHTML = '<span style="color:#c62828;">Rechazado.</span>'
        setTimeout(() => renderReporteAyuda(body, candidateId, user, myRole, misRoles), 900)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }
}
