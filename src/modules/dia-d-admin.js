/**
 * MÓDULO: DÍA D - PANEL ADMIN V3
 * Toggle Día D | Estadísticas | Ranking | WhatsApp | Choferes
 */

export function renderDiaDAdmin(container) {
  // Variables globales para Firebase (accesibles en todas las funciones)
  let doc, db, setDoc, addDoc, deleteDoc, collection, getDocs, onSnapshot
  let currentUser
  let allRecords = []
  let allVotos = []
  let choferes = []
  let militantes = []

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
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">Estadísticas</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div style="background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">0</div>
              <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">MILITANTES</div>
            </div>
            <div style="background: #f3e5f5; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">0</div>
              <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">VOTANTES</div>
            </div>
            <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votos" style="font-size: 2rem; font-weight: 700; color: #2e7d32;">0</div>
              <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">VOTOS</div>
            </div>
            <div style="background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-pct" style="font-size: 2rem; font-weight: 700; color: #e65100;">0%</div>
              <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">PARTICIPACIÓN</div>
            </div>
          </div>

          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">Ranking</h3>
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
          
          <div style="background: #f9f9f9; border: 2px dashed #c41e3a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 16px 0;">Agregar Chofer</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <input type="text" id="chofer-nombre" placeholder="Nombre" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <input type="tel" id="chofer-telefono" placeholder="Teléfono" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <select id="chofer-local" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="">Selecciona Local</option>
              </select>
              <button id="btn-agregar-chofer" style="background: #c41e3a; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: 700;">Agregar</button>
            </div>
          </div>

          <h4 style="margin: 0 0 12px 0;">Choferes</h4>
          <div id="choferes-lista" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>
      </div>
    </div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  const switchTab = (tab) => {
    document.getElementById('content-global').style.display = tab === 'global' ? 'block' : 'none'
    document.getElementById('content-locales').style.display = tab === 'locales' ? 'block' : 'none'
    document.getElementById('content-choferes').style.display = tab === 'choferes' ? 'block' : 'none'
    
    document.getElementById('tab-global').style.background = tab === 'global' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-global').style.color = tab === 'global' ? 'white' : '#333'
    document.getElementById('tab-locales').style.background = tab === 'locales' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-locales').style.color = tab === 'locales' ? 'white' : '#333'
    document.getElementById('tab-choferes').style.background = tab === 'choferes' ? '#c41e3a' : '#f5f5f5'
    document.getElementById('tab-choferes').style.color = tab === 'choferes' ? 'white' : '#333'
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
    const { doc: docFn, collection: collectionFn, getDocs: getDocsFn, onSnapshot: onSnapshotFn, setDoc: setDocFn, addDoc: addDocFn, deleteDoc: deleteDocFn } = await import('firebase/firestore')
    const fbLib = await import('../lib/firebase.js')
    
    // Asignar SOLO lo que se usa en funciones externas
    doc = docFn
    collection = collectionFn
    getDocs = getDocsFn
    setDoc = setDocFn
    addDoc = addDocFn
    deleteDoc = deleteDocFn
    onSnapshot = onSnapshotFn  // Asignar también
    
    db = fbLib.db
    const auth = fbLib.auth

    currentUser = auth.currentUser
    if (!currentUser) {
      console.error('No autenticado')
      return
    }

    const usersSnap = await getDocs(collection(db, 'users'))
    militantes = []
    const locales = new Set()
    usersSnap.forEach(d => {
      const data = d.data()
      if (data.role === 'user') {
        militantes.push({ uid: d.id, nombre: data.displayName || data.email, email: data.email })
      }
    })

    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    allRecords = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    allRecords.forEach(r => { if (r.local) locales.add(r.local) })

    const selectLocal = document.getElementById('chofer-local')
    if (selectLocal) {
      locales.forEach(local => {
        const opt = document.createElement('option')
        opt.value = local
        opt.textContent = local
        selectLocal.appendChild(opt)
      })
    }

    const choferesSnap = await getDocs(collection(db, 'choferes'))
    choferes = choferesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Listener en tiempo real para choferes
    onSnapshot(collection(db, 'choferes'), (choferesRealtime) => {
      choferes = choferesRealtime.docs.map(d => ({ id: d.id, ...d.data() }))
      // Actualizar tab de choferes si está visible
      renderChoferes(choferes, db, setDoc, doc, addDoc, deleteDoc, currentUser)
    })

    // Listener Día D Config
    onSnapshot(
      doc(db, 'config', 'electionDay'),
      docSnap => {
        const enabled = docSnap.exists() ? docSnap.data().enabled : false
        const toggle = document.getElementById('toggle-election-day')
        const label = document.getElementById('toggle-label')
        const warning = document.getElementById('toggle-warning')
        
        if (toggle) {
          toggle.checked = enabled
          if (label) label.textContent = enabled ? 'Habilitado' : 'Deshabilitado'
          if (label) label.style.color = enabled ? '#2e7d32' : '#ff9800'
          if (warning) {
            warning.innerHTML = enabled ? '<strong>Día D HABILITADO</strong>' : '<strong>Día D DESHABILITADO</strong>'
            warning.style.background = enabled ? '#c8e6c9' : '#fff3cd'
            warning.style.borderLeftColor = enabled ? '#2e7d32' : '#ff9800'
            warning.style.color = enabled ? '#1b5e20' : '#e65100'
          }
        }
      }
    )

    onSnapshot(
      collection(db, 'dia_d_votos'),
      votosSnap => {
        allVotos = votosSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        getDocs(collection(db, 'savedRecords')).then(votantesSnap => {
          const totalV = votantesSnap.size
          const totalVotos = votosSnap.size
          const pct = totalV > 0 ? ((totalVotos / totalV) * 100).toFixed(2) : 0

          document.getElementById('total-militantes').textContent = militantes.length
          document.getElementById('total-votantes').textContent = totalV
          document.getElementById('total-votos').textContent = totalVotos
          document.getElementById('total-pct').textContent = pct

          const porMil = {}
          militantes.forEach(m => {
            porMil[m.uid] = { nombre: m.nombre, email: m.email, votos: 0, registros: [] }
          })

          allRecords.forEach(r => {
            if (porMil[r.uid]) porMil[r.uid].registros.push(r)
          })

          allVotos.forEach(v => {
            if (porMil[v.militante_id] && v.estado === 'votó') porMil[v.militante_id].votos++
          })

          renderRanking(porMil, allVotos, allRecords, choferes, db, setDoc, addDoc, doc)
          renderLocales(allRecords, allVotos)
          renderChoferes(choferes, allRecords, allVotos, db, deleteDoc)
        })
      }
    )

    document.getElementById('btn-agregar-chofer').addEventListener('click', async () => {
      const nombre = document.getElementById('chofer-nombre').value
      const telefono = document.getElementById('chofer-telefono').value
      const local = document.getElementById('chofer-local').value

      if (!nombre || !telefono || !local) {
        alert('Completa los campos')
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
        alert('Chofer agregado')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

  } catch (err) {
    console.error('Error en loadAndRender:', err)
    alert('Error cargando admin: ' + err.message)
  }
}

function updateToggle(enabled, db, setDoc, doc, uid) {
  const toggle = document.getElementById('toggle-election-day')
  const label = document.getElementById('toggle-label')
  const warning = document.getElementById('toggle-warning')

  if (toggle) {
    toggle.checked = enabled
    toggle.onclick = async () => {
      try {
        toggle.disabled = true
        await setDoc(doc(db, 'config', 'electionDay'), {
          enabled: toggle.checked,
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
    label.textContent = enabled ? 'Habilitado' : 'Deshabilitado'
    label.style.color = enabled ? '#2e7d32' : '#ff9800'
  }

  if (warning) {
    warning.innerHTML = enabled ? '<strong>Día D HABILITADO</strong>' : '<strong>Día D DESHABILITADO</strong>'
    warning.style.background = enabled ? '#c8e6c9' : '#fff3cd'
    warning.style.borderLeftColor = enabled ? '#2e7d32' : '#ff9800'
    warning.style.color = enabled ? '#1b5e20' : '#e65100'
  }
}

function renderRanking(porMil, allVotos, allRecords, choferes, db, setDoc, addDoc, doc) {
  const ranking = Object.entries(porMil)
    .map(([uid, data]) => ({ uid, ...data }))
    .sort((a, b) => b.votos - a.votos)

  let html = ''
  ranking.forEach((m, idx) => {
    const pct = m.registros.length > 0 ? ((m.votos / m.registros.length) * 100).toFixed(2) : 0
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '👤'
    const color = pct >= 75 ? '#2e7d32' : pct >= 50 ? '#ff9800' : '#f44336'

    html += '<div style="background: #fafafa; border-radius: 8px; padding: 16px; border-left: 4px solid ' + color + ';">'
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
    html += '<div><div style="font-weight: 700;">' + medal + ' ' + m.nombre + '</div><div style="font-size: 0.75rem; color: #999;">' + m.email + '</div></div>'
    html += '<div style="text-align: right;"><div style="font-size: 1.3rem; font-weight: 700; color: ' + color + ';">' + m.votos + '/' + m.registros.length + '</div><div style="font-size: 0.75rem;">' + pct + '%</div></div></div>'
    html += '<div style="background: white; border-radius: 4px; height: 8px; margin-bottom: 10px;"><div style="background: ' + color + '; height: 100%; width: ' + Math.min(pct, 100) + '%;"></div></div>'
    html += '<button class="btn-detalle" data-uid="' + m.uid + '" data-nombre="' + m.nombre + '" style="background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: 700;">Detalle</button>'
    html += '</div>'
  })

  const el = document.getElementById('militantes-ranking')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-detalle').forEach(btn => {
      btn.onclick = () => {
        try {
          const uid = btn.dataset.uid
          const nombre = btn.dataset.nombre
          if (!uid || !nombre) {
            alert('Error: UID o nombre no disponible')
            return
          }
          if (!porMil[uid]) {
            alert('Error: Militante no encontrado en ranking')
            return
          }
          const registros = porMil[uid].registros
          const votos = allVotos.filter(v => v.militante_id === uid || registros.some(r => r.cedula === v.cedula))
          mostrarDetalle(nombre, registros, votos, choferes, db, setDoc, doc)
        } catch (err) {
          alert('Error al abrir detalle: ' + err.message)
          console.error(err)
        }
      }
    })
  }
}

function renderLocales(allRecords, allVotos) {
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
    let votosL = 0, totalL = 0
    Object.values(mesas).forEach(regs => {
      regs.forEach(r => {
        totalL++
        if (allVotos.some(v => v.cedula === r.cedula && v.voted)) votosL++
      })
    })

    const pctL = totalL > 0 ? ((votosL / totalL) * 100).toFixed(2) : 0

    html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
    html += '<h4 style="margin: 0; color: #2e7d32;">' + local + '</h4>'
    html += '<div style="font-weight: 700; color: #2e7d32;">' + votosL + '/' + totalL + ' (' + pctL + '%)</div></div>'

    Object.entries(mesas).forEach(([mesa, registros]) => {
      let votosM = 0
      registros.forEach(r => {
        if (allVotos.some(v => v.cedula === r.cedula && v.voted)) votosM++
      })
      const pctM = registros.length > 0 ? ((votosM / registros.length) * 100).toFixed(2) : 0

      html += '<div style="background: #f9f9f9; border-left: 4px solid #ff9800; padding: 12px; margin-bottom: 8px; border-radius: 4px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">'
      html += '<div style="font-weight: 600;">Mesa ' + mesa + '</div>'
      html += '<div style="font-size: 0.85rem;">' + votosM + '/' + registros.length + ' (' + pctM + '%)</div></div>'
      html += '<button class="btn-mesa" data-local="' + local + '" data-mesa="' + mesa + '" style="background: #ff9800; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Ver</button>'
      html += '</div>'
    })

    html += '</div>'
  })

  const el = document.getElementById('locales-container')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-mesa').forEach(btn => {
      btn.onclick = () => {
        mostrarMesa(btn.dataset.local, btn.dataset.mesa, allRecords, allVotos)
      }
    })
  }
}

