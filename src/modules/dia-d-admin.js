/**
 * MÓDULO: DÍA D - PANEL ADMIN V4 MEJORADO
 * - Tab Choferes: lista de choferes cargados
 * - Tab Global: ranking por militante + modal con votantes pendientes editable
 * - Admin puede reasignar choferes y direcciones
 */

export function renderDiaDAdmin(container) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚙️ DÍA D - PANEL ADMINISTRADOR</h2>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div style="display: grid; gap: 20px;">
      <!-- CONTROL DE VOTACIÓN -->
      <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0 0 6px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🗳️ Control de Votación</h3>
            <p style="margin: 0; font-size: 0.85rem; color: #666;">Habilita o deshabilita Día D para todos los militantes</p>
          </div>
          <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
            <input type="checkbox" id="toggle-election-day" style="width: 24px; height: 24px; cursor: pointer;" />
            <span id="toggle-label" style="font-weight: 700; font-size: 1.1rem; color: #ff9800;">Deshabilitado</span>
          </label>
        </div>
        <div id="toggle-warning" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 12px; border-radius: 4px; color: #e65100; font-size: 0.9rem;">
          <strong>Día D DESHABILITADO</strong>
        </div>
      </div>

      <!-- TABS -->
      <div style="background: white; border-radius: 8px; overflow: hidden; border: 2px solid #1976d2;">
        <div style="display: flex; background: #f5f5f5; border-bottom: 2px solid #1976d2;">
          <button id="tab-global" style="flex: 1; padding: 16px; background: #1976d2; color: white; border: none; cursor: pointer; font-weight: 700;">Global</button>
          <button id="tab-locales" style="flex: 1; padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">Local</button>
          <button id="tab-choferes" style="flex: 1; padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">Choferes</button>
        </div>

        <!-- TAB GLOBAL -->
        <div id="content-global" style="padding: 24px;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">Ranking Militantes</h3>
          <div id="militantes-ranking" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>

        <!-- TAB LOCALES -->
        <div id="content-locales" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">Por Local</h3>
          <div id="locales-container" style="display: grid; gap: 16px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>

        <!-- TAB CHOFERES -->
        <div id="content-choferes" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">Choferes</h3>
          <div id="choferes-lista" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando choferes...</div>
          </div>
        </div>
      </div>
    </div>

    <div id="modal-container"></div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  // TAB NAVIGATION
  document.getElementById('tab-global').addEventListener('click', () => {
    document.getElementById('content-global').style.display = 'block'
    document.getElementById('content-locales').style.display = 'none'
    document.getElementById('content-choferes').style.display = 'none'
    document.getElementById('tab-global').style.background = '#1976d2'
    document.getElementById('tab-locales').style.background = '#f5f5f5'
    document.getElementById('tab-choferes').style.background = '#f5f5f5'
    document.getElementById('tab-global').style.color = 'white'
    document.getElementById('tab-locales').style.color = '#333'
    document.getElementById('tab-choferes').style.color = '#333'
  })

  document.getElementById('tab-locales').addEventListener('click', () => {
    document.getElementById('content-global').style.display = 'none'
    document.getElementById('content-locales').style.display = 'block'
    document.getElementById('content-choferes').style.display = 'none'
    document.getElementById('tab-global').style.background = '#f5f5f5'
    document.getElementById('tab-locales').style.background = '#1976d2'
    document.getElementById('tab-choferes').style.background = '#f5f5f5'
    document.getElementById('tab-global').style.color = '#333'
    document.getElementById('tab-locales').style.color = 'white'
    document.getElementById('tab-choferes').style.color = '#333'
  })

  document.getElementById('tab-choferes').addEventListener('click', () => {
    document.getElementById('content-global').style.display = 'none'
    document.getElementById('content-locales').style.display = 'none'
    document.getElementById('content-choferes').style.display = 'block'
    document.getElementById('tab-global').style.background = '#f5f5f5'
    document.getElementById('tab-locales').style.background = '#f5f5f5'
    document.getElementById('tab-choferes').style.background = '#1976d2'
    document.getElementById('tab-global').style.color = '#333'
    document.getElementById('tab-locales').style.color = '#333'
    document.getElementById('tab-choferes').style.color = 'white'
  })

  // Toggle Día D
  document.getElementById('toggle-election-day').addEventListener('change', async (e) => {
    const enabled = e.target.checked
    const label = document.getElementById('toggle-label')
    const warning = document.getElementById('toggle-warning')

    label.textContent = enabled ? 'Habilitado' : 'Deshabilitado'
    label.style.color = enabled ? '#2e7d32' : '#ff9800'
    warning.innerHTML = enabled 
      ? '<strong>✅ Día D HABILITADO</strong> - Los militantes pueden registrar votos' 
      : '<strong>⏳ Día D DESHABILITADO</strong>'
    warning.style.background = enabled ? '#c8e6c9' : '#fff3cd'
    warning.style.borderLeftColor = enabled ? '#2e7d32' : '#ff9800'
    warning.style.color = enabled ? '#1b5e20' : '#e65100'

    try {
      const { db } = await import('../lib/firebase.js')
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(db, 'config', 'electionDay'), { enabled, timestamp: new Date() })
    } catch (err) {
      console.error('Error:', err)
    }
  })

  // Cargar datos
  loadAdminData(container)
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

