/**
 * MÓDULO: FINANZAS DE CAMPAÑA (candidato-scoped).
 *
 * Las 4 etapas de implementación (ver entregables de cada una en el
 * chat): Etapa 1 (modelo de datos, permisos, Resumen, Obligaciones),
 * Etapa 2 (Pagos, aprobación de pagos, comprobantes), Etapa 3
 * (Liquidaciones, Caja, Reportes), Etapa 4 (integración Día D, Alertas,
 * Configuración de tarifas) — ya están todas activas.
 *
 * Reutiliza: mesarios (getMesarios), drivers (getDrivers), usuarios con
 * rol dirigente/operador (getAllCandidateUsers), CI de savedRecords/
 * padrón (getRecordByCedula/searchVoterByCedula) para "ayuda a votante",
 * y electionDayControl (Día D) para validar actividad real antes de
 * generar obligaciones especiales — ninguna colección de beneficiarios
 * se duplica, financeObligations solo guarda referencias
 * (relatedDriverId/relatedTableUserId/relatedLeaderId/relatedVoterId/
 * beneficiaryUserId) a lo que ya existe.
 */
import {
  getMesarios,
  getDrivers,
  getAllCandidateUsers,
  getRecordByCedula,
  searchVoterByCedula,
  createFinanceObligation,
  updateFinanceObligation,
  approveFinanceObligation,
  rejectFinanceObligation,
  cancelFinanceObligation,
  getFinanceObligationsPage,
  getFinanceSummary,
  getFinanceAuditLogs,
  createFinancePayment,
  approveFinancePayment,
  rejectFinancePayment,
  markFinancePaymentAsPaid,
  reverseFinancePayment,
  cancelFinancePayment,
  getFinancePaymentsPage,
  getFinancePaymentsWithoutReceiptCount,
  uploadFinanceReceipt,
  createPaymentBatch,
  submitPaymentBatch,
  approvePaymentBatch,
  cancelPaymentBatch,
  payPaymentBatch,
  getPaymentBatchesPage,
  createCashAccount,
  getCashAccounts,
  createCashMovement,
  getCashMovementsPage,
  getCashAccountBalance,
  getFinancePaymentsSumByMethod,
  getFinancePaymentsWithoutReceiptList,
  getDiaDValidationForDrivers,
  getDiaDValidationForMesarios,
  getDiaDValidationForDirigentes,
  getVotersNeedingAssistanceForFinance,
  generateDiaDObligations,
  calculateFinanceAlerts,
  getOpenFinanceAlerts,
  resolveFinanceAlert,
  getFinanceSettings,
  updateFinanceSettings,
  FINANCE_BENEFICIARY_TYPES,
  FINANCE_FREQUENCIES,
  FINANCE_PAYMENT_METHODS,
  PAYMENT_BATCH_TYPES,
  CASH_MOVEMENT_TYPES
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { can } from '../lib/rbac.js'

const BENEFICIARY_LABELS = {
  mesario: '🪑 Mesario', chofer: '🚗 Chofer', dirigente: '🧭 Dirigente',
  operador: '📞 Operador', votante: '🗳️ Votante (ayuda)', proveedor: '🏪 Proveedor', otro: '📦 Otro'
}
const FREQUENCY_LABELS = {
  one_time: 'Eventual', weekly: 'Semanal', monthly: 'Mensual', election_day: 'Especial Día D', custom: 'Personalizada'
}
const STATUS_LABELS = {
  draft: '📝 Borrador', pending: '⏳ Pendiente', approved: '🔵 Aprobado', rejected: '🔴 Rechazado',
  partially_paid: '🟢 Pago parcial', paid: '✅ Pagado', cancelled: '⚪ Cancelado', overdue: '🟠 Vencido'
}
const STATUS_COLORS = {
  draft: '#999', pending: '#f9a825', approved: '#1976d2', rejected: '#c62828',
  partially_paid: '#43a047', paid: '#2e7d32', cancelled: '#757575', overdue: '#e65100'
}
const PAYMENT_STATUS_LABELS = {
  pending: '⏳ Pendiente', approved: '🔵 Aprobado', paid: '✅ Pagado',
  failed: '🔴 Rechazado', reversed: '↩️ Revertido', cancelled: '⚪ Cancelado'
}
const PAYMENT_STATUS_COLORS = {
  pending: '#f9a825', approved: '#1976d2', paid: '#2e7d32',
  failed: '#c62828', reversed: '#e65100', cancelled: '#757575'
}
export const PAYMENT_METHOD_LABELS = {
  cash: '💵 Efectivo', bank_transfer: '🏦 Transferencia', wallet: '📱 Billetera digital',
  check: '📄 Cheque', card: '💳 Tarjeta', other: '📦 Otro'
}
export const BATCH_STATUS_LABELS = {
  draft: '📝 Borrador', ready_for_approval: '⏳ Esperando aprobación', approved: '🔵 Aprobado',
  partially_paid: '🟢 Pago parcial', paid: '✅ Pagado', cancelled: '⚪ Cancelado'
}
const BATCH_STATUS_COLORS = {
  draft: '#999', ready_for_approval: '#f9a825', approved: '#1976d2',
  partially_paid: '#43a047', paid: '#2e7d32', cancelled: '#757575'
}
const BATCH_TYPE_LABELS = { weekly: 'Semanal', monthly: 'Mensual', election_day: 'Especial Día D', custom: 'Personalizada' }
const CASH_TYPE_LABELS = { income: '📥 Ingreso', expense: '📤 Egreso', adjustment: '⚖️ Ajuste', transfer_in: '↘️ Transferencia recibida', transfer_out: '↗️ Transferencia enviada' }

const TABS = [
  { id: 'resumen', label: '📊 Resumen', ready: true },
  { id: 'obligaciones', label: '📋 Obligaciones', ready: true },
  { id: 'pagos', label: '💳 Pagos', ready: true },
  { id: 'liquidaciones', label: '🧾 Liquidaciones', ready: true },
  { id: 'caja', label: '🏦 Caja', ready: true },
  { id: 'dia-d-finanzas', label: '🗳️ Día D', ready: true },
  { id: 'comprobantes', label: '📎 Comprobantes', ready: true },
  { id: 'reportes', label: '📈 Reportes', ready: true },
  { id: 'auditoria-finanzas', label: '🕵️ Auditoría', ready: true },
  { id: 'configuracion-finanzas', label: '⚙️ Configuración', ready: true }
]

export function money(n, currency = 'PYG') {
  return (currency === 'PYG' ? 'Gs. ' : currency + ' ') + (Number(n) || 0).toLocaleString('es-PY')
}

export async function renderFinanzasCandidate(container, candidateId, user, myRole, misRoles = []) {
  // Etapa 7 (RBAC, modo compatibilidad): cada flag ahora es
  // can(misRoles, permiso) || legacyRoles.includes(myRole) — el permiso
  // nuevo solo AMPLÍA lo que ya daba el chequeo viejo, nunca lo achica.
  // Para el 100% de usuarios reales hoy (sin roleIds), misRoles llega
  // vacío desde campaign.js y can() siempre da false, así que el
  // comportamiento es idéntico al de antes.
  const permitir = (permKey, legacyRoles) => can(misRoles, permKey) || legacyRoles.includes(myRole)

  const puedeCrear = permitir('finance.create_obligation', ['campaign_admin', 'finance_admin', 'finance_operator'])
  const puedeAprobar = permitir('finance.approve', ['campaign_admin', 'finance_admin'])
  const puedeCancelar = permitir('finance.reject', ['campaign_admin', 'finance_admin'])
  const puedeRegistrarPago = permitir('finance.pay', ['campaign_admin', 'finance_admin', 'cashier'])
  const puedeMarcarPagado = permitir('finance.pay', ['campaign_admin', 'finance_admin', 'cashier'])
  const puedeSubirComprobante = permitir('finance.upload_receipt', ['campaign_admin', 'finance_admin', 'finance_operator', 'cashier'])
  const puedeCrearLiquidacion = permitir('finance.create_obligation', ['campaign_admin', 'finance_admin', 'finance_operator'])
  const puedeAprobarLiquidacion = permitir('finance.approve', ['campaign_admin', 'finance_admin'])
  const puedePagarLiquidacion = permitir('finance.pay', ['campaign_admin', 'finance_admin', 'cashier'])
  const puedeGestionarCaja = permitir('finance.manage_cash', ['campaign_admin', 'finance_admin'])
  const puedeVerCaja = permitir('finance.view_cash', ['campaign_admin', 'finance_admin', 'finance_operator', 'cashier', 'auditor'])
  const puedeGenerarDiaD = permitir('finance.create_obligation', ['campaign_admin', 'finance_admin', 'finance_operator'])
  const puedeGestionarAlertas = permitir('finance.configure', ['campaign_admin', 'finance_admin'])
  const puedeConfigurarTarifas = permitir('finance.configure', ['campaign_admin', 'finance_admin'])

  let tab = 'resumen'
  let cursor = null
  let obligaciones = []
  let filtroStatus = ''
  let filtroTipo = ''
  let filtroFrecuencia = ''
  let pagos = []
  let cursorPagos = null
  let filtroStatusPago = ''
  let lotes = []
  let cursorLotes = null
  let cuentasCaja = []
  let cuentaCajaActiva = null
  let movimientosCaja = []
  let cursorMovimientos = null

  function render() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #00695c 0%, #004d40 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed', sans-serif; font-size: 2rem; text-transform: uppercase;">💰 FINANZAS DE CAMPAÑA</h2>
        <p style="margin: 6px 0 0 0; font-size: .82rem; opacity: .9;">Obligaciones, pagos, liquidaciones, caja y reportes</p>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:16px 20px 0;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:2px solid #eee; padding-bottom:10px;">
          ${TABS.map(t => `<button class="fin-tab btn-tab${tab === t.id ? ' active' : ''}" data-tab="${t.id}" style="--tab-color:#00695c;">${t.label}${t.ready ? '' : ' 🚧'}</button>`).join('')}
        </div>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px; padding:20px;">
        <div id="fin-body">Cargando...</div>
      </div>
    `
    container.querySelectorAll('.fin-tab').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })
    pintarTab()
  }

  async function pintarTab() {
    const body = document.getElementById('fin-body')
    const tabDef = TABS.find(t => t.id === tab)
    if (!tabDef.ready) {
      body.innerHTML = `
        <div style="text-align:center; padding:50px 20px; color:#999;">
          <div style="font-size:2.5rem; margin-bottom:10px;">🚧</div>
          <div style="font-weight:700; font-size:1.05rem; margin-bottom:6px;">Todavía no implementado</div>
          <div style="font-size:.85rem;">Esta sección llega en la Etapa ${tabDef.etapa} del módulo Finanzas (ver plan de implementación por etapas).</div>
        </div>`
      return
    }
    if (tab === 'resumen') return pintarResumen(body)
    if (tab === 'obligaciones') return pintarObligaciones(body)
    if (tab === 'pagos') return pintarPagos(body)
    if (tab === 'liquidaciones') return pintarLiquidaciones(body)
    if (tab === 'caja') return pintarCaja(body)
    if (tab === 'reportes') return pintarReportes(body)
    if (tab === 'comprobantes') return pintarComprobantes(body)
    if (tab === 'dia-d-finanzas') return pintarDiaDFinanzas(body)
    if (tab === 'configuracion-finanzas') return pintarConfiguracion(body)
    if (tab === 'auditoria-finanzas') return pintarAuditoria(body)
  }

  // ── RESUMEN ──────────────────────────────────────────────────────────
  const ALERT_SEVERITY_COLORS = { high: '#c62828', medium: '#e65100', low: '#f9a825' }
  const ALERT_SEVERITY_LABELS = { high: '🔴 Alta', medium: '🟠 Media', low: '🟡 Baja' }

  async function pintarResumen(body) {
    body.innerHTML = 'Cargando resumen...'
    try {
      const [s, sinComprobante, alertas] = await Promise.all([
        getFinanceSummary(candidateId),
        getFinancePaymentsWithoutReceiptCount(candidateId),
        getOpenFinanceAlerts(candidateId)
      ])
      const card = (label, value, color) => `
        <div class="stat-card stat-card--accent" style="--accent:${color};">
          <div class="stat-num">${value}</div>
          <div class="stat-label">${label}</div>
        </div>`
      body.innerHTML = `
        <div id="fin-alertas" style="margin-bottom:20px;"></div>
        <div class="stats-grid">
          ${card('Total pendiente', money(s.pendingSum), STATUS_COLORS.pending)}
          ${card('Total aprobado', money(s.approvedSum), STATUS_COLORS.approved)}
          ${card('Total pagado', money(s.paidSum), STATUS_COLORS.paid)}
          ${card('Obligaciones pendientes', s.pendingCount, STATUS_COLORS.pending)}
          ${card('Obligaciones aprobadas', s.approvedCount, STATUS_COLORS.approved)}
          ${card('Obligaciones pagadas', s.paidCount, STATUS_COLORS.paid)}
          ${card('Obligaciones rechazadas', s.rejectedCount, STATUS_COLORS.rejected)}
          ${card('Especiales Día D', s.electionDayCount, '#6a1b9a')}
          ${card('Pagos sin comprobante', sinComprobante, '#e65100')}
        </div>
      `
      pintarAlertas(alertas)
    } catch (err) {
      body.innerHTML = `<div style="color:#c62828; padding:20px;">Error cargando el resumen: ${escapeHtml(err.message)}</div>`
    }
  }

  function pintarAlertas(alertas) {
    const el = document.getElementById('fin-alertas')
    if (!el) return
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:.95rem; color:#333;">🔔 Alertas abiertas (${alertas.length})</h3>
        ${puedeGestionarAlertas ? `<button id="fin-btn-recalcular-alertas" style="background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.75rem;">🔄 Actualizar alertas</button>` : ''}
      </div>
      ${alertas.length === 0 ? '<div style="color:#999; font-size:.85rem;">Sin alertas abiertas.</div>' : `
        <div style="display:grid; gap:6px;">
          ${alertas.map(a => `
            <div style="background:white; border-left:4px solid ${ALERT_SEVERITY_COLORS[a.severity] || '#999'}; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
              <div style="font-size:.82rem;"><strong>${ALERT_SEVERITY_LABELS[a.severity] || a.severity}</strong> — ${escapeHtml(a.message)}</div>
              ${puedeGestionarAlertas ? `<button class="fin-btn-resolver-alerta" data-id="${a.id}" style="background:#2e7d32; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:.72rem;">✔️ Resolver</button>` : ''}
            </div>
          `).join('')}
        </div>
      `}
    `
    document.getElementById('fin-btn-recalcular-alertas')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Calculando...'
      try {
        const { generadas } = await calculateFinanceAlerts(candidateId)
        const nuevas = await getOpenFinanceAlerts(candidateId)
        pintarAlertas(nuevas)
        if (generadas === 0) alert('No se encontraron alertas nuevas.')
      } catch (err) {
        alert('Error calculando alertas: ' + err.message)
      }
    })
    el.querySelectorAll('.fin-btn-resolver-alerta').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await resolveFinanceAlert(candidateId, btn.dataset.id, user.uid)
        const nuevas = await getOpenFinanceAlerts(candidateId)
        pintarAlertas(nuevas)
      } catch (err) { alert('Error: ' + err.message) }
    }))
  }

  // ── OBLIGACIONES ─────────────────────────────────────────────────────
  async function pintarObligaciones(body) {
    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <select id="fo-f-status" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            <option value="">Todos los estados</option>
            ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${filtroStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <select id="fo-f-tipo" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            <option value="">Todos los beneficiarios</option>
            ${FINANCE_BENEFICIARY_TYPES.map(v => `<option value="${v}" ${filtroTipo === v ? 'selected' : ''}>${BENEFICIARY_LABELS[v]}</option>`).join('')}
          </select>
          <select id="fo-f-frecuencia" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
            <option value="">Todas las frecuencias</option>
            ${FINANCE_FREQUENCIES.map(v => `<option value="${v}" ${filtroFrecuencia === v ? 'selected' : ''}>${FREQUENCY_LABELS[v]}</option>`).join('')}
          </select>
        </div>
        ${puedeCrear ? `<button id="fo-btn-nueva" style="background:#00695c; color:white; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:700;">➕ Nueva obligación</button>` : ''}
      </div>
      <div id="fo-lista">Cargando...</div>
      <div style="text-align:center; margin-top:12px;"><button id="fo-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
    `
    document.getElementById('fo-f-status').addEventListener('change', e => { filtroStatus = e.target.value; cargarObligaciones(false) })
    document.getElementById('fo-f-tipo').addEventListener('change', e => { filtroTipo = e.target.value; cargarObligaciones(false) })
    document.getElementById('fo-f-frecuencia').addEventListener('change', e => { filtroFrecuencia = e.target.value; cargarObligaciones(false) })
    if (puedeCrear) document.getElementById('fo-btn-nueva').addEventListener('click', () => mostrarModalNuevaObligacion())

    await cargarObligaciones(true)
  }

  async function cargarObligaciones(reset) {
    if (reset) { obligaciones = []; cursor = null }
    const { obligations, lastDoc, hasMore } = await getFinanceObligationsPage(candidateId, {
      status: filtroStatus || null, cursor, pageSize: 50
    })
    obligaciones = reset ? obligations : [...obligaciones, ...obligations]
    cursor = lastDoc
    pintarListaObligaciones()
    const btnMas = document.getElementById('fo-btn-mas')
    if (btnMas) {
      btnMas.style.display = hasMore ? 'inline-block' : 'none'
      btnMas.onclick = () => cargarObligaciones(false)
    }
  }

  function pintarListaObligaciones() {
    const filtradas = obligaciones.filter(o =>
      (!filtroTipo || o.beneficiaryType === filtroTipo) &&
      (!filtroFrecuencia || o.frequency === filtroFrecuencia)
    )
    const el = document.getElementById('fo-lista')
    if (!el) return
    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Beneficiario</th><th>Concepto</th><th>Monto</th><th>Frecuencia</th><th>Estado</th><th>Creado por</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${filtradas.length === 0 ? `<tr><td colspan="7" style="padding:40px; text-align:center; color:#999;">Sin obligaciones registradas.</td></tr>` : filtradas.map(o => `
              <tr style="border-bottom:1px solid #eee;" data-id="${o.id}">
                <td style="padding:6px;">
                  <div style="font-weight:700;">${escapeHtml(o.beneficiaryName) || '—'}</div>
                  <div style="font-size:.72rem; color:#999;">${BENEFICIARY_LABELS[o.beneficiaryType] || o.beneficiaryType}${o.beneficiaryDocument ? ' · CI ' + escapeHtml(o.beneficiaryDocument) : ''}</div>
                </td>
                <td>${escapeHtml(o.concept) || '—'}</td>
                <td style="font-weight:700;">${money(o.amount, o.currency)}</td>
                <td>${FREQUENCY_LABELS[o.frequency] || o.frequency}</td>
                <td><span style="background:${STATUS_COLORS[o.status]}22; color:${STATUS_COLORS[o.status]}; padding:3px 8px; border-radius:6px; font-weight:700; font-size:.72rem;">${STATUS_LABELS[o.status] || o.status}</span></td>
                <td style="font-size:.75rem; color:#666;">${escapeHtml(o.createdBy === user.uid ? 'Vos' : (o.createdBy || '').slice(0, 8))}</td>
                <td>
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    ${o.status === 'draft' && (puedeCrear && o.createdBy === user.uid) ? `<button class="fo-btn-enviar" data-id="${o.id}" style="background:#1976d2; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">📨 Enviar</button>` : ''}
                    ${o.status === 'pending' && puedeAprobar ? `<button class="fo-btn-aprobar" data-id="${o.id}" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">✅ Aprobar</button>` : ''}
                    ${o.status === 'pending' && puedeAprobar ? `<button class="fo-btn-rechazar" data-id="${o.id}" style="background:#c62828; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🚫 Rechazar</button>` : ''}
                    ${!['paid', 'cancelled', 'rejected'].includes(o.status) && puedeCancelar ? `<button class="fo-btn-cancelar" data-id="${o.id}" style="background:#757575; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">⛔ Cancelar</button>` : ''}
                    <button class="fo-btn-historial" data-id="${o.id}" style="background:#455a64; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🕐</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    el.querySelectorAll('.fo-btn-enviar').forEach(btn => btn.addEventListener('click', async () => {
      try { await updateFinanceObligation(candidateId, btn.dataset.id, { status: 'pending' }, user.uid, myRole); await cargarObligaciones(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fo-btn-aprobar').forEach(btn => btn.addEventListener('click', async () => {
      const ob = obligaciones.find(o => o.id === btn.dataset.id)
      const selfApproval = ob.createdBy === user.uid
      if (selfApproval && !confirm('⚠️ Vos mismo/a creaste esta obligación. Aprobarla ahora queda registrado en auditoría como una excepción a la separación de funciones. ¿Confirmás?')) return
      if (!selfApproval && !confirm(`¿Aprobar la obligación de ${ob.beneficiaryName} por ${money(ob.amount, ob.currency)}?`)) return
      try { await approveFinanceObligation(candidateId, ob, user.uid, myRole, { selfApproval }); await cargarObligaciones(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fo-btn-rechazar').forEach(btn => btn.addEventListener('click', async () => {
      const ob = obligaciones.find(o => o.id === btn.dataset.id)
      const motivo = prompt('Motivo del rechazo:', '')
      if (motivo === null) return
      try { await rejectFinanceObligation(candidateId, ob, user.uid, myRole, motivo); await cargarObligaciones(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fo-btn-cancelar').forEach(btn => btn.addEventListener('click', async () => {
      const ob = obligaciones.find(o => o.id === btn.dataset.id)
      if (!confirm(`¿Cancelar la obligación de ${ob.beneficiaryName}?`)) return
      const motivo = prompt('Motivo de la cancelación (opcional):', '') || ''
      try { await cancelFinanceObligation(candidateId, ob, user.uid, myRole, motivo); await cargarObligaciones(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fo-btn-historial').forEach(btn => btn.addEventListener('click', async () => {
      const logs = await getFinanceAuditLogs(candidateId, btn.dataset.id)
      mostrarModalHistorial(logs)
    }))
  }

  function mostrarModalHistorial(logs) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;'
    modal.innerHTML = `
      <div style="background:white; border-radius:8px; padding:24px; max-width:520px; width:100%; max-height:80vh; overflow-y:auto;">
        <h3 style="margin:0 0 16px;">🕐 Historial de auditoría</h3>
        ${logs.length === 0 ? '<div style="color:#999;">Sin movimientos.</div>' : logs.map(l => `
          <div style="border-left:3px solid #00695c; padding:6px 10px; margin-bottom:8px; background:#f5f5f5; font-size:.82rem;">
            <div><strong>${escapeHtml(l.action)}</strong> · ${escapeHtml(l.performedByRole || '')}</div>
            <div style="color:#666; font-size:.72rem;">${l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString('es-PY') : ''}</div>
            ${l.reason ? `<div style="color:#c62828; margin-top:4px;">${escapeHtml(l.reason)}</div>` : ''}
          </div>
        `).join('')}
        <button id="btn-cerrar" style="margin-top:8px; width:100%; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cerrar</button>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#btn-cerrar').addEventListener('click', () => modal.remove())
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  }

  // ── AUDITORÍA (solo lectura, últimas acciones financieras) ──────────
  async function pintarAuditoria(body) {
    body.innerHTML = `<p style="color:#666; font-size:.85rem;">Elegí una obligación o un pago desde sus pestañas y tocá 🕐 para ver su historial. La vista consolidada de auditoría (todas las entidades, filtros por fecha/usuario) llega en Etapa 3.</p>`
  }

  // ── PAGOS ─────────────────────────────────────────────────────────────
  async function pintarPagos(body) {
    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <select id="fp-f-status" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <option value="">Todos los estados</option>
          ${Object.entries(PAYMENT_STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${filtroStatusPago === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${puedeRegistrarPago ? `<button id="fp-btn-nuevo" style="background:#00695c; color:white; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:700;">➕ Registrar pago</button>` : ''}
      </div>
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">💡 Todo pago cuelga de una obligación ya aprobada — no se puede pagar algo que nadie autorizó.</p>
      <div id="fp-lista">Cargando...</div>
      <div style="text-align:center; margin-top:12px;"><button id="fp-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
    `
    document.getElementById('fp-f-status').addEventListener('change', e => { filtroStatusPago = e.target.value; cargarPagos(true) })
    if (puedeRegistrarPago) document.getElementById('fp-btn-nuevo').addEventListener('click', () => mostrarModalNuevoPago())

    await cargarPagos(true)
  }

  async function cargarPagos(reset) {
    if (reset) { pagos = []; cursorPagos = null }
    const { payments, lastDoc, hasMore } = await getFinancePaymentsPage(candidateId, {
      status: filtroStatusPago || null, cursor: cursorPagos, pageSize: 50
    })
    pagos = reset ? payments : [...pagos, ...payments]
    cursorPagos = lastDoc
    pintarListaPagos()
    const btnMas = document.getElementById('fp-btn-mas')
    if (btnMas) {
      btnMas.style.display = hasMore ? 'inline-block' : 'none'
      btnMas.onclick = () => cargarPagos(false)
    }
  }

  function pintarListaPagos() {
    const el = document.getElementById('fp-lista')
    if (!el) return
    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Beneficiario</th><th>Monto</th><th>Método</th><th>Estado</th><th>Comprobante</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${pagos.length === 0 ? `<tr><td colspan="6" style="padding:40px; text-align:center; color:#999;">Sin pagos registrados.</td></tr>` : pagos.map(p => `
              <tr style="border-bottom:1px solid #eee;" data-id="${p.id}">
                <td style="padding:6px;"><strong>${escapeHtml(p.beneficiaryName) || '—'}</strong></td>
                <td style="font-weight:700;">${money(p.amount, p.currency)}</td>
                <td>${PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod}</td>
                <td><span style="background:${PAYMENT_STATUS_COLORS[p.status]}22; color:${PAYMENT_STATUS_COLORS[p.status]}; padding:3px 8px; border-radius:6px; font-weight:700; font-size:.72rem;">${PAYMENT_STATUS_LABELS[p.status] || p.status}</span></td>
                <td>${p.receiptUrl ? `<a href="${escapeHtml(p.receiptUrl)}" target="_blank" rel="noopener" style="color:#2e7d32; font-weight:700;">📎 Ver</a>` : '<span style="color:#e65100;">Sin adjuntar</span>'}</td>
                <td>
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    ${p.status === 'pending' && puedeAprobar ? `<button class="fp-btn-aprobar" data-id="${p.id}" style="background:#1976d2; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">✅ Aprobar</button>` : ''}
                    ${p.status === 'pending' && puedeAprobar ? `<button class="fp-btn-rechazar" data-id="${p.id}" style="background:#c62828; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🚫 Rechazar</button>` : ''}
                    ${p.status === 'approved' && puedeMarcarPagado ? `<button class="fp-btn-pagar" data-id="${p.id}" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">💰 Marcar pagado</button>` : ''}
                    ${p.status === 'paid' && puedeAprobar ? `<button class="fp-btn-revertir" data-id="${p.id}" style="background:#e65100; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">↩️ Revertir</button>` : ''}
                    ${!['paid', 'cancelled', 'failed'].includes(p.status) && puedeCancelar ? `<button class="fp-btn-cancelar" data-id="${p.id}" style="background:#757575; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">⛔</button>` : ''}
                    ${puedeSubirComprobante ? `<label style="background:#455a64; color:white; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">📎<input type="file" class="fp-input-comprobante" data-id="${p.id}" accept="image/*,application/pdf" style="display:none;"></label>` : ''}
                    <button class="fp-btn-historial" data-id="${p.id}" style="background:#263238; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🕐</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    el.querySelectorAll('.fp-btn-aprobar').forEach(btn => btn.addEventListener('click', async () => {
      const p = pagos.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Aprobar el pago de ${money(p.amount, p.currency)} a ${p.beneficiaryName}?`)) return
      try { await approveFinancePayment(candidateId, p, user.uid, myRole); await cargarPagos(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fp-btn-rechazar').forEach(btn => btn.addEventListener('click', async () => {
      const p = pagos.find(x => x.id === btn.dataset.id)
      const motivo = prompt('Motivo del rechazo:', '')
      if (motivo === null) return
      try { await rejectFinancePayment(candidateId, p, user.uid, myRole, motivo); await cargarPagos(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fp-btn-pagar').forEach(btn => btn.addEventListener('click', async () => {
      const p = pagos.find(x => x.id === btn.dataset.id)
      const ref = prompt('Referencia de pago (número de transferencia, recibo, etc. — opcional):', '') || ''
      if (!confirm(`¿Confirmás que se pagó ${money(p.amount, p.currency)} a ${p.beneficiaryName}? Esto actualiza también la obligación asociada.`)) return
      try { await markFinancePaymentAsPaid(candidateId, p, user.uid, myRole, { paymentReference: ref }); await cargarPagos(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fp-btn-revertir').forEach(btn => btn.addEventListener('click', async () => {
      const p = pagos.find(x => x.id === btn.dataset.id)
      const motivo = prompt('Motivo de la reversión (obligatorio):', '')
      if (!motivo) return
      try { await reverseFinancePayment(candidateId, p, user.uid, myRole, motivo); await cargarPagos(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fp-btn-cancelar').forEach(btn => btn.addEventListener('click', async () => {
      const p = pagos.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Cancelar este pago?`)) return
      try { await cancelFinancePayment(candidateId, p, user.uid, myRole); await cargarPagos(true) }
      catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.fp-input-comprobante').forEach(input => input.addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        await uploadFinanceReceipt(candidateId, { paymentId: input.dataset.id, file }, user.uid)
        await cargarPagos(true)
      } catch (err) {
        alert('No se pudo subir el comprobante: ' + err.message + (err.code === 'storage/unknown' || /storage/i.test(err.message) ? '\n\n(Si Firebase Storage todavía no fue habilitado desde la consola del proyecto, esto va a fallar hasta que se active.)' : ''))
      }
    }))
    el.querySelectorAll('.fp-btn-historial').forEach(btn => btn.addEventListener('click', async () => {
      const logs = await getFinanceAuditLogs(candidateId, btn.dataset.id)
      mostrarModalHistorial(logs)
    }))
  }

  async function mostrarModalNuevoPago() {
    const [aprobadas, parciales] = await Promise.all([
      getFinanceObligationsPage(candidateId, { status: 'approved', pageSize: 100 }),
      getFinanceObligationsPage(candidateId, { status: 'partially_paid', pageSize: 100 })
    ])
    const pagables = [...aprobadas.obligations, ...parciales.obligations]

    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 520px; width: 100%; padding: 24px; margin: 20px auto;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #00695c;">➕ REGISTRAR PAGO</h2>
        ${pagables.length === 0 ? `<p style="color:#999;">No hay obligaciones aprobadas o parcialmente pagadas todavía. Aprobá una obligación primero desde la pestaña Obligaciones.</p><button id="fp-btn-cerrar-vacio" style="width:100%; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; margin-top:8px;">Cerrar</button>` : `
        <div style="display:grid; gap:12px;">
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Obligación a pagar:</label>
            <select id="fp-sel-obligacion" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
              ${pagables.map(o => `<option value="${o.id}">${escapeHtml(o.beneficiaryName)} — ${escapeHtml(o.concept || '')} (${money(o.amount, o.currency)})</option>`).join('')}
            </select>
          </div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Monto a pagar:</label>
            <input id="fp-monto" type="number" min="0" step="1000" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Método de pago:</label>
            <select id="fp-metodo" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
              ${FINANCE_PAYMENT_METHODS.map(v => `<option value="${v}">${PAYMENT_METHOD_LABELS[v]}</option>`).join('')}
            </select></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Banco (si aplica):</label>
              <input id="fp-banco" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Cuenta/billetera:</label>
              <input id="fp-cuenta" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          </div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Notas (opcional):</label>
            <textarea id="fp-notas" rows="2" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; font-family:inherit;"></textarea></div>
          <div id="fp-msg" style="font-size:.85rem;"></div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="fp-btn-guardar" style="flex:1; background:#00695c; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">💾 Registrar pago</button>
            <button id="fp-btn-cancelar" style="flex:1; background:#ccc; color:#333; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cancelar</button>
          </div>
        </div>`}
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#fp-btn-cerrar-vacio')?.addEventListener('click', () => modal.remove())

    function actualizarMontoSugerido() {
      const sel = modal.querySelector('#fp-sel-obligacion')
      const ob = pagables.find(o => o.id === sel.value)
      if (ob) modal.querySelector('#fp-monto').value = ob.amount
    }
    modal.querySelector('#fp-sel-obligacion')?.addEventListener('change', actualizarMontoSugerido)
    if (pagables.length > 0) actualizarMontoSugerido()

    modal.querySelector('#fp-btn-guardar')?.addEventListener('click', async () => {
      const ob = pagables.find(o => o.id === modal.querySelector('#fp-sel-obligacion').value)
      const monto = Number(modal.querySelector('#fp-monto').value)
      const msg = modal.querySelector('#fp-msg')
      if (!monto) { msg.innerHTML = '<span style="color:#c62828;">Ingresá un monto.</span>'; return }
      msg.textContent = 'Guardando...'
      try {
        await createFinancePayment(candidateId, ob, {
          amount: monto,
          currency: ob.currency,
          paymentMethod: modal.querySelector('#fp-metodo').value,
          bankName: modal.querySelector('#fp-banco').value.trim(),
          accountOrWallet: modal.querySelector('#fp-cuenta').value.trim(),
          notes: modal.querySelector('#fp-notas').value.trim()
        }, user.uid, myRole)
        modal.remove()
        await cargarPagos(true)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
    modal.querySelector('#fp-btn-cancelar')?.addEventListener('click', () => modal.remove())
  }

  // ── LIQUIDACIONES ─────────────────────────────────────────────────────
  async function pintarLiquidaciones(body) {
    body.innerHTML = `
      <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
        ${puedeCrearLiquidacion ? `<button id="pb-btn-nuevo" style="background:#00695c; color:white; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:700;">➕ Nueva liquidación</button>` : ''}
      </div>
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">💡 Una liquidación agrupa obligaciones ya aprobadas para pagarlas todas juntas — al pagar el lote, cada obligación pasa por el mismo circuito de Pagos de siempre (queda su propio registro y auditoría).</p>
      <div id="pb-lista">Cargando...</div>
      <div style="text-align:center; margin-top:12px;"><button id="pb-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
    `
    if (puedeCrearLiquidacion) document.getElementById('pb-btn-nuevo').addEventListener('click', () => mostrarModalNuevaLiquidacion())
    await cargarLotes(true)
  }

  async function cargarLotes(reset) {
    if (reset) { lotes = []; cursorLotes = null }
    const { batches, lastDoc, hasMore } = await getPaymentBatchesPage(candidateId, { cursor: cursorLotes, pageSize: 30 })
    lotes = reset ? batches : [...lotes, ...batches]
    cursorLotes = lastDoc
    pintarListaLotes()
    const btnMas = document.getElementById('pb-btn-mas')
    if (btnMas) { btnMas.style.display = hasMore ? 'inline-block' : 'none'; btnMas.onclick = () => cargarLotes(false) }
  }

  function pintarListaLotes() {
    const el = document.getElementById('pb-lista')
    if (!el) return
    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Título</th><th>Tipo</th><th>Obligaciones</th><th>Total</th><th>Estado</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${lotes.length === 0 ? `<tr><td colspan="6" style="padding:40px; text-align:center; color:#999;">Sin liquidaciones registradas.</td></tr>` : lotes.map(b => `
              <tr style="border-bottom:1px solid #eee;" data-id="${b.id}">
                <td style="padding:6px;"><strong>${escapeHtml(b.title) || '(sin título)'}</strong></td>
                <td>${BATCH_TYPE_LABELS[b.batchType] || b.batchType}</td>
                <td>${(b.obligationIds || []).length}</td>
                <td style="font-weight:700;">${money(b.totalAmount, b.currency)}</td>
                <td><span style="background:${BATCH_STATUS_COLORS[b.status]}22; color:${BATCH_STATUS_COLORS[b.status]}; padding:3px 8px; border-radius:6px; font-weight:700; font-size:.72rem;">${BATCH_STATUS_LABELS[b.status] || b.status}</span></td>
                <td>
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    ${b.status === 'draft' && puedeCrearLiquidacion ? `<button class="pb-btn-enviar" data-id="${b.id}" style="background:#1976d2; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">📨 Enviar</button>` : ''}
                    ${b.status === 'ready_for_approval' && puedeAprobarLiquidacion ? `<button class="pb-btn-aprobar" data-id="${b.id}" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">✅ Aprobar</button>` : ''}
                    ${b.status === 'approved' && puedePagarLiquidacion ? `<button class="pb-btn-pagar" data-id="${b.id}" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">💰 Pagar lote</button>` : ''}
                    ${!['paid', 'cancelled'].includes(b.status) && puedeAprobarLiquidacion ? `<button class="pb-btn-cancelar" data-id="${b.id}" style="background:#757575; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">⛔</button>` : ''}
                    <button class="pb-btn-historial" data-id="${b.id}" style="background:#263238; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.7rem;">🕐</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    el.querySelectorAll('.pb-btn-enviar').forEach(btn => btn.addEventListener('click', async () => {
      const b = lotes.find(x => x.id === btn.dataset.id)
      try { await submitPaymentBatch(candidateId, b, user.uid, myRole); await cargarLotes(true) } catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.pb-btn-aprobar').forEach(btn => btn.addEventListener('click', async () => {
      const b = lotes.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Aprobar la liquidación "${b.title}" por ${money(b.totalAmount, b.currency)}?`)) return
      try { await approvePaymentBatch(candidateId, b, user.uid, myRole); await cargarLotes(true) } catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.pb-btn-pagar').forEach(btn => btn.addEventListener('click', async () => {
      const b = lotes.find(x => x.id === btn.dataset.id)
      if (!confirm(`¿Pagar TODA la liquidación "${b.title}"? Se va a registrar un pago por obligación incluida (${(b.obligationIds || []).length} en total).`)) return
      btn.disabled = true
      try {
        const { algunFallo } = await payPaymentBatch(candidateId, b, user.uid, myRole, {})
        if (algunFallo) alert('El lote se pagó parcialmente — alguna obligación individual falló, revisá la consola o el historial.')
        await cargarLotes(true)
      } catch (err) { alert('Error: ' + err.message) } finally { btn.disabled = false }
    }))
    el.querySelectorAll('.pb-btn-cancelar').forEach(btn => btn.addEventListener('click', async () => {
      const b = lotes.find(x => x.id === btn.dataset.id)
      if (!confirm('¿Cancelar esta liquidación?')) return
      try { await cancelPaymentBatch(candidateId, b, user.uid, myRole); await cargarLotes(true) } catch (err) { alert('Error: ' + err.message) }
    }))
    el.querySelectorAll('.pb-btn-historial').forEach(btn => btn.addEventListener('click', async () => {
      const logs = await getFinanceAuditLogs(candidateId, btn.dataset.id)
      mostrarModalHistorial(logs)
    }))
  }

  async function mostrarModalNuevaLiquidacion() {
    const { obligations } = await getFinanceObligationsPage(candidateId, { status: 'approved', pageSize: 200 })
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 620px; width: 100%; padding: 24px; margin: 20px auto;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #00695c;">➕ NUEVA LIQUIDACIÓN</h2>
        ${obligations.length === 0 ? `<p style="color:#999;">No hay obligaciones aprobadas disponibles para agrupar.</p><button id="pb-btn-cerrar-vacio" style="width:100%; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer;">Cerrar</button>` : `
        <div style="display:grid; gap:12px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Título:</label>
              <input id="pb-titulo" type="text" placeholder="Ej: Choferes semana 1" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Tipo:</label>
              <select id="pb-tipo" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
                ${PAYMENT_BATCH_TYPES.map(v => `<option value="${v}">${BATCH_TYPE_LABELS[v]}</option>`).join('')}
              </select></div>
          </div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Filtrar por tipo de beneficiario (opcional):</label>
            <select id="pb-filtro-tipo" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
              <option value="">Todos</option>
              ${FINANCE_BENEFICIARY_TYPES.map(v => `<option value="${v}">${BENEFICIARY_LABELS[v]}</option>`).join('')}
            </select></div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:6px;">Obligaciones a incluir:</label>
            <div id="pb-checklist" style="max-height:260px; overflow-y:auto; border:1px solid #ddd; border-radius:4px; padding:8px;"></div>
          </div>
          <div id="pb-total" style="font-weight:700; font-size:1.1rem; color:#00695c;">Total seleccionado: Gs. 0</div>
          <div id="pb-msg" style="font-size:.85rem;"></div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="pb-btn-guardar" style="flex:1; background:#00695c; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">💾 Crear liquidación</button>
            <button id="pb-btn-cancelar" style="flex:1; background:#ccc; color:#333; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cancelar</button>
          </div>
        </div>`}
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#pb-btn-cerrar-vacio')?.addEventListener('click', () => modal.remove())
    if (obligations.length === 0) return

    function pintarChecklist() {
      const filtro = modal.querySelector('#pb-filtro-tipo').value
      const filtradas = obligations.filter(o => !filtro || o.beneficiaryType === filtro)
      modal.querySelector('#pb-checklist').innerHTML = filtradas.map(o => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:.85rem;">
          <input type="checkbox" class="pb-check" value="${o.id}" data-amount="${o.amount}">
          ${escapeHtml(o.beneficiaryName)} — ${escapeHtml(o.concept || '')} (${money(o.amount, o.currency)})
        </label>
      `).join('') || '<p style="color:#999; margin:0;">Sin obligaciones para ese filtro.</p>'
      modal.querySelectorAll('.pb-check').forEach(chk => chk.addEventListener('change', actualizarTotal))
    }
    function actualizarTotal() {
      const total = Array.from(modal.querySelectorAll('.pb-check:checked')).reduce((s, c) => s + Number(c.dataset.amount), 0)
      modal.querySelector('#pb-total').textContent = 'Total seleccionado: ' + money(total)
    }
    modal.querySelector('#pb-filtro-tipo').addEventListener('change', pintarChecklist)
    pintarChecklist()

    modal.querySelector('#pb-btn-guardar').addEventListener('click', async () => {
      const obligationIds = Array.from(modal.querySelectorAll('.pb-check:checked')).map(c => c.value)
      const msg = modal.querySelector('#pb-msg')
      if (obligationIds.length === 0) { msg.innerHTML = '<span style="color:#c62828;">Elegí al menos una obligación.</span>'; return }
      msg.textContent = 'Guardando...'
      try {
        await createPaymentBatch(candidateId, {
          title: modal.querySelector('#pb-titulo').value.trim(),
          batchType: modal.querySelector('#pb-tipo').value,
          obligationIds
        }, user.uid, myRole)
        modal.remove()
        await cargarLotes(true)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
    modal.querySelector('#pb-btn-cancelar').addEventListener('click', () => modal.remove())
  }

  // ── CAJA ──────────────────────────────────────────────────────────────
  async function pintarCaja(body) {
    body.innerHTML = `<p style="color:#999;">Cargando cuentas de caja...</p>`
    cuentasCaja = await getCashAccounts(candidateId)
    if (!cuentaCajaActiva && cuentasCaja.length > 0) cuentaCajaActiva = cuentasCaja[0].id

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <select id="cx-sel-cuenta" style="padding:8px; border:1px solid #ccc; border-radius:4px; min-width:220px;">
          ${cuentasCaja.length === 0 ? '<option value="">Sin cuentas de caja</option>' : cuentasCaja.map(c => `<option value="${c.id}" ${c.id === cuentaCajaActiva ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
        ${puedeGestionarCaja ? `<div style="display:flex; gap:8px;"><button id="cx-btn-nueva-cuenta" style="background:#455a64; color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:700;">🏦 Nueva cuenta</button><button id="cx-btn-nuevo-mov" style="background:#00695c; color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:700;">➕ Registrar movimiento</button></div>` : ''}
      </div>
      <div id="cx-saldo" style="background:#e0f2ef; border-left:4px solid #00695c; border-radius:8px; padding:16px; margin-bottom:16px;"></div>
      <div id="cx-lista">Cargando movimientos...</div>
      <div style="text-align:center; margin-top:12px;"><button id="cx-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
    `
    document.getElementById('cx-sel-cuenta').addEventListener('change', (e) => { cuentaCajaActiva = e.target.value; cargarMovimientosCaja(true) })
    if (puedeGestionarCaja) {
      document.getElementById('cx-btn-nueva-cuenta').addEventListener('click', () => mostrarModalNuevaCuenta())
      document.getElementById('cx-btn-nuevo-mov').addEventListener('click', () => mostrarModalNuevoMovimiento())
    }
    await cargarMovimientosCaja(true)
  }

  async function cargarMovimientosCaja(reset) {
    const saldoEl = document.getElementById('cx-saldo')
    const listaEl = document.getElementById('cx-lista')
    if (!cuentaCajaActiva) {
      if (saldoEl) saldoEl.innerHTML = '<div style="color:#999;">Creá una cuenta de caja para empezar.</div>'
      if (listaEl) listaEl.innerHTML = ''
      return
    }
    if (reset) { movimientosCaja = []; cursorMovimientos = null }
    const [{ movements, lastDoc, hasMore }, saldo] = await Promise.all([
      getCashMovementsPage(candidateId, { cashAccountId: cuentaCajaActiva, cursor: cursorMovimientos, pageSize: 50 }),
      getCashAccountBalance(candidateId, cuentaCajaActiva)
    ])
    movimientosCaja = reset ? movements : [...movimientosCaja, ...movements]
    cursorMovimientos = lastDoc
    if (saldoEl) saldoEl.innerHTML = `<div style="font-size:1.6rem; font-weight:800; color:#00695c;">${money(saldo)}</div><div style="font-size:.75rem; color:#00695c; text-transform:uppercase; font-weight:700;">Saldo actual (calculado del ledger completo, no de un contador guardado)</div>`
    pintarListaMovimientos()
    const btnMas = document.getElementById('cx-btn-mas')
    if (btnMas) { btnMas.style.display = hasMore ? 'inline-block' : 'none'; btnMas.onclick = () => cargarMovimientosCaja(false) }
  }

  function pintarListaMovimientos() {
    const el = document.getElementById('cx-lista')
    if (!el) return
    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th>
          </tr></thead>
          <tbody>
            ${movimientosCaja.length === 0 ? `<tr><td colspan="5" style="padding:40px; text-align:center; color:#999;">Sin movimientos todavía.</td></tr>` : movimientosCaja.map(m => `
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">${escapeHtml(m.movementDate) || '—'}</td>
                <td>${CASH_TYPE_LABELS[m.type] || m.type}</td>
                <td>${escapeHtml(m.category) || '—'}</td>
                <td>${escapeHtml(m.description) || '—'}</td>
                <td style="font-weight:700; color:${['income', 'transfer_in'].includes(m.type) ? '#2e7d32' : '#c62828'};">${['income', 'transfer_in'].includes(m.type) ? '+' : '-'}${money(m.amount, m.currency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  function mostrarModalNuevaCuenta() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 440px; width: 100%; padding: 24px;">
        <h3 style="margin:0 0 16px;">🏦 Nueva cuenta de caja</h3>
        <div style="display:grid; gap:10px;">
          <input id="cx-nombre" placeholder="Nombre (ej: Caja Central)" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <input id="cx-saldo-inicial" type="number" placeholder="Saldo inicial" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <div style="display:flex; gap:8px;">
            <button id="cx-btn-guardar" style="flex:1; background:#00695c; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Crear</button>
            <button id="cx-btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#cx-btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#cx-btn-guardar').addEventListener('click', async () => {
      const nombre = modal.querySelector('#cx-nombre').value.trim()
      if (!nombre) { alert('Ingresá un nombre.'); return }
      try {
        const id = await createCashAccount(candidateId, { name: nombre, initialBalance: Number(modal.querySelector('#cx-saldo-inicial').value) || 0 }, user.uid)
        cuentaCajaActiva = id
        modal.remove()
        await pintarCaja(document.getElementById('fin-body'))
      } catch (err) { alert('Error: ' + err.message) }
    })
  }

  function mostrarModalNuevoMovimiento() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 460px; width: 100%; padding: 24px;">
        <h3 style="margin:0 0 16px;">➕ Registrar movimiento de caja</h3>
        <div style="display:grid; gap:10px;">
          <select id="cx-tipo" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            ${CASH_MOVEMENT_TYPES.map(v => `<option value="${v}">${CASH_TYPE_LABELS[v]}</option>`).join('')}
          </select>
          <input id="cx-categoria" placeholder="Categoría (ej: combustible, viáticos)" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <input id="cx-monto" type="number" placeholder="Monto" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <input id="cx-descripcion" placeholder="Descripción" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <div id="cx-mov-msg" style="font-size:.85rem;"></div>
          <div style="display:flex; gap:8px;">
            <button id="cx-btn-guardar" style="flex:1; background:#00695c; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
            <button id="cx-btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#cx-btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#cx-btn-guardar').addEventListener('click', async () => {
      const monto = Number(modal.querySelector('#cx-monto').value)
      const msg = modal.querySelector('#cx-mov-msg')
      if (!monto) { msg.innerHTML = '<span style="color:#c62828;">Ingresá un monto.</span>'; return }
      try {
        await createCashMovement(candidateId, {
          cashAccountId: cuentaCajaActiva,
          type: modal.querySelector('#cx-tipo').value,
          category: modal.querySelector('#cx-categoria').value.trim(),
          amount: monto,
          description: modal.querySelector('#cx-descripcion').value.trim()
        }, user.uid, myRole)
        modal.remove()
        await cargarMovimientosCaja(true)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }

  // ── REPORTES ──────────────────────────────────────────────────────────
  async function pintarReportes(body) {
    body.innerHTML = `<p style="color:#999;">Generando reportes...</p>`
    const [porMetodo, sinComprobante] = await Promise.all([
      Promise.all(FINANCE_PAYMENT_METHODS.map(async m => ({ metodo: m, total: await getFinancePaymentsSumByMethod(candidateId, m) }))),
      getFinancePaymentsWithoutReceiptList(candidateId, 100)
    ])
    const { obligations: pendientes } = await getFinanceObligationsPage(candidateId, { status: 'pending', pageSize: 100 })

    body.innerHTML = `
      <div class="rep-card" style="margin-bottom:24px;">
        <h3 style="margin:0 0 10px; font-size:1rem; color:#00695c;">💳 Pagos por método (solo pagados)</h3>
        <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="border-bottom:2px solid #eee; text-align:left;"><th style="padding:6px;">Método</th><th>Total</th></tr></thead>
          <tbody>${porMetodo.map(p => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${PAYMENT_METHOD_LABELS[p.metodo]}</td><td style="font-weight:700;">${money(p.total)}</td></tr>`).join('')}</tbody>
        </table></div>
        <button class="rep-export" data-rep="metodo" style="margin-top:8px; background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ Exportar Excel</button>
      </div>

      <div class="rep-card" style="margin-bottom:24px;">
        <h3 style="margin:0 0 10px; font-size:1rem; color:#e65100;">📋 Obligaciones pendientes de aprobación (${pendientes.length})</h3>
        <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="border-bottom:2px solid #eee; text-align:left;"><th style="padding:6px;">Beneficiario</th><th>Concepto</th><th>Monto</th><th>Vencimiento</th></tr></thead>
          <tbody>${pendientes.length === 0 ? '<tr><td colspan="4" style="padding:20px; text-align:center; color:#999;">Ninguna.</td></tr>' : pendientes.map(o => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(o.beneficiaryName)}</td><td>${escapeHtml(o.concept || '')}</td><td style="font-weight:700;">${money(o.amount, o.currency)}</td><td>${escapeHtml(o.dueDate) || '—'}</td></tr>`).join('')}</tbody>
        </table></div>
        <button class="rep-export" data-rep="pendientes" style="margin-top:8px; background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ Exportar Excel</button>
      </div>

      <div class="rep-card">
        <h3 style="margin:0 0 10px; font-size:1rem; color:#c62828;">📎 Pagos pagados sin comprobante (${sinComprobante.length})</h3>
        <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="border-bottom:2px solid #eee; text-align:left;"><th style="padding:6px;">Beneficiario</th><th>Monto</th><th>Fecha de pago</th></tr></thead>
          <tbody>${sinComprobante.length === 0 ? '<tr><td colspan="3" style="padding:20px; text-align:center; color:#999;">Ninguno.</td></tr>' : sinComprobante.map(p => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(p.beneficiaryName)}</td><td style="font-weight:700;">${money(p.amount, p.currency)}</td><td>${escapeHtml(p.paymentDate) || '—'}</td></tr>`).join('')}</tbody>
        </table></div>
        <button class="rep-export" data-rep="sin-comprobante" style="margin-top:8px; background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ Exportar Excel</button>
      </div>
    `

    document.querySelectorAll('.rep-export').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.rep === 'metodo') {
        exportGenericToExcel(porMetodo.map(p => ({ Método: PAYMENT_METHOD_LABELS[p.metodo], Total: p.total })), 'pagos_por_metodo.xlsx', 'Por método')
      } else if (btn.dataset.rep === 'pendientes') {
        exportGenericToExcel(pendientes.map(o => ({ Beneficiario: o.beneficiaryName, Concepto: o.concept || '', Monto: o.amount, Vencimiento: o.dueDate || '' })), 'obligaciones_pendientes.xlsx', 'Pendientes')
      } else {
        exportGenericToExcel(sinComprobante.map(p => ({ Beneficiario: p.beneficiaryName, Monto: p.amount, 'Fecha de pago': p.paymentDate || '' })), 'pagos_sin_comprobante.xlsx', 'Sin comprobante')
      }
    }))
  }

  // ── DÍA D (generador de obligaciones especiales) ─────────────────────
  let diaDTipoActivo = 'chofer'
  let diaDValidacionCache = { chofer: null, mesario: null, dirigente: null, votante: null }
  let diaDSettingsCache = null

  async function pintarDiaDFinanzas(body) {
    body.innerHTML = `
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">
        💡 El sistema nunca paga solo porque exista una asignación — acá solo se generan obligaciones en estado <strong>pendiente</strong>, con la señal de validación a la vista, para que un humano decida qué incluir. Después siguen el mismo circuito de aprobación de siempre.
      </p>
      <div style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;">
        <button class="dd-tipo-btn btn-tab btn-tab--pill${diaDTipoActivo === 'chofer' ? ' active' : ''}" data-tipo="chofer" style="--tab-color:#6a1b9a;">🚗 Choferes</button>
        <button class="dd-tipo-btn btn-tab btn-tab--pill${diaDTipoActivo === 'mesario' ? ' active' : ''}" data-tipo="mesario" style="--tab-color:#6a1b9a;">🪑 Mesarios</button>
        <button class="dd-tipo-btn btn-tab btn-tab--pill${diaDTipoActivo === 'dirigente' ? ' active' : ''}" data-tipo="dirigente" style="--tab-color:#6a1b9a;">🧭 Dirigentes</button>
        <button class="dd-tipo-btn btn-tab btn-tab--pill${diaDTipoActivo === 'votante' ? ' active' : ''}" data-tipo="votante" style="--tab-color:#6a1b9a;">🗳️ Ayuda a votantes</button>
      </div>
      <div id="dd-fin-body">Cargando...</div>
    `
    document.querySelectorAll('.dd-tipo-btn').forEach(btn => btn.addEventListener('click', () => { diaDTipoActivo = btn.dataset.tipo; pintarDiaDFinanzas(body) }))

    if (!diaDSettingsCache) diaDSettingsCache = await getFinanceSettings(candidateId)
    const cont = document.getElementById('dd-fin-body')

    if (diaDTipoActivo === 'votante') return pintarDiaDVotantes(cont)

    const RATE_BY_TYPE = { chofer: diaDSettingsCache.driverRate, mesario: diaDSettingsCache.mesarioRate, dirigente: diaDSettingsCache.leaderRate }
    const GETTERS = { chofer: getDiaDValidationForDrivers, mesario: getDiaDValidationForMesarios, dirigente: getDiaDValidationForDirigentes }
    const items = await GETTERS[diaDTipoActivo](candidateId)
    diaDValidacionCache[diaDTipoActivo] = items
    const rate = RATE_BY_TYPE[diaDTipoActivo] || 0

    cont.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <div style="font-size:.85rem; color:#555;">${items.filter(i => i.validado).length} de ${items.length} con validación mínima cumplida.</div>
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:.82rem; font-weight:700;">Monto c/u:</label>
          <input id="dd-monto-lote" type="number" value="${rate}" style="width:130px; padding:6px; border:1px solid #ccc; border-radius:4px;">
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;"><input type="checkbox" id="dd-check-todos"></th><th>Nombre</th><th>Validación</th><th>Detalle</th>
          </tr></thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="4" style="padding:30px; text-align:center; color:#999;">Sin registros.</td></tr>` : items.map((it, i) => `
              <tr style="border-bottom:1px solid #eee; ${it.validado ? '' : 'opacity:.6;'}">
                <td style="padding:6px;"><input type="checkbox" class="dd-check" data-idx="${i}" ${it.validado ? 'checked' : ''}></td>
                <td><strong>${escapeHtml(it.nombre)}</strong>${it.local ? `<br><span style="color:#999; font-size:.72rem;">${escapeHtml(it.local)} · Mesa ${escapeHtml(it.mesa)}</span>` : ''}</td>
                <td>${it.validado ? '<span style="color:#2e7d32; font-weight:700;">✅ Cumple</span>' : '<span style="color:#e65100; font-weight:700;">⚠️ Incompleta</span>'}</td>
                <td style="font-size:.75rem; color:#666;">
                  ${diaDTipoActivo === 'chofer' ? `Asignado: ${it.asignado ? '✅' : '❌'} · Traslados realizados: ${it.trasladosRealizados}` : ''}
                  ${diaDTipoActivo === 'mesario' ? `Capacitación: ${it.capacitacionConfirmada ? '✅' : '❌'} · Actividad en su mesa: ${it.actividadEnMesa ? '✅ (' + it.votosConfirmadosEnMesa + ')' : '❌'}` : ''}
                  ${diaDTipoActivo === 'dirigente' ? `Asignado: ${it.asignado ? '✅' : '❌'} · Votos confirmados: ${it.votosConfirmados}` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <button id="dd-btn-generar" style="margin-top:14px; background:#6a1b9a; color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:700;" ${!puedeGenerarDiaD ? 'disabled' : ''}>⚡ Generar obligaciones para los seleccionados</button>
      <div id="dd-gen-msg" style="font-size:.85rem; margin-top:8px;"></div>
    `
    document.getElementById('dd-check-todos').addEventListener('change', (e) => {
      document.querySelectorAll('.dd-check').forEach(c => { c.checked = e.target.checked })
    })
    if (puedeGenerarDiaD) {
      document.getElementById('dd-btn-generar').addEventListener('click', async () => {
        const monto = Number(document.getElementById('dd-monto-lote').value) || 0
        const seleccionados = Array.from(document.querySelectorAll('.dd-check:checked')).map(c => items[Number(c.dataset.idx)])
        const msg = document.getElementById('dd-gen-msg')
        if (seleccionados.length === 0) { msg.innerHTML = '<span style="color:#c62828;">Elegí al menos uno.</span>'; return }
        if (!monto) { msg.innerHTML = '<span style="color:#c62828;">Ingresá un monto.</span>'; return }
        if (!confirm(`¿Generar ${seleccionados.length} obligación(es) especiales de Día D por ${money(monto)} cada una? Quedan en estado pendiente, no se pagan solas.`)) return
        msg.textContent = 'Generando...'
        try {
          const relField = diaDTipoActivo === 'chofer' ? 'relatedDriverId' : diaDTipoActivo === 'mesario' ? 'relatedTableUserId' : 'relatedLeaderId'
          const beneficiaryUserIdField = diaDTipoActivo === 'dirigente' ? { beneficiaryUserId: null } : {}
          const items2 = seleccionados.map(it => ({
            beneficiaryType: diaDTipoActivo,
            beneficiaryName: it.nombre,
            beneficiaryPhone: it.telefono || '',
            [relField]: it.id,
            beneficiaryUserId: diaDTipoActivo === 'dirigente' ? it.id : null,
            amount: monto,
            concept: `Especial Día D — ${BENEFICIARY_LABELS[diaDTipoActivo]}`
          }))
          await generateDiaDObligations(candidateId, items2, user.uid, myRole)
          msg.innerHTML = `<span style="color:#2e7d32;">✅ ${seleccionados.length} obligación(es) generadas — revisalas en la pestaña Obligaciones.</span>`
        } catch (err) {
          msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
        }
      })
    }
  }

  async function pintarDiaDVotantes(cont) {
    cont.innerHTML = 'Cargando votantes marcados con necesidad de ayuda...'
    const votantes = await getVotersNeedingAssistanceForFinance(candidateId)
    cont.innerHTML = `
      <p style="font-size:.85rem; color:#555; margin-bottom:10px;">Votantes marcados en Día D Control con "requiere transporte" o "necesita ayuda" — cada uno ya viene vinculado a su voterId, cumpliendo el requisito del spec de trazabilidad.</p>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
            <th style="padding:6px;">Nombre</th><th>CI</th><th>Motivo</th><th>Acción</th>
          </tr></thead>
          <tbody>
            ${votantes.length === 0 ? `<tr><td colspan="4" style="padding:30px; text-align:center; color:#999;">Sin votantes marcados con necesidad de ayuda por ahora.</td></tr>` : votantes.map(v => `
              <tr style="border-bottom:1px solid #eee;" data-id="${v.id}">
                <td style="padding:6px;"><strong>${escapeHtml(v.nombre)}</strong></td>
                <td style="font-family:monospace;">${escapeHtml(v.cedula)}</td>
                <td>${[v.control.requiresPickup ? '🚐 Transporte' : '', v.control.needsAssistance ? '🦽 Ayuda' : ''].filter(Boolean).join(' + ')}</td>
                <td>${puedeGenerarDiaD ? `<button class="dd-btn-ayuda" data-id="${v.id}" style="background:#6a1b9a; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.75rem;">➕ Crear ayuda</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    cont.querySelectorAll('.dd-btn-ayuda').forEach(btn => btn.addEventListener('click', async () => {
      const v = votantes.find(x => x.id === btn.dataset.id)
      const monto = prompt(`Monto de la ayuda para ${v.nombre} (Gs.):`, String(diaDSettingsCache.maxVoterAssistanceAmount || ''))
      if (!monto) return
      const motivo = prompt('Motivo de la ayuda (obligatorio, queda documentado):', '')
      if (!motivo) { alert('El motivo es obligatorio — no se registran ayudas sin documentar.'); return }
      try {
        await generateDiaDObligations(candidateId, [{
          beneficiaryType: 'votante', beneficiaryName: v.nombre, beneficiaryDocument: v.cedula,
          beneficiaryPhone: v.telefono || '', relatedVoterId: v.id, beneficiaryVoterId: v.id,
          amount: Number(monto), concept: `Ayuda a votante: ${motivo}`
        }], user.uid, myRole)
        alert('Obligación de ayuda creada (pendiente de aprobación) — revisala en Obligaciones.')
        btn.closest('tr').style.opacity = '.4'
        btn.disabled = true
      } catch (err) { alert('Error: ' + err.message) }
    }))
  }

  // ── CONFIGURACIÓN (tarifas sugeridas) ────────────────────────────────
  async function pintarConfiguracion(body) {
    body.innerHTML = 'Cargando configuración...'
    const settings = await getFinanceSettings(candidateId)
    body.innerHTML = `
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">💡 Estas tarifas son sugerencias que precargan los montos al generar obligaciones — quien aprueba siempre puede modificar el monto antes de confirmar.</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px;">
        ${camposConfig(settings)}
      </div>
      <div id="cfg-msg" style="font-size:.85rem; margin-top:14px;"></div>
      ${puedeConfigurarTarifas ? `<button id="cfg-btn-guardar" style="margin-top:8px; background:#00695c; color:white; border:none; padding:12px 24px; border-radius:6px; cursor:pointer; font-weight:700;">💾 Guardar configuración</button>` : '<p style="color:#999; font-size:.85rem;">Tu rol no tiene permiso para modificar la configuración.</p>'}
    `
    if (puedeConfigurarTarifas) {
      document.getElementById('cfg-btn-guardar').addEventListener('click', async () => {
        const msg = document.getElementById('cfg-msg')
        const nuevos = {
          defaultCurrency: document.getElementById('cfg-defaultCurrency').value.trim() || 'PYG',
          mesarioRate: Number(document.getElementById('cfg-mesarioRate').value) || 0,
          driverRate: Number(document.getElementById('cfg-driverRate').value) || 0,
          leaderRate: Number(document.getElementById('cfg-leaderRate').value) || 0,
          weeklyRate: Number(document.getElementById('cfg-weeklyRate').value) || 0,
          monthlyRate: Number(document.getElementById('cfg-monthlyRate').value) || 0,
          electionDayRate: Number(document.getElementById('cfg-electionDayRate').value) || 0,
          fuelAllowance: Number(document.getElementById('cfg-fuelAllowance').value) || 0,
          mealAllowance: Number(document.getElementById('cfg-mealAllowance').value) || 0,
          maxVoterAssistanceAmount: Number(document.getElementById('cfg-maxVoterAssistanceAmount').value) || 0,
          approvalThreshold: Number(document.getElementById('cfg-approvalThreshold').value) || 0
        }
        try {
          await updateFinanceSettings(candidateId, nuevos, user.uid)
          diaDSettingsCache = null
          msg.innerHTML = '<span style="color:#2e7d32;">✅ Configuración guardada.</span>'
        } catch (err) {
          msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
        }
      })
    }
  }

  function camposConfig(settings) {
    const campo = (id, label, value) => `
      <div><label style="font-weight:700; display:block; margin-bottom:4px; font-size:.85rem;">${label}:</label>
        <input id="cfg-${id}" ${id === 'defaultCurrency' ? 'type="text"' : 'type="number"'} value="${value}" ${!puedeConfigurarTarifas ? 'disabled' : ''} style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>`
    return [
      campo('defaultCurrency', 'Moneda por defecto', settings.defaultCurrency),
      campo('mesarioRate', 'Monto por mesario', settings.mesarioRate),
      campo('driverRate', 'Monto por chofer', settings.driverRate),
      campo('leaderRate', 'Monto por dirigente', settings.leaderRate),
      campo('weeklyRate', 'Monto semanal', settings.weeklyRate),
      campo('monthlyRate', 'Monto mensual', settings.monthlyRate),
      campo('electionDayRate', 'Monto Día D', settings.electionDayRate),
      campo('fuelAllowance', 'Viático combustible', settings.fuelAllowance),
      campo('mealAllowance', 'Viático alimentación', settings.mealAllowance),
      campo('maxVoterAssistanceAmount', 'Ayuda máxima por votante', settings.maxVoterAssistanceAmount),
      campo('approvalThreshold', 'Umbral de aprobación obligatoria', settings.approvalThreshold)
    ].join('')
  }

  // ── COMPROBANTES ──────────────────────────────────────────────────────
  async function pintarComprobantes(body) {
    body.innerHTML = `
      <p style="font-size:.85rem; color:#555; margin-bottom:14px;">Los comprobantes se adjuntan directamente desde cada fila de la pestaña <strong>💳 Pagos</strong> (ícono 📎) — quedan guardados en Firebase Storage con su metadata acá.</p>
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px;">
        💡 Formatos permitidos: JPG, PNG, WEBP o PDF — hasta 10 MB. Si el proyecto todavía no tiene Firebase Storage habilitado desde la consola, la subida va a fallar con un aviso claro hasta que se active.
      </p>
    `
  }

  // ── MODAL: NUEVA OBLIGACIÓN ──────────────────────────────────────────
  async function mostrarModalNuevaObligacion() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 560px; width: 100%; padding: 24px; margin: 20px auto;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #00695c;">➕ NUEVA OBLIGACIÓN</h2>
        <div style="display:grid; gap:12px;">
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Tipo de beneficiario:</label>
            <select id="fo-tipo" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
              ${FINANCE_BENEFICIARY_TYPES.map(v => `<option value="${v}">${BENEFICIARY_LABELS[v]}</option>`).join('')}
            </select>
          </div>
          <div id="fo-beneficiario-picker"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Nombre del beneficiario:</label>
            <input id="fo-nombre" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">CI/Documento:</label>
              <input id="fo-doc" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Teléfono:</label>
              <input id="fo-tel" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          </div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Concepto:</label>
            <input id="fo-concepto" type="text" placeholder="Ej: Viático Día D, pago semanal, ayuda transporte..." style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Descripción (opcional):</label>
            <textarea id="fo-desc" rows="2" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; font-family:inherit;"></textarea></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Monto:</label>
              <input id="fo-monto" type="number" min="0" step="1000" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-weight:700; display:block; margin-bottom:4px;">Moneda:</label>
              <input id="fo-moneda" type="text" value="PYG" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          </div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Frecuencia:</label>
            <select id="fo-frecuencia" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
              ${FINANCE_FREQUENCIES.map(v => `<option value="${v}">${FREQUENCY_LABELS[v]}</option>`).join('')}
            </select></div>
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">Fecha de vencimiento (opcional):</label>
            <input id="fo-vencimiento" type="date" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;"></div>
          <div id="fo-msg" style="font-size:.85rem;"></div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="fo-btn-borrador" style="flex:1; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">📝 Guardar borrador</button>
            <button id="fo-btn-enviar" style="flex:1; background:#00695c; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">📨 Enviar a aprobación</button>
            <button id="fo-btn-cancelar" style="flex:1; background:#ccc; color:#333; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cancelar</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    let beneficiarySelection = { beneficiaryUserId: null, beneficiaryVoterId: null, relatedDriverId: null, relatedTableUserId: null, relatedLeaderId: null, relatedVoterId: null }

    async function pintarPicker() {
      const tipo = modal.querySelector('#fo-tipo').value
      const picker = modal.querySelector('#fo-beneficiario-picker')
      beneficiarySelection = { beneficiaryUserId: null, beneficiaryVoterId: null, relatedDriverId: null, relatedTableUserId: null, relatedLeaderId: null, relatedVoterId: null }

      if (tipo === 'proveedor' || tipo === 'otro') {
        picker.innerHTML = `<p style="font-size:.78rem; color:#666; margin:0;">Completá nombre/CI/teléfono manualmente abajo.</p>`
        return
      }
      if (tipo === 'votante') {
        picker.innerHTML = `
          <div><label style="font-weight:700; display:block; margin-bottom:4px;">CI del votante (ayuda):</label>
            <input id="fo-ci-votante" type="text" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
            <div id="fo-ci-votante-msg" style="font-size:.78rem; color:#666; margin-top:4px;"></div>
          </div>`
        modal.querySelector('#fo-ci-votante').addEventListener('blur', async () => {
          const ci = modal.querySelector('#fo-ci-votante').value.trim()
          const msgEl = modal.querySelector('#fo-ci-votante-msg')
          if (!ci) return
          msgEl.textContent = '🔎 Buscando...'
          const registro = await getRecordByCedula(candidateId, ci)
          if (registro) {
            beneficiarySelection.relatedVoterId = registro.id
            beneficiarySelection.beneficiaryVoterId = registro.id
            modal.querySelector('#fo-nombre').value = registro.nombre || ''
            modal.querySelector('#fo-doc').value = ci
            modal.querySelector('#fo-tel').value = registro.telefono || ''
            msgEl.textContent = '✅ Encontrado en Registros.'
            return
          }
          const enPadron = await searchVoterByCedula(ci)
          if (enPadron.length > 0) {
            modal.querySelector('#fo-nombre').value = enPadron[0].nombre || ''
            modal.querySelector('#fo-doc').value = ci
            msgEl.textContent = '✅ Encontrado en el padrón (sin registro propio todavía).'
            return
          }
          msgEl.textContent = '❌ No se encontró esa CI.'
        })
        return
      }

      picker.innerHTML = `<p style="font-size:.78rem; color:#666;">Cargando lista...</p>`
      let opciones = []
      if (tipo === 'mesario') opciones = (await getMesarios(candidateId)).map(m => ({ id: m.id, nombre: m.nombre, doc: m.ci, tel: m.telefono }))
      else if (tipo === 'chofer') opciones = (await getDrivers(candidateId)).map(d => ({ id: d.id, nombre: d.nombre, doc: d.cedula, tel: d.telefono }))
      else if (tipo === 'dirigente') opciones = (await getAllCandidateUsers(candidateId)).filter(u => u.role === 'dirigente').map(u => ({ id: u.id, nombre: u.nombre || u.email, doc: u.cedula, tel: u.telefono }))
      else if (tipo === 'operador') opciones = (await getAllCandidateUsers(candidateId)).filter(u => u.role === 'operador').map(u => ({ id: u.id, nombre: u.nombre || u.email, doc: u.cedula, tel: u.telefono }))

      picker.innerHTML = `
        <div><label style="font-weight:700; display:block; margin-bottom:4px;">Elegir ${BENEFICIARY_LABELS[tipo]}:</label>
          <select id="fo-sel-beneficiario" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">-- Elegí --</option>
            ${opciones.map(o => `<option value="${o.id}">${escapeHtml(o.nombre || '(sin nombre)')}</option>`).join('')}
          </select>
        </div>`
      modal.querySelector('#fo-sel-beneficiario').addEventListener('change', (e) => {
        const sel = opciones.find(o => o.id === e.target.value)
        if (!sel) return
        modal.querySelector('#fo-nombre').value = sel.nombre || ''
        modal.querySelector('#fo-doc').value = sel.doc || ''
        modal.querySelector('#fo-tel').value = sel.tel || ''
        if (tipo === 'chofer') beneficiarySelection.relatedDriverId = sel.id
        if (tipo === 'mesario') beneficiarySelection.relatedTableUserId = sel.id
        if (tipo === 'dirigente') { beneficiarySelection.relatedLeaderId = sel.id; beneficiarySelection.beneficiaryUserId = sel.id }
        if (tipo === 'operador') beneficiarySelection.beneficiaryUserId = sel.id
      })
    }

    modal.querySelector('#fo-tipo').addEventListener('change', pintarPicker)
    await pintarPicker()

    async function guardar(status) {
      const tipo = modal.querySelector('#fo-tipo').value
      const nombre = modal.querySelector('#fo-nombre').value.trim()
      const monto = Number(modal.querySelector('#fo-monto').value)
      const msg = modal.querySelector('#fo-msg')
      if (!nombre || !monto) { msg.innerHTML = '<span style="color:#c62828;">Nombre y monto son obligatorios.</span>'; return }

      msg.textContent = 'Guardando...'
      try {
        await createFinanceObligation(candidateId, {
          beneficiaryType: tipo,
          beneficiaryName: nombre,
          beneficiaryDocument: modal.querySelector('#fo-doc').value.trim(),
          beneficiaryPhone: modal.querySelector('#fo-tel').value.trim(),
          beneficiaryRole: tipo,
          concept: modal.querySelector('#fo-concepto').value.trim(),
          description: modal.querySelector('#fo-desc').value.trim(),
          amount: monto,
          currency: modal.querySelector('#fo-moneda').value.trim() || 'PYG',
          frequency: modal.querySelector('#fo-frecuencia').value,
          dueDate: modal.querySelector('#fo-vencimiento').value || null,
          relatedModule: 'finanzas',
          status,
          ...beneficiarySelection
        }, user.uid, myRole)
        modal.remove()
        await cargarObligaciones(true)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    }

    modal.querySelector('#fo-btn-borrador').addEventListener('click', () => guardar('draft'))
    modal.querySelector('#fo-btn-enviar').addEventListener('click', () => guardar('pending'))
    modal.querySelector('#fo-btn-cancelar').addEventListener('click', () => modal.remove())
  }

  render()
}
