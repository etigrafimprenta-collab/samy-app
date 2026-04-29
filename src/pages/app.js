import { logoutUser } from '../lib/firebase.js'
import { createInstallButton } from '../lib/pwa.js'
import { renderSearch } from './search.js'
import { renderMyRecords } from './myRecords.js'
import { renderAdmin } from './admin.js'
import { renderDiaD } from '../modules/dia-d-militantes.js'
import { renderDiaDAdmin } from '../modules/dia-d-admin.js'

export function renderApp(root, user, profile) {
  let currentPage = 'search'
  const isAdmin = profile?.role === 'admin'
  const installBtn = createInstallButton()

  function render() {
    root.innerHTML = `
      <div class="header" style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); padding: 0; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <div class="header-inner" style="display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; width: 100%;">
          <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
            <img src="/logo.png" alt="Samy Fidabel" style="width: 48px; height: 48px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.2); flex-shrink: 0;" />
            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
              <div style="font-family: 'Barlow Condensed', sans-serif; font-size: 1rem; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.5px;">Samy Fidabel</div>
              <div style="font-family: 'Barlow Condensed', sans-serif; font-size: 0.75rem; font-weight: 600; color: #ffd700; text-transform: uppercase;">Lista 6 - Opcion 1</div>
            </div>
            <div style="width: 1px; height: 50px; background: rgba(255,255,255,0.3);"></div>
            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
              <div style="color: #ffd700; font-family: 'Barlow Condensed', sans-serif; font-size: 0.95rem; font-weight: 700; text-transform: uppercase;">Milciades Sanabria</div>
              <div style="color: #ffd700; font-family: 'Barlow', sans-serif; font-size: 0.75rem; font-weight: 500; text-transform: uppercase;">Intendente</div>
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn-nav" data-page="search" style="padding: 8px 12px; border: 2px solid ${currentPage === 'search' ? '#ffd700' : 'rgba(255,255,255,0.5)'}; background: ${currentPage === 'search' ? '#ffd700' : 'transparent'}; color: ${currentPage === 'search' ? '#8b1428' : '#fff'}; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; flex: 1; min-width: 80px;">Buscar</button>
            <button class="btn-nav" data-page="records" style="padding: 8px 12px; border: 2px solid ${currentPage === 'records' ? '#ffd700' : 'rgba(255,255,255,0.5)'}; background: ${currentPage === 'records' ? '#ffd700' : 'transparent'}; color: ${currentPage === 'records' ? '#8b1428' : '#fff'}; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; flex: 1; min-width: 80px;">Registros</button>
            <button class="btn-nav" data-page="dia-d" style="padding: 8px 12px; border: 2px solid ${currentPage === 'dia-d' ? '#ffd700' : 'rgba(255,255,255,0.5)'}; background: ${currentPage === 'dia-d' ? '#ffd700' : 'transparent'}; color: ${currentPage === 'dia-d' ? '#8b1428' : '#fff'}; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; flex: 1; min-width: 80px;">Dia D</button>
            ${isAdmin ? '<button class="btn-nav" data-page="admin" style="padding: 8px 12px; border: 2px solid ' + (currentPage === 'admin' ? '#ffd700' : 'rgba(255,255,255,0.5)') + '; background: ' + (currentPage === 'admin' ? '#ffd700' : 'transparent') + '; color: ' + (currentPage === 'admin' ? '#8b1428' : '#fff') + '; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; flex: 1; min-width: 70px;">Admin</button>' : ''}
            <button id="btn-logout" style="padding: 8px 12px; background: rgba(255,255,255,0.2); color: #fff; border: 2px solid rgba(255,255,255,0.3); border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; min-width: 60px;">Salir</button>
          </div>
        </div>
      </div>
      <div id="page-content" style="padding: 16px;"></div>
    `

    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = btn.dataset.page
        render()
      })
    })

    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (confirm('¿Cerrar sesión?')) await logoutUser()
    })

    const content = document.getElementById('page-content')
    content.appendChild(installBtn)

    if (currentPage === 'search') renderSearch(content, user, profile)
    else if (currentPage === 'records') renderMyRecords(content, user)
    else if (currentPage === 'dia-d') {
      if (isAdmin) renderDiaDAdmin(content)
      else renderDiaD(content, user)
    }
    else if (currentPage === 'admin' && isAdmin) renderAdmin(content)
  }

  render()
}