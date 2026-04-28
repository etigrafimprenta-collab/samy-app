/**
 * MÓDULO: DÍA D - PANEL ADMIN
 * ✅ Toggle para habilitar/deshabilitar Día D
 * ✅ Estadísticas en tiempo real de todos los votos
 * ✅ Detalles de votantes por militante
 */

export function renderDiaDAdmin(container) {
  let electionDayEnabled = false
  let unsubscribeConfig = null
  let unsubscribeVotes = null

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
            <span id="toggle-label" style="font-weight: 700; font-size: 1.1rem; color: #ff9800;">⏳ Deshabilitado</span>
          </label>
        </div>
        <div id="toggle-warning" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 12px; border-radius: 4px; color: #e65100; font-size: 0.9rem;">
          <strong>⏳ Día D está DESHABILITADO</strong><br>
          Los militantes pueden ver la interfaz pero <strong>no pueden marcar votos</strong> hasta que actives esta opción.
        </div>
      </div>

      <!-- ESTADÍSTICAS GLOBALES -->
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 24px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">📊 Estadísticas Globales</h3>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
          <div style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">—</div>
            <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">MILITANTES</div>
          </div>
          <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">—</div>
            <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">VOTANTES REGISTRADOS</div>
          </div>
          <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-votos" style="font-size: 2rem; font-weight: 700; color: #2e7d32;">—</div>
            <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">VOTOS REGISTRADOS</div>
          </div>
          <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-pct" style="font-size: 2rem; font-weight: 700; color: #e65100;">—%</div>
            <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">PORCENTAJE</div>
          </div>
        </div>

        <div style="background: #fafafa; border-left: 4px solid #1976d2; padding: 12px; border-radius: 4px; font-size: 0.85rem; color: #666;">
          <strong>Nota:</strong> Estas estadísticas se actualizan en tiempo real a medida que los militantes marcan votos.
        </div>
      </div>

      <!-- DESGLOSE POR MILITANTE -->
      <div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 24px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">👥 Desglose por Militante</h3>
        
        <div id="militantes-list" style="display: grid; gap: 12px;">
          <div style="text-align: center; padding: 40px; color: #999;">⏳ Cargando militantes...</div>
        </div>
      </div>

    </div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  loadAndRender(container)
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

async function loadAndRender(container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    // ✅ doc IMPORTADO CORRECTAMENTE
    const { collection, getDocs, doc, onSnapshot, setDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')
    const { auth } = await import('../lib/firebase.js')

    const currentUser = auth.currentUser
    if (!currentUser) {
      console.error('❌ Usuario no autenticado')
      return
    }

    // 1️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE ELECTIONDAY
    const unsubscribeConfig = onSnapshot(
      doc(db, 'config', 'electionDay'),
      docSnap => {
        const enabled = docSnap.exists() ? docSnap.data().enabled : false
        updateElectionDayToggle(enabled, db, setDoc, doc, currentUser.uid)
      },
      err => console.error('❌ Error escuchando Día D:', err)
    )

    // 2️⃣ CARGAR LISTA DE MILITANTES (USERS CON ROLE='user')
    const usersSnap = await getDocs(collection(db, 'users'))
    const militantes = []
    usersSnap.forEach(docSnap => {
      const data = docSnap.data()
      if (data.role === 'user') {
        militantes.push({
          uid: docSnap.id,
          nombre: data.displayName || data.email || 'Sin nombre',
          email: data.email || ''
        })
      }
    })

    // 3️⃣ CARGAR TODOS LOS REGISTROS Y VOTOS
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const allRecords = []
    recordsSnap.forEach(d => {
      allRecords.push({ id: d.id, ...d.data() })
    })

    const votosSnap = await getDocs(collection(db, 'dia_d_votos'))
    const allVotos = []
    votosSnap.forEach(d => {
      allVotos.push(d.data())
    })

    // 4️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE VOTOS
    const unsubscribeVotes = onSnapshot(
      collection(db, 'dia_d_votos'),
      votosSnap => {
        getDocs(collection(db, 'savedRecords')).then(votantesSnap => {
          const stats = {
            totalMilitantes: militantes.length,
            totalVotantes: votantesSnap.size,
            totalVotos: votosSnap.size,
            votosPercentaje: votantesSnap.size > 0 ? Math.round((votosSnap.size / votantesSnap.size) * 100) : 0,
            porMilitante: {}
          }

          // Agrupar votos por militante
          votosSnap.forEach(votoDoc => {
            const data = votoDoc.data()
            const militanteId = data.militante_id
            if (!stats.porMilitante[militanteId]) {
              stats.porMilitante[militanteId] = {
                votos: 0,
                nombre: militantes.find(m => m.uid === militanteId)?.nombre || 'Desconocido'
              }
            }
            if (data.voted) {
              stats.porMilitante[militanteId].votos++
            }
          })

          // Agrupar votantes por militante
          const votantesPerMilitante = {}
          votantesSnap.forEach(votanteDoc => {
            const data = votanteDoc.data()
            const militanteId = data.uid
            if (!votantesPerMilitante[militanteId]) {
              votantesPerMilitante[militanteId] = 0
            }
            votantesPerMilitante[militanteId]++
          })

          // Pasar datos de detalles para el modal
          const registrosPorMilitante = {}
          allRecords.forEach(r => {
            if (!registrosPorMilitante[r.uid]) {
              registrosPorMilitante[r.uid] = []
            }
            registrosPorMilitante[r.uid].push(r)
          })

          renderStats(stats, militantes, votantesPerMilitante, allVotos, registrosPorMilitante)
        })
      },
      err => console.error('❌ Error cargando votos:', err)
    )

  } catch (err) {
    console.error('Error:', err)
    const listEl = document.getElementById('militantes-list')
    if (listEl) {
      listEl.innerHTML = `<div style="background: #ffebee; border-left: 4px solid #c62828; padding: 16px; border-radius: 4px; color: #c62828;"><strong>Error:</strong> ${err.message}</div>`
    }
  }
}

function updateElectionDayToggle(enabled, db, setDoc, doc, uid) {
  const toggle = document.getElementById('toggle-election-day')
  const label = document.getElementById('toggle-label')
  const warning = document.getElementById('toggle-warning')

  if (toggle) {
    toggle.checked = enabled
    toggle.removeEventListener('change', null)
    toggle.addEventListener('change', async (e) => {
      const newState = e.target.checked
      try {
        toggle.disabled = true
        await setDoc(doc(db, 'config', 'electionDay'), {
          enabled: newState,
          lastUpdated: new Date(),
          toggledBy: uid
        }, { merge: true })
      } catch (err) {
        alert(`❌ Error: ${err.message}`)
        toggle.checked = enabled
      } finally {
        toggle.disabled = false
      }
    })
  }

  if (label) {
    if (enabled) {
      label.textContent = '✅ Habilitado'
      label.style.color = '#2e7d32'
    } else {
      label.textContent = '⏳ Deshabilitado'
      label.style.color = '#ff9800'
    }
  }

  if (warning) {
    if (enabled) {
      warning.innerHTML = `
        <strong style="color: #2e7d32;">✅ Día D HABILITADO</strong><br>
        Los militantes pueden marcar votos. La votación está activa.
      `
      warning.style.background = '#c8e6c9'
      warning.style.borderLeftColor = '#2e7d32'
      warning.style.color = '#1b5e20'
    } else {
      warning.innerHTML = `
        <strong style="color: #e65100;">⏳ Día D DESHABILITADO</strong><br>
        Los militantes pueden ver la interfaz pero <strong>no pueden marcar votos</strong> hasta que actives esta opción.
      `
      warning.style.background = '#fff3cd'
      warning.style.borderLeftColor = '#ff9800'
      warning.style.color = '#e65100'
    }
  }
}

function renderStats(stats, militantes, votantesPerMilitante, allVotos, registrosPorMilitante) {
  const totalMilitantesEl = document.getElementById('total-militantes')
  const totalVotantesEl = document.getElementById('total-votantes')
  const totalVotosEl = document.getElementById('total-votos')
  const totalPctEl = document.getElementById('total-pct')

  if (totalMilitantesEl) totalMilitantesEl.textContent = stats.totalMilitantes
  if (totalVotantesEl) totalVotantesEl.textContent = stats.totalVotantes
  if (totalVotosEl) totalVotosEl.textContent = stats.totalVotos
  if (totalPctEl) totalPctEl.textContent = stats.votosPercentaje

  const listEl = document.getElementById('militantes-list')
  if (!listEl) return

  if (militantes.length === 0) {
    listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Sin militantes registrados</div>'
    return
  }

  let html = ''
  militantes.forEach(militante => {
    const votos = stats.porMilitante[militante.uid]?.votos || 0
    const votantesAsignados = votantesPerMilitante[militante.uid] || 0
    const pct = votantesAsignados > 0 ? Math.round((votos / votantesAsignados) * 100) : 0

    const barColor = pct >= 75 ? '#2e7d32' : pct >= 50 ? '#ff9800' : '#f44336'
    const estadoBadge = pct >= 75 ? '🟢 Excelente' : pct >= 50 ? '🟡 Bueno' : '🔴 Bajo'

    html += `
      <div style="background: #fafafa; border-radius: 8px; padding: 16px; border-left: 4px solid ${barColor};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; color: #333;">${militante.nombre}</div>
            <div style="font-size: 0.75rem; color: #999;">${militante.email}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.3rem; font-weight: 700; color: ${barColor};">${pct}%</div>
            <div style="font-size: 0.75rem; color: #666;">${estadoBadge}</div>
          </div>
        </div>
        
        <div style="display: flex; gap: 12px; margin-bottom: 10px;">
          <div style="flex: 1;">
            <div style="font-size: 0.75rem; color: #999; margin-bottom: 4px;">Votos</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #2e7d32;">${votos}</div>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 0.75rem; color: #999; margin-bottom: 4px;">Asignados</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #1976d2;">${votantesAsignados}</div>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 0.75rem; color: #999; margin-bottom: 4px;">Faltan</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #ff9800;">${votantesAsignados - votos}</div>
          </div>
        </div>

        <div style="background: white; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 10px;">
          <div style="background: ${barColor}; height: 100%; width: ${Math.min(pct, 100)}%; transition: width 0.3s;"></div>
        </div>

        <button class="btn-detalle-militante" data-uid="${militante.uid}" data-nombre="${militante.nombre}" style="background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%; font-size: 0.85rem; transition: background 0.3s;">🔍 Ver Detalle</button>
      </div>
    `
  })

  listEl.innerHTML = html

  // Event listeners para los botones de detalle
  document.querySelectorAll('.btn-detalle-militante').forEach(btn => {
    btn.addEventListener('mouseover', () => btn.style.background = '#1565c0')
    btn.addEventListener('mouseout', () => btn.style.background = '#1976d2')
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid
      const nombre = btn.dataset.nombre
      const registros = registrosPorMilitante[uid] || []
      const votos = allVotos.filter(v => v.militante_id === uid)
      mostrarDetalleMilitante(nombre, uid, registros, votos)
    })
  })
}

