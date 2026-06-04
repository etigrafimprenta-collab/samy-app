export const shareWhatsAppDirect = (phoneNumber, voter) => {
  const msg = `*SAMY FIDABEL CONCEJAL*
*Lista 6 Opción 1*
Hola! *${voter.nombre}*
Cédula: ${voter.cedula}
El 7 de Junio te espero para votar en:
${voter.local ? `Local: ${voter.local}` : ""}
${voter.mesa ? `Mesa: ${voter.mesa}` : ""}
${voter.orden ? `Orden: ${voter.orden}` : ""}
Tu voto hará el cambio que necesitamos.
Votá *Lista 6 Opción 1* el 7 de Junio!
Por una ciudad Honesta, Trabajadora y con Resultados
Gracias por el Apoyo!!!`

  let cleanPhone = String(phoneNumber).trim()
  console.log("📱 [1] Teléfono original:", cleanPhone)
  cleanPhone = cleanPhone.replace(/\D/g, "")
  console.log("📱 [2] Solo dígitos:", cleanPhone)
  while (cleanPhone.startsWith("595")) {
    cleanPhone = cleanPhone.substring(3)
    console.log("📱 [2b] Quitando 595 del inicio:", cleanPhone)
  }
  if (!cleanPhone || cleanPhone === "") {
    console.error("❌ Error: teléfono vacío después de limpiar")
    alert("Número de teléfono inválido")
    return
  }
  if (!cleanPhone.startsWith("595")) {
    cleanPhone = "595" + cleanPhone
  }
  console.log("📱 [3] Teléfono final para WhatsApp:", cleanPhone)
  console.log("✅ Enviando a:", `https://wa.me/${cleanPhone}`)
  const encoded = encodeURIComponent(msg.trim())
  window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, "_blank")
}

export const shareWhatsApp = (voter) => {
  alert("Por favor, guarda el registro con teléfono para compartir por WhatsApp")
}