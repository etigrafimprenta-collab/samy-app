/**
 * MÓDULO: DÍA D - PANEL CONTROL V1
 * Rol exclusivo: CONTROL
 * - Vista global de todos los militantes
 * - Edición de estados (no_voto → en_camino → voto)
 * - Asignación/cambio de choferes
 * - Ranking dinámico + estadísticas
 * - Sincronización en tiempo real con savedRecords
 * - Integración con WhatsApp
 */

export function renderDiaDControl(container) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🎮 CONTROL - DÍA D</h2>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div style="display: grid; gap: 20px;">
      <!-- ESTADÍSTICAS EN TIEMPO REAL -->
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 24px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">📊 Estadísticas Global</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
          <div style="background: #f3e5f5; border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">0</div>
            <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">MILITANTES</div>
          </div>
          <div style="background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
            <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">0</div>
            <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">VOTANTES ASIGNADOS</div>
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
      </div>

      <!-- RANKING DINÁMICO -->
      <div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 24px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">🏆 Ranking / Seguimiento</h3>
        <div id="ranking-container" style="display: grid; gap: 12px;">
          <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
        </div>
      </div>

      <!-- DETALLE POR MILITANTE (BÚSQUEDA) -->
      <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 24px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🔍 Detalle Por Militante</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-bottom: 20px;">
          <input type="text" id="search-militante" placeholder="Busca por nombre..." style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;">
          <select id="filter-estado" style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;">
            <option value="">Todos los estados</option>
            <option value="no_voto">Sin votar (🔴)</option>
            <option value="en_camino">En camino (🟡)</option>
            <option value="voto">Votó (🟢)</option>
          </select>
        </div>
        <div id="militante-detail-container" style="display: grid; gap: 12px;">
          <div style="text-align: center; padding: 40px; color: #999;">Selecciona un militante</div>
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
    const { collection, query, where, getDocs, doc, onSnapshot, setDoc, updateDoc, serverTimestamp } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // CARGAR DATOS INICIALES
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const usersSnap = await getDocs(collection(db, 'users'))
    const choferesSnap = await getDocs(collection(db, 'choferes'))

    let records = []
    let users = []
    let choferes = []

    recordsSnap.forEach(d => {
      records.push({ id: d.id, ...d.data() })
    })

    usersSnap.forEach(d => {
      users.push({ id: d.id, ...d.data() })
    })

    choferesSnap.forEach(d => {
      choferes.push({ id: d.id, ...d.data() })
    })

    // FUNCIONES CORE
    function actualizarEstado(cedula, nuevoEstado, choferId = null) {
      const record = records.find(r => r.cedula === cedula)
      if (!record) {
        alert('Votante no encontrado')
        return Promise.reject(new Error('Votante no encontrado'))
      }

      const updateData = {
        estado_dia_d: nuevoEstado,
        updatedAt: serverTimestamp()
      }

      // Si se asigna chofer → automáticamente en_camino
      if (choferId) {
        updateData.chofer_asignado = choferId
        if (nuevoEstado !== 'en_camino') {
          updateData.estado_dia_d = 'en_camino'
        }
      } else if (nuevoEstado !== 'en_camino') {
        // Si no es en_camino → quitar chofer
        updateData.chofer_asignado = null
      }

      return updateDoc(doc(db, 'savedRecords', record.id), updateData)
    }

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

    function renderRanking() {
      const ranking = generarRanking()
      const container = document.getElementById('ranking-container')
      if (!container) return

      let html = ''
      ranking.forEach((mil, idx) => {
        const progreso = ((mil.votos / mil.total) * 100).toFixed(0)
        html += `
          <div style="background: white; border: 2px solid #ddd; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.2s;" 
               onmouseover="this.style.borderColor='#2e7d32'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'" 
               onmouseout="this.style.borderColor='#ddd'; this.style.boxShadow='none'"
               onclick="document.getElementById('search-militante').value='${mil.nombre.replace(/'/g, "\\'")}'; document.getElementById('search-militante').dispatchEvent(new Event('input'))">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div>
                <span style="font-weight: 700; font-size: 1.1rem; color: #333;">#${idx + 1} ${mil.nombre}</span>
                <span style="background: #2e7d32; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; font-weight: 600;">${mil.votos}/${mil.total}</span>
              </div>
              <div style="text-align: right; font-size: 0.9rem;">
                <div style="font-weight: 700; color: #2e7d32;">${progreso}%</div>
              </div>
            </div>
            <div style="background: #f5f5f5; border-radius: 4px; height: 24px; overflow: hidden;">
              <div style="background: linear-gradient(90deg, #2e7d32 0%, #4caf50 100%); height: 100%; width: ${progreso}%; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; color: white; font-size: 0.75rem; font-weight: 600;">
                ${progreso > 5 ? progreso + '%' : ''}
              </div>
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 12px; margin-top: 12px; font-size: 0.85rem;">
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

    function renderDetalleMilitante(filterTexto = '', filterEstado = '') {
      const container = document.getElementById('militante-detail-container')
      if (!container) return

      const militantes = Array.from(new Map(
        records.map(r => {
          const user = users.find(u => u.id === r.militante_id)
          return [r.militante_id, { id: r.militante_id, nombre: user?.nombre || 'Sin nombre' }]
        })
      ).values())

      const militantesFiltrados = militantes.filter(m => 
        m.nombre.toLowerCase().includes(filterTexto.toLowerCase())
      )

      if (militantesFiltrados.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">No se encontraron militantes</div>'
        return
      }

      let html = ''
      militantesFiltrados.forEach(mil => {
        const votantesMil = records.filter(r => r.militante_id === mil.id)
        const votos = votantesMil.filter(r => r.estado_dia_d === 'voto')
        const enCamino = votantesMil.filter(r => r.estado_dia_d === 'en_camino')
        const noVoto = votantesMil.filter(r => r.estado_dia_d === 'no_voto')

        html += `
          <div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 16px;">
            <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 16px; color: #333;">${mil.nombre}</div>
            
            <!-- VOTOS -->
            ${votos.length > 0 ? `
              <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; background: #2e7d32; color: white; padding: 8px; border-radius: 4px; font-size: 0.9rem;">✅ VOTÓ (${votos.length})</h4>
                <div style="display: grid; gap: 8px;">
                  ${votos.map(v => `
                    <div style="background: #e8f5e9; padding: 8px; border-radius: 4px; font-size: 0.85rem; border-left: 4px solid #2e7d32; display: flex; justify-content: space-between;">
                      <div>
                        <div style="font-weight: 600;">${v.nombre}</div>
                        <div style="color: #666;">CI: ${v.cedula} | ${v.local}-${v.mesa}</div>
                      </div>
                      <button onclick="if(confirm('¿Corregir a EN CAMINO?')) {
                        const btn = this;
                        btn.textContent = 'Actualizando...';
                        btn.disabled = true;
                        actualizarEstadoDiaD('${v.cedula}', 'en_camino').then(() => {
                          alert('Actualizado');
                          location.reload();
                        }).catch(e => {
                          alert('Error: ' + e.message);
                          btn.textContent = 'Corregir';
                          btn.disabled = false;
                        });
                      }" style="background: #ff9800; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Corregir</button>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- EN CAMINO -->
            ${enCamino.length > 0 ? `
              <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; background: #ff9800; color: white; padding: 8px; border-radius: 4px; font-size: 0.9rem;">🟡 EN CAMINO (${enCamino.length})</h4>
                <div style="display: grid; gap: 8px;">
                  ${enCamino.map(v => `
                    <div style="background: #fff3e0; padding: 8px; border-radius: 4px; font-size: 0.85rem; border-left: 4px solid #ff9800;">
                      <div style="font-weight: 600;">${v.nombre}</div>
                      <div style="color: #666;">CI: ${v.cedula} | ${v.local}-${v.mesa}</div>
                      ${v.chofer_asignado ? `
                        <div style="margin-top: 4px; padding: 4px; background: rgba(0,0,0,0.05); border-radius: 2px; font-size: 0.75rem;">
                          ${(() => {
                            const chofer = choferes.find(c => c.id === v.chofer_asignado)
                            return chofer ? `🚗 ${chofer.nombre}` : 'Chofer no encontrado'
                          })()}
                        </div>
                      ` : '<div style="margin-top: 4px; font-size: 0.75rem; color: #ff9800;">⚠️ Sin chofer asignado</div>'}
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 6px;">
                        <button onclick="if(confirm('¿Marcar como VOTÓ?')) {
                          const btn = this.parentElement.parentElement.parentElement;
                          actualizarEstadoDiaD('${v.cedula}', 'voto').then(() => {
                            alert('Actualizado');
                            location.reload();
                          }).catch(e => alert('Error: ' + e.message));
                        }" style="background: #2e7d32; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">✅ Votó</button>
                        <button onclick="if(confirm('¿Volver a SIN VOTAR?')) {
                          actualizarEstadoDiaD('${v.cedula}', 'no_voto').then(() => {
                            alert('Actualizado');
                            location.reload();
                          }).catch(e => alert('Error: ' + e.message));
                        }" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">🔴 Reset</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- SIN VOTAR -->
            ${noVoto.length > 0 ? `
              <div>
                <h4 style="margin: 0 0 8px 0; background: #f44336; color: white; padding: 8px; border-radius: 4px; font-size: 0.9rem;">🔴 SIN VOTAR (${noVoto.length})</h4>
                <div style="display: grid; gap: 8px;">
                  ${noVoto.map(v => `
                    <div style="background: #ffebee; padding: 8px; border-radius: 4px; font-size: 0.85rem; border-left: 4px solid #f44336;">
                      <div style="font-weight: 600;">${v.nombre}</div>
                      <div style="color: #666;">CI: ${v.cedula} | ${v.local}-${v.mesa} | 📱 ${v.telefono || 'Sin tel'}</div>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 6px;">
                        <button onclick="mostrarSelectChoferes('${v.cedula}', '${v.local}', '${v.nombre}')" style="background: #c41e3a; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">🚗 Asignar Chofer</button>
                        ${v.telefono ? `<a href="https://wa.me/${normalizarTelefono(v.telefono)}?text=${encodeURIComponent('Buen día ' + v.nombre + ', te estamos esperando para votar. Lista 6 - Opción 1 Samy Fidabel')}" target="_blank" style="background: #25d366; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; text-align: center; text-decoration: none;">💬 WhatsApp</a>` : ''}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `
      })

      container.innerHTML = html
    }

    function normalizarTelefono(tel) {
      if (!tel) return ''
      const digits = tel.replace(/\D/g, '')
      const sinCero = digits.replace(/^0/, '')
      return '595' + sinCero
    }

    // EVENT LISTENERS
    const searchInput = document.getElementById('search-militante')
    const filterEstado = document.getElementById('filter-estado')

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderDetalleMilitante(e.target.value, filterEstado?.value || '')
      })
    }

    if (filterEstado) {
      filterEstado.addEventListener('change', (e) => {
        renderDetalleMilitante(searchInput?.value || '', e.target.value)
      })
    }

    // RENDER INICIAL
    renderEstadisticas()
    renderRanking()
    renderDetalleMilitante()

    // LISTENER EN TIEMPO REAL
    const recordsUnsubscribe = onSnapshot(collection(db, 'savedRecords'), (snapshot) => {
      records = []
      snapshot.forEach(d => {
        records.push({ id: d.id, ...d.data() })
      })
      renderEstadisticas()
      renderRanking()
      renderDetalleMilitante(searchInput?.value || '', filterEstado?.value || '')
    })

    // EXPONER FUNCIÓN GLOBAL
    window.actualizarEstadoDiaD = actualizarEstado
    window.mostrarSelectChoferes = (cedula, local, nombre) => {
      const modal = document.createElement('div')
      modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999;'
      
      const choferesLocal = choferes.filter(c => c.local === local)
      let html = `
        <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%;">
          <h3 style="margin: 0 0 16px 0; color: #c41e3a;">${nombre}</h3>
          <select id="select-chofer" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 16px;">
            <option value="">-- Selecciona chofer --</option>
            ${choferesLocal.map(c => `<option value="${c.id}">${c.nombre} (${c.telefono})</option>`).join('')}
          </select>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button onclick="this.parentElement.parentElement.parentElement.remove()" style="background: #ddd; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Cancelar</button>
            <button id="btn-confirmar-chofer" style="background: #c41e3a; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: 700;">Asignar</button>
          </div>
        </div>
      `
      modal.innerHTML = html
      document.body.appendChild(modal)

      document.getElementById('btn-confirmar-chofer').addEventListener('click', async () => {
        const choferId = document.getElementById('select-chofer').value
        if (!choferId) {
          alert('Selecciona chofer')
          return
        }
        try {
          await actualizarEstado(cedula, 'en_camino', choferId)
          alert('Chofer asignado')
          modal.remove()
          location.reload()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })

      modal.onclick = (e) => {
        if (e.target === modal) modal.remove()
      }
    }

    return () => recordsUnsubscribe()
  } catch (err) {
    console.error('Error en loadAndRender:', err)
    alert('Error cargando datos: ' + err.message)
  }
}