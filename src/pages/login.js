import { loginUser } from '../lib/firebase.js'

// No hay self-registro: toda cuenta nueva la crea un campaign_admin (desde
// "Usuarios" en su panel) o llega por un link de invitación puntual (ver
// acceptInvite.js) — nunca eligiendo el propio usuario a qué candidato se
// suma.
export function renderLogin(root) {
  function render() {
    root.innerHTML = `
      <div class="login-page">
        <div class="login-wordmark">SIGEV</div>
        <div class="login-title">SIGEV</div>
        <div class="login-sub">Sistema Integral de Gestión Electoral y Votaciones</div>
        <div class="login-desc">Plataforma profesional para la administración integral de campañas electorales.</div>

        <div class="login-card">
          <h2>Iniciar Sesión</h2>
          <div id="login-alert"></div>

          <div class="form-group">
            <label class="form-label">Correo electrónico</label>
            <input class="form-input" id="inp-email" type="email" placeholder="correo@ejemplo.com" />
          </div>

          <div class="form-group">
            <label class="form-label">Contraseña</label>
            <input class="form-input" id="inp-pass" type="password" placeholder="••••••••" />
          </div>

          <button class="btn btn-primary btn-full" id="btn-submit">Ingresar</button>
        </div>
      </div>
    `

    document.getElementById('btn-submit').addEventListener('click', handleSubmit)
    document.getElementById('inp-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit()
    })
  }

  async function handleSubmit() {
    const email = document.getElementById('inp-email').value.trim()
    const pass = document.getElementById('inp-pass').value
    const alertEl = document.getElementById('login-alert')
    const btn = document.getElementById('btn-submit')

    if (!email || !pass) {
      alertEl.innerHTML = '<div class="alert alert-error">Completá todos los campos.</div>'
      return
    }

    btn.disabled = true
    btn.textContent = 'Procesando...'
    alertEl.innerHTML = ''

    try {
      await loginUser(email, pass)
    } catch (err) {
      const msgs = {
        'auth/user-not-found': 'Usuario no encontrado.',
        'auth/wrong-password': 'Contraseña incorrecta.',
        'auth/invalid-email': 'Correo inválido.',
        'auth/invalid-credential': 'Correo o contraseña incorrectos.'
      }
      alertEl.innerHTML = `<div class="alert alert-error">${msgs[err.code] || err.message}</div>`
      btn.disabled = false
      btn.textContent = 'Ingresar'
    }
  }

  render()
}
