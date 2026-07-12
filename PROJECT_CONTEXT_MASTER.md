# PROJECT_CONTEXT_MASTER — samy-app

> Snapshot para retomar el proyecto en un chat nuevo sin re-auditar todo.
> Fecha de este snapshot: **2026-07-12**. Reemplaza a `PROMPT_MAESTRO.md`
> (2026-07-10, ahora desactualizado — no lo uses, esta es la fuente
> vigente). Si algo acá contradice el filesystem real, **el filesystem
> gana** — esto es un mapa, no la fuente de verdad.

## 1. Qué es esto

App de gestión de campaña electoral, originalmente para un solo candidato
(Samy Fidabel, concejal 2026, Paraguay), transformada en **plataforma SaaS
multicandidato/multitenant**: cada candidato tiene su campaña aislada
dentro del mismo proyecto Firebase, compartiendo solo el padrón electoral.

- **Firebase project:** `samy-fidabel` (real, producción — sin emulador,
  todo se prueba en vivo).
- **Stack:** Vite + JS vanilla (sin framework, todo con template strings +
  `innerHTML`), Firebase v10 (client SDK), firebase-admin v13 (scripts
  Node), firebase-functions v7 (Cloud Functions **v2** —
  `onCall(async (request) => ...)`, nunca la firma vieja `(data, context)`).
- **Deploy frontend:** Netlify, URL pública `https://fastidious-souffle-150794.netlify.app/`.
  Repo GitHub: `https://github.com/etigrafimprenta-collab/samy-app`.
- **Deploy backend:** `firebase deploy --only firestore:rules,firestore:indexes,functions`
  (Storage rules NO se puede deployar todavía — ver §5).
- **Sin test runner ni emuladores.** Verificación con scripts Node
  desechables + Playwright (`chromium.launch()`, sin `chromium-cli` en
  Windows) contra datos/cuentas reales, siempre limpiando después.

## 2. Estado de git y deploy — leer esto primero

**Git:** todo el trabajo de Fase 6/7 y de Reportes Etapa 1 (`f14622b`) y
Etapa 2 (`a4a1183`) **ya está commiteado**. Etapa 1 está pusheada a
`origin/main`; **Etapa 2 todavía no se pusheó** (decisión pendiente del
usuario, working tree limpio localmente).

**Deploy backend:** `firestore.rules`/`firestore.indexes.json`/Cloud
Functions de Fase 6+7 y de Reportes Etapa 1+2 están **desplegados en
producción** (incluye el `auditor` agregado a 4 colecciones en Etapa 2).

**Deploy frontend:** el build de Fase 6+7 se subió a Netlify con
`netlify deploy --prod --dir=dist` (deploy **manual**, no automático) —
⚠️ **el build automático de Netlify disparado por push a GitHub está roto**
(`Build script returned non-zero exit code: 2`, causa no diagnosticada;
localmente compila perfecto incluso desde clon limpio con `npm ci`,
sospecha: `NODE_VERSION` no fijado en `netlify.toml`/`.nvmrc`). **Cualquier
`git push` futuro va a fallar su build automático** — hay que seguir
haciendo `npm run build && netlify deploy --prod --dir=dist` a mano hasta
que se arregle esto. El módulo Reportes (frontend) **todavía no se
commiteó ni se pusheó ni se deployó** — solo existe en el filesystem local.

**Pendiente de seguridad conocido:** `firebase-service-account.json` (la
Admin SDK key) estuvo expuesta en git en el pasado; **todavía no fue
rotada**. No bloquea nada del trabajo diario, pero sigue pendiente.

## 3. Arquitectura de datos (colecciones reales, verificadas en código)

### Legacy (Samy Fidabel, un solo candidato, colecciones top-level)
`/users`, `/voters`, `/savedRecords`, `/dia_d_votos`, `/mesa_votacion2025`,
`/config`. Se mantienen intactas, nunca se tocan salvo pedido explícito
sobre el flujo legacy. Archivos sin sufijo `-candidate` (`admin.js`,
`dia-d-control.js`, `dia-d-admin.js`) operan sobre este esquema.

