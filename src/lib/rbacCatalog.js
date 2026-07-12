// Catálogo central de módulos, permisos y alcances — RBAC (Roles y
// Permisos), Etapa 1.
//
// DECISIÓN DE DISEÑO: el pedido original sugiere guardar este catálogo en
// Firestore (system/modules, system/permissions). Se implementa acá como
// código en su lugar, a propósito: la sección 5 del pedido exige "no
// permitir que cada candidato invente keys técnicas distintas" — un
// catálogo como código (versionado en git, revisado por PR) cumple esa
// regla de forma más estricta que una colección editable en runtime, y
// evita tener que resolver un bootstrap de superadmin solo para poder
// sembrar 2 colecciones de referencia que no cambian por candidato. Lo
// que SÍ vive en Firestore (candidates/{candidateId}/roles) es lo que
// realmente necesita ser editable en runtime por cada candidato: sus
// propios roles y qué permisos de ESTE catálogo les asigna.
//
// MAPEO DE NOMBRES (confirmado con el usuario): "dirigente" = ex-militante
// (registra/gestiona votantes, scope own/assigned) = "leader" del pedido.
// "operador" = quien llama desde Centro de Contacto = "operator" del
// pedido (el pedido también menciona "call_center" por separado, pero acá
// son el mismo rol — no se crean 2 roles para lo mismo).

// ── Módulos ───────────────────────────────────────────────────────────
// 1:1 con las pestañas reales de campaign.js (TAB_ROLES/TAB_LABELS) más
// el módulo nuevo "roles". No se usa la lista más genérica que sugería el
// pedido (dashboard/records/reports sueltos) porque la app real ya tiene
// más granularidad (mesarios/dirigentes/operadores separados, dia-d vs
// dia-d-control) — mapear 1:1 a la pestaña real evita tener que traducir
// entre 2 taxonomías de módulos al usar el catálogo desde el resto del
// código.
export const MODULES = [
  { key: 'dashboard', name: 'Resumen', icon: '📊', route: 'resumen', order: 1 },
  { key: 'search_voter', name: 'Buscar votante', icon: '🗳️', route: 'votantes', order: 2 },
  { key: 'my_records', name: 'Mis registros', icon: '📇', route: 'mis-registros', order: 3 },
  { key: 'users', name: 'Usuarios', icon: '👥', route: 'usuarios', order: 4 },
  { key: 'records', name: 'Registros', icon: '📋', route: 'registros', order: 5 },
  { key: 'audit', name: 'Auditoría', icon: '⚠️', route: 'auditoria', order: 6 },
  { key: 'drivers', name: 'Choferes', icon: '🚗', route: 'choferes', order: 7 },
  { key: 'table_members', name: 'Mesarios', icon: '🪑', route: 'mesarios', order: 8 },
  { key: 'leaders', name: 'Dirigentes', icon: '🧭', route: 'dirigentes', order: 9 },
  { key: 'operators', name: 'Operadores', icon: '📞', route: 'operadores', order: 10 },
  { key: 'contact_center', name: 'Centro de Contacto', icon: '📞', route: 'centro-contacto', order: 11 },
  { key: 'election_day_admin', name: 'Día D Admin', icon: '⚙️', route: 'dia-d', order: 12 },
  { key: 'election_day_control', name: 'Día D Control', icon: '🎮', route: 'dia-d-control', order: 13 },
  { key: 'finance', name: 'Finanzas', icon: '💰', route: 'finanzas', order: 14 },
  { key: 'settings', name: 'Configuración', icon: '🛠️', route: 'configuracion', order: 15 },
  { key: 'roles', name: 'Roles y Permisos', icon: '🔐', route: 'roles', order: 16, isNew: true },
  { key: 'reports', name: 'Reportes', icon: '📊', route: 'reportes', order: 17, isNew: true }
]

