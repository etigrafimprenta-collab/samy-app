/**
 * MÓDULO: DÍA D - PANEL MILITANTES V2
 * ✅ Con control de electionDayEnabled por admin
 * ✅ Listener en tiempo real
 * ✅ NUEVA: Edición de estado + asignación de chofer
 * ✅ NUEVA: Estados con colores (🔴 no votó / 🟡 en camino / 🟢 votó)
 * ✅ NUEVA: Exportación a Excel + Impresión
 */

export function renderDiaD(container, user) {
  let electionDayEnabled = false
  let choferes = []

  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🗳️ DÍA D - MIS VOTANTES</h2>
        <div style="display: flex; gap: 10px;">
          ${user.role === 'admin' ? `
            <button id="btn-cerrar-votos" style="background: #ff6b6b; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
              🔒 CERRAR VOTACIÓN
            </button>
          ` : ''}
          <button id="btn-exportar-excel" style="background: #2e7d32; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            📊 Exportar Excel
          </button>
          <button id="btn-imprimir" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            🖨️ Imprimir
          </button>
        </div>
      </div>
      <p style="margin: 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div id="estado-dia-d" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
      <div style="font-weight: 700; color: #ff9800;">⏳ Esperando habilitación del administrador...</div>
      <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">El botón de marcar se habilitará cuando el admin active Día D.</div>
    </div>

    <div style="text-align: center; padding: 40px; color: #666;" id="loading">⏳ Cargando datos...</div>
    <div id="content-container"></div>
    <div id="modal-container"></div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  if (user.role === 'admin') {
    const btnCerrar = document.getElementById('btn-cerrar-votos')
    if (btnCerrar) {
      btnCerrar.addEventListener('click', () => mostrarModalCerrarVotos(container))
    }
  }

  loadAndRender(container, user, (enabled, choferesList) => {
    electionDayEnabled = enabled
    choferes = choferesList
    updateEstadoDiaD(enabled)
  })
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

function updateEstadoDiaD(enabled) {
  const estadoEl = document.getElementById('estado-dia-d')
  if (!estadoEl) return

  if (enabled) {
    estadoEl.innerHTML = `
      <div style="color: #2e7d32; font-weight: 700;">✅ VOTACIÓN HABILITADA</div>
      <div style="font-size: 0.85rem; color: #1b5e20; margin-top: 4px;">Puedes registrar votos en Día D.</div>
    `
    estadoEl.style.background = '#c8e6c9'
    estadoEl.style.borderLeftColor = '#2e7d32'
  } else {
    estadoEl.innerHTML = `
      <div style="color: #ff9800; font-weight: 700;">⏳ Esperando habilitación del administrador...</div>
      <div style="font-size: 0.85rem; color: #e65100; margin-top: 4px;">El botón de marcar se habilitará cuando el admin active Día D.</div>
    `
    estadoEl.style.background = '#fff3cd'
    estadoEl.style.borderLeftColor = '#ff9800'
  }
}

async function loadAndRender(container, user, onElectionDayChange) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, query, where, getDocs, setDoc, doc, onSnapshot } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // 1️⃣ CARGAR CHOFERES
    const choferesSnap = await getDocs(collection(db, 'choferes'))
    const choferesList = []
    choferesSnap.forEach(d => {
      choferesList.push({ id: d.id, ...d.data() })
    })

    // 2️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE ELECTIONDAY
    const unsubscribeConfig = onSnapshot(
      doc(db, 'config', 'electionDay'),
      docSnap => {
        const enabled = docSnap.exists() ? docSnap.data().enabled : false
        onElectionDayChange(enabled, choferesList)
      },
      err => console.error('❌ Error escuchando Día D:', err)
    )

    // 3️⃣ VERIFICAR ESTADO DE VOTACIÓN CERRADA
    const estadoSnap = await getDocs(collection(db, 'dia_d_estado'))
    let votacionCerrada = false
    estadoSnap.forEach(d => {
      if (d.data().estado === 'cerrado') {
        votacionCerrada = true
      }
    })

    // 4️⃣ CARGAR VOTANTES DEL USUARIO
    const votantesQ = query(collection(db, 'savedRecords'), where('uid', '==', user.uid))
    const votantesSnap = await getDocs(votantesQ)
    const votantes = []
    const votantesMap = {}
    
    votantesSnap.forEach(d => {
      const data = d.data()
      const votante = {
        id: d.id,
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        telefono: data.telefono || '',
        local: data.local || 'Sin local',
        mesa: data.mesa || 'Sin mesa',
        orden: data.orden || 0
      }
      votantes.push(votante)
      votantesMap[votante.cedula] = votante
    })

    // 5️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE VOTOS + ESTADOS
    const votosQ = query(collection(db, 'dia_d_votos'), where('militante_id', '==', user.uid))
    const unsubscribeVotes = onSnapshot(
      votosQ,
      votosSnap => {
        const estadoVotos = {}
        votosSnap.forEach(d => {
          const data = d.data()
          estadoVotos[data.cedula] = {
            voted: data.voted || false,
            viatico: data.viatico || 0,
            estado: data.estado || 'no_votó', // 'no_votó' | 'en_camino' | 'votó'
            choferAsignado: data.choferAsignado || null,
            ultimoCambio: data.ultimoCambio || null
          }
        })

        // Re-renderizar cuando cambian los votos
        renderPanel(
          container,
          user,
          votantes,
          votantesMap,
          estadoVotos,
          db,
          setDoc,
          doc,
          votacionCerrada,
          document.getElementById('estado-dia-d')?.textContent.includes('HABILITADA') || false,
          choferesList
        )
      },
      err => console.error('❌ Error cargando votos:', err)
    )

    // 6️⃣ BOTONES DE EXPORTACIÓN
    const btnExportarExcel = document.getElementById('btn-exportar-excel')
    const btnImprimir = document.getElementById('btn-imprimir')

    if (btnExportarExcel) {
      btnExportarExcel.addEventListener('click', () => {
        exportarExcel(votantes, votosQ, user)
      })
    }

    if (btnImprimir) {
      btnImprimir.addEventListener('click', () => {
        imprimirRegistros(votantes)
      })
    }

  } catch (err) {
    console.error('Error:', err)
    const loading = document.getElementById('loading')
    if (loading) {
      loading.innerHTML = '<div style="background: #ffebee; border-left: 4px solid #c62828; padding: 16px; border-radius: 4px; color: #c62828;"><strong>Error:</strong> ' + err.message + '</div>'
    }
  }
}