async function loadAdminData(container) {
  try {
    const { db } = await import('../lib/firebase.js')
    const { collection, getDocs, query, where } = await import('firebase/firestore')

    // Cargar militantes y sus votantes
    const militantesSnap = await getDocs(collection(db, 'users'))
    const militantes = []
    
    militantesSnap.forEach(doc => {
      if (doc.data().role === 'militante' || doc.data().role === 'admin') {
        militantes.push({
          id: doc.id,
          nombre: doc.data().nombre || doc.data().email,
          email: doc.data().email
        })
      }
    })

    // Cargar votos
    const votosSnap = await getDocs(collection(db, 'dia_d_votos'))
    const votos = {}
    votosSnap.forEach(doc => {
      const data = doc.data()
      if (!votos[data.militante_id]) {
        votos[data.militante_id] = {}
      }
      votos[data.militante_id][data.cedula] = data
    })

    // Cargar votantes guardados
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const records = {}
    recordsSnap.forEach(doc => {
      const data = doc.data()
      if (!records[data.uid]) {
        records[data.uid] = []
      }
      records[data.uid].push({
        cedula: data.cedula,
        nombre: data.nombre,
        local: data.local,
        mesa: data.mesa,
        telefono: data.telefono,
        direccion: data.direccion
      })
    })

    // Cargar choferes CON LISTENER EN TIEMPO REAL
    const { onSnapshot } = await import('firebase/firestore')
    
    onSnapshot(collection(db, 'choferes'), (choferesSnap) => {
      const choferes = []
      choferesSnap.forEach(doc => {
        choferes.push({
          id: doc.id,
          ...doc.data()
        })
      })

      // Renderizar tabs
      renderMilitantesRanking(container, militantes, votos, records, choferes)
      renderChoferes(container, choferes)
    })

  } catch (err) {
    console.error('Error cargando datos:', err)
  }
}

function renderMilitantesRanking(container, militantes, votos, records, choferes) {
  const rankingDiv = container.querySelector('#militantes-ranking')
  
  let html = ''
  militantes.forEach(mil => {
    const votantesDelMilitante = records[mil.id] || []
    const votosDelMilitante = votos[mil.id] || {}
    
    const votaron = votantesDelMilitante.filter(v => votosDelMilitante[v.cedula]?.voted).length
    const total = votantesDelMilitante.length
    const pct = total > 0 ? ((votaron / total) * 100).toFixed(2) : 0

    html += `
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.3s;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 1rem; color: #1976d2;">${mil.nombre}</div>
            <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
              Total: <strong>${total}</strong> | Votaron: <strong style="color: #2e7d32;">${votaron}</strong> | Falta: <strong style="color: #ff9800;">${total - votaron}</strong> | Avance: <strong>${pct}%</strong>
            </div>
          </div>
          <button style="background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;" onclick="this.closest('[data-militante]').click()">📊 Ver Detalle</button>
        </div>
      </div>
    `
  })

  rankingDiv.innerHTML = html

  // Event listeners para ver detalle
  rankingDiv.querySelectorAll('[style*="border: 2px solid"]').forEach((item, idx) => {
    item.setAttribute('data-militante', militantes[idx].id)
    item.addEventListener('click', () => {
      const mil = militantes[idx]
      const votantesDelMilitante = records[mil.id] || []
      const votosDelMilitante = votos[mil.id] || {}
      abrirModalMilitante(container, mil, votantesDelMilitante, votosDelMilitante, choferes)
    })
  })
}

