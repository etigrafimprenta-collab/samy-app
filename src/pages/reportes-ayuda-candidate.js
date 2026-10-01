/**
 * REPORTES > AYUDAS — consolidado de "Ayuda Gs." por dirigente.
 *
 * Etapa 1 (solo consulta/agregación, sin escritura): usa
 * getAyudaGsSummary (firebaseCandidate.js), que pagina savedRecords/users
 * del candidato — nunca getAllRecords/getAllCandidateUsers sin acotar.
 *
 * Mantiene SIEMPRE separados "necesita ayuda" (needsAssistance, una
 * necesidad marcada por el dirigente) de "monto cuantificado"
 * (montoAyuda>0) — nunca se asume que el primero implica el segundo.
 * Esto es deliberadamente el único eslabón implementado hoy de la futura
 * cadena Necesita ayuda → Monto solicitado → Monto aprobado → Pagado; no
 * hay aprobación ni pago, y esto NO toca Cajeros DD ni Finanzas.
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { getAyudaGsSummary } from '../lib/firebaseCandidate.js'
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

// Guard de concurrencia — ACOTADO a este módulo, no toca los demás tabs
// de Reportes. renderReporteAyuda puede invocarse de nuevo (doble clic en
// el sub-tab, o un cambio de candidato que vuelve a montar este mismo
// cuerpo) mientras el fetch anterior todavía está en vuelo — sin esto, si
// la respuesta VIEJA llega después que la nueva, pisaría la pantalla con
// datos de una carga/candidato anterior. `renderToken` identifica la
// corrida más reciente; cualquier corrida vieja que resuelva después
// simplemente no pinta nada (ver los 2 chequeos `myToken !== renderToken`
// abajo, antes de cada escritura a `body.innerHTML`).
let renderToken = 0

export async function renderReporteAyuda(body, candidateId) {
  const myToken = ++renderToken
  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  let data
  try {
    data = await getAyudaGsSummary(candidateId)
  } catch (err) {
    if (myToken !== renderToken) return // una corrida más nueva ya tomó el control — no pisar esa pantalla con este error viejo
    body.innerHTML = `<div style="color:#c62828; padding:20px;">Error cargando el resumen de ayudas: ${escapeHtml(err.message)}</div>`
    return
  }
  if (myToken !== renderToken) return // idem — esta respuesta quedó obsoleta mientras esperábamos

  const { resumen, porDirigente, registrosConAyuda } = data

  body.innerHTML = `
    <p style="font-size:.82rem; color:#666; background:#eef3f8; border-left:4px solid #1f4b7a; padding:8px 10px; border-radius:4px; margin:0 0 16px;">
      ℹ️ "Ayuda solicitada" es exclusivamente la suma de <code>montoAyuda</code> cargada por los dirigentes al registrar al votante — no es un monto aprobado ni pagado. No está conectado con Cajeros Día D ni con Obligaciones/Finanzas.
    </p>
    <div class="stats-grid" style="margin-bottom:10px;">
      ${statCard('Votantes registrados', resumen.totalRegistrados, '#1f4b7a')}
      ${statCard('Necesitan ayuda', resumen.necesitanAyuda, '#6a1b9a')}
      ${statCard('Con monto definido', resumen.conMonto, '#2e7d32')}
      ${statCard('Sin monto definido', resumen.sinMonto, '#e65100')}
    </div>
    <div class="stats-grid" style="margin-bottom:20px;">
      ${statCard('Monto total solicitado', money(resumen.montoTotal), '#c62828')}
      ${statCard('Promedio de ayuda cuantificada', money(resumen.promedioConMonto), '#c62828')}
    </div>
    ${resumen.sinMonto > 0 ? `
    <p style="font-size:.82rem; color:#8a6400; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 20px;">
      ⚠ Hay ${resumen.sinMonto} votante(s) marcado(s) "necesita ayuda" sin un monto cargado todavía — no están incluidos en el monto total ni en el promedio, pero sí en "Necesitan ayuda".
    </p>` : ''}

    <h3 style="margin:0 0 10px; font-size:1rem;">Consolidado por dirigente</h3>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:.83rem;">
        <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
          <th style="padding:6px;">Dirigente</th><th>Registrados</th><th>Necesitan ayuda</th><th>Con monto</th><th>Sin monto</th><th>Total solicitado</th>
        </tr></thead>
        <tbody>
          ${porDirigente.map((d, i) => `
            <tr class="rep-ayuda-row" data-idx="${i}" style="border-bottom:1px solid #eee; cursor:pointer;" title="Ver votantes">
              <td style="padding:6px;">${escapeHtml(d.nombre)}${ESTADO_LABEL[d.estado] ? ` <span style="color:#e65100; font-size:.72rem;">${ESTADO_LABEL[d.estado]}</span>` : ''}</td>
              <td>${d.registrados}</td>
              <td>${d.necesitanAyuda}</td>
              <td>${d.conMonto}</td>
              <td>${d.sinMonto}</td>
              <td><strong>${money(d.totalSolicitado)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div id="rep-ayuda-drilldown"></div>
  `

  body.querySelectorAll('.rep-ayuda-row').forEach(row => {
    row.addEventListener('click', () => {
      const d = porDirigente[Number(row.dataset.idx)]
      if (d.necesitanAyuda === 0) return // nada para mostrar
      mostrarDrilldown(d, registrosConAyuda.filter(r => r.groupKey === d.uid))
    })
  })

  function mostrarDrilldown(dirigente, registros) {
    const el = document.getElementById('rep-ayuda-drilldown')
    // Para el grupo fusionado "no disponible" (varios uid fantasma
    // distintos agrupados en una sola fila), se agrega una columna con el
    // uid ORIGINAL de cada registro — pedido explícito: conservar el uid
    // para auditoría aunque ya no resuelva a ningún usuario.
    const mostrarUidPorFila = dirigente.estado === 'no-disponible'
    el.innerHTML = `
      <div style="border:2px solid #6a1b9a; border-radius:8px; padding:16px; margin-top:16px;">
        <h4 style="margin:0 0 10px;">🧑‍🤝‍🧑 Votantes de ${escapeHtml(dirigente.nombre)} que necesitan ayuda (${registros.length})</h4>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
            <thead><tr style="text-align:left; border-bottom:2px solid #eee;">
              <th style="padding:6px;">Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Orden</th><th>Teléfono</th><th>Monto</th>${mostrarUidPorFila ? '<th>uid original</th>' : ''}
            </tr></thead>
            <tbody>
              ${registros.map(r => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:6px; font-family:monospace;">${escapeHtml(r.cedula)}</td>
                  <td>${escapeHtml(r.nombre)}</td>
                  <td>${escapeHtml(r.local)}</td>
                  <td>${escapeHtml(r.mesa)}</td>
                  <td>${escapeHtml(r.orden)}</td>
                  <td>${escapeHtml(r.telefono)}</td>
                  <td>${r.montoAyuda > 0 ? money(r.montoAyuda) : '<span style="color:#e65100; font-weight:700;">⚠ Pendiente de definir monto</span>'}</td>
                  ${mostrarUidPorFila ? `<td style="font-family:monospace; font-size:.72rem; color:#999;">${escapeHtml(r.uid || '')}</td>` : ''}
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr><td colspan="${mostrarUidPorFila ? 8 : 7}" style="padding-top:10px; font-size:.83rem;">
                Necesitan ayuda: <strong>${dirigente.necesitanAyuda}</strong> ·
                Con monto: <strong>${dirigente.conMonto}</strong> ·
                Pendientes de cuantificar: <strong>${dirigente.sinMonto}</strong> ·
                TOTAL SOLICITADO: <strong>${money(dirigente.totalSolicitado)}</strong>
                ${dirigente.estado === 'ok' ? `<br><span style="color:#999; font-size:.72rem;">uid: ${escapeHtml(dirigente.uid)}</span>` : ''}
              </td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    `
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}
