// La app entera renderiza vía innerHTML con datos que vienen de un
// import de Excel sin sanitizar (auditoría, hallazgo de XSS en
// dia-d-admin-COMPLETO-CON-MESAS.js). Cualquier nombre/nota/teléfono que
// contenga comillas o "<" puede romper el HTML o inyectar script/atributos
// falsos. Usar SIEMPRE que se interpole un dato de usuario/votante dentro
// de un template de innerHTML.
const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch])
}