function mostrarDetalleMilitante(nombre, uid, registros, votos) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative; margin-top: 40px;">'
  html += '<div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">🔍 DETALLE: ' + nombre + '</h2>'
  html += '<button id="btn-cerrar-modal" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;">✕</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'

  // YA VOTARON
  const votados = votos.filter(v => v.voted)
  if (votados.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0; font-family: Barlow Condensed; text-transform: uppercase;">✅ YA VOTARON (' + votados.length + ')</h3>'
    
    html += '<div style="display: grid; gap: 8px;">'
    votados.forEach(v => {
      const registro = registros.find(r => r.cedula === v.cedula)
      if (registro) {
        html += '<div style="background: #e8f5e9; padding: 12px; border-radius: 4px; border-left: 4px solid #2e7d32;">'
        html += '<div style="font-weight: 600; font-size: 0.9rem;">' + (v.nombre || registro.nombre) + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333; font-family: monospace;">CI: ' + v.cedula + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333;">📍 Local: ' + (registro.local || 'N/A') + ' | 🗳️ Mesa: ' + (registro.mesa || 'N/A') + ' | Orden: ' + (registro.orden || 'N/A') + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333;">📱 ' + (registro.telefono || 'Sin teléfono') + '</div>'
        html += '</div>'
      }
    })
    html += '</div></div>'
  }

  // FALTANTES AGRUPADOS POR LOCAL Y MESA
  const faltantes = []
  registros.forEach(r => {
    const tieneVoto = votos.some(v => v.cedula === r.cedula && v.voted)
    if (!tieneVoto) {
      faltantes.push(r)
    }
  })

  if (faltantes.length > 0) {
    const faltantesPorLocal = {}
    
    faltantes.forEach(r => {
      const local = r.local || 'Sin local'
      if (!faltantesPorLocal[local]) faltantesPorLocal[local] = {}
      const mesa = r.mesa || 'Sin mesa'
      if (!faltantesPorLocal[local][mesa]) faltantesPorLocal[local][mesa] = []
      faltantesPorLocal[local][mesa].push(r)
    })

    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 16px 0 12px 0; font-family: Barlow Condensed; text-transform: uppercase;">⏳ FALTANTES POR VOTAR (' + faltantes.length + ')</h3>'
    
    Object.entries(faltantesPorLocal).forEach(([local, mesas]) => {
      html += '<div style="margin-bottom: 16px; background: #fff9e6; padding: 12px; border-radius: 4px; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 8px;">📍 LOCAL: ' + local + '</div>'
      
      Object.entries(mesas).forEach(([mesa, registrosMesa]) => {
        html += '<div style="margin-left: 12px; margin-bottom: 8px;">'
        html += '<div style="font-weight: 600; font-size: 0.85rem; color: #ff6b6b;">🗳️ MESA ' + mesa + '</div>'
        
        registrosMesa.sort((a, b) => (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)).forEach(r => {
          html += '<div style="background: white; padding: 8px 12px; border-radius: 3px; margin-top: 6px; border-left: 2px solid #ffb74d; font-size: 0.8rem;">'
          html += '<div style="font-weight: 600;">' + (r.nombre || 'N/A') + ' ' + (r.apellidos || '') + '</div>'
          html += '<div style="color: #666;">CI: ' + r.cedula + ' | Orden: ' + (r.orden || 'N/A') + '</div>'
          html += '<div style="color: #666;">📱 ' + (r.telefono || 'Sin teléfono') + '</div>'
          html += '</div>'
        })
        
        html += '</div>'
      })
      
      html += '</div>'
    })
    
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
    modal.remove()
  })

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove()
  })