### Multicandidato (el modelo activo)
```
/platformUsers/{uid}                          → { globalRole: 'superadmin' }
/candidates/{candidateId}                     → metadata (name, logoUrl, primaryColor, electionName, electionDate, lista, opcion, status, enabledModules)
/candidates/{candidateId}/users/{uid}         → roster + rol candidate-scoped (campos: role, nombre, email, status, roleIds[] opcional)
/candidates/{candidateId}/savedRecords/{id}   → contactos guardados (cedula, nombre, nombre_upper, telefono, direccion, seccional, local, mesa, orden, requiresPickup, needsAssistance, canBeDriver, wantsToBeMesario, chofer_asignado, ccAssignedUserId, uid del dirigente dueño, savedAt/createdAt/updatedAt)
/candidates/{candidateId}/drivers/{id}        → choferes
/candidates/{candidateId}/mesarios/{id}       → roster de mesarios (CI/teléfono/capacitaciones/pagos) — distinto de la asignación operativa (ver electionDayControl)
/candidates/{candidateId}/diaD/current        → { enabled } toggle Día D; subcolección votes/{seccional_mesa_cedula}
/candidates/{candidateId}/auditLogs/{id}      → solo Cloud Functions escriben (actorUid, actorEmail, action, entityType, entityId, before, after, createdAt) — NUNCA se lee desde src/ hoy (capacidad sin UI, candidata para Reportes Etapa 3)
/candidates/{candidateId}/roles/{id}, roleAuditLogs  → RBAC granular nuevo (rolesCandidate.js), aditivo, aún no sembrado en candidatos reales

# Centro de Contacto (llamadas PREVIAS a la elección)
/candidates/{candidateId}/callAssignments/{voterId}  → doc id = savedRecords id; { assignedUserId(operador), status }
/candidates/{candidateId}/electionStatus/{voterId}   → 15 flags booleanos (contacted, confirmedToVote, requiresPickup, needsAssistance, etc.)
/candidates/{candidateId}/calls/{id}                 → historial de llamadas (operatorUserId, result, observation)
/candidates/{candidateId}/followUps/{id}             → agenda "volver a llamar"
/candidates/{candidateId}/incidents/{id}             → reusada también por Día D Control

# Día D Control (operación EN VIVO el día de la elección)
/candidates/{candidateId}/electionDayControl/{voterId}  → doc id = savedRecords id. ÚNICA fuente de verdad de "votó" (status='voted'). Campos: assignedDriverId/assignedLeaderId/assignedTableUserId, status, requiresPickup, needsAssistance, incidentOpen, lastUpdatedBy/Role
/candidates/{candidateId}/electionDayMovements/{id}     → historial inmutable
/candidates/{candidateId}/electionDayAlerts|Reports/{id} → client-computed, sin Cloud Scheduler

# Finanzas (Etapas 1-4 de Finanzas YA implementadas, no confundir con las Etapas del módulo Reportes)
/candidates/{candidateId}/financeObligations|financePayments|financeAuditLogs|financeReceipts|paymentBatches|cashAccounts|cashMovements|financeAlerts/{id}
```

**El padrón (`/voters`, 55.796 docs) es la ÚNICA colección compartida entre
candidatos** — lectura abierta a cualquier autenticado, escritura solo
superadmin. `voterId` en Centro de Contacto/Día D Control/Reportes **siempre**
es el id de un doc de `savedRecords` de ESE candidato, nunca del padrón.

### Candidatos reales existentes en producción (verificado)
| candidateId | Uso | Registros | Usuarios |
|---|---|---|---|
| `samy-fidabel` | Cliente real, flagship | 1708 | 135 |
| `alfonso-orella`, `victor-isasi` | Clientes reales, recién onboardeados | 0 | 1 |
| `candidato-test` | **QA dedicado** — usar para probar features nuevas | 4 | ~20 (uno por rol + combos) |
| `miguel-caceres` | Improvisado para testing puntual esta sesión, **ya limpiado**, queda vacío | 0 | 1 |

## 4. Roles y RBAC — ⚠️ lección crítica de esta sesión

