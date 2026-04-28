/**
 * MÓDULO: DÍA D - PANEL ADMIN V3
 * ✅ Toggle Día D
 * ✅ Estadísticas con % correcto
 * ✅ Ranking por militante
 * ✅ WhatsApp a faltantes + asignar chofer
 * ✅ Detalles por Local/Mesa
 * ✅ NUEVO: Gestión de Choferes
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
            <span id="toggle-label" style="font-weight: 700; font-size: 1.1rem; color: #ff9800;">⏳ Deshabilitado</span>
          </label>
        </div>
        <div id="toggle-warning" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 12px; border-radius: 4px; color: #e65100; font-size: 0.9rem;">
          <strong>⏳ Día D está DESHABILITADO</strong><br>
          Los militantes pueden ver la interfaz pero <strong>no pueden marcar votos</strong> hasta que actives esta opción.
        </div>
      </div>

      <!-- TABS PARA ESTADÍSTICAS -->
      <div style="background: white; border-radius: 8px; overflow: hidden; border: 2px solid #1976d2;">
        <div style="display: flex; background: #f5f5f5; border-bottom: 2px solid #1976d2;">
          <button id="tab-global" style="flex: 1; padding: 16px; background: #1976d2; color: white; border: none; cursor: pointer; font-weight: 700;">📊 Global</button>
          <button id="tab-locales" style="flex: 1; padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">📍 Por Local</button>
          <button id="tab-choferes" style="flex: 1; padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">🚗 Choferes</button>
        </div>

        <!-- TAB 1: GLOBAL -->
        <div id="content-global" style="padding: 24px;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">📊 Estadísticas Globales</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">—</div>
              <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">MILITANTES</div>
            </div>
            <div style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">—</div>
              <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">VOTANTES</div>
            </div>
            <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votos" style="font-size: 2rem; font-weight: 700; color: #2e7d32;">—</div>
              <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">VOTOS</div>
            </div>
            <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-pct" style="font-size: 2rem; font-weight: 700; color: #e65100;">—%</div>
              <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">PARTICIPACIÓN</div>
            </div>
          </div>

          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">👥 Ranking por Militante</h3>
          <div id="militantes-ranking" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">⏳ Cargando...</div>
          </div>
        </div>

        <!-- TAB 2: POR LOCAL -->
        <div id="content-locales" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">📍 Desglose por Local de Votación</h3>
          <div id="locales-container" style="display: grid; gap: 16px;">
            <div style="text-align: center; padding: 40px; color: #999;">⏳ Cargando...</div>
          </div>
        </div>

        <!-- TAB 3: CHOFERES -->
        <div id="content-choferes" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🚗 Gestión de Choferes</h3>
          
          <div style="background: #f9f9f9; border: 2px dashed #c41e3a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 16px 0; font-family: Barlow Condensed; color: #c41e3a;">➕ Agregar Nuevo Chofer</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <input type="text" id="chofer-nombre" placeholder="Nombre del chofer" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <input type="tel" id="chofer-telefono" placeholder="Teléfono" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <select id="chofer-local" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="">-- Selecciona Local --</option>
              </select>
              <button id="btn-agregar-chofer" style="background: #c41e3a; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: 700;">Agregar Chofer</button>
            </div>
          </div>

          <h4 style="margin: 0 0 12px 0; font-family: Barlow Condensed; color: #333;">Choferes Registrados</h4>
          <div id="choferes-lista" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">⏳ Cargando...</div>
          </div>
        </div>
      </div>
    </div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  // Tabs
  const switchTab = (tabName) => {
    document.getElementById('content-global').style.display = tabName === 'global' ? 'block' : 'none'
    document.getElementById('content-locales').style.display = tabName === 'locales' ? 'block' : 'none'
    document.getElementById('content-choferes').style.display = tabName === 'choferes' ? 'block' : 'none'
    
    document.getElementById('tab-global').style.background = tabName === 'global' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-global').style.color = tabName === 'global' ? 'white' : '#333'
    document.getElementById('tab-locales').style.background = tabName === 'locales' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-locales').style.color = tabName === 'locales' ? 'white' : '#333'
    document.getElementById('tab-choferes').style.background = tabName === 'choferes' ? '#c41e3a' : '#f5f5f5'
    document.getElementById('tab-choferes').style.color = tabName === 'choferes' ? 'white' : '#333'
  }

  document.getElementById('tab-global').addEventListener('click', () => switchTab('global'))
  document.getElementById('tab-locales').addEventListener('click', () => switchTab('locales'))
  document.getElementById('tab-choferes').addEventListener('click', () => switchTab('choferes'))

  loadAndRender(container)
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

async function loadAndRender(container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs, doc, onSnapshot, setDoc, addDoc, serverTimestamp } = firebaseImport
    const { db, auth } = await import('../lib/firebase.js')

    const currentUser = auth.currentUser
    if (!currentUser) {
      console.error('❌ Usuario no autenticado')
      return
    }

    // 1. Escuchar Día D
    onSnapshot(
      doc(db, 'config', 'electionDay'),
      docSnap => {
        const enabled = docSnap.exists() ? docSnap.data().enabled : false
        updateElectionDayToggle(enabled, db, setDoc, doc, currentUser.uid)
      },
      err => console.error('❌ Error:', err)
    )

    // 2. Cargar militantes
    const usersSnap = await getDocs(collection(db, 'users'))
    const militantes = []
    const locales = new Set()
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

    // 3. Cargar registros
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const allRecords = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    allRecords.forEach(r => {
      if (r.local) locales.add(r.local)
    })

    // Llenar select de locales
    const selectLocal = document.getElementById('chofer-local')
    locales.forEach(local => {
      const opt = document.createElement('option')
      opt.value = local
      opt.textContent = local
      selectLocal.appendChild(opt)
    })

    // 4. Cargar choferes
    const choferesSnap = await getDocs(collection(db, 'dia_d_choferes'))
    const choferes = choferesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // 5. Escuchar votos
    onSnapshot(
      collection(db, 'dia_d_votos'),
      votosSnap => {
        const allVotos = votosSnap.docs.map(d => d.data())

        getDocs(collection(db, 'savedRecords')).then(votantesSnap => {
          const totalVotantes = votantesSnap.size
          const totalVotos = votosSnap.size
          const pctGlobal = totalVotantes > 0 ? ((totalVotos / totalVotantes) * 100).toFixed(2) : 0

          document.getElementById('total-militantes').textContent = militantes.length
          document.getElementById('total-votantes').textContent = totalVotantes
          document.getElementById('total-votos').textContent = totalVotos
          document.getElementById('total-pct').textContent = pctGlobal

          const porMilitante = {}
          militantes.forEach(m => {
            porMilitante[m.uid] = { nombre: m.nombre, email: m.email, votos: 0, registros: [] }
          })

          allRecords.forEach(r => {
            if (porMilitante[r.uid]) porMilitante[r.uid].registros.push(r)
          })

          allVotos.forEach(v => {
            if (porMilitante[v.militante_id]) porMilitante[v.militante_id].votos++
          })

          renderRankingMilitantes(porMilitante, allVotos, allRecords, choferes, db, setDoc, addDoc)
          renderPorLocales(allRecords, allVotos)
          renderChoferes(choferes, allRecords, allVotos, db, setDoc, addDoc)
        })
      },
      err => console.error('❌ Error:', err)
    )

    // Event listener para agregar chofer
    document.getElementById('btn-agregar-chofer').addEventListener('click', async () => {
      const nombre = document.getElementById('chofer-nombre').value
      const telefono = document.getElementById('chofer-telefono').value
      const local = document.getElementById('chofer-local').value

      if (!nombre || !telefono || !local) {
        alert('Completa todos los campos')
        return
      }

      try {
        await addDoc(collection(db, 'dia_d_choferes'), {
          nombre, telefono, local,
          createdAt: serverTimestamp()
        })
        document.getElementById('chofer-nombre').value = ''
        document.getElementById('chofer-telefono').value = ''
        document.getElementById('chofer-local').value = ''
        alert('✅ Chofer agregado')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

  } catch (err) {
    console.error('Error:', err)
  }
}

function updateElectionDayToggle(enabled, db, setDoc, doc, uid) {
  const toggle = document.getElementById('toggle-election-day')
  const label = document.getElementById('toggle-label')
  const warning = document.getElementById('toggle-warning')

  if (toggle) {
    toggle.checked = enabled
    toggle.onclick = async () => {
      const newState = toggle.checked
      try {
        toggle.disabled = true
        await setDoc(doc(db, 'config', 'electionDay'), {
          enabled: newState,
          lastUpdated: new Date(),
          toggledBy: uid
        }, { merge: true })
      } catch (err) {
        alert('Error: ' + err.message)
        toggle.checked = enabled
      } finally {
        toggle.disabled = false
      }
    }
  }

  if (label) {
    label.textContent = enabled ? '✅ Habilitado' : '⏳ Deshabilitado'
    label.style.color = enabled ? '#2e7d32' : '#ff9800'
  }

  if (warning) {
    if (enabled) {
      warning.innerHTML = '<strong style="color: #2e7d32;">✅ Día D HABILITADO</strong><br>Los militantes pueden marcar votos.'
      warning.style.background = '#c8e6c9'
      warning.style.borderLeftColor = '#2e7d32'
      warning.style.color = '#1b5e20'
    } else {
      warning.innerHTML = '<strong style="color: #e65100;">⏳ Día D DESHABILITADO</strong><br>Los militantes no pueden marcar votos.'
      warning.style.background = '#fff3cd'
      warning.style.borderLeftColor = '#ff9800'
      warning.style.color = '#e65100'
    }
  }
}

function renderRankingMilitantes(porMilitante, allVotos, allRecords, choferes, db, setDoc, addDoc) {
  const ranking = Object.entries(porMilitante)
    .map(([uid, data]) => ({ uid, ...data }))
    .sort((a, b) => b.votos - a.votos)

  let html = ''
  ranking.forEach((m, idx) => {
    const pct = m.registros.length > 0 ? ((m.votos / m.registros.length) * 100).toFixed(2) : 0
    const medallaEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '👤'
    const barColor = pct >= 75 ? '#2e7d32' : pct >= 50 ? '#ff9800' : '#f44336'

    html += '<div style="background: #fafafa; border-radius: 8px; padding: 16px; border-left: 4px solid ' + barColor + ';">'
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
    html += '<div><div style="font-weight: 700; font-size: 0.95rem;">' + medallaEmoji + ' ' + m.nombre + '</div>'
    html += '<div style="font-size: 0.75rem; color: #999;">' + m.email + '</div></div>'
    html += '<div style="text-align: right;">'
    html += '<div style="font-size: 1.3rem; font-weight: 700; color: ' + barColor + ';">' + m.votos + '/' + m.registros.length + '</div>'
    html += '<div style="font-size: 0.75rem; color: #666;">' + pct + '%</div></div></div>'
    html += '<div style="background: white; border-radius: 4px; height: 8px; margin-bottom: 10px;"><div style="background: ' + barColor + '; height: 100%; width: ' + Math.min(pct, 100) + '%;"></div></div>'
    html += '<button class="btn-detalle" data-uid="' + m.uid + '" data-nombre="' + m.nombre + '" style="background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: 700;">🔍 Detalle</button>'
    html += '</div>'
  })

  const el = document.getElementById('militantes-ranking')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-detalle').forEach(btn => {
      btn.onclick = () => {
        const uid = btn.dataset.uid
        const nombre = btn.dataset.nombre
        const registros = porMilitante[uid].registros
        const votos = allVotos.filter(v => v.militante_id === uid)
        mostrarDetalle(nombre, registros, votos, choferes, db, setDoc, addDoc)
      }
    })
  }
}

function renderPorLocales(allRecords, allVotos) {
  const porLocal = {}
  
  allRecords.forEach(r => {
    const local = r.local || 'Sin local'
    if (!porLocal[local]) porLocal[local] = {}
    
    const mesa = r.mesa || 'Sin mesa'
    if (!porLocal[local][mesa]) porLocal[local][mesa] = []
    
    porLocal[local][mesa].push(r)
  })

  let html = ''
  Object.entries(porLocal).forEach(([local, mesas]) => {
    let votosLocal = 0
    let totalLocal = 0

    Object.entries(mesas).forEach(([mesa, registros]) => {
      registros.forEach(r => {
        totalLocal++
        if (allVotos.some(v => v.cedula === r.cedula && v.voted)) votosLocal++
      })
    })

    const pctLocal = totalLocal > 0 ? ((votosLocal / totalLocal) * 100).toFixed(2) : 0

    html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">'
    html += '<h4 style="margin: 0; font-family: Barlow Condensed; color: #2e7d32; text-transform: uppercase;">📍 ' + local + '</h4>'
    html += '<div style="font-weight: 700; color: #2e7d32;">' + votosLocal + '/' + totalLocal + ' (' + pctLocal + '%)</div></div>'

    Object.entries(mesas).forEach(([mesa, registros]) => {
      let votosMesa = 0
      registros.forEach(r => {
        if (allVotos.some(v => v.cedula === r.cedula && v.voted)) votosMesa++
      })
      const pctMesa = registros.length > 0 ? ((votosMesa / registros.length) * 100).toFixed(2) : 0

      html += '<div style="background: #f9f9f9; border-left: 4px solid #ff9800; padding: 12px; margin-bottom: 8px; border-radius: 4px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">'
      html += '<div style="font-weight: 600;">🗳️ Mesa ' + mesa + '</div>'
      html += '<div style="font-size: 0.85rem; color: #666;">' + votosMesa + '/' + registros.length + ' (' + pctMesa + '%)</div></div>'

      html += '<button class="btn-mesa-detalle" data-local="' + local + '" data-mesa="' + mesa + '" style="background: #ff9800; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver</button>'
      html += '</div>'
    })

    html += '</div>'
  })

  const el = document.getElementById('locales-container')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-mesa-detalle').forEach(btn => {
      btn.onclick = () => {
        const local = btn.dataset.local
        const mesa = btn.dataset.mesa
        mostrarDetalleMesa(local, mesa, allRecords, allVotos)
      }
    })
  }
}

function renderChoferes(choferes, allRecords, allVotos, db, setDoc, addDoc) {
  let html = ''
  
  if (choferes.length === 0) {
    html = '<div style="text-align: center; padding: 40px; color: #999;">No hay choferes registrados</div>'
  } else {
    choferes.forEach(chofer => {
      const faltantesPara = allRecords.filter(r => r.local === chofer.local && r.chofer_asignado === chofer.id && !allVotos.some(v => v.cedula === r.cedula && v.voted))
      
      html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
      html += '<div>'
      html += '<div style="font-weight: 700; font-size: 1rem;">🚗 ' + chofer.nombre + '</div>'
      html += '<div style="font-size: 0.85rem; color: #666;">📱 ' + chofer.telefono + ' | 📍 ' + chofer.local + '</div>'
      html += '</div>'
      html += '<div style="text-align: right;">'
      html += '<div style="font-size: 1.5rem; font-weight: 700; color: #c41e3a;">' + faltantesPara.length + '</div>'
      html += '<div style="font-size: 0.75rem; color: #666;">Faltantes asignados</div>'
      html += '</div>'
      html += '</div>'

      if (faltantesPara.length > 0) {
        html += '<div style="background: #fff9e6; border-radius: 4px; padding: 12px; max-height: 200px; overflow-y: auto;">'
        faltantesPara.forEach(p => {
          html += '<div style="padding: 6px; border-bottom: 1px solid #ffe0b2; font-size: 0.85rem;">'
          html += '<div style="font-weight: 600;">' + p.nombre + '</div>'
          html += '<div style="color: #666;">CI: ' + p.cedula + ' | Mesa: ' + p.mesa + '</div>'
          html += '</div>'
        })
        html += '</div>'
      } else {
        html += '<div style="background: #f9f9f9; border-radius: 4px; padding: 12px; text-align: center; color: #999; font-size: 0.85rem;">Sin faltantes asignados</div>'
      }

      html += '<button class="btn-eliminar-chofer" data-id="' + chofer.id + '" style="background: #ff5252; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; margin-top: 8px; width: 100%;">🗑️ Eliminar</button>'
      html += '</div>'
    })
  }

  const el = document.getElementById('choferes-lista')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-eliminar-chofer').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('¿Eliminar este chofer?')) {
          try {
            await deleteDoc(doc(db, 'dia_d_choferes', btn.dataset.id))
            alert('✅ Chofer eliminado')
          } catch (err) {
            alert('Error: ' + err.message)
          }
        }
      }
    })
  }
}

function mostrarDetalle(nombre, registros, votos, choferes, db, setDoc, addDoc) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  const votados = votos.filter(v => v.voted)
  const faltantes = registros.filter(r => !votos.some(v => v.cedula === r.cedula && v.voted))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">🔍 ' + nombre + '</h2>'
  html += '<button onclick="this.closest(\'div\').parentElement.parentElement.remove()" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">✕</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">✅ YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(v => {
      const r = registros.find(x => x.cedula === v.cedula)
      if (r) {
        html += '<div style="background: #e8f5e9; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid #2e7d32;">'
        html += '<div style="font-weight: 600;">' + (v.nombre || r.nombre) + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333;">CI: ' + v.cedula + ' | Local: ' + (r.local || 'N/A') + ' | Mesa: ' + (r.mesa || 'N/A') + '</div>'
        html += '</div>'
      }
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">⏳ FALTANTES (' + faltantes.length + ')</h3>'
    faltantes.forEach(r => {
      const msgWA = encodeURIComponent('Buen día, ' + r.nombre + '.\nTe estamos esperando para que juntos cambiemos el destino de nuestra ciudad.\n🗳️ Votá Lista 6 – Opción 1 Samy Fidabel\n📍 Lugar de votación: ' + (r.local || 'N/A') + '\n📋 Mesa: ' + (r.mesa || 'N/A') + '\n🔢 Orden: ' + (r.orden || 'N/A') + '\nTu voto hace la diferencia. ¡Contamos con vos!')
      const waLink = 'https://wa.me/' + (r.telefono || '') + '?text=' + msgWA

      html += '<div style="background: #fff9e6; padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600; margin-bottom: 6px;">' + (r.nombre || 'N/A') + '</div>'
      html += '<div style="font-size: 0.8rem; color: #333; margin-bottom: 8px;">CI: ' + r.cedula + ' | Local: ' + (r.local || 'N/A') + ' | Mesa: ' + (r.mesa || 'N/A') + ' | 📱 ' + (r.telefono || 'Sin teléfono') + '</div>'
      
      html += '<div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 8px; align-items: center;">'
      html += '<label style="font-weight: 600; font-size: 0.85rem;">¿Asignar chofer?</label>'
      html += '<select class="chofer-selector" data-cedula="' + r.cedula + '" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem;">'
      html += '<option value="">No</option>'
      html += '<option value="si">Sí</option>'
      html += '</select>'
      html += '</div>'
      
      html += '<div class="chofer-select-container-' + r.cedula + '" style="display: none; margin-bottom: 8px;">'
      html += '<select class="chofer-select" data-cedula="' + r.cedula + '" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; width: 100%; margin-bottom: 8px;">'
      html += '<option value="">-- Selecciona chofer --</option>'
      choferes.filter(c => c.local === r.local).forEach(c => {
        html += '<option value="' + c.id + '">' + c.nombre + ' (' + c.telefono + ')</option>'
      })
      html += '</select>'
      html += '<button class="btn-asignar-chofer" data-cedula="' + r.cedula + '" style="background: #c41e3a; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; width: 100%;">Asignar</button>'
      html += '</div>'

      if (r.telefono) {
        html += '<a href="' + waLink + '" target="_blank" style="background: #25d366; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 0.8rem; font-weight: 600; display: inline-block;">📱 Enviar WA</a>'
      }
      
      html += '</div>'
    })
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)

  // Event listeners para selector de chofer
  document.querySelectorAll('.chofer-selector').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const cedula = sel.dataset.cedula
      const container = document.querySelector('.chofer-select-container-' + cedula)
      if (e.target.value === 'si') {
        container.style.display = 'block'
      } else {
        container.style.display = 'none'
      }
    })
  })

  // Event listeners para asignar chofer
  document.querySelectorAll('.btn-asignar-chofer').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cedula = btn.dataset.cedula
      const choferSelect = document.querySelector('.chofer-select[data-cedula="' + cedula + '"]')
      const choferId = choferSelect.value

      if (!choferId) {
        alert('Selecciona un chofer')
        return
      }

      try {
        const record = registros.find(r => r.cedula === cedula)
        await setDoc(doc(db, 'savedRecords', record.id), {
          chofer_asignado: choferId
        }, { merge: true })
        alert('✅ Chofer asignado')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })
  })

  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}

function mostrarDetalleMesa(local, mesa, allRecords, allVotos) {
  const registrosMesa = allRecords.filter(r => r.local === local && r.mesa === mesa)
  
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  const votados = registrosMesa.filter(r => allVotos.some(v => v.cedula === r.cedula && v.voted))
  const faltantes = registrosMesa.filter(r => !allVotos.some(v => v.cedula === r.cedula && v.voted))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">📍 ' + local + ' | 🗳️ Mesa ' + mesa + '</h2>'
  html += '<button onclick="this.closest(\'div\').parentElement.parentElement.remove()" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">✕</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'
  html += '<div style="margin-bottom: 12px; font-weight: 600; color: #333;">Total: ' + registrosMesa.length + ' | Votados: ' + votados.length + ' | Faltantes: ' + faltantes.length + '</div>'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 20px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">✅ YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(r => {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 4px solid #2e7d32;">'
      html += '<div style="font-weight: 600;">' + r.nombre + '</div>'
      html += '<div style="color: #666;">CI: ' + r.cedula + ' | Orden: ' + r.orden + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">⏳ FALTANTES (' + faltantes.length + ')</h3>'
    faltantes.forEach(r => {
      html += '<div style="background: #fff9e6; padding: 10px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600;">' + r.nombre + '</div>'
      html += '<div style="color: #666;">CI: ' + r.cedula + ' | Orden: ' + r.orden + ' | 📱 ' + (r.telefono || 'Sin teléfono') + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}