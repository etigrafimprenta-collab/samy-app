import { loginUser, registerUser, createUserProfile } from '../lib/firebase.js'

export function renderLogin(root) {
  let isRegister = false

  function render() {
    root.innerHTML = `
      <div class="login-page">
        <img src="/logo.png" alt="Samy Fidabel" class="login-logo" />
        <div class="login-title">SAMY FIDABEL</div>
        <div class="login-sub">Lista 6 · Opción 1 · Concejal 2026</div>

        <div class="login-card">
          <h2>${isRegister ? 'Registrarse' : 'Iniciar Sesión'}</h2>
          <div id="login-alert"></div>

          ${isRegister ? `
            <div class="form-group">
              <label class="form-label">Nombre completo</label>
              <input class="form-input" id="inp-name" type="text" placeholder="Tu nombre" />
            </div>
          ` : ''}

          <div class="form-group">
            <label class="form-label">Correo electrónico</label>
            <input class="form-input" id="inp-email" type="email" placeholder="correo@ejemplo.com" />
          </div>

          <div class="form-group">
            <label class="form-label">Contraseña</label>
            <input class="form-input" id="inp-pass" type="password" placeholder="••••••••" />
          </div>

          <button class="btn btn-primary btn-full" id="btn-submit">
            ${isRegister ? 'Crear cuenta' : 'Ingresar'}
          </button>

          <div class="login-toggle">
            ${isRegister
              ? 'Ya tenés cuenta? <button id="btn-toggle">Iniciar sesión</button>'
              : 'No tenés cuenta? <button id="btn-toggle">Registrarse</button>'
            }
          </div>
        </div>
      </div>
    `

    document.getElementById('btn-toggle').addEventListener('click', () => {
      isRegister = !isRegister
      render()
    })

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
      if (isRegister) {
        const name = document.getElementById('inp-name').value.trim()
        const cred = await registerUser(email, pass)
        await createUserProfile(cred.user.uid, {
          email,
          displayName: name || email.split('@')[0]
        })
      } else {
        await loginUser(email, pass)
      }
    } catch (err) {
      const msgs = {
        'auth/user-not-found': 'Usuario no encontrado.',
        'auth/wrong-password': 'Contraseña incorrecta.',
        'auth/email-already-in-use': 'Ese correo ya está registrado.',
        'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
        'auth/invalid-email': 'Correo inválido.',
        'auth/invalid-credential': 'Correo o contraseña incorrectos.'
      }
      alertEl.innerHTML = `<div class="alert alert-error">${msgs[err.code] || err.message}</div>`
      btn.disabled = false
      btn.textContent = isRegister ? 'Crear cuenta' : 'Ingresar'
    }
  }

  render()
}
