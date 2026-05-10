// pwa.js - Utilidades para PWA install prompt
let deferredPrompt = null
let isIOSStandalone = false

export function initPWA() {
  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('✅ Service Worker registrado'))
      .catch(err => console.error('❌ Error SW:', err))
  }

  // Android: escuchar beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    console.log('📱 App es instalable (Android)')
    // Disparar evento para que los componentes se enteres
    window.dispatchEvent(new CustomEvent('pwa-ready'))
  })

  // iOS: detectar si está en modo standalone
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isStandalone = window.navigator.standalone === true
  
  if (isIOS && !isStandalone) {
    isIOSStandalone = true
    console.log('📱 iOS detectado (no instalado aún)')
    window.dispatchEvent(new CustomEvent('pwa-ios'))
  }

  // Cuando se instala: limpiar prompt
  window.addEventListener('appinstalled', () => {
    console.log('✅ App instalada')
    deferredPrompt = null
    window.dispatchEvent(new CustomEvent('pwa-installed'))
  })
}

export async function promptInstall() {
  if (!deferredPrompt) {
    console.warn('Install prompt no disponible')
    return false
  }

  deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  console.log(`Usuario eligió: ${outcome}`)
  deferredPrompt = null
  return outcome === 'accepted'
}

export function isInstallable() {
  return deferredPrompt !== null
}

export function isIOSApp() {
  return isIOSStandalone
}

export function createInstallButton() {
  const btn = document.createElement('button')
  btn.id = 'pwa-install-btn'
  btn.innerHTML = '📱 Instalar en tu dispositivo'
  btn.style.cssText = `
    background: #FFD700;
    color: #C41E3A;
    border: none;
    padding: 10px 16px;
    border-radius: 6px;
    font-weight: bold;
    font-size: 13px;
    cursor: pointer;
    display: none;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin-bottom: 15px;
  `
  
  btn.addEventListener('click', async () => {
    const success = await promptInstall()
    if (success) {
      btn.style.display = 'none'
    }
  })

  // Mostrar cuando esté listo
  window.addEventListener('pwa-ready', () => {
    btn.style.display = 'flex'
  })

  // Para iOS: mostrar siempre instrucciones
  window.addEventListener('pwa-ios', () => {
    btn.innerHTML = '📱 Ver instrucciones de instalación'
    btn.style.display = 'flex'
    btn.onclick = () => {
      alert(`Para instalar en iOS:\n\n1. Toca el botón Compartir (abajo)\n2. Desplázate y toca "Agregar a pantalla de inicio"\n3. Toca "Agregar"`)
    }
  })

  return btn
}
