import { getUserRecords, deleteRecord } from '../lib/firebase.js'
import { exportToExcel } from '../lib/excel.js'
import { shareWhatsAppDirect } from '../lib/whatsapp.js'

export async function renderMyRecords(container, user) {
  container.innerHTML = '<div class="loader"><div class="spinner"></div> Cargando registros...</div>'

  let records = []
  try {
    records = await getUserRecords(user.uid)
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Error al cargar: ${err.message}</div>`
    return
  }

  // Estructura inicial
  container.innerHTML = `
    <div class="records-section">
      <h2>📋 Mis Registros
        <span style="font-family:Barlow;font-size:1rem;color:var(--gris-texto);font-weight:400;" id="counter">(${records.length}/${records.length})</span>
      </h2>
      <div id="search-box"></div>
      <div id="records-list"></div>
    </div>
  `

  // INPUT DE BÚSQUEDA - SEPARADO
  const searchBox = container.querySelector('#search-box')
  if (records.length > 0 && searchBox) {
    searchBox.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center;">
        <input id="filter-inp" type="text" placeholder="🔍 Buscar por nombre, cédula, seccional..." style="flex:1; min-width:250px; padding:10px 12px; border-radius:6px; border: 2px solid #999; font-size: 0.95rem; box-sizing: border-box; background: white;" />
        <button id="btn-export" style="padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; background: #d4af37; color: black;">📥 Exportar a Excel</button>
      </div>
    `

    // EVENT LISTENERS DEL INPUT
    const filterInput = container.querySelector('#filter-inp')
    const btnExport = container.querySelector('#btn-export')

    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim()
        if (!term) {
          renderRecords(records)
        } else {
          const filtered = records.filter(r =>
            r.nombre.toLowerCase().includes(term) ||
            r.cedula.toLowerCase().includes(term) ||
            (r.seccional && r.seccional.toLowerCase().includes(term))
          )
          renderRecords(filtered)
        }
      })
    }

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        exportToExcel(records, `mis_registros_samy_${Date.now()}.xlsx`)
      })
    }
  }

  // RENDERIZAR REGISTROS
  function renderRecords(displayRecords) {
    const recordsList = container.querySelector('#records-list')
    const counter = container.querySelector('#counter')

    if (counter) {
      counter.textContent = `(${displayRecords.length}/${records.length})`
    }

    if (!recordsList) return

    let html = ''

    if (displayRecords.length === 0 && records.length === 0) {
      html = `
        <div class="records-empty">
          <div style="font-size:3rem;margin-bottom:10px;">📋</div>
          <div style="font-weight:700;margin-bottom:6px;">Sin registros aún</div>
          <div style="font-size:0.9rem;">Buscá afiliados en el padrón y guardalos aquí.</div>
        </div>
      `
    } else if (displayRecords.length === 0 && records.length > 0) {
      html = `
        <div class="card" style="text-align:center; padding:32px;">
          <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
          <div style="font-weight:700; margin-bottom:4px;">Sin resultados</div>
          <div style="font-size:0.9rem; color:var(--gris-texto);">
            No se encontró ningún registro con ese término de búsqueda.
          </div>
        </div>
      `
    } else {
      html = displayRecords.map((r, i) => `
        <div class="record-item" id="rec-${r.id}">
          <div class="record-info">
            <div class="record-nombre">${r.nombre}</div>
            <div class="record-detail">CI ${r.cedula} · Seccional ${r.seccional}</div>
            <div class="record-detail">📍 ${r.direccion}</div>
            ${r.local ? `<div class="record-detail" style="color:#1d4ed8;font-weight:600;">🏫 ${r.local}</div>` : ''}
            ${(r.mesa || r.orden) ? `
              <div class="record-detail">
                ${r.mesa ? `Mesa: <strong>${r.mesa}</strong>` : ''}
                ${r.mesa && r.orden ? ' · ' : ''}
                ${r.orden ? `Orden: <strong>${r.orden}</strong>` : ''}
              </div>` : ''}
            <div class="record-phone">📞 ${r.telefono || 'Sin teléfono'}</div>
            ${r.nota ? `<div class="record-detail" style="margin-top:2px;">💬 ${r.nota}</div>` : ''}
            <div class="record-detail" style="font-size:0.75rem;margin-top:4px;color:#aaa;">
              ${r.savedAt?.toDate ? r.savedAt.toDate().toLocaleString('es-PY') : ''}
            </div>
          </div>
          <div class="record-actions">
            <button class="btn btn-green btn-sm btn-wa" data-tel="${r.telefono}" data-idx="${i}" title="Enviar WhatsApp" ${!r.telefono ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>📲</button>
            <button class="btn btn-danger btn-sm btn-del" data-id="${r.id}" title="Eliminar">🗑️</button>
          </div>
        </div>
      `).join('')
    }

    recordsList.innerHTML = html

    // BOTONES DE ACCIONES
    recordsList.querySelectorAll('.btn-wa').forEach(btn => {
      btn.addEventListener('click', () => {
        let telefono = btn.dataset.tel
        if (!telefono || telefono === '') {
          alert('Este registro no tiene teléfono. Por favor, agrega uno.')
          return
        }
        
        // Normalizar teléfono
        telefono = telefono.replace(/^\+595/, '').replace(/^595/, '')
        
        const idx = parseInt(btn.dataset.idx)
        const record = displayRecords[idx]
        shareWhatsAppDirect(telefono, record)
      })
    })

    recordsList.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este registro?')) return
        try {
          await deleteRecord(btn.dataset.id)
          records = records.filter(r => r.id !== btn.dataset.id)
          renderRecords(records)
        } catch (err) { alert('Error: ' + err.message) }
      })
    })
  }

  // RENDER INICIAL
  renderRecords(records)
}