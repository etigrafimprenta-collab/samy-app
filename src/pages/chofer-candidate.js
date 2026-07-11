/**
 * MÓDULO: CHOFER (candidato-scoped) — gestión de choferes y asignación
 * de votantes con integración WhatsApp. Port de chofer.js.
 */
import {
  createDriver,
  getDrivers,
  updateDriver,
  deleteDriver,
  assignVotantesToDriver,
  getRecordsBySeccional,
  getAllCandidateUsers,
  getAllRecords,
  updateRecord,
  getRecordByCedula,
  searchVoterByCedula
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'

export function renderChoferCandidate(container, candidateId) {
  let choferes = []
  let usuarios = []
  let activeTab = 'choferes'
  let choferSeleccionadoId = ''
  let todosLosRegistros = []
  let filasChoferes = []

  // Igual criterio que mesario-candidate.js: un savedRecord con
  // canBeDriver=true (tildado en "Buscar votante") aparece acá sin que
  // nadie lo cargue a mano, hasta que se "edita" (crea el doc real de
  // drivers linkeado por savedRecordId) o se elimina (desmarca el flag).
  function construirFilasChoferes() {
    const linkedIds = new Set(choferes.map(c => c.savedRecordId).filter(Boolean))
    const filasManual = choferes.map(c => ({ ...c, origen: c.savedRecordId ? 'auto+manual' : 'manual' }))
    const filasAuto = todosLosRegistros
      .filter(r => r.canBeDriver && !linkedIds.has(r.id))
      .map(r => ({
        id: null,
        savedRecordId: r.id,
        nombre: r.nombre,
        ci: r.cedula,
        celular: r.telefono,
        telefono: r.telefono,
        vehiculo: '',
        tipoVehiculo: '',
        seccional: r.local,
        local: r.local,
        montoEntregado: 0,
        usuarioAsignado: null,
        votantesAsignados: 0,
        origen: 'auto'
      }))
    filasChoferes = [...filasManual, ...filasAuto].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
  }

  async function cargarChoferes() {
    try {
      const [driversData, usuariosData, records] = await Promise.all([
        getDrivers(candidateId),
        getAllCandidateUsers(candidateId),
        getAllRecords(candidateId)
      ])
      choferes = driversData
      usuarios = usuariosData
      todosLosRegistros = records
      construirFilasChoferes()
      render()
    } catch (err) {
      alert('Error al cargar choferes: ' + err.message)
    }
  }

  function tabBtn(id, label) {
    const active = activeTab === id
    return `<button class="btn-tab-chofer" data-tab="${id}" style="padding: 10px 18px; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-weight: 700; font-size: 0.85rem; background: ${active ? 'white' : 'rgba(255,255,255,.15)'}; color: ${active ? '#1565c0' : 'white'};">${label}</button>`
  }

  function render() {
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px 24px 0; border-radius: 8px 8px 0 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🚗 CHOFERES</h2>
          ${activeTab === 'choferes' ? `
            <button id="btn-crear-chofer" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
              ➕ NUEVO CHOFER
            </button>
          ` : ''}
        </div>
        <div style="display: flex; gap: 4px;">
          ${tabBtn('choferes', '📋 Listado de choferes')}
          ${tabBtn('votantes', '🗳️ Votantes asignados')}
        </div>
      </div>
      <div id="chofer-tab-body"></div>
    `

    container.querySelectorAll('.btn-tab-chofer').forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render() })
    })

    if (activeTab === 'choferes') {
      const crearBtn = document.getElementById('btn-crear-chofer')
      if (crearBtn) crearBtn.addEventListener('click', () => mostrarModalCrear())
      renderTabChoferes()
    } else {
      renderTabVotantesAsignados()
    }
  }

  function renderTabChoferes() {
    const body = document.getElementById('chofer-tab-body')
    const totalEntregado = filasChoferes.reduce((sum, c) => sum + (Number(c.montoEntregado) || 0), 0)

    body.innerHTML = `
      <div style="background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
          <h3 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
            📋 LISTADO DE CHOFERES
          </h3>
          <div style="background: #e8f5e9; color: #2e7d32; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">
            💰 Total entregado: Gs. ${totalEntregado.toLocaleString('es-PY')}
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead style="background: #000; color: white;">
              <tr>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Nombre</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">CI</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Celular</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Vehículo</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Local electoral</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Usuario</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Votantes</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Monto entregado</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Origen</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${filasChoferes.length === 0 ? `
                <tr><td colspan="10" style="padding: 40px; text-align: center; color: #999;">No hay choferes creados. ➕ Crear uno nuevo.</td></tr>
              ` : filasChoferes.map((c, i) => {
                const usuarioAsignado = usuarios.find(u => u.id === c.usuarioAsignado)
                const origenBadge = c.origen === 'manual'
                  ? '<span style="background:#eee; color:#555; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Manual</span>'
                  : c.origen === 'auto'
                    ? '<span style="background:#e3f2fd; color:#1976d2; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto (Buscar votante)</span>'
                    : '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto + editado</span>'
                return `
                <tr style="border-bottom: 1px solid #eee;" data-idx="${i}">
                  <td style="padding: 10px;"><strong>${escapeHtml(c.nombre)}</strong></td>
                  <td style="padding: 10px; font-family: monospace; font-size: 0.8rem;">${escapeHtml(c.ci) || '—'}</td>
                  <td style="padding: 10px;">${escapeHtml(c.celular || c.telefono)}</td>
                  <td style="padding: 10px; font-family: monospace; font-size: 0.8rem;">${escapeHtml(c.vehiculo) || '—'}${c.tipoVehiculo ? ' (' + escapeHtml(c.tipoVehiculo) + ')' : ''}</td>
                  <td style="padding: 10px;"><strong>${escapeHtml(c.seccional) || '—'}</strong></td>
                  <td style="padding: 10px; font-size: 0.8rem;">
                    ${usuarioAsignado ? `<span style="background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 3px;">👤 ${escapeHtml(usuarioAsignado.nombre || usuarioAsignado.email)}</span>` : '<span style="color: #999;">Sin asignar</span>'}
                  </td>
                  <td style="padding: 10px; text-align: center;">
                    <span style="background: #e3f2fd; color: #1976d2; padding: 4px 8px; border-radius: 3px; font-weight: 700;">
                      ${c.votantesAsignados || 0}
                    </span>
                  </td>
                  <td style="padding: 10px;">
                    <span style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 3px; font-weight: 700;">
                      Gs. ${(Number(c.montoEntregado) || 0).toLocaleString('es-PY')}
                    </span>
                  </td>
                  <td style="padding: 10px;">${origenBadge}</td>
                  <td style="padding: 10px; display: flex; gap: 4px;">
                    <button class="btn-wa" data-idx="${i}" style="background: #25d366; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">📲</button>
                    ${c.id ? `<button class="btn-asignar" data-idx="${i}" style="background: #2196f3; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">📋</button>` : ''}
                    <button class="btn-editar" data-idx="${i}" style="background: #ff9800; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">✏️</button>
                    <button class="btn-eliminar" data-idx="${i}" style="background: #d32f2f; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">🗑️</button>
                  </td>
                </tr>
              `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    body.querySelectorAll('.btn-wa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chofer = filasChoferes[Number(btn.dataset.idx)]
        const tel = (chofer.celular || chofer.telefono || '').replace(/\D/g, '')
        if (!tel) { alert('Este chofer no tiene celular cargado'); return }
        const msg = encodeURIComponent(`Hola ${chofer.nombre}, te escribimos desde el equipo de campaña.`)
        window.open(`https://wa.me/${tel}?text=${msg}`, '_blank')
      })
    })

    body.querySelectorAll('.btn-asignar').forEach(btn => {
      btn.addEventListener('click', () => {
        const chofer = filasChoferes[Number(btn.dataset.idx)]
        mostrarModalAsignar(chofer)
      })
    })

    body.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const chofer = filasChoferes[Number(btn.dataset.idx)]
        mostrarModalEditar(chofer)
      })
    })

    body.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chofer = filasChoferes[Number(btn.dataset.idx)]
        const avisoCheck = chofer.savedRecordId ? '\nEsto también desmarca la opción "Puede ser chofer" en su registro de Buscar votante.' : ''
        if (!confirm(`¿Quitar a ${chofer.nombre} del listado de choferes?${avisoCheck}`)) return
        try {
          if (chofer.id) await deleteDriver(candidateId, chofer.id)
          if (chofer.savedRecordId) await updateRecord(candidateId, chofer.savedRecordId, { canBeDriver: false })
          cargarChoferes()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  // Segunda pestaña: a diferencia de "Asignar" (que guarda una foto fija
  // de votantes en el propio documento del chofer), esto lee en vivo de
  // Registros (savedRecords) filtrando por chofer_asignado — el campo que
  // escribe Día D Admin/Control (y ahora también esta pestaña) al asignar
  // un chofer a un votante puntual, así que siempre refleja el estado real
  // y actual, no un snapshot viejo. Además permite armar/confirmar la
  // asignación acá mismo, buscando votantes por CI/nombre con filtros.
  async function renderTabVotantesAsignados() {
    const body = document.getElementById('chofer-tab-body')
    body.innerHTML = `
      <div style="background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
          🗳️ VOTANTES ASIGNADOS POR CHOFER
        </h3>
        <select id="sel-chofer-votantes" style="width: 100%; max-width: 360px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 16px;">
          <option value="">-- Elegí un chofer --</option>
          ${choferes.map(c => `<option value="${c.id}" ${c.id === choferSeleccionadoId ? 'selected' : ''}>${escapeHtml(c.nombre)}${c.seccional ? ' (' + escapeHtml(c.seccional) + ')' : ''}</option>`).join('')}
        </select>
        <div id="votantes-asignados-body"></div>
      </div>
    `

    const sel = document.getElementById('sel-chofer-votantes')
    sel.addEventListener('change', () => {
      choferSeleccionadoId = sel.value
      pintarVotantesAsignados()
    })

    todosLosRegistros = await getAllRecords(candidateId)
    pintarVotantesAsignados()
  }

  function pintarVotantesAsignados() {
    const box = document.getElementById('votantes-asignados-body')
    if (!choferSeleccionadoId) {
      box.innerHTML = '<div style="color: #999; padding: 20px; text-align: center;">Elegí un chofer para ver y asignarle votantes.</div>'
      return
    }
    const chofer = choferes.find(c => c.id === choferSeleccionadoId)
    const asignados = todosLosRegistros.filter(r => r.chofer_asignado === choferSeleccionadoId)

    box.innerHTML = `
      <div style="background: #e3f2fd; padding: 12px; border-radius: 4px; margin-bottom: 8px; font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <span><strong>${escapeHtml(chofer.nombre)}</strong> — ${asignados.length} votante${asignados.length === 1 ? '' : 's'} asignado${asignados.length === 1 ? '' : 's'}</span>
        <button id="btn-enviar-listado" ${asignados.length === 0 ? 'disabled' : ''} style="background: ${asignados.length === 0 ? '#ccc' : '#25d366'}; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: ${asignados.length === 0 ? 'not-allowed' : 'pointer'}; font-weight: 700; font-size: 0.8rem;">📤 Enviar listado por WhatsApp</button>
      </div>
      <div id="votantes-asignados-tabla" style="margin-bottom: 24px;"></div>

      <h4 style="margin: 0 0 10px; font-family: 'Barlow Condensed'; font-size: 1.1rem; text-transform: uppercase; color: #1565c0;">➕ Asignar votantes por CI</h4>
      <div id="panel-asignar-votantes"></div>
    `

    pintarTablaAsignados(asignados)

    document.getElementById('btn-enviar-listado').addEventListener('click', () => enviarListadoWhatsapp(chofer, asignados))

    pintarPanelAsignar()
  }

  function pintarTablaAsignados(asignados) {
    const tablaBox = document.getElementById('votantes-asignados-tabla')
    tablaBox.innerHTML = asignados.length === 0 ? `
      <div style="color: #999; padding: 30px; text-align: center; border: 1px solid #eee; border-radius: 6px;">Este chofer todavía no tiene votantes asignados.</div>
    ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead style="background: #000; color: white;">
              <tr>
                <th style="padding: 10px; text-align: left;">Cédula</th>
                <th style="padding: 10px; text-align: left;">Nombre</th>
                <th style="padding: 10px; text-align: left;">Local electoral</th>
                <th style="padding: 10px; text-align: left;">Mesa</th>
                <th style="padding: 10px; text-align: left;">Orden</th>
                <th style="padding: 10px; text-align: left;">Teléfono</th>
                <th style="padding: 10px; text-align: left;">Dirección</th>
                <th style="padding: 10px; text-align: left;">WhatsApp</th>
                <th style="padding: 10px; text-align: left;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${asignados.map(r => {
                const tel = (r.telefono || '').replace(/\D/g, '')
                const telLimpio = tel ? '595' + tel.replace(/^0/, '') : ''
                return `
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px; font-family: monospace; font-size: 0.8rem;">${escapeHtml(r.cedula)}</td>
                  <td style="padding: 10px;"><strong>${escapeHtml(r.nombre)}</strong></td>
                  <td style="padding: 10px;">${escapeHtml(r.local) || '—'}</td>
                  <td style="padding: 10px;">${escapeHtml(r.mesa) || '—'}</td>
                  <td style="padding: 10px;">${escapeHtml(r.orden) || '—'}</td>
                  <td style="padding: 10px;">${escapeHtml(r.telefono) || '—'}</td>
                  <td style="padding: 10px;">${escapeHtml(r.direccion) || '—'}</td>
                  <td style="padding: 10px;">
                    ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:4px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">💬 Blanco</a>` : '<span style="color:#999; font-size:.75rem;">sin tel.</span>'}
                  </td>
                  <td style="padding: 10px;">
                    <button class="btn-quitar-asignado" data-id="${r.id}" style="background:#d32f2f; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:.72rem; font-weight:600;">✕ Quitar</button>
                  </td>
                </tr>
              `
              }).join('')}
            </tbody>
          </table>
        </div>
    `

    tablaBox.querySelectorAll('.btn-quitar-asignado').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Quitar la asignación de este chofer a este votante?')) return
        try {
          await updateRecord(candidateId, btn.dataset.id, { chofer_asignado: null })
          const rec = todosLosRegistros.find(r => r.id === btn.dataset.id)
          if (rec) rec.chofer_asignado = null
          pintarVotantesAsignados()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  function enviarListadoWhatsapp(chofer, asignados) {
    const tel = (chofer.celular || chofer.telefono || '').replace(/\D/g, '')
    if (!tel) { alert('Este chofer no tiene celular cargado'); return }
    const telLimpio = '595' + tel.replace(/^0/, '')
    const lineas = asignados.map((r, i) =>
      `${i + 1}. ${r.nombre} (CI ${r.cedula}) — ${r.local || 'sin local'}, mesa ${r.mesa || '—'}${r.direccion ? ' — ' + r.direccion : ''}${r.telefono ? ' — 📱 ' + r.telefono : ''}`
    )
    const msg = encodeURIComponent(
      `Hola ${chofer.nombre}, este es tu listado de votantes asignados (${asignados.length}):\n\n${lineas.join('\n')}`
    )
    window.open(`https://wa.me/${telLimpio}?text=${msg}`, '_blank')
  }

  // Filtros sobre el pool de registros del candidato para armar el
  // listado a asignar: por CI/nombre, local y mesa — igual criterio
  // combinable (AND) que en Registros/Mis registros.
  function pintarPanelAsignar() {
    const panel = document.getElementById('panel-asignar-votantes')
    const opcion = (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    const locales = [...new Set(todosLosRegistros.map(r => r.local).filter(Boolean))].sort()
    const mesas = [...new Set(todosLosRegistros.map(r => r.mesa).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))

    panel.innerHTML = `
      <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:10px;">
        <input id="inp-buscar-asignar" placeholder="Buscar por CI o nombre..." style="padding:10px; border:1px solid #ddd; border-radius:4px;">
        <select id="sel-local-asignar" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <option value="">Todos los locales</option>
          ${locales.map(opcion).join('')}
        </select>
        <select id="sel-mesa-asignar" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
          <option value="">Todas las mesas</option>
          ${mesas.map(opcion).join('')}
        </select>
      </div>
      <div id="lista-candidatos-asignar" style="max-height: 320px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 12px;"></div>
      <button id="btn-confirmar-asignacion" style="background: #2196f3; color: white; border: none; padding: 10px 18px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ Confirmar asignación</button>
    `

    function pintarListaCandidatos() {
      const termino = document.getElementById('inp-buscar-asignar').value.trim().toLowerCase()
      const local = document.getElementById('sel-local-asignar').value
      const mesa = document.getElementById('sel-mesa-asignar').value

      const filtrados = todosLosRegistros.filter(r => {
        if (termino && !(String(r.cedula).toLowerCase().includes(termino) || String(r.nombre).toLowerCase().includes(termino))) return false
        if (local && r.local !== local) return false
        if (mesa && String(r.mesa) !== mesa) return false
        return true
      })

      const listaBox = document.getElementById('lista-candidatos-asignar')
      if (filtrados.length === 0) {
        listaBox.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Sin resultados.</div>'
        return
      }
      listaBox.innerHTML = filtrados.map(r => {
        const otroChofer = r.chofer_asignado && r.chofer_asignado !== choferSeleccionadoId ? choferes.find(c => c.id === r.chofer_asignado) : null
        const yaEsteChofer = r.chofer_asignado === choferSeleccionadoId
        return `
        <div style="padding: 8px 12px; border-bottom: 1px solid #eee; display: flex; align-items: flex-start; gap: 8px;">
          <input type="checkbox" class="chk-candidato-asignar" data-id="${r.id}" ${yaEsteChofer ? 'checked disabled' : ''} style="cursor: pointer; margin-top: 4px;">
          <div style="flex: 1; font-size: 0.85rem;">
            <strong>${escapeHtml(r.nombre)}</strong> (CI: ${escapeHtml(r.cedula)})
            <br><span style="color: #666;">📍 ${escapeHtml(r.local) || 'Sin local'} · Mesa ${escapeHtml(r.mesa) || '—'} | 📱 ${escapeHtml(r.telefono) || 'Sin teléfono'}</span>
            ${yaEsteChofer ? '<br><span style="color:#2e7d32; font-weight:700; font-size:.75rem;">✓ Ya asignado a este chofer</span>' : ''}
            ${otroChofer ? `<br><span style="color:#e65100; font-weight:600; font-size:.75rem;">⚠️ Ya asignado a ${escapeHtml(otroChofer.nombre)}</span>` : ''}
          </div>
        </div>`
      }).join('')
    }

    pintarListaCandidatos()
    document.getElementById('inp-buscar-asignar').addEventListener('input', debounce(pintarListaCandidatos, 250))
    document.getElementById('sel-local-asignar').addEventListener('change', pintarListaCandidatos)
    document.getElementById('sel-mesa-asignar').addEventListener('change', pintarListaCandidatos)

    document.getElementById('btn-confirmar-asignacion').addEventListener('click', async () => {
      const seleccionados = Array.from(document.querySelectorAll('.chk-candidato-asignar:checked:not(:disabled)')).map(cb => cb.dataset.id)
      if (seleccionados.length === 0) {
        alert('Seleccioná al menos un votante.')
        return
      }
      try {
        await Promise.all(seleccionados.map(id => updateRecord(candidateId, id, { chofer_asignado: choferSeleccionadoId })))
        seleccionados.forEach(id => {
          const rec = todosLosRegistros.find(r => r.id === id)
          if (rec) rec.chofer_asignado = choferSeleccionadoId
        })
        pintarVotantesAsignados()
      } catch (err) {
        alert('Error al confirmar la asignación: ' + err.message)
      }
    })
  }

  function mostrarModalCrear() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">➕ NUEVO CHOFER</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">CI:</label>
            <input id="inp-ci" type="text" placeholder="1234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <div id="autocompletar-chofer-msg" style="font-size:.78rem; color:#666; margin-top:4px;"></div>
          </div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" placeholder="Ej: Juan Pérez" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Celular:</label>
            <input id="inp-celular" type="text" placeholder="981234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Vehículo (Placa):</label>
            <input id="inp-vehiculo" type="text" placeholder="ABC-123" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Tipo de Vehículo:</label>
            <select id="sel-tipo" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Seleccionar --</option>
              <option value="Auto">Auto</option>
              <option value="Microbus">Microbus</option>
              <option value="Camioneta">Camioneta</option>
            </select></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Local electoral:</label>
            <input id="inp-seccional" type="text" placeholder="Ej: 357" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Monto entregado (Gs.):</label>
            <input id="inp-monto" type="number" min="0" step="1000" placeholder="Ej: 100000" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Asignar a Usuario:</label>
            <select id="sel-usuario" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Sin asignar --</option>
              ${usuarios.map(u => `<option value="${u.id}">${escapeHtml(u.nombre || u.email)}</option>`).join('')}
            </select></div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ GUARDAR</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    // Autocompletar por CI: prioridad Registros (savedRecords, trae
    // también teléfono), y si no está ahí cae al padrón compartido (solo
    // nombre/local, sin teléfono). Nunca pisa lo ya escrito a mano.
    document.getElementById('inp-ci').addEventListener('blur', async () => {
      const ci = document.getElementById('inp-ci').value.trim()
      const msgEl = document.getElementById('autocompletar-chofer-msg')
      if (!ci) { msgEl.textContent = ''; return }

      const nombreInput = document.getElementById('inp-nombre')
      const celularInput = document.getElementById('inp-celular')
      const seccionalInput = document.getElementById('inp-seccional')
      msgEl.textContent = '🔎 Buscando datos de esta CI...'
      try {
        const registro = await getRecordByCedula(candidateId, ci)
        if (registro) {
          if (!nombreInput.value.trim()) nombreInput.value = registro.nombre || ''
          if (!celularInput.value.trim()) celularInput.value = registro.telefono || ''
          if (!seccionalInput.value.trim()) seccionalInput.value = registro.local || ''
          msgEl.textContent = '✅ Datos completados desde Registros.'
          return
        }
        const enPadron = await searchVoterByCedula(ci)
        if (enPadron.length > 0) {
          const v = enPadron[0]
          if (!nombreInput.value.trim()) nombreInput.value = v.nombre || ''
          if (!seccionalInput.value.trim()) seccionalInput.value = v.local || ''
          msgEl.textContent = '✅ Datos completados desde el padrón (sin teléfono: el padrón no lo tiene).'
          return
        }
        msgEl.textContent = 'Sin coincidencias en Registros ni en el padrón.'
      } catch (err) {
        console.error('Error autocompletando por CI:', err)
        msgEl.textContent = '❌ ' + err.message
      }
    })

    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const ci = document.getElementById('inp-ci').value.trim()
      const nombre = document.getElementById('inp-nombre').value.trim()
      const celular = document.getElementById('inp-celular').value.trim().replace(/\D/g, '')
      const vehiculo = document.getElementById('inp-vehiculo').value.trim()
      const tipoVehiculo = document.getElementById('sel-tipo').value
      const seccional = document.getElementById('inp-seccional').value.trim()
      const montoEntregado = Number(document.getElementById('inp-monto').value) || 0
      const usuarioAsignado = document.getElementById('sel-usuario').value

      if (!nombre || !celular) {
        alert('Nombre y celular son obligatorios')
        return
      }

      try {
        await createDriver(candidateId, {
          ci,
          nombre,
          celular,
          telefono: celular,
          vehiculo,
          tipoVehiculo,
          seccional,
          local: seccional,
          montoEntregado,
          usuarioAsignado: usuarioAsignado || null,
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
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #ff9800;">✏️ EDITAR CHOFER</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">CI:</label>
            <input id="inp-ci" type="text" value="${escapeHtml(chofer.ci || '')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" value="${escapeHtml(chofer.nombre)}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Celular:</label>
            <input id="inp-celular" type="text" value="${escapeHtml(chofer.celular || chofer.telefono)}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Vehículo (Placa):</label>
            <input id="inp-vehiculo" type="text" value="${escapeHtml(chofer.vehiculo)}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Monto entregado (Gs.):</label>
            <input id="inp-monto" type="number" min="0" step="1000" value="${Number(chofer.montoEntregado) || 0}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Asignar a Usuario:</label>
            <select id="sel-usuario" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">-- Sin asignar --</option>
              ${usuarios.map(u => `<option value="${u.id}" ${chofer.usuarioAsignado === u.id ? 'selected' : ''}>${escapeHtml(u.nombre || u.email)}</option>`).join('')}
            </select></div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #ff9800; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">💾 GUARDAR</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const ci = document.getElementById('inp-ci').value.trim()
      const nombre = document.getElementById('inp-nombre').value.trim()
      const celular = document.getElementById('inp-celular').value.trim().replace(/\D/g, '')
      const vehiculo = document.getElementById('inp-vehiculo').value.trim()
      const montoEntregado = Number(document.getElementById('inp-monto').value) || 0
      const usuarioAsignado = document.getElementById('sel-usuario').value

      try {
        if (chofer.id) {
          await updateDriver(candidateId, chofer.id, {
            ci,
            nombre,
            celular,
            telefono: celular,
            vehiculo,
            montoEntregado,
            usuarioAsignado: usuarioAsignado || null
          })
        } else {
          // Fila "auto" (canBeDriver desde Buscar votante, todavía sin doc
          // propio) — se crea el doc real de drivers acá, linkeado por
          // savedRecordId para no duplicar la fila en el listado.
          await createDriver(candidateId, {
            ci,
            nombre,
            celular,
            telefono: celular,
            vehiculo,
            seccional: chofer.seccional,
            local: chofer.seccional,
            montoEntregado,
            usuarioAsignado: usuarioAsignado || null,
            votantesAsignados: 0,
            savedRecordId: chofer.savedRecordId
          })
        }
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
      const votantes = await getRecordsBySeccional(candidateId, chofer.seccional)

      const modal = document.createElement('div')
      modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

      modal.innerHTML = `
        <div style="background: white; border-radius: 8px; max-width: 800px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
          <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #2196f3;">📋 ASIGNAR VOTANTES A ${escapeHtml(chofer.nombre)}</h2>
          <div style="background: #e3f2fd; padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9rem;">
            <strong>Local electoral ${escapeHtml(chofer.seccional)}</strong> - ${votantes.length} registros disponibles
          </div>
          <div style="max-height: 400px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
            ${votantes.map((v, i) => `
              <div style="padding: 8px 12px; border-bottom: 1px solid #eee; display: flex; align-items: flex-start; gap: 8px;">
                <input type="checkbox" class="chk-votante" data-idx="${i}" style="cursor: pointer; margin-top: 4px;">
                <div style="flex: 1; font-size: 0.85rem;">
                  <strong>${escapeHtml(v.nombre)}</strong> (CI: ${escapeHtml(v.cedula)})
                  <br><span style="color: #666;">📍 ${escapeHtml(v.local) || 'Sin local'} | 📱 ${escapeHtml(v.telefono) || 'Sin teléfono'}</span>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="btn-asignar-votantes" style="flex: 1; background: #2196f3; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ ASIGNAR SELECCIONADOS</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
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
          await assignVotantesToDriver(candidateId, chofer.id, seleccionados)
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
