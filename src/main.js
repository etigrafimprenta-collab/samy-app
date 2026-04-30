import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { initPWA } from './lib/pwa.js'
import { renderLogin } from './pages/login.js'
import { renderApp } from './pages/app.js'

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
      renderApp(root, currentUser, currentProfile)
    } else {
      renderLogin(root, () => {})
    }
  })
}

init()