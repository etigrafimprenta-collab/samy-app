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
  searchVoterByCedula,
  previewVotersInZone,
  createZoneAndReserve,
  confirmZoneAssignment,
  releaseZoneVoters,
  cancelZone,
  changeZoneDriver,
  getDriverZones,
  getDriverZoneVoters,
  getActiveDriverZoneVoters,
  getElectionDayControlByDriver,
  updateDriverZoneMeta
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'
import { can } from '../lib/rbac.js'
import { exportGenericToExcel } from '../lib/excel.js'
import { exportGenericToPdf } from '../lib/pdf.js'
import { initZoneMap, initReadOnlyZoneMap, geocodeAddress, extractLatLngFromMapsUrl } from '../lib/leafletZoneMap.js'

export function renderChoferCandidate(container, candidateId, user, myRole, misRoles = []) {
  let choferes = []
  let usuarios = []
  let activeTab = 'choferes'
  let choferSeleccionadoId = ''
  let todosLosRegistros = []
  let filasChoferes = []
  let zonas = []
  let votersActivosZonas = [] // driverZoneVoters RESERVADO(vigente)/ASIGNADO de TODO el candidato

  // Mismo patrón puedeCompat que campaign.js: el permiso nuevo (RBAC
  // granular) amplía lo que ya da el rol legacy, nunca lo achica. Como
  // "choferes" en TAB_ROLES ya exige campaign_admin/coordinator para
  // entrar a este módulo, en la práctica hoy esto es siempre true — queda
  // preparado para cuando exista un rol personalizado con driver_zones.*
  // sin ser campaign_admin/coordinator.
  function puede(permKey) {
    return can(misRoles, permKey) || ['campaign_admin', 'coordinator'].includes(myRole)
  }

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

  async function cargarZonas() {
    try {
      const [zonasData, activos] = await Promise.all([
        getDriverZones(candidateId),
        getActiveDriverZoneVoters(candidateId)
      ])
      zonas = zonasData
      votersActivosZonas = activos
    } catch (err) {
      alert('Error al cargar zonas: ' + err.message)
    }
  }

  function tabBtn(id, label) {
    const active = activeTab === id
    return `<button class="btn-tab-chofer" data-tab="${id}" style="padding: 10px 18px; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-weight: 700; font-size: 0.85rem; background: ${active ? 'white' : 'rgba(255,255,255,.15)'}; color: ${active ? '#1565c0' : 'white'};">${label}</button>`
  }

  function render() {
    const verZonas = puede('driver_zones.view')
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px 24px 0; border-radius: 8px 8px 0 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🚗 CHOFERES</h2>
          ${activeTab === 'choferes' ? `
            <button id="btn-crear-chofer" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
              ➕ NUEVO CHOFER
            </button>
          ` : ''}
          ${activeTab === 'zonas' && puede('driver_zones.create') ? `
            <button id="btn-crear-zona" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">
              ➕ NUEVA ZONA
            </button>
          ` : ''}
        </div>
        <div style="display: flex; gap: 4px;">
          ${tabBtn('choferes', '📋 Listado de choferes')}
          ${tabBtn('votantes', '🗳️ Votantes asignados')}
          ${verZonas ? tabBtn('zonas', '🗺️ Zonas de búsqueda') : ''}
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
    } else if (activeTab === 'zonas' && verZonas) {
      const crearZonaBtn = document.getElementById('btn-crear-zona')
      if (crearZonaBtn) crearZonaBtn.addEventListener('click', () => mostrarModalCrearZona())
      renderTabZonas()
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

        ${filasChoferes.length === 0 ? `
          <div style="padding: 40px 20px; text-align: center; color: #999;">No hay choferes creados. ➕ Crear uno nuevo.</div>
        ` : `
          <div class="roster-card-grid">
            ${filasChoferes.map((c, i) => {
              const usuarioAsignado = usuarios.find(u => u.id === c.usuarioAsignado)
              const origenBadge = c.origen === 'manual'
                ? '<span style="background:#eee; color:#555; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Manual</span>'
                : c.origen === 'auto'
                  ? '<span style="background:#e3f2fd; color:#1976d2; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto (Buscar votante)</span>'
                  : '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto + editado</span>'
              return `
              <div class="roster-card" data-idx="${i}">
                <div class="roster-card-name">${escapeHtml(c.nombre)}</div>
                <div class="roster-card-fields">
                  <div class="roster-card-field"><strong>CI:</strong> ${escapeHtml(c.ci) || '—'}</div>
                  <div class="roster-card-field"><strong>Celular:</strong> ${escapeHtml(c.celular || c.telefono)}</div>
                  <div class="roster-card-field"><strong>Vehículo:</strong> ${escapeHtml(c.vehiculo) || '—'}${c.tipoVehiculo ? ' (' + escapeHtml(c.tipoVehiculo) + ')' : ''}</div>
                  <div class="roster-card-field"><strong>Local electoral:</strong> ${escapeHtml(c.seccional) || '—'}</div>
                  <div class="roster-card-field"><strong>Usuario:</strong> ${usuarioAsignado ? `👤 ${escapeHtml(usuarioAsignado.nombre || usuarioAsignado.email)}` : 'Sin asignar'}</div>
                  <div class="roster-card-field"><strong>Votantes:</strong> <span style="background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 3px; font-weight: 700;">${c.votantesAsignados || 0}</span></div>
                  <div class="roster-card-field"><strong>Entregado:</strong> <span style="background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 3px; font-weight: 700;">Gs. ${(Number(c.montoEntregado) || 0).toLocaleString('es-PY')}</span></div>
                  <div class="roster-card-field">${origenBadge}</div>
                </div>
                <div class="roster-card-actions">
                  <button class="btn-wa btn-compact" data-idx="${i}" style="background: #25d366; color: white;">📲 WhatsApp</button>
                  ${c.id ? `<button class="btn-asignar btn-compact" data-idx="${i}" style="background: #2196f3; color: white;">📋 Asignar</button>` : ''}
                  <button class="btn-editar btn-compact" data-idx="${i}" style="background: #ff9800; color: white;">✏️ Editar</button>
                  <button class="btn-eliminar btn-compact" data-idx="${i}" style="background: #d32f2f; color: white;">🗑️ Eliminar</button>
                </div>
              </div>
            `
            }).join('')}
          </div>
        `}
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

    // votersActivosZonas/zonas también se cargan acá (no solo en la
    // pestaña Zonas) porque esta pestaña los necesita para mostrar "zona
    // de procedencia" (punto 10 del pedido) y para excluir del buscador
    // manual a quien ya esté en una zona activa.
    const [records, activos, zonasData] = await Promise.all([
      getAllRecords(candidateId),
      getActiveDriverZoneVoters(candidateId),
      zonas.length > 0 ? Promise.resolve(zonas) : getDriverZones(candidateId)
    ])
    todosLosRegistros = records
    votersActivosZonas = activos
    zonas = zonasData
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
        <div class="roster-card-grid">
          ${asignados.map(r => {
            const tel = (r.telefono || '').replace(/\D/g, '')
            const telLimpio = tel ? '595' + tel.replace(/^0/, '') : ''
            // Punto 10 del pedido: si este votante viene de una zona de
            // búsqueda, mostrar de dónde — votersActivosZonas/zonas se
            // cargan junto con esta pestaña (ver renderTabVotantesAsignados).
            const zv = votersActivosZonas.find(v => v.id === r.id)
            const zona = zv ? zonas.find(z => z.id === zv.zoneId) : null
            return `
            <div class="roster-card">
              <div class="roster-card-name">${escapeHtml(r.nombre)}</div>
              <div class="roster-card-fields">
                <div class="roster-card-field"><strong>Cédula:</strong> ${escapeHtml(r.cedula)}</div>
                <div class="roster-card-field"><strong>Local / Mesa / Orden:</strong> ${escapeHtml(r.local) || '—'} · ${escapeHtml(r.mesa) || '—'} · ${escapeHtml(r.orden) || '—'}</div>
                <div class="roster-card-field"><strong>Teléfono:</strong> ${escapeHtml(r.telefono) || '—'} ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:2px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">💬</a>` : ''}</div>
                <div class="roster-card-field"><strong>Dirección:</strong> ${escapeHtml(r.direccion) || '—'}</div>
                ${zona ? `
                  <div class="roster-card-field"><strong>Zona:</strong> 🗺️ ${escapeHtml(zona.name)} ${typeof zv.distanceMeters === 'number' ? `(${zv.distanceMeters} m)` : ''}</div>
                ` : ''}
              </div>
              <div class="roster-card-actions">
                <button class="btn-quitar-asignado btn-compact" data-id="${r.id}" data-zone-id="${zv ? zv.zoneId : ''}" style="background:#d32f2f; color:white;">✕ Quitar</button>
              </div>
            </div>
          `
          }).join('')}
        </div>
    `

    tablaBox.querySelectorAll('.btn-quitar-asignado').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Quitar la asignación de este chofer a este votante?')) return
        try {
          const zoneId = btn.dataset.zoneId
          if (zoneId) {
            // Viene de una zona de búsqueda: liberar por la Cloud Function
            // (mismo camino que "Liberar votantes" en la pestaña Zonas) para
            // que también limpie driverZoneVoters/electionDayControl, no
            // solo chofer_asignado — evita repetir la desincronización que
            // ya existía antes de esta feature (ver diagnóstico del plan).
            await releaseZoneVoters(candidateId, zoneId, [btn.dataset.id])
            votersActivosZonas = votersActivosZonas.filter(v => v.id !== btn.dataset.id)
          } else {
            await updateRecord(candidateId, btn.dataset.id, { chofer_asignado: null })
          }
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
        <div class="filter-input-wrap"><input id="inp-buscar-asignar" class="filter-input" placeholder="Buscar por CI o nombre..."></div>
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

      // Punto 10 del pedido: un votante ya incluido en una zona de
      // búsqueda activa no debe reaparecer en el buscador manual — su
      // asignación/liberación pasa a manejarse desde la pestaña Zonas.
      const idsEnZona = new Set(votersActivosZonas.map(v => v.id))
      const filtrados = todosLosRegistros.filter(r => {
        if (idsEnZona.has(r.id)) return false
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

  // ══════════════════════════════════════════════════════════════════════
  // ZONAS DE BÚSQUEDA — pestaña nueva. A diferencia de todo lo de arriba
  // (updateDoc/addDoc directos), toda escritura pasa por las Cloud
  // Functions importadas al inicio (createZoneAndReserve/
  // confirmZoneAssignment/releaseZoneVoters/cancelZone/changeZoneDriver) —
  // firestore.rules bloquea escritura directa a driverZones/
  // driverZoneVoters a propósito (ver diagnóstico del plan de
  // implementación).
  // ══════════════════════════════════════════════════════════════════════

  function fmtFecha(ts) {
    return ts?.toDate ? ts.toDate().toLocaleString('es-PY') : '—'
  }

  function nombreUsuario(uid) {
    const u = usuarios.find(x => x.id === uid)
    return u ? (u.nombre || u.email) : (uid || '—')
  }

  const ZONE_STATUS_BADGE = {
    active: '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Activa</span>',
    cancelled: '<span style="background:#eee; color:#555; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Cancelada</span>'
  }
  const VOTER_STATUS_BADGE = {
    RESERVADO: '<span style="background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Reservado</span>',
    ASIGNADO: '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Asignado</span>',
    CANCELADO: '<span style="background:#eee; color:#999; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Liberado</span>'
  }
  // Ciclo operativo del Día D (on_the_way/picked_up/.../not_found) vive en
  // electionDayControl.status — no se duplica acá (ver diagnóstico: ya hay
  // 3 mecanismos de asignación sin sincronizar, no se agrega un 4to estado
  // paralelo). Esta pestaña solo lo LEE para mostrarlo.
  const ELECTION_DAY_STATUS_LABEL = {
    pending: 'Pendiente', on_the_way: '🚐 En camino', picked_up: '🚙 Recogido',
    arrived_polling_place: '📍 Llegó al local', arrived_table: '🪑 Llegó a mesa',
    voted: '✅ Votó', not_found: '❓ No encontrado', no_answer: '🔇 No responde',
    will_not_vote: '🚫 No irá', contacted: '📞 Contactado'
  }

  async function cargarZonasTab() {
    await cargarZonas()
    pintarListaZonas()
  }

  function zoneVotersActivosDe(zoneId) {
    return votersActivosZonas.filter(v => v.zoneId === zoneId)
  }

  async function renderTabZonas() {
    const body = document.getElementById('chofer-tab-body')
    body.innerHTML = '<div style="background:white; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px; padding:40px; text-align:center; color:#999;">Cargando zonas...</div>'
    await cargarZonasTab()
  }

  function pintarListaZonas() {
    const body = document.getElementById('chofer-tab-body')
    body.innerHTML = `
      <div style="background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; text-transform: uppercase;">
          🗺️ ZONAS DE BÚSQUEDA
        </h3>
        ${zonas.length === 0 ? `
          <div style="padding: 40px 20px; text-align: center; color: #999;">No hay zonas creadas todavía. ➕ Crear una nueva.</div>
        ` : `
          <div class="roster-card-grid">
            ${zonas.map((z, i) => {
              const chofer = choferes.find(c => c.id === z.driverId)
              const activos = zoneVotersActivosDe(z.id)
              const asignados = activos.filter(v => v.assignmentStatus === 'ASIGNADO').length
              const reservados = activos.filter(v => v.assignmentStatus === 'RESERVADO').length
              return `
              <div class="roster-card" data-idx="${i}">
                <div class="roster-card-name">${escapeHtml(z.name)} ${ZONE_STATUS_BADGE[z.status] || ''}</div>
                <div class="roster-card-fields">
                  <div class="roster-card-field"><strong>Punto central:</strong> ${z.latitude.toFixed(5)}, ${z.longitude.toFixed(5)}</div>
                  <div class="roster-card-field"><strong>Radio:</strong> ${z.radiusMeters} m${z.maxVoters ? ` · Máx. ${z.maxVoters} votantes` : ''}</div>
                  <div class="roster-card-field"><strong>Chofer:</strong> ${chofer ? escapeHtml(chofer.nombre) : '—'}</div>
                  <div class="roster-card-field"><strong>Votantes:</strong> <span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-weight:700;">${asignados} asignados</span>${reservados > 0 ? ` <span style="background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:3px; font-weight:700;">${reservados} reservados</span>` : ''}</div>
                  <div class="roster-card-field"><strong>Creada por:</strong> ${escapeHtml(nombreUsuario(z.createdBy))}</div>
                  <div class="roster-card-field"><strong>Fecha:</strong> ${fmtFecha(z.createdAt)}</div>
                </div>
                <div class="roster-card-actions">
                  <button class="btn-zona-mapa btn-compact" data-idx="${i}" style="background:#1976d2; color:white;">🗺️ Ver mapa</button>
                  <button class="btn-zona-votantes btn-compact" data-idx="${i}" style="background:#2196f3; color:white;">👥 Ver votantes</button>
                  ${z.status === 'active' && puede('driver_zones.assign') ? `<button class="btn-zona-chofer btn-compact" data-idx="${i}" style="background:#9c27b0; color:white;">🔄 Cambiar chofer</button>` : ''}
                  ${puede('driver_zones.export') ? `
                    <button class="btn-zona-wa btn-compact" data-idx="${i}" style="background:#25d366; color:white;">📲 WhatsApp</button>
                    <button class="btn-zona-excel btn-compact" data-idx="${i}" style="background:#217346; color:white;">📊 Excel</button>
                    <button class="btn-zona-pdf btn-compact" data-idx="${i}" style="background:#d32f2f; color:white;">📄 PDF</button>
                  ` : ''}
                  ${z.status === 'active' && puede('driver_zones.edit') ? `<button class="btn-zona-editar btn-compact" data-idx="${i}" style="background:#ff9800; color:white;">✏️ Editar</button>` : ''}
                  ${z.status === 'active' && puede('driver_zones.cancel') ? `<button class="btn-zona-cancelar btn-compact" data-idx="${i}" style="background:#d32f2f; color:white;">🗑️ Cancelar zona</button>` : ''}
                </div>
              </div>
            `
            }).join('')}
          </div>
        `}
      </div>
    `

    body.querySelectorAll('.btn-zona-mapa').forEach(btn => {
      btn.addEventListener('click', () => mostrarMapaZona(zonas[Number(btn.dataset.idx)]))
    })
    body.querySelectorAll('.btn-zona-votantes').forEach(btn => {
      btn.addEventListener('click', () => mostrarVotantesZona(zonas[Number(btn.dataset.idx)]))
    })
    body.querySelectorAll('.btn-zona-chofer').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalCambiarChofer(zonas[Number(btn.dataset.idx)]))
    })
    body.querySelectorAll('.btn-zona-wa').forEach(btn => {
      btn.addEventListener('click', () => enviarListadoZonaWhatsapp(zonas[Number(btn.dataset.idx)]))
    })
    body.querySelectorAll('.btn-zona-excel').forEach(btn => {
      btn.addEventListener('click', () => exportarZona(zonas[Number(btn.dataset.idx)], 'excel'))
    })
    body.querySelectorAll('.btn-zona-pdf').forEach(btn => {
      btn.addEventListener('click', () => exportarZona(zonas[Number(btn.dataset.idx)], 'pdf'))
    })
    body.querySelectorAll('.btn-zona-editar').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalEditarZona(zonas[Number(btn.dataset.idx)]))
    })
    body.querySelectorAll('.btn-zona-cancelar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const z = zonas[Number(btn.dataset.idx)]
        if (!confirm(`¿Cancelar la zona "${z.name}"? Se liberan todos sus votantes activos.`)) return
        try {
          await cancelZone(candidateId, z.id)
          await cargarZonasTab()
        } catch (err) {
          alert('Error al cancelar la zona: ' + err.message)
        }
      })
    })
  }

  // Junta driverZoneVoters + los datos del votante (savedRecords, ya en
  // todosLosRegistros) — mismo criterio de "no duplicar fuente de verdad"
  // que el resto del módulo: la ubicación/nombre/teléfono siguen viviendo
  // solo en savedRecords.
  function mergeVotanteZona(zv) {
    const r = todosLosRegistros.find(x => x.id === zv.id) || {}
    return { ...r, ...zv, voterId: zv.id }
  }

  async function mostrarMapaZona(zona) {
    try {
      const zvList = await getDriverZoneVoters(candidateId, zona.id)
      const votantes = zvList.map(mergeVotanteZona)

      const modal = document.createElement('div')
      modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
      modal.innerHTML = `
        <div style="background: white; border-radius: 8px; max-width: 800px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
          <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">🗺️ ${escapeHtml(zona.name)}</h2>
          <div id="mapa-ver-zona" style="height: 420px; border-radius: 6px; margin-bottom: 16px;"></div>
          <button id="btn-cerrar-mapa" style="width:100%; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">Cerrar</button>
        </div>
      `
      document.body.appendChild(modal)

      const mapCtrl = initReadOnlyZoneMap(document.getElementById('mapa-ver-zona'), {
        lat: zona.latitude,
        lng: zona.longitude,
        radiusMeters: zona.radiusMeters,
        voters: votantes
      })
      setTimeout(() => mapCtrl.invalidateSize(), 50)

      document.getElementById('btn-cerrar-mapa').addEventListener('click', () => { mapCtrl.destroy(); modal.remove() })
    } catch (err) {
      alert('Error al cargar el mapa de la zona: ' + err.message)
    }
  }

  async function mostrarVotantesZona(zona) {
    try {
      const [zvList, edcList] = await Promise.all([
        getDriverZoneVoters(candidateId, zona.id),
        getElectionDayControlByDriver(candidateId, zona.driverId)
      ])
      const edcByVoterId = Object.fromEntries(edcList.map(e => [e.id, e]))
      const votantes = zvList.map(mergeVotanteZona).sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0))
      const hayReservados = votantes.some(v => v.assignmentStatus === 'RESERVADO')

      const modal = document.createElement('div')
      modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
      modal.innerHTML = `
        <div style="background: white; border-radius: 8px; max-width: 800px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
          <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">👥 VOTANTES — ${escapeHtml(zona.name)}</h2>
          ${hayReservados && puede('driver_zones.assign') ? `
            <button id="btn-confirmar-reservas" style="background:#4caf50; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; margin-bottom:12px;">✅ Confirmar reservas pendientes</button>
          ` : ''}
          <div style="max-height: 460px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
            ${votantes.length === 0 ? `<div style="padding:30px; text-align:center; color:#999;">Esta zona todavía no tiene votantes.</div>` : votantes.map((v, i) => `
              <div style="padding: 8px 12px; border-bottom: 1px solid #eee; display: flex; align-items: flex-start; gap: 8px;">
                ${v.assignmentStatus !== 'CANCELADO' ? `<input type="checkbox" class="chk-liberar" data-id="${v.voterId}" style="cursor:pointer; margin-top:4px;">` : '<span style="width:14px;"></span>'}
                <div style="flex: 1; font-size: 0.85rem;">
                  <strong>${escapeHtml(v.nombre || '')}</strong> (CI: ${escapeHtml(v.cedula || '')}) ${VOTER_STATUS_BADGE[v.assignmentStatus] || ''}
                  <br><span style="color: #666;">📍 ${escapeHtml(v.direccion) || 'Sin dirección'} ${typeof v.distanceMeters === 'number' ? `· ${v.distanceMeters} m` : ''} | 📱 ${escapeHtml(v.telefono) || 'Sin teléfono'}</span>
                  <br><span style="color: #999; font-size:.75rem;">${edcByVoterId[v.voterId]?.status ? ELECTION_DAY_STATUS_LABEL[edcByVoterId[v.voterId].status] || edcByVoterId[v.voterId].status : 'Pendiente'} · asignado ${fmtFecha(v.assignedAt || v.reservedAt)} por ${escapeHtml(nombreUsuario(v.assignedBy || v.reservedBy))}</span>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="display:flex; gap:8px;">
            ${puede('driver_zones.cancel') ? `<button id="btn-liberar-seleccionados" style="flex:1; background:#d32f2f; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">🔓 Liberar seleccionados</button>` : ''}
            <button id="btn-cerrar-votantes" style="flex:1; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">Cerrar</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)

      const btnConfirmar = document.getElementById('btn-confirmar-reservas')
      if (btnConfirmar) {
        btnConfirmar.addEventListener('click', async () => {
          try {
            await confirmZoneAssignment(candidateId, zona.id)
            modal.remove()
            await cargarZonasTab()
            mostrarVotantesZona(zona)
          } catch (err) {
            alert('Error al confirmar: ' + err.message)
          }
        })
      }

      const btnLiberar = document.getElementById('btn-liberar-seleccionados')
      if (btnLiberar) {
        btnLiberar.addEventListener('click', async () => {
          const ids = Array.from(document.querySelectorAll('.chk-liberar:checked')).map(cb => cb.dataset.id)
          if (ids.length === 0) { alert('Seleccioná al menos un votante para liberar.'); return }
          if (!confirm(`¿Liberar ${ids.length} votante(s)? Vuelven a estar disponibles para otra zona.`)) return
          try {
            await releaseZoneVoters(candidateId, zona.id, ids)
            modal.remove()
            await cargarZonasTab()
            mostrarVotantesZona(zona)
          } catch (err) {
            alert('Error al liberar: ' + err.message)
          }
        })
      }

      document.getElementById('btn-cerrar-votantes').addEventListener('click', () => modal.remove())
    } catch (err) {
      alert('Error al cargar los votantes de la zona: ' + err.message)
    }
  }

  function mostrarModalCambiarChofer(zona) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 420px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.4rem; text-transform: uppercase; color: #9c27b0;">🔄 CAMBIAR CHOFER — ${escapeHtml(zona.name)}</h2>
        <label style="font-weight:700; display:block; margin-bottom:4px;">Nuevo chofer responsable:</label>
        <select id="sel-nuevo-chofer" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:16px;">
          ${choferes.filter(c => c.id && c.id !== zona.driverId).map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('')}
        </select>
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar-cambio" style="flex:1; background:#9c27b0; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">✅ Confirmar</button>
          <button id="btn-cancelar-cambio" style="flex:1; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">❌ Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    document.getElementById('btn-confirmar-cambio').addEventListener('click', async () => {
      const nuevoChoferId = document.getElementById('sel-nuevo-chofer').value
      if (!nuevoChoferId) { alert('Elegí un chofer'); return }
      try {
        await changeZoneDriver(candidateId, zona.id, nuevoChoferId)
        modal.remove()
        await cargarZonasTab()
      } catch (err) {
        alert('Error al cambiar el chofer: ' + err.message)
      }
    })
    document.getElementById('btn-cancelar-cambio').addEventListener('click', () => modal.remove())
  }

  function mostrarModalEditarZona(zona) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'
    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 420px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.4rem; text-transform: uppercase; color: #ff9800;">✏️ EDITAR ZONA</h2>
        <label style="font-weight:700; display:block; margin-bottom:4px;">Nombre:</label>
        <input id="inp-editar-nombre" value="${escapeHtml(zona.name)}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:12px;">
        <label style="font-weight:700; display:block; margin-bottom:4px;">Máximo de votantes:</label>
        <input id="inp-editar-max" type="number" min="1" value="${zona.maxVoters || ''}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:16px;">
        <p style="font-size:.78rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 16px;">💡 Para mover el punto central o cambiar el radio, cancelá esta zona y creá una nueva — evita dejar votantes ya asignados fuera del radio real.</p>
        <div style="display:flex; gap:8px;">
          <button id="btn-guardar-edicion" style="flex:1; background:#ff9800; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">💾 Guardar</button>
          <button id="btn-cancelar-edicion" style="flex:1; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">❌ Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    document.getElementById('btn-guardar-edicion').addEventListener('click', async () => {
      const nombre = document.getElementById('inp-editar-nombre').value.trim()
      const max = Number(document.getElementById('inp-editar-max').value) || null
      if (!nombre) { alert('El nombre es obligatorio'); return }
      try {
        await updateDriverZoneMeta(candidateId, zona.id, { name: nombre, maxVoters: max })
        modal.remove()
        await cargarZonasTab()
      } catch (err) {
        alert('Error al guardar: ' + err.message)
      }
    })
    document.getElementById('btn-cancelar-edicion').addEventListener('click', () => modal.remove())
  }

  function enviarListadoZonaWhatsapp(zona) {
    const chofer = choferes.find(c => c.id === zona.driverId)
    if (!chofer) { alert('No se encontró el chofer de esta zona'); return }
    const tel = (chofer.celular || chofer.telefono || '').replace(/\D/g, '')
    if (!tel) { alert('Este chofer no tiene celular cargado'); return }
    const telLimpio = '595' + tel.replace(/^0/, '')
    const asignados = zoneVotersActivosDe(zona.id).filter(v => v.assignmentStatus === 'ASIGNADO').map(mergeVotanteZona)
    if (asignados.length === 0) { alert('Esta zona todavía no tiene votantes asignados (confirmados).'); return }
    const lineas = asignados.map((r, i) =>
      `${i + 1}. ${r.nombre} — 📱 ${r.telefono || 'sin teléfono'} — ${r.direccion || 'sin dirección'}${r.googleMapsUrl ? ' — ' + r.googleMapsUrl : ''} — ${r.local || 'sin local'}, mesa ${r.mesa || '—'}, orden ${r.orden || '—'}${r.nota ? ' — Obs: ' + r.nota : ''}`
    )
    const msg = encodeURIComponent(
      `Hola ${chofer.nombre}, este es tu listado de la zona "${zona.name}" (${asignados.length} votantes):\n\n${lineas.join('\n')}`
    )
    window.open(`https://wa.me/${telLimpio}?text=${msg}`, '_blank')
  }

  async function exportarZona(zona, formato) {
    try {
      const zvList = await getDriverZoneVoters(candidateId, zona.id)
      const votantes = zvList.map(mergeVotanteZona).filter(v => v.assignmentStatus !== 'CANCELADO')
      const chofer = choferes.find(c => c.id === zona.driverId)
      const rows = votantes.map(v => ({
        Nombre: v.nombre || '', Cedula: v.cedula || '', Telefono: v.telefono || '',
        Direccion: v.direccion || '', GoogleMaps: v.googleMapsUrl || '',
        Local: v.local || '', Mesa: v.mesa || '', Orden: v.orden || '',
        DistanciaMetros: v.distanceMeters ?? '', Estado: v.assignmentStatus,
        Chofer: chofer ? chofer.nombre : ''
      }))
      if (rows.length === 0) { alert('Esta zona no tiene votantes para exportar.'); return }
      const filename = `zona_${zona.name.replace(/\W+/g, '_')}`
      if (formato === 'excel') exportGenericToExcel(rows, `${filename}.xlsx`, 'Zona')
      else await exportGenericToPdf(rows, `${filename}.pdf`, `Zona: ${zona.name}`)
    } catch (err) {
      alert('Error al exportar: ' + err.message)
    }
  }

  function mostrarModalCrearZona() {
    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

    let punto = null
    let radioActual = 500
    let votantesPreview = []
    let mapCtrl = null

    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 920px; width: 100%; max-height: 92vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">➕ NUEVA ZONA DE BÚSQUEDA</h2>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:4px;">Nombre de la zona:</label>
            <input id="inp-zona-nombre" placeholder="Ej: Barrio San Pablo – Grupo 1" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:12px;">

            <label style="font-weight:700; display:block; margin-bottom:4px;">Radio:</label>
            <div id="chips-radio" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;"></div>

            <label style="font-weight:700; display:block; margin-bottom:4px;">Máximo de votantes:</label>
            <input id="inp-zona-max" type="number" min="1" value="25" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:12px;">

            <label style="font-weight:700; display:block; margin-bottom:4px;">Chofer responsable:</label>
            <select id="sel-zona-chofer" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:12px;">
              <option value="">-- Elegí un chofer --</option>
              ${choferes.filter(c => c.id).map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('')}
            </select>

            <label style="font-weight:700; display:block; margin-bottom:4px;">Ubicar punto central:</label>
            <button id="btn-mi-ubicacion" type="button" style="width:100%; background:#1976d2; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700; margin-bottom:8px;">📍 Usar mi ubicación</button>
            <input id="inp-zona-maps-link" placeholder="Pegar link de Google Maps" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; margin-bottom:8px;">
            <div style="display:flex; gap:6px; margin-bottom:8px;">
              <input id="inp-zona-direccion" placeholder="Buscar dirección" style="flex:1; padding:10px; border:1px solid #ddd; border-radius:4px;">
              <button id="btn-buscar-direccion" type="button" style="background:#1976d2; color:white; border:none; padding:0 14px; border-radius:4px; cursor:pointer;">🔎</button>
            </div>
            <div id="zona-punto-estado" style="font-size:.8rem; color:#666; margin-bottom:8px;">Marcá un punto en el mapa, usá tu ubicación, pegá un link o buscá una dirección.</div>
          </div>
          <div>
            <div id="mapa-crear-zona" style="height:320px; border-radius:6px; border:1px solid #ddd;"></div>
          </div>
        </div>

        <button id="btn-buscar-votantes-radio" type="button" style="width:100%; background:#2196f3; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700; margin:16px 0;">🔍 Buscar votantes dentro del radio</button>
        <div id="zona-preview-votantes"></div>

        <div style="display:flex; gap:8px; margin-top:16px;">
          <button id="btn-guardar-zona" style="flex:1; background:#4caf50; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">✅ GUARDAR Y CONFIRMAR ZONA</button>
          <button id="btn-cancelar-zona" style="flex:1; background:#999; color:white; border:none; padding:12px; border-radius:4px; cursor:pointer; font-weight:700;">❌ CANCELAR</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    function actualizarEstadoPunto(extra) {
      const el = document.getElementById('zona-punto-estado')
      el.textContent = punto
        ? `📍 ${punto.latitude.toFixed(5)}, ${punto.longitude.toFixed(5)}${extra ? ' — ' + extra : ''}`
        : 'Marcá un punto en el mapa, usá tu ubicación, pegá un link o buscá una dirección.'
    }

    mapCtrl = initZoneMap(document.getElementById('mapa-crear-zona'), {
      radiusMeters: radioActual,
      onPointSelected: (lat, lng) => { punto = { latitude: lat, longitude: lng }; actualizarEstadoPunto() }
    })
    // El modal recién se montó — el contenedor a veces todavía mide 0 en el
    // primer paint y Leaflet queda con los tiles mal recortados si no se le
    // avisa que su tamaño real ya está disponible.
    setTimeout(() => mapCtrl.invalidateSize(), 60)

    const RADIOS_PREDEFINIDOS = [250, 500, 1000, 2000]
    function pintarChipsRadio() {
      const box = document.getElementById('chips-radio')
      box.innerHTML = RADIOS_PREDEFINIDOS.map(m => `
        <button type="button" class="chip-radio" data-m="${m}" style="padding:6px 12px; border-radius:14px; border:1px solid ${radioActual === m ? '#1976d2' : '#ddd'}; background:${radioActual === m ? '#1976d2' : 'white'}; color:${radioActual === m ? 'white' : '#333'}; cursor:pointer; font-size:.8rem; font-weight:700;">${m >= 1000 ? (m / 1000) + ' km' : m + ' m'}</button>
      `).join('') + `
        <input id="inp-radio-custom" type="number" min="50" placeholder="Personalizado (m)" style="width:150px; padding:6px 10px; border:1px solid #ddd; border-radius:14px; font-size:.8rem;">
      `
      box.querySelectorAll('.chip-radio').forEach(btn => {
        btn.addEventListener('click', () => {
          radioActual = Number(btn.dataset.m)
          mapCtrl.setRadius(radioActual)
          pintarChipsRadio()
        })
      })
      document.getElementById('inp-radio-custom').addEventListener('change', (e) => {
        const v = Number(e.target.value)
        if (v > 0) {
          radioActual = v
          mapCtrl.setRadius(radioActual)
          pintarChipsRadio()
        }
      })
    }
    pintarChipsRadio()

    document.getElementById('btn-mi-ubicacion').addEventListener('click', () => {
      if (!navigator.geolocation) { actualizarEstadoPunto('este navegador no soporta geolocalización'); return }
      actualizarEstadoPunto('obteniendo ubicación...')
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          punto = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          mapCtrl.setCenter(punto.latitude, punto.longitude, { silent: true })
          actualizarEstadoPunto()
        },
        (err) => actualizarEstadoPunto('no se pudo obtener la ubicación (' + err.message + ')'),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })

    document.getElementById('inp-zona-maps-link').addEventListener('input', (e) => {
      const coords = extractLatLngFromMapsUrl(e.target.value)
      if (coords) {
        punto = coords
        mapCtrl.setCenter(punto.latitude, punto.longitude, { silent: true })
        actualizarEstadoPunto('desde el link pegado')
      }
    })

    document.getElementById('btn-buscar-direccion').addEventListener('click', async () => {
      const direccion = document.getElementById('inp-zona-direccion').value.trim()
      if (!direccion) return
      actualizarEstadoPunto('buscando dirección...')
      try {
        const resultado = await geocodeAddress(direccion)
        if (!resultado) { actualizarEstadoPunto('no se encontró esa dirección — marcá el punto manualmente en el mapa'); return }
        punto = { latitude: resultado.latitude, longitude: resultado.longitude }
        mapCtrl.setCenter(punto.latitude, punto.longitude, { silent: true })
        actualizarEstadoPunto('desde la búsqueda de dirección')
      } catch (err) {
        actualizarEstadoPunto('error buscando la dirección — marcá el punto manualmente en el mapa')
      }
    })

    function pintarPreviewVotantes() {
      const box = document.getElementById('zona-preview-votantes')
      if (votantesPreview.length === 0) {
        box.innerHTML = '<div style="padding:16px; text-align:center; color:#999; border:1px solid #eee; border-radius:4px;">Sin votantes dentro del radio (o ya buscaste y no hay resultados).</div>'
        return
      }
      box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong>${votantesPreview.length} votante${votantesPreview.length === 1 ? '' : 's'} encontrado${votantesPreview.length === 1 ? '' : 's'} (ordenados por cercanía)</strong>
          <label style="font-size:.8rem; cursor:pointer;"><input type="checkbox" id="chk-seleccionar-todos" checked> Seleccionar todos</label>
        </div>
        <div style="max-height:280px; overflow-y:auto; border:1px solid #ddd; border-radius:4px;">
          ${votantesPreview.map(v => `
            <div style="padding:8px 12px; border-bottom:1px solid #eee; display:flex; align-items:flex-start; gap:8px;">
              <input type="checkbox" class="chk-preview-votante" data-id="${v.voterId}" checked style="cursor:pointer; margin-top:4px;">
              <div style="flex:1; font-size:.85rem;">
                <strong>${escapeHtml(v.nombre)}</strong> (CI: ${escapeHtml(v.cedula)}) — <span style="color:#1976d2; font-weight:700;">${v.distanceMeters} m</span>
                <br><span style="color:#666;">📍 ${escapeHtml(v.direccion) || 'Sin dirección'} | 📱 ${escapeHtml(v.telefono) || 'Sin teléfono'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `
      document.getElementById('chk-seleccionar-todos').addEventListener('change', (e) => {
        document.querySelectorAll('.chk-preview-votante').forEach(cb => { cb.checked = e.target.checked })
      })
    }

    document.getElementById('btn-buscar-votantes-radio').addEventListener('click', async () => {
      if (!punto) { alert('Primero marcá el punto central de la zona.'); return }
      const maxVoters = Number(document.getElementById('inp-zona-max').value) || 25
      try {
        votantesPreview = await previewVotersInZone(candidateId, {
          latitude: punto.latitude, longitude: punto.longitude, radiusMeters: radioActual, maxVoters
        })
        pintarPreviewVotantes()
      } catch (err) {
        alert('Error al buscar votantes en el radio: ' + err.message)
      }
    })

    document.getElementById('btn-guardar-zona').addEventListener('click', async () => {
      const name = document.getElementById('inp-zona-nombre').value.trim()
      const driverId = document.getElementById('sel-zona-chofer').value
      const maxVoters = Number(document.getElementById('inp-zona-max').value) || null
      const voterIds = Array.from(document.querySelectorAll('.chk-preview-votante:checked')).map(cb => cb.dataset.id)

      if (!name) { alert('Ponele un nombre a la zona.'); return }
      if (!punto) { alert('Marcá el punto central de la zona.'); return }
      if (!driverId) { alert('Elegí un chofer responsable.'); return }
      if (voterIds.length === 0) { alert('Buscá votantes en el radio y seleccioná al menos uno.'); return }

      const btnGuardar = document.getElementById('btn-guardar-zona')
      btnGuardar.disabled = true
      btnGuardar.textContent = 'Guardando...'
      try {
        const creada = await createZoneAndReserve(candidateId, {
          name, latitude: punto.latitude, longitude: punto.longitude,
          radiusMeters: radioActual, maxVoters, driverId, voterIds
        })
        if (creada.lost.length > 0) {
          alert(`⚠️ ${creada.lost.length} votante(s) ya habían sido tomados por otra zona en simultáneo y no se pudieron reservar. El resto (${creada.reserved.length}) sí.`)
        }
        if (creada.reserved.length > 0) {
          await confirmZoneAssignment(candidateId, creada.zoneId)
        }
        mapCtrl.destroy()
        modal.remove()
        activeTab = 'zonas'
        render()
      } catch (err) {
        alert('Error al guardar la zona: ' + err.message)
        btnGuardar.disabled = false
        btnGuardar.textContent = '✅ GUARDAR Y CONFIRMAR ZONA'
      }
    })

    document.getElementById('btn-cancelar-zona').addEventListener('click', () => { mapCtrl.destroy(); modal.remove() })
  }

  cargarChoferes()
}
