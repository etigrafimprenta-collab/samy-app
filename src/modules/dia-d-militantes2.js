/**
 * MÓDULO: DÍA D - PANEL MILITANTES
 * Con actualización en tiempo real
 */

export function renderDiaD(container, user) {
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
      <p style="margin: 0; font-size: 0.9rem;">Cargando...</p>
    </div>
    <div style="text-align: center; padding: 40px; color: #666;">⏳ Cargando datos...</div>
  `

  if (user.role === 'admin') {
    document.getElementById('btn-cerrar-votos').addEventListener('click', () => mostrarModalCerrarVotos(container))
  }

  loadAndRender(container, user)
}

async function loadAndRender(container, user) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, query, where, getDocs, setDoc, doc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Verificar estado de votación
    const estadoSnap = await getDocs(collection(db, 'dia_d_estado'))
    let votacionCerrada = false
    estadoSnap.forEach(d => {
      if (d.data().estado === 'cerrado') {
        votacionCerrada = true
      }
    })

    // Cargar votantes
    const votantesQ = query(collection(db, 'savedRecords'), where('uid', '==', user.uid))
    const votantesSnap = await getDocs(votantesQ)
    const votantes = []
    votantesSnap.forEach(d => {
      const data = d.data()
      votantes.push({
        id: d.id,
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        telefono: data.telefono || '',
        local: data.local || 'Sin local',
        mesa: data.mesa || 'Sin mesa'
      })
    })

    // Cargar votos
    const votosQ = query(collection(db, 'dia_d_votos'), where('militante_id', '==', user.uid))
    const votosSnap = await getDocs(votosQ)
    const estadoVotos = {}
    votosSnap.forEach(d => {
      const data = d.data()
      estadoVotos[data.cedula] = { voted: data.voted || false, viatico: data.viatico || 0 }
    })

    // Renderizar panel con actualización en tiempo real
    renderPanel(container, user, votantes, estadoVotos, db, setDoc, doc, collection, query, where, getDocs, votacionCerrada)

  } catch (err) {
    console.error('Error:', err)
    container.innerHTML = `<div style="background: #ffebee; border-left: 4px solid #c62828; padding: 16px; border-radius: 4px; color: #c62828;"><strong>Error:</strong> ${err.message}</div>`
  }
}

function renderPanel(container, user, votantes, estadoVotos, db, setDoc, doc, collection, query, where, getDocs, votacionCerrada) {
  const porLocal = {}
  votantes.forEach(v => {
    const local = v.local
    if (!porLocal[local]) porLocal[local] = {}
    const mesa = v.mesa
    if (!porLocal[local][mesa]) porLocal[local][mesa] = []
    porLocal[local][mesa].push(v)
  })

  const total = votantes.length
  const votaron = Object.keys(estadoVotos).filter(c => estadoVotos[c]?.voted).length
  const pct = total > 0 ? Math.round((votaron / total) * 100) : 0

  let html = '<div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;"><h2 style="margin: 0 0 16px 0; font-family: Barlow Condensed; font-size: 2rem; text-transform: uppercase;">🗳️ DÍA D - MIS VOTANTES</h2><p style="margin: 0; font-size: 0.9rem;">Actualizado: ' + new Date().toLocaleTimeString('es-PY') + '</p></div>'

  if (votacionCerrada) {
    html += '<div style="background: #ff6b6b; color: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-weight: 700; text-align: center;">🔒 VOTACIÓN CERRADA - No se pueden registrar más votos</div>'
  } else {
    html += '<div style="background: #4caf50; color: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-weight: 700; text-align: center;">✅ CARGANDO VOTOS - Puedes registrar votos</div>'
  }

  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px;">'
  html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 14px; text-align: center;"><div style="font-size: 1.6rem; font-weight: 700; color: #c41e3a;">' + total + '</div><div style="font-size: 0.75rem; color: #666; font-weight: 600;">TOTAL</div></div>'
  html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 14px; text-align: center;"><div id="votaron-count" style="font-size: 1.6rem; font-weight: 700; color: #2e7d32;">' + votaron + '</div><div style="font-size: 0.75rem; color: #666; font-weight: 600;">✅ VOTARON</div></div>'
  html += '<div style="background: white; border: 2px solid #ff9800; border-radius: 8px; padding: 14px; text-align: center;"><div id="faltan-count" style="font-size: 1.6rem; font-weight: 700; color: #ff9800;">' + (total - votaron) + '</div><div style="font-size: 0.75rem; color: #666; font-weight: 600;">⏳ FALTAN</div></div>'
  html += '<div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 14px; text-align: center;"><div id="pct-count" style="font-size: 1.6rem; font-weight: 700; color: #1976d2;">' + pct + '%</div><div style="font-size: 0.75rem; color: #666; font-weight: 600;">%</div></div>'
  html += '</div>'

  if (total > 0) {
    html += '<div style="display: grid; gap: 16px;">'
    Object.entries(porLocal).forEach(([local, mesas]) => {
      html += '<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px;">'
      html += '<div style="font-weight: 700; font-size: 1rem; margin-bottom: 12px; color: #c41e3a;">📍 LOCAL: ' + local + '</div>'
      
      Object.entries(mesas).forEach(([mesa, votantesLocal]) => {
        html += '<div style="margin-bottom: 14px;"><div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px; color: #333;">🗳️ MESA ' + mesa + '</div><div style="display: grid; gap: 6px;">'
        
        votantesLocal.forEach(v => {
          const est = estadoVotos[v.cedula] || { voted: false, viatico: 0 }
          const nombreCompleto = (v.nombre + ' ' + v.apellidos).trim()
          const votoBtnId = 'voto-' + v.cedula.replace(/\./g, '-')
          const viaticoBtnId = 'viatico-' + v.cedula.replace(/\./g, '-')
          
          html += '<div class="votante-row" data-cedula="' + v.cedula + '" style="display: flex; align-items: center; gap: 10px; padding: 10px; background: ' + (est.voted ? '#e8f5e9' : '#fafafa') + '; border-radius: 6px; border-left: 4px solid ' + (est.voted ? '#4caf50' : '#ffb74d') + ';"><div style="flex: 1;"><div style="font-weight: 600; font-size: 0.85rem; color: #333;">' + nombreCompleto + '</div>'
          html += '<div style="font-size: 0.7rem; color: #666; font-family: monospace;">C: ' + v.cedula + '</div></div>'
          html += '<button id="' + votoBtnId + '" style="background: ' + (est.voted ? '#2e7d32' : '#ff9800') + '; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: ' + (votacionCerrada ? 'not-allowed' : 'pointer') + '; font-size: 0.7rem; font-weight: 700; opacity: ' + (votacionCerrada ? '0.5' : '1') + ';" ' + (votacionCerrada ? 'disabled' : '') + '>' + (est.voted ? '✅ Votó' : '⏳ Marcar') + '</button>'
          html += '<button id="' + viaticoBtnId + '" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 700;">💰 ' + est.viatico + '</button>'
          html += '<button style="background: #2196f3; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 700;">💬 WA</button></div>'
        })
        
        html += '</div></div>'
      })
      
      html += '</div>'
    })
    html += '</div>'
  } else {
    html += '<div style="text-align: center; padding: 40px; color: #999;">Sin votantes asignados</div>'
  }

  container.innerHTML = html

  document.querySelectorAll('[id^="voto-"]').forEach(btn => {
    if (!votacionCerrada) {
      btn.addEventListener('click', async () => {
        const cedula = btn.id.replace('voto-', '').replace(/-/g, '.')
        const newState = !estadoVotos[cedula]?.voted
        await setDoc(doc(db, 'dia_d_votos', user.uid + '_' + cedula), {
          militante_id: user.uid,
          cedula: cedula,
          voted: newState,
          viatico: estadoVotos[cedula]?.viatico || 0,
          timestamp: new Date()
        }, { merge: true })
        loadAndRender(container, user)
      })
    }
  })

  document.querySelectorAll('[id^="viatico-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cedula = btn.id.replace('viatico-', '').replace(/-/g, '.')
      const montoStr = prompt('Ingrese monto de viático:')
      if (montoStr !== null) {
        const montoNum = parseFloat(montoStr) || 0
        setDoc(doc(db, 'dia_d_votos', user.uid + '_' + cedula), {
          militante_id: user.uid,
          cedula: cedula,
          nombre: votantes.find(v => v.cedula === cedula)?.nombre || '',
          viatico: montoNum,
          voted: estadoVotos[cedula]?.voted || false,
          timestamp: new Date()
        }, { merge: true })
        loadAndRender(container, user)
      }
    })
  })
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

    // Verificar contraseña del admin actual
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

    // Crear registro de cierre
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