function renderPanel(container, user, votantes, votantesMap, estadoVotos, db, setDoc, doc, votacionCerrada, electionDayEnabled, choferes) {
  // Ordenar por local y luego por orden
  const votantesOrdenados = votantes.sort((a, b) => {
    const localCompare = a.local.localeCompare(b.local)
    if (localCompare !== 0) return localCompare
    return (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)
  })

  // Agrupar por local
  const porLocal = {}
  votantesOrdenados.forEach(v => {
    const local = v.local
    if (!porLocal[local]) porLocal[local] = []
    porLocal[local].push(v)
  })

  // Calcular estadísticas
  const total = votantes.length
  const votaron = Object.keys(estadoVotos).filter(c => estadoVotos[c]?.voted).length
  const pct = total > 0 ? ((votaron / total) * 100).toFixed(2) : 0

  // Estado visual
  let html = ''
  if (votacionCerrada) {
    html += '<div style="background: #ff6b6b; color: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-weight: 700; text-align: center;">🔒 VOTACIÓN CERRADA - No se pueden registrar más votos</div>'
  } else if (!electionDayEnabled) {
    html += '<div style="background: #ff9800; color: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-weight: 700; text-align: center;">⏳ ESPERANDO AUTORIZACIÓN - El admin aún no ha habilitado Día D</div>'
  } else {
    html += '<div style="background: #4caf50; color: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-weight: 700; text-align: center;">✅ CARGANDO VOTOS - Puedes registrar votos</div>'
  }

  // Métricas
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px;">'
  html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #c41e3a;">' + total + '</div><div style="font-size: 0.75rem; color: #666;">TOTAL</div></div>'
  html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #2e7d32;">🟢 ' + votaron + '</div><div style="font-size: 0.75rem; color: #666;">VOTARON</div></div>'
  html += '<div style="background: white; border: 2px solid #ff9800; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #ff9800;">' + (total - votaron) + '</div><div style="font-size: 0.75rem; color: #666;">⏳ FALTAN</div></div>'
  html += '<div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #1976d2;">' + pct + '%</div><div style="font-size: 0.75rem; color: #666;">%</div></div>'
  html += '</div>'

  // Votantes por local
  if (total > 0) {
    html += '<div style="display: grid; gap: 20px;">'
    Object.entries(porLocal).forEach(([local, votantesLocal]) => {
      html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 20px;">'
      html += '<div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 16px; color: #c41e3a; padding-bottom: 12px; border-bottom: 2px solid #f0f0f0;">📍 LOCAL: ' + local + ' (' + votantesLocal.length + ' votantes)</div>'

      html += '<div style="display: grid; gap: 10px;">'
      votantesLocal.forEach(v => {
        const est = estadoVotos[v.cedula] || { voted: false, viatico: 0, estado: 'no_votó', choferAsignado: null }
        const nombreCompleto = (v.nombre + ' ' + v.apellidos).trim()
        const votoBtnId = 'voto-' + v.cedula.replace(/\./g, '-')
        const waBtnId = 'wa-' + v.cedula.replace(/\./g, '-')
        const editBtnId = 'edit-' + v.cedula.replace(/\./g, '-')

        // Color de estado
        let estadoColor = '#ff6b6b' // 🔴 por defecto
        let estadoEmoji = '🔴'
        if (est.estado === 'en_camino') {
          estadoColor = '#ffc107'
          estadoEmoji = '🟡'
        } else if (est.estado === 'votó' || est.voted) {
          estadoColor = '#2e7d32'
          estadoEmoji = '🟢'
        }

        // ✅ BOTÓN DESHABILITADO SI: votacionCerrada O electionDayEnabled=false
        const btnDisabled = votacionCerrada || !electionDayEnabled
        const btnColor = est.voted ? '#2e7d32' : (btnDisabled ? '#ccc' : '#ff9800')
        const btnCursor = btnDisabled ? 'not-allowed' : 'pointer'
        const btnOpacity = btnDisabled ? '0.6' : '1'

        html += '<div class="votante-row" data-cedula="' + v.cedula + '" style="display: flex; align-items: center; gap: 10px; padding: 12px; background: ' + (est.voted ? '#e8f5e9' : '#fafafa') + '; border-radius: 6px; border-left: 4px solid ' + estadoColor + ';"><div style="flex: 1;">'
        html += '<div style="font-weight: 600; font-size: 0.9rem; color: #333; display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.2rem;">' + estadoEmoji + '</span> ' + nombreCompleto + '</div>'
        html += '<div style="font-size: 0.75rem; color: #666; font-family: monospace;">CI: ' + v.cedula + ' | Orden: ' + v.orden + ' | Mesa: ' + v.mesa + '</div>'
        if (est.choferAsignado) {
          html += '<div style="font-size: 0.75rem; color: #1976d2; font-weight: 600;">🚗 Chofer: ' + est.choferAsignado + '</div>'
        }
        if (est.horarioBusqueda) {
          html += '<div style="font-size: 0.75rem; color: #f57c00; font-weight: 600;">⏰ Hora: ' + est.horarioBusqueda + '</div>'
        }
        if (est.direccionRecogida) {
          html += '<div style="font-size: 0.75rem; color: #558b2f; font-weight: 600;">📍 ' + est.direccionRecogida + '</div>'
        }
        html += '</div>'

        html += '<button id="' + editBtnId + '" style="background: #1976d2; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 700; white-space: nowrap;">⚙️ Editar</button>'
        html += '<button id="' + votoBtnId + '" style="background: ' + btnColor + '; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: ' + btnCursor + '; font-size: 0.8rem; font-weight: 700; opacity: ' + btnOpacity + '; white-space: nowrap;" ' + (btnDisabled ? 'disabled' : '') + '>' + (est.voted ? '✅ VOTÓ' : '⏳ VOTO') + '</button>'
        html += '<button id="' + waBtnId + '" style="background: #25d366; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 700; white-space: nowrap;">💬 WA</button>'
        html += '</div>'
      })
      html += '</div>'
      html += '</div>'
    })
    html += '</div>'
  } else {
    html += '<div style="text-align: center; padding: 40px; color: #999;">Sin votantes asignados</div>'
  }

  const contentContainer = document.getElementById('content-container')
  const loading = document.getElementById('loading')
  if (contentContainer && loading) {
    loading.style.display = 'none'
    contentContainer.innerHTML = html

    // Event listeners para EDITAR estado + chofer
    document.querySelectorAll('[id^="edit-"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cedula = btn.id.replace('edit-', '').replace(/-/g, '.')
        const votante = votantesMap[cedula]
        const est = estadoVotos[cedula] || { 
          voted: false, 
          estado: 'no_votó', 
          choferAsignado: null,
          horarioBusqueda: '09:00',
          direccionRecogida: null
        }
        abrirModalEditar(votante, est, user, db, setDoc, doc, choferes)
      })
    })

    // Event listeners para marcar votos
    document.querySelectorAll('[id^="voto-"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        // ✅ VALIDAR ANTES DE MARCAR
        if (votacionCerrada) {
          alert('❌ La votación ha sido cerrada por el administrador')
          return
        }

        if (!electionDayEnabled) {
          alert('⏳ El administrador aún no ha habilitado Día D')
          return
        }

        const cedula = btn.id.replace('voto-', '').replace(/-/g, '.')
        const votante = votantesMap[cedula]
        const newState = !estadoVotos[cedula]?.voted

        try {
          btn.disabled = true
          btn.textContent = 'Guardando...'

          await setDoc(doc(db, 'dia_d_votos', user.uid + '_' + cedula), {
            militante_id: user.uid,
            cedula: cedula,
            nombre: votante?.nombre || '',
            voted: newState,
            estado: newState ? 'votó' : 'no_votó', // Actualizar estado al votar
            viatico: estadoVotos[cedula]?.viatico || 0,
            choferAsignado: estadoVotos[cedula]?.choferAsignado || null,
            ultimoCambio: new Date(),
            timestamp: new Date()
          }, { merge: true })

          // El listener de votos actualizará automáticamente
        } catch (err) {
          alert('❌ Error: ' + err.message)
          btn.disabled = false
          btn.textContent = estadoVotos[cedula]?.voted ? '✅ VOTÓ' : '⏳ VOTO'
        }
      })
    })

    // Event listeners para WhatsApp
    document.querySelectorAll('[id^="wa-"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cedula = btn.id.replace('wa-', '').replace(/-/g, '.')
        const votante = votantesMap[cedula]
        if (votante && votante.telefono) {
          enviarWhatsApp(votante)
        } else {
          alert('❌ Este votante no tiene teléfono registrado')
        }
      })
    })
  }
}

