export const shareWhatsAppDirect = (phoneNumber, voter) => {
  const msg = `*SAMY FIDABEL CONCEJAL – Lista 6 Opción 1*

Hola! Te encontré en el padrón de afiliados.

*${voter.nombre}*
Cédula: ${voter.cedula}
${voter.local ? `Local: ${voter.local}` : ''}
${voter.mesa ? `Mesa: ${voter.mesa}` : ''}
${voter.orden ? `Orden: ${voter.orden}` : ''}

Votá *Lista 6 Opción 1* el día de las elecciones!`

  // ✅ LIMPIEZA ULTRA ROBUSTA
  let cleanPhone = String(phoneNumber).trim()
  
  console.log('📱 [1] Teléfono original:', cleanPhone)
  
  // Paso 1: Remover TODO excepto dígitos
  cleanPhone = cleanPhone.replace(/\D/g, '')
  console.log('📱 [2] Solo dígitos:', cleanPhone)
  
  // Paso 2: Remover TODOS los 595 que estén al inicio (pueden ser múltiples)
  // 595595982108923 → 982108923
  // 595981107497 → 981107497
  // 981107497 → 981107497 (sin cambios)
  while (cleanPhone.startsWith('595')) {
    cleanPhone = cleanPhone.substring(3)
    console.log('📱 [2b] Quitando 595 del inicio:', cleanPhone)
  }
  
  // Paso 3: Si quedó vacío, no hacer nada
  if (!cleanPhone || cleanPhone === '') {
    console.error('❌ Error: teléfono vacío después de limpiar')
    alert('Número de teléfono inválido')
    return
  }
  
  // Paso 4: Agregar 595 UNA SOLA VEZ
  // Solo si no empieza con 595 (no debería suceder después del paso 2, pero por seguridad)
  if (!cleanPhone.startsWith('595')) {
    cleanPhone = '595' + cleanPhone
  }
  
  console.log('📱 [3] Teléfono final para WhatsApp:', cleanPhone)
  console.log('✅ Enviando a:', `https://wa.me/${cleanPhone}`)

  const encoded = encodeURIComponent(msg.trim())
  window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, '_blank')
}

export const shareWhatsApp = (voter) => {
  alert('Por favor, guarda el registro con teléfono para compartir por WhatsApp')
}