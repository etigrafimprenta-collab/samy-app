export const shareWhatsAppDirect = (phoneNumber, voter) => {
  const msg = `*SAMY FIDABEL CONCEJAL – Lista 6 Opción 1*

Hola! Te encontré en el padrón de afiliados.

*${voter.nombre}*
Cédula: ${voter.cedula}
${voter.local ? `Local: ${voter.local}` : ''}
${voter.mesa ? `Mesa: ${voter.mesa}` : ''}
${voter.orden ? `Orden: ${voter.orden}` : ''}

Votá *Lista 6 Opción 1* el día de las elecciones!`

  // Limpiar: remover TODO excepto dígitos
  let cleanPhone = String(phoneNumber).replace(/\D/g, '')
  
  console.log('Teléfono original:', phoneNumber)
  console.log('Teléfono limpio:', cleanPhone)
  
  // Remover todos los 595 que puedan estar al inicio (evitar duplicados)
  // Por ejemplo: "595595981107497" → "595981107497"
  while (cleanPhone.startsWith('595595')) {
    cleanPhone = cleanPhone.replace('595595', '595')
  }
  
  // Si NO comienza con 595, agregarlo
  if (!cleanPhone.startsWith('595')) {
    cleanPhone = '595' + cleanPhone
  }

  console.log('Teléfono final para WhatsApp:', cleanPhone)

  const encoded = encodeURIComponent(msg.trim())
  window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, '_blank')
}