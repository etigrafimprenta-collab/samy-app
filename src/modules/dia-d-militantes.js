/**
 * MÓDULO: DÍA D - PANEL MILITANTES
 * ✅ Con control de electionDayEnabled por admin
 * ✅ Listener en tiempo real
 * ✅ Botón MARCAR deshabilitado hasta que admin habilite
 */

export function renderDiaD(container, user) {
  let electionDayEnabled = false

  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🗳️ DÍA D - MIS VOTANTES</h2>
        ${user.role === 'admin' ? `
          <button id="btn-cerrar-votos" style="background: #ff6b6b; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            🔒 CERRAR VOTACIÓN
          </button>
        ` : ''}
      </div>
      <p style="margin: 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div id="estado-dia-d" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
      <div style="font-weight: 700; color: #ff9800;">⏳ Esperando habilitación del administrador...</div>
      <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">El botón de marcar se habilitará cuando el admin active Día D.</div>
    </div>

    <div style="text-align: center; padding: 40px; color: #666;" id="loading">⏳ Cargando datos...</div>
    <div id="content-container"></div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)

  if (user.role === 'admin') {
    const btnCerrar = document.getElementById('btn-cerrar-votos')
    if (btnCerrar) {
      btnCerrar.addEventListener('click', () => mostrarModalCerrarVotos(container))
    }
  }

  loadAndRender(container, user, (enabled) => {
    electionDayEnabled = enabled
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

    // 1️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE ELECTIONDAY
    const unsubscribeConfig = onSnapshot(
      doc(db, 'config', 'electionDay'),
      docSnap => {
        const enabled = docSnap.exists() ? docSnap.data().enabled : false
        onElectionDayChange(enabled)
      },
      err => console.error('❌ Error escuchando Día D:', err)
    )

    // 2️⃣ VERIFICAR ESTADO DE VOTACIÓN CERRADA
    const estadoSnap = await getDocs(collection(db, 'dia_d_estado'))
    let votacionCerrada = false
    estadoSnap.forEach(d => {
      if (d.data().estado === 'cerrado') {
        votacionCerrada = true
      }
    })

    // 3️⃣ CARGAR VOTANTES DEL USUARIO
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

    // 4️⃣ ESCUCHAR CAMBIOS EN TIEMPO REAL DE VOTOS
    const votosQ = query(collection(db, 'dia_d_votos'), where('militante_id', '==', user.uid))
    const unsubscribeVotes = onSnapshot(
      votosQ,
      votosSnap => {
        const estadoVotos = {}
        votosSnap.forEach(d => {
          const data = d.data()
          estadoVotos[data.cedula] = { voted: data.voted || false, viatico: data.viatico || 0 }
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
          document.getElementById('estado-dia-d')?.textContent.includes('HABILITADA') || false
        )
      },
      err => console.error('❌ Error cargando votos:', err)
    )

  } catch (err) {
    console.error('Error:', err)
    const loading = document.getElementById('loading')
    if (loading) {
      loading.innerHTML = '<div style="background: #ffebee; border-left: 4px solid #c62828; padding: 16px; border-radius: 4px; color: #c62828;"><strong>Error:</strong> ' + err.message + '</div>'
    }
  }
}

function renderPanel(container, user, votantes, votantesMap, estadoVotos, db, setDoc, doc, votacionCerrada, electionDayEnabled) {
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
  const pct = total > 0 ? Math.round((votaron / total) * 100) : 0

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
  html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #2e7d32;">' + votaron + '</div><div style="font-size: 0.75rem; color: #666;">✅ VOTARON</div></div>'
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
        const est = estadoVotos[v.cedula] || { voted: false, viatico: 0 }
        const nombreCompleto = (v.nombre + ' ' + v.apellidos).trim()
        const votoBtnId = 'voto-' + v.cedula.replace(/\./g, '-')
        const waBtnId = 'wa-' + v.cedula.replace(/\./g, '-')

        // ✅ BOTÓN DESHABILITADO SI: votacionCerrada O electionDayEnabled=false
        const btnDisabled = votacionCerrada || !electionDayEnabled
        const btnColor = est.voted ? '#2e7d32' : (btnDisabled ? '#ccc' : '#ff9800')
        const btnCursor = btnDisabled ? 'not-allowed' : 'pointer'
        const btnOpacity = btnDisabled ? '0.6' : '1'

        html += '<div class="votante-row" data-cedula="' + v.cedula + '" style="display: flex; align-items: center; gap: 10px; padding: 12px; background: ' + (est.voted ? '#e8f5e9' : '#fafafa') + '; border-radius: 6px; border-left: 4px solid ' + (est.voted ? '#4caf50' : '#ffb74d') + ';"><div style="flex: 1;">'
        html += '<div style="font-weight: 600; font-size: 0.9rem; color: #333;">' + nombreCompleto + '</div>'
        html += '<div style="font-size: 0.75rem; color: #666; font-family: monospace;">CI: ' + v.cedula + ' | Orden: ' + v.orden + ' | Mesa: ' + v.mesa + '</div>'
        html += '</div>'

        html += '<button id="' + votoBtnId + '" style="background: ' + btnColor + '; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: ' + btnCursor + '; font-size: 0.8rem; font-weight: 700; opacity: ' + btnOpacity + '; white-space: nowrap;" ' + (btnDisabled ? 'disabled' : '') + '>' + (est.voted ? '✅ VOTÓ' : '⏳ MARCAR') + '</button>'
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
            viatico: estadoVotos[cedula]?.viatico || 0,
            timestamp: new Date()
          }, { merge: true })

          // El listener de votos actualizará automáticamente
        } catch (err) {
          alert('❌ Error: ' + err.message)
          btn.disabled = false
          btn.textContent = estadoVotos[cedula]?.voted ? '✅ VOTÓ' : '⏳ MARCAR'
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

function enviarWhatsApp(votante) {
  const mensaje = 'Buen día, ' + votante.nombre + '.\n\nTe estamos esperando para que juntos cambiemos el destino de nuestra ciudad.\n\n🗳️ Votá Lista 6 – Opción 1\nSamy Fidabel\n\n📍 Lugar de votación: ' + votante.local + '\n📋 Mesa: ' + votante.mesa + '\n🔢 Orden: ' + votante.orden + '\n\nTu voto hace la diferencia. ¡Contamos con vos!'
  
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