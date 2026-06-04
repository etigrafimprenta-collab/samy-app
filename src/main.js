import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { initPWA } from './lib/pwa.js'
import { renderLogin } from './pages/login.js'
import { renderApp } from './pages/app.js'
// import { renderMesarioLogin } from './pages/mesario-login.js'

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
        root.innerHTML = `
          <div style="padding: 40px; text-align: center; background: #667eea; color: white; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <h1 style="margin-bottom: 20px; font-size: 32px;">📊 Dashboard Mesario</h1>
            <p style="font-size: 18px; margin-bottom: 10px;">${user.email}</p>
            <p style="color: #ddd; margin-top: 40px; font-size: 16px;">
              Módulo en construcción...
            </p>
          </div>
        `
        return  // ← AGREGAR ESTA LÍNEA
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