// ── Permisos ──────────────────────────────────────────────────────────
// Solo se catalogan permisos que ya tienen una acción real y equivalente
// en el código de hoy (con 3 excepciones marcadas `planned: true`, que
// son botones que el propio pedido pide para el editor de roles de la
// Etapa 4 — roles.duplicate, roles.disable — y que todavía no existen
// como funcionalidad). No se inventan permisos aspiracionales sin uso.
export const PERMISSIONS = [
  // dashboard
  { key: 'dashboard.view', module: 'dashboard', name: 'Ver resumen' },

  // search_voter
  { key: 'search_voter.view', module: 'search_voter', name: 'Buscar votante en el padrón' },
  { key: 'search_voter.create', module: 'search_voter', name: 'Guardar un registro' },

  // my_records
  { key: 'my_records.view', module: 'my_records', name: 'Ver mis registros' },
  { key: 'my_records.edit', module: 'my_records', name: 'Editar chofer/mesario/ayuda/transporte/teléfono de mis registros' },

  // users
  { key: 'users.view', module: 'users', name: 'Ver usuarios' },
  { key: 'users.create', module: 'users', name: 'Crear usuario' },
  { key: 'users.edit_role', module: 'users', name: 'Cambiar rol de usuario' },
  { key: 'users.reset_password', module: 'users', name: 'Resetear contraseña' },
  { key: 'users.disable', module: 'users', name: 'Borrar perfil de usuario' },

  // records
  { key: 'records.view', module: 'records', name: 'Ver todos los registros' },
  { key: 'records.edit', module: 'records', name: 'Editar cualquier registro' },
  { key: 'records.export', module: 'records', name: 'Exportar registros' },

  // audit
  { key: 'audit.view', module: 'audit', name: 'Ver auditoría general' },

  // drivers
  { key: 'drivers.view', module: 'drivers', name: 'Ver choferes' },
  { key: 'drivers.create', module: 'drivers', name: 'Crear chofer' },
  { key: 'drivers.edit', module: 'drivers', name: 'Editar chofer' },
  { key: 'drivers.delete', module: 'drivers', name: 'Borrar chofer' },

  // table_members
  { key: 'table_members.view', module: 'table_members', name: 'Ver mesarios' },
  { key: 'table_members.create', module: 'table_members', name: 'Crear mesario' },
  { key: 'table_members.edit', module: 'table_members', name: 'Editar mesario' },
  { key: 'table_members.delete', module: 'table_members', name: 'Borrar mesario' },

  // leaders
  { key: 'leaders.view', module: 'leaders', name: 'Ver dirigentes' },
  { key: 'leaders.edit_role', module: 'leaders', name: 'Cambiar rol de dirigente' },
  { key: 'leaders.delete', module: 'leaders', name: 'Borrar perfil de dirigente' },

  // operators
  { key: 'operators.view', module: 'operators', name: 'Ver operadores' },
  { key: 'operators.create', module: 'operators', name: 'Crear operador' },
  { key: 'operators.manage_payment', module: 'operators', name: 'Gestionar monto/cadencia de pago' },
  { key: 'operators.delete', module: 'operators', name: 'Borrar perfil de operador' },

  // contact_center
  { key: 'contact_center.view', module: 'contact_center', name: 'Ver Centro de Contacto' },
  { key: 'contact_center.call', module: 'contact_center', name: 'Registrar llamada' },
  { key: 'contact_center.assign_voters', module: 'contact_center', name: 'Asignar votantes a operadores' },
  { key: 'contact_center.update_status', module: 'contact_center', name: 'Actualizar estado electoral' },
  { key: 'contact_center.create_followup', module: 'contact_center', name: 'Crear seguimiento' },
  { key: 'contact_center.configure', module: 'contact_center', name: 'Configurar asignación automática' },

  // election_day_admin
  { key: 'election_day_admin.view_dashboard', module: 'election_day_admin', name: 'Ver panel Día D Admin' },

  // election_day_control
  { key: 'election_day_control.view_operations', module: 'election_day_control', name: 'Ver operación Día D Control' },
  { key: 'election_day_control.update_status', module: 'election_day_control', name: 'Actualizar estado operativo' },
  { key: 'election_day_control.confirm_vote', module: 'election_day_control', name: 'Confirmar voto' },
  { key: 'election_day_control.assign_driver', module: 'election_day_control', name: 'Asignar chofer' },
  { key: 'election_day_control.assign_leader', module: 'election_day_control', name: 'Asignar dirigente' },
  { key: 'election_day_control.assign_table_member', module: 'election_day_control', name: 'Asignar mesario' },
  { key: 'election_day_control.create_incident', module: 'election_day_control', name: 'Crear incidencia' },
  { key: 'election_day_control.configure', module: 'election_day_control', name: 'Configurar alertas/umbrales' },

  // finance
  { key: 'finance.view', module: 'finance', name: 'Ver Finanzas' },
  { key: 'finance.create_obligation', module: 'finance', name: 'Crear obligación' },
  { key: 'finance.edit_obligation', module: 'finance', name: 'Editar obligación propia' },
  { key: 'finance.approve', module: 'finance', name: 'Aprobar obligación/pago' },
  { key: 'finance.reject', module: 'finance', name: 'Rechazar obligación/pago' },
  { key: 'finance.pay', module: 'finance', name: 'Marcar pago como pagado' },
  { key: 'finance.reverse_payment', module: 'finance', name: 'Revertir pago' },
  { key: 'finance.view_cash', module: 'finance', name: 'Ver Caja' },
  { key: 'finance.manage_cash', module: 'finance', name: 'Gestionar cuentas/movimientos de Caja' },
  { key: 'finance.upload_receipt', module: 'finance', name: 'Adjuntar comprobante' },
  { key: 'finance.view_audit', module: 'finance', name: 'Ver auditoría financiera' },
  { key: 'finance.export', module: 'finance', name: 'Exportar reportes financieros' },
  { key: 'finance.configure', module: 'finance', name: 'Configurar tarifas' },

  // settings
  { key: 'settings.view', module: 'settings', name: 'Ver configuración del candidato' },
  { key: 'settings.edit', module: 'settings', name: 'Editar configuración del candidato' },

  // roles (módulo nuevo de esta migración)
  { key: 'roles.view', module: 'roles', name: 'Ver roles' },
  { key: 'roles.create', module: 'roles', name: 'Crear rol' },
  { key: 'roles.edit', module: 'roles', name: 'Editar permisos de un rol' },
  { key: 'roles.duplicate', module: 'roles', name: 'Duplicar rol', planned: true },
  { key: 'roles.disable', module: 'roles', name: 'Desactivar rol', planned: true },
  { key: 'roles.assign_users', module: 'roles', name: 'Asignar roles a usuarios' },
  { key: 'roles.view_audit', module: 'roles', name: 'Ver auditoría de roles' },

  // reports (módulo nuevo — Reportes)
  { key: 'reports.view', module: 'reports', name: 'Ver reportes' },
  { key: 'reports.export', module: 'reports', name: 'Exportar reportes a Excel' }
]

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key)

