/**
 * MÓDULO: DÍA D - ADMIN V4
 * 
 * ARQUITECTURA SIMPLIFICADA:
 * - savedRecords = ÚNICA fuente de verdad
 * - Admin solo ve estadísticas globales (derivadas)
 * - Control de toggle Día D
 * - Gestión de choferes
 * - NO sincronización bidireccional
 */

export function renderDiaDAdmin(container) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚙️ DÍA D - ADMIN</h2>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div style="display: grid; gap: 20px;">
      <!-- CONTROL VOTACIÓN -->
      <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0 0 6px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🗳️ Control Votación</h3>
            <p style="margin: 0; font-size: 0.85rem; color: #666;">Habilita/deshabilita Día D</p>
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
          <button id="tab-estadisticas" style="flex: 1; padding: 16px; background: #1976d2; color: white; border: none; cursor: pointer; font-weight: 700;">Estadísticas</button>
          <button id="tab-choferes" style="flex: 1; padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">Choferes</button>
        </div>

        <!-- TAB ESTADÍSTICAS -->
        <div id="content-estadisticas" style="padding: 24px;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">📊 Global</h3>
          
          <!-- BÚSQUEDA Y EDICIÓN -->
          <div style="background: #f9f9f9; border: 2px dashed #1976d2; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 16px 0;">🔍 Buscar y Editar Votante</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-bottom: 16px;">
              <input type="text" id="search-votante" placeholder="Busca por CI o nombre..." style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;">
              <button id="btn-buscar-votante" style="background: #1976d2; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">Buscar</button>
            </div>
            <div id="votante-search-result" style="display: none; background: #e3f2fd; border: 1px solid #1976d2; border-radius: 4px; padding: 16px;"></div>
          </div>

          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">📊 Estadísticas Globales</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px;">
            <div style="background: #f3e5f5; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">0</div>
              <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">MILITANTES</div>
            </div>
            <div style="background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">0</div>
              <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">VOTANTES</div>
            </div>
            <div style="background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-en-camino" style="font-size: 2rem; font-weight: 700; color: #e65100;">0</div>
              <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">EN CAMINO</div>
            </div>
            <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votos" style="font-size: 2rem; font-weight: 700; color: #2e7d32;">0</div>
              <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">VOTOS</div>
            </div>
            <div style="background: #f1f8e9; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-pct" style="font-size: 2rem; font-weight: 700; color: #558b2f;">0%</div>
              <div style="font-size: 0.8rem; color: #33691e; font-weight: 600;">PARTICIPACIÓN</div>
            </div>
          </div>

          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">🏆 Ranking Global</h3>
          <div id="ranking-container" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>

        <!-- TAB CHOFERES -->
        <div id="content-choferes" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🚗 Choferes</h3>
          
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

          <h4 style="margin: 0 0 12px 0;">Choferes Registrados</h4>
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
    document.getElementById('content-estadisticas').style.display = tab === 'estadisticas' ? 'block' : 'none'
    document.getElementById('content-choferes').style.display = tab === 'choferes' ? 'block' : 'none'
    
    document.getElementById('tab-estadisticas').style.background = tab === 'estadisticas' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-estadisticas').style.color = tab === 'estadisticas' ? 'white' : '#333'
    document.getElementById('tab-choferes').style.background = tab === 'choferes' ? '#c41e3a' : '#f5f5f5'
    document.getElementById('tab-choferes').style.color = tab === 'choferes' ? 'white' : '#333'
  }

  document.getElementById('tab-estadisticas').addEventListener('click', () => switchTab('estadisticas'))
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
    const { collection, getDocs, doc, onSnapshot, addDoc, deleteDoc, setDoc, serverTimestamp, updateDoc } = firebaseImport
    const fbLib = await import('../lib/firebase.js')
    const db = fbLib.db
    const auth = fbLib.auth

    const currentUser = auth.currentUser
    if (!currentUser) {
      alert('No estás autenticado')
      return
    }

    // CARGAR DATOS
    let records = []
    let users = []
    let choferes = []
    let electionDayEnabled = false

    async function loadData() {
      const recordsSnap = await getDocs(collection(db, 'savedRecords'))
      const usersSnap = await getDocs(collection(db, 'users'))
      const choferesSnap = await getDocs(collection(db, 'choferes'))
      const configSnap = await getDocs(collection(db, 'config'))

      records = []
      users = []
      choferes = []

      recordsSnap.forEach(d => {
        records.push({ id: d.id, ...d.data() })
      })

      usersSnap.forEach(d => {
        users.push({ id: d.id, ...d.data() })
      })

      choferesSnap.forEach(d => {
        choferes.push({ id: d.id, ...d.data() })
      })

      const configDoc = configSnap.docs.find(d => d.id === 'electionDay')
      electionDayEnabled = configDoc?.data()?.enabled || false
    }

    await loadData()

    // FUNCIONES RENDER
    function calcularEstadisticas() {
      const militantesSet = new Set(records.map(r => r.militante_id))
      const totalMilitantes = militantesSet.size
      const totalVotantes = records.length
      const totalVotos = records.filter(r => r.estado_dia_d === 'voto').length
      const totalEnCamino = records.filter(r => r.estado_dia_d === 'en_camino').length
      const participacion = totalVotantes > 0 ? ((totalVotos / totalVotantes) * 100).toFixed(1) : 0

      return { totalMilitantes, totalVotantes, totalVotos, totalEnCamino, participacion }
    }

    function generarRanking() {
      const militantesMap = new Map()

      records.forEach(r => {
        if (!militantesMap.has(r.militante_id)) {
          const user = users.find(u => u.id === r.militante_id)
          militantesMap.set(r.militante_id, {
            id: r.militante_id,
            nombre: user?.nombre || 'Sin nombre',
            votos: 0,
            enCamino: 0,
            noVoto: 0,
            total: 0
          })
        }

        const mil = militantesMap.get(r.militante_id)
        mil.total += 1
        if (r.estado_dia_d === 'voto') mil.votos += 1
        else if (r.estado_dia_d === 'en_camino') mil.enCamino += 1
        else mil.noVoto += 1
      })

      return Array.from(militantesMap.values()).sort((a, b) => {
        if (b.votos !== a.votos) return b.votos - a.votos
        if (b.enCamino !== a.enCamino) return b.enCamino - a.enCamino
        return b.total - a.total
      })
    }

    function renderEstadisticas() {
      const stats = calcularEstadisticas()
      const els = {
        militantes: document.getElementById('total-militantes'),
        votantes: document.getElementById('total-votantes'),
        enCamino: document.getElementById('total-en-camino'),
        votos: document.getElementById('total-votos'),
        pct: document.getElementById('total-pct')
      }

      if (els.militantes) els.militantes.textContent = stats.totalMilitantes
      if (els.votantes) els.votantes.textContent = stats.totalVotantes
      if (els.enCamino) els.enCamino.textContent = stats.totalEnCamino
      if (els.votos) els.votos.textContent = stats.totalVotos
      if (els.pct) els.pct.textContent = stats.participacion + '%'
    }

    function renderRanking() {
      const ranking = generarRanking()
      const container = document.getElementById('ranking-container')
      if (!container) return

      let html = ''
      ranking.forEach((mil, idx) => {
        const progreso = mil.total > 0 ? ((mil.votos / mil.total) * 100).toFixed(0) : 0
        html += `
          <div style="background: white; border: 2px solid #ddd; border-radius: 8px; padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div>
                <span style="font-weight: 700; font-size: 1.1rem; color: #333;">#${idx + 1} ${mil.nombre}</span>
                <span style="background: #2e7d32; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; font-weight: 600;">${mil.votos}/${mil.total}</span>
              </div>
              <div style="text-align: right; font-size: 0.9rem; font-weight: 700; color: #2e7d32;">${progreso}%</div>
            </div>
            <div style="background: #f5f5f5; border-radius: 4px; height: 20px; overflow: hidden;">
              <div style="background: linear-gradient(90deg, #2e7d32 0%, #4caf50 100%); height: 100%; width: ${progreso}%; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; color: white; font-size: 0.7rem; font-weight: 600;">
                ${progreso > 5 ? progreso + '%' : ''}
              </div>
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 12px; margin-top: 10px; font-size: 0.8rem;">
              <span style="color: #2e7d32; font-weight: 600;">✅ ${mil.votos}</span>
              <span style="color: #999;">votó</span>
              <span style="color: #ff9800; font-weight: 600;">🟡 ${mil.enCamino}</span>
              <span style="color: #999;">en camino</span>
              <span style="color: #f44336; font-weight: 600;">🔴 ${mil.noVoto}</span>
              <span style="color: #999;">sin votar</span>
            </div>
          </div>
        `
      })

      container.innerHTML = html
    }

    function renderChoferes() {
      const container = document.getElementById('choferes-lista')
      if (!container) return

      // Extraer locales únicos
      const locales = [...new Set(records.map(r => r.local))]
      const selectLocal = document.getElementById('chofer-local')
      if (selectLocal && locales.length > 0) {
        selectLocal.innerHTML = '<option value="">Selecciona Local</option>' + 
          locales.map(l => `<option value="${l}">${l}</option>`).join('')
      }

      let html = ''
      choferes.forEach(chofer => {
        const votantesAsignados = records.filter(r => r.chofer_asignado === chofer.id)
        html += `
          <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; color: #333;">${chofer.nombre}</div>
              <div style="font-size: 0.85rem; color: #666;">📍 ${chofer.local} | 📱 ${chofer.telefono}</div>
              <div style="font-size: 0.8rem; color: #999; margin-top: 4px;">${votantesAsignados.length} votante(s) asignado(s)</div>
            </div>
            <button onclick="if(confirm('¿Eliminar chofer ${chofer.nombre}?')) {
              const btn = this;
              btn.disabled = true;
              btn.textContent = 'Eliminando...';
              eliminarChofer('${chofer.id}').then(() => {
                alert('Eliminado');
                location.reload();
              }).catch(e => {
                alert('Error: ' + e.message);
                btn.disabled = false;
                btn.textContent = '🗑️ Eliminar';
              });
            }" style="background: #f44336; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600;">🗑️ Eliminar</button>
          </div>
        `
      })

      container.innerHTML = html || '<div style="text-align: center; padding: 40px; color: #999;">Sin choferes registrados</div>'
    }

    // TOGGLE VOTACIÓN
    const toggleCheckbox = document.getElementById('toggle-election-day')
    const toggleLabel = document.getElementById('toggle-label')
    const toggleWarning = document.getElementById('toggle-warning')

    function updateToggleUI() {
      if (toggleCheckbox) {
        toggleCheckbox.checked = electionDayEnabled
        toggleLabel.textContent = electionDayEnabled ? 'Habilitado' : 'Deshabilitado'
        toggleLabel.style.color = electionDayEnabled ? '#2e7d32' : '#ff9800'
        toggleWarning.innerHTML = electionDayEnabled 
          ? '<strong>Día D HABILITADO</strong>' 
          : '<strong>Día D DESHABILITADO</strong>'
        toggleWarning.style.background = electionDayEnabled ? '#c8e6c9' : '#fff3cd'
        toggleWarning.style.borderLeftColor = electionDayEnabled ? '#2e7d32' : '#ff9800'
        toggleWarning.style.color = electionDayEnabled ? '#1b5e20' : '#e65100'
      }
    }

    if (toggleCheckbox) {
      toggleCheckbox.addEventListener('change', async (e) => {
        try {
          electionDayEnabled = e.target.checked
          await setDoc(doc(db, 'config', 'electionDay'), { enabled: electionDayEnabled }, { merge: true })
          updateToggleUI()
        } catch (err) {
          alert('Error: ' + err.message)
          electionDayEnabled = !electionDayEnabled
          updateToggleUI()
        }
      })
    }

    // AGREGAR CHOFER
    const btnAgregarChofer = document.getElementById('btn-agregar-chofer')
    if (btnAgregarChofer) {
      btnAgregarChofer.addEventListener('click', async () => {
        const nombre = document.getElementById('chofer-nombre')?.value
        const telefono = document.getElementById('chofer-telefono')?.value
        const local = document.getElementById('chofer-local')?.value

        if (!nombre || !telefono || !local) {
          alert('Completa todos los campos')
          return
        }

        try {
          btnAgregarChofer.disabled = true
          btnAgregarChofer.textContent = 'Agregando...'
          await addDoc(collection(db, 'choferes'), {
            nombre,
            telefono,
            local,
            createdAt: serverTimestamp()
          })
          document.getElementById('chofer-nombre').value = ''
          document.getElementById('chofer-telefono').value = ''
          document.getElementById('chofer-local').value = ''
          alert('Chofer agregado')
          renderChoferes()
          btnAgregarChofer.disabled = false
          btnAgregarChofer.textContent = 'Agregar'
        } catch (err) {
          alert('Error: ' + err.message)
          btnAgregarChofer.disabled = false
          btnAgregarChofer.textContent = 'Agregar'
        }
      })
    }

    // BUSCAR Y EDITAR VOTANTE
    const btnBuscarVotante = document.getElementById('btn-buscar-votante')
    if (btnBuscarVotante) {
      btnBuscarVotante.addEventListener('click', () => {
        const searchInput = document.getElementById('search-votante').value.toLowerCase()
        const votante = records.find(r => 
          r.cedula.toLowerCase().includes(searchInput) || 
          (r.nombre && r.nombre.toLowerCase().includes(searchInput))
        )

        const resultContainer = document.getElementById('votante-search-result')
        if (!votante) {
          resultContainer.innerHTML = '<div style="color: #f44336; font-weight: 600;">❌ Votante no encontrado</div>'
          resultContainer.style.display = 'block'
          return
        }

        let html = `
          <div style="margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: #1565c0;">${votante.nombre}</h3>
            <div style="display: grid; gap: 8px; margin-bottom: 16px;">
              <div><strong>CI:</strong> ${votante.cedula}</div>
              <div><strong>Local:</strong> ${votante.local}</div>
              <div><strong>Mesa:</strong> ${votante.mesa}</div>
              <div><strong>Orden:</strong> ${votante.orden}</div>
              <div><strong>Estado:</strong> <span style="padding: 4px 8px; border-radius: 4px; background: ${votante.estado_dia_d === 'voto' ? '#2e7d32' : votante.estado_dia_d === 'en_camino' ? '#ff9800' : '#f44336'}; color: white;">${votante.estado_dia_d}</span></div>
              <div><strong>Chofer:</strong> ${votante.chofer_asignado ? choferes.find(c => c.id === votante.chofer_asignado)?.nombre || 'Desconocido' : 'Sin asignar'}</div>
            </div>

            <div style="background: white; border: 1px solid #ddd; border-radius: 4px; padding: 12px; margin-bottom: 12px;">
              <h4 style="margin: 0 0 12px 0; color: #1976d2;">Editar</h4>
              <div style="display: grid; gap: 10px;">
                <label>
                  <strong>Nombre</strong><br>
                  <input type="text" id="edit-nombre" value="${votante.nombre}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
                </label>
                <label>
                  <strong>Teléfono</strong><br>
                  <input type="text" id="edit-telefono" value="${votante.telefono || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
                </label>
                <label>
                  <strong>Estado Día D</strong><br>
                  <select id="edit-estado" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    <option value="no_voto" ${votante.estado_dia_d === 'no_voto' ? 'selected' : ''}>🔴 Sin votar</option>
                    <option value="en_camino" ${votante.estado_dia_d === 'en_camino' ? 'selected' : ''}>🟡 En camino</option>
                    <option value="voto" ${votante.estado_dia_d === 'voto' ? 'selected' : ''}>✅ Votó</option>
                  </select>
                </label>
                <label>
                  <strong>Militante Asignado</strong><br>
                  <select id="edit-militante" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    ${users.map(u => `<option value="${u.id}" ${votante.militante_id === u.id ? 'selected' : ''}>${u.nombre || u.email}</option>`).join('')}
                  </select>
                </label>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
                <button onclick="document.getElementById('votante-search-result').style.display='none'" style="background: #ddd; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">Cancelar</button>
                <button id="btn-guardar-votante" style="background: #2e7d32; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 700;">Guardar</button>
              </div>
            </div>
          </div>
        `
        resultContainer.innerHTML = html
        resultContainer.style.display = 'block'

        // Event listener para guardar
        document.getElementById('btn-guardar-votante').addEventListener('click', async () => {
          const updatedData = {
            nombre: document.getElementById('edit-nombre').value,
            telefono: document.getElementById('edit-telefono').value,
            estado_dia_d: document.getElementById('edit-estado').value,
            militante_id: document.getElementById('edit-militante').value,
            updatedAt: serverTimestamp()
          }

          try {
            const btn = document.getElementById('btn-guardar-votante')
            btn.disabled = true
            btn.textContent = 'Guardando...'
            await updateDoc(doc(db, 'savedRecords', votante.id), updatedData)
            alert('Votante actualizado')
            document.getElementById('search-votante').value = ''
            resultContainer.style.display = 'none'
            btn.disabled = false
            btn.textContent = 'Guardar'
          } catch (err) {
            alert('Error: ' + err.message)
            document.getElementById('btn-guardar-votante').disabled = false
            document.getElementById('btn-guardar-votante').textContent = 'Guardar'
          }
        })
      })
    }

    // ENTER en búsqueda
    const searchInput = document.getElementById('search-votante')
    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('btn-buscar-votante').click()
        }
      })
    }

    // EXPONER FUNCIÓN GLOBAL
    window.eliminarChofer = (id) => {
      return deleteDoc(doc(db, 'choferes', id))
    }

    // RENDER INICIAL
    updateToggleUI()
    renderEstadisticas()
    renderRanking()
    renderChoferes()

    // LISTENER EN TIEMPO REAL
    const recordsUnsubscribe = onSnapshot(collection(db, 'savedRecords'), () => {
      loadData().then(() => {
        renderEstadisticas()
        renderRanking()
        renderChoferes()
      })
    })

    return () => recordsUnsubscribe()
  } catch (err) {
    console.error('Error:', err)
    alert('Error: ' + err.message)
  }
}