function renderChoferes(choferes, allRecords, allVotos, db, deleteDoc) {
  let html = ''
  
  if (choferes.length === 0) {
    html = '<div style="text-align: center; padding: 40px; color: #999;">Sin choferes</div>'
  } else {
    choferes.forEach(chofer => {
      const faltantes = allRecords.filter(r => r.local === chofer.local && r.chofer_asignado === chofer.id && !allVotos.some(v => v.cedula === r.cedula && v.voted))
      
      html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
      html += '<div><div style="font-weight: 700;">🚗 ' + chofer.nombre + '</div><div style="font-size: 0.85rem; color: #666;">📱 ' + chofer.telefono + ' | 📍 ' + chofer.local + '</div></div>'
      html += '<div style="text-align: right;"><div style="font-size: 1.5rem; font-weight: 700; color: #c41e3a;">' + faltantes.length + '</div><div style="font-size: 0.75rem;">Faltantes</div></div>'
      html += '</div>'

      if (faltantes.length > 0) {
        html += '<div style="background: #fff9e6; border-radius: 4px; padding: 12px; max-height: 200px; overflow-y: auto;">'
        faltantes.forEach(p => {
          html += '<div style="padding: 6px; border-bottom: 1px solid #ffe0b2; font-size: 0.85rem;">'
          html += '<div style="font-weight: 600;">' + p.nombre + '</div>'
          html += '<div style="color: #666;">CI: ' + p.cedula + ' | Mesa: ' + p.mesa + '</div>'
          html += '</div>'
        })
        html += '</div>'
      } else {
        html += '<div style="background: #f9f9f9; border-radius: 4px; padding: 12px; text-align: center; color: #999; font-size: 0.85rem;">Sin faltantes</div>'
      }

      html += '<button class="btn-del-chofer" data-id="' + chofer.id + '" style="background: #ff5252; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; margin-top: 8px; width: 100%;">Eliminar</button>'
      html += '</div>'
    })
  }

  const el = document.getElementById('choferes-lista')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-del-chofer').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('Eliminar chofer?')) {
          try {
            await deleteDoc(doc(db, 'choferes', btn.dataset.id))
            alert('Eliminado')
          } catch (err) {
            alert('Error: ' + err.message)
          }
        }
      }
    })
  }
}

