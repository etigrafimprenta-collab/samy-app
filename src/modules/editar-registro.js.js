/**
 * MÓDULO: EDITAR REGISTRO
 * Permite al ADMIN editar nombre, dirección, mesa, orden y celular
 */

export function mostrarModalEditar(registro, user) {
  // Solo admin puede editar
  if (user.role !== 'admin') {
    alert('❌ Solo administradores pueden editar registros')
    return
  }

  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 20px;'

  const html = `
    <div style="background: white; border-radius: 8px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 1.5rem; text-transform: uppercase;">✏️ EDITAR REGISTRO</h2>
        <div style="font-size: 0.9rem; margin-top: 8px;">CI: ${registro.cedula} | ${registro.nombre} ${registro.apellidos}</div>
      </div>

      <div style="padding: 20px; display: grid; gap: 16px;">
        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">📝 Nombre:</label>
          <input id="input-nombre" type="text" value="${registro.nombre || ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">📍 Dirección:</label>
          <input id="input-direccion" type="text" value="${registro.direccion || ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-weight: 700; margin-bottom: 8px;">🗳️ Mesa:</label>
            <input id="input-mesa" type="text" value="${registro.mesa || ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
          </div>

          <div>
            <label style="display: block; font-weight: 700; margin-bottom: 8px;">🔢 Orden:</label>
            <input id="input-orden" type="text" value="${registro.orden || ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
          </div>
        </div>

        <div>
          <label style="display: block; font-weight: 700; margin-bottom: 8px;">📱 Celular:</label>
          <input id="input-celular" type="text" value="${registro.telefono || ''}" placeholder="Sin +595, solo 9 dígitos" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>

        <div style="display: flex; gap: 12px; margin-top: 12px;">
          <button id="btn-guardar-edicion" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
            💾 GUARDAR
          </button>
          <button id="btn-cancelar-edicion" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">
            ❌ CANCELAR
          </button>
        </div>
      </div>
    </div>
  `

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    modal.remove()
  })

  document.getElementById('btn-guardar-edicion').addEventListener('click', async () => {
    const nombre = document.getElementById('input-nombre').value.trim()
    const direccion = document.getElementById('input-direccion').value.trim()
    const mesa = document.getElementById('input-mesa').value.trim()
    const orden = document.getElementById('input-orden').value.trim()
    const celular = normalizarTelefono(document.getElementById('input-celular').value.trim())

    if (!nombre) {
      alert('❌ El nombre no puede estar vacío')
      return
    }

    await guardarEdicion(registro.id, { nombre, direccion, mesa, orden, telefono: celular }, modal)
  })
}

function normalizarTelefono(tel) {
  if (!tel) return ''
  const solo_numeros = tel.replace(/\D/g, '')
  if (solo_numeros.startsWith('595')) {
    return solo_numeros.substring(3)
  }
  if (solo_numeros.length === 9) {
    return solo_numeros
  }
  return solo_numeros.slice(-9)
}

async function guardarEdicion(registroId, cambios, modal) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { doc, updateDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    await updateDoc(doc(db, 'savedRecords', registroId), cambios)

    alert('✅ Registro actualizado correctamente')
    modal.remove()
    location.reload()
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}