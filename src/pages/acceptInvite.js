// Pantalla que ve alguien sin cuenta que abrió un link de invitación
// (?invite=xxx, ver main.js). No hay self-registro genérico: el
// candidateId y el rol ya vienen fijados por quien generó el link
// (campaign_admin, ver renderUsuarios en campaign.js) — acá solo se pide
// nombre/email/contraseña y se valida server-side contra esa invitación
// puntual (funciones crearInvitacion/validarInvitacion/aceptarInvitacion
// en functions/src/index.ts).
import { loginUser } from '../lib/firebase.js'
import { functionsInstance } from '../lib/firebase.js'
import { httpsCallable } from 'firebase/functions'
import { escapeHtml } from '../lib/escapeHtml.js'
import { ROLE_LABELS } from '../lib/roleLabels.js'

export async function renderAcceptInvite(root, inviteId) {
  root.innerHTML = '<div class="loader"><div class="spinner"></div> Verificando invitación...</div>'

  let invite
  try {
    const validarInvitacion = httpsCallable(functionsInstance, 'validarInvitacion')
    const result = await validarInvitacion({ inviteId })
    invite = result.data
  } catch (err) {
    renderError('No se pudo verificar la invitación. Probá de nuevo más tarde.')
    return
  }

  if (!invite.valid) {
    const motivos = {
      no_existe: 'Este link de invitación no existe.',
      ya_usada: 'Este link de invitación ya fue usado.',
      expirada: 'Este link de invitación expiró.'
    }
    renderError(motivos[invite.reason] || 'Este link de invitación ya no es válido.')
    return
  }

  root.innerHTML = `
    <div class="login-page">
      <div class="login-wordmark">SIGEV</div>
      <div class="login-title">SIGEV</div>
      <div class="login-sub">Sistema Integral de Gestión Electoral y Votaciones</div>

      <div class="login-card">
        <h2>Crear tu cuenta</h2>
        <p style="font-size:.88rem; color:#666; margin:0 0 18px;">
          Te invitaron a unirte a <strong>${escapeHtml(invite.candidateName)}</strong> como
          <strong>${escapeHtml(ROLE_LABELS[invite.role] || invite.role)}</strong>.
        </p>
        <div id="invite-alert"></div>

        <div class="form-group">
          <label class="form-label">Nombre completo</label>
          <input class="form-input" id="inp-name" type="text" placeholder="Tu nombre" />
        </div>

        <div class="form-group">
          <label class="form-label">Correo electrónico</label>
          <input class="form-input" id="inp-email" type="email" placeholder="correo@ejemplo.com" />
        </div>

        <div class="form-group">
          <label class="form-label">Contraseña</label>
          <input class="form-input" id="inp-pass" type="password" placeholder="Mínimo 6 caracteres" />
        </div>

        <button class="btn btn-primary btn-full" id="btn-submit">Crear cuenta y entrar</button>
      </div>
    </div>
  `

  document.getElementById('btn-submit').addEventListener('click', handleSubmit)
  document.getElementById('inp-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit()
  })

  async function handleSubmit() {
    const nombre = document.getElementById('inp-name').value.trim()
    const email = document.getElementById('inp-email').value.trim()
    const pass = document.getElementById('inp-pass').value
    const alertEl = document.getElementById('invite-alert')
    const btn = document.getElementById('btn-submit')

    if (!nombre || !email || !pass) {
      alertEl.innerHTML = '<div class="alert alert-error">Completá todos los campos.</div>'
      return
    }

    btn.disabled = true
    btn.textContent = 'Creando cuenta...'
    alertEl.innerHTML = ''

    try {
      const aceptarInvitacion = httpsCallable(functionsInstance, 'aceptarInvitacion')
      await aceptarInvitacion({ inviteId, nombre, email, password: pass })
      // Sacar ?invite= de la URL ANTES de loguear: main.js ahora revisa
      // ese param en cada onAuthChange (fix de la sesión-existente-bloquea-
      // la-invitación) sin importar si hay usuario o no, así que si se
      // deja el param puesto, el login que sigue dispara onAuthChange de
      // nuevo, encuentra el mismo inviteId ya usado y muestra "invitación
      // no válida" en vez de entrar al panel — justo después de crear la
      // cuenta con éxito.
      window.history.replaceState(null, '', window.location.pathname)
      await loginUser(email, pass)
      // onAuthChange (main.js) toma el control desde acá y entra al panel.
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`
      btn.disabled = false
      btn.textContent = 'Crear cuenta y entrar'
    }
  }

  function renderError(msg) {
    root.innerHTML = `
      <div class="login-page">
        <div class="login-wordmark">SIGEV</div>
        <div class="login-card">
          <h2>Invitación no válida</h2>
          <div class="alert alert-error">${escapeHtml(msg)}</div>
          <p style="font-size:.85rem; color:#666; margin-top:14px;">Pedile a quien te invitó que te mande un link nuevo.</p>
        </div>
      </div>
    `
  }
}
