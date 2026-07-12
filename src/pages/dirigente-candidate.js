/**
 * MÓDULO: DIRIGENTES (candidato-scoped) — roster de usuarios con rol
 * "dirigente". Igual que Operadores: no es una colección aparte, opera
 * directo sobre /candidates/{candidateId}/users (los mismos docs que
 * administra Usuarios), así que crear/cambiar de rol/borrar acá se
 * refleja también en Usuarios y viceversa — sin sincronización extra,
 * porque leen y escriben el mismo doc.
 */
import { httpsCallable } from 'firebase/functions'
import { functionsInstance } from '../lib/firebase.js'
import {
  getAllCandidateUsers,
  getAllRecords,
  deleteCandidateUser,
  getRecordByCedula,
  searchVoterByCedula
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'

const OTHER_ROLES = { campaign_admin: 'Administrador de campaña', coordinator: 'Coordinador', mesario: 'Mesario', operador: 'Operador de contacto', chofer: 'Chofer', viewer: 'Visualizador', auditor: 'Auditor' }

function cryptoRandomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}

export function renderDirigenteCandidate(container, candidateId) {
  let dirigentes = []

  async function cargarDatos() {
    try {
      const [users, records] = await Promise.all([
        getAllCandidateUsers(candidateId),
        getAllRecords(candidateId)
      ])
      const porUsuario = {}
      records.forEach(r => { porUsuario[r.uid] = (porUsuario[r.uid] || 0) + 1 })
      dirigentes = users
        .filter(u => u.role === 'dirigente')
        .map(u => ({ ...u, cantidadRegistros: porUsuario[u.id] || 0 }))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      render()
    } catch (err) {
      alert('Error al cargar dirigentes: ' + err.message)
    }
  }

  function statCard(label, value) {
    return `<div class="stat-card stat-card--accent" style="--accent:#9c27b0;">
      <div class="stat-num">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`
  }

  function render() {
    const totalRegistros = dirigentes.reduce((sum, d) => sum + d.cantidadRegistros, 0)

    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #9c27b0 0%, #6a1b9a 100%); color: white; padding: 18px 20px; border-radius: 8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 1.6rem; text-transform: uppercase;">🧭 DIRIGENTES</h2>
        <button id="btn-nuevo-dirigente" class="btn-compact" style="background: #4caf50; color: white;">➕ NUEVO</button>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:16px;">
        <div class="stats-grid" style="margin-bottom:14px;">
          ${statCard('Dirigentes', dirigentes.length)}
          ${statCard('Registros captados', totalRegistros)}
        </div>

        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div class="filter-input-wrap" style="margin-bottom:14px;">
          <input id="input-buscar-dirigente" class="filter-input" placeholder="Buscar por nombre, CI o email...">
        </div>

        <div id="tabla-dirigentes"></div>
      </div>
    `

    document.getElementById('btn-nuevo-dirigente').addEventListener('click', () => mostrarModalCrear())
    document.getElementById('input-buscar-dirigente').addEventListener('input', debounce(pintarTabla, 250))

    pintarTabla()
  }

  function pintarTabla() {
    const termino = document.getElementById('input-buscar-dirigente').value.trim().toLowerCase()
    const filtrados = dirigentes.filter(d =>
      !termino ||
      String(d.nombre || '').toLowerCase().includes(termino) ||
      String(d.email || '').toLowerCase().includes(termino) ||
      String(d.cedula || '').toLowerCase().includes(termino)
    )

    const tablaEl = document.getElementById('tabla-dirigentes')
    if (filtrados.length === 0) {
      tablaEl.innerHTML = `<div style="padding:40px 20px; text-align:center; color:#999;">${dirigentes.length === 0 ? 'No hay dirigentes creados todavía.' : 'Sin resultados.'}</div>`
      return
    }

    tablaEl.innerHTML = `
      <div class="roster-card-grid">
        ${filtrados.map((d, i) => `
          <div class="roster-card" data-idx="${i}">
            <div class="roster-card-name">${escapeHtml(d.nombre) || '—'}</div>
            <div class="roster-card-fields">
              <div class="roster-card-field"><strong>CI:</strong> ${escapeHtml(d.cedula) || '—'}</div>
              <div class="roster-card-field"><strong>Email:</strong> ${escapeHtml(d.email) || '—'}</div>
              <div class="roster-card-field"><strong>Teléfono:</strong> ${escapeHtml(d.telefono) || '—'}</div>
              <div class="roster-card-field"><strong>Registros:</strong> <span style="background:#f3e5f5; color:#6a1b9a; padding:2px 8px; border-radius:3px; font-weight:700;">${d.cantidadRegistros}</span></div>
            </div>
            <div class="roster-card-actions">
              <button class="btn-editar-dirigente btn-compact" data-idx="${i}" style="background:#2196f3; color:white;">✏️ Editar</button>
              <button class="btn-eliminar-dirigente btn-compact" data-idx="${i}" style="background:#d32f2f; color:white;">🗑️ Eliminar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `

    tablaEl.querySelectorAll('.btn-editar-dirigente').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalCambiarRol(filtrados[Number(btn.dataset.idx)]))
    })
    tablaEl.querySelectorAll('.btn-eliminar-dirigente').forEach(btn => {
      btn.addEventListener('click', () => eliminarDirigente(filtrados[Number(btn.dataset.idx)]))
    })
  }

  async function eliminarDirigente(dirigente) {
    if (!confirm(`¿Borrar el perfil de ${dirigente.nombre || dirigente.email}? No podrá seguir usando el panel (su cuenta de login no se borra).`)) return
    try {
      await deleteCandidateUser(candidateId, dirigente.id)
      cargarDatos()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  function mostrarModalCrear() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 500px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #9c27b0;">➕ NUEVO DIRIGENTE</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">CI:</label>
            <input id="inp-ci" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <div id="autocompletar-dirigente-msg" style="font-size:.78rem; color:#666; margin-top:4px;"></div>
          </div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Email:</label>
            <input id="inp-email" type="email" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Teléfono:</label>
            <input id="inp-telefono" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div id="crear-dirigente-msg" style="font-size:.85rem;"></div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ CREAR</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    // Autocompletar por CI: prioridad Registros (savedRecords, trae
    // también teléfono), y si no está ahí cae al padrón compartido (solo
    // nombre, sin teléfono). Nunca pisa lo ya escrito a mano.
    modal.querySelector('#inp-ci').addEventListener('blur', async () => {
      const ci = modal.querySelector('#inp-ci').value.trim()
      const msgEl = modal.querySelector('#autocompletar-dirigente-msg')
      if (!ci) { msgEl.textContent = ''; return }

      const nombreInput = modal.querySelector('#inp-nombre')
      const telefonoInput = modal.querySelector('#inp-telefono')
      msgEl.textContent = '🔎 Buscando datos de esta CI...'
      try {
        const registro = await getRecordByCedula(candidateId, ci)
        if (registro) {
          if (!nombreInput.value.trim()) nombreInput.value = registro.nombre || ''
          if (!telefonoInput.value.trim()) telefonoInput.value = registro.telefono || ''
          msgEl.textContent = '✅ Datos completados desde Registros.'
          return
        }
        const enPadron = await searchVoterByCedula(ci)
        if (enPadron.length > 0) {
          if (!nombreInput.value.trim()) nombreInput.value = enPadron[0].nombre || ''
          msgEl.textContent = '✅ Nombre completado desde el padrón (sin teléfono: el padrón no lo tiene).'
          return
        }
        msgEl.textContent = 'Sin coincidencias en Registros ni en el padrón.'
      } catch (err) {
        console.error('Error autocompletando por CI:', err)
        msgEl.textContent = '❌ ' + err.message
      }
    })

    modal.querySelector('#btn-guardar').addEventListener('click', async () => {
      const nombre = modal.querySelector('#inp-nombre').value.trim()
      const email = modal.querySelector('#inp-email').value.trim()
      const cedula = modal.querySelector('#inp-ci').value.trim()
      const telefono = modal.querySelector('#inp-telefono').value.trim()
      const msg = modal.querySelector('#crear-dirigente-msg')

      if (!nombre || !email) {
        alert('Nombre y email son obligatorios')
        return
      }

      msg.textContent = 'Creando...'
      try {
        const crearUsuarioCandidato = httpsCallable(functionsInstance, 'crearUsuarioCandidato')
        const password = cryptoRandomPassword()
        const result = await crearUsuarioCandidato({ candidateId, nombre, email, rol: 'dirigente', cedula, telefono, password })
        msg.innerHTML = `✅ ${escapeHtml(result.data.mensaje)}<br>Contraseña: <strong>${escapeHtml(password)}</strong> (copiala ahora)`
        setTimeout(() => { modal.remove(); cargarDatos() }, 2500)
      } catch (err) {
        msg.innerHTML = `❌ ${escapeHtml(err.message)}`
      }
    })

    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
  }

  function mostrarModalCambiarRol(dirigente) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 420px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h3 style="margin:0 0 16px;">Nuevo rol para ${escapeHtml(dirigente.nombre || dirigente.email)}</h3>
        <select id="sel-nuevo-rol" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px;">
          ${Object.entries(OTHER_ROLES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar" style="flex:1; background:#2196f3; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
      const newRole = modal.querySelector('#sel-nuevo-rol').value
      try {
        const cambiarRol = httpsCallable(functionsInstance, 'cambiarRolUsuarioCandidato')
        await cambiarRol({ candidateId, uid: dirigente.id, newRole })
        modal.remove()
        cargarDatos()
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })
  }

  cargarDatos()
}
