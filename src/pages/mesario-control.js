import { getVotantesDelMesario, getNuestrosVotosDeMesa, marcarVoto, getVotosDelMesario } from "../lib/firebase.js"
import { logoutUser, deleteDoc, doc, db } from "../lib/firebase.js"

export async function renderMesarioControl(root, user, profile) {
  const seccional = profile?.seccional || ""
  const mesa = profile?.mesa || ""

  if (!seccional || !mesa) {
    root.innerHTML = `<div class="alert alert-error">Error: No tiene seccional/mesa asignada</div>`
    return
  }

  root.innerHTML = "<div class=\"loader\"><div class=\"spinner\"></div> Cargando votantes...</div>"

  try {
    let votantes = await getVotantesDelMesario(seccional, mesa)
    const nuestros = await getNuestrosVotosDeMesa(seccional, mesa)
    let votaron = await getVotosDelMesario(seccional, mesa)

    // ORDENAR POR ORDEN AUTOMÁTICAMENTE
    votantes = votantes.sort((a, b) => {
      const ordenA = parseInt(a.orden) || 999999
      const ordenB = parseInt(b.orden) || 999999
      return ordenA - ordenB
    })

    const totalVotantes = votantes.length
    const totalNuestros = nuestros.size
    const totalVotaron = votaron.size

    root.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-size: 0.9rem; opacity: 0.9;">Seccional ${seccional} - Mesa ${mesa}</div>
            <div style="font-size: 1.3rem; font-weight: 700;">📊 Control de Votación</div>
          </div>
          <button id="btn-logout" style="padding: 8px 16px; background: rgba(255,255,255,0.2); color: white; border: 2px solid rgba(255,255,255,0.5); border-radius: 6px; cursor: pointer; font-weight: 600;">Salir</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; text-align: center;">
            <div style="font-size: 0.85rem; opacity: 0.9;">Total Votantes</div>
            <div style="font-size: 1.8rem; font-weight: 700;">${totalVotantes}</div>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; text-align: center;">
            <div style="font-size: 0.85rem; opacity: 0.9;">Nuestros</div>
            <div style="font-size: 1.8rem; font-weight: 700;">🔴 ${totalNuestros}</div>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; text-align: center;">
            <div style="font-size: 0.85rem; opacity: 0.9;">Votaron</div>
            <div style="font-size: 1.8rem; font-weight: 700;">✅ ${totalVotaron}</div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 16px;">
        <input type="text" id="search-votantes" placeholder="🔍 Buscar por nombre o cédula..." style="width: 100%; padding: 12px; border: 2px solid #ccc; border-radius: 6px; font-size: 1rem;" />
      </div>

      <div id="votantes-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
    `

    const searchInput = root.querySelector("#search-votantes")
    const votantesList = root.querySelector("#votantes-list")

    function renderVotantes(filtered) {
      votantesList.innerHTML = filtered.map(v => {
        const esNuestro = nuestros.has(v.cedula)
        const yaVoto = votaron.has(v.cedula)
        const bgColor = yaVoto ? "#f0f0f0" : esNuestro ? "#fef3c7" : "#fff"
        const borderLeft = yaVoto ? "none" : esNuestro ? "4px solid #dc2626" : "none"

        return `
          <div class="votante-card" data-cedula="${v.cedula}" style="background: ${bgColor}; padding: 12px; border-radius: 6px; border-left: ${borderLeft}; display: flex; justify-content: space-between; align-items: center; cursor: pointer; opacity: ${yaVoto ? 0.7 : 1};">
            <div style="flex: 1;">
              <div style="font-weight: 700; font-size: 0.95rem;">${v.nombre}</div>
              <div style="font-size: 0.85rem; color: #666;">CI ${v.cedula} · Orden <strong>${v.orden}</strong></div>
            </div>
            <div style="display: flex; gap: 6px;">
              ${yaVoto ? `
                <button class="btn-unmark" data-cedula="${v.cedula}" style="padding: 6px 12px; background: #f97316; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">↩️ Revertir</button>
              ` : `
                <button class="btn-vote" data-cedula="${v.cedula}" style="padding: 6px 12px; background: #22c55e; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">▶ Marcar</button>
              `}
            </div>
          </div>
        `
      }).join("")

      // MARCAR VOTO
      votantesList.querySelectorAll(".btn-vote").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation()
          const cedula = btn.dataset.cedula
          if (votaron.has(cedula)) return
          try {
            btn.disabled = true
            btn.textContent = "Guardando..."
            await marcarVoto(seccional, mesa, cedula)
            votaron.add(cedula)
            renderVotantes(filtered)
          } catch (err) {
            alert("Error: " + err.message)
            btn.disabled = false
            btn.textContent = "▶ Marcar"
          }
        })
      })

      // DESMARCAR VOTO
      votantesList.querySelectorAll(".btn-unmark").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation()
          const cedula = btn.dataset.cedula
          if (!confirm("¿Desmarcar este voto?")) return
          try {
            btn.disabled = true
            btn.textContent = "Revirtiendo..."
            const docId = `${seccional}_${mesa}_${cedula}`
            await deleteDoc(doc(db, 'mesa_votacion2025', docId))
            votaron.delete(cedula)
            renderVotantes(filtered)
          } catch (err) {
            alert("Error: " + err.message)
            btn.disabled = false
            btn.textContent = "↩️ Revertir"
          }
        })
      })
    }

    renderVotantes(votantes)

    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim()
      const filtered = term ? votantes.filter(v => v.nombre.toLowerCase().includes(term) || v.cedula.includes(term)) : votantes
      renderVotantes(filtered)
    })

    root.querySelector("#btn-logout").addEventListener("click", async () => {
      if (confirm("¿Cerrar sesión?")) await logoutUser()
    })

  } catch (err) {
    root.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`
  }
}