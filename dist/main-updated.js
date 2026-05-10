import './styles/main.css'
import { onAuthChange, getUserProfile } from './lib/firebase.js'
import { renderLogin } from './pages/login.js'
import { renderApp } from './pages/app.js'
import { renderDiaD } from './modules/dia-d-militantes.js'
import { renderDiaDAdmin } from './modules/dia-d-admin.js'
import { initPWA, createInstallButton } from './lib/pwa.js'

const root = document.getElementById('app')
let currentUser = null
let currentProfile = null

// Inicializar PWA
initPWA()

async function init() {
  root.innerHTML = '<div class="loader"><div class="spinner"></div> Cargando...</div>'
  onAuthChange(async (user) => {
    if (user) {
      currentUser = user
      currentProfile = await getUserProfile(user.uid)
      if (!currentProfile) {
        // first time: create basic profile
        const { createUserProfile } = await import('./lib/firebase.js')
        await createUserProfile(user.uid, {
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0]
        })
        currentProfile = await getUserProfile(user.uid)
      }
      renderApp(root, currentUser, currentProfile)
      
      // Inyectar botón instalar en la app (después de renderizar)
      setTimeout(() => {
        const mainContent = document.getElementById('main-content')
        if (mainContent && !document.getElementById('pwa-install-btn')) {
          const installBtn = createInstallButton()
          mainContent.insertBefore(installBtn, mainContent.firstChild)
        }
      }, 500)
    } else {
      renderLogin(root, () => {
        // auth change will trigger re-render
      })
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
        const userDoc = await firebase.firestore().collection('users').doc(currentUser.uid).get()
        const rol = userDoc.data()?.role
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
