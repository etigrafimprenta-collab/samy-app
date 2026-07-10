/**
 * MÓDULO: ADMIN - AUDITORÍA, EXPORTACIÓN Y GESTIÓN DE USUARIOS (MEJORADO)
 */

import { renderMyRecords } from './myRecords.js'
import { renderDiaDAdmin } from '../modules/dia-d-admin.js'
import { renderDiaDControl } from '../modules/dia-d-control.js'
import { renderChofer } from './chofer.js'
import { updateUserRole, updateUserPassword, updateUserMesaLocal, deleteUserAccount, getUserById } from '../lib/firebase.js'

// Antes, cada acción del panel (exportar, imprimir, buscar, auditoría,
// listar usuarios...) volvía a pedir savedRecords/users COMPLETOS a
// Firestore por separado — hasta 6 descargas del mismo dato en una sola
// sesión de admin (auditoría IV.3). Ahora se cachea en memoria por 30s y
// se invalida explícitamente después de cualquier escritura conocida.
const _snapCache = new Map()
const CACHE_TTL_MS = 30000

async function getCachedSnap(name) {
  const cached = _snapCache.get(name)
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.snap
  const { collection, getDocs } = await import('firebase/firestore')
  const { db } = await import('../lib/firebase.js')
  const snap = await getDocs(collection(db, name))
  _snapCache.set(name, { snap, at: Date.now() })
  return snap
}

function invalidateAdminCache(name) {
  if (name) _snapCache.delete(name)
  else _snapCache.clear()
}

