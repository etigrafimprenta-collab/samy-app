// Extraído de campaign.js para poder reusarlo desde pantallas que no
// cargan el panel de campaña completo (ej. acceptInvite.js, que un
// usuario sin cuenta todavía ve antes de tener ningún acceso).
export const ROLE_LABELS = {
  campaign_admin: 'Administrador de campaña',
  coordinator: 'Coordinador',
  dirigente: 'Dirigente',
  mesario: 'Mesario',
  operador: 'Operador de contacto',
  chofer: 'Chofer',
  viewer: 'Visualizador',
  auditor: 'Auditor',
  finance_admin: 'Finanzas - Administrador',
  finance_operator: 'Finanzas - Operador',
  cashier: 'Finanzas - Cajero/a'
}
