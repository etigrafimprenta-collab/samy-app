/**
 * REPORTES > REGISTROS — tabla paginada con un filtro real (por dirigente/
 * local/seccional/mesa), exportable. Distinto de la pestaña "Registros"
 * (que solo busca por cédula/nombre sobre lo ya cargado).
 */
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { listRecordsPageFiltered, listCandidateUsersPage } from '../lib/firebaseCandidate.js'

const EJES = [
  { id: '', label: 'Sin filtro (más recientes)' },
  { id: 'uid', label: 'Dirigente' },
  { id: 'local', label: 'Zona / Barrio (Local de votación)' },
  { id: 'seccional', label: 'Seccional' },
  { id: 'mesa', label: 'Mesa' }
]

const MAX_PAGINAS_ROSTER = 10 // mismo tope de seguridad que Reportes > Equipo

async function cargarRoster(candidateId) {
  let equipo = []
  let cursor = null
  for (let i = 0; i < MAX_PAGINAS_ROSTER; i++) {
    const { users, lastDoc, hasMore } = await listCandidateUsersPage(candidateId, { cursor, pageSize: 100 })
    equipo = [...equipo, ...users]
    cursor = lastDoc
    if (!hasMore) break
  }
  return equipo
}

export async function renderReporteRegistros(body, candidateId) {
  let eje = ''
  let valor = ''
  let textoDireccion = ''
  let registros = []
  let cursor = null
  let usuarios = []

  body.innerHTML = '<div style="color:#999;">Cargando...</div>'
  try {
    usuarios = await cargarRoster(candidateId)
  } catch (err) {
    // Si el rol no puede listar usuarios (ver firestore.rules), el filtro
    // por dirigente simplemente no muestra nombres — no rompe el resto.
    usuarios = []
  }
  const nombreUsuario = (uid) => usuarios.find(u => u.id === uid)?.nombre || usuarios.find(u => u.id === uid)?.email || uid

  pintarShell()
  await cargar(true)

  function pintarShell() {
    body.innerHTML = `
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 14px;">
        💡 "Zona/Barrio" se gestiona en este sistema como <strong>Local de votación</strong> — no existe un campo separado. La búsqueda por dirección busca solo dentro de lo ya filtrado abajo, no en toda la base.
      </p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <select id="rr-eje" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          ${EJES.map(e => `<option value="${e.id}">${e.label}</option>`).join('')}
        </select>
        <input id="rr-valor" placeholder="Valor a filtrar (uid de dirigente, nombre de local, seccional o mesa)" style="flex:1; min-width:220px; padding:8px; border:1px solid #ccc; border-radius:4px;" ${eje ? '' : 'disabled'}>
        <button id="rr-btn-filtrar" style="background:#283593; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;" ${eje ? '' : 'disabled'}>Filtrar</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:14px;">
        <input id="rr-direccion" placeholder="Buscar por dirección (dentro de lo ya filtrado)..." style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
        <button id="rr-btn-export" style="background:#455a64; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:700;">⬇️ Exportar Excel</button>
      </div>
      <div id="rr-lista"></div>
      <div style="text-align:center; margin-top:12px;"><button id="rr-btn-mas" style="display:none; background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Cargar más</button></div>
    `
    document.getElementById('rr-eje').addEventListener('change', e => {
      eje = e.target.value
      document.getElementById('rr-valor').disabled = !eje
      document.getElementById('rr-btn-filtrar').disabled = !eje
    })
    document.getElementById('rr-btn-filtrar').addEventListener('click', () => {
      const v = document.getElementById('rr-valor').value.trim()
      if (!v) { alert('Escribí un valor para filtrar.'); return }
      valor = v
      cargar(true)
    })
    document.getElementById('rr-direccion').addEventListener('input', debounce(e => { textoDireccion = e.target.value.trim().toLowerCase(); pintarLista() }, 250))
    document.getElementById('rr-btn-export').addEventListener('click', exportar)
  }

  async function cargar(reset) {
    if (reset) { registros = []; cursor = null }
    const listaEl = document.getElementById('rr-lista')
    if (reset) listaEl.innerHTML = '<div style="color:#999; padding:16px;">Cargando...</div>'
    try {
      const { records, lastDoc, hasMore } = await listRecordsPageFiltered(candidateId, { by: eje || null, value: eje ? valor : null, cursor, pageSize: 50 })
      registros = reset ? records : [...registros, ...records]
      cursor = lastDoc
      pintarLista()
      const btnMas = document.getElementById('rr-btn-mas')
      btnMas.style.display = hasMore ? 'inline-block' : 'none'
      btnMas.onclick = () => cargar(false)
    } catch (err) {
      listaEl.innerHTML = `<div style="color:#c62828; padding:16px;">Error: ${escapeHtml(err.message)}</div>`
    }
  }

  function filtrados() {
    if (!textoDireccion) return registros
    return registros.filter(r => String(r.direccion || '').toLowerCase().includes(textoDireccion))
  }

  function pintarLista() {
    const listaEl = document.getElementById('rr-lista')
    const items = filtrados()
    if (items.length === 0) {
      listaEl.innerHTML = '<div style="color:#999; padding:16px; text-align:center;">Sin resultados.</div>'
      return
    }
    listaEl.innerHTML = `
      <div style="font-size:.82rem; color:#666; margin-bottom:8px;"><strong>${items.length}</strong> registro${items.length === 1 ? '' : 's'} cargado${items.length === 1 ? '' : 's'}${textoDireccion ? ' (filtrado por dirección)' : ''}</div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem;">
          <thead><tr style="text-align:left; border-bottom:2px solid #eee;"><th style="padding:6px;">Nombre</th><th>Cédula</th><th>Teléfono</th><th>Dirección</th><th>Local</th><th>Mesa</th><th>Dirigente</th></tr></thead>
          <tbody>${items.map(r => `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px;">${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.cedula)}</td><td>${escapeHtml(r.telefono) || '—'}</td>
            <td>${escapeHtml(r.direccion) || '—'}</td><td>${escapeHtml(r.local) || '—'}</td><td>${escapeHtml(r.mesa) || '—'}</td>
            <td>${escapeHtml(nombreUsuario(r.uid))}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `
  }

  function exportar() {
    const items = filtrados()
    exportGenericToExcel(
      items.map(r => ({ Nombre: r.nombre, Cédula: r.cedula, Teléfono: r.telefono || '', Dirección: r.direccion || '', Local: r.local || '', Seccional: r.seccional || '', Mesa: r.mesa || '', Dirigente: nombreUsuario(r.uid) })),
      `reporte_registros_${candidateId}.xlsx`, 'Registros'
    )
  }
}