export function renderAdmin(content) {
  let currentView = 'resumen'

  function render() {
    if (currentView === 'resumen') {
      renderResumen(content, switchToAuditoria, switchToDiaDAdmin, switchToDiaDControl, switchToChofer)
    } else if (currentView === 'auditoria') {
      renderAuditoria(content, switchToResumen)
    } else if (currentView === 'dia-d-admin') {
      renderDiaDAdmin(content)
    } else if (currentView === 'dia-d-control') {
      renderDiaDControl(content)
    } else if (currentView === 'chofer') {
      renderChofer(content)
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

  function switchToDiaDAdmin() {
    currentView = 'dia-d-admin'
    render()
  }

  function switchToDiaDControl() {
    currentView = 'dia-d-control'
    render()
  }

  function switchToChofer() {
    currentView = 'chofer'
    render()
  }

  render()
}

function renderResumen(container, onAuditoria, onDiaDAdmin, onDiaDControl, onChofer) {
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; margin-bottom: 24px; align-items: start;">
      <div>
        <h2 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase;">📊 Resumen</h2>
        <p style="margin: 0; color: #666; font-size: 0.9rem;">Panel de control administrativo</p>
      </div>
      <button id="btn-dia-d-admin" style="background: #c41e3a; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        🗳️ DÍA D ADMIN
      </button>
      <button id="btn-dia-d-control" style="background: #c41e3a; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        🎮 DÍA D CONTROL
      </button>
      <button id="btn-exportar" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        📥 EXPORTAR
      </button>
      <button id="btn-usuarios" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        👥 USUARIOS
      </button>
      <button id="btn-choferes" style="background: #2196f3; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700; height: fit-content; white-space: nowrap;">
        🚗 CHOFERES
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
  document.getElementById('btn-dia-d-admin').addEventListener('click', onDiaDAdmin)
  document.getElementById('btn-dia-d-control').addEventListener('click', onDiaDControl)
  document.getElementById('btn-exportar').addEventListener('click', () => mostrarPanelExportacion(container))
  document.getElementById('btn-usuarios').addEventListener('click', () => mostrarUsuarios(container))
  document.getElementById('btn-choferes').addEventListener('click', onChofer)
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
  const firebaseImport = await import('firebase/firestore')
  const { collection, getDocs } = firebaseImport
  const { db } = await import('../lib/firebase.js')

  const usersSnap = await getCachedSnap('users')
  const usuarios = []
  usersSnap.forEach(d => {
    usuarios.push({
      uid: d.id,
      nombre: d.data().displayName || d.data().email || 'Sin nombre'
    })
  })

  const recordsSnap = await getCachedSnap('savedRecords')
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

    const militante = document.getElementById('filtro-militante')?.value || ''
    const local = document.getElementById('filtro-local')?.value || ''
    const mesa = document.getElementById('filtro-mesa')?.value || ''

    const recordsSnap = await getCachedSnap('savedRecords')
    let registros = []
    recordsSnap.forEach(d => {
      const data = d.data()
      registros.push({
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        local: data.local || '',
        mesa: data.mesa || '',
        orden: data.orden || '',
        telefono: data.telefono || '',
        uid: data.uid || ''
      })
    })

    const usersSnap = await getCachedSnap('users')
    const usuarios = {}
    usersSnap.forEach(d => {
      usuarios[d.id] = d.data().displayName || d.data().email || 'N/A'
    })

    if (militante) {
      registros = registros.filter(r => r.uid === militante)
    }
    if (local) {
      registros = registros.filter(r => r.local === local)
    }
    if (mesa) {
      registros = registros.filter(r => r.mesa.toString() === mesa)
    }

    const headers = ['Cédula', 'Nombre', 'Apellidos', 'Local', 'Mesa', 'Orden', 'Teléfono', 'Militante']
    const rows = registros.map(r => [
      r.cedula,
      r.nombre,
      r.apellidos,
      r.local,
      r.mesa,
      r.orden,
      r.telefono,
      usuarios[r.uid] || 'N/A'
    ])

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

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

    const militante = document.getElementById('filtro-militante')?.value || ''
    const local = document.getElementById('filtro-local')?.value || ''
    const mesa = document.getElementById('filtro-mesa')?.value || ''

    const recordsSnap = await getCachedSnap('savedRecords')
    let registros = []
    recordsSnap.forEach(d => {
      const data = d.data()
      registros.push({
        cedula: data.cedula || '',
        nombre: data.nombre || '',
        apellidos: data.apellidos || data.apellido || '',
        local: data.local || '',
        mesa: data.mesa || '',
        orden: data.orden || '',
        telefono: data.telefono || ''
      })
    })

    if (local) {
      registros = registros.filter(r => r.local === local)
    }
    if (mesa) {
      registros = registros.filter(r => r.mesa.toString() === mesa)
    }

    const printWindow = window.open('', '_blank')
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Registros - Samy Fidabel</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #2196f3; color: white; }
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
      </head>
      <body>
        <h1>📋 Registros - Samy Fidabel 2026</h1>
        <p>Total: ${registros.length} registros</p>
        <table>
          <thead>
            <tr>
              <th>Cédula</th>
              <th>Nombre</th>
              <th>Apellidos</th>
              <th>Local</th>
              <th>Mesa</th>
              <th>Orden</th>
              <th>Teléfono</th>
            </tr>
          </thead>
          <tbody>
            ${registros.map(r => `
              <tr>
                <td>${r.cedula}</td>
                <td>${r.nombre}</td>
                <td>${r.apellidos}</td>
                <td>${r.local}</td>
                <td>${r.mesa}</td>
                <td>${r.orden || '—'}</td>
                <td>${r.telefono}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
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

    const recordsSnap = await getCachedSnap('savedRecords')
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
        orden: data.orden || '',
        telefono: data.telefono || ''
      })
    })

    const usersSnap = await getCachedSnap('users')
    const allUsers = {}
    usersSnap.forEach(d => {
      allUsers[d.id] = { ...d.data(), uid: d.id }
    })

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
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Orden</th>
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
                  <td style="padding: 10px; font-size: 0.8rem;">${r.orden || '—'}</td>
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

    const usersSnap = await getCachedSnap('users')
    const allUsers = []
    usersSnap.forEach(d => {
      allUsers.push({
        uid: d.id,
        displayName: d.data().displayName || d.data().email || 'Sin nombre',
        email: d.data().email || 'N/A',
        password: d.data().password || 'N/A',
        role: d.data().role || 'militante'
      })
    })

    const recordsSnap = await getCachedSnap('savedRecords')
    const porUsuario = {}
    recordsSnap.forEach(d => {
      const uid = d.data().uid
      porUsuario[uid] = (porUsuario[uid] || 0) + 1
    })

    const ranking = allUsers.map(u => ({
      ...u,
      cantidad: porUsuario[u.uid] || 0
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
              <div><strong>Rol:</strong> <span style="background: ${getRoleColor(user.role)}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700;">${getRoleEmoji(user.role)} ${user.role.toUpperCase()}</span></div>
            </div>

            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn-editar-rol" data-uid="${user.uid}" style="flex: 1; min-width: 90px; background: #2196f3; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.8rem;">
                ✏️ Editar Rol
              </button>
              <button class="btn-cambiar-pass" data-uid="${user.uid}" style="flex: 1; min-width: 90px; background: #ff9800; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.8rem;">
                🔐 Cambiar Pass
              </button>
              <button class="btn-asignar-mesa" data-uid="${user.uid}" data-role="${user.role}" style="flex: 1; min-width: 90px; background: #4caf50; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.8rem;">
                📍 Mesa/Local
              </button>
              <button class="btn-borrar-usuario" data-uid="${user.uid}" data-nombre="${user.displayName}" style="flex: 1; min-width: 90px; background: #d32f2f; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.8rem;">
                🗑️ Borrar
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

  // Botones de editar rol
  document.querySelectorAll('.btn-editar-rol').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid
      const user = ranking.find(u => u.uid === uid)
      mostrarModalEditarRol(container, user)
    })
  })

  // Botones de cambiar contraseña
  document.querySelectorAll('.btn-cambiar-pass').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid
      const user = ranking.find(u => u.uid === uid)
      mostrarModalCambiarPassword(container, user)
    })
  })

  // Botones de asignar mesa/local
  document.querySelectorAll('.btn-asignar-mesa').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid
      const role = btn.dataset.role
      const user = ranking.find(u => u.uid === uid)
      if (role === 'mesario' || role === 'veedor') {
        mostrarModalAsignarMesa(container, user)
      } else {
        alert('Solo mesarios y veedores pueden tener mesa/local asignados')
      }
    })
  })

  // Botones de borrar usuario
  document.querySelectorAll('.btn-borrar-usuario').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid
      const nombre = btn.dataset.nombre
      mostrarModalBorrarUsuario(container, uid, nombre)
    })
  })
}

function getRoleColor(role) {
  const colors = {
    admin: '#ff9800',
    mesario: '#2196f3',
    veedor: '#4caf50',
    militante: '#9c27b0'
  }
  return colors[role] || '#999'
}

function getRoleEmoji(role) {
  const emojis = {
    admin: '👑',
    mesario: '📊',
    veedor: '👀',
    militante: '👤'
  }
  return emojis[role] || '👤'
}

async function mostrarModalEditarRol(container, user) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;'

  const html = `
    <div style="background: white; border-radius: 8px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; color: #2196f3; text-transform: uppercase;">✏️ Editar Rol</h2>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 700; margin-bottom: 8px;">Usuario:</div>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 0.9rem;">${user.displayName}</div>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-weight: 700; margin-bottom: 8px;">Nuevo Rol:</label>
        <select id="new-role" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
          <option value="militante">👤 Militante</option>
          <option value="mesario">📊 Mesario</option>
          <option value="veedor">👀 Veedor</option>
          <option value="admin">👑 Admin</option>
        </select>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-confirmar-rol" style="flex: 1; background: #2196f3; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ✅ Guardar
        </button>
        <button id="btn-cancelar-modal" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ❌ Cancelar
        </button>
      </div>
    </div>
  `

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-confirmar-rol').addEventListener('click', async () => {
    const newRole = document.getElementById('new-role').value
    try {
      await updateUserRole(user.uid, newRole)
      invalidateAdminCache('users')
      alert(`✅ Rol actualizado a "${newRole}"`)
      modal.remove()
      location.reload()
    } catch (err) {
      alert(`❌ Error: ${err.message}`)
    }
  })

  document.getElementById('btn-cancelar-modal').addEventListener('click', () => modal.remove())
}

async function mostrarModalCambiarPassword(container, user) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;'

  const html = `
    <div style="background: white; border-radius: 8px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; color: #ff9800; text-transform: uppercase;">🔐 Cambiar Contraseña</h2>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 700; margin-bottom: 8px;">Usuario:</div>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 0.9rem;">${user.displayName}</div>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-weight: 700; margin-bottom: 8px;">Nueva Contraseña:</label>
        <input id="new-password" type="text" placeholder="Dejar vacío para generar una segura automáticamente" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        <div style="font-size: 0.78rem; color: #777; margin-top: 6px;">Mínimo 6 caracteres. Si la dejás vacía, se genera una contraseña aleatoria segura.</div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-confirmar-pass" style="flex: 1; background: #ff9800; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ✅ Guardar
        </button>
        <button id="btn-cancelar-modal" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ❌ Cancelar
        </button>
      </div>
    </div>
  `

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-confirmar-pass').addEventListener('click', async () => {
    const newPass = document.getElementById('new-password').value.trim()
    try {
      const result = await updateUserPassword(user.uid, newPass || undefined)
      if (result?.generatedPassword) {
        alert(`✅ Contraseña generada para ${user.displayName || user.email}:\n\n${result.generatedPassword}\n\nCopiala ahora, no se va a volver a mostrar.`)
      } else {
        alert('✅ Contraseña actualizada')
      }
      modal.remove()
      location.reload()
    } catch (err) {
      alert(`❌ Error: ${err.message}`)
    }
  })

  document.getElementById('btn-cancelar-modal').addEventListener('click', () => modal.remove())
}

async function mostrarModalAsignarMesa(container, user) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;'

  const html = `
    <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); max-height: 80vh; overflow-y: auto;">
      <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; color: #4caf50; text-transform: uppercase;">📍 Asignar Mesa/Local</h2>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 700; margin-bottom: 8px;">Usuario:</div>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 0.9rem;">${user.displayName} (${user.role.toUpperCase()})</div>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; font-weight: 700; margin-bottom: 8px;">Seccional:</label>
        <input id="seccional" type="text" placeholder="Ej: 357" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; font-weight: 700; margin-bottom: 8px;">Mesa:</label>
        <input id="mesa" type="text" placeholder="Ej: 5" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; font-weight: 700; margin-bottom: 8px;">Local:</label>
        <input id="local" type="text" placeholder="Ej: Escuela Primaria..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
      </div>

      ${user.role === 'veedor' ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Mesas Asignadas (separadas por coma):</label>
          <input id="mesasAsignadas" type="text" placeholder="Ej: 1,2,3,4,5" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>
      ` : ''}

      <div style="display: flex; gap: 8px;">
        <button id="btn-confirmar-mesa" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ✅ Guardar
        </button>
        <button id="btn-cancelar-modal" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ❌ Cancelar
        </button>
      </div>
    </div>
  `

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-confirmar-mesa').addEventListener('click', async () => {
    const seccional = document.getElementById('seccional').value.trim()
    const mesa = document.getElementById('mesa').value.trim()
    const local = document.getElementById('local').value.trim()
    const mesasAsignadas = document.getElementById('mesasAsignadas')?.value.trim() || ''

    if (!seccional || !mesa || !local) {
      alert('Complete todos los campos requeridos')
      return
    }

    try {
      const data = { seccional, mesa, local }
      if (mesasAsignadas) {
        data.mesasAsignadas = mesasAsignadas.split(',').map(m => m.trim())
      }
      await updateUserMesaLocal(user.uid, data)
      invalidateAdminCache('users')
      alert(`✅ Mesa/Local asignado`)
      modal.remove()
      location.reload()
    } catch (err) {
      alert(`❌ Error: ${err.message}`)
    }
  })

  document.getElementById('btn-cancelar-modal').addEventListener('click', () => modal.remove())
}

async function mostrarModalBorrarUsuario(container, uid, nombre) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;'

  const html = `
    <div style="background: white; border-radius: 8px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; color: #d32f2f; text-transform: uppercase;">⚠️ Borrar Usuario</h2>
      <div style="background: #ffebee; border-left: 4px solid #d32f2f; padding: 12px; border-radius: 4px; margin-bottom: 16px; color: #d32f2f;">
        <strong>⚠️ Advertencia:</strong> Esta acción no se puede deshacer.
      </div>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 700; margin-bottom: 8px;">Usuario a borrar:</div>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 0.9rem;">${nombre}</div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-confirmar-borrar" style="flex: 1; background: #d32f2f; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          🗑️ Borrar
        </button>
        <button id="btn-cancelar-modal" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
          ❌ Cancelar
        </button>
      </div>
    </div>
  `

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-confirmar-borrar').addEventListener('click', async () => {
    try {
      await deleteUserAccount(uid)
      invalidateAdminCache('users')
      alert(`✅ Usuario borrado`)
      modal.remove()
      location.reload()
    } catch (err) {
      alert(`❌ Error: ${err.message}`)
    }
  })

  document.getElementById('btn-cancelar-modal').addEventListener('click', () => modal.remove())
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
          <input id="input-crear-nombre" type="text" placeholder="Ej: Juan Pérez" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Email:</label>
          <input id="input-crear-email" type="email" placeholder="Ej: juan@example.com" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Contraseña:</label>
          <input id="input-crear-password" type="text" placeholder="Ingrese contraseña" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">Rol:</label>
          <select id="input-crear-rol" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">
            <option value="militante">👤 Militante</option>
            <option value="mesario">📊 Mesario</option>
            <option value="veedor">👀 Veedor</option>
            <option value="admin">👑 Admin</option>
          </select>
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
    const rol = document.getElementById('input-crear-rol').value

    if (!nombre.trim() || !email.trim() || !password.trim()) {
      alert('Por favor complete todos los campos')
      return
    }

    crearNuevoUsuario(nombre, email, password, rol)
  })
}