function abrirModalMilitante(container, militante, votantes, votos, choferes) {
  const votaron = votantes.filter(v => votos[v.cedula]?.voted)
  const noVotaron = votantes.filter(v => !votos[v.cedula]?.voted)

  const modalHTML = `
    <div id="overlay-militante" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;">
      <div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin-top: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="background: linear-gradient(135deg, #1976d2 0%, #0d47a1 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">DETALLE: ${militante.nombre}</h2>
          <button id="btn-cerrar-modal" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;">X</button>
        </div>

        <div style="padding: 20px; max-height: 80vh; overflow-y: auto;">
          <!-- YA VOTARON -->
          ${votaron.length > 0 ? `
            <div style="margin-bottom: 24px;">
              <h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0; font-weight: 700;">🟢 YA VOTARON (${votaron.length})</h3>
              ${votaron.map(v => `
                <div style="background: #e8f5e9; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid #2e7d32; font-size: 0.9rem;">
                  <div style="font-weight: 600;">${v.nombre}</div>
                  <div style="color: #666; font-size: 0.85rem;">CI: ${v.cedula} | Local: ${v.local} | Mesa: ${v.mesa}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- NO VOTARON (EDITABLE) -->
          ${noVotaron.length > 0 ? `
            <div>
              <h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0; font-weight: 700;">🔴 PENDIENTES (${noVotaron.length})</h3>
              <div id="votantes-pendientes" style="display: grid; gap: 12px;">
                ${noVotaron.map((v, idx) => {
                  const votoData = votos[v.cedula] || {}
                  const estadoColor = votoData.estado === 'en_camino' ? '#ffc107' : '#ff6b6b'
                  const estadoEmoji = votoData.estado === 'en_camino' ? '🟡' : '🔴'
                  
                  return `
                    <div data-cedula="${v.cedula}" style="background: #fff9e6; padding: 12px; border-radius: 4px; border-left: 4px solid ${estadoColor}; font-size: 0.9rem;">
                      <div style="font-weight: 600; margin-bottom: 8px;">${estadoEmoji} ${v.nombre}</div>
                      <div style="color: #666; font-size: 0.85rem; margin-bottom: 8px;">CI: ${v.cedula} | Local: ${v.local} | Mesa: ${v.mesa} | 📱 ${v.telefono || 'Sin teléfono'}</div>
                      
                      <div style="display: grid; gap: 8px; margin-top: 10px;">
                        <select class="chofer-select" data-cedula="${v.cedula}" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
                          <option value="">-- Asignar chofer --</option>
                          ${choferes.map(c => `<option value="${c.nombre}" ${votoData.choferAsignado === c.nombre ? 'selected' : ''}>${c.nombre}</option>`).join('')}
                        </select>
                        
                        <input type="text" class="direccion-input" data-cedula="${v.cedula}" placeholder="Dirección de recogida" value="${votoData.direccionRecogida || ''}" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
                        
                        <input type="time" class="horario-input" data-cedula="${v.cedula}" value="${votoData.horarioBusqueda || '09:00'}" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
                        
                        <div style="display: flex; gap: 8px;">
                          <button class="btn-guardar-votante" data-cedula="${v.cedula}" style="flex: 1; background: #2e7d32; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 0.85rem;">✅ Guardar</button>
                          <button class="btn-wa-votante" data-telefono="${v.telefono}" style="flex: 1; background: #25d366; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 0.85rem;">💬 WA</button>
                        </div>
                      </div>
                    </div>
                  `
                }).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `

  const modalContainer = document.getElementById('modal-container')
  modalContainer.innerHTML = modalHTML

  // Cerrar modal
  document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
    modalContainer.innerHTML = ''
  })

  document.getElementById('overlay-militante').addEventListener('click', (e) => {
    if (e.target.id === 'overlay-militante') {
      modalContainer.innerHTML = ''
    }
  })

  // Guardar cambios de votante
  document.querySelectorAll('.btn-guardar-votante').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cedula = btn.dataset.cedula
      const chofer = document.querySelector(`.chofer-select[data-cedula="${cedula}"]`).value
      const direccion = document.querySelector(`.direccion-input[data-cedula="${cedula}"]`).value
      const horario = document.querySelector(`.horario-input[data-cedula="${cedula}"]`).value

      try {
        const { db } = await import('../lib/firebase.js')
        const { doc, setDoc } = await import('firebase/firestore')
        
        await setDoc(doc(db, 'dia_d_votos', militante.id + '_' + cedula), {
          militante_id: militante.id,
          cedula: cedula,
          choferAsignado: chofer || null,
          direccionRecogida: direccion || null,
          horarioBusqueda: horario || null,
          ultimoCambio: new Date(),
          timestamp: new Date()
        }, { merge: true })

        alert('✅ Datos guardados')
      } catch (err) {
        alert('❌ Error: ' + err.message)
      }
    })
  })

  // Enviar WA
  document.querySelectorAll('.btn-wa-votante').forEach(btn => {
    btn.addEventListener('click', () => {
      let telefono = btn.dataset.telefono
      if (!telefono) {
        alert('Sin teléfono')
        return
      }
      telefono = telefono.replace(/^\+595/, '').replace(/^595/, '')
      if (telefono) {
        telefono = '595' + telefono
        const mensaje = encodeURIComponent('¡Hola! Te estamos esperando para que juntos votemos por Samy Fidabel - Lista 6.')
        window.open(`https://wa.me/${telefono}?text=${mensaje}`, '_blank')
      }
    })
  })
}

function renderChoferes(container, choferes) {
  const choferesDiv = container.querySelector('#choferes-lista')
  
  if (choferes.length === 0) {
    choferesDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Sin choferes cargados</div>'
    return
  }

  let html = choferes.map(c => `
    <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 700; font-size: 1rem; color: #c41e3a;">${c.nombre}</div>
          <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
            📱 ${c.telefono || 'Sin teléfono'} ${c.vehiculo ? '| 🚗 ' + c.vehiculo : ''}
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button style="background: #1976d2; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">✏️ Editar</button>
          <button style="background: #ff6b6b; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">🗑️ Eliminar</button>
        </div>
      </div>
    </div>
  `).join('')

  choferesDiv.innerHTML = html
}