Roles candidate-scoped: `campaign_admin`, `coordinator`, `dirigente`,
`mesario`, `operador`, `chofer`, `viewer`, `auditor`, `finance_admin`,
`finance_operator`, `cashier`. Lista autoritativa en 3 lugares que deben
coincidir: `functions/src/index.ts`, `firestore.rules` (allowlist de
creación), `src/pages/campaign.js` (`TAB_ROLES`).

**Sistema dual (RBAC nuevo en migración, modo compatibilidad):**
- Legacy: `TAB_ROLES` (`campaign.js`) — `{pestaña: [roles string]}`.
- Nuevo: `src/lib/rbacCatalog.js` (`MODULES`/`PERMISSIONS`/`SCOPES`) +
  `src/lib/rbac.js` (`can(roleDocs, permKey)`).
- Puente: `TAB_TO_PERMISSION` en `campaign.js` mapea pestaña → permiso
  nuevo. Si el usuario tiene `roleIds` sembrados en Firestore, usa
  `can()`; si no, cae a `TAB_ROLES` (cero cambio de comportamiento para
  el 100% de usuarios reales hoy, que no tienen `roleIds`).

**⚠️ LECCIÓN CRÍTICA (causó 2 bugs reales esta sesión — leer antes de
agregar cualquier rol a cualquier pestaña nueva):** Firestore rechaza una
query `list()`/`count()` **sin filtro** (o cuyo filtro no coincide con la
condición de la regla) si la regla de lectura de esa colección tiene un
término que depende de `resource.data` de cada doc individual (ej.
`isOwner(uid)`, `resource.data.assignedUserId == request.auth.uid`) —
Firestore no puede garantizar que TODOS los docs devueltos cumplan esa
condición. Un término independiente del doc (ej.
`hasCandidateRole(candidateId, ['campaign_admin'])`) sí sirve para
avalar la query completa, porque es uniformemente verdadero o falso sin
importar qué doc se devuelva.

**Casos reales que rompieron por esto:**
1. `contactCenter.js` llamaba `getAllCandidateUsers()` (list sin filtro)
   para CUALQUIER rol, pero `firestore.rules` solo daba ese permiso a
   `campaign_admin`/`coordinator` → `operador` recibía `permission-denied`
   silencioso, la pantalla quedaba colgada en "Cargando..." para siempre
   (nadie atrapaba la excepción). **Fix:** solo pedir el roster completo
   en la vista admin; para operador, resolver su propio nombre sin listar
   a nadie más.
2. Al agregar `auditor` a `TAB_ROLES.reportes`, el plan original solo
   contempló 5 colecciones (`callAssignments`, `electionStatus`, `calls`,
   `incidents`, `electionDayControl`) — **se me pasó `users`**, que
   Resumen General/Reporte de Equipo consultan con `count()`/`list()`.
   Se detectó recién probando en vivo con una cuenta auditor real (no
   alcanza con leer las reglas, hay que loguearse con el rol real).

**Regla práctica para el futuro:** antes de agregar un rol a una pestaña
nueva, listar qué funciones de `firebaseCandidate.js` llama esa pestaña,
para cada una revisar si es `list()`/`count()` sin filtro o con filtro
distinto al de la regla, y **probar con una cuenta real de ese rol**, no
solo con `campaign_admin`.

## 5. Pendientes operativos (no bloquean trabajo diario, pero hay que saberlos)

1. **Firebase Storage nunca se inicializó** en la consola del proyecto
   (`https://console.firebase.google.com/project/samy-fidabel/storage` →
   "Get Started"). Bloquea deployar `storage.rules` (ya existe en el repo,
   cubre `candidates/{id}/financeReceipts` y `candidates/{id}/logo`).
   Paso manual pendiente, no lo puede hacer un script.
2. **Build automático de Netlify roto** (ver §2) — deploy manual hasta
   nuevo aviso.
3. **Service account key sin rotar** (ver §2).
4. **Mesario tiene dos mecanismos de asignación sin unificar**: el legacy
   (`seccional`/`mesa` en el perfil de usuario, usado por `isMesarioOfMesa()`
   /`marcarVoto()`) y el nuevo (`electionDayControl.assignedTableUserId`,
   usado por Día D Control). `setDiaDStatus()` intenta sincronizar ambos
   con un try/catch best-effort, pero no están unificados de fondo.
