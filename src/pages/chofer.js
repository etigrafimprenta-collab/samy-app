/**
 * MÓDULO: CHOFER - GESTIÓN DE CHOFERES Y ASIGNACIÓN DE VOTANTES
 */

import { 
  createChofer, 
  getChoferes, 
  updateChofer, 
  deleteChofer, 
  assignVotantesToChofer,
  getVotantesPorSeccional,
  getAllUsers
} from '../lib/firebase.js'

export function renderChofer(container) {
  let choferes = []
  let usuarios = []
  let view = 'lista'

  async function cargarChoferes() {
    try {
      choferes = await getChoferes()
      usuarios = await getAllUsers()
      renderLista()
    } catch (err) {
      alert('Error al cargar choferes: ' + err.message)
    }
  }

  function renderLista() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🚗 CHOFERES</h2>
          <button id="btn-crear-chofer" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
            ➕ NUEVO CHOFER
          </button>
        </div>
      </div>

      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
          📋 LISTADO DE CHOFERES
        </h3>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead style="background: #000; color: white; position: sticky; top: 0;">
              <tr>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Nombre</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Celular</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Vehículo</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Tipo</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Seccional</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Usuario</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Votantes</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Roles</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${choferes.length === 0 ? `
                <tr>
                  <td colspan="9" style="padding: 40px; text-align: center; color: #999;">
                    No hay choferes creados. ➕ Crear uno nuevo.
                  </td>
                </tr>
              ` : choferes.map(c => {
                const usuarioAsignado = usuarios.find(u => u.id === c.usuarioAsignado)
                return `
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px;"><strong>${c.nombre}</strong></td>
                  <td style="padding: 10px;">${c.celular}</td>
                  <td style="padding: 10px; font-family: monospace; font-size: 0.8rem;">${c.vehiculo}</td>
                  <td style="padding: 10px;">${c.tipoVehiculo}</td>
                  <td style="padding: 10px;"><strong>${c.seccional}</strong></td>
                  <td style="padding: 10px; font-size: 0.8rem;">
                    ${usuarioAsignado ? `<span style="background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 3px;">👤 ${usuarioAsignado.displayName || usuarioAsignado.email}</span>` : '<span style="color: #999;">Sin asignar</span>'}
                  </td>
                  <td style="padding: 10px; text-align: center;">
                    <span style="background: #e3f2fd; color: #1976d2; padding: 4px 8px; border-radius: 3px; font-weight: 700;">
                      ${c.votantesAsignados || 0}
                    </span>
                  </td>
                  <td style="padding: 10px;">
                    <span style="background: ${c.roles.includes('user') ? '#4caf50' : '#ff9800'}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700;">
                      ${c.roles.includes('user') ? '🚗 + 👤' : '🚗'}
                    </span>
                  </td>
                  <td style="padding: 10px; display: flex; gap: 4px;">
                    <button class="btn-wa" data-chofer='${JSON.stringify(c)}' style="background: #25d366; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                      📲
                    </button>
                    <button class="btn-asignar" data-id="${c.id}" style="background: #2196f3; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                      📋
                    </button>
                    <button class="btn-editar" data-id="${c.id}" style="background: #ff9800; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                      ✏️
                    </button>
                    <button class="btn-eliminar" data-id="${c.id}" style="background: #d32f2f; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                      🗑️
                    </button>
                  </td>
                </tr>
              `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div id="modal-container" style="display: none;"></div>
    `

    document.getElementById('btn-crear-chofer').addEventListener('click', () => mostrarModalCrear())

    document.querySelectorAll('.btn-wa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chofer = JSON.parse(btn.getAttribute('data-chofer'))
        const { shareWhatsAppDirect } = await import('./search.js')
        shareWhatsAppDirect(chofer.celular, {
          nombre: chofer.nombre,
          cedula: chofer.id,
          local: 'Chofer - Transporte de votantes'
        })
      })
    })

    document.querySelectorAll('.btn-asignar').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id')
        const chofer = choferes.find(c => c.id === id)
        mostrarModalAsignar(chofer)
      })
    })

    document.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id')
        const chofer = choferes.find(c => c.id === id)
        mostrarModalEditar(chofer)
      })
    })

    document.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')
        const chofer = choferes.find(c => c.id === id)
        if (confirm(`¿Borrar a ${chofer.nombre}?`)) {
          await deleteChofer(id)
          cargarChoferes()
        }
      })
    })
  }

  function mostrarModalCrear() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">
          ➕ NUEVO CHOFER
        </h2>

        <div style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" placeholder="Ej: Juan Pérez" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Celular:</label>
            <input id="inp-celular" type="text" placeholder="981234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Vehículo (Placa):</label>
            <input id="inp-vehiculo" type="text" placeholder="ABC-123" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Tipo de Vehículo:</label>
            <select id="sel-tipo" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Seleccionar --</option>
              <option value="Auto">Auto</option>
              <option value="Microbus">Microbus</option>
              <option value="Camioneta">Camioneta</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Seccional:</label>
            <select id="sel-seccional" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Seleccionar --</option>
              <option value="169">169</option>
              <option value="355">355</option>
              <option value="356">356</option>
              <option value="357">357</option>
            </select>
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Asignar a Usuario:</label>
            <select id="sel-usuario" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Sin asignar --</option>
              ${usuarios.map(u => `<option value="${u.id}">${u.displayName || u.email}</option>`).join('')}
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <input id="chk-usuario" type="checkbox" style="cursor: pointer; width: 18px; height: 18px;">
            <label for="chk-usuario" style="font-weight: 700; cursor: pointer;">¿Es también Usuario (puede buscar votantes)?</label>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              ✅ GUARDAR
            </button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              ❌ CANCELAR
            </button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('inp-nombre').value.trim()
      const celular = document.getElementById('inp-celular').value.trim().replace(/\D/g, '')
      const vehiculo = document.getElementById('inp-vehiculo').value.trim()
      const tipoVehiculo = document.getElementById('sel-tipo').value
      const seccional = document.getElementById('sel-seccional').value
      const usuarioAsignado = document.getElementById('sel-usuario').value
      const esUsuario = document.getElementById('chk-usuario').checked

      if (!nombre || !celular || !vehiculo || !tipoVehiculo || !seccional) {
        alert('Completa todos los campos obligatorios')
        return
      }

      try {
        await createChofer({
          nombre,
          celular,
          vehiculo,
          tipoVehiculo,
          seccional,
          usuarioAsignado: usuarioAsignado || null,
          roles: esUsuario ? ['chofer', 'user'] : ['chofer'],
          estado: 'Activo',
          votantesAsignados: 0
        })
        modal.remove()
        cargarChoferes()
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

    document.getElementById('btn-cancelar').addEventListener('click', () => modal.remove())
  }

  function mostrarModalEditar(chofer) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #ff9800;">
          ✏️ EDITAR CHOFER
        </h2>

        <div style="display: grid; gap: 12px;">
          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" value="${chofer.nombre}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Celular:</label>
            <input id="inp-celular" type="text" value="${chofer.celular}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Vehículo (Placa):</label>
            <input id="inp-vehiculo" type="text" value="${chofer.vehiculo}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Asignar a Usuario:</label>
            <select id="sel-usuario" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Sin asignar --</option>
              ${usuarios.map(u => `<option value="${u.id}" ${chofer.usuarioAsignado === u.id ? 'selected' : ''}>${u.displayName || u.email}</option>`).join('')}
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <input id="chk-usuario" type="checkbox" ${chofer.roles.includes('user') ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;">
            <label for="chk-usuario" style="font-weight: 700; cursor: pointer;">¿Es también Usuario?</label>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #ff9800; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              💾 GUARDAR
            </button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              ❌ CANCELAR
            </button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('inp-nombre').value.trim()
      const celular = document.getElementById('inp-celular').value.trim().replace(/\D/g, '')
      const vehiculo = document.getElementById('inp-vehiculo').value.trim()
      const usuarioAsignado = document.getElementById('sel-usuario').value
      const esUsuario = document.getElementById('chk-usuario').checked

      try {
        await updateChofer(chofer.id, {
          nombre,
          celular,
          vehiculo,
          usuarioAsignado: usuarioAsignado || null,
          roles: esUsuario ? ['chofer', 'user'] : ['chofer']
        })
        modal.remove()
        cargarChoferes()
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

    document.getElementById('btn-cancelar').addEventListener('click', () => modal.remove())
  }

  async function mostrarModalAsignar(chofer) {
    try {
      const votantes = await getVotantesPorSeccional(chofer.seccional)

      const modal = document.createElement('div')
      modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

      modal.innerHTML = `
        <div style="background: white; border-radius: 8px; max-width: 800px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
          <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #2196f3;">
            📋 ASIGNAR VOTANTES A ${chofer.nombre}
          </h2>

          <div style="background: #e3f2fd; padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9rem;">
            <strong>Seccional ${chofer.seccional}</strong> - ${votantes.length} votantes disponibles
          </div>

          <div style="max-height: 400px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
            ${votantes.map((v, i) => `
              <div style="padding: 8px 12px; border-bottom: 1px solid #eee; display: flex; align-items: flex-start; gap: 8px;">
                <input type="checkbox" class="chk-votante" data-idx="${i}" style="cursor: pointer; margin-top: 4px;">
                <div style="flex: 1; font-size: 0.85rem;">
                  <strong>${v.nombre}</strong> (CI: ${v.cedula})
                  <br><span style="color: #666;">📍 ${v.local || 'Sin local'} | 📱 ${v.telefono || 'Sin teléfono'}</span>
                </div>
              </div>
            `).join('')}
          </div>

          <div style="display: flex; gap: 8px;">
            <button id="btn-asignar-votantes" style="flex: 1; background: #2196f3; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              ✅ ASIGNAR SELECCIONADOS
            </button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              ❌ CANCELAR
            </button>
          </div>
        </div>
      `

      document.body.appendChild(modal)

      document.getElementById('btn-asignar-votantes').addEventListener('click', async () => {
        const seleccionados = Array.from(document.querySelectorAll('.chk-votante:checked')).map(cb => {
          const idx = parseInt(cb.getAttribute('data-idx'))
          return votantes[idx]
        })

        if (seleccionados.length === 0) {
          alert('Selecciona al menos un votante')
          return
        }

        try {
          await assignVotantesToChofer(chofer.id, seleccionados)
          modal.remove()
          cargarChoferes()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })

      document.getElementById('btn-cancelar').addEventListener('click', () => modal.remove())
    } catch (err) {
      alert('Error al cargar votantes: ' + err.message)
    }
  }

  cargarChoferes()
}