function abrirModalEditar(votante, estado, user, db, setDoc, doc, choferes) {
  const modalContainer = document.getElementById('modal-container')
  if (!modalContainer) return

  const choferesHTML = choferes.map(c => `<option value="${c.nombre}" ${estado.choferAsignado === c.nombre ? 'selected' : ''}>${c.nombre}</option>`).join('')

  const html = `
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 20px;">
      <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin: 0 0 12px 0; font-family: Barlow Condensed; font-size: 1.3rem; text-transform: uppercase; color: #c41e3a;">⚙️ EDITAR VOTANTE</h3>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9rem;">
          <div style="font-weight: 700;">${votante.nombre}</div>
          <div style="color: #666; font-size: 0.85rem;">CI: ${votante.cedula}</div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Estado del Votante:</label>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            <button class="estado-btn" data-estado="no_votó" style="padding: 12px; border: 2px solid #ccc; border-radius: 4px; cursor: pointer; background: ${estado.estado === 'no_votó' ? '#ffebee' : '#fff'}; border-color: ${estado.estado === 'no_votó' ? '#ff6b6b' : '#ccc'};">
              🔴 No votó
            </button>
            <button class="estado-btn" data-estado="en_camino" style="padding: 12px; border: 2px solid #ccc; border-radius: 4px; cursor: pointer; background: ${estado.estado === 'en_camino' ? '#fff3e0' : '#fff'}; border-color: ${estado.estado === 'en_camino' ? '#ffc107' : '#ccc'};">
              🟡 En camino
            </button>
            <button class="estado-btn" data-estado="votó" style="padding: 12px; border: 2px solid #ccc; border-radius: 4px; cursor: pointer; background: ${estado.estado === 'votó' ? '#e8f5e9' : '#fff'}; border-color: ${estado.estado === 'votó' ? '#2e7d32' : '#ccc'};">
              🟢 Votó
            </button>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Chofer Asignado:</label>
          <div style="display: flex; gap: 8px;">
            <select id="chofer-select" style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
              <option value="">— Sin chofer —</option>
              ${choferesHTML}
            </select>
            <button id="btn-nuevo-chofer" style="background: #1976d2; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-weight: 700; white-space: nowrap; display: block;">➕ Nuevo</button>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Horario de Búsqueda:</label>
          <input id="horario-input" type="time" value="${estado.horarioBusqueda || '09:00'}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Dirección de Recogida:</label>
          <input id="direccion-input" type="text" placeholder="Ej: Calle Principal 123" value="${estado.direccionRecogida || ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button id="btn-guardar-edicion" style="flex: 1; background: #2e7d32; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ Guardar</button>
          <button id="btn-cancelar-edicion" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ Cancelar</button>
        </div>
      </div>
    </div>
  `

  modalContainer.innerHTML = html

  let estadoSeleccionado = estado.estado

  document.querySelectorAll('.estado-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.estado-btn').forEach(b => {
        b.style.background = '#fff'
        b.style.borderColor = '#ccc'
      })
      estadoSeleccionado = btn.dataset.estado
      btn.style.background = btn.dataset.estado === 'no_votó' ? '#ffebee' : btn.dataset.estado === 'en_camino' ? '#fff3e0' : '#e8f5e9'
      btn.style.borderColor = btn.dataset.estado === 'no_votó' ? '#ff6b6b' : btn.dataset.estado === 'en_camino' ? '#ffc107' : '#2e7d32'
    })
  })

  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    modalContainer.innerHTML = ''
  })

  document.getElementById('btn-nuevo-chofer').addEventListener('click', () => {
    abrirModalNuevoChofer(db, setDoc, doc, (nuevoChofer) => {
      // Actualizar dropdown con el nuevo chofer
      const select = document.getElementById('chofer-select')
      const option = document.createElement('option')
      option.value = nuevoChofer
      option.textContent = nuevoChofer
      option.selected = true
      select.appendChild(option)
    })
  })

  document.getElementById('btn-guardar-edicion').addEventListener('click', async () => {
    const choferSeleccionado = document.getElementById('chofer-select').value
    const horarioBusqueda = document.getElementById('horario-input').value
    const direccionRecogida = document.getElementById('direccion-input').value
    const btn = document.getElementById('btn-guardar-edicion')
    btn.disabled = true
    btn.textContent = 'Guardando...'

    try {
      await setDoc(doc(db, 'dia_d_votos', user.uid + '_' + votante.cedula), {
        militante_id: user.uid,
        cedula: votante.cedula,
        nombre: votante.nombre,
        estado: estadoSeleccionado,
        choferAsignado: choferSeleccionado || null,
        horarioBusqueda: horarioBusqueda || null,
        direccionRecogida: direccionRecogida || null,
        ultimoCambio: new Date(),
        voted: estadoSeleccionado === 'votó',
        timestamp: new Date()
      }, { merge: true })

      alert('✅ Cambios guardados')
      modalContainer.innerHTML = ''
    } catch (err) {
      alert('❌ Error: ' + err.message)
      btn.disabled = false
      btn.textContent = '✅ Guardar'
    }
  })
}

