/**
 * MÓDULO: OPERADORES DE LLAMADAS (candidato-scoped) — roster de usuarios
 * con rol "operador" (Centro de Contacto), con seguimiento de pago: monto
 * entregado + cadencia de entrega. No es una colección aparte: opera
 * directo sobre /candidates/{candidateId}/users, los mismos docs que
 * administra el módulo Usuarios — así que crear/cambiar de rol/borrar acá
 * se refleja también ahí (y viceversa), sin sincronización extra.
 */
import { httpsCallable } from 'firebase/functions'
import { functionsInstance } from '../lib/firebase.js'
import {
  getAllCandidateUsers,
  updateCandidateUserPago,
  deleteCandidateUser,
  getRecordByCedula,
  searchVoterByCedula,
  crearOperador
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'

const CADENCIA_LABELS = {
  unico: 'Pago único',
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual'
}

export function renderOperadorCandidate(container, candidateId) {
  let operadores = []

  async function cargarDatos() {
    try {
      const users = await getAllCandidateUsers(candidateId)
      operadores = users.filter(u => u.role === 'operador')
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      render()
    } catch (err) {
      alert('Error al cargar operadores: ' + err.message)
    }
  }

  function statCard(label, value) {
    return `<div class="stat-card" style="--accent:#6a1b9a;">
      <div class="stat-num">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`
  }

  function render() {
    const totalEntregado = operadores.reduce((sum, o) => sum + (Number(o.montoEntregado) || 0), 0)

    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #6a1b9a 0%, #4a148c 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📞 OPERADORES DE LLAMADAS</h2>
        <button id="btn-nuevo-operador" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">➕ NUEVO OPERADOR</button>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:20px;">
        <div class="stats-grid">
          ${statCard('Operadores', operadores.length)}
          ${statCard('Total entregado (Gs.)', totalEntregado.toLocaleString('es-PY'))}
        </div>

        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
        <div class="filter-input-wrap" style="margin-bottom:16px;"><input id="input-buscar-operador" class="filter-input" placeholder="Buscar por nombre o email..."></div>

        <div id="tabla-operadores"></div>
      </div>
    `

    document.getElementById('btn-nuevo-operador').addEventListener('click', () => mostrarModalCrear())
    document.getElementById('input-buscar-operador').addEventListener('input', debounce(pintarTabla, 250))

    pintarTabla()
  }

  function pintarTabla() {
    const termino = document.getElementById('input-buscar-operador').value.trim().toLowerCase()
    const filtrados = operadores.filter(o =>
      !termino ||
      String(o.nombre || '').toLowerCase().includes(termino) ||
      String(o.email || '').toLowerCase().includes(termino) ||
      String(o.cedula || '').toLowerCase().includes(termino)
    )

    const tablaEl = document.getElementById('tabla-operadores')
    if (filtrados.length === 0) {
      tablaEl.innerHTML = `<div style="padding:40px 20px; text-align:center; color:#999;">${operadores.length === 0 ? 'No hay operadores creados todavía.' : 'Sin resultados.'}</div>`
      return
    }

    tablaEl.innerHTML = `
      <div class="roster-card-grid">
        ${filtrados.map((o, i) => {
          // Ausencia del campo (todo operador creado antes de este cambio)
          // cuenta como "ya tiene acceso" — son cuentas reales que ya están
          // operando, creadas con contraseña desde el día 1. Solo los
          // operadores creados por el flujo nuevo (crearOperador) arrancan
          // en passwordAssigned:false. Ver diagnóstico del plan.
          const tieneAcceso = o.passwordAssigned !== false
          return `
          <div class="roster-card" data-idx="${i}">
            <div class="roster-card-name">${escapeHtml(o.nombre) || '—'}</div>
            <div class="roster-card-fields">
              <div class="roster-card-field"><strong>CI:</strong> ${escapeHtml(o.cedula) || '—'}</div>
              <div class="roster-card-field"><strong>Email:</strong> ${escapeHtml(o.email) || '—'}</div>
              <div class="roster-card-field"><strong>Teléfono:</strong> ${escapeHtml(o.telefono) || '—'}</div>
              <div class="roster-card-field"><strong>Entregado:</strong> <span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-weight:700;">Gs. ${(Number(o.montoEntregado) || 0).toLocaleString('es-PY')}</span></div>
              <div class="roster-card-field"><strong>Cadencia:</strong> ${o.cadenciaPago ? escapeHtml(CADENCIA_LABELS[o.cadenciaPago] || o.cadenciaPago) : 'Sin definir'}</div>
            </div>
            <div class="roster-card-actions">
              <button class="btn-editar-pago btn-compact" data-idx="${i}" style="background:#ff9800; color:white;">✏️ Pago</button>
              ${tieneAcceso
                ? `<button class="btn-acceso-existente btn-compact" data-idx="${i}" style="background:#9e9e9e; color:white;">🔐 Acceso existente</button>`
                : `<button class="btn-asignar-password btn-compact" data-idx="${i}" style="background:#2196f3; color:white;">🔐 Asignar contraseña</button>`}
              <button class="btn-eliminar-operador btn-compact" data-idx="${i}" style="background:#d32f2f; color:white;">🗑️ Eliminar</button>
            </div>
          </div>
        `
        }).join('')}
      </div>
    `

    tablaEl.querySelectorAll('.btn-editar-pago').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalPago(filtrados[Number(btn.dataset.idx)]))
    })
    tablaEl.querySelectorAll('.btn-asignar-password').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalAsignarPassword(filtrados[Number(btn.dataset.idx)]))
    })
    tablaEl.querySelectorAll('.btn-acceso-existente').forEach(btn => {
      btn.addEventListener('click', () => {
        const o = filtrados[Number(btn.dataset.idx)]
        alert(`🔐 ${o.nombre || o.email} ya posee acceso al sistema. Debe utilizar la misma contraseña con la que actualmente ingresa al sistema.`)
      })
    })
    tablaEl.querySelectorAll('.btn-eliminar-operador').forEach(btn => {
      btn.addEventListener('click', () => eliminarOperador(filtrados[Number(btn.dataset.idx)]))
    })
  }

  async function eliminarOperador(operador) {
    if (!confirm(`¿Borrar el perfil de ${operador.nombre || operador.email}? No podrá seguir usando el panel (su cuenta de login no se borra).`)) return
    try {
      await deleteCandidateUser(candidateId, operador.id)
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
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #6a1b9a;">➕ NUEVO OPERADOR</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">CI:</label>
            <input id="inp-ci" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <div id="autocompletar-operador-msg" style="font-size:.78rem; color:#666; margin-top:4px;"></div>
          </div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Email:</label>
            <input id="inp-email" type="email" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Teléfono:</label>
            <input id="inp-telefono" type="text" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div id="crear-operador-msg" style="font-size:.85rem;"></div>
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
      const msgEl = modal.querySelector('#autocompletar-operador-msg')
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
      const cedula = modal.querySelector('#inp-ci').value.trim()
      const nombre = modal.querySelector('#inp-nombre').value.trim()
      const email = modal.querySelector('#inp-email').value.trim()
      const telefono = modal.querySelector('#inp-telefono').value.trim()
      const msg = modal.querySelector('#crear-operador-msg')

      if (!nombre || !email) {
        alert('Nombre y email son obligatorios')
        return
      }

      msg.textContent = 'Creando...'
      try {
        // crearOperador (Cloud Function crearOperadorCandidato) revisa si
        // esta CI/email ya pertenecen a alguien del sistema antes de crear
        // nada — si existe, vincula el rol a esa cuenta en vez de duplicar.
        // No genera/muestra contraseña acá: si es cuenta nueva, se asigna
        // después desde "🔐 Asignar contraseña" en la tarjeta.
        const result = await crearOperador(candidateId, { nombre, email, cedula, telefono })
        msg.innerHTML = `✅ ${escapeHtml(result.mensaje)}`
        setTimeout(() => { modal.remove(); cargarDatos() }, 2000)
      } catch (err) {
        msg.innerHTML = `❌ ${escapeHtml(err.message)}`
      }
    })

    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
  }

  function mostrarModalPago(operador) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 460px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #ff9800;">✏️ PAGO DE ${escapeHtml(operador.nombre || operador.email).toUpperCase()}</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Monto entregado (Gs.):</label>
            <input id="inp-monto" type="number" min="0" step="1000" value="${Number(operador.montoEntregado) || 0}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Cadencia de entrega:</label>
            <select id="sel-cadencia" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Sin definir --</option>
              ${Object.entries(CADENCIA_LABELS).map(([v, l]) => `<option value="${v}" ${operador.cadenciaPago === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #ff9800; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">💾 GUARDAR</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    modal.querySelector('#btn-guardar').addEventListener('click', async () => {
      const montoEntregado = Number(modal.querySelector('#inp-monto').value) || 0
      const cadenciaPago = modal.querySelector('#sel-cadencia').value
      try {
        await updateCandidateUserPago(candidateId, operador.id, { montoEntregado, cadenciaPago })
        modal.remove()
        cargarDatos()
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
  }

  // Solo aparece cuando o.passwordAssigned === false (cuenta recién creada
  // por crearOperador, contraseña interna sin divulgar a nadie todavía).
  // Reusa resetearPasswordUsuarioCandidato (mismo patrón que
  // modalCambiarPassword en campaign.js:1483-1508) — esa Cloud Function ya
  // marca passwordAssigned:true al terminar, así que después de esto la
  // tarjeta pasa sola a "🔐 Acceso existente" en el próximo cargarDatos().
  function mostrarModalAsignarPassword(operador) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 420px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h3 style="margin:0 0 16px;">🔐 Asignar contraseña a ${escapeHtml(operador.nombre || operador.email)}</h3>
        <input id="inp-nueva-pass" placeholder="Dejar vacío para generar una segura" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; box-sizing:border-box;">
        <div id="asignar-pass-msg" style="font-size:.85rem; margin-bottom:8px;"></div>
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar" style="flex:1; background:#2196f3; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-cancelar" style="flex:1; background:#999; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar').addEventListener('click', async () => {
      const newPassword = modal.querySelector('#inp-nueva-pass').value.trim()
      const msg = modal.querySelector('#asignar-pass-msg')
      try {
        const resetPass = httpsCallable(functionsInstance, 'resetearPasswordUsuarioCandidato')
        const result = await resetPass({ candidateId, uid: operador.id, newPassword: newPassword || undefined })
        if (result.data?.generatedPassword) {
          msg.innerHTML = `✅ Contraseña generada: <strong>${escapeHtml(result.data.generatedPassword)}</strong><br>Copiala ahora, no se vuelve a mostrar.`
        } else {
          msg.innerHTML = '✅ Contraseña asignada.'
        }
        setTimeout(() => { modal.remove(); cargarDatos() }, 2500)
      } catch (err) {
        msg.innerHTML = `❌ ${escapeHtml(err.message)}`
      }
    })
  }

  cargarDatos()
}
