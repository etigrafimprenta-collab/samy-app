import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "../lib/firebase.js"

export function renderMesarioLogin(root, onLoginSuccess) {
  root.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
      <div style="background: white; padding: 40px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 400px;">
        <h1 style="text-align: center; margin-bottom: 30px; color: #1e3a8a; font-size: 24px;">📊 Mesarios</h1>
        <h2 style="text-align: center; margin-bottom: 30px; color: #666; font-size: 16px; font-weight: 400;">Login - Samy 2026</h2>
        <form id="mesarioLoginForm" style="display: flex; flex-direction: column; gap: 15px;">
          <input type="email" id="email" placeholder="Email de mesario" required style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
          <input type="password" id="password" placeholder="Contraseña" required style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
          <button type="submit" style="padding: 12px; background: #667eea; color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer;">Ingresar</button>
        </form>
        <div id="errorMsg" style="color: #dc2626; margin-top: 15px; text-align: center; font-size: 14px; display: none;"></div>
      </div>
    </div>
  `

  const form = document.getElementById("mesarioLoginForm")
  const errorMsg = document.getElementById("errorMsg")

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const email = document.getElementById("email").value.trim()
    const password = document.getElementById("password").value.trim()
    errorMsg.style.display = "none"

    try {
      await signInWithEmailAndPassword(auth, email, password)
      onLoginSuccess()
    } catch (error) {
      errorMsg.textContent = `Error: ${error.message}`
      errorMsg.style.display = "block"
    }
  })
}