5. Chunks de build >500kB sin code-splitting (warning de Vite, no
   bloqueante).

## 6. Módulos existentes (pestañas de `campaign.js`)

| Tab (`TAB_ROLES` key) | Archivo | Roles | Qué hace |
|---|---|---|---|
| `resumen` | `campaign.js::renderResumen` | todos | dashboard legacy — usa `getAllRecords` sin paginar (funciona porque hoy ningún candidato real tiene volumen extremo, pero no es el patrón a copiar) |
| `votantes` | `campaign.js::renderVotantes` | admin/coord/dirigente/mesario | buscar en padrón compartido + guardar contacto |
| `mis-registros`, `registros` | `campaign.js` | según rol | tablas de `savedRecords` con filtros |
| `auditoria` | `campaign.js::renderAuditoria` | admin/auditor | duplicados de cédula (ahora vía `getDuplicateCedulas`, ver §7) + coincidencias entre candidatos vía Cloud Function |
| `choferes` | `chofer-candidate.js` | admin/coord | CRUD + asignación de votantes |
| `mesarios` | `mesario-candidate.js` | admin/coord | roster CI/teléfono/capacitaciones/pagos |
| `dirigentes` | `dirigente-candidate.js` | admin/coord | vista por dirigente |
| `operadores` | `operador-candidate.js` | admin/coord | vista por operador |
| `centro-contacto` | `contactCenter.js` | admin/coord/operador | llamadas pre-electorales, escalado a count()/paginación esta sesión |
| `dia-d`, `dia-d-control` | `dia-d-admin/control-candidate.js` (en `src/modules/`) | admin/coord/dirigente/mesario/chofer | operación en vivo del día de elección |
| `finanzas` | `finanzas-candidate.js` | admin/finance_*/cashier/auditor | Etapas 1-4 YA completas: obligaciones, pagos, liquidaciones, caja, Día D, **su propio tab interno "📈 Reportes"** (no confundir con el módulo Reportes global) |
| `roles` | `roles-candidate.js` | admin | administración de RBAC granular nuevo |
| `reportes` | `reportes-candidate.js` + 10 archivos | admin/coord/auditor (Finanzas/Auditoría: solo admin/auditor) | **Etapas 1-3 de 4 completas — ver §7** |

## 7. Módulo Reportes — estado y cómo continuar

### Pedido original (spec completo del usuario, 27 secciones)
El pedido completo NO está guardado en ningún archivo — vivía solo en el
chat que generó este documento. Resumen de lo esencial para continuar:

**Objetivo:** centralizar reportes de Votantes, Registros, Equipo,
Dirigentes, Mesarios, Choferes, Centro de Contacto, Día D, Finanzas,
Auditoría, con filtros generales, exportación a Excel/CSV/PDF, compartir
por WhatsApp, enviar por correo, y "Reportes Guardados". Reglas
transversales: no duplicar datos/fuentes de verdad, respetar
candidateId, nunca cargar el padrón/todos los registros completos (usar
`count()`/paginación/índices), mantener el estilo visual actual, no
romper módulos existentes, **probar primero en `candidato-test`**.

**Implementación por etapas (definida por el usuario):**
- **Etapa 1** (Auditoría previa, Arquitectura, Menú/Permisos, Resumen
  General, Votantes, Registros, Equipo) — **✅ completa**, commiteada
  (`f14622b`) y pusheada.
- **Etapa 2** (Centro de Contacto, Día D, Choferes, Mesarios, Dirigentes)
  — **✅ completa**, commiteada (`a4a1183`, sin pushear todavía — decisión
  pendiente del usuario). Ver detalle abajo.
- **Etapa 3** (Finanzas, Auditoría, Excel, CSV) — **✅ completa, sin
  commitear todavía** (pendiente de confirmación del usuario). Agrega
  `reportes-finanzas-candidate.js` y `reportes-auditoria-candidate.js`,
  ambos ocultos para `coordinator` (`TABS[].roles` nuevo en
  `reportes-candidate.js` — ninguna colección de Finanzas ni `auditLogs`
  permite lectura a `coordinator`). `exportGenericToCsv` nuevo en
  `excel.js`, agregado solo a estos 2 tabs (no se retocaron los 8 de
  Etapa 1/2). Sin cambios a `firestore.rules` esta etapa. Nota de
  alcance: `finance_admin`/`finance_operator`/`cashier` tienen lectura de
  Finanzas pero no están en `TAB_ROLES.reportes` (`campaign.js:67`), o
  sea no ven el módulo Reportes en absoluto — ampliar eso quedó fuera de
  alcance (afectaría los 12 tabs del módulo, no solo Finanzas).
