/**
 * MÓDULO: DÍA D - PANEL ADMIN (candidato-scoped)
 * Port de dia-d-admin.js al modelo multicandidato: mismo dashboard
 * (Global | Local | Por Mesa | Choferes) con ranking en vivo, pero
 * operando exclusivamente sobre /candidates/{candidateId}/... en vez de
 * las colecciones legacy top-level.
 */

import {
  onElectionDayChange,
  setElectionDayEnabled,
  getVotersByMesa,
  getRecordsByMesa,
  getVotosDeMesa,
  getAllRecords,
  getAllCandidateUsers,
  listenAllVotes,
  listenAllElectionDayControl,
  listenDrivers,
  createDriver,
  deleteDriver,
  updateRecord
} from '../lib/firebaseCandidate.js'
import { escapeHtml } from '../lib/escapeHtml.js'

// "Votó" ya no es solo diaD/votes: electionDayControl.status==='voted' es
// la fuente única acordada (ver auditoría Día D) — se agrega como fuente
// adicional acá, sin sacarle diaD/votes, para cubrir el caso donde un
// operador confirma "Ya votó" desde Centro de Contacto (no tiene mesa
// asociada, así que el espejo best-effort a diaD/votes no aplica y solo
// queda registrado en electionDayControl).
function registroYaVoto(record, allVotos, controlDocs) {
  return allVotos.some(v => v.cedula === record.cedula && v.voted) ||
    controlDocs.some(c => c.voterId === record.id && c.status === 'voted')
}

