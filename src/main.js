import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { initPWA } from './lib/pwa.js'
import { renderLogin } from './pages/login.js'
import { renderApp } from './pages/app.js'
import { renderDiaD } from './modules/dia-d-militantes.js'
import { renderDiaDAdmin } from './modules/dia-d-admin.js'
import { renderMesarioControl } from './pages/mesario-control.js'

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
        renderMesarioControl(root, currentUser, currentProfile)
        return
      }
      
      // Usuario normal
      renderApp(root, currentUser, currentProfile)
    } else {
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
          renderDiaDAdmin(container)
        } else {
          renderDiaD(container, currentUser)
        }
      } catch (error) {
        console.error('Error en DÍA D:', error)
        alert('Error al abrir DÍA D')
      }
    })
  }
})