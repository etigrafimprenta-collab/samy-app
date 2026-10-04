// Monto especial temporal por cajero (AUDITORÍA 2026-10-03): el admin
// elige Desde/Hasta en un <input type="datetime-local">, que es
// timezone-naive (lo interpreta el navegador en SU propia zona horaria).
// El pedido explícito es "usar hora Paraguay, no depender del reloj del
// navegador" — así que estos valores SIEMPRE se tratan como hora de
// America/Asuncion sin importar dónde esté físicamente el admin, y se
// convierten a un instante UTC real antes de mandarlo al servidor (que
// compara con Date.now(), siempre en UTC internamente).

// Offset actual de America/Asuncion en minutos respecto a UTC, calculado
// con Intl (nunca hardcodeado) — Paraguay no tiene DST desde 2024, pero
// calcularlo dinámicamente evita tener que acordarse de ese detalle.
function offsetAsuncionMinutos(fechaReferencia) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion',
    timeZoneName: 'shortOffset',
  }).formatToParts(fechaReferencia)
  const parte = partes.find(p => p.type === 'timeZoneName')?.value || 'GMT-4'
  const match = parte.match(/GMT([+-]\d+)/)
  return match ? parseInt(match[1], 10) * 60 : -240
}

// "YYYY-MM-DDTHH:mm" (valor crudo de un <input type="datetime-local">),
// interpretado como hora de pared en Paraguay → Date (instante UTC real).
export function paraguayInputToDate(valorInput) {
  if (!valorInput) return null
  const [fecha, hora] = valorInput.split('T')
  const [y, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = (hora || '00:00').split(':').map(Number)
  const comoUtc = Date.UTC(y, m - 1, d, hh, mm)
  const offsetMin = offsetAsuncionMinutos(new Date(comoUtc))
  // offsetMin es negativo (ej. -240 para UTC-4) → el instante UTC real es
  // la hora de pared MENOS ese offset (equivalente a sumarle las horas).
  return new Date(comoUtc - offsetMin * 60000)
}

// Date (instante UTC real) → "YYYY-MM-DDTHH:mm" en hora de Paraguay, para
// precargar un <input type="datetime-local">.
export function dateToParaguayInput(date) {
  if (!date) return ''
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = t => partes.find(p => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

// Para mostrar al admin/cajero — siempre en hora Paraguay explícita.
export function formatParaguayDateTime(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', dateStyle: 'short', timeStyle: 'short',
  }).format(date) + ' (hora PY)'
}

// Fecha sola (sin hora), hora Paraguay explícita — para exports con
// columnas Fecha y Hora separadas en vez de una sola "Fecha/Hora".
export function formatParaguayDate(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', dateStyle: 'short',
  }).format(date)
}

export function formatParaguayTime(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

// Firestore Timestamp (o Date, o millis) → Date — tolera las 3 formas en
// que puede llegar un campo de fecha desde distintos SDKs/lecturas.
export function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  return null
}
