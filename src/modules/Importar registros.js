/**
 * MÓDULO: IMPORTAR REGISTROS DESDE EXCEL
 * Con 2 opciones: Carga Total y Actualización
 */

export function mostrarPanelImportar(container) {
  const html = `
    <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-family: 'Barlow Condensed'; font-size: 2rem; text-transform: uppercase;">📥 IMPORTAR REGISTROS</h2>
      <p style="margin: 0; font-size: 0.9rem;">Carga datos desde Excel</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
      <!-- OPCIÓN 1: CARGA TOTAL -->
      <div style="background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 24px;">
        <div style="font-size: 2rem; margin-bottom: 12px;">📤</div>
        <h3 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #1976d2;">Carga Total</h3>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 0.9rem;">Reemplaza el archivo completo o filas individuales seleccionadas del Excel.</p>
        <button id="btn-carga-total" style="background: #1976d2; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">
          📁 Seleccionar Excel
        </button>
        <input type="file" id="file-carga-total" accept=".xlsx,.xls,.csv" style="display: none;">
      </div>

      <!-- OPCIÓN 2: ACTUALIZACIÓN -->
      <div style="background: white; border: 2px solid #4caf50; border-radius: 8px; padding: 24px;">
        <div style="font-size: 2rem; margin-bottom: 12px;">🔄</div>
        <h3 style="margin: 0 0 12px 0; font-family: 'Barlow Condensed'; font-size: 1.2rem; text-transform: uppercase; color: #4caf50;">Actualización</h3>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 0.9rem;">Compara por cédula y actualiza datos faltantes (nombre, dirección, local, mesa, orden, teléfono).</p>
        <button id="btn-actualizacion" style="background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-weight: 700; width: 100%;">
          📁 Seleccionar Excel
        </button>
        <input type="file" id="file-actualizacion" accept=".xlsx,.xls,.csv" style="display: none;">
      </div>
    </div>

    <div id="resultado-container"></div>
  `

  container.innerHTML = html

  document.getElementById('btn-carga-total').addEventListener('click', () => {
    document.getElementById('file-carga-total').click()
  })

  document.getElementById('btn-actualizacion').addEventListener('click', () => {
    document.getElementById('file-actualizacion').click()
  })

  document.getElementById('file-carga-total').addEventListener('change', (e) => {
    procesarCargaTotal(e.target.files[0], container)
  })

  document.getElementById('file-actualizacion').addEventListener('change', (e) => {
    procesarActualizacion(e.target.files[0], container)
  })
}

async function procesarCargaTotal(file, container) {
  try {
    const datos = await leerExcel(file)
    if (!datos || datos.length === 0) {
      alert('❌ El archivo no contiene datos')
      return
    }

    // Mostrar preview y pedir autorización
    mostrarPreviewCargaTotal(datos, container)
  } catch (err) {
    alert('❌ Error al leer archivo: ' + err.message)
  }
}

async function procesarActualizacion(file, container) {
  try {
    const datos = await leerExcel(file)
    if (!datos || datos.length === 0) {
      alert('❌ El archivo no contiene datos')
      return
    }

    // Cargar datos actuales de Firebase
    const firebaseImport = await import('firebase/firestore')
    const { collection, getDocs } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    const recordsSnap = await getDocs(collection(db, 'savedRecords'))
    const datosActuales = {}
    recordsSnap.forEach(d => {
      const data = d.data()
      datosActuales[data.cedula] = { id: d.id, ...data }
    })

    // Comparar y detectar cambios
    mostrarPreviewActualizacion(datos, datosActuales, container)
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

async function leerExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        // Si es CSV
        if (file.name.endsWith('.csv')) {
          const csv = e.target.result
          const filas = csv.split('\n').filter(f => f.trim())
          const headers = filas[0].split(',').map(h => h.trim().toLowerCase())
          const datos = filas.slice(1).map(fila => {
            const valores = fila.split(',')
            const obj = {}
            headers.forEach((h, i) => {
              obj[h] = valores[i] ? valores[i].trim() : ''
            })
            return obj
          })
          resolve(datos)
        } else {
          // Para Excel necesitamos biblioteca externe (xlsx)
          // Por ahora usaremos una aproximación básica
          alert('Por favor usa archivos CSV. Los archivos Excel requieren biblioteca adicional.')
          resolve(null)
        }
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Error al leer archivo'))
    reader.readAsText(file)
  })
}

