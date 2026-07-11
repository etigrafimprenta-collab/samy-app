// Panel de plataforma para superadmin: crear candidatos, ver estado
// general, y entrar al panel de un candidato sin mezclar datos (cambia el
// candidato activo y renderiza el panel de campaña normal para ese id).
// También: backup, borrado definitivo, y qué módulos tiene habilitados
// cada candidato.
import { logoutUser } from '../lib/firebase.js'
import { listAllCandidates, setStoredActiveCandidateId } from '../lib/candidateContext.js'
import { getCandidateCounts, getSharedVotersCount, importSharedVotersBatch, updateSharedVotersBatch, setPadronMeta } from '../lib/firebaseCandidate.js'
import { MODULES } from '../lib/rbacCatalog.js'
import { escapeHtml } from '../lib/escapeHtml.js'
import { httpsCallable } from 'firebase/functions'
import { functionsInstance } from '../lib/firebase.js'

export async function renderSuperAdmin(root, user) {
  root.innerHTML = '<div class="loader"><div class="spinner"></div> Cargando plataforma...</div>'

  const candidates = await listAllCandidates()
  const votersCompartidos = await getSharedVotersCount().catch(() => '—')

  root.innerHTML = `
    <div style="background: linear-gradient(135deg, #1a2332 0%, #0d1420 100%); color: white; padding: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; max-width:1100px; margin:0 auto;">
        <div>
          <h1 style="margin:0; font-size:1.4rem;">🛡️ Panel de plataforma</h1>
          <div style="opacity:.8; font-size:.85rem;">${escapeHtml(user.email)} · superadmin</div>
        </div>
        <button id="btn-logout" style="padding:8px 14px; background:rgba(255,255,255,.15); color:#fff; border:1px solid rgba(255,255,255,.3); border-radius:6px; cursor:pointer;">Salir</button>
      </div>
    </div>
    <div style="max-width:1100px; margin:24px auto; padding:0 16px;">
      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px; margin-bottom:24px;">
        <h2 style="margin:0 0 12px; font-size:1.1rem;">➕ Crear candidato nuevo</h2>
        <form id="form-crear-candidato" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;">
          <input required name="candidateId" placeholder="id (ej: juan-perez)" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input required name="name" placeholder="Nombre del candidato" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input required name="adminNombre" placeholder="Nombre del administrador de campaña" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <input required name="adminEmail" type="email" placeholder="Email del administrador" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
          <button type="submit" style="grid-column:1/-1; padding:10px; background:#1f4b7a; color:white; border:none; border-radius:4px; font-weight:700; cursor:pointer;">Crear candidato (vacío)</button>
        </form>
        <div id="crear-candidato-msg" style="margin-top:10px; font-size:.9rem;"></div>
      </div>

      <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:20px; margin-bottom:24px;">
        <h2 style="margin:0 0 4px; font-size:1.1rem;">🗳️ Padrón electoral (compartido)</h2>
        <p style="font-size:.85rem; color:#666; margin:0 0 12px;">Un solo padrón para toda la plataforma — lo ven y buscan todos los candidatos, pero solo vos podés cargarlo/actualizarlo.</p>
        <div style="font-size:1.6rem; font-weight:700; color:#1f4b7a; margin-bottom:12px;">${votersCompartidos} votantes cargados</div>
        <div style="display:flex; gap:16px; margin-bottom:10px; font-size:.85rem;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="radio" name="modo-padron" value="actualizar" checked> 🔄 Actualizar existentes + agregar nuevos
          </label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="radio" name="modo-padron" value="agregar"> ➕ Solo agregar nuevos (no toca lo ya cargado)
          </label>
        </div>
        <p style="font-size:.78rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:6px 10px; border-radius:4px; margin:0 0 10px;">💡 "Actualizar" refresca mesa/local/dirección de cédulas ya cargadas con lo del archivo nuevo — nunca borra un votante que no esté en el archivo.</p>
        <input type="file" id="inp-padron-shared" accept=".xlsx,.xls" />
        <div id="import-padron-msg" style="margin-top:10px; font-size:.85rem;"></div>
      </div>

      <h2 style="font-size:1.1rem;">Candidatos (${candidates.length})</h2>
      <div id="candidatos-list" style="display:grid; gap:12px;">
        <div style="color:#999;">Cargando conteos...</div>
      </div>
    </div>
  `

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('¿Cerrar sesión?')) await logoutUser()
  })

  document.getElementById('form-crear-candidato').addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const msg = document.getElementById('crear-candidato-msg')
    msg.textContent = 'Creando...'
    try {
      const crearCandidato = httpsCallable(functionsInstance, 'crearCandidato')
      const result = await crearCandidato({
        candidateId: fd.get('candidateId').trim(),
        name: fd.get('name').trim(),
        adminNombre: fd.get('adminNombre').trim(),
        adminEmail: fd.get('adminEmail').trim(),
        adminPassword: cryptoRandomPassword()
      })
      msg.innerHTML = `✅ ${escapeHtml(result.data.mensaje)}`
      e.target.reset()
      renderSuperAdmin(root, user)
    } catch (err) {
      msg.innerHTML = `❌ ${escapeHtml(err.message)}`
    }
  })

  document.getElementById('inp-padron-shared').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const modo = document.querySelector('input[name="modo-padron"]:checked').value
    const msg = document.getElementById('import-padron-msg')
    msg.textContent = 'Leyendo archivo...'
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
    msg.textContent = `Procesando ${rows.length} filas (modo: ${modo === 'actualizar' ? 'actualizar' : 'solo agregar'})...`

    if (modo === 'actualizar') {
      const stats = await updateSharedVotersBatch(rows, (hechos, _dup, total) => {
        msg.textContent = `Procesando... ${hechos}/${total}`
      })
      msg.innerHTML = `✅ Listo. Agregados: ${stats.added} · Actualizados: ${stats.updated} · Errores: ${stats.errors}`
    } else {
      const stats = await importSharedVotersBatch(rows, (added, dup, total) => {
        msg.textContent = `Importando... ${added + dup}/${total} (agregados: ${added}, duplicados: ${dup})`
      })
      msg.innerHTML = `✅ Listo. Agregados: ${stats.added} · Duplicados (sin tocar): ${stats.duplicates} · Errores: ${stats.errors}`
    }
    await setPadronMeta(file.name, user.uid).catch(() => {})
    e.target.value = ''
  })

  const listEl = document.getElementById('candidatos-list')
  if (candidates.length === 0) {
    listEl.innerHTML = '<div style="color:#999;">Todavía no hay candidatos. Creá el primero arriba.</div>'
    return
  }

  const rows = await Promise.all(candidates.map(async c => {
    let counts = { users: '—', records: '—', drivers: '—' }
    try { counts = await getCandidateCounts(c.id) } catch { /* reglas o candidato recién creado */ }
    return { c, counts }
  }))

  listEl.innerHTML = rows.map(({ c, counts }) => `
    <div style="background:white; border:1px solid #ddd; border-radius:8px; padding:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div>
        <div style="font-weight:700;">${escapeHtml(c.name)} <span style="font-weight:400; color:#999; font-size:.85rem;">(${escapeHtml(c.id)})</span></div>
        <div style="font-size:.85rem; color:${c.status === 'active' ? '#2e7d32' : '#c62828'};">${c.status === 'active' ? '● activo' : '● inactivo'}</div>
        <div style="font-size:.8rem; color:#666; margin-top:4px;">
          👥 ${counts.users} usuarios · 📋 ${counts.records} registros · 🚗 ${counts.drivers} choferes
        </div>
        <div style="font-size:.75rem; color:#999; margin-top:2px;">
          🧩 ${Array.isArray(c.enabledModules) ? `${c.enabledModules.length} de ${MODULES.length} módulos habilitados` : 'Todos los módulos habilitados (sin restricción configurada)'}
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button data-enter="${escapeHtml(c.id)}" style="padding:8px 14px; background:#1f4b7a; color:white; border:none; border-radius:4px; cursor:pointer;">Entrar</button>
        <button data-modulos="${escapeHtml(c.id)}" style="padding:8px 14px; background:#6a1b9a; color:white; border:none; border-radius:4px; cursor:pointer;">🧩 Módulos</button>
        <button data-backup="${escapeHtml(c.id)}" style="padding:8px 14px; background:#00695c; color:white; border:none; border-radius:4px; cursor:pointer;">📦 Backup</button>
        <button data-toggle="${escapeHtml(c.id)}" data-status="${c.status}" style="padding:8px 14px; background:${c.status === 'active' ? '#c62828' : '#2e7d32'}; color:white; border:none; border-radius:4px; cursor:pointer;">
          ${c.status === 'active' ? 'Desactivar' : 'Activar'}
        </button>
        <button data-borrar="${escapeHtml(c.id)}" data-nombre="${escapeHtml(c.name)}" style="padding:8px 14px; background:#3a3a40; color:white; border:1px solid #c62828; border-radius:4px; cursor:pointer;">🗑️ Borrar</button>
      </div>
    </div>
  `).join('')

  listEl.querySelectorAll('[data-enter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      setStoredActiveCandidateId(btn.dataset.enter)
      const { renderCampaignPanel } = await import('./campaign.js')
      renderCampaignPanel(root, user, btn.dataset.enter, { asSuperAdmin: true })
    })
  })

  listEl.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const candidateId = btn.dataset.toggle
      const newStatus = btn.dataset.status === 'active' ? 'suspended' : 'active'
      const { updateDoc, doc } = await import('firebase/firestore')
      const { db } = await import('../lib/firebase.js')
      await updateDoc(doc(db, 'candidates', candidateId), { status: newStatus })
      renderSuperAdmin(root, user)
    })
  })

  listEl.querySelectorAll('[data-modulos]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = candidates.find(x => x.id === btn.dataset.modulos)
      mostrarModalModulos(c)
    })
  })

  listEl.querySelectorAll('[data-backup]').forEach(btn => {
    btn.addEventListener('click', () => hacerBackup(btn.dataset.backup, btn))
  })

  listEl.querySelectorAll('[data-borrar]').forEach(btn => {
    btn.addEventListener('click', () => mostrarModalBorrar(btn.dataset.borrar, btn.dataset.nombre))
  })

  // ── Módulos habilitados por candidato ────────────────────────────────
  function mostrarModalModulos(candidate) {
    const habilitados = Array.isArray(candidate.enabledModules) ? candidate.enabledModules : MODULES.map(m => m.key)
    const modal = document.createElement('div')
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.7); display:flex; justify-content:center; align-items:flex-start; z-index:9999; overflow-y:auto; padding:20px;'
    modal.innerHTML = `
      <div style="background:white; border-radius:8px; max-width:480px; width:100%; padding:24px; margin:20px auto;">
        <h3 style="margin:0 0 6px;">🧩 Módulos habilitados</h3>
        <p style="font-size:.85rem; color:#666; margin:0 0 14px;">${escapeHtml(candidate.name)} — desmarcá lo que no quieras que este candidato pueda usar (por plan, por ejemplo).</p>
        <div style="display:grid; gap:4px; max-height:340px; overflow-y:auto; border:1px solid #eee; border-radius:6px; padding:10px; margin-bottom:14px;">
          ${MODULES.map(m => `
            <label style="display:flex; align-items:center; gap:8px; font-size:.87rem; padding:3px 0;">
              <input type="checkbox" class="chk-modulo" value="${m.key}" ${habilitados.includes(m.key) ? 'checked' : ''}>
              ${m.icon} ${escapeHtml(m.name)}
            </label>
          `).join('')}
        </div>
        <div id="modulos-msg" style="font-size:.85rem; margin-bottom:10px;"></div>
        <div style="display:flex; gap:8px;">
          <button id="btn-guardar-modulos" style="flex:1; background:#6a1b9a; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Guardar</button>
          <button id="btn-marcar-todos" style="flex:1; background:#eee; color:#333; border:none; padding:10px; border-radius:4px; cursor:pointer;">Marcar todos</button>
          <button id="btn-cancelar-modulos" style="flex:1; background:#ccc; color:#333; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#btn-cancelar-modulos').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-marcar-todos').addEventListener('click', () => {
      modal.querySelectorAll('.chk-modulo').forEach(chk => { chk.checked = true })
    })
    modal.querySelector('#btn-guardar-modulos').addEventListener('click', async () => {
      const seleccionados = Array.from(modal.querySelectorAll('.chk-modulo:checked')).map(c => c.value)
      const msg = modal.querySelector('#modulos-msg')
      msg.textContent = 'Guardando...'
      try {
        const { updateDoc, doc } = await import('firebase/firestore')
        const { db } = await import('../lib/firebase.js')
        await updateDoc(doc(db, 'candidates', candidate.id), { enabledModules: seleccionados })
        msg.innerHTML = '<span style="color:#2e7d32;">✅ Guardado.</span>'
        setTimeout(() => { modal.remove(); renderSuperAdmin(root, user) }, 900)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }

  // ── Backup ────────────────────────────────────────────────────────────
  async function hacerBackup(candidateId, btn) {
    const original = btn.textContent
    btn.disabled = true
    btn.textContent = 'Generando...'
    try {
      const backupCandidato = httpsCallable(functionsInstance, 'backupCandidato')
      const result = await backupCandidato({ candidateId })
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${candidateId}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error generando el backup: ' + err.message)
    } finally {
      btn.disabled = false
      btn.textContent = original
    }
  }

  // ── Borrado definitivo ────────────────────────────────────────────────
  function mostrarModalBorrar(candidateId, candidateName) {
    const modal = document.createElement('div')
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.7); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;'
    modal.innerHTML = `
      <div style="background:white; border-radius:8px; max-width:460px; width:100%; padding:24px; border:2px solid #c62828;">
        <h3 style="margin:0 0 10px; color:#c62828;">🗑️ Borrar "${escapeHtml(candidateName)}" definitivamente</h3>
        <p style="font-size:.85rem; color:#555; margin:0 0 6px;">Esto borra <strong>todos</strong> los datos del candidato (usuarios, registros, choferes, mesarios, finanzas, roles, todo) y las cuentas de sus usuarios que no pertenezcan a otro candidato. <strong>No se puede deshacer.</strong></p>
        <p style="font-size:.85rem; color:#856404; background:#fff3cd; border-left:4px solid #ffc107; padding:8px 10px; border-radius:4px; margin:10px 0;">💡 Si no hiciste un Backup todavía, cerrá esto y hacelo primero.</p>
        <label style="font-size:.85rem; font-weight:700; display:block; margin-bottom:6px;">Escribí "${escapeHtml(candidateName)}" para confirmar:</label>
        <input id="inp-confirmar-nombre" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; margin-bottom:14px; box-sizing:border-box;">
        <div id="borrar-msg" style="font-size:.85rem; margin-bottom:10px;"></div>
        <div style="display:flex; gap:8px;">
          <button id="btn-confirmar-borrar" style="flex:1; background:#c62828; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:700;">Borrar definitivamente</button>
          <button id="btn-cancelar-borrar" style="flex:1; background:#ccc; color:#333; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancelar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    modal.querySelector('#btn-cancelar-borrar').addEventListener('click', () => modal.remove())
    modal.querySelector('#btn-confirmar-borrar').addEventListener('click', async () => {
      const msg = modal.querySelector('#borrar-msg')
      const confirmName = modal.querySelector('#inp-confirmar-nombre').value
      if (confirmName.trim() !== candidateName) {
        msg.innerHTML = '<span style="color:#c62828;">El nombre no coincide.</span>'
        return
      }
      msg.textContent = 'Borrando...'
      try {
        const eliminarCandidato = httpsCallable(functionsInstance, 'eliminarCandidato')
        const result = await eliminarCandidato({ candidateId, confirmName })
        msg.innerHTML = `<span style="color:#2e7d32;">✅ Borrado (${result.data.usersDeleted} cuenta(s) de usuario eliminadas).</span>`
        setTimeout(() => { modal.remove(); renderSuperAdmin(root, user) }, 1200)
      } catch (err) {
        msg.innerHTML = `<span style="color:#c62828;">❌ ${escapeHtml(err.message)}</span>`
      }
    })
  }
}

function cryptoRandomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}
