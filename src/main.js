import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { initPWA } from './lib/pwa.js'
import { resolveCandidateAccess } from './lib/candidateContext.js'
// login / app / mesario-control son mutuamente excluyentes en una misma
// sesión (según haya o no usuario, y su rol) — se importan dinámicamente
// más abajo para que cada quien descargue solo el módulo que le
// corresponde (auditoría IV.5 / mandato Fase 4).

// Inicializar PWA cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA)
} else {
  initPWA()
}

const root = document.getElementById('app')
let currentUser = null
let currentProfile = null

async function init() {
  root.innerHTML = '<div class="loader"><div class="spinner"></div> Cargando...</div>'
  onAuthChange(async (user) => {
    console.log('🚀 onAuthChange - user:', user?.email)
    
    if (user) {
      currentUser = user

      // Plataforma multicandidato: si este uid es superadmin o pertenece a
      // algún /candidates/{id}/users, entra por ahí — nunca mezclado con
      // el esquema legacy de un solo candidato. Si no pertenece a ningún
      // candidato nuevo, sigue el flujo legacy de Samy Fidabel de siempre
      // (esto es lo que mantiene la app funcionando para los usuarios que
      // todavía no fueron migrados).
      const access = await resolveCandidateAccess(user.uid)
      if (access.superadmin) {
        const { renderSuperAdmin } = await import('./pages/superadmin.js')
        renderSuperAdmin(root, currentUser)
        return
      }
      if (access.activeCandidateId) {
        const { renderCampaignPanel } = await import('./pages/campaign.js')
        renderCampaignPanel(root, currentUser, access.activeCandidateId)
        return
      }

      currentProfile = await getUserProfile(user.uid)

      if (!currentProfile) {
        const { createUserProfile } = await import('./lib/firebase.js')
        await createUserProfile(user.uid, {
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0]
        })
        currentProfile = await getUserProfile(user.uid)
      }

      console.log('🔍 Email del usuario:', user.email)
      console.log('🔍 Role del usuario:', currentProfile?.role)
      
      // ✅ DETECCIÓN DE MESARIO POR ROLE
      if (currentProfile?.role === 'mesario') {
        console.log('✅ Mesario detectado - entrando a Control de Votación')
        const { renderMesarioControl } = await import('./pages/mesario-control.js')
        renderMesarioControl(root, currentUser, currentProfile)
        return
      }

      // Usuario normal
      const { renderApp } = await import('./pages/app.js')
      renderApp(root, currentUser, currentProfile)
    } else {
      const inviteId = new URLSearchParams(window.location.search).get('invite')
      if (inviteId) {
        const { renderAcceptInvite } = await import('./pages/acceptInvite.js')
        renderAcceptInvite(root, inviteId)
        return
      }
      const { renderLogin } = await import('./pages/login.js')
      renderLogin(root, () => {})
    }
  })
}

init()

document.addEventListener('DOMContentLoaded', () => {
  const btnDiaD = document.getElementById('nav-dia-d')
  if (btnDiaD) {
    btnDiaD.addEventListener('click', async () => {
      const container = document.getElementById('main-content')
      if (!container) {
        console.error('⚠️ No se encontró #main-content')
        return
      }
      try {
        const perfil = await getUserProfile(currentUser.uid)
        const rol = perfil?.role
        if (rol === 'admin') {
          const { renderDiaDAdmin } = await import('./modules/dia-d-admin.js')
          renderDiaDAdmin(container)
        } else {
          const { renderDiaD } = await import('./modules/dia-d-militantes.js')
          renderDiaD(container, currentUser)
        }
      } catch (error) {
        console.error('Error en DÍA D:', error)
        alert('Error al abrir DÍA D')
      }
    })
  }
})