/**
 * MÓDULO: ADMIN - AUDITORÍA, EXPORTACIÓN Y GESTIÓN DE USUARIOS
 */

import { renderMyRecords } from './myRecords.js'

export function renderAdmin(content) {
  let currentView = 'resumen'

  function render() {
    if (currentView === 'resumen') {
      renderResumen(content, switchToAuditoria)
    } else if (currentView === 'auditoria') {
      renderAuditoria(content, switchToResumen)
    }
  }

  function switchToAuditoria() {
    currentView = 'auditoria'
    render()
  }

  function switchToResumen() {
    currentView = 'resumen'
    render()
  }

  render()
}

function renderResumen(container, onAuditoria) {
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; margin-bottom: 24px; align-items: start;">
      <div>
        <h2 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase;">📊 Resumen</h2>
        <p style="margin: 0; color: #666; font-size: 0.9rem;">Panel de control administrativo</p>
      </div>
      <button id="btn-exportar" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        📥 EXPORTAR
      </button>
      <button id="btn-usuarios" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        👥 USUARIOS
      </button>
      <button id="btn-auditoria" style="background: #ff9800; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        ⚠️ AUDITORÍA
      </button>
      <button id="btn-importar" style="background: #1565c0; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        📥 IMPORTAR
      </button>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <div style="display: flex; gap: 12px; align-items: center;">
        <input id="input-buscar" type="text" placeholder="Buscar por cédula, nombre, local o mesa..." style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
        <button id="btn-buscar" style="background: #2196f3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 600;">
          🔍 Buscar
        </button>
        <button id="btn-limpiar" style="background: #999; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 600;">
          ✕ Limpiar
        </button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px;">
      <div style="background: white; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 8px;">📋</div>
        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">REGISTROS TOTALES</div>
        <div id="total-registros" style="font-size: 2rem; font-weight: 700; color: #2196f3;">0</div>
      </div>

      <div style="background: white; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 8px;">👥</div>
        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">USUARIOS ACTIVOS</div>
        <div id="usuarios-activos" style="font-size: 2rem; font-weight: 700; color: #2196f3;">0</div>
      </div>

      <div style="background: white; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 8px;">📊</div>
        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">PROMEDIO POR USUARIO</div>
        <div id="promedio-usuario" style="font-size: 2rem; font-weight: 700; color: #2196f3;">0</div>
      </div>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
      <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase;">
        👥 TODOS LOS REGISTROS
      </h3>
      <div id="contenedor-registros" style="min-height: 400px;">
        ⏳ Cargando registros...
      </div>
    </div>
  `

  // Event listeners
  document.getElementById('btn-exportar').addEventListener('click', () => mostrarPanelExportacion(container))
  document.getElementById('btn-usuarios').addEventListener('click', () => mostrarUsuarios(container))
  document.getElementById('btn-auditoria').addEventListener('click', onAuditoria)
  document.getElementById('btn-importar').addEventListener('click', () => {
    mostrarPanelImportacion(container)
  })
  document.getElementById('btn-buscar').addEventListener('click', loadAndRenderRecords)
  document.getElementById('btn-limpiar').addEventListener('click', () => {
    document.getElementById('input-buscar').value = ''
    loadAndRenderRecords()
  })

  // Buscar al presionar Enter
  document.getElementById('input-buscar').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadAndRenderRecords()
  })

  // Cargar datos iniciales
  loadAndRenderRecords()
}

async function mostrarPanelExportacion(container) {
  // Cargar usuarios y locales para dropdowns
  const firebaseImport = await import('firebase/firestore')
  const { collection, getDocs } = firebaseImport
  const { db } = await import('../lib/firebase.js')

  const usersSnap = await getDocs(collection(db, 'users'))
  const usuarios = []
  usersSnap.forEach(d => {
    usuarios.push({
      uid: d.id,
      nombre: d.data().displayName || d.data().email || 'Sin nombre'
    })
  })

  // Cargar locales únicos desde savedRecords
  const recordsSnap = await getDocs(collection(db, 'savedRecords'))
  const localesSet = new Set()
  recordsSnap.forEach(d => {
    const local = d.data().local
    if (local) localesSet.add(local)
  })
  
  const locales = Array.from(localesSet).sort()

  const html = `
    <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📥 EXPORTAR REGISTROS</h2>
        <button id="btn-volver-exportacion" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 24px;">
      <h3 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
        🔍 FILTROS DE EXPORTACIÓN
      </h3>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Militante (opcional):</label>
          <select id="filtro-militante" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
            <option value="">-- Todos los militantes --</option>
            ${usuarios.map(u => `<option value="${u.uid}">${u.nombre}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Local (opcional):</label>
          <select id="filtro-local" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
            <option value="">-- Todos los locales --</option>
            ${locales.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Mesa (opcional):</label>
          <input id="filtro-mesa" type="text" placeholder="Ej: 5" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
        </div>
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button id="btn-excel" style="flex: 1; background: #2e7d32; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; min-width: 150px;">
          📊 Descargar Excel
        </button>
        <button id="btn-imprimir-registros" style="flex: 1; background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; min-width: 150px;">
          🖨️ Imprimir
        </button>
      </div>
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-volver-exportacion').addEventListener('click', () => location.reload())
  document.getElementById('btn-excel').addEventListener('click', () => descargarExcel(container))
  document.getElementById('btn-imprimir-registros').addEventListener('click', () => imprimirRegistros(container))
}

async function descargarExcel(container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Obtener filtros
    const militante = document.getElementById('filtro-militante')?.value || ''
    const local = document.getElementById('filtro-local')?.value || ''
    const mesa = document.getElementById('filtro-mesa')?.value || ''

    // Cargar registros
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    let registros = []
    recordsSnap.forEach(d => {
      const data = d.data()
      registros.push({
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        local: data.local || '',
        mesa: data.mesa || '',
        telefono: data.telefono || '',
        uid: data.uid || ''
      })
    })

    // Cargar usuarios
    const usersSnap = await getDocs(collection(db, 'users'))
    const usuarios = {}
    usersSnap.forEach(d => {
      usuarios[d.id] = d.data().displayName || d.data().email || 'N/A'
    })

    // Aplicar filtros
    if (militante) {
      registros = registros.filter(r => r.uid === militante)
    }
    if (local) {
      registros = registros.filter(r => r.local === local)
    }
    if (mesa) {
      registros = registros.filter(r => r.mesa.toString() === mesa)
    }

    // Crear CSV
    const headers = ['Cédula', 'Nombre', 'Apellidos', 'Local', 'Mesa', 'Teléfono', 'Militante']
    const rows = registros.map(r => [
      r.cedula,
      r.nombre,
      r.apellidos,
      r.local,
      r.mesa,
      r.telefono,
      usuarios[r.uid] || 'N/A'
    ])

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // Descargar
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `registros-${new Date().getTime()}.csv`
    link.click()

    alert(`✅ ${registros.length} registros exportados a Excel`)

  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function imprimirRegistros(container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Obtener filtros
    const militante = document.getElementById('filtro-militante')?.value || ''
    const local = document.getElementById('filtro-local')?.value || ''
    const mesa = document.getElementById('filtro-mesa')?.value || ''

    // Cargar registros
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    let registros = []
    recordsSnap.forEach(d => {
      const data = d.data()
      registros.push({
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        local: data.local || '',
        mesa: data.mesa || '',
        telefono: data.telefono || ''
      })
    })

    // Cargar usuarios para nombres de militantes
    const usersSnap = await getDocs(collection(db, 'users'))
    const usuariosMap = {}
    recordsSnap.forEach(d => {
      const uid = d.data().uid
      if (!usuariosMap[uid]) {
        usersSnap.forEach(u => {
          if (u.id === uid) {
            usuariosMap[uid] = u.data().displayName || u.data().email || 'N/A'
          }
        })
      }
    })

    // Aplicar filtros
    if (militante) {
      recordsSnap.forEach(d => {
        if (d.data().uid === militante) {
          const data = d.data()
          registros = registros.filter(r => {
            for (const ud of usersSnap.docs) {
              if (ud.id === militante) return true
            }
            return false
          })
        }
      })
    }
    if (local) {
      registros = registros.filter(r => r.local === local)
    }
    if (mesa) {
      registros = registros.filter(r => r.mesa.toString() === mesa)
    }

    // Abrir ventana de impresión
    const printWindow = window.open('', '_blank')
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Registros para Imprimir</title>
          <style>
            * { margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { color: #2196f3; border-bottom: 3px solid #2196f3; padding-bottom: 10px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #f5f5f5; border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: 700; }
            td { border: 1px solid #ddd; padding: 8px; font-size: 0.9rem; }
            tr:nth-child(even) { background: #f9f9f9; }
            .timestamp { color: #999; font-size: 0.85rem; margin-top: 20px; }
            @media print {
              body { background: white; }
              h1 { page-break-after: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>📋 Listado de Registros</h1>
          <p style="margin-bottom: 20px;">Total de registros: <strong>${registros.length}</strong></p>
          <table>
            <thead>
              <tr>
                <th>Cédula</th>
                <th>Nombre</th>
                <th>Apellidos</th>
                <th>Local</th>
                <th>Mesa</th>
                <th>Teléfono</th>
              </tr>
            </thead>
            <tbody>
              ${registros.map(r => `
                <tr>
                  <td style="font-family: monospace; font-size: 0.85rem;">${r.cedula}</td>
                  <td><strong>${r.nombre}</strong></td>
                  <td>${r.apellidos}</td>
                  <td>${r.local}</td>
                  <td>${r.mesa}</td>
                  <td>${r.telefono}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="timestamp">Impreso: ${new Date().toLocaleString('es-PY')}</div>
        </body>
      </html>
    `)
    printWindow.document.close()
    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 300)

  } catch (err) {
    alert('Error: ' + err.message)
  }
}

function loadAndRenderRecords() {
  import('firebase/firestore').then(async (firebaseImport) => {
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Cargar TODOS los registros
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const allRecords = []
    recordsSnap.forEach(d => {
      const data = d.data()
      allRecords.push({
        id: d.id,
        uid: data.uid || '',
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        local: data.local || '',
        mesa: data.mesa || '',
        telefono: data.telefono || ''
      })
    })

    // Cargar usuarios
    const usersSnap = await getDocs(collection(db, 'users'))
    const allUsers = {}
    usersSnap.forEach(d => {
      allUsers[d.id] = { ...d.data(), uid: d.id }
    })

    // Filtrar por búsqueda
    const termino = document.getElementById('input-buscar')?.value?.toLowerCase() || ''
    let registrosFiltrados = allRecords
    
    if (termino) {
      registrosFiltrados = allRecords.filter(r => 
        r.cedula.toLowerCase().includes(termino) ||
        r.nombre.toLowerCase().includes(termino) ||
        r.apellidos.toLowerCase().includes(termino) ||
        r.local.toLowerCase().includes(termino) ||
        r.mesa.toLowerCase().includes(termino)
      )
    }

    // Actualizar estadísticas
    const porUsuario = {}
    allRecords.forEach(r => {
      if (!porUsuario[r.uid]) porUsuario[r.uid] = 0
      porUsuario[r.uid]++
    })

    const usuariosActivos = Object.keys(porUsuario).length
    const promedio = usuariosActivos > 0 ? Math.round(allRecords.length / usuariosActivos) : 0

    document.getElementById('total-registros').textContent = allRecords.length
    document.getElementById('usuarios-activos').textContent = usuariosActivos
    document.getElementById('promedio-usuario').textContent = promedio

    // Renderizar tabla filtrada
    let html = `
      ${termino ? `
        <div style="background: #e3f2fd; border-left: 4px solid #1976d2; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
          <strong>Resultados de búsqueda:</strong> ${registrosFiltrados.length} de ${allRecords.length} registros
        </div>
      ` : ''}

      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
          <thead style="background: #000; color: white; position: sticky; top: 0;">
            <tr>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Cédula</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Nombre</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Local</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Mesa</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Teléfono</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Militante</th>
            </tr>
          </thead>
          <tbody>
            ${registrosFiltrados.map(r => {
              const user = allUsers[r.uid]
              const destacar = termino ? 'background: #fffacd;' : ''
              return `
                <tr style="border-bottom: 1px solid #eee; ${destacar}">
                  <td style="padding: 10px; font-family: monospace; font-size: 0.75rem;">${r.cedula}</td>
                  <td style="padding: 10px;"><strong>${r.nombre}</strong> ${r.apellidos}</td>
                  <td style="padding: 10px; font-size: 0.8rem;">${r.local}</td>
                  <td style="padding: 10px; font-size: 0.8rem;">${r.mesa}</td>
                  <td style="padding: 10px; font-size: 0.8rem;">${r.telefono}</td>
                  <td style="padding: 10px; font-size: 0.8rem;"><strong>${user?.displayName || user?.email || 'N/A'}</strong></td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>

      ${registrosFiltrados.length === 0 && termino ? `
        <div style="text-align: center; padding: 40px; color: #999;">
          <div style="font-size: 1.1rem;">🔍 Sin resultados</div>
          <div style="font-size: 0.9rem;">No se encontraron registros que coincidan con "<strong>${termino}</strong>"</div>
        </div>
      ` : ''}
    `

    document.getElementById('contenedor-registros').innerHTML = html

  }).catch(err => {
    console.error('Error:', err)
    document.getElementById('contenedor-registros').innerHTML = `<div style="color: red;">Error: ${err.message}</div>`
  })
}

async function mostrarUsuarios(container) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">👥 USUARIOS</h2>
        <button id="btn-volver-usuarios" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>
    <div style="text-align: center; padding: 40px; color: #666;">⏳ Cargando usuarios...</div>
  `

  document.getElementById('btn-volver-usuarios').addEventListener('click', () => location.reload())

  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Cargar usuarios
    const usersSnap = await getDocs(collection(db, 'users'))
    const allUsers = []
    usersSnap.forEach(d => {
      allUsers.push({
        uid: d.id,
        displayName: d.data().displayName || d.data().email || 'Sin nombre',
        email: d.data().email || 'N/A',
        password: d.data().password || 'N/A'
      })
    })

    // Cargar registros para contar
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const porUsuario = {}
    recordsSnap.forEach(d => {
      const uid = d.data().uid
      porUsuario[uid] = (porUsuario[uid] || 0) + 1
    })

    // Crear ranking
    const ranking = allUsers.map(u => ({
      ...u,
      cantidad: porUsuario[u.uid] || 0,
      role: u.role || 'user'
    })).sort((a, b) => b.cantidad - a.cantidad)

    renderUsuariosPanel(container, ranking)

  } catch (err) {
    console.error('Error:', err)
    container.innerHTML = `<div style="background: #ffebee; border-left: 4px solid #c62828; padding: 16px; border-radius: 4px; color: #c62828;"><strong>Error:</strong> ${err.message}</div>`
  }
}

function renderUsuariosPanel(container, ranking) {
  let html = `
    <div style="background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">👥 USUARIOS (${ranking.length})</h2>
        <div style="display: flex; gap: 12px;">
          <button id="btn-crear-usuario" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            ➕ CREAR USUARIO
          </button>
          <button id="btn-volver-usuarios" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            ← Volver
          </button>
        </div>
      </div>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
      <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
        🏆 RANKING
      </h3>

      <div style="display: grid; gap: 12px;">
        ${ranking.map((user, idx) => `
          <div style="border: 1px solid #eee; border-radius: 6px; padding: 16px; background: ${idx === 0 ? '#fff9c4' : idx === 1 ? '#f0f4c3' : idx === 2 ? '#e0f2f1' : '#f9f9f9'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: ${idx === 0 ? '#ffc107' : idx === 1 ? '#c0ca33' : idx === 2 ? '#26c6da' : '#999'};">
                  ${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                </div>
                <div>
                  <div style="font-weight: 700; font-size: 0.95rem;">${user.displayName}</div>
                  <div style="font-size: 0.75rem; color: #666;">${user.email}</div>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 1.4rem; font-weight: 700; color: #2196f3;">${user.cantidad}</div>
                <div style="font-size: 0.75rem; color: #666;">registros</div>
              </div>
            </div>

            <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 12px; font-size: 0.85rem; font-family: monospace;">
              <div><strong>Nombre:</strong> ${user.displayName}</div>
              <div><strong>Email:</strong> ${user.email}</div>
              <div><strong>Contraseña:</strong> ${user.password}</div>
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ddd;"><strong>Rol:</strong> <span style="background: ${user.role === 'admin' ? '#ff9800' : '#2196f3'}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700;">${user.role === 'admin' ? '👑 ADMIN' : '👤 USER'}</span></div>
            </div>

            <div style="display: flex; gap: 8px;">
              <button id="btn-imprimir-${user.uid}" class="btn-imprimir-usuario" style="flex: 1; background: #2e7d32; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                🖨️ Imprimir
              </button>
              <button id="btn-excel-${user.uid}" class="btn-excel-usuario" style="flex: 1; background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                📊 Excel
              </button>
              <button id="btn-rol-${user.uid}" class="btn-rol-usuario" data-uid="${user.uid}" data-role="${user.role}" style="flex: 1; background: ${user.role === 'admin' ? '#4caf50' : '#ff9800'}; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                ${user.role === 'admin' ? '👤 → USER' : '👑 → ADMIN'}
              </button>
              <button id="btn-admin-${user.uid}" class="btn-admin-usuario" data-uid="${user.uid}" data-nombre="${user.displayName}" data-password="${user.password}" style="flex: 1; background: #d32f2f; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                ⚙️ Editar
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-volver-usuarios').addEventListener('click', () => location.reload())
  document.getElementById('btn-crear-usuario').addEventListener('click', () => mostrarPanelCrearUsuario(container))

  // Event listeners para imprimir
  ranking.forEach(user => {
    const btnPrint = document.getElementById(`btn-imprimir-${user.uid}`)
    const btnExcel = document.getElementById(`btn-excel-${user.uid}`)
    const btnRol = document.getElementById(`btn-rol-${user.uid}`)
    const btnAdmin = document.getElementById(`btn-admin-${user.uid}`)
    
    if (btnPrint) {
      btnPrint.addEventListener('click', () => imprimirRegistrosUsuario(user))
    }
    if (btnExcel) {
      btnExcel.addEventListener('click', () => exportarExcelUsuario(user))
    }
    if (btnRol) {
      btnRol.addEventListener('click', () => {
        const currentRole = btnRol.getAttribute('data-role')
        const newRole = currentRole === 'admin' ? 'user' : 'admin'
        cambiarRolUsuario(user.uid, newRole)
      })
    }
    if (btnAdmin) {
      btnAdmin.addEventListener('click', () => {
        const uid = btnAdmin.getAttribute('data-uid')
        const nombre = btnAdmin.getAttribute('data-nombre')
        const password = btnAdmin.getAttribute('data-password')
        mostrarPanelAdministrarUsuario(container, { uid, displayName: nombre, password })
      })
    }
  })
}

function imprimirRegistrosUsuario(user) {
  const printWindow = window.open('', '_blank')
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Registros de ${user.displayName}</title>
        <style>
          * { margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; padding: 20px; background: white; }
          h1 { color: #2196f3; border-bottom: 3px solid #2196f3; padding-bottom: 10px; margin-bottom: 20px; }
          .info-box { background: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .info-box div { margin: 8px 0; font-size: 0.95rem; }
          strong { font-weight: 700; }
          .timestamp { color: #999; font-size: 0.85rem; margin-top: 40px; }
          @media print {
            body { background: white; }
            h1 { page-break-after: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>👤 Información del Usuario</h1>
        <div class="info-box">
          <div><strong>Nombre:</strong> ${user.displayName}</div>
          <div><strong>Email:</strong> ${user.email}</div>
          <div><strong>Contraseña:</strong> ${user.password}</div>
          <div><strong>Total de registros:</strong> ${user.cantidad}</div>
        </div>
        <div class="timestamp">Impreso: ${new Date().toLocaleString('es-PY')}</div>
      </body>
    </html>
  `)
  printWindow.document.close()
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 300)
}

async function exportarExcelUsuario(user) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Cargar registros del usuario
    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const registros = []
    recordsSnap.forEach(d => {
      const data = d.data()
      if (data.uid === user.uid) {
        registros.push({
          cedula: data.cedula || '',
          nombre: data.nombre || '',
          apellidos: data.apellidos || data.apellido || '',
          local: data.local || '',
          mesa: data.mesa || '',
          telefono: data.telefono || ''
        })
      }
    })

    // Crear CSV
    const headers = ['Cédula', 'Nombre', 'Apellidos', 'Local', 'Mesa', 'Teléfono']
    const rows = registros.map(r => [
      r.cedula, r.nombre, r.apellidos, r.local, r.mesa, r.telefono
    ])

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // Descargar
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `registros-${user.displayName}-${new Date().getTime()}.csv`
    link.click()

    alert(`✅ ${registros.length} registros de ${user.displayName} exportados`)

  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function renderAuditoria(container, onVolver) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚠️ AUDITORÍA DE DUPLICADOS</h2>
        <button id="btn-volver-auditoria" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>
    <div style="text-align: center; padding: 40px; color: #666;">⏳ Analizando registros...</div>
  `

  document.getElementById('btn-volver-auditoria').addEventListener('click', onVolver)

  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs, deleteDoc, doc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Cargar usuarios
    const usersSnap = await getDocs(collection(db, 'users'))
    const allUsers = {}
    usersSnap.forEach(d => {
      allUsers[d.id] = { ...d.data(), uid: d.id }
    })

    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const allRecords = []
    recordsSnap.forEach(d => {
      allRecords.push({ id: d.id, ...d.data() })
    })

    // Detectar duplicados
    const porCedula = {}
    allRecords.forEach(r => {
      const cedula = r.cedula
      if (!porCedula[cedula]) porCedula[cedula] = []
      porCedula[cedula].push(r)
    })

    const duplicados = Object.entries(porCedula).filter(([_, records]) => records.length > 1)

    if (duplicados.length === 0) {
      container.innerHTML += `
        <div style="background: #e8f5e9; border: 2px solid #2e7d32; border-radius: 8px; padding: 20px; text-align: center; color: #2e7d32;">
          <h3 style="margin: 0 0 10px 0;">✅ ¡Sin duplicados encontrados!</h3>
          <p style="margin: 0;">La base de datos está limpia.</p>
        </div>
      `
      return
    }

    renderDuplicadosPanel(container, duplicados, db, deleteDoc, doc, allUsers)

  } catch (err) {
    container.innerHTML = `<div style="color: red;">Error: ${err.message}</div>`
  }
}

function renderDuplicadosPanel(container, duplicados, db, deleteDoc, doc, allUsers) {
  let html = `
    <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚠️ DUPLICADOS ENCONTRADOS: ${duplicados.length}</h2>
    </div>

    <div style="display: grid; gap: 16px;">
      ${duplicados.map(([cedula, records]) => `
        <div style="background: white; border: 2px solid #ff9800; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 700; color: #ff9800; margin-bottom: 12px;">
            🔴 Cédula: ${cedula} (${records.length} registros)
          </div>
          <div style="display: grid; gap: 8px;">
            ${records.map((r, idx) => `
              <div style="background: ${idx === 0 ? '#e8f5e9' : '#ffebee'}; padding: 12px; border-radius: 4px; border-left: 4px solid ${idx === 0 ? '#2e7d32' : '#d32f2f'};">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <div>
                    <div><strong>${r.nombre}</strong> ${idx === 0 ? '<span style="background: #2e7d32; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700;">✅ Original</span>' : '<span style="background: #d32f2f; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700;">❌ Duplicado</span>'}</div>
                    <div style="font-size: 0.85rem; color: #666;">Local: ${r.local} | Mesa: ${r.mesa}</div>
                    <div style="font-size: 0.8rem; color: #999; margin-top: 6px; font-family: monospace;">
                      👤 Militante: <strong>${allUsers[r.uid]?.displayName || 'N/A'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <button id="btn-resolver-${cedula.replace(/\./g, '-')}" class="btn-resolver-duplicado" data-cedula="${cedula}" style="background: #ff9800; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600; margin-top: 12px;">
            🔧 Resolver
          </button>
        </div>
      `).join('')}
    </div>
  `

  container.innerHTML = html

  document.querySelectorAll('.btn-resolver-duplicado').forEach(btn => {
    btn.addEventListener('click', () => {
      const cedula = btn.getAttribute('data-cedula')
      const records = duplicados.find(d => d[0] === cedula)[1]
      mostrarResolverDuplicado(container, cedula, records[0], records.slice(1), db, deleteDoc, doc, allUsers)
    })
  })
}

async function mostrarResolverDuplicado(container, cedula, original, duplicados, db, deleteDoc, doc, allUsers) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase;">Resolver Duplicado: ${cedula}</h2>
    </div>

    <div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <div style="font-weight: 700; color: #2e7d32; margin-bottom: 8px;">✅ MANTENER (Original):</div>
      <div style="background: #f5f5f5; padding: 12px; border-radius: 4px;">
        <div><strong>${original.nombre}</strong></div>
        <div style="font-size: 0.85rem; color: #666;">Local: ${original.local} | Mesa: ${original.mesa}</div>
        <div style="font-size: 0.8rem; color: #999; margin-top: 6px; font-family: monospace;">
          👤 Militante: <strong>${allUsers[original.uid]?.displayName || 'N/A'}</strong>
        </div>
      </div>
    </div>

    <div style="background: white; border: 2px solid #d32f2f; border-radius: 8px; padding: 16px;">
      <div style="font-weight: 700; color: #d32f2f; margin-bottom: 8px;">❌ ELIMINAR (Duplicados):</div>
      <div style="display: grid; gap: 8px;">
        ${duplicados.map((dup, idx) => `
          <label style="display: flex; align-items: flex-start; gap: 8px; background: #f5f5f5; padding: 12px; border-radius: 4px; cursor: pointer;">
            <input type="checkbox" id="dup-${idx}" class="check-duplicado" data-id="${dup.id}" checked style="cursor: pointer; margin-top: 4px;">
            <span style="flex: 1;">
              <strong>${dup.nombre}</strong>
              <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">Local: ${dup.local} | Mesa: ${dup.mesa}</div>
              <div style="font-size: 0.8rem; color: #999; margin-top: 4px; font-family: monospace;">
                👤 Militante: <strong>${allUsers[dup.uid]?.displayName || 'N/A'}</strong>
              </div>
            </span>
          </label>
        `).join('')}
      </div>

      <button id="btn-eliminar-seleccionados" style="background: #d32f2f; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; margin-top: 16px; width: 100%;">
        🗑️ Eliminar Seleccionados
      </button>
    </div>
  `

  document.getElementById('btn-eliminar-seleccionados').addEventListener('click', async () => {
    const checklist = document.querySelectorAll('.check-duplicado:checked')
    const idsAEliminar = Array.from(checklist).map(cb => cb.getAttribute('data-id'))

    if (idsAEliminar.length === 0) {
      alert('Selecciona al menos un duplicado para eliminar')
      return
    }

    try {
      for (const id of idsAEliminar) {
        await deleteDoc(doc(db, 'savedRecords', id))
      }
      alert(`✅ ${idsAEliminar.length} registros eliminados`)
      location.reload()
    } catch (err) {
      alert('Error al eliminar: ' + err.message)
    }
  })
}

async function mostrarPanelAdministrarUsuario(container, user) {
  const html = `
    <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚙️ ADMINISTRAR: ${user.displayName}</h2>
        <button id="btn-volver-admin" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
      <!-- Modificar Nombre -->
      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #1976d2;">
          ✏️ Modificar Nombre
        </h3>
        <div style="display: grid; gap: 12px;">
          <div>
            <label style="display: block; font-weight: 700; margin-bottom: 8px; font-size: 0.9rem;">Nuevo Nombre:</label>
            <input id="input-nombre" type="text" value="${user.displayName}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
          </div>
          <button id="btn-guardar-nombre" style="background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 600;">
            💾 Guardar Nombre
          </button>
        </div>
      </div>

      <!-- Modificar Contraseña -->
      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #d32f2f;">
          🔐 Modificar Contraseña
        </h3>
        <div style="display: grid; gap: 12px;">
          <div>
            <label style="display: block; font-weight: 700; margin-bottom: 8px; font-size: 0.9rem;">Nueva Contraseña:</label>
            <input id="input-password" type="text" placeholder="Ingrese nueva contraseña" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
          </div>
          <button id="btn-guardar-password" style="background: #d32f2f; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 600;">
            🔐 Actualizar Contraseña
          </button>
        </div>
      </div>

      <!-- Cambiar Rol -->
      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #ff9800;">
          👑 Cambiar Rol
        </h3>
        <div style="display: grid; gap: 12px;">
          <div>
            <label style="display: block; font-weight: 700; margin-bottom: 8px; font-size: 0.9rem;">Rol Actual:</label>
            <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; font-weight: 700; color: ${user.password && user.password.role === 'admin' ? '#ff9800' : '#2196f3'};">
              ${user.password && user.password.role === 'admin' ? '👑 ADMIN' : '👤 USER'}
            </div>
          </div>
          <button id="btn-cambiar-rol" style="background: #ff9800; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: 600; width: 100%;">
            🔄 Cambiar a ${user.password && user.password.role === 'admin' ? 'USER' : 'ADMIN'}
          </button>
        </div>
      </div>
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-volver-admin').addEventListener('click', () => location.reload())
  document.getElementById('btn-guardar-nombre').addEventListener('click', () => guardarNombreUsuario(user.uid, document.getElementById('input-nombre').value))
  document.getElementById('btn-guardar-password').addEventListener('click', () => guardarPasswordUsuario(user.uid, document.getElementById('input-password').value))
  document.getElementById('btn-cambiar-rol').addEventListener('click', () => cambiarRolUsuario(user.uid, user.password && user.password.role === 'admin' ? 'user' : 'admin'))
}

async function guardarNombreUsuario(uid, nuevoNombre) {
  if (!nuevoNombre.trim()) {
    alert('Por favor ingrese un nombre')
    return
  }

  try {
    const firebaseImport = await import('firebase/firestore')
    const { doc, updateDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    await updateDoc(doc(db, 'users', uid), {
      displayName: nuevoNombre
    })

    alert('✅ Nombre actualizado correctamente')
    location.reload()
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function guardarPasswordUsuario(uid, nuevaPassword) {
  if (!nuevaPassword.trim()) {
    alert('Por favor ingrese una contraseña')
    return
  }

  try {
    const firebaseImport = await import('firebase/firestore')
    const { doc, updateDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    await updateDoc(doc(db, 'users', uid), {
      password: nuevaPassword
    })

    alert('✅ Contraseña actualizada correctamente')
    location.reload()
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function cambiarRolUsuario(uid, nuevoRol) {
  const confirmacion = confirm(`¿Cambiar rol a ${nuevoRol === 'admin' ? 'ADMIN' : 'USER'}?`)
  if (!confirmacion) return

  try {
    const firebaseImport = await import('firebase/firestore')
    const { doc, updateDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    await updateDoc(doc(db, 'users', uid), {
      role: nuevoRol
    })

    alert(`✅ Rol actualizado a ${nuevoRol === 'admin' ? '👑 ADMIN' : '👤 USER'}`)
    location.reload()
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function mostrarPanelCrearUsuario(container) {
  const html = `
    <div style="background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">➕ CREAR USUARIO</h2>
        <button id="btn-volver-crear" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 24px; max-width: 500px;">
      <h3 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
        Datos del Nuevo Usuario
      </h3>

      <div style="display: grid; gap: 16px;">
        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Nombre Completo:</label>
          <input id="input-crear-nombre" type="text" placeholder="Ej: Juan Pérez" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Email:</label>
          <input id="input-crear-email" type="email" placeholder="Ej: juan@example.com" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Contraseña:</label>
          <input id="input-crear-password" type="text" placeholder="Ingrese contraseña" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
        </div>

        <button id="btn-crear-usuario-submit" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%; margin-top: 12px;">
          ✅ Crear Usuario
        </button>
      </div>
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-volver-crear').addEventListener('click', () => location.reload())
  document.getElementById('btn-crear-usuario-submit').addEventListener('click', () => {
    const nombre = document.getElementById('input-crear-nombre').value
    const email = document.getElementById('input-crear-email').value
    const password = document.getElementById('input-crear-password').value

    if (!nombre.trim() || !email.trim() || !password.trim()) {
      alert('Por favor complete todos los campos')
      return
    }

    crearNuevoUsuario(nombre, email, password)
  })
}

async function crearNuevoUsuario(nombre, email, password) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, addDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    // Generar UID simple
    const nuevoUID = `user-${Date.now()}`

    await addDoc(collection(db, 'users'), {
      uid: nuevoUID,
      displayName: nombre,
      email: email,
      password: password,
      role: 'user',
      createdAt: new Date()
    })

    alert(`✅ Usuario "${nombre}" creado correctamente\n\nEmail: ${email}\nContraseña: ${password}`)
    location.reload()
  } catch (err) {
    alert('Error al crear usuario: ' + err.message)
  }
}


// ============================================================
// FUNCIONALIDAD DE IMPORTACIÓN - INTEGRADA EN ADMIN.JS
// ============================================================

function mostrarPanelImportacion(container) {
  const html = `
    <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📥 IMPORTAR REGISTROS</h2>
      <p style="margin: 0; font-size: 0.9rem;">Carga datos desde Excel o CSV</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
      <!-- OPCIÓN 1: CARGA TOTAL -->
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 24px;">
        <div style="font-size: 2rem; margin-bottom: 12px;">📤</div>
        <h3 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #1976d2;">Carga Total</h3>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 0.9rem;">Reemplaza el archivo completo o filas individuales seleccionadas.</p>
        <button id="btn-carga-total" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">
          📁 Seleccionar Archivo
        </button>
        <input type="file" id="file-carga-total" accept=".csv,.xlsx,.xls" style="display: none;">
      </div>

      <!-- OPCIÓN 2: ACTUALIZACIÓN -->
      <div style="background: white; border: 2px solid #4caf50; border-radius: 8px; padding: 24px;">
        <div style="font-size: 2rem; margin-bottom: 12px;">🔄</div>
        <h3 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #4caf50;">Actualización</h3>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 0.9rem;">Compara por cédula y actualiza datos faltantes.</p>
        <button id="btn-actualizacion" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">
          📁 Seleccionar Archivo
        </button>
        <input type="file" id="file-actualizacion" accept=".csv,.xlsx,.xls" style="display: none;">
      </div>
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-carga-total').addEventListener('click', () => {
    document.getElementById('file-carga-total').click()
  })

  document.getElementById('btn-actualizacion').addEventListener('click', () => {
    document.getElementById('file-actualizacion').click()
  })

  document.getElementById('file-carga-total').addEventListener('change', (e) => {
    if (e.target.files[0]) procesarCargaTotal(e.target.files[0], container)
  })

  document.getElementById('file-actualizacion').addEventListener('change', (e) => {
    if (e.target.files[0]) procesarActualizacion(e.target.files[0], container)
  })
}

async function procesarCargaTotal(file, container) {
  try {
    const datos = await leerCSV(file)
    if (!datos || datos.length === 0) {
      alert('❌ El archivo no contiene datos')
      return
    }
    mostrarConfirmacionCarga(datos, container)
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

async function procesarActualizacion(file, container) {
  try {
    const datos = await leerCSV(file)
    if (!datos || datos.length === 0) {
      alert('❌ El archivo no contiene datos')
      return
    }

    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const datosActuales = {}
    recordsSnap.forEach(d => {
      const data = d.data()
      datosActuales[data.cedula] = { id: d.id, ...data }
    })

    mostrarConfirmacionActualizacion(datos, datosActuales, container)
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

function leerCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const csv = e.target.result
        const filas = csv.split('\n').filter(f => f.trim())
        const headers = filas[0].split(',').map(h => h.trim().toLowerCase())
        const datos = filas.slice(1).map(fila => {
          const valores = fila.split(',')
          const obj = {}
          headers.forEach((h, i) => {
            obj[h] = valores[i] ? valores[i].trim() : ''
          })
          return obj
        })
        resolve(datos)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Error al leer archivo'))
    reader.readAsText(file)
  })
}

function normalizarTelefono(tel) {
  if (!tel) return ''
  const solo_numeros = tel.replace(/\D/g, '')
  if (solo_numeros.startsWith('595')) {
    return solo_numeros.substring(3)
  }
  if (solo_numeros.length === 9) {
    return solo_numeros
  }
  return solo_numeros.slice(-9)
}

function mostrarConfirmacionCarga(datos, container) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"><div style="background: #1976d2; color: white; padding: 20px; border-radius: 8px 8px 0 0;"><h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">⚠️ CONFIRMAR CARGA</h2></div><div style="padding: 20px;"><div style="background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 12px; border-radius: 4px; margin-bottom: 16px;"><strong>Advertencia:</strong> Se cargarán ' + datos.length + ' registros. ¿Desea continuar?</div><div style="margin-top: 20px; display: flex; gap: 12px;"><button id="btn-confirmar" style="flex: 1; background: #1976d2; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ CONFIRMAR</button><button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button></div></div></div>'

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar').addEventListener('click', () => modal.remove())
  document.getElementById('btn-confirmar').addEventListener('click', async () => {
    await ejecutarCargaTotal(datos, modal)
  })
}

async function ejecutarCargaTotal(datos, modal) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, writeBatch, doc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    modal.remove()
    alert('⏳ Cargando ' + datos.length + ' registros...')

    const batch = writeBatch(db)
    let count = 0

    datos.forEach((row) => {
      const cedula = (row.cedula || row['cédula'] || '').trim()
      if (cedula) {
        const telefono = normalizarTelefono(row.telefono || row['teléfono'] || '')
        const docRef = doc(collection(db, 'savedRecords'))
        batch.set(docRef, {
          cedula: cedula,
          nombre: row.nombre || '',
          apellidos: row.apellidos || row['apellido'] || '',
          local: row.local || row['lugar de votación'] || '',
          mesa: row.mesa || '',
          orden: row.orden || '',
          telefono: telefono,
          uid: 'admin',
          timestamp: new Date()
        })
        count++
      }
    })

    await batch.commit()
    alert('✅ Se cargaron ' + count + ' registros exitosamente')
    location.reload()
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

function mostrarConfirmacionActualizacion(datosNuevos, datosActuales, container) {
  let cambios = []

  datosNuevos.forEach(row => {
    const cedula = (row.cedula || row['cédula'] || '').trim()
    if (!cedula) return

    if (datosActuales[cedula]) {
      const campos_cambiar = {}
      const campos = ['nombre', 'apellidos', 'local', 'mesa', 'orden', 'telefono']
      
      campos.forEach(campo => {
        const valor_nuevo = row[campo] || row[campo === 'telefono' ? 'teléfono' : campo] || ''
        const valor_actual = datosActuales[cedula][campo] || ''
        
        if (valor_nuevo.trim() && valor_nuevo.trim() !== valor_actual.trim()) {
          campos_cambiar[campo] = campo === 'telefono' ? normalizarTelefono(valor_nuevo) : valor_nuevo.trim()
        }
      })

      if (Object.keys(campos_cambiar).length > 0) {
        cambios.push({ cedula, campos_cambiar })
      }
    }
  })

  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"><div style="background: #4caf50; color: white; padding: 20px; border-radius: 8px 8px 0 0;"><h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">🔄 ACTUALIZACIÓN: ' + cambios.length + ' CAMBIOS</h2></div><div style="padding: 20px;"><div style="margin-top: 20px; display: flex; gap: 12px;"><button id="btn-confirmar-act" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ CONFIRMAR</button><button id="btn-cancelar-act" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button></div></div></div>'

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar-act').addEventListener('click', () => modal.remove())
  document.getElementById('btn-confirmar-act').addEventListener('click', async () => {
    await ejecutarActualizacion(cambios, modal)
  })
}

async function ejecutarActualizacion(cambios, modal) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, writeBatch, doc, getDocs, query, where } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    modal.remove()
    alert('⏳ Actualizando ' + cambios.length + ' registros...')

    const batch = writeBatch(db)

    for (let c of cambios) {
      const q = query(collection(db, 'savedRecords'), where('cedula', '==', c.cedula))
      const snap = await getDocs(q)
      snap.forEach(docSnap => {
        batch.update(doc(db, 'savedRecords', docSnap.id), c.campos_cambiar)
      })
    }

    await batch.commit()
    alert('✅ Se actualizaron ' + cambios.length + ' registros exitosamente')
    location.reload()
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}