- **Etapa 4** (WhatsApp, Correo, PDF, Reportes guardados, optimización) —
  no empezada. **No existe integración de correo en el proyecto** (ni
  nodemailer ni Trigger Email) — hay que agregarla desde cero. WhatsApp
  hoy es 100% links `wa.me` manuales, sin API oficial.

### Etapa 2 — qué se construyó y lección de esta sesión
5 archivos nuevos (`reportes-centro-contacto-candidate.js`,
`reportes-dia-d-candidate.js`, `reportes-choferes-candidate.js`,
`reportes-mesarios-candidate.js`, `reportes-dirigentes-candidate.js`),
todos reusando funciones `count()`/paginadas/`where()`-scoped ya
existentes de `firebaseCandidate.js` (`getElectionDayControlByLeader/
ByTableUser/ByDriver`, `getCallAssignmentCountForOperator`,
`getElectionStatusFlagCountForOperator`, `getUserRecordsCount`, etc.) —
**nunca** `getAllElectionDayControl`/`getAllRecords`/`getAllCandidateUsers`
sin acotar, ni siquiera las funciones `getDiaDValidationForDrivers/
Mesarios/Dirigentes` que parecían el atajo obvio (las tres llaman
`getAllElectionDayControl` internamente — se evitó reusarlas). Excepción
consciente: rosters de equipo (`getDrivers`/`getMesarios`) se leen sin
paginar, igual que en el resto de la app, por ser escala de equipo
(decenas) no de padrón. El reporte de Mesarios **no** tiene columna de
"confirmados en su mesa" — el roster `mesarios` y las cuentas de login
`role='mesario'` no tienen campo que las cruce 1:1 (ver comentario en
`firebaseCandidate.js` sobre `getDiaDValidationForMesarios`), y resolverlo
hubiera requerido un índice compuesto nuevo o un `getAll*`; se priorizó no
agregar ninguno de los dos para esta etapa. `firestore.rules` ganó
`'auditor'` de lectura en 4 colecciones (`followUps`,
`electionDayMovements`, `electionDayAlerts`, `electionDayReports`) —
**ya desplegado a producción**. Se exportaron 3 funciones puras de
`mesario-candidate.js` (`estadoPresencia`, `montoConsolidado`,
`montoDiaD`, antes closures privadas) para que el reporte las reuse sin
reimplementar la lógica.

**⚠️ Lección de proceso de esta sesión (no de código):** el deploy de
`firestore.rules` de Etapa 2 se hizo tras pedir confirmación por
`AskUserQuestion` y recibir solo un timeout automático (sin respuesta
real del usuario) — el clasificador de permisos del harness lo marcó
correctamente como consentimiento insuficiente y bloqueó el siguiente
comando. Regla para el futuro: un timeout de `AskUserQuestion` **no** es
autorización, ni siquiera para cambios aditivos/reversibles de
`firestore.rules` — hay que esperar respuesta real o preguntar de nuevo,
nunca proceder por inferencia de "seguro es de bajo riesgo". (El commit
de Etapa 2 sí se hizo con autorización explícita del usuario en el
siguiente turno.)

### Plan detallado de Etapa 1 (ya ejecutado)
Ver `C:\Users\etigr\.claude\plans\groovy-wondering-phoenix.md` para el
plan completo aprobado con todo el razonamiento de diseño (por qué cada
función se reusó o se creó nueva, qué queries necesitan índice compuesto
y cuáles no, etc.) — no se repite acá para no duplicar.

### Qué se construyó (archivos)
- `src/pages/reportes-candidate.js` — shell: `TABS` (12 secciones, solo 4
  `ready:true`), Resumen General inline.
