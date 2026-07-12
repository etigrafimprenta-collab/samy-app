/**
 * REPORTES > FINANZAS — todo con count()/sum() ya existentes en
 * firebaseCandidate.js (sección "Reportes (Etapa 3)" de ese archivo,
 * agregada junto con las Etapas 1-4 de Finanzas). No se reusan
 * getDiaDValidationForDrivers/Mesarios/Dirigentes ni
 * getVotersNeedingAssistanceForFinance: internamente llaman
 * getAllElectionDayControl sin acotar.
 *
 * Solo visible para campaign_admin/auditor (ver reportes-candidate.js,
 * TABS.finanzas.roles) — ninguna colección de Finanzas permite lectura a
 * coordinator en firestore.rules.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { exportGenericToExcel, exportGenericToCsv } from '../lib/excel.js'
import {
  getFinanceSummary,
  getFinancePaymentsSumByMethod,
  getFinancePaymentsWithoutReceiptCount,
  getCashAccounts,
  getCashAccountBalance,
  getPaymentBatchesPage,
  FINANCE_PAYMENT_METHODS
} from '../lib/firebaseCandidate.js'
import { money, PAYMENT_METHOD_LABELS, BATCH_STATUS_LABELS } from './finanzas-candidate.js'

const statCard = (label, value, color) => `
  <div style="background:white; border:1px solid #ddd; border-left:4px solid ${color}; border-radius:8px; padding:14px;">
    <div style="font-size:1.4rem; font-weight:800; color:${color};">${value}</div>
    <div style="font-size:.72rem; font-weight:700; color:#666; text-transform:uppercase;">${label}</div>
  </div>`

const exportButtons = (id) => `
  <button id="${id}-xlsx" style="background:#455a64; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem; margin-right:6px;">⬇️ Excel</button>
  <button id="${id}-csv" style="background:#607d8b; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:.78rem;">⬇️ CSV</button>`

function wireExport(id, rows, filenameBase, sheetName) {
  const xlsx = document.getElementById(`${id}-xlsx`)
  const csv = document.getElementById(`${id}-csv`)
  if (xlsx) xlsx.addEventListener('click', () => exportGenericToExcel(rows, `${filenameBase}.xlsx`, sheetName))
  if (csv) csv.addEventListener('click', () => exportGenericToCsv(rows, `${filenameBase}.csv`, sheetName))
}

export async function renderReporteFinanzas(body, candidateId) {
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    const [summary, porMetodo, sinComprobante, cuentas, batches] = await Promise.all([
      getFinanceSummary(candidateId),
      Promise.all(FINANCE_PAYMENT_METHODS.map(async m => ({ metodo: m, total: await getFinancePaymentsSumByMethod(candidateId, m) }))),
      getFinancePaymentsWithoutReceiptCount(candidateId),
      getCashAccounts(candidateId),
      getPaymentBatchesPage(candidateId, { pageSize: 10 })
    ])

    const saldos = await Promise.all(cuentas.map(async c => ({ cuenta: c, saldo: await getCashAccountBalance(candidateId, c.id) })))
    const saldoTotal = saldos.reduce((sum, s) => sum + s.saldo, 0)

    body.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:1.05rem;">💰 Resumen de obligaciones</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:24px;">
        ${statCard('Pendientes', `${summary.pendingCount} · ${money(summary.pendingSum)}`, '#f9a825')}
        ${statCard('Aprobadas', `${summary.approvedCount} · ${money(summary.approvedSum)}`, '#1976d2')}
        ${statCard('Pagadas', `${summary.paidCount} · ${money(summary.paidSum)}`, '#2e7d32')}
        ${statCard('Rechazadas', summary.rejectedCount, '#c62828')}
        ${statCard('Especiales Día D', summary.electionDayCount, '#00695c')}
        ${statCard('Pagos sin comprobante', sinComprobante, '#c62828')}
        ${statCard('Saldo total en caja', money(saldoTotal), '#00695c')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">💳 Pagos por método (solo pagados)</h3>
        ${exportButtons('rf-metodo')}
      </div>
      <div style="overflow-x:auto; margin-bottom:24px;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Método</th><th>Total</th></tr></thead>
          <tbody>${porMetodo.map(p => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(PAYMENT_METHOD_LABELS[p.metodo] || p.metodo)}</td><td style="font-weight:700;">${money(p.total)}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🏦 Cuentas de caja</h3>
        ${exportButtons('rf-caja')}
      </div>
      ${saldos.length === 0 ? '<div style="color:#999; padding:20px; text-align:center; margin-bottom:24px;">Todavía no hay cuentas de caja.</div>' : `
        <div style="overflow-x:auto; margin-bottom:24px;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Cuenta</th><th>Saldo</th></tr></thead>
            <tbody>${saldos.map(s => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(s.cuenta.name || '')}</td><td style="font-weight:700;">${money(s.saldo)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      `}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1.05rem;">🧾 Liquidaciones recientes</h3>
        ${exportButtons('rf-batches')}
      </div>
      ${batches.batches.length === 0 ? '<div style="color:#999; padding:20px; text-align:center;">Todavía no hay liquidaciones.</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Liquidación</th><th>Monto</th><th>Estado</th></tr></thead>
            <tbody>${batches.batches.map(b => `<tr style="border-bottom:1px solid #eee;"><td style="padding:6px;">${escapeHtml(b.title || '')}</td><td style="font-weight:700;">${money(b.totalAmount, b.currency)}</td><td>${escapeHtml(BATCH_STATUS_LABELS[b.status] || b.status || '')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      `}
    `

    wireExport('rf-metodo', porMetodo.map(p => ({ Método: PAYMENT_METHOD_LABELS[p.metodo] || p.metodo, Total: p.total })), `reporte_finanzas_metodo_${candidateId}`, 'Por método')
    wireExport('rf-caja', saldos.map(s => ({ Cuenta: s.cuenta.name || '', Saldo: s.saldo })), `reporte_finanzas_caja_${candidateId}`, 'Caja')
    wireExport('rf-batches', batches.batches.map(b => ({ Liquidación: b.title || '', Monto: b.totalAmount, Estado: BATCH_STATUS_LABELS[b.status] || b.status || '' })), `reporte_finanzas_liquidaciones_${candidateId}`, 'Liquidaciones')
  } catch (err) {
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error: ${escapeHtml(err.message)}</div>`
  }
}