export function renderDiaDAdminCandidate(container, candidateId, currentUser) {
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">⚙️ DÍA D - PANEL ADMINISTRADOR</h2>
      <p style="margin: 8px 0 0 0; font-size: 0.9rem;">Actualizado: <span id="hora-actual"></span></p>
    </div>

    <div style="display: grid; gap: 20px;">
      <div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0 0 6px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🗳️ Control de Votación</h3>
            <p style="margin: 0; font-size: 0.85rem; color: #666;">Habilita o deshabilita Día D para todo el equipo</p>
          </div>
          <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
            <input type="checkbox" id="toggle-election-day" style="width: 24px; height: 24px; cursor: pointer;" />
            <span id="toggle-label" style="font-weight: 700; font-size: 1.1rem; color: #ff9800;">Deshabilitado</span>
          </label>
        </div>
        <div id="toggle-warning" style="background: #fff3cd; border-left: 4px solid #ff9800; padding: 12px; border-radius: 4px; color: #e65100; font-size: 0.9rem;">
          <strong>Día D DESHABILITADO</strong>
        </div>
      </div>

      <div style="background: white; border-radius: 8px; overflow: hidden; border: 2px solid #1976d2;">
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); background: #f5f5f5; border-bottom: 2px solid #1976d2;">
          <button id="tab-global" style="padding: 16px; background: #1976d2; color: white; border: none; cursor: pointer; font-weight: 700;">Global</button>
          <button id="tab-locales" style="padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">Local</button>
          <button id="tab-mesas" style="padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">🎯 Por Mesa</button>
          <button id="tab-choferes" style="padding: 16px; background: #f5f5f5; color: #333; border: none; cursor: pointer; font-weight: 700;">Choferes</button>
        </div>

        <div id="content-global" style="padding: 24px;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #1976d2; text-transform: uppercase;">Estadísticas</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div style="background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-militantes" style="font-size: 2rem; font-weight: 700; color: #1565c0;">0</div>
              <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">EQUIPO</div>
            </div>
            <div style="background: #f3e5f5; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votantes" style="font-size: 2rem; font-weight: 700; color: #6a1b9a;">0</div>
              <div style="font-size: 0.8rem; color: #4a148c; font-weight: 600;">VOTANTES</div>
            </div>
            <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-votos" style="font-size: 2rem; font-weight: 700; color: #2e7d32;">0</div>
              <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">VOTOS</div>
            </div>
            <div style="background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
              <div id="total-pct" style="font-size: 2rem; font-weight: 700; color: #e65100;">0%</div>
              <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">PARTICIPACIÓN</div>
            </div>
          </div>

          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">Ranking</h3>
          <div id="militantes-ranking" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>

        <div id="content-locales" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #2e7d32; text-transform: uppercase;">Por Local</h3>
          <div id="locales-container" style="display: grid; gap: 16px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>

        <div id="content-mesas" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 20px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">🎯 Monitoreo Por Mesa</h3>

          <div style="background: #f9f9f9; border: 2px dashed #c41e3a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 12px 0;">Seleccionar Mesa</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <input id="mesa-seccional" placeholder="Seccional" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-weight: 600;">
              <input id="mesa-numero" placeholder="Mesa" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-weight: 600;">
              <button id="btn-cargar-mesa" style="background: #c41e3a; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: 700;">📊 Cargar Mesa</button>
            </div>
          </div>

          <div id="mesa-stats" style="display: none;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px;">
              <div style="background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
                <div id="mesa-total" style="font-size: 1.8rem; font-weight: 700; color: #1565c0;">0</div>
                <div style="font-size: 0.8rem; color: #0d47a1; font-weight: 600;">TOTAL VOTANTES</div>
              </div>
              <div style="background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
                <div id="mesa-nuestros" style="font-size: 1.8rem; font-weight: 700; color: #e65100;">0</div>
                <div style="font-size: 0.8rem; color: #bf360c; font-weight: 600;">🔴 NUESTROS</div>
              </div>
              <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
                <div id="mesa-votaron" style="font-size: 1.8rem; font-weight: 700; color: #2e7d32;">0</div>
                <div style="font-size: 0.8rem; color: #1b5e20; font-weight: 600;">✅ VOTARON</div>
              </div>
            </div>

            <h4 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; color: #c41e3a;">Votantes de la Mesa</h4>
            <div id="mesa-votantes-list" style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 12px;">
              <div style="text-align: center; color: #999;">Cargando...</div>
            </div>
          </div>

          <div id="mesa-empty" style="text-align: center; padding: 40px; color: #999;">
            Ingresá seccional y mesa para ver estadísticas
          </div>
        </div>

        <div id="content-choferes" style="padding: 24px; display: none;">
          <h3 style="margin: 0 0 16px 0; font-family: 'Barlow Condensed'; font-size: 1.3rem; color: #c41e3a; text-transform: uppercase;">Choferes</h3>

          <div style="background: #f9f9f9; border: 2px dashed #c41e3a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 16px 0;">Agregar Chofer</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <input type="text" id="chofer-nombre" placeholder="Nombre" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <input type="tel" id="chofer-telefono" placeholder="Teléfono" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
              <select id="chofer-local" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="">Selecciona Local</option>
              </select>
              <button id="btn-agregar-chofer" style="background: #c41e3a; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: 700;">Agregar</button>
            </div>
          </div>

          <h4 style="margin: 0 0 12px 0;">Choferes</h4>
          <div id="choferes-lista" style="display: grid; gap: 12px;">
            <div style="text-align: center; padding: 40px; color: #999;">Cargando...</div>
          </div>
        </div>
      </div>
    </div>
  `

  actualizarHora()
  if (window.__diaDAdminCandInterval) clearInterval(window.__diaDAdminCandInterval)
  window.__diaDAdminCandInterval = setInterval(actualizarHora, 1000)

  const switchTab = (tab) => {
    document.getElementById('content-global').style.display = tab === 'global' ? 'block' : 'none'
    document.getElementById('content-locales').style.display = tab === 'locales' ? 'block' : 'none'
    document.getElementById('content-mesas').style.display = tab === 'mesas' ? 'block' : 'none'
    document.getElementById('content-choferes').style.display = tab === 'choferes' ? 'block' : 'none'

    document.getElementById('tab-global').style.background = tab === 'global' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-global').style.color = tab === 'global' ? 'white' : '#333'
    document.getElementById('tab-locales').style.background = tab === 'locales' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-locales').style.color = tab === 'locales' ? 'white' : '#333'
    document.getElementById('tab-mesas').style.background = tab === 'mesas' ? '#1976d2' : '#f5f5f5'
    document.getElementById('tab-mesas').style.color = tab === 'mesas' ? 'white' : '#333'
    document.getElementById('tab-choferes').style.background = tab === 'choferes' ? '#c41e3a' : '#f5f5f5'
    document.getElementById('tab-choferes').style.color = tab === 'choferes' ? 'white' : '#333'
  }

  document.getElementById('tab-global').addEventListener('click', () => switchTab('global'))
  document.getElementById('tab-locales').addEventListener('click', () => switchTab('locales'))
  document.getElementById('tab-mesas').addEventListener('click', () => switchTab('mesas'))
  document.getElementById('tab-choferes').addEventListener('click', () => switchTab('choferes'))

  loadAndRender(container, candidateId, currentUser)
}

function actualizarHora() {
  const span = document.getElementById('hora-actual')
  if (span) span.textContent = new Date().toLocaleTimeString('es-PY')
}

async function loadAndRender(container, candidateId, currentUser) {
  try {
    onElectionDayChange(candidateId, enabled => {
      updateToggle(enabled, candidateId, currentUser.uid)
    })

    const [equipo, allRecords, drivers0] = await Promise.all([
      getAllCandidateUsers(candidateId),
      getAllRecords(candidateId),
      getDrivers0(candidateId)
    ])

    const locales = new Set()
    allRecords.forEach(r => { if (r.local) locales.add(r.local) })

    const selectLocal = document.getElementById('chofer-local')
    if (selectLocal) {
      locales.forEach(local => {
        const opt = document.createElement('option')
        opt.value = local
        opt.textContent = local
        selectLocal.appendChild(opt)
      })
    }

    let choferes = drivers0

    const btnCargarMesa = document.getElementById('btn-cargar-mesa')
    if (btnCargarMesa) {
      btnCargarMesa.addEventListener('click', async () => {
        const seccional = document.getElementById('mesa-seccional').value.trim()
        const mesa = document.getElementById('mesa-numero').value.trim()

        if (!seccional || !mesa) {
          alert('Ingresá seccional y mesa')
          return
        }

        try {
          const votantes = await getVotersByMesa(seccional, mesa)
          const nuestrosRecords = await getRecordsByMesa(candidateId, seccional, mesa)
          const nuestros = new Set(nuestrosRecords.map(r => r.cedula))
          const votosMesa = await getVotosDeMesa(candidateId, seccional, mesa)
          const votaron = new Set(votosMesa.filter(v => v.voted).map(v => v.cedula))

          document.getElementById('mesa-total').textContent = votantes.length
          document.getElementById('mesa-nuestros').textContent = nuestros.size
          document.getElementById('mesa-votaron').textContent = votaron.size

          const votantesHtml = votantes.map(v => {
            const esNuestro = nuestros.has(v.cedula)
            const yaVoto = votaron.has(v.cedula)
            return `
              <div style="padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; ${esNuestro ? 'background: #fff9c4;' : ''} ${yaVoto ? 'opacity: 0.6;' : ''}">
                <div style="flex: 1;">
                  <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(v.nombre) || 'N/A'}</div>
                  <div style="font-size: 0.8rem; color: #666;">CI ${escapeHtml(v.cedula)} · Orden ${escapeHtml(v.orden) || 'N/A'}</div>
                </div>
                <div style="font-size: 0.8rem; font-weight: 600;">
                  ${esNuestro ? '🔴' : ''} ${yaVoto ? '✅ Votó' : '⏳'}
                </div>
              </div>
            `
          }).join('')

          document.getElementById('mesa-votantes-list').innerHTML = votantesHtml || '<div style="text-align: center; color: #999;">Sin votantes</div>'
          document.getElementById('mesa-stats').style.display = 'block'
          document.getElementById('mesa-empty').style.display = 'none'
        } catch (err) {
          console.error('Error:', err)
          alert('Error: ' + err.message)
        }
      })
    }

    listenDrivers(candidateId, (allDrivers) => {
      choferes = allDrivers
    })

    // Ranking global en vivo — a diferencia del viejo panel, no re-lee
    // savedRecords en cada cambio (auditoría IV.2): allRecords ya está en
    // memoria desde la carga inicial, y los listeners de abajo solo traen
    // votos/estado operativo. "Votó" combina diaD/votes (mecanismo de
    // siempre) con electionDayControl.status==='voted' (fuente única
    // acordada — cubre confirmaciones que no pasan por una mesa, como el
    // botón de Centro de Contacto usado por operadores).
    let allVotosActual = []
    let controlDocsActual = []

    function recalcularYRenderizar() {
      const totalV = allRecords.length
      const totalVotos = allRecords.filter(r => registroYaVoto(r, allVotosActual, controlDocsActual)).length
      const pct = totalV > 0 ? ((totalVotos / totalV) * 100).toFixed(2) : 0

      document.getElementById('total-militantes').textContent = equipo.length
      document.getElementById('total-votantes').textContent = totalV
      document.getElementById('total-votos').textContent = totalVotos
      document.getElementById('total-pct').textContent = pct

      const porMil = {}
      equipo.forEach(m => {
        porMil[m.id] = { nombre: m.nombre || m.email, email: m.email, votos: 0, registros: [] }
      })

      allRecords.forEach(r => {
        if (porMil[r.uid]) porMil[r.uid].registros.push(r)
      })

      // Antes se contaba por `markedBy` (quién marcó el voto) comparado
      // contra uids de dirigente — subcontaba cualquier voto marcado por
      // un mesario/chofer/operador. Contar sobre los registros ya
      // agrupados por dirigente es correcto para ambas fuentes.
      Object.values(porMil).forEach(m => {
        m.votos = m.registros.filter(r => registroYaVoto(r, allVotosActual, controlDocsActual)).length
      })

      renderRanking(porMil, allVotosActual, controlDocsActual, allRecords, choferes, candidateId)
      renderLocales(allRecords, allVotosActual, controlDocsActual)
      renderChoferes(choferes, allRecords, allVotosActual, controlDocsActual, candidateId)
    }

    listenAllVotes(candidateId, (allVotos) => {
      allVotosActual = allVotos
      recalcularYRenderizar()
    })

    listenAllElectionDayControl(candidateId, (controlDocs) => {
      controlDocsActual = controlDocs
      recalcularYRenderizar()
    })

    const btnAgregarChofer = document.getElementById('btn-agregar-chofer')
    if (btnAgregarChofer) {
      btnAgregarChofer.addEventListener('click', async () => {
        const nombre = document.getElementById('chofer-nombre').value.trim()
        const telefono = document.getElementById('chofer-telefono').value.trim()
        const local = document.getElementById('chofer-local').value

        if (!nombre || !telefono || !local) {
          alert('Completa los campos')
          return
        }

        try {
          await createDriver(candidateId, { nombre, telefono, local })
          document.getElementById('chofer-nombre').value = ''
          document.getElementById('chofer-telefono').value = ''
          document.getElementById('chofer-local').value = ''
          alert('Chofer agregado')
        } catch (err) {
          alert('Error: ' + err.message)
        }
      })
    }
  } catch (err) {
    console.error('Error:', err)
  }
}

async function getDrivers0(candidateId) {
  const { getDrivers } = await import('../lib/firebaseCandidate.js')
  return getDrivers(candidateId)
}

function updateToggle(enabled, candidateId, uid) {
  const toggle = document.getElementById('toggle-election-day')
  const label = document.getElementById('toggle-label')
  const warning = document.getElementById('toggle-warning')

  if (toggle) {
    toggle.checked = enabled
    toggle.onclick = async () => {
      try {
        toggle.disabled = true
        await setElectionDayEnabled(candidateId, toggle.checked, uid)
      } catch (err) {
        alert('Error: ' + err.message)
        toggle.checked = enabled
      } finally {
        toggle.disabled = false
      }
    }
  }

  if (label) {
    label.textContent = enabled ? 'Habilitado' : 'Deshabilitado'
    label.style.color = enabled ? '#2e7d32' : '#ff9800'
  }

  if (warning) {
    warning.innerHTML = enabled ? '<strong>Día D HABILITADO</strong>' : '<strong>Día D DESHABILITADO</strong>'
    warning.style.background = enabled ? '#c8e6c9' : '#fff3cd'
    warning.style.borderLeftColor = enabled ? '#2e7d32' : '#ff9800'
    warning.style.color = enabled ? '#1b5e20' : '#e65100'
  }
}

function renderRanking(porMil, allVotos, controlDocs, allRecords, choferes, candidateId) {
  const ranking = Object.entries(porMil)
    .map(([uid, data]) => ({ uid, ...data }))
    .sort((a, b) => b.votos - a.votos)

  let html = ''
  ranking.forEach((m, idx) => {
    const pct = m.registros.length > 0 ? ((m.votos / m.registros.length) * 100).toFixed(2) : 0
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '👤'
    const color = pct >= 75 ? '#2e7d32' : pct >= 50 ? '#ff9800' : '#f44336'

    html += '<div style="background: #fafafa; border-radius: 8px; padding: 16px; border-left: 4px solid ' + color + ';">'
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
    html += '<div><div style="font-weight: 700;">' + medal + ' ' + escapeHtml(m.nombre) + '</div><div style="font-size: 0.75rem; color: #999;">' + escapeHtml(m.email) + '</div></div>'
    html += '<div style="text-align: right;"><div style="font-size: 1.3rem; font-weight: 700; color: ' + color + ';">' + m.votos + '/' + m.registros.length + '</div><div style="font-size: 0.75rem;">' + pct + '%</div></div></div>'
    html += '<div style="background: white; border-radius: 4px; height: 8px; margin-bottom: 10px;"><div style="background: ' + color + '; height: 100%; width: ' + Math.min(pct, 100) + '%;"></div></div>'
    html += '<button class="btn-detalle" data-uid="' + escapeHtml(m.uid) + '" style="background: #1976d2; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: 700;">Detalle</button>'
    html += '</div>'
  })

  const el = document.getElementById('militantes-ranking')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-detalle').forEach(btn => {
      btn.onclick = () => {
        const uid = btn.dataset.uid
        const nombre = porMil[uid].nombre
        const registros = porMil[uid].registros
        mostrarDetalle(nombre, registros, allVotos, controlDocs, choferes, candidateId)
      }
    })
  }
}

function renderLocales(allRecords, allVotos, controlDocs) {
  const porLocal = {}

  allRecords.forEach(r => {
    const local = r.local || 'Sin local'
    if (!porLocal[local]) porLocal[local] = {}
    const mesa = r.mesa || 'Sin mesa'
    if (!porLocal[local][mesa]) porLocal[local][mesa] = []
    porLocal[local][mesa].push(r)
  })

  let html = ''
  Object.entries(porLocal).forEach(([local, mesas]) => {
    let votosL = 0, totalL = 0
    Object.values(mesas).forEach(regs => {
      regs.forEach(r => {
        totalL++
        if (registroYaVoto(r, allVotos, controlDocs)) votosL++
      })
    })

    const pctL = totalL > 0 ? ((votosL / totalL) * 100).toFixed(2) : 0

    html += '<div style="background: white; border: 2px solid #2e7d32; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
    html += '<h4 style="margin: 0; color: #2e7d32;">' + escapeHtml(local) + '</h4>'
    html += '<div style="font-weight: 700; color: #2e7d32;">' + votosL + '/' + totalL + ' (' + pctL + '%)</div></div>'

    Object.entries(mesas).forEach(([mesa, registros]) => {
      let votosM = 0
      registros.forEach(r => {
        if (registroYaVoto(r, allVotos, controlDocs)) votosM++
      })
      const pctM = registros.length > 0 ? ((votosM / registros.length) * 100).toFixed(2) : 0

      html += '<div style="background: #f9f9f9; border-left: 4px solid #ff9800; padding: 12px; margin-bottom: 8px; border-radius: 4px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">'
      html += '<div style="font-weight: 600;">Mesa ' + escapeHtml(mesa) + '</div>'
      html += '<div style="font-size: 0.85rem;">' + votosM + '/' + registros.length + ' (' + pctM + '%)</div></div>'
      html += '<button class="btn-mesa" data-local="' + escapeHtml(local) + '" data-mesa="' + escapeHtml(mesa) + '" style="background: #ff9800; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Ver</button>'
      html += '</div>'
    })

    html += '</div>'
  })

  const el = document.getElementById('locales-container')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-mesa').forEach(btn => {
      btn.onclick = () => {
        mostrarMesa(btn.dataset.local, btn.dataset.mesa, allRecords, allVotos, controlDocs)
      }
    })
  }
}

function renderChoferes(choferes, allRecords, allVotos, controlDocs, candidateId) {
  let html = ''

  if (choferes.length === 0) {
    html = '<div style="text-align: center; padding: 40px; color: #999;">Sin choferes</div>'
  } else {
    choferes.forEach(chofer => {
      const faltantes = allRecords.filter(r => r.local === chofer.local && r.chofer_asignado === chofer.id && !registroYaVoto(r, allVotos, controlDocs))

      html += '<div style="background: white; border: 2px solid #c41e3a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">'
      html += '<div style="display: flex; justify-content: space-between; margin-bottom: 12px;">'
      html += '<div><div style="font-weight: 700;">🚗 ' + escapeHtml(chofer.nombre) + '</div><div style="font-size: 0.85rem; color: #666;">📱 ' + escapeHtml(chofer.telefono) + ' | 📍 ' + escapeHtml(chofer.local) + '</div></div>'
      html += '<div style="text-align: right;"><div style="font-size: 1.5rem; font-weight: 700; color: #c41e3a;">' + faltantes.length + '</div><div style="font-size: 0.75rem;">Faltantes</div></div>'
      html += '</div>'

      if (faltantes.length > 0) {
        html += '<div style="background: #fff9e6; border-radius: 4px; padding: 12px; max-height: 200px; overflow-y: auto;">'
        faltantes.forEach(p => {
          html += '<div style="padding: 6px; border-bottom: 1px solid #ffe0b2; font-size: 0.85rem;">'
          html += '<div style="font-weight: 600;">' + escapeHtml(p.nombre) + '</div>'
          html += '<div style="color: #666;">CI: ' + escapeHtml(p.cedula) + ' | Mesa: ' + escapeHtml(p.mesa) + '</div>'
          html += '</div>'
        })
        html += '</div>'
      } else {
        html += '<div style="background: #f9f9f9; border-radius: 4px; padding: 12px; text-align: center; color: #999; font-size: 0.85rem;">Sin faltantes</div>'
      }

      html += '<button class="btn-del-chofer" data-id="' + chofer.id + '" style="background: #ff5252; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; margin-top: 8px; width: 100%;">Eliminar</button>'
      html += '</div>'
    })
  }

  const el = document.getElementById('choferes-lista')
  if (el) {
    el.innerHTML = html
    document.querySelectorAll('.btn-del-chofer').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('¿Eliminar chofer?')) {
          try {
            await deleteDriver(candidateId, btn.dataset.id)
          } catch (err) {
            alert('Error: ' + err.message)
          }
        }
      }
    })
  }
}

function mostrarDetalle(nombre, registros, allVotos, controlDocs, choferes, candidateId) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  const votados = registros.filter(r => registroYaVoto(r, allVotos, controlDocs))
  const faltantes = registros.filter(r => !registroYaVoto(r, allVotos, controlDocs))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">Detalle: ' + escapeHtml(nombre) + '</h2>'
  html += '<button id="btn-cerrar-detalle" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">X</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 24px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(r => {
      html += '<div style="background: #e8f5e9; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid #2e7d32;">'
      html += '<div style="font-weight: 600;">' + escapeHtml(r.nombre) + '</div>'
      html += '<div style="font-size: 0.8rem; color: #333;">CI: ' + escapeHtml(r.cedula) + ' | Local: ' + escapeHtml(r.local || 'N/A') + ' | Mesa: ' + escapeHtml(r.mesa || 'N/A') + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">FALTANTES (' + faltantes.length + ')</h3>'
    faltantes.forEach(r => {
      const msgWA = encodeURIComponent('Buen día, ' + r.nombre + '.\nTe estamos esperando para votar.\n📍 Lugar: ' + (r.local || 'N/A') + '\n📋 Mesa: ' + (r.mesa || 'N/A') + '\n🔢 Orden: ' + (r.orden || 'N/A') + '\nTu voto hace la diferencia.')
      const waLink = 'https://wa.me/' + (r.telefono || '') + '?text=' + msgWA

      html += '<div style="background: #fff9e6; padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600; margin-bottom: 6px;">' + escapeHtml(r.nombre || 'N/A') + '</div>'
      html += '<div style="font-size: 0.8rem; color: #333; margin-bottom: 8px;">CI: ' + escapeHtml(r.cedula) + ' | Local: ' + escapeHtml(r.local || 'N/A') + ' | Mesa: ' + escapeHtml(r.mesa || 'N/A') + ' | 📱 ' + escapeHtml(r.telefono || 'Sin teléfono') + '</div>'

      html += '<div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; margin-bottom: 8px; align-items: center;">'
      html += '<label style="font-weight: 600; font-size: 0.85rem;">Asignar chofer?</label>'
      html += '<select class="chofer-selector" data-cedula="' + escapeHtml(r.cedula) + '" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem;">'
      html += '<option value="">No</option>'
      html += '<option value="si">Si</option>'
      html += '</select>'
      html += '</div>'

      html += '<div class="chofer-select-container-' + escapeHtml(r.cedula) + '" style="display: none; margin-bottom: 8px;">'
      html += '<select class="chofer-select" data-cedula="' + escapeHtml(r.cedula) + '" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; width: 100%; margin-bottom: 8px;">'
      html += '<option value="">Selecciona chofer</option>'
      choferes.filter(c => c.local === r.local).forEach(c => {
        html += '<option value="' + c.id + '">' + escapeHtml(c.nombre) + ' (' + escapeHtml(c.telefono) + ')</option>'
      })
      html += '</select>'
      html += '<button class="btn-asignar-chofer" data-cedula="' + escapeHtml(r.cedula) + '" style="background: #c41e3a; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; width: 100%;">Asignar</button>'
      html += '</div>'

      if (r.telefono) {
        html += '<a href="' + waLink + '" target="_blank" style="background: #25d366; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 0.8rem; font-weight: 600; display: inline-block;">Enviar WA</a>'
      }

      html += '</div>'
    })
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cerrar-detalle').addEventListener('click', () => modal.remove())

  document.querySelectorAll('.chofer-selector').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const cedula = sel.dataset.cedula
      const cont = document.querySelector('.chofer-select-container-' + cedula)
      cont.style.display = e.target.value === 'si' ? 'block' : 'none'
    })
  })

  document.querySelectorAll('.btn-asignar-chofer').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cedula = btn.dataset.cedula
      const choferSelect = document.querySelector('.chofer-select[data-cedula="' + cedula + '"]')
      const choferId = choferSelect.value

      if (!choferId) {
        alert('Selecciona chofer')
        return
      }

      try {
        const record = registros.find(r => r.cedula === cedula)
        await updateRecord(candidateId, record.id, { chofer_asignado: choferId })
        alert('Asignado')
      } catch (err) {
        alert('Error: ' + err.message)
      }
    })
  })

  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}

function mostrarMesa(local, mesa, allRecords, allVotos, controlDocs) {
  const registrosMesa = allRecords.filter(r => r.local === local && r.mesa === mesa)

  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;'

  const votados = registrosMesa.filter(r => registroYaVoto(r, allVotos, controlDocs))
  const faltantes = registrosMesa.filter(r => !registroYaVoto(r, allVotos, controlDocs))

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; margin: 40px auto;">'
  html += '<div style="background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;">'
  html += '<h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">Local: ' + escapeHtml(local) + ' | Mesa: ' + escapeHtml(mesa) + '</h2>'
  html += '<button id="btn-cerrar-mesa" style="background: rgba(255,255,255,0.3); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">X</button>'
  html += '</div>'
  html += '<div style="padding: 20px; max-height: 70vh; overflow-y: auto;">'
  html += '<div style="margin-bottom: 12px; font-weight: 600;">Total: ' + registrosMesa.length + ' | Votados: ' + votados.length + ' | Faltantes: ' + faltantes.length + '</div>'

  if (votados.length > 0) {
    html += '<div style="margin-bottom: 20px;"><h3 style="background: #2e7d32; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">YA VOTARON (' + votados.length + ')</h3>'
    votados.forEach(r => {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 4px solid #2e7d32;">'
      html += '<div style="font-weight: 600;">' + escapeHtml(r.nombre) + '</div>'
      html += '<div style="color: #666;">CI: ' + escapeHtml(r.cedula) + ' | Orden: ' + escapeHtml(r.orden) + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  if (faltantes.length > 0) {
    html += '<div><h3 style="background: #ff9800; color: white; padding: 12px; border-radius: 4px; margin: 0 0 12px 0;">FALTANTES (' + faltantes.length + ')</h3>'
    faltantes.forEach(r => {
      html += '<div style="background: #fff9e6; padding: 10px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 4px solid #ff9800;">'
      html += '<div style="font-weight: 600;">' + escapeHtml(r.nombre) + '</div>'
      html += '<div style="color: #666;">CI: ' + escapeHtml(r.cedula) + ' | Orden: ' + escapeHtml(r.orden) + ' | 📱 ' + escapeHtml(r.telefono || 'Sin teléfono') + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  html += '</div></div>'
  modal.innerHTML = html
  document.body.appendChild(modal)
  document.getElementById('btn-cerrar-mesa').addEventListener('click', () => modal.remove())
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}
