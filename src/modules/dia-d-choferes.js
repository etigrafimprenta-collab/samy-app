/**
 * SISTEMA DE CHOFERES - Módulo DÍA D
 * Gestión de asignación de transporte a votantes
 */

import { db, auth } from '../lib/firebase.js'

/**
 * Obtener lista de choferes registrados
 */
export async function getChoferes() {
  try {
    const snapshot = await db.collection('choferes').get()
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
  } catch (err) {
    console.error('Error obteniendo choferes:', err)
    return []
  }
}

/**
 * Obtener datos de transporte de un votante
 */
export async function getTransporteVotante(cedula, militante_id) {
  try {
    const doc = await db.collection('dia_d_transporte')
      .doc(`${militante_id}_${cedula}`)
      .get()
    
    if (doc.exists) {
      return doc.data()
    }
    return { necesita_transporte: false, chofer_id: null, chofer_nombre: null }
  } catch (err) {
    console.error('Error obteniendo transporte:', err)
    return { necesita_transporte: false, chofer_id: null, chofer_nombre: null }
  }
}

/**
 * Guardar asignación de transporte
 */
export async function guardarTransporte(cedula, militante_id, transporte) {
  try {
    await db.collection('dia_d_transporte')
      .doc(`${militante_id}_${cedula}`)
      .set({
        cedula: cedula,
        militante_id: militante_id,
        necesita_transporte: transporte.necesita_transporte,
        chofer_id: transporte.chofer_id || null,
        chofer_nombre: transporte.chofer_nombre || null,
        timestamp: new Date()
      }, { merge: true })
    
    console.log(`✅ Transporte guardado: ${cedula}`)
  } catch (err) {
    console.error('Error guardando transporte:', err)
    throw err
  }
}

/**
 * Obtener votantes asignados a un chofer
 */
export async function getVotantesPorChofer(chofer_id) {
  try {
    const snapshot = await db.collection('dia_d_transporte')
      .where('chofer_id', '==', chofer_id)
      .where('necesita_transporte', '==', true)
      .get()
    
    return snapshot.docs.map(doc => doc.data())
  } catch (err) {
    console.error('Error obteniendo votantes por chofer:', err)
    return []
  }
}

/**
 * Obtener estadísticas de transporte por chofer
 */
export async function getEstadisticasTransporte() {
  try {
    const snapshot = await db.collection('dia_d_transporte')
      .where('necesita_transporte', '==', true)
      .get()
    
    const stats = {}
    
    snapshot.forEach(doc => {
      const data = doc.data()
      const chofer = data.chofer_nombre || 'Sin asignar'
      
      if (!stats[chofer]) {
        stats[chofer] = { chofer_id: data.chofer_id, votantes: 0 }
      }
      stats[chofer].votantes++
    })
    
    return stats
  } catch (err) {
    console.error('Error obteniendo estadísticas:', err)
    return {}
  }
}

/**
 * Crear/Registrar un nuevo chofer (solo admin)
 */
export async function crearChofer(nombre, telefono, vehiculo) {
  try {
    const docRef = await db.collection('choferes').add({
      nombre: nombre,
      telefono: telefono,
      vehiculo: vehiculo,
      activo: true,
      createdAt: new Date()
    })
    
    console.log(`✅ Chofer registrado: ${nombre}`)
    return docRef.id
  } catch (err) {
    console.error('Error creando chofer:', err)
    throw err
  }
}