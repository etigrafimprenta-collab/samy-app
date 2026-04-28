import { logoutUser } from '../lib/firebase.js'
import { renderSearch } from './search.js'
import { renderMyRecords } from './myRecords.js'
import { renderAdmin } from './admin.js'
import { renderDiaD } from '../modules/dia-d-militantes.js'
import { renderDiaDAdmin } from '../modules/dia-d-admin.js'

export function renderApp(root, user, profile) {
  let currentPage = 'search'
  const isAdmin = profile?.role === 'admin'

  function render() {
    root.innerHTML = `
      <div class="header" style="background: linear-gradient(135deg, #c41e3a 0%, #8b1428 100%); padding: 0; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <div class="header-inner" style="
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px 16px;
          width: 100%;
        ">
          
          <!-- Primera fila: Logo + Nombres -->
          <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
            <img src="/samy.jpg" alt="Samy Fidabel" style="width: 48px; height: 48px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.2); flex-shrink: 0;" />
            
            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
              <div style="font-family: 'Barlow Condensed', sans-serif; font-size: 1rem; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1;">
                Samy Fidabel
              </div>
              <div style="font-family: 'Barlow Condensed', sans-serif; font-size: 0.75rem; font-weight: 600; color: #ffd700; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1;">
                Lista 6 · Opción 1
              </div>
            </div>

            <div style="width: 1px; height: 50px; background: rgba(255,255,255,0.3); flex-shrink: 0;"></div>

            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
              <div style="color: #ffd700; font-family: 'Barlow Condensed', sans-serif; font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; line-height: 1;">
                Milciades Sanabria
              </div>
              <div style="color: #ffd700; font-family: 'Barlow', sans-serif; font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1;">
                Intendente
              </div>
            </div>
          </div>

          <!-- Segunda fila: Botones de navegación -->
          <div class="header-nav" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; width: 100%;">
            <button class="btn-nav" data-page="search" style="
              padding: 8px 12px;
              border: 2px solid ${currentPage === 'search' ? '#ffd700' : 'rgba(255,255,255,0.5)'};
              background: ${currentPage === 'search' ? '#ffd700' : 'transparent'};
              color: ${currentPage === 'search' ? '#8b1428' : '#fff'};
              border-radius: 6px;
              font-weight: 600;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
              flex: 1;
              min-width: 80px;
            ">
              🔍 Buscar
            </button>
            <button class="btn-nav" data-page="records" style="
              padding: 8px 12px;
              border: 2px solid ${currentPage === 'records' ? '#ffd700' : 'rgba(255,255,255,0.5)'};
              background: ${currentPage === 'records' ? '#ffd700' : 'transparent'};
              color: ${currentPage === 'records' ? '#8b1428' : '#fff'};
              border-radius: 6px;
              font-weight: 600;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
              flex: 1;
              min-width: 80px;
            ">
              📋 Registros
            </button>
            <button class="btn-nav" data-page="dia-d" style="
              padding: 8px 12px;
              border: 2px solid ${currentPage === 'dia-d' ? '#ffd700' : 'rgba(255,255,255,0.5)'};
              background: ${currentPage === 'dia-d' ? '#ffd700' : 'transparent'};
              color: ${currentPage === 'dia-d' ? '#8b1428' : '#fff'};
              border-radius: 6px;
              font-weight: 600;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
              flex: 1;
              min-width: 80px;
            ">
              🗳️ DÍA D
            </button>
            ${isAdmin ? `
            <button class="btn-nav" data-page="admin" style="
              padding: 8px 12px;
              border: 2px solid ${currentPage === 'admin' ? '#ffd700' : 'rgba(255,255,255,0.5)'};
              background: ${currentPage === 'admin' ? '#ffd700' : 'transparent'};
              color: ${currentPage === 'admin' ? '#8b1428' : '#fff'};
              border-radius: 6px;
              font-weight: 600;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
              flex: 1;
              min-width: 70px;
            ">
              ⚙️ Admin
            </button>
            ` : ''}
            <button class="btn-logout" id="btn-logout" title="${user.email}" style="
              padding: 8px 12px;
              background: rgba(255,255,255,0.2);
              color: #fff;
              border: 2px solid rgba(255,255,255,0.3);
              border-radius: 6px;
              font-weight: 600;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
              min-width: 60px;
            ">
              Salir
            </button>
          </div>
        </div>
      </div>
      <div class="main" id="page-content" style="padding: 16px;"></div>
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
    if (currentPage === 'search') renderSearch(content, user, profile)
    else if (currentPage === 'records') renderMyRecords(content, user)
    else if (currentPage === 'dia-d') {
      if (isAdmin) {
        renderDiaDAdmin(content)
      } else {
        renderDiaD(content, user)
      }
    }
    else if (currentPage === 'admin' && isAdmin) renderAdmin(content)
  }

  render()
}
