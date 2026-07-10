import { getUserRecords, deleteRecord, updateRecord } from '../lib/firebase.js'
import { shareWhatsAppDirect } from '../lib/whatsapp.js'
import { debounce } from '../lib/debounce.js'

const MIN_SEARCH_CHARS = 3

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
        <input id="filter-inp" type="text" placeholder="🔍 Buscar por nombre, cédula, seccional..." value="" 
          style="
            flex:1 !important; 
            min-width:250px !important; 
            padding:10px 12px !important; 
            border-radius:6px !important; 
            border: 2px solid #999 !important; 
            font-size: 0.95rem !important; 
            box-sizing: border-box !important; 
            background: white !important; 
            color: #333 !important;
            -webkit-text-fill-color: #333 !important;
            opacity: 1 !important;
          " />
        <button id="btn-export" style="padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; background: #d4af37; color: black;">📥 Exportar a Excel</button>
      </div>
    `

    // Agregar CSS para placeholder
    const style = document.createElement('style')
    style.textContent = `
      #filter-inp::placeholder {
        color: #999 !important;
        opacity: 1 !important;
        -webkit-text-fill-color: #999 !important;
      }
      #filter-inp {
        color: #333 !important;
        -webkit-text-fill-color: #333 !important;
      }
    `
    document.head.appendChild(style)

    // EVENT LISTENERS DEL INPUT
    const filterInput = container.querySelector('#filter-inp')
    const btnExport = container.querySelector('#btn-export')

    if (filterInput) {
      filterInput.addEventListener('input', debounce((e) => {
        const term = e.target.value.toLowerCase().trim()
        if (!term) {
          renderRecords(records)
        } else if (term.length < MIN_SEARCH_CHARS) {
          // Esperar a que haya al menos 3 caracteres evita reconstruir la
          // lista completa en cada tecla para búsquedas casi vacías.
          return
        } else {
          const filtered = records.filter(r =>
            r.nombre.toLowerCase().includes(term) ||
            r.cedula.toLowerCase().includes(term) ||
            (r.seccional && r.seccional.toLowerCase().includes(term))
          )
          renderRecords(filtered)
        }
      }, 250))
    }

    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        // xlsx pesa ~1MB — se carga solo cuando de verdad se exporta, no
        // en el bundle inicial de todo usuario logueado (auditoría IV.5).
        const { exportToExcel } = await import('../lib/excel.js')
        exportToExcel(records, `mis_registros_samy_${Date.now()}.xlsx`)
      })
    }
  }

  // RENDERIZAR REGISTROS
function openEditModal(record) {
  const modalEl = container.querySelector('#modal-edit') || createModalContainer()
  
  modalEl.innerHTML = `
    <div class="modal-overlay" id="overlay-edit">
      <div class="modal">
        <div class="modal-title">✏️ Editar Registro</div>
        <div style="font-weight:700;margin-bottom:2px;">${record.nombre}</div>
        <div style="font-size:0.85rem;color:var(--gris-texto);margin-bottom:18px;">
          CI ${record.cedula} · Seccional ${record.seccional}
        </div>
        <div id="modal-alert-edit"></div>

        <div class="form-group">
          <label class="form-label">Teléfono</label>
          <input class="form-input" id="inp-tel-edit" type="text" placeholder="Ej: 981107497" value="${record.telefono || ''}" maxlength="20" style="width:100%;" />
          <div style="font-size:0.8rem; color:#999; margin-top:4px;">Solo números, sin espacios ni símbolos</div>
        </div>

        <div class="form-group">
          <label class="form-label">Nota</label>
          <input class="form-input" id="inp-nota-edit" type="text" placeholder="Ej: vecino de la cuadra..." value="${record.nota || ''}" />
        </div>

        <div class="form-group">
          <label class="form-label">¿Necesita Transporte?</label>
          <select class="form-input" id="sel-transporte-edit">
            <option value="">— Sin especificar —</option>
            <option value="Sí" ${record.transporte === 'Sí' ? 'selected' : ''}>Sí, necesita transporte</option>
            <option value="No" ${record.transporte === 'No' ? 'selected' : ''}>No necesita transporte</option>
          </select>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" id="btn-save-edit" style="flex:1;">Guardar Cambios</button>
          <button class="btn btn-outline" id="btn-cancel-edit" style="flex:1;">Cancelar</button>
        </div>
      </div>
    </div>
  `

  modalEl.querySelector('#btn-cancel-edit').addEventListener('click', closeEditModal)
  modalEl.querySelector('#overlay-edit').addEventListener('click', (e) => {
    if (e.target.id === 'overlay-edit') closeEditModal()
  })
  modalEl.querySelector('#btn-save-edit').addEventListener('click', () => doSaveEdit(record.id))
}

function createModalContainer() {
  const el = document.createElement('div')
  el.id = 'modal-edit'
  container.appendChild(el)
  return el
}

function closeEditModal() {
  const modalEl = container.querySelector('#modal-edit')
  if (modalEl) modalEl.innerHTML = ''
}

async function doSaveEdit(recordId) {
  let telInput = container.querySelector('#inp-tel-edit').value.trim()
  let telefono = telInput.replace('+595', '').replace(/\D/g, '')
  const nota = container.querySelector('#inp-nota-edit').value.trim()
  const transporte = container.querySelector('#sel-transporte-edit').value
  const alertEl = container.querySelector('#modal-alert-edit')
  const btn = container.querySelector('#btn-save-edit')

  btn.disabled = true
  btn.textContent = 'Guardando...'

  try {
    await updateRecord(recordId, {
      telefono: telefono || '',
      nota: nota || '',
      transporte: transporte || 'No especificado'
    })

    closeEditModal()
    records = await getUserRecords(user.uid)
    renderRecords(records)

    const banner = document.createElement('div')
    banner.className = 'alert alert-success'
    banner.textContent = '✅ Registro actualizado correctamente.'
    container.querySelector('#records-list').insertBefore(banner, container.querySelector('#records-list').firstChild)
    setTimeout(() => banner.remove(), 3000)

  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`
    btn.disabled = false
    btn.textContent = 'Guardar Cambios'
  }
}
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
            <button class="btn btn-primary btn-sm btn-edit" data-id="${r.id}" title="Editar registro">✏️</button>
            <button class="btn btn-green btn-sm btn-wa" data-tel="${r.telefono}" data-idx="${i}" title="Enviar WhatsApp" ${!r.telefono ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>📲</button>
            <button class="btn btn-danger btn-sm btn-del" data-id="${r.id}" title="Eliminar">🗑️</button>
          </div>
        </div>
      `).join('')
    }

    recordsList.innerHTML = html

    // BOTONES DE ACCIONES
    recordsList.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const recordId = btn.dataset.id
        const record = displayRecords.find(r => r.id === recordId)
        if (record) openEditModal(record)
      })
    })
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