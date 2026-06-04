/**
 * MÓDULO: DASHBOARD CHOFER
 * Lo que ve un chofer logueado - sus votantes asignados
 */

import { getChofersVotantesByUser } from '../lib/firebase.js'

export async function renderChofersVotantes(container) {
  try {
    const user = (await import('firebase/auth')).getAuth().currentUser
    
    if (!user) {
      container.innerHTML = '<p>No autorizado</p>'
      return
    }

    const chofersData = await getChofersVotantesByUser(user.uid)
    
    if (!chofersData) {
      container.innerHTML = `
        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; text-align: center;">
          <h3>⚠️ No tienes asignación como chofer</h3>
          <p>Espera a que el administrador te designe como chofer.</p>
        </div>
      `
      return
    }

    const votantes = chofersData.votantes || []

    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">
          🚗 MIS VOTANTES
        </h2>
        <p style="margin: 8px 0 0 0; font-size: 0.95rem; opacity: 0.95;">
          Vehículo: ${chofersData.vehiculo} (${chofersData.tipoVehiculo}) | Seccional: ${chofersData.seccional}
        </p>
      </div>

      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; font-family: 'Barlow Condensed'; text-transform: uppercase;">
            📋 LISTA DE VOTANTES (${votantes.length})
          </h3>
          <div style="display: flex; gap: 8px;">
            <button id="btn-descargar" style="background: #ff9800; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              📥 DESCARGAR EXCEL
            </button>
            <button id="btn-whatsapp-lista" style="background: #25d366; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-weight: 700;">
              📲 VÍA WHATSAPP
            </button>
          </div>
        </div>

        ${votantes.length === 0 ? `
          <div style="padding: 40px; text-align: center; color: #999;">
            <p style="font-size: 1.1rem; margin: 0;">📭 No tienes votantes asignados aún</p>
            <p style="margin: 8px 0 0 0; font-size: 0.9rem;">El administrador te asignará votantes pronto</p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead style="background: #000; color: white; position: sticky; top: 0;">
                <tr>
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Nombre</th>
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Cédula</th>
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Celular</th>
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Local Votación</th>
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${votantes.map(v => `
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px;"><strong>${v.nombre}</strong></td>
                    <td style="padding: 10px; font-family: monospace;">${v.cedula}</td>
                    <td style="padding: 10px;">
                      <a href="tel:+595${v.celular}" style="color: #1976d2; text-decoration: none; font-weight: 600;">
                        📱 ${v.celular}
                      </a>
                    </td>
                    <td style="padding: 10px; background: #f5f5f5; border-radius: 3px;">
                      <strong>${v.local || '⚠️ Sin asignar'}</strong>
                    </td>
                    <td style="padding: 10px;">
                      <button class="btn-wa-votante" data-celular="${v.celular}" data-nombre="${v.nombre}" style="background: #25d366; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        💬
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <div style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 16px; border-radius: 4px;">
        <p style="margin: 0; font-size: 0.9rem; font-weight: 700;">
          ✅ <strong>INSTRUCCIONES:</strong>
        </p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 0.85rem;">
          <li>Coordina con cada votante para confirmar horarios</li>
          <li>Recoge en los puntos acordados y lleva al local de votación</li>
          <li>Descarga la lista para tenerla offline</li>
          <li>Puedes enviar mensajes por WhatsApp a cada votante</li>
        </ul>
      </div>
    `

    document.getElementById('btn-descargar').addEventListener('click', () => {
      downloadVotantesList(votantes, chofersData.id, chofersData.nombre)
    })

    document.getElementById('btn-whatsapp-lista').addEventListener('click', () => {
      // Enviar lista como texto
      const listText = votantes.map((v, i) => 
        `${i + 1}. ${v.nombre} (${v.cedula}) - 📱 ${v.celular}`
      ).join('\n')
      
      const msg = `📋 LISTA DE VOTANTES A TRANSPORTAR:\n\n${listText}\n\n✅ Total: ${votantes.length} votantes`
      const encoded = encodeURIComponent(msg)
      window.open(`https://wa.me/${chofersData.celular}?text=${encoded}`, '_blank')
    })

    document.querySelectorAll('.btn-wa-votante').forEach(btn => {
      btn.addEventListener('click', async () => {
        const celular = btn.getAttribute('data-celular')
        const nombre = btn.getAttribute('data-nombre')
        const { shareWhatsAppDirect } = await import('./search.js')
        shareWhatsAppDirect(celular, { nombre })
      })
    })

  } catch (err) {
    container.innerHTML = `<p style="color: #d32f2f;">Error: ${err.message}</p>`
  }
}