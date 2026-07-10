// Panel de plataforma para superadmin: crear candidatos, ver estado
// general, y entrar al panel de un candidato sin mezclar datos (cambia el
// candidato activo y renderiza el panel de campaña normal para ese id).
import { logoutUser } from '../lib/firebase.js'
import { listAllCandidates, setStoredActiveCandidateId } from '../lib/candidateContext.js'
import { getCandidateCounts, getSharedVotersCount, importSharedVotersBatch } from '../lib/firebaseCandidate.js'
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
    const msg = document.getElementById('import-padron-msg')
    msg.textContent = 'Leyendo archivo...'
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
    msg.textContent = `Importando ${rows.length} filas...`
    const stats = await importSharedVotersBatch(rows, (added, dup, total) => {
      msg.textContent = `Importando... ${added + dup}/${total} (agregados: ${added}, duplicados: ${dup})`
    })
    msg.innerHTML = `✅ Listo. Agregados: ${stats.added} · Duplicados: ${stats.duplicates} · Errores: ${stats.errors}`
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
      </div>
      <div style="display:flex; gap:8px;">
        <button data-enter="${escapeHtml(c.id)}" style="padding:8px 14px; background:#1f4b7a; color:white; border:none; border-radius:4px; cursor:pointer;">Entrar</button>
        <button data-toggle="${escapeHtml(c.id)}" data-status="${c.status}" style="padding:8px 14px; background:${c.status === 'active' ? '#c62828' : '#2e7d32'}; color:white; border:none; border-radius:4px; cursor:pointer;">
          ${c.status === 'active' ? 'Desactivar' : 'Activar'}
        </button>
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
}

function cryptoRandomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}