// ── Alcances (scopes) ─────────────────────────────────────────────────
// Sección 7 y 10 del pedido. El orden de este array es el de MENOR a
// MAYOR alcance para los casos donde sí forman una jerarquía lineal
// (none < own < assigned < team < zone < all_candidate < all_platform).
// polling_place y table quedan aparte a propósito: el pedido mismo
// advierte que no siempre forman una jerarquía lineal con el resto (un
// mesario con scope "table" no "contiene" a un dirigente con scope
// "zone", son alcances de naturaleza distinta) — ver SCOPE_RANK más abajo
// para cómo se resuelve esto en la práctica al combinar roles.
export const SCOPES = [
  { key: 'none', label: 'Ninguno' },
  { key: 'own', label: 'Solo propios' },
  { key: 'assigned', label: 'Solo asignados' },
  { key: 'team', label: 'Su equipo' },
  { key: 'zone', label: 'Su zona' },
  { key: 'polling_place', label: 'Su local' },
  { key: 'table', label: 'Su mesa' },
  { key: 'all_candidate', label: 'Todo el candidato' },
  { key: 'all_platform', label: 'Toda la plataforma' }
]

export const SCOPE_LABELS = Object.fromEntries(SCOPES.map(s => [s.key, s.label]))

// Rangos numéricos SOLO para los alcances que de verdad forman una
// cadena (none..zone y all_candidate/all_platform al tope). polling_place
// y table quedan con el mismo rango que "zone" — no se puede decidir en
// abstracto si un local "vale más" que una mesa fuera de su contexto de
// uso real (ver combinePermissionScope en rbac.js, que trata estos 2 como
// un caso especial en vez de compararlos numéricamente con los demás).
export const SCOPE_RANK = {
  none: 0, own: 1, assigned: 2, team: 3, zone: 4,
  polling_place: 4, table: 4,
  all_candidate: 5, all_platform: 6
}

// ── Roles del sistema (equivalentes exactos a lo que ya existe hoy) ───
// name/internalName: el nombre interno (string en users.role) NO cambia
// todavía — esto es solo el catálogo que describe qué permisos ya tiene
// cada uno en la práctica, para poder sembrar candidates/{id}/roles sin
// inventar comportamiento nuevo. isSystemRole:true en todos.
export const SYSTEM_ROLE_NAMES = {
  campaign_admin: 'Administrador de campaña',
  coordinator: 'Coordinador',
  dirigente: 'Dirigente',
  mesario: 'Mesario',
  operador: 'Operador (Centro de Contacto)',
  chofer: 'Chofer',
  viewer: 'Visualizador',
  auditor: 'Auditor',
  finance_admin: 'Finanzas - Administrador',
  finance_operator: 'Finanzas - Operador',
  cashier: 'Finanzas - Cajero/a'
}
