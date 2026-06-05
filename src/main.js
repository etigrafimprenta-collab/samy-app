import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { initPWA } from './lib/pwa.js'
import { renderLogin } from './pages/login.js'
import { renderApp } from './pages/app.js'
import { renderMesarioLogin } from './pages/mesario-login.js'
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
    console.log('🚀 onAuthChange ejecutándose, user:', user?.email)
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
      console.log('🔍 ¿Incluye mesario-?', user.email.includes('mesario-'))
      
      // DETECCIÓN DE MESARIO (por EMAIL)
      if (user.email.includes('mesario-')) {
        renderMesarioControl(root, currentUser, currentProfile)
        return
      } else {
        renderApp(root, currentUser, currentProfile)
      }
    } else {
      // DETECTAR SI VIENE DE URL /mesario
      if (window.location.pathname === '/mesario' || window.location.hash.includes('mesario')) {
        renderMesarioLogin(root, () => init())
      } else {
        renderLogin(root, () => {})
      }
    }
  })
}

init()