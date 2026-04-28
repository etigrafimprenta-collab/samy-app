/**
 * MÓDULO: DÍA D - PANEL ADMIN
 * Con métricas detalladas y seguimiento en tiempo real
 */

export function renderDiaDAdmin(container) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #e74c3c 0%, #ff9800 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="margin: 0 0 8px 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📋 DÍA D - PANEL ADMIN</h2>
          <p style="margin: 0; font-size: 0.9rem;">Seguimiento en tiempo real</p>
        </div>
        <div style="text-align: right; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px;" id="metricas-container">
      ⏳ Cargando métricas...
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;" id="produccion-container">
      ⏳ Cargando producción por militante...
    </div>
  `

  actualizarHora()
  setInterval(actualizarHora, 1000)
  
  // Auto-actualizar datos cada 5 segundos
  const refrescarDatos = setInterval(() => loadAndRender(container), 5000)
  
  // Limpiar intervalo cuando se salga del módulo
  window.addEventListener('beforeunload', () => clearInterval(refrescarDatos))
}

function actualizarHora() {
  const horaSpan = document.getElementById('hora-actual')
  if (horaSpan) {
    horaSpan.textContent = new Date().toLocaleTimeString('es-PY')
  }
}

async function loadAndRender(container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Cargar todos los registros salvados
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const allRecords = []
    recordsSnap.forEach(d => {
      allRecords.push({ id: d.id, ...d.data() })
    })

    // Cargar todos los votos
    const votosSnap = await getDocs(collection(db, 'dia_d_votos'))
    const allVotos = []
    votosSnap.forEach(d => {
      allVotos.push(d.data())
    })

    // Cargar todos los usuarios
    const usersSnap = await getDocs(collection(db, 'users'))
    const allUsers = {}
    usersSnap.forEach(d => {
      allUsers[d.id] = d.data()
    })

    renderMetricas(container, allRecords, allVotos)
    renderProduccionPorMilitante(container, allRecords, allVotos, allUsers)

  } catch (err) {
    console.error('Error:', err)
    const container = document.getElementById('produccion-container')
    if (container) {
      container.innerHTML = '<div style="color: #c62828;">Error: ' + err.message + '</div>'
    }
  }
}

function renderMetricas(container, allRecords, allVotos) {
  const totalEmpadronados = allRecords.length
  const votados = allVotos.filter(v => v.voted).length
  const votosRegistrados = allVotos.filter(v => v.voted).length
  const participacion = totalEmpadronados > 0 ? ((votados / totalEmpadronados) * 100).toFixed(2) : 0
  const viaticTotal = allVotos.reduce((sum, v) => sum + (v.viatico || 0), 0)

  const metricas = [
    { titulo: 'REGISTROS TOTALES', valor: totalEmpadronados, icono: '📋', color: '#c41e3a' },
    { titulo: 'CON VOTO REGISTRADO', valor: votosRegistrados, icono: '📦', color: '#1976d2' },
    { titulo: 'YA VOTARON', valor: votados, icono: '✅', color: '#2e7d32' },
    { titulo: 'PENDIENTES', valor: totalEmpadronados - votados, icono: '⏳', color: '#ff9800' },
    { titulo: 'PARTICIPACIÓN', valor: participacion + '%', icono: '%', color: '#1976d2' },
    { titulo: 'VIÁTICO TOTAL', valor: '₲' + viaticTotal.toLocaleString('es-PY'), icono: '💰', color: '#2e7d32' }
  ]

  let html = ''
  metricas.forEach(m => {
    html += '<div style="background: white; border: 2px solid ' + m.color + '; border-radius: 8px; padding: 16px; text-align: center;">'
    html += '<div style="font-size: 1.4rem; margin-bottom: 8px;">' + m.icono + '</div>'
    html += '<div style="font-size: 0.75rem; color: #666; font-weight: 600; margin-bottom: 4px;">' + m.titulo + '</div>'
    html += '<div style="font-size: 1.8rem; font-weight: 700; color: ' + m.color + ';">' + m.valor + '</div>'
    html += '</div>'
  })

  const metricsContainer = document.getElementById('metricas-container')
  if (metricsContainer) {
    metricsContainer.innerHTML = html
  }
}

function renderProduccionPorMilitante(container, allRecords, allVotos, allUsers) {
  // Agrupar registros por militante
  const porMilitante = {}
  allRecords.forEach(r => {
    const uid = r.uid
    if (!porMilitante[uid]) {
      porMilitante[uid] = []
    }
    porMilitante[uid].push(r)
  })

  // Calcular estadísticas por militante
  const stats = {}
  Object.entries(porMilitante).forEach(([uid, registros]) => {
    const user = allUsers[uid] || { displayName: 'Desconocido' }
    const votosDelMilitante = allVotos.filter(v => v.militante_id === uid && v.voted).length
    const totalRegistros = registros.length
    const participacionMilitante = totalRegistros > 0 ? ((votosDelMilitante / totalRegistros) * 100).toFixed(2) : 0

    stats[uid] = {
      nombre: user.displayName,
      totalRegistros: totalRegistros,
      votados: votosDelMilitante,
      pendientes: totalRegistros - votosDelMilitante,
      participacion: participacionMilitante,
      registros: registros,
      votos: allVotos.filter(v => v.militante_id === uid)
    }
  })

  // Ordenar por cantidad de registros (descendente)
  const militantesOrdenados = Object.entries(stats).sort((a, b) => b[1].totalRegistros - a[1].totalRegistros)

  let html = '<h3 style="font-family: Barlow Condensed; font-size: 1.3rem; text-transform: uppercase; margin: 0 0 20px 0;">📊 PRODUCCIÓN POR MILITANTE</h3>'

  militantesOrdenados.forEach(([uid, stat], index) => {
    const medallaEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤'
    const barraColor = stat.participacion >= 75 ? '#2e7d32' : stat.participacion >= 50 ? '#ff9800' : '#c41e3a'

    html += '<div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
    html += '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">'
    html += '<div><div style="font-weight: 700; font-size: 1rem;">' + medallaEmoji + ' ' + stat.nombre + '</div>'
    html += '<div style="font-size: 0.8rem; color: #666;">⏳ Pendientes: ' + stat.pendientes + '</div></div>'
    html += '<div style="background: #2e7d32; color: white; padding: 6px 12px; border-radius: 4px; font-weight: 700; font-size: 0.9rem;">' + stat.votados + '/' + stat.totalRegistros + ' (' + stat.participacion + '%)</div>'
    html += '</div>'

    html += '<div style="background: #e0e0e0; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 12px;"><div style="background: ' + barraColor + '; height: 100%; width: ' + stat.participacion + '%;"></div></div>'

    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; margin-bottom: 12px;">'
    html += '<div style="background: white; padding: 8px; border-radius: 4px; text-align: center; border-left: 3px solid #2e7d32;"><div style="font-weight: 700; color: #2e7d32;">' + stat.votados + '</div><div style="font-size: 0.7rem; color: #666;">Votaron</div></div>'
    html += '<div style="background: white; padding: 8px; border-radius: 4px; text-align: center; border-left: 3px solid #ff9800;"><div style="font-weight: 700; color: #ff9800;">' + stat.pendientes + '</div><div style="font-size: 0.7rem; color: #666;">Pendientes</div></div>'
    html += '<div style="background: white; padding: 8px; border-radius: 4px; text-align: center; border-left: 3px solid #1976d2;"><div style="font-weight: 700; color: #1976d2;">₲' + stat.votos.reduce((s, v) => s + (v.viatico || 0), 0) + '</div><div style="font-size: 0.7rem; color: #666;">Viático</div></div>'
    html += '</div>'

    html += '<button id="btn-detalle-' + uid + '" data-uid="' + uid + '" style="background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">🔍 Detalle</button>'
    html += '</div>'
  })

  const prodContainer = document.getElementById('produccion-container')
  if (prodContainer) {
    prodContainer.innerHTML = html

    militantesOrdenados.forEach(([uid, stat]) => {
      const btnDetalle = document.getElementById('btn-detalle-' + uid)
      if (btnDetalle) {
        btnDetalle.addEventListener('click', () => {
          mostrarDetalleMilitante(stat, uid)
        })
      }
    })
  }
}

function mostrarDetalleMilitante(stat, uid) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative;">'
  html += '<div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">🔍 DETALLE: ' + stat.nombre + '</h2>'
  html += '<button id="btn-cerrar-modal" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;">✕</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'

  // YA VOTARON
  const votados = stat.votos.filter(v => v.voted)
  if (votados.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0; font-family: Barlow Condensed; text-transform: uppercase;">✅ YA VOTARON (' + votados.length + ')</h3>'
    
    html += '<div style="display: grid; gap: 8px;">'
    votados.forEach(v => {
      const registro = stat.registros.find(r => r.cedula === v.cedula)
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
  const faltantes = stat.votos.filter(v => !v.voted)
  const faltantesPorLocal = {}
  
  // Incluir también registros que no tienen voto registrado
  stat.registros.forEach(r => {
    const tieneVoto = stat.votos.some(v => v.cedula === r.cedula)
    if (!tieneVoto) {
      faltantes.push({ cedula: r.cedula, nombre: r.nombre, voted: false })
    }
  })
  
  faltantes.forEach(v => {
    const registro = stat.registros.find(r => r.cedula === v.cedula)
    if (registro) {
      const local = registro.local || 'Sin local'
      if (!faltantesPorLocal[local]) faltantesPorLocal[local] = {}
      const mesa = registro.mesa || 'Sin mesa'
      if (!faltantesPorLocal[local][mesa]) faltantesPorLocal[local][mesa] = []
      faltantesPorLocal[local][mesa].push({ ...v, ...registro })
    }
  })

  if (Object.keys(faltantesPorLocal).length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 16px 0 12px 0; font-family: Barlow Condensed; text-transform: uppercase;">⏳ FALTANTES POR VOTAR (' + faltantes.length + ')</h3>'
    
    Object.entries(faltantesPorLocal).forEach(([local, mesas]) => {
      html += '<div style="margin-bottom: 16px; background: #fff9e6; padding: 12px; border-radius: 4px; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 8px;">📍 LOCAL: ' + local + '</div>'
      
      Object.entries(mesas).forEach(([mesa, registros]) => {
        html += '<div style="margin-left: 12px; margin-bottom: 8px;">'
        html += '<div style="font-weight: 600; font-size: 0.85rem; color: #ff6b6b;">🗳️ MESA ' + mesa + '</div>'
        
        registros.sort((a, b) => (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)).forEach(r => {
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
}