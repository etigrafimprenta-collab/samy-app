/**
 * MÓDULO: MESARIOS (candidato-scoped) — roster de CI/teléfono/proponente +
 * fechas de capacitación y presencia. Se alimenta de dos orígenes:
 * 1) manual (esta colección, `mesarios`) — alguien cargado directo acá.
 * 2) automático — savedRecords con wantsToBeMesario=true (marcado en
 *    "Buscar votante"), que aparece acá sin que nadie lo cargue a mano.
 * Al editar una fila "automática" se crea el doc manual (linkeado por
 * savedRecordId) para persistir proponente/capacitaciones/presencia sin
 * duplicar la fila en el listado.
 */
import {
  getMesarios,
  createMesario,
  updateMesario,
  deleteMesario,
  getAllRecords,
  updateRecord,
  getRecordByCedula,
  searchVoterByCedula
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { debounce } from '../lib/debounce.js'

const PAGO_CONCEPTOS = ['Capacitación', 'Día D', 'Movilidad', 'Otro']

// Puras (solo dependen de `fila`) — exportadas para que Reportes > Mesarios
// calcule capacitación/montos exactamente igual que este módulo, sin
// reimplementar la lógica en un segundo lugar.
export function estadoPresencia(fila) {
  const caps = fila.capacitaciones || []
  if (caps.length === 0) return 'sin_capacitacion'
  return caps.some(c => c.asistio) ? 'asistio' : 'no_asistio'
}

// "Consolidado" = todos los pagos sumados; "Día D" se muestra aparte
// porque es el concepto que más se pregunta en el cierre de campaña.
export function montoConsolidado(fila) {
  return (fila.pagos || []).reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
}
export function montoDiaD(fila) {
  return (fila.pagos || []).filter(p => p.concepto === 'Día D').reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
}

export function renderMesarioCandidate(container, candidateId) {
  let filas = []
  // Qué locales quedan desplegados en la vista agrupada — sobrevive a los
  // re-renders (editar/eliminar) dentro de esta misma visita al módulo.
  const localesExpandidos = new Set()

  function normalizarTelefonoPY(tel) {
    if (!tel) return ''
    const digits = String(tel).replace(/\D/g, '')
    return digits ? '595' + digits.replace(/^0/, '') : ''
  }

  async function cargarDatos() {
    try {
      const [mesarios, records] = await Promise.all([
        getMesarios(candidateId),
        getAllRecords(candidateId)
      ])
      const linkedIds = new Set(mesarios.map(m => m.savedRecordId).filter(Boolean))
      const filasManual = mesarios.map(m => ({ ...m, origen: m.savedRecordId ? 'auto+manual' : 'manual' }))
      const filasAuto = records
        .filter(r => r.wantsToBeMesario && !linkedIds.has(r.id))
        .map(r => ({
          id: null,
          savedRecordId: r.id,
          nombre: r.nombre,
          ci: r.cedula,
          telefono: r.telefono,
          proponente: '',
          local: r.local,
          mesa: r.mesa,
          capacitaciones: [],
          pagos: [],
          origen: 'auto'
        }))
      filas = [...filasManual, ...filasAuto].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      render()
    } catch (err) {
      alert('Error al cargar mesarios: ' + err.message)
    }
  }

  function statCard(label, value) {
    return `<div class="stat-card" style="--accent:#1976d2;">
      <div class="stat-num">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`
  }

  function render() {
    const total = filas.length
    const conCapacitacion = filas.filter(f => (f.capacitaciones || []).length > 0).length
    const asistieron = filas.filter(f => estadoPresencia(f) === 'asistio').length
    const totalConsolidado = filas.reduce((sum, f) => sum + montoConsolidado(f), 0)
    const totalDiaD = filas.reduce((sum, f) => sum + montoDiaD(f), 0)

    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">🪑 MESARIOS</h2>
        <button id="btn-nuevo-mesario" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 700;">➕ NUEVO MESARIO</button>
      </div>
      <div style="background:white; border:1px solid #ddd; border-top:none; padding:20px;">
        <div class="stats-grid">
          ${statCard('Mesarios', total)}
          ${statCard('Con capacitación cargada', conCapacitacion)}
          ${statCard('Asistieron a capacitación', asistieron)}
          ${statCard('Monto consolidado', 'Gs. ' + totalConsolidado.toLocaleString('es-PY'))}
          ${statCard('Monto Día D', 'Gs. ' + totalDiaD.toLocaleString('es-PY'))}
        </div>

        <p style="font-size:.8rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:0 0 10px;">💡 Si buscás por nombre, utilizá el primer apellido.</p>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:16px;">
          <div class="filter-input-wrap"><input id="input-buscar-mesario" class="filter-input" placeholder="Buscar por CI, nombre o proponente..."></div>
          <select id="sel-local-mesario" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todos los locales</option>
          </select>
          <select id="sel-mesa-mesario" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Todas las mesas</option>
          </select>
          <select id="sel-presencia-mesario" style="padding:10px; border:1px solid #ddd; border-radius:4px;">
            <option value="">Presencia: todas</option>
            <option value="asistio">Asistió a alguna capacitación</option>
            <option value="no_asistio">No asistió a ninguna</option>
            <option value="sin_capacitacion">Sin capacitación cargada</option>
          </select>
        </div>

        <div id="tabla-mesarios"></div>
      </div>
    `

    document.getElementById('btn-nuevo-mesario').addEventListener('click', () => mostrarModalMesario())

    const locales = [...new Set(filas.map(f => f.local).filter(Boolean))].sort()
    const mesas = [...new Set(filas.map(f => f.mesa).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    const selLocal = document.getElementById('sel-local-mesario')
    const selMesa = document.getElementById('sel-mesa-mesario')
    selLocal.insertAdjacentHTML('beforeend', locales.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join(''))
    selMesa.insertAdjacentHTML('beforeend', mesas.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join(''))

    const pintar = () => pintarTabla()
    document.getElementById('input-buscar-mesario').addEventListener('input', debounce(pintar, 250))
    selLocal.addEventListener('change', pintar)
    selMesa.addEventListener('change', pintar)
    document.getElementById('sel-presencia-mesario').addEventListener('change', pintar)

    pintarTabla()
  }

  function filaTabla(f, idxGlobal) {
    const telLimpio = normalizarTelefonoPY(f.telefono)
    const caps = f.capacitaciones || []
    const origenBadge = f.origen === 'manual'
      ? '<span style="background:#eee; color:#555; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Manual</span>'
      : f.origen === 'auto'
        ? '<span style="background:#e3f2fd; color:#1976d2; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto (Buscar votante)</span>'
        : '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:3px; font-size:.72rem; font-weight:700;">Auto + editado</span>'
    return `
      <div class="roster-card" data-idx="${idxGlobal}">
        <div class="roster-card-name">${escapeHtml(f.nombre) || '—'}</div>
        <div class="roster-card-fields">
          <div class="roster-card-field"><strong>CI:</strong> ${escapeHtml(f.ci) || '—'}</div>
          <div class="roster-card-field"><strong>Teléfono:</strong> ${escapeHtml(f.telefono) || '—'} ${telLimpio ? `<a href="https://wa.me/${telLimpio}" target="_blank" rel="noopener" style="text-decoration:none; background:#25d366; color:white; padding:2px 8px; border-radius:4px; font-size:.72rem; font-weight:600;">💬</a>` : ''}</div>
          <div class="roster-card-field"><strong>Proponente:</strong> ${escapeHtml(f.proponente) || '—'}</div>
          <div class="roster-card-field"><strong>Local / Mesa:</strong> ${escapeHtml(f.local) || '—'} · ${escapeHtml(f.mesa) || '—'}</div>
          <div class="roster-card-field"><strong>Capacitaciones:</strong> ${caps.length === 0 ? 'Sin cargar' : caps.map(c => `${c.asistio ? '✅' : '❌'} ${escapeHtml(c.fecha)}`).join(', ')}</div>
          <div class="roster-card-field"><strong>Monto:</strong> Gs. ${montoConsolidado(f).toLocaleString('es-PY')}${montoDiaD(f) > 0 ? ` · Día D: Gs. ${montoDiaD(f).toLocaleString('es-PY')}` : ''}</div>
          <div class="roster-card-field">${origenBadge}</div>
        </div>
        <div class="roster-card-actions">
          <button class="btn-editar-mesario btn-compact" data-idx="${idxGlobal}" style="background:#ff9800; color:white;">✏️ Editar</button>
          <button class="btn-eliminar-mesario btn-compact" data-idx="${idxGlobal}" style="background:#d32f2f; color:white;">🗑️ Eliminar</button>
        </div>
      </div>`
  }

  function bindFilaHandlers(filtradas) {
    const tablaEl = document.getElementById('tabla-mesarios')
    tablaEl.querySelectorAll('.btn-editar-mesario').forEach(btn => {
      btn.addEventListener('click', () => mostrarModalMesario(filtradas[Number(btn.dataset.idx)]))
    })
    tablaEl.querySelectorAll('.btn-eliminar-mesario').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fila = filtradas[Number(btn.dataset.idx)]
        const avisoCheck = fila.savedRecordId ? '\nEsto también desmarca la opción "Quiere ser mesario" en su registro de Buscar votante.' : ''
        if (!confirm(`¿Quitar a ${fila.nombre} del listado de mesarios?${avisoCheck}`)) return
        try {
          if (fila.id) await deleteMesario(candidateId, fila.id)
          if (fila.savedRecordId) await updateRecord(candidateId, fila.savedRecordId, { wantsToBeMesario: false })
          cargarDatos()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    })
  }

  function pintarTabla() {
    const termino = document.getElementById('input-buscar-mesario').value.trim().toLowerCase()
    const local = document.getElementById('sel-local-mesario').value
    const mesa = document.getElementById('sel-mesa-mesario').value
    const presencia = document.getElementById('sel-presencia-mesario').value

    const filtradas = filas.filter(f => {
      if (termino && !(String(f.ci || '').toLowerCase().includes(termino) || String(f.nombre || '').toLowerCase().includes(termino) || String(f.proponente || '').toLowerCase().includes(termino))) return false
      if (local && f.local !== local) return false
      if (mesa && String(f.mesa) !== mesa) return false
      if (presencia && estadoPresencia(f) !== presencia) return false
      return true
    })

    const tablaEl = document.getElementById('tabla-mesarios')
    const hayFiltro = termino || local || mesa || presencia

    if (filtradas.length === 0) {
      tablaEl.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">Sin resultados.</div>`
      return
    }

    // Buscando por texto: lista plana (más fácil de escanear el resultado
    // puntual). Sin texto: agrupado por local electoral y comprimido —
    // rolesEquipoExpandidos-style, el estado abierto/cerrado se recuerda
    // en localesExpandidos mientras dura esta visita al módulo.
    if (termino) {
      tablaEl.innerHTML = `
        ${hayFiltro ? `<div style="background:#e3f2fd; border-left:4px solid #1976d2; padding:10px; border-radius:4px; margin-bottom:12px; font-size:.85rem;"><strong>${filtradas.length}</strong> de ${filas.length} mesarios</div>` : ''}
        <div class="roster-card-grid">${filtradas.map((f, i) => filaTabla(f, i)).join('')}</div>
      `
      bindFilaHandlers(filtradas)
      return
    }

    const porLocal = {}
    filtradas.forEach(f => {
      const key = f.local || 'Sin local asignado'
      if (!porLocal[key]) porLocal[key] = []
      porLocal[key].push(f)
    })
    const localesOrdenados = Object.keys(porLocal).sort()

    tablaEl.innerHTML = `
      ${hayFiltro ? `<div style="background:#e3f2fd; border-left:4px solid #1976d2; padding:10px; border-radius:4px; margin-bottom:12px; font-size:.85rem;"><strong>${filtradas.length}</strong> de ${filas.length} mesarios</div>` : ''}
      ${localesOrdenados.map(local => {
        const filasDelLocal = porLocal[local]
        const abierto = localesExpandidos.has(local)
        const totalLocal = filasDelLocal.reduce((sum, f) => sum + montoConsolidado(f), 0)
        return `
          <div style="border:1px solid #eee; border-radius:6px; margin-bottom:10px; overflow:hidden;">
            <button class="btn-toggle-local-mesario" data-local="${escapeHtml(local)}" style="width:100%; text-align:left; background:#1976d2; color:white; border:none; padding:12px 14px; cursor:pointer; font-weight:700; display:flex; justify-content:space-between; align-items:center; font-size:.9rem;">
              <span>📍 ${escapeHtml(local)} (${filasDelLocal.length})</span>
              <span>Gs. ${totalLocal.toLocaleString('es-PY')} ${abierto ? '▲' : '▼'}</span>
            </button>
            ${abierto ? `
              <div style="padding:10px;">
                <div class="roster-card-grid">${filasDelLocal.map(f => filaTabla(f, filtradas.indexOf(f))).join('')}</div>
              </div>
            ` : ''}
          </div>
        `
      }).join('')}
    `

    tablaEl.querySelectorAll('.btn-toggle-local-mesario').forEach(btn => {
      btn.addEventListener('click', () => {
        const local = btn.dataset.local
        if (localesExpandidos.has(local)) localesExpandidos.delete(local)
        else localesExpandidos.add(local)
        pintarTabla()
      })
    })
    bindFilaHandlers(filtradas)
  }

  function mostrarModalMesario(fila) {
    let capsState = (fila?.capacitaciones || []).map(c => ({ ...c }))
    let pagosState = (fila?.pagos || []).map(p => ({ ...p }))

    const modal = document.createElement('div')
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; overflow-y: auto; padding: 20px;'

    modal.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); padding: 24px;">
        <h2 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase; color: #1976d2;">${fila ? '✏️ EDITAR MESARIO' : '➕ NUEVO MESARIO'}</h2>
        <div style="display: grid; gap: 12px;">
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">CI:</label>
            <input id="inp-ci" type="text" value="${escapeHtml(fila?.ci || '')}" placeholder="1234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            ${!fila ? '<div id="autocompletar-mesario-msg" style="font-size:.78rem; color:#666; margin-top:4px;"></div>' : ''}
          </div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre:</label>
            <input id="inp-nombre" type="text" value="${escapeHtml(fila?.nombre || '')}" placeholder="Ej: Juan Pérez" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Teléfono:</label>
            <input id="inp-telefono" type="text" value="${escapeHtml(fila?.telefono || '')}" placeholder="981234567" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Proponente:</label>
            <input id="inp-proponente" type="text" value="${escapeHtml(fila?.proponente || '')}" placeholder="Quién lo propuso" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Local:</label>
              <input id="inp-local" type="text" value="${escapeHtml(fila?.local || '')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
            <div><label style="font-weight: 700; display: block; margin-bottom: 4px;">Mesa:</label>
              <input id="inp-mesa" type="text" value="${escapeHtml(fila?.mesa || '')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div>
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Capacitaciones:</label>
            <div id="lista-capacitaciones"></div>
            <button id="btn-agregar-capacitacion" type="button" style="margin-top:6px; background:#e3f2fd; color:#1976d2; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">➕ Agregar capacitación</button>
          </div>

          <div>
            <label style="font-weight: 700; display: block; margin-bottom: 4px;">Pagos (monto entregado por concepto):</label>
            <div id="lista-pagos"></div>
            <button id="btn-agregar-pago" type="button" style="margin-top:6px; background:#e8f5e9; color:#2e7d32; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:.8rem;">➕ Agregar pago</button>
            <div id="total-pagos" style="margin-top:8px; font-size:.85rem; font-weight:700;"></div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button id="btn-guardar" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ GUARDAR</button>
            <button id="btn-cancelar" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    // Autocompletar por CI, solo al cargar un mesario nuevo (no al editar
    // uno que ya tiene sus datos propios): prioridad Registros
    // (savedRecords, trae también teléfono/local/mesa reales), y si no
    // está ahí cae al padrón compartido (solo nombre/local/mesa, no tiene
    // teléfono). Proponente queda siempre manual — ninguna de las dos
    // fuentes tiene ese dato.
    if (!fila) {
      modal.querySelector('#inp-ci').addEventListener('blur', async () => {
        const ci = modal.querySelector('#inp-ci').value.trim()
        const msgEl = modal.querySelector('#autocompletar-mesario-msg')
        if (!ci) { msgEl.textContent = ''; return }

        const nombreInput = modal.querySelector('#inp-nombre')
        const telefonoInput = modal.querySelector('#inp-telefono')
        const localInput = modal.querySelector('#inp-local')
        const mesaInput = modal.querySelector('#inp-mesa')
        msgEl.textContent = '🔎 Buscando datos de esta CI...'
        try {
          const registro = await getRecordByCedula(candidateId, ci)
          if (registro) {
            if (!nombreInput.value.trim()) nombreInput.value = registro.nombre || ''
            if (!telefonoInput.value.trim()) telefonoInput.value = registro.telefono || ''
            if (!localInput.value.trim()) localInput.value = registro.local || ''
            if (!mesaInput.value.trim()) mesaInput.value = registro.mesa || ''
            msgEl.textContent = '✅ Datos completados desde Registros.'
            return
          }
          const enPadron = await searchVoterByCedula(ci)
          if (enPadron.length > 0) {
            const v = enPadron[0]
            if (!nombreInput.value.trim()) nombreInput.value = v.nombre || ''
            if (!localInput.value.trim()) localInput.value = v.local || ''
            if (!mesaInput.value.trim()) mesaInput.value = v.mesa || ''
            msgEl.textContent = '✅ Datos completados desde el padrón (sin teléfono: el padrón no lo tiene).'
            return
          }
          msgEl.textContent = 'Sin coincidencias en Registros ni en el padrón.'
        } catch (err) {
          console.error('Error autocompletando por CI:', err)
          msgEl.textContent = '❌ ' + err.message
        }
      })
    }

    function pintarCapacitaciones() {
      const box = modal.querySelector('#lista-capacitaciones')
      box.innerHTML = capsState.length === 0 ? '<div style="color:#999; font-size:.8rem; padding:6px 0;">Todavía no hay capacitaciones cargadas.</div>' : capsState.map((c, i) => `
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
          <input type="date" class="inp-cap-fecha" data-idx="${i}" value="${escapeHtml(c.fecha || '')}" style="flex:1; padding:8px; border:1px solid #ddd; border-radius:4px;">
          <label style="display:flex; align-items:center; gap:4px; font-size:.8rem;">
            <input type="checkbox" class="chk-cap-asistio" data-idx="${i}" ${c.asistio ? 'checked' : ''}> Asistió
          </label>
          <button type="button" class="btn-quitar-cap" data-idx="${i}" style="background:#d32f2f; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:.75rem;">✕</button>
        </div>
      `).join('')

      box.querySelectorAll('.inp-cap-fecha').forEach(inp => {
        inp.addEventListener('change', () => { capsState[Number(inp.dataset.idx)].fecha = inp.value })
      })
      box.querySelectorAll('.chk-cap-asistio').forEach(chk => {
        chk.addEventListener('change', () => { capsState[Number(chk.dataset.idx)].asistio = chk.checked })
      })
      box.querySelectorAll('.btn-quitar-cap').forEach(btn => {
        btn.addEventListener('click', () => {
          capsState.splice(Number(btn.dataset.idx), 1)
          pintarCapacitaciones()
        })
      })
    }
    pintarCapacitaciones()

    modal.querySelector('#btn-agregar-capacitacion').addEventListener('click', () => {
      capsState.push({ fecha: '', asistio: false })
      pintarCapacitaciones()
    })

    function pintarPagos() {
      const box = modal.querySelector('#lista-pagos')
      box.innerHTML = pagosState.length === 0 ? '<div style="color:#999; font-size:.8rem; padding:6px 0;">Todavía no hay pagos cargados.</div>' : pagosState.map((p, i) => `
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
          <select class="sel-pago-concepto" data-idx="${i}" style="flex:1; padding:8px; border:1px solid #ddd; border-radius:4px;">
            ${PAGO_CONCEPTOS.map(c => `<option value="${escapeHtml(c)}" ${p.concepto === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <input type="number" min="0" step="1000" class="inp-pago-monto" data-idx="${i}" value="${Number(p.monto) || 0}" placeholder="Monto Gs." style="flex:1; padding:8px; border:1px solid #ddd; border-radius:4px;">
          <button type="button" class="btn-quitar-pago" data-idx="${i}" style="background:#d32f2f; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:.75rem;">✕</button>
        </div>
      `).join('')

      const total = pagosState.reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
      modal.querySelector('#total-pagos').textContent = `Total: Gs. ${total.toLocaleString('es-PY')}`

      box.querySelectorAll('.sel-pago-concepto').forEach(sel => {
        sel.addEventListener('change', () => { pagosState[Number(sel.dataset.idx)].concepto = sel.value })
      })
      box.querySelectorAll('.inp-pago-monto').forEach(inp => {
        inp.addEventListener('input', () => {
          pagosState[Number(inp.dataset.idx)].monto = Number(inp.value) || 0
          const total2 = pagosState.reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
          modal.querySelector('#total-pagos').textContent = `Total: Gs. ${total2.toLocaleString('es-PY')}`
        })
      })
      box.querySelectorAll('.btn-quitar-pago').forEach(btn => {
        btn.addEventListener('click', () => {
          pagosState.splice(Number(btn.dataset.idx), 1)
          pintarPagos()
        })
      })
    }
    pintarPagos()

    modal.querySelector('#btn-agregar-pago').addEventListener('click', () => {
      pagosState.push({ concepto: PAGO_CONCEPTOS[0], monto: 0 })
      pintarPagos()
    })

    modal.querySelector('#btn-guardar').addEventListener('click', async () => {
      const nombre = modal.querySelector('#inp-nombre').value.trim()
      const ci = modal.querySelector('#inp-ci').value.trim()
      const telefono = modal.querySelector('#inp-telefono').value.trim()
      const proponente = modal.querySelector('#inp-proponente').value.trim()
      const local = modal.querySelector('#inp-local').value.trim()
      const mesa = modal.querySelector('#inp-mesa').value.trim()
      const capacitaciones = capsState.filter(c => c.fecha).map(c => ({ fecha: c.fecha, asistio: !!c.asistio }))
      const pagos = pagosState.filter(p => Number(p.monto) > 0).map(p => ({ concepto: p.concepto, monto: Number(p.monto) }))

      if (!nombre || !ci) {
        alert('Nombre y CI son obligatorios')
        return
      }

      try {
        if (fila?.id) {
          await updateMesario(candidateId, fila.id, { nombre, ci, telefono, proponente, local, mesa, capacitaciones, pagos })
        } else {
          await createMesario(candidateId, { nombre, ci, telefono, proponente, local, mesa, capacitaciones, pagos, savedRecordId: fila?.savedRecordId || null })
        }
        modal.remove()
        cargarDatos()
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })

    modal.querySelector('#btn-cancelar').addEventListener('click', () => modal.remove())
  }

  cargarDatos()
}