async function crearNuevoUsuario(nombre, email, password, rol) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, addDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    const nuevoUID = `user-${Date.now()}`

    await addDoc(collection(db, 'users'), {
      uid: nuevoUID,
      displayName: nombre,
      email: email,
      password: password,
      role: rol,
      createdAt: new Date()
    })

    alert(`✅ Usuario "${nombre}" creado correctamente\n\nEmail: ${email}\nContraseña: ${password}\nRol: ${rol}`)
    location.reload()
  } catch (err) {
    alert('Error al crear usuario: ' + err.message)
  }
}

async function renderAuditoria(container, onVolver) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚠️ AUDITORÍA</h2>
        <button id="btn-volver-auditoria" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
          ← Volver
        </button>
      </div>
    </div>
    <div id="auditoria-content" style="padding: 16px; text-align: center;">⏳ Analizando base de datos...</div>
  `

  document.getElementById('btn-volver-auditoria').addEventListener('click', onVolver)

  const firebaseImport = await import('firebase/firestore')
  const { collection, getDocs } = firebaseImport
  const { db } = await import('../lib/firebase.js')

  try {
    const recordsSnap = await getCachedSnap('savedRecords')
    const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const usersSnap = await getCachedSnap('users')
    const usuariosMap = {}
    usersSnap.forEach(d => {
      usuariosMap[d.id] = d.data().displayName || d.data().email || 'N/A'
    })

    const cedulasCount = {}
    const duplicados = []

    records.forEach(r => {
      const cedula = r.cedula
      if (!cedulasCount[cedula]) {
        cedulasCount[cedula] = []
      }
      cedulasCount[cedula].push(r)
    })

    Object.entries(cedulasCount).forEach(([cedula, records]) => {
      if (records.length > 1) {
        duplicados.push({ cedula, registros: records })
      }
    })

    let html = `
      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
          🔍 ANÁLISIS DE DUPLICADOS
        </h3>

        <div style="background: ${duplicados.length > 0 ? '#fff3cd' : '#d4edda'}; border: 1px solid ${duplicados.length > 0 ? '#ffc107' : '#28a745'}; color: ${duplicados.length > 0 ? '#856404' : '#155724'}; padding: 12px; border-radius: 4px; margin-bottom: 20px;">
          <strong>${duplicados.length > 0 ? '⚠️' : '✅'}</strong> ${duplicados.length === 0 ? 'No hay duplicados detectados' : `Se encontraron ${duplicados.length} cédulas duplicadas`}
        </div>

        ${duplicados.length > 0 ? `
          <div style="display: grid; gap: 12px;">
            ${duplicados.map(dup => `
              <div style="border: 1px solid #ddd; border-radius: 4px; padding: 12px; background: #f9f9f9;">
                <div style="font-weight: 700; margin-bottom: 8px;">Cédula: ${dup.cedula}</div>
                <div style="font-size: 0.9rem; color: #666; margin-bottom: 12px;">${dup.registros.length} registros encontrados</div>
                ${dup.registros.map((r, idx) => {
                  const nombreMilitante = usuariosMap[r.uid] || 'N/A'
                  return `
                    <div style="background: white; padding: 8px; border-radius: 3px; margin-bottom: 6px; font-size: 0.85rem;">
                      <span style="font-weight: 600;">Registro ${idx + 1}:</span> ${r.nombre} | 
                      <span style="color: #666;">Militante: ${nombreMilitante}</span> | 
                      <span style="color: #666;">Guardado: ${r.savedAt?.toDate?.().toLocaleString('es-PY') || '—'}</span>
                    </div>
                  `
                }).join('')}
                <button class="btn-ver-detalles" data-cedula="${dup.cedula}" style="background: #2196f3; color: white; border: none; padding: 6px 12px; border-radius: 3px; cursor: pointer; font-size: 0.8rem; font-weight: 600; margin-top: 8px;">
                  👁️ Ver Detalles
                </button>
                <div class="detalles-duplicados" data-cedula="${dup.cedula}" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;"></div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `

    document.getElementById('auditoria-content').innerHTML = html

    document.querySelectorAll('.btn-ver-detalles').forEach(btn => {
      btn.addEventListener('click', () => {
        const cedula = btn.dataset.cedula
        const dup = duplicados.find(d => d.cedula === cedula)
        const detailsEl = document.querySelector(`.detalles-duplicados[data-cedula="${cedula}"]`)
        
        if (detailsEl.style.display === 'none') {
          detailsEl.innerHTML = dup.registros.map(r => {
            const nombreMilitante = usuariosMap[r.uid] || 'N/A'
            return `
              <div style="background: #f5f5f5; padding: 8px; border-radius: 3px; margin-bottom: 6px; font-size: 0.8rem;">
                <span style="font-weight: 600;">
                  ${r.nombre}
                </span>
                <button class="btn-delete-dup" data-rec-id="${r.id}" data-dup-cedula="${dup.cedula}" style="background: #d32f2f; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600; float: right;">
                  🗑️ Borrar
                </button>
              </div>
              <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">
                <strong>Militante:</strong> ${nombreMilitante} <br>
                <strong>Guardado:</strong> ${r.savedAt?.toDate?.().toLocaleString('es-PY') || '—'} <br>
                <strong>Teléfono:</strong> ${r.telefono || '—'} <br>
                <strong>Nota:</strong> ${r.nota || '—'}
              </div>
            `
          }).join('')

          detailsEl.style.display = 'block'
          btn.textContent = '👁️ Ocultar'

          detailsEl.querySelectorAll('.btn-delete-dup').forEach(delBtn => {
            delBtn.addEventListener('click', async () => {
              if (!confirm('⚠️ ¿Borrar este registro duplicado? Esta acción no se puede deshacer.')) return
              
              const recId = delBtn.dataset.recId

              try {
                const firebaseImport = await import('firebase/firestore')
                const { deleteDoc, doc } = firebaseImport
                const { db } = await import('../lib/firebase.js')

                await deleteDoc(doc(db, 'savedRecords', recId))
                invalidateAdminCache('savedRecords')
                alert('✅ Registro duplicado eliminado')
                
                renderAuditoria(container, onVolver)
              } catch (err) {
                alert('❌ Error al eliminar: ' + err.message)
              }
            })
          })
        } else {
          detailsEl.style.display = 'none'
          btn.textContent = '👁️ Ver Detalles'
        }
      })
    })

  } catch (err) {
    document.getElementById('auditoria-content').innerHTML = `<div style="color: red;"><strong>Error:</strong> ${err.message}</div>`
  }
}

function mostrarPanelImportacion(container) {
  const html = `
    <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📥 IMPORTAR REGISTROS</h2>
      <p style="margin: 0; font-size: 0.9rem;">Carga datos desde Excel o CSV</p>
    </div>

    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 24px;">
      <button id="btn-carga-total" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">
        📁 Seleccionar Archivo para Cargar
      </button>
      <input type="file" id="file-carga-total" accept=".csv,.xlsx,.xls" style="display: none;">
    </div>
  `

  container.innerHTML = html

  document.getElementById('btn-carga-total').addEventListener('click', () => {
    document.getElementById('file-carga-total').click()
  })

  document.getElementById('file-carga-total').addEventListener('change', (e) => {
    if (e.target.files[0]) procesarCargaTotal(e.target.files[0], container)
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