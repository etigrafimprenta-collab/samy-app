// Construcción centralizada de mensajes de campaña (WhatsApp).
//
// Toda pantalla que arme el mensaje de recordatorio de votación para un
// registro debe pasar por buildRecordatorioVotoMessage() en vez de
// concatenar el texto a mano — así evitamos que cada tab (Mis registros,
// Registros, etc.) tenga su propia copia del template y se desincronicen.
//
// Parámetros de Configuración usados (todos opcionales — ver
// updateCandidateBranding() en firebaseCandidate.js y el form
// "Configuración de la campaña" en campaign.js):
//   - candidate.electionDate ("fecha_eleccion"): fecha de la elección,
//     guardada como string ISO (yyyy-mm-dd) desde un <input type="date">.
//     Si falta, la línea "el <fecha>" simplemente no se agrega al mensaje.
//   - candidate.lista ("lista"): número/nombre de lista.
//   - candidate.opcion ("opcion"): número/nombre de opción.
//     lista y opcion solo se agregan al mensaje cuando AMBOS están
//     presentes (así era el comportamiento original).
//
// Ninguno de estos tres valores está hardcodeado acá: si el candidato no
// los cargó en Configuración, el mensaje sale igual que antes de este
// upgrade (retrocompatibilidad con campañas ya existentes).

// Formatea una fecha ISO (yyyy-mm-dd) como "15 de noviembre" en español.
// Si el valor no es una fecha ISO parseable (por ejemplo texto libre
// cargado a mano), se devuelve tal cual en vez de fallar.
export function formatElectionDate(electionDate) {
  if (!electionDate) return null
  const raw = String(electionDate).trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!isoMatch) return raw

  const date = new Date(`${raw.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return raw

  return new Intl.DateTimeFormat('es-PY', { day: 'numeric', month: 'long' }).format(date)
}

// candidate: doc de /candidates/{candidateId} (name, electionDate, lista, opcion).
// record: registro guardado (nombre, local, mesa, orden).
//
// WhatsApp usa *asterisco simple* para negrita (no ** de markdown). Van en
// negrita el nombre del destinatario y todos los valores que van entre
// comillas: nombre del candidato, lista y opción.
export function buildRecordatorioVotoMessage(candidate, record) {
  const fechaFormateada = formatElectionDate(candidate?.electionDate)
  const tieneListaYOpcion = Boolean(candidate?.lista && candidate?.opcion)

  return (
    `Hola *${record.nombre}*, te escribimos desde el equipo de campaña de "*${candidate?.name}*". ` +
    `Tu lugar de votación es ${record.local || 'N/A'}, mesa ${record.mesa || 'N/A'}, orden ${record.orden || 'N/A'}. ` +
    `¡Contamos con tu voto${fechaFormateada ? ` el ${fechaFormateada}` : ''}!` +
    (tieneListaYOpcion ? ` Vota Lista "*${candidate.lista}*" Opción "*${candidate.opcion}*"` : '')
  )
}