function normalizarTelefono(tel) {
  if (!tel) return ''
  const solo_numeros = tel.replace(/\D/g, '')
  // Si empieza con 595 o +595, quitar eso y dejar solo los 9 dígitos
  if (solo_numeros.startsWith('595')) {
    return solo_numeros.substring(3)
  }
  // Si tiene 9 dígitos, devolver tal cual
  if (solo_numeros.length === 9) {
    return solo_numeros
  }
  return solo_numeros.slice(-9)
}

function mostrarPreviewCargaTotal(datos, container) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">'
  html += '<div style="background: #1976d2; color: white; padding: 20px; border-radius: 8px 8px 0 0;"><h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">⚠️ CONFIRMAR CARGA TOTAL</h2></div>'
  html += '<div style="padding: 20px;">'
  html += '<div style="background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 12px; border-radius: 4px; margin-bottom: 16px;"><strong>Advertencia:</strong> Se reemplazarán ' + datos.length + ' registros en la base de datos. Esta acción no se puede deshacer.</div>'

  html += '<h3 style="font-family: Barlow Condensed; text-transform: uppercase; margin: 0 0 12px 0;">Vista previa (primeros 5 registros):</h3>'
  html += '<div style="overflow-x: auto; border: 1px solid #ddd; border-radius: 4px;">'
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">'
  html += '<tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">'
  Object.keys(datos[0]).forEach(key => {
    html += '<th style="padding: 8px; text-align: left; font-weight: 700; border-right: 1px solid #ddd;">' + key + '</th>'
  })
  html += '</tr>'
  datos.slice(0, 5).forEach(row => {
    html += '<tr style="border-bottom: 1px solid #ddd;">'
    Object.values(row).forEach(val => {
      html += '<td style="padding: 8px; border-right: 1px solid #ddd;">' + val + '</td>'
    })
    html += '</tr>'
  })
  html += '</table>'
  html += '</div>'

  html += '<div style="margin-top: 20px; display: flex; gap: 12px;">'
  html += '<button id="btn-confirmar-carga" style="flex: 1; background: #1976d2; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ CONFIRMAR CARGA</button>'
  html += '<button id="btn-cancelar-carga" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>'
  html += '</div>'
  html += '</div></div>'

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar-carga').addEventListener('click', () => modal.remove())
  document.getElementById('btn-confirmar-carga').addEventListener('click', async () => {
    await ejecutarCargaTotal(datos, modal, container)
  })
}

