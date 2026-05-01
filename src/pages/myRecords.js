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

  render(records)

  function render(displayRecords) {
    container.innerHTML = `
      <div class="records-section">
        <h2>📋 Mis Registros
          <span style="font-family:Barlow;font-size:1rem;color:var(--gris-texto);font-weight:400;">(${displayRecords.length}/${records.length})</span>
        </h2>

        ${records.length > 0 ? `
          <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center;">
            <input id="filter-inp" type="text" placeholder="🔍 Buscar por nombre, cédula, seccional..." style="flex:1; min-width:250px; padding:10px 12px; border-radius:6px; border: 1px solid #ddd; font-size: 0.95rem; box-sizing: border-box; appearance: none; -webkit-appearance: none;" />
            <button class="btn btn-gold" id="btn-export" style="padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 700;">📥 Exportar a Excel</button>
          </div>
        ` : ''}

        ${displayRecords.length === 0 && records.length === 0 ? `
          <div class="records-empty">
            <div style="font-size:3rem;margin-bottom:10px;">📋</div>
            <div style="font-weight:700;margin-bottom:6px;">Sin registros aún</div>
            <div style="font-size:0.9rem;">Buscá afiliados en el padrón y guardalos aquí.</div>
          </div>
        ` : displayRecords.length === 0 && records.length > 0 ? `
          <div class="card" style="text-align:center; padding:32px;">
            <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
            <div style="font-weight:700; margin-bottom:4px;">Sin resultados</div>
            <div style="font-size:0.9rem; color:var(--gris-texto);">
              No se encontró ningún registro con ese término de búsqueda.
            </div>
          </div>
        ` : displayRecords.map((r, i) => `
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
        `).join('')}
      </div>
    `

    // Botón de exportación
    container.querySelector('#btn-export')?.addEventListener('click', () => {
      exportToExcel(displayRecords, `mis_registros_samy_${Date.now()}.xlsx`)
    })

    // Campo de búsqueda
    const filterInput = container.querySelector('#filter-inp')
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim()
        if (!term) {
          render(records)
        } else {
          const filtered = records.filter(r =>
            r.nombre.toLowerCase().includes(term) ||
            r.cedula.toLowerCase().includes(term) ||
            (r.seccional && r.seccional.toLowerCase().includes(term))
          )
          render(filtered)
        }
      })
    }

    // Botones de WhatsApp
    container.querySelectorAll('.btn-wa').forEach(btn => {
      btn.addEventListener('click', () => {
        let telefono = btn.dataset.tel
        if (!telefono || telefono === '') {
          alert('Este registro no tiene teléfono. Por favor, agrega uno.')
          return
        }
        
        // 🔧 FIX CRÍTICO: Normalizar teléfono
        // Problema: Firebase guarda "+595981234567" o "595981234567"
        // whatsapp.js agrega "595" → resultado: "595595981234567" ❌
        // Solución: Extraer SOLO los dígitos locales (9 dígitos para Paraguay)
        
        // Quitar prefijo +595 si existe
        telefono = telefono.replace(/^\+595/, '').replace(/^595/, '')
        // Ahora: "981234567" (limpio, sin país)
        
        const idx = parseInt(btn.dataset.idx)
        const record = displayRecords[idx]
        shareWhatsAppDirect(telefono, record)
      })
    })

    // Botones de eliminar
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este registro?')) return
        try {
          await deleteRecord(btn.dataset.id)
          records = records.filter(r => r.id !== btn.dataset.id)
          render(records)
        } catch (err) { alert('Error: ' + err.message) }
      })
    })
  }
}