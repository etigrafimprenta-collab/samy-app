import {
  searchByCedula, searchByName, saveRecord
} from '../lib/firebase.js'
import { shareWhatsApp, shareWhatsAppDirect } from '../lib/whatsapp.js'

export function renderSearch(container, user, profile) {
  let mode = 'cedula'
  let results = []
  let saveTarget = null

  container.innerHTML = `
    <div class="search-section">
      <div class="search-title">🔍 Buscar en el Padrón</div>
      <div class="search-tabs">
        <button class="tab-btn active" id="tab-cedula">Por Cédula</button>
        <button class="tab-btn" id="tab-nombre">Por Nombre</button>
      </div>
      <div class="search-input-wrap">
        <input class="search-input" id="search-inp"
          type="text" placeholder="Ingresá la cédula..." autocomplete="off" />
        <button class="btn btn-gold" id="btn-search">BUSCAR</button>
        <button class="btn btn-blue" id="btn-export-excel" title="Exportar resultado a Excel">
          📊 Exportar Excel
        </button>
      </div>
    </div>
    <div id="search-results"></div>
    <div id="save-modal"></div>
  `

  const inp = container.querySelector('#search-inp')
  const resultsEl = container.querySelector('#search-results')
  const modalEl = container.querySelector('#save-modal')
  const exportBtn = container.querySelector('#btn-export-excel')

  container.querySelector('#tab-cedula').addEventListener('click', () => {
    mode = 'cedula'
    container.querySelector('#tab-cedula').classList.add('active')
    container.querySelector('#tab-nombre').classList.remove('active')
    inp.placeholder = 'Ingresá el número de cédula...'
    inp.type = 'number'
    inp.focus()
  })

  container.querySelector('#tab-nombre').addEventListener('click', () => {
    mode = 'nombre'
    container.querySelector('#tab-cedula').classList.remove('active')
    container.querySelector('#tab-nombre').classList.add('active')
    inp.placeholder = 'Ingresá apellido o nombre...'
    inp.type = 'text'
    inp.focus()
  })

  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })
  container.querySelector('#btn-search').addEventListener('click', doSearch)
  exportBtn.addEventListener('click', exportToExcel)

  async function doSearch() {
    const term = inp.value.trim()
    if (!term) return
    resultsEl.innerHTML = '<div class="loader"><div class="spinner"></div> Buscando...</div>'
    try {
      results = mode === 'cedula'
        ? await searchByCedula(term)
        : await searchByName(term)
      renderResults()
    } catch (err) {
      resultsEl.innerHTML = `<div class="alert alert-error">Error al buscar: ${err.message}</div>`
    }
  }

  function renderResults() {
    if (results.length === 0) {
      resultsEl.innerHTML = `
        <div class="card" style="text-align:center; padding:32px;">
          <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
          <div style="font-weight:700; margin-bottom:4px;">Sin resultados</div>
          <div style="font-size:0.9rem; color:var(--gris-texto);">
            No se encontró ningún afiliado con ese ${mode === 'cedula' ? 'número de cédula' : 'nombre'}.
          </div>
        </div>`
      return
    }

    resultsEl.innerHTML = `
      <div style="font-size:0.85rem;color:var(--gris-texto);margin-bottom:12px;font-weight:600;">
        ${results.length} resultado${results.length !== 1 ? 's' : ''} encontrado${results.length !== 1 ? 's' : ''}
      </div>
      ${results.map((v, i) => `
        <div class="voter-card">
          <div class="voter-header">
            <div class="voter-cedula">CI ${v.cedula}</div>
            <div class="voter-seccional">Seccional ${v.seccional}</div>
          </div>
          <div class="voter-body">
            <div class="voter-nombre">${v.nombre}</div>

            <div class="voter-info-grid">
              <div class="info-item">
                <span class="info-label">📍 Dirección</span>
                <span class="info-value">${v.direccion || '—'}</span>
              </div>
              ${v.local ? `
              <div class="info-item info-highlight">
                <span class="info-label">🏫 Local de Votación</span>
                <span class="info-value">${v.local}</span>
              </div>` : ''}
              <div class="info-row-3">
                ${v.mesa ? `
                <div class="info-chip">
                  <span class="chip-label">Mesa</span>
                  <span class="chip-val">${v.mesa}</span>
                </div>` : ''}
                ${v.orden ? `
                <div class="info-chip">
                  <span class="chip-label">Orden</span>
                  <span class="chip-val">${v.orden}</span>
                </div>` : ''}
                <div class="info-chip">
                  <span class="chip-label">Seccional</span>
                  <span class="chip-val">${v.seccional}</span>
                </div>
              </div>
              <div class="info-item">
                <span class="info-label">🎂 Nacimiento</span>
                <span class="info-value">${v.nacimiento || '—'}</span>
              </div>
            </div>

            <div class="voter-actions">
              <button class="btn btn-primary btn-sm btn-save" data-idx="${i}">
                💾 Guardar
              </button>
              <button class="btn btn-green btn-sm btn-share" data-idx="${i}">
                📲 WhatsApp
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    `

    resultsEl.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', () => {
        saveTarget = results[parseInt(btn.dataset.idx)]
        openSaveModal(saveTarget)
      })
    })

    resultsEl.querySelectorAll('.btn-share').forEach(btn => {
      btn.addEventListener('click', () => {
        shareWhatsApp(results[parseInt(btn.dataset.idx)])
      })
    })
  }

  function openSaveModal(voter) {
    modalEl.innerHTML = `
      <div class="modal-overlay" id="overlay">
        <div class="modal">
          <div class="modal-title">💾 Guardar Registro</div>
          <div style="font-weight:700;margin-bottom:2px;">${voter.nombre}</div>
          <div style="font-size:0.85rem;color:var(--gris-texto);margin-bottom:18px;">
            CI ${voter.cedula} · Seccional ${voter.seccional}
            ${voter.local ? `<br>🏫 ${voter.local}` : ''}
            ${voter.mesa ? `· Mesa ${voter.mesa}` : ''}
            ${voter.orden ? `· Orden ${voter.orden}` : ''}
          </div>
          <div id="modal-alert"></div>
          <div class="form-group">
            <label class="form-label">Teléfono de contacto <span style="color:#999;">(opcional)</span></label>
            <input class="form-input" id="inp-tel" type="text" placeholder="Ej: 981107497" maxlength="20" style="width:100%;" />
            <div style="font-size:0.8rem; color:#999; margin-top:4px;">Solo números, sin espacios ni símbolos</div>
          </div>
          <div class="form-group">
            <label class="form-label">Nota <span style="color:#999;">(opcional)</span></label>
            <input class="form-input" id="inp-nota" type="text" placeholder="Ej: vecino de la cuadra..." />
          </div>
          <div class="form-group">
            <label class="form-label">¿Necesita Transporte? <span style="color:#999;">(opcional)</span></label>
            <select class="form-input" id="sel-transporte">
              <option value="">— Sin especificar —</option>
              <option value="Sí">Sí, necesita transporte</option>
              <option value="No">No necesita transporte</option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-confirm-save" style="flex:1;">Guardar</button>
            <button class="btn btn-outline" id="btn-cancel-save" style="flex:1;">Cancelar</button>
          </div>
          <div style="margin-top:12px;">
            <button class="btn btn-green btn-full" id="btn-save-wa">
              💾 Guardar + Enviar WhatsApp
            </button>
          </div>
        </div>
      </div>
    `
    modalEl.querySelector('#btn-cancel-save').addEventListener('click', closeModal)
    modalEl.querySelector('#overlay').addEventListener('click', (e) => {
      if (e.target.id === 'overlay') closeModal()
    })
    modalEl.querySelector('#btn-confirm-save').addEventListener('click', () => doSave(false))
    modalEl.querySelector('#btn-save-wa').addEventListener('click', () => doSave(true))
  }

  function closeModal() {
    modalEl.innerHTML = ''
    saveTarget = null
  }

async function doSave(withWA) {
    let telInput = modalEl.querySelector('#inp-tel').value.trim()
    
    // ✅ QUITAR +595 PRIMERO, LUEGO SOLO DÍGITOS
    let telefono = telInput
      .replace('+595', '')  // Quitar +595 si está
      .replace(/\D/g, '')    // Solo dígitos
    
    const nota = modalEl.querySelector('#inp-nota').value.trim()
    const transporte = modalEl.querySelector('#sel-transporte').value
    const alertEl = modalEl.querySelector('#modal-alert')
    const btn = modalEl.querySelector('#btn-confirm-save')

    btn.disabled = true
    btn.textContent = 'Guardando...'

    try {
      await saveRecord(user.uid, saveTarget, telefono, nota, transporte)
      if (withWA && telefono) shareWhatsAppDirect(telefono, saveTarget)
      closeModal()
      const banner = document.createElement('div')
      banner.className = 'alert alert-success'
      banner.textContent = `✅ ${saveTarget.nombre} guardado correctamente.`
      resultsEl.insertBefore(banner, resultsEl.firstChild)
      setTimeout(() => banner.remove(), 3000)
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`
      btn.disabled = false
      btn.textContent = 'Guardar'
    }
  }
  function exportToExcel() {
    if (results.length === 0) {
      alert('No hay resultados para exportar. Realiza una búsqueda primero.')
      return
    }

    const headers = ['Cédula', 'Nombre', 'Dirección', 'Local de Votación', 'Mesa', 'Orden', 'Seccional', 'Fecha Nacimiento', 'Afiliación', 'Fecha de Exportación']
    
    const rows = results.map(v => [
      v.cedula || '',
      v.nombre || '',
      v.direccion || '',
      v.local || '',
      v.mesa || '',
      v.orden || '',
      v.seccional || '',
      v.nacimiento || '',
      v.afiliacion || '',
      new Date().toLocaleDateString('es-PY')
    ])

    let csvContent = 'sep=,\n'
    csvContent += headers.map(h => `"${h}"`).join(',') + '\n'
    rows.forEach(row => {
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n'
    })

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `padronal_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}