async function ejecutarCargaTotal(datos, modal, container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, writeBatch, query, getDocs, doc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    modal.remove()
    const progressModal = mostrarProgreso('Cargando registros...')

    const batch = writeBatch(db)
    let count = 0

    // Limpiar registros existentes (opcional) o solo agregar nuevos
    datos.forEach((row, index) => {
      const cedula = row.cedula || row['cédula'] || ''
      if (cedula.trim()) {
        const telefono = normalizarTelefono(row.telefono || row['teléfono'] || '')
        const docRef = doc(collection(db, 'savedRecords'))
        batch.set(docRef, {
          cedula: cedula.trim(),
          nombre: row.nombre || '',
          apellidos: row.apellidos || row['apellido'] || '',
          local: row.local || row['lugar de votación'] || '',
          mesa: row.mesa || '',
          orden: row.orden || '',
          telefono: telefono,
          uid: 'admin', // Asignar al admin
          timestamp: new Date()
        })
        count++
      }
    })

    await batch.commit()
    progressModal.remove()
    alert('✅ Se cargaron ' + count + ' registros exitosamente')
    location.reload()
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

function mostrarPreviewActualizacion(datosNuevos, datosActuales, container) {
  let cambios = []
  let nuevos = 0
  let actualizados = 0

  datosNuevos.forEach(row => {
    const cedula = (row.cedula || row['cédula'] || '').trim()
    if (!cedula) return

    if (datosActuales[cedula]) {
      const campos_cambiar = {}
      const campos_a_actualizar = ['nombre', 'apellidos', 'local', 'mesa', 'orden', 'telefono']
      
      campos_a_actualizar.forEach(campo => {
        const valor_nuevo = row[campo] || row[campo.replace('telefono', 'teléfono')] || ''
        const valor_actual = datosActuales[cedula][campo] || ''
        
        if (valor_nuevo.trim() && valor_nuevo.trim() !== valor_actual.trim()) {
          if (campo === 'telefono') {
            campos_cambiar[campo] = normalizarTelefono(valor_nuevo)
          } else {
            campos_cambiar[campo] = valor_nuevo.trim()
          }
        }
      })

      if (Object.keys(campos_cambiar).length > 0) {
        cambios.push({ cedula, campos_cambiar, tipo: 'actualizar' })
        actualizados++
      }
    } else {
      nuevos++
      const telefono = normalizarTelefono(row.telefono || row['teléfono'] || '')
      cambios.push({
        cedula,
        campos_cambiar: {
          nombre: row.nombre || '',
          apellidos: row.apellidos || row['apellido'] || '',
          local: row.local || row['lugar de votación'] || '',
          mesa: row.mesa || '',
          orden: row.orden || '',
          telefono: telefono
        },
        tipo: 'nuevo'
      })
    }
  })

  mostrarConfirmacionActualizacion(cambios, nuevos, actualizados, container)
}

function mostrarConfirmacionActualizacion(cambios, nuevos, actualizados, container) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; z-index: 9999; overflow-y: auto; padding: 20px;'

  let html = '<div style="background: white; border-radius: 8px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">'
  html += '<div style="background: #4caf50; color: white; padding: 20px; border-radius: 8px 8px 0 0;"><h2 style="margin: 0; font-family: Barlow Condensed; font-size: 1.5rem; text-transform: uppercase;">🔄 VISTA PREVIA ACTUALIZACIÓN</h2></div>'
  html += '<div style="padding: 20px;">'
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px;">'
  html += '<div style="background: #e8f5e9; padding: 12px; border-radius: 4px; border-left: 4px solid #4caf50;"><div style="font-weight: 700; color: #2e7d32;">+' + nuevos + '</div><div style="font-size: 0.8rem;">Nuevos</div></div>'
  html += '<div style="background: #fff3cd; padding: 12px; border-radius: 4px; border-left: 4px solid #ffc107;"><div style="font-weight: 700; color: #856404;">✏️ ' + actualizados + '</div><div style="font-size: 0.8rem;">Actualizados</div></div>'
  html += '</div>'

  html += '<h3 style="font-family: Barlow Condensed; text-transform: uppercase; margin: 16px 0 12px 0;">Cambios detectados:</h3>'
  html += '<div style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 12px;">'
  cambios.slice(0, 20).forEach(c => {
    html += '<div style="background: ' + (c.tipo === 'nuevo' ? '#e8f5e9' : '#fff9e6') + '; padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid ' + (c.tipo === 'nuevo' ? '#4caf50' : '#ffc107') + ';">'
    html += '<div style="font-weight: 700;">CI: ' + c.cedula + ' (' + (c.tipo === 'nuevo' ? 'NUEVO' : 'ACTUALIZAR') + ')</div>'
    Object.entries(c.campos_cambiar).forEach(([campo, valor]) => {
      html += '<div style="font-size: 0.8rem; color: #666;">• ' + campo + ': <strong>' + valor + '</strong></div>'
    })
    html += '</div>'
  })
  html += '</div>'

  html += '<div style="margin-top: 20px; display: flex; gap: 12px;">'
  html += '<button id="btn-confirmar-actualizacion" style="flex: 1; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">✅ CONFIRMAR ACTUALIZACIÓN</button>'
  html += '<button id="btn-cancelar-actualizacion" style="flex: 1; background: #999; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: 700;">❌ CANCELAR</button>'
  html += '</div>'
  html += '</div></div>'

  modal.innerHTML = html
  document.body.appendChild(modal)

  document.getElementById('btn-cancelar-actualizacion').addEventListener('click', () => modal.remove())
  document.getElementById('btn-confirmar-actualizacion').addEventListener('click', async () => {
    await ejecutarActualizacion(cambios, modal, container)
  })
}

async function ejecutarActualizacion(cambios, modal, container) {
  try {
    const firebaseImport = await import('firebase/firestore')
    const { collection, writeBatch, doc, setDoc } = firebaseImport
    const { db } = await import('../lib/firebase.js')

    modal.remove()
    const progressModal = mostrarProgreso('Actualizando registros...')

    const batch = writeBatch(db)

    cambios.forEach(c => {
      const docRef = doc(collection(db, 'savedRecords'), c.cedula)
      batch.set(docRef, c.campos_cambiar, { merge: true })
    })

    await batch.commit()
    progressModal.remove()
    alert('✅ Se actualizaron ' + cambios.length + ' registros exitosamente')
    location.reload()
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

function mostrarProgreso(mensaje) {
  const modal = document.createElement('div')
  modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 9999; text-align: center;'
  modal.innerHTML = '<div style="font-size: 2rem; margin-bottom: 16px;">⏳</div><div style="font-weight: 700; font-size: 1.1rem;">' + mensaje + '</div>'
  document.body.appendChild(modal)
  return modal
}