function abrirModalNuevoChofer(db, setDoc, doc, onGuardar) {
  const html = `
    <div id="overlay-nuevo-chofer" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000; padding: 20px;">
      <div style="background: white; border-radius: 8px; padding: 24px; max-width: 400px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin: 0 0 16px 0; font-family: Barlow Condensed; font-size: 1.2rem; text-transform: uppercase; color: #1976d2;">➕ AGREGAR NUEVO CHOFER</h3>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Nombre del Chofer:</label>
          <input id="input-chofer-nombre" type="text" placeholder="Ej: Juampi García" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Teléfono <span style="color: #999;">(opcional)</span>:</label>
          <input id="input-chofer-tel" type="tel" placeholder="Ej: 981234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div id="alert-chofer" style="margin-bottom: 12px;"></div>

        <div style="display: flex; gap: 12px;">
          <button id="btn-guardar-chofer" style="flex: 1; background: #2e7d32; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ Guardar</button>
          <button id="btn-cancelar-chofer" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ Cancelar</button>
        </div>
      </div>
    </div>
  `

  const modalOverlay = document.createElement('div')
  modalOverlay.innerHTML = html
  document.body.appendChild(modalOverlay)

  const btnCancelar = document.getElementById('btn-cancelar-chofer')
  const btnGuardar = document.getElementById('btn-guardar-chofer')
  const inputNombre = document.getElementById('input-chofer-nombre')
  const inputTel = document.getElementById('input-chofer-tel')
  const alertDiv = document.getElementById('alert-chofer')

  btnCancelar.addEventListener('click', () => {
    modalOverlay.remove()
  })

  btnGuardar.addEventListener('click', async () => {
    const nombre = inputNombre.value.trim()
    const telefono = inputTel.value.trim()

    if (!nombre) {
      alertDiv.innerHTML = '<div style="background: #ffebee; border-left: 4px solid #ff6b6b; color: #c62828; padding: 10px; border-radius: 4px; font-size: 0.85rem;">⚠️ El nombre es obligatorio</div>'
      return
    }

    btnGuardar.disabled = true
    btnGuardar.textContent = 'Guardando...'

    try {
      // Generar ID único basado en el nombre
      const choferId = nombre.toLowerCase().replace(/\s+/g, '_').replace(/[áéíóú]/g, (char) => {
        const map = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' }
        return map[char] || char
      })

      // Guardar en Firestore
      await setDoc(doc(db, 'choferes', choferId), {
        nombre: nombre,
        telefono: telefono || '',
        activo: true,
        createdAt: new Date()
      })

      // Cerrar modal y callback
      modalOverlay.remove()
      onGuardar(nombre)
      alert('✅ Chofer "' + nombre + '" guardado correctamente')
    } catch (err) {
      console.error('Error:', err)
      alertDiv.innerHTML = '<div style="background: #ffebee; border-left: 4px solid #ff6b6b; color: #c62828; padding: 10px; border-radius: 4px; font-size: 0.85rem;">❌ Error: ' + err.message + '</div>'
      btnGuardar.disabled = false
      btnGuardar.textContent = '✅ Guardar'
    }
  })

  // Focus en input de nombre
  inputNombre.focus()
}