function mostrarDetalle(nombre, registros, votos, choferes, db, setDoc, doc) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  // Filtrar por ESTADO (no por voted boolean)
  const votados = votos.filter(v => v.estado === 'votó')
  const enCamino = votos.filter(v => v.estado === 'en_camino')
  const faltantes = registros.filter(r => !votos.some(v => v.cedula === r.cedula))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">Detalle: ' + nombre + '</h2>'
  html += '<button onclick="this.closest(\'div\').parentElement.parentElement.remove()" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">X</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">🟢 YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(v => {
      const r = registros.find(x => x.cedula === v.cedula)
      if (r) {
        html += '<div style="background: #e8f5e9; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid #2e7d32;">'
        html += '<div style="font-weight: 600;">' + (v.nombre || r.nombre) + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333;">CI: ' + v.cedula + ' | Local: ' + (r.local || 'N/A') + ' | Mesa: ' + (r.mesa || 'N/A') + '</div>'
        if (v.choferAsignado) {
          html += '<div style="font-size: 0.8rem; color: #1b5e20; margin-top: 4px;">🚗 Chofer: ' + v.choferAsignado + '</div>'
        }
        html += '</div>'
      }
    })
    html += '</div>'
  }

  if (enCamino.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">🟡 EN CAMINO (' + enCamino.length + ') - SOLO LECTURA</h3>'
    enCamino.forEach(v => {
      const r = registros.find(x => x.cedula === v.cedula)
      if (r) {
        html += '<div style="background: #fff9e6; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid #ff9800;">'
        html += '<div style="font-weight: 600;">' + (v.nombre || r.nombre) + '</div>'
        html += '<div style="font-size: 0.8rem; color: #333;">CI: ' + v.cedula + ' | Local: ' + (r.local || 'N/A') + ' | Mesa: ' + (r.mesa || 'N/A') + '</div>'
        if (v.choferAsignado || v.horarioBusqueda || v.direccionRecogida) {
          html += '<div style="font-size: 0.8rem; color: #e65100; margin-top: 4px;">'
          if (v.choferAsignado) html += '🚗 ' + v.choferAsignado + ' | '
          if (v.horarioBusqueda) html += '⏰ ' + v.horarioBusqueda + ' | '
          if (v.direccionRecogida) html += '📍 ' + v.direccionRecogida
          html += '</div>'
        }
        html += '</div>'
      }
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #c41e3a; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">🔴 NO VOTÓ (' + faltantes.length + ')</h3>'
    faltantes.forEach(r => {
      const msgWA = encodeURIComponent('Buen día, ' + r.nombre + '.\nTe estamos esperando para que juntos cambiemos el destino de nuestra ciudad.\n🗳️ Votá Lista 6 – Opción 1 Samy Fidabel\n📍 Lugar: ' + (r.local || 'N/A') + '\n📋 Mesa: ' + (r.mesa || 'N/A') + '\n🔢 Orden: ' + (r.orden || 'N/A') + '\nTu voto hace la diferencia.')
      const waLink = 'https://wa.me/' + (r.telefono || '') + '?text=' + msgWA

      html += '<div style="background: #ffebee; padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 4px solid #c41e3a;">'
      html += '<div style="font-weight: 600; margin-bottom: 6px;">' + (r.nombre || 'N/A') + '</div>'
      html += '<div style="font-size: 0.8rem; color: #333; margin-bottom: 8px;">CI: ' + r.cedula + ' | Local: ' + (r.local || 'N/A') + ' | Mesa: ' + (r.mesa || 'N/A') + ' | 📱 ' + (r.telefono || 'Sin teléfono') + '</div>'
      
      html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">'
      html += '<div><label style="font-size: 0.8rem; font-weight: 600;">🚗 Chofer:</label>'
      html += '<select class="chofer-select-' + r.cedula + '" data-cedula="' + r.cedula + '" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;">'
      html += '<option value="">Selecciona chofer</option>'
      choferes.forEach(c => {
        html += '<option value="' + c.nombre + '">' + c.nombre + ' (' + (c.telefono || 'sin tel') + ')</option>'
      })
      html += '<option value="NUEVO">➕ Nuevo chofer</option>'
      html += '</select></div>'
      
      // Precargar chofer si existe
      const votoExistente = votos.find(v => v.cedula === r.cedula)
      const choferGuardado = votoExistente?.choferAsignado || ''
      const horaGuardada = votoExistente?.horarioBusqueda || ''
      const dirGuardada = votoExistente?.direccionRecogida || ''
      
      html += '<div><label style="font-size: 0.8rem; font-weight: 600;">⏰ Horario:</label>'
      html += '<input type="time" class="hora-' + r.cedula + '" data-cedula="' + r.cedula + '" value="' + horaGuardada + '" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;"></div>'
      html += '</div>'
      
      html += '<div style="margin-bottom: 8px;"><label style="font-size: 0.8rem; font-weight: 600;">📍 Dirección de recogida:</label>'
      html += '<input type="text" class="dir-' + r.cedula + '" data-cedula="' + r.cedula + '" placeholder="Calle y nº" value="' + dirGuardada + '" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;"></div>'
      
      html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">'
      html += '<button class="btn-guardar-' + r.cedula + '" data-cedula="' + r.cedula + '" style="background: #1976d2; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">💾 Guardar</button>'

      if (r.telefono) {
        html += '<a href="' + waLink + '" target="_blank" style="background: #25d366; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 0.8rem; font-weight: 600; display: inline-block;">Enviar WA</a>'
      }
      
      html += '</div>'
    })
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)

  // Precargar valores en dropdowns después de crear el modal
  faltantes.forEach(r => {
    const votoExistente = votos.find(v => v.cedula === r.cedula)
    if (votoExistente && votoExistente.choferAsignado) {
      const choferSelect = modal.querySelector('.chofer-select-' + r.cedula)
      if (choferSelect) {
        choferSelect.value = votoExistente.choferAsignado
      }
    }
  })

  // Event listeners para botones Guardar
  faltantes.forEach(r => {
    const btnGuardar = modal.querySelector('.btn-guardar-' + r.cedula)
    const choferSelect = modal.querySelector('.chofer-select-' + r.cedula)
    const horaInput = modal.querySelector('.hora-' + r.cedula)
    const dirInput = modal.querySelector('.dir-' + r.cedula)

    if (btnGuardar) {
      btnGuardar.addEventListener('click', async () => {
        const choferNombre = choferSelect.value
        const hora = horaInput.value
        const direccion = dirInput.value

        // Crear nuevo chofer si selecciona "NUEVO"
        if (choferNombre === 'NUEVO') {
          const nombre = prompt('Nombre del nuevo chofer:')
          if (nombre) {
            const tel = prompt('Teléfono:') || ''
            const { addDoc, collection } = await import('firebase/firestore')
            try {
              await addDoc(collection(db, 'choferes'), {
                nombre: nombre,
                telefono: tel,
                vehiculo: 'Vehículo',
                activo: true,
                createdAt: new Date()
              })
              choferSelect.innerHTML += '<option value="' + nombre + '">' + nombre + ' (' + tel + ')</option>'
              choferSelect.value = nombre
              alert('✅ Chofer agregado')
              return
            } catch (err) {
              alert('Error: ' + err.message)
              return
            }
          }
          return
        }

        // Guardar chofer + hora + dirección
        const votoExistente = votos.find(v => v.cedula === r.cedula)
        try {
          const { getDoc } = await import('firebase/firestore')
          
          if (votoExistente) {
            // Actualizar voto existente - usar ID del documento
            const votoDocRef = doc(db, 'dia_d_votos', votoExistente.id || r.cedula)
            await setDoc(votoDocRef, { 
              choferAsignado: choferNombre || null, 
              horarioBusqueda: hora || null, 
              direccionRecogida: direccion || null, 
              ultimoCambio: new Date() 
            }, { merge: true })
          } else {
            // Crear nuevo voto
            const { addDoc, collection } = await import('firebase/firestore')
            await addDoc(collection(db, 'dia_d_votos'), {
              cedula: r.cedula,
              nombre: r.nombre,
              militante_id: 'admin',
              estado: 'no_votó',
              choferAsignado: choferNombre || null,
              horarioBusqueda: hora || null,
              direccionRecogida: direccion || null,
              timestamp: new Date(),
              ultimoCambio: new Date()
            })
          }
          
          // Actualizar UI después de guardar
          btnGuardar.textContent = '✅ Guardado'
          btnGuardar.style.background = '#2e7d32'
          choferSelect.disabled = true
          horaInput.disabled = true
          dirInput.disabled = true
          
          setTimeout(() => {
            btnGuardar.textContent = '💾 Guardar'
            btnGuardar.style.background = '#1976d2'
          }, 2000)
          
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }
  })

  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}

function mostrarMesa(local, mesa, allRecords, allVotos) {
  const registrosMesa = allRecords.filter(r => r.local === local && r.mesa === mesa)
  
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  const votados = registrosMesa.filter(r => allVotos.some(v => v.cedula === r.cedula && v.voted))
  const faltantes = registrosMesa.filter(r => !allVotos.some(v => v.cedula === r.cedula && v.voted))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">Local: ' + local + ' | Mesa: ' + mesa + '</h2>'
  html += '<button onclick="this.closest(\'div\').parentElement.parentElement.remove()" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">X</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'
  html += '<div style="margin-bottom: 12px; font-weight: 600;">Total: ' + registrosMesa.length + ' | Votados: ' + votados.length + ' | Faltantes: ' + faltantes.length + '</div>'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 20px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(r => {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 4px solid #2e7d32;">'
      html += '<div style="font-weight: 600;">' + r.nombre + '</div>'
      html += '<div style="color: #666;">CI: ' + r.cedula + ' | Orden: ' + r.orden + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">FALTANTES (' + faltantes.length + ')</h3>'
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