- `src/pages/reportes-votantes-candidate.js` — flags auto-declarados
  (`requiresPickup`/`needsAssistance`/`canBeDriver`/`wantsToBeMesario` de
  `savedRecords`) + drill-down a 300 + duplicados.
- `src/pages/reportes-registros-candidate.js` — tabla paginada con UN
  filtro por vez (dirigente/local/seccional/mesa) + búsqueda de dirección
  client-side sobre lo ya filtrado + export Excel.
- `src/pages/reportes-equipo-candidate.js` — productividad+calidad por
  usuario (roster paginado, nunca `getAllCandidateUsers`).
- `src/lib/firebaseCandidate.js` — funciones nuevas: `getDuplicateCedulas`
  (extraída de `campaign.js::renderAuditoria`, ahora compartida),
  `getCandidateUsersCountByRole`, `getMesariosCount`,
  `getElectionDayControlStatusCount`, `getUserRecordsCount`,
  `getRecordFlagCountForUser`, `getLastRecordActivityForUser`,
  `getCallsCountByOperator`, `getRecordFlagCounts`, `getRecordsByFlag`,
  `listRecordsPageFiltered`.
- `src/lib/rbacCatalog.js` — módulo `reports` + permisos
  `reports.view`/`reports.export` (este último declarado pero sin
  enforcement de UI todavía — el botón de exportar es visible sin
  chequeo de permiso puntual, aceptado como límite de Etapa 1).
- `firestore.rules` — se agregó `'auditor'` al `allow read` de
  **6 colecciones**: `callAssignments`, `electionStatus`, `calls`,
  `incidents`, `electionDayControl`, **`users`** (esta última no estaba en
  el plan original, se descubrió probando en vivo — ver §4).
- `firestore.indexes.json` — 3 índices nuevos en `savedRecords`:
  `local+savedAt DESC`, `seccional+savedAt DESC`, `mesa+savedAt DESC`.

### Verificación ya hecha
- Build local OK. Code-review por agente encontró y se corrigieron 2 bugs
  reales antes de dar por cerrada la etapa: `reportes-registros-candidate.js`
  usaba `getAllCandidateUsers` sin paginar (ahora usa roster paginado
  igual que Equipo), y el botón "Filtrar" dejaba pasar un valor vacío
  (ahora valida antes de disparar la query).
- Probado en navegador (Playwright) contra `candidato-test` con
  `campaign_admin` (`candidato-test-admin@example.com` / `TestAdmin123!`)
  y con `auditor` (`rol-auditor@example.com` / `Auditor123!`) — los 4
  tabs cargan sin errores de consola, números plausibles.
- `firestore.rules`+`firestore.indexes.json` desplegados a producción.
- Sanity check de datos (vía Admin SDK, sin loguearse como usuario real
  para no tocar contraseñas de gente real) contra `samy-fidabel`: counts
  coherentes (1708 registros, 135 usuarios, 6 choferes, 0 mesarios, 24
  dirigentes, 0 votaron — Día D nunca se corrió en producción todavía),
  índice `local+savedAt` construido y funcionando.

### Qué falta para cerrar Etapa 1 del todo
- **Commitear y pushear** los 9 archivos pendientes (ver `git status` en
  §2) — decisión del usuario, no se hizo automáticamente.
- **Deploy frontend a Netlify** (manual, ver §2) para que el módulo sea
  visible en `https://fastidious-souffle-150794.netlify.app/`.
- Decidir si se prueba también con una cuenta real de `samy-fidabel`
  desde la UI (requeriría coordinar con el dueño de una cuenta real, no
  resetear contraseñas de gente sin avisar).

### Antes de empezar Etapa 2
Repetir el mismo proceso: auditoría previa de lo que ya existe en Centro
de Contacto/Día D/Choferes/Mesarios/Dirigentes (gran parte de las
métricas pedidas YA se calculan en esos módulos — reusar, no duplicar,
mismo criterio que Etapa 1), plan formal, y **probar con cuentas reales
de cada rol nuevo que se agregue a `TAB_ROLES.reportes`**, no asumir por
la regla escrita.

## 8. Credenciales de prueba conocidas (todas reseteadas/verificadas esta sesión)

| Email | Password | Candidato | Rol |
|---|---|---|---|
| `candidato-test-admin@example.com` | `TestAdmin123!` | candidato-test | campaign_admin |
| `rol-operador@example.com` | `Operador123!` | candidato-test | operador |
| `rol-auditor@example.com` | `Auditor123!` | candidato-test | auditor |
| `rol-mesario@example.com`, `rol-chofer@example.com`, `rol-coordinator@example.com`, `rol-dirigente@example.com`, `rol-viewer@example.com`, `rol-cashier@example.com`, `rol-finance-admin@example.com`, `rol-finance-operator@example.com` | desconocida, resetear con Admin SDK si hace falta (mismo patrón: `auth.updateUser(uid, {password})`) | candidato-test | uno por rol |
| `miguelcaceres@asf.com` | `miguelcaceres123` | miguel-caceres (vacío) | campaign_admin |

⚠️ La vieja `PROMPT_MAESTRO.md` decía que la password de
`candidato-test-admin@example.com` era `PruebaCand2026` — **ya no es así**,
se reseteó esta sesión a `TestAdmin123!`.

Para resetear cualquier password de prueba: usar `firebase-service-account.json`
(ya en la raíz, gitignored) con `firebase-admin` vía Node — patrón usado
repetidamente esta sesión, ver cualquier script en `scripts/` como
referencia de `getDb()`/inicialización.

## 9. Convenciones de código

- Estilos inline en template strings, sin CSS framework. Paleta por
  módulo: Día D = rojo/vino `#c41e3a`; Centro de Contacto/dirigente =
  morado `#6a1b9a`; chofer/mesario = azul `#1976d2`; Finanzas = verde
  azulado `#00695c`; **Reportes = índigo `#283593`→`#1a237e`** (nuevo).
- `escapeHtml()` siempre al interpolar datos de usuario en `innerHTML`.
- `debounce()` (250ms) en inputs de búsqueda.
- Cada módulo `*-candidate.js` exporta `render{Nombre}Candidate(container/body, candidateId, user, myRole, misRoles=[])`.
- Familias de sub-reportes en archivos separados (`reportes-votantes-candidate.js`
  etc.), importados dinámicamente solo al entrar a esa sub-tab.
- `exportGenericToExcel(rows, filename, sheetName)` (`src/lib/excel.js`) es
  el único helper de export a Excel — reusarlo siempre, nunca reimplementar.
- Todas las funciones de `firebaseCandidate.js` reciben `candidateId`
  explícito como primer parámetro, nunca leído de un campo editable del
  cliente.
- Nunca usar `getAllRecords`/`getAllCandidateUsers`/`getAllElectionDayControl`/etc.
  (`getAll*` sin paginar) en código nuevo, salvo casos ya documentados
  como excepción intencional (`getDuplicateCedulas`).
- Antes de deploy: `npm run build` (frontend), `cd functions && npm run build`
  (TypeScript), y probar con Playwright headless (`chromium.launch()`,
  sin `chromium-cli` disponible en este entorno Windows) contra el dev
  server local antes de tocar producción.
- **Autonomía:** actuar sin pedir confirmación en pasos rutinarios/
  reversibles. Pausar para: cambios de `firestore.rules`/permisos que
  tocan producción real (avisar igual, aunque sean aditivos), commits/
  pushes/deploys (confirmar alcance), y cualquier acción sobre cuentas de
  usuarios reales (nunca resetear contraseñas de gente real sin avisar).

## 10. Cómo retomar en un chat nuevo

1. Leer este archivo completo.
2. `git status` y `git log --oneline -5` para confirmar que coincide con §2.
3. Si el pedido es sobre Reportes: leer `C:\Users\etigr\.claude\plans\groovy-wondering-phoenix.md`
   para el detalle de diseño de Etapa 1, y §7 de este documento para el
   estado actual y qué sigue.
4. Si hay que probar algo: usar las cuentas de §8, siempre contra
   `candidato-test` primero.
5. Si hay que deployar frontend: recordar que el build automático de
   Netlify está roto (§2/§5) — usar `npm run build && netlify deploy --prod --dir=dist`.
6. Ante cualquier rol nuevo que vea una pestaña nueva: aplicar la lección
   de §4 (probar con cuenta real de ese rol, no solo leer las reglas).