function enviarWhatsApp(votante) {
  const mensaje = 'Buen día, ' + votante.nombre + '.\\n\\nTe estamos esperando para que juntos cambiemos el destino de nuestra ciudad.\\n\\n🗳️ Votá Lista 6 – Opción 1\\nSamy Fidabel\\n\\n📍 Lugar de votación: ' + votante.local + '\\n📋 Mesa: ' + votante.mesa + '\\n🔢 Orden: ' + votante.orden + '\\n\\nTu voto hace la diferencia. ¡Contamos con vos!'
  
  let cleanPhone = String(votante.telefono).trim()
  cleanPhone = cleanPhone.replace(/\D/g, '')
  while (cleanPhone.startsWith('595')) {
    cleanPhone = cleanPhone.substring(3)
  }

  if (!cleanPhone) {
    alert('❌ Número de teléfono inválido')
    return
  }

  cleanPhone = '595' + cleanPhone
  const encoded = encodeURIComponent(mensaje)
  window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, '_blank')
}

// 📊 EXPORTACIÓN A EXCEL
async function exportarExcel(votantes, votosQ, user) {
  try {
    // Cargar datos de votos
    const firebaseImport = await import('firebase/firestore')
    const { getDocs, query, collection, where } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    const votosSnapshot = await getDocs(query(collection(db, 'dia_d_votos'), where('militante_id', '==', user.uid)))
    const votosMap = {}

    votosSnapshot.forEach(d => {
      const data = d.data()
      votosMap[data.cedula] = data
    })

    // Preparar datos
    const rows = votantes.map(v => {
      const voto = votosMap[v.cedula] || {}
      const estado = voto.estado || 'no_votó'
      const estadoTexto = estado === 'votó' ? '✓ Votó' : estado === 'en_camino' ? '⏳ En camino' : '✗ No votó'

      return [
        v.cedula,
        v.nombre,
        v.local,
        v.mesa,
        v.orden,
        estadoTexto,
        voto.choferAsignado || '-',
        voto.ultimoCambio ? new Date(voto.ultimoCambio.seconds * 1000).toLocaleString('es-PY') : '-',
        v.telefono || '-'
      ]
    })

    // Crear CSV
    const headers = ['Cédula', 'Nombre', 'Local', 'Mesa', 'Orden', 'Estado', 'Chofer', 'Últim cambio', 'Teléfono']
    let csvContent = 'sep=,\n'
    csvContent += headers.map(h => `"${h}"`).join(',') + '\n'
    rows.forEach(row => {
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n'
    })

    // Descargar
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `dia_d_votantes_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    alert('✅ Excel descargado correctamente')
  } catch (err) {
    alert('❌ Error descargando Excel: ' + err.message)
  }
}

// 🖨️ IMPRESIÓN
function imprimirRegistros(votantes) {
  const ventana = window.open('', '', 'width=800,height=600')
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Impresión - Día D</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { text-align: center; color: #c41e3a; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #c41e3a; color: white; }
        .estado-votó { color: #2e7d32; font-weight: bold; }
        .estado-no_votó { color: #ff6b6b; font-weight: bold; }
        .estado-en_camino { color: #ffc107; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>📋 Registro de Votantes - Día D</h1>
      <p style="text-align: center; color: #666;">Fecha: ${new Date().toLocaleString('es-PY')}</p>
      <table>
        <thead>
          <tr>
            <th>Cédula</th>
            <th>Nombre</th>
            <th>Local</th>
            <th>Mesa</th>
            <th>Orden</th>
            <th>Teléfono</th>
          </tr>
        </thead>
        <tbody>
  `

  votantes.forEach(v => {
    html += `
      <tr>
        <td>${v.cedula}</td>
        <td>${v.nombre}</td>
        <td>${v.local}</td>
        <td>${v.mesa}</td>
        <td>${v.orden}</td>
        <td>${v.telefono || '-'}</td>
      </tr>
    `
  })

  html += `
        </tbody>
      </table>
      <script>
        window.print()
        window.close()
      </script>
    </body>
    </html>
  `

  ventana.document.write(html)
  ventana.document.close()
}

function mostrarModalCerrarVotos(container) {
  const modalHTML = '<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;"><div style="background: white; border-radius: 8px; padding: 24px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin: 0 0 16px 0; font-family: Barlow Condensed; font-size: 1.3rem; text-transform: uppercase; color: #ff6b6b;">🔒 CERRAR VOTACIÓN</h3><div style="background: #ffebee; border-left: 4px solid #ff6b6b; padding: 12px; border-radius: 4px; margin-bottom: 16px; color: #c62828; font-size: 0.9rem;">⚠️ Esta acción cerrará la votación. Solo los ADMIN podrán reabrir.</div><div style="margin-bottom: 16px;"><label style="display: block; font-weight: 700; margin-bottom: 8px;">Contraseña de Admin:</label><input id="input-password-cerrar" type="password" placeholder="Ingrese contraseña" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;"></div><div style="display: flex; gap: 12px;"><button id="btn-confirmar-cerrar" style="flex: 1; background: #ff6b6b; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ Cerrar Votación</button><button id="btn-cancelar-cerrar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ Cancelar</button></div></div></div>'

  const modal = document.createElement('div')
  modal.innerHTML = modalHTML
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar-cerrar').addEventListener('click', () => {
    modal.remove()
  })

  document.getElementById('btn-confirmar-cerrar').addEventListener('click', async () => {
    const password = document.getElementById('input-password-cerrar').value
    if (!password.trim()) {
      alert('Por favor ingrese la contraseña')
      return
    }

    await cerrarVotacion(password, modal)
  })
}

async function cerrarVotacion(password, modal) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, addDoc, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    const usersSnap = await getDocs(collection(db, 'users'))
    let adminPassword = null
    usersSnap.forEach(d => {
      if (d.data().role === 'admin') {
        adminPassword = d.data().password
      }
    })

    if (password !== adminPassword) {
      alert('❌ Contraseña incorrecta')
      return
    }

    await addDoc(collection(db, 'dia_d_estado'), {
      estado: 'cerrado',
      timestamp: new Date(),
      cerrado_por: 'admin'
    })

    alert('✅ Votación cerrada correctamente')
    modal.remove()
    location.reload()

  } catch (err) {
    alert('Error: ' + err.message)
  }
}