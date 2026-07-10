# PROMPT MAESTRO — samy-app (estado actual)

> Generado como snapshot completo del proyecto para arrancar una sesión nueva sin perder contexto. Reemplazá este bloque de cabecera si lo volvés a regenerar más adelante — fecha de este snapshot: 2026-07-10.

## 1. Qué es esto

App originalmente construida para la campaña municipal de un solo candidato (Samy Fidabel, concejal 2026, Paraguay) que se transformó en una **plataforma SaaS multicandidato/multitenant**: cualquier candidato nuevo puede tener su propia campaña aislada dentro del mismo proyecto Firebase, compartiendo únicamente el padrón electoral.

- **Firebase project:** `samy-fidabel` (real, en producción — no hay emulador, todo se prueba en vivo contra este proyecto).
- **Stack:** Vite + JS vanilla (sin framework), Firebase v10 (client SDK), firebase-admin v13 (scripts Node), firebase-functions v7 (Cloud Functions **v2** — `onCall(async (request) => ...)`, nunca la firma vieja `(data, context)`, eso rompe todo con "unauthenticated").
- **Deploy:** Netlify (frontend) — URL pública: `https://fastidious-souffle-150794.netlify.app/`. Firebase (rules/indexes/functions) se despliega directo con `firebase deploy`.
- **Sin test runner ni emuladores.** La verificación de cada feature se hace con scripts Node desechables (`.mjs`, client SDK) que inician sesión como usuarios reales de prueba y ejercitan el flujo real contra producción — **siempre se borran al terminar**, junto con los datos de prueba que crean (Firestore docs + cuentas de Auth vía self-`deleteUser()` o Admin SDK).

## 2. ⚠️ Estado de git — IMPORTANTE

El último commit real es `d9bf927 "Fase 1 seguridad..."`. **Todo lo demás de este documento (toda la transformación multicandidato, Centro de Contacto, Día D Control, etc.) está sin commitear** — vive en el working tree. Las reglas/índices/funciones de Firebase **sí están desplegadas en producción** (se hace `firebase deploy` en cada iteración), pero el repo git está atrasado respecto a lo que corre en vivo. Antes de asumir que algo "no existe" por no verlo en `git log`, revisar el filesystem directamente.

`git status --short` en este momento: gran cantidad de archivos legacy borrados (limpieza Fase 6: duplicados, backups, scripts con passwords hardcodeados, restos de un árbol Next.js que nunca se usó) + todos los archivos nuevos del modelo multicandidato como `??` (untracked).

## 3. Arquitectura de datos

### Legacy (un solo candidato — Samy Fidabel, colecciones top-level)
`/users`, `/voters`, `/savedRecords`, `/dia_d_votos`, `/mesa_votacion2025`, `/config`, etc. **Se mantienen intactas a propósito** mientras dura la migración — nunca se tocan salvo que el pedido sea explícitamente sobre el flujo legacy. `src/pages/admin.js`, `src/modules/dia-d-control.js`, `src/modules/dia-d-admin.js` (sin sufijo `-candidate`) operan sobre este esquema.

### Multicandidato (el modelo activo — todo lo nuevo va acá)
```
/platformUsers/{uid}                          → { globalRole: 'superadmin' }
/userCandidateIndex/{uid}                      → { [candidateId]: { role, updatedAt } }  (solo Cloud Functions escriben)
/candidates/{candidateId}                      → metadata (name, logoUrl, primaryColor, electionName, electionDate, lista, opcion)
/candidates/{candidateId}/users/{uid}          → roster + rol candidate-scoped
/candidates/{candidateId}/savedRecords/{id}    → contactos guardados por dirigentes (cedula, nombre, telefono, direccion, local, mesa, orden, requiresPickup, needsAssistance, canBeDriver, wantsToBeMesario, chofer_asignado, uid del dirigente dueño)
/candidates/{candidateId}/drivers/{id}         → choferes (nombre, celular, vehiculo, local/seccional, usuarioAsignado, montoEntregado, votantes[])
/candidates/{candidateId}/diaD/current         → { enabled } toggle Día D
/candidates/{candidateId}/diaD/current/votes/{seccional_mesa_cedula}  → votos marcados (marcarVoto())
/candidates/{candidateId}/config/{configId}    → electionDay, diaDControlSettings
/candidates/{candidateId}/auditLogs/{id}       → solo Cloud Functions escriben

# Centro de Contacto Electoral (llamadas PREVIAS a la elección)
/candidates/{candidateId}/callAssignments/{voterId}   → doc id = savedRecords id; { assignedUserId (operador), assignedBy, status }
/candidates/{candidateId}/electionStatus/{voterId}    → 15 flags booleanos (contacted, confirmedToVote, noAnswer, etc.) + lastStatus
/candidates/{candidateId}/calls/{id}                  → historial de llamadas
/candidates/{candidateId}/followUps/{id}              → agenda "volver a llamar"
/candidates/{candidateId}/incidents/{id}              → REUTILIZADA también por Día D Control (mismo shape)

# Día D Control (operación EN VIVO el día de la elección — no confundir con lo de arriba)
/candidates/{candidateId}/electionDayControl/{voterId}  → doc id = savedRecords id; { assignedDriverId, assignedLeaderId, assignedTableUserId, status (15 valores: pending/contacted/on_the_way/picked_up/arrived_polling_place/arrived_table/voted/no_answer/not_found/will_not_vote/incident/resolved/committed/pickup_required/driver_assigned), requiresPickup, needsAssistance, incidentOpen, critical, lastMovementAt, lastUpdatedBy, lastUpdatedRole }
/candidates/{candidateId}/electionDayMovements/{id}     → historial inmutable de cambios de estado
/candidates/{candidateId}/electionDayAlerts/{id}        → alertas (client-computed, ver sección 6)
/candidates/{candidateId}/electionDayReports/{id}       → informes periódicos (client-computed)
```

**El padrón (`/voters`) es la ÚNICA colección compartida entre todos los candidatos a propósito** — mismo registro electoral, lectura abierta a cualquier autenticado, escritura solo superadmin/admin legacy. Nunca se copia por candidato.

**Convención clave repetida en todo el código nuevo:** `voterId` en Centro de Contacto y Día D Control es siempre el **id de un doc de `savedRecords`** de ese candidato — nunca del padrón compartido. Esto permite reusar `getRecordsByIds()` (batch de `getDoc()`, no queries masivas) y mantiene todo el modelo operativo dentro del candidato.

## 4. Roles

Candidate-scoped (`/candidates/{candidateId}/users/{uid}.role`): `campaign_admin`, `coordinator`, `dirigente`, `mesario`, `operador`, `chofer`, `viewer`, `auditor`. Lista autoritativa en 3 lugares que **deben coincidir**: `functions/src/index.ts` (`CANDIDATE_ROLES`), `firestore.rules` (allowlist de creación en `/candidates/{candidateId}/users`), `src/pages/campaign.js` (`ROLE_LABELS`, `TAB_ROLES`, `roleColor()`).

- `campaign_admin` / `coordinator` → ven todo dentro de su candidato.
- `dirigente` → sus propios `savedRecords` (`uid == self`) + los que le reasignen vía `electionDayControl.assignedLeaderId`.
- `mesario` → antes solo marcaba votos de su mesa vía `isMesarioOfMesa()` (seccional+mesa en su perfil, REGLA OBLIGATORIA 5, no tocar). Ahora también ve Día D Control vía `assignedTableUserId` — **son dos mecanismos de asignación de mesario en paralelo, no unificados** (ver sección 7, pendiente).
- `operador` → Centro de Contacto, solo lo que tiene en `callAssignments.assignedUserId`.
- `chofer` → Día D Control, solo lo vinculado a su driver (`drivers.usuarioAsignado == uid`, resuelto en rules con la función `isDriverOwner()`).
- Platform-level: `superadmin` (`/platformUsers/{uid}.globalRole`).

## 5. Módulos (pestañas de `campaign.js`)

| Tab | Archivo | Roles | Qué hace |
|---|---|---|---|
| 📊 Resumen | `campaign.js::renderResumen` | todos | dashboard: padrón, registros, usuarios, choferes, equipo por rol, necesidades (transporte/ayuda/chofer/mesario con %), **Calidad de los datos** (% con teléfono/ubicación/dirección), registros por local |
| 🗳️ Buscar votante | `campaign.js::renderVotantes` | admin/coord/dirigente/mesario | busca en padrón compartido, modal "Guardar contacto" con flags |
| 📇 Mis registros | `campaign.js::renderMisRegistros` | admin/coord/dirigente | mismo diseño de tabla/filtros que Registros, sin columna Dirigente, con columnas Sí/No por Chofer/Mesario/Ayuda Gs./Transporte + filtros por cada una |
| 👥 Usuarios | `campaign.js::renderUsuarios` | admin | crear/editar rol/password/mesa, buscador, enviar acceso por WhatsApp |
| 📋 Registros | `campaign.js::renderRegistros` | admin/coord/viewer/auditor | tabla completa, filtros combinables (texto/local/mesa/dirigente + Chofer/Mesario/Ayuda Gs./Transporte), Excel/imprimir |
| ⚠️ Auditoría | `campaign.js::renderAuditoria` | admin/auditor | duplicados internos + coincidencias entre candidatos (Cloud Function `auditarCoincidenciasEntreCandidatos`, no revela datos del otro candidato) |
| 🚗 Choferes | `chofer-candidate.js` | admin/coord | 2 tabs: Listado (CRUD + monto entregado + total) y Votantes asignados (asignar por CI con filtros, enviar listado por WhatsApp, quitar asignación) |
| 📞 Centro de Contacto | `contactCenter.js` | admin/coord/operador | Pendientes (dashboard+filtros clickeables), En seguimiento, Confirmados, Asignación (admin), Incidencias, ficha de votante con historial de llamadas + ESTADO ELECTORAL |
| ⚙️ Día D Admin | `dia-d-admin-candidate.js` | admin/coord | toggle Día D, ranking, por local/mesa (compara contra padrón), choferes con "faltantes" |
| 🎮 Día D Control | `dia-d-control-candidate.js` | admin/coord/dirigente/mesario/chofer | **upgradeado esta sesión**: 3 vistas simples por rol (botones grandes) + panel admin completo (12 tarjetas clickeables, filtros, ranking, alertas, informes, asignar chofer/dirigente/mesario, sincronizar legacy) |
| 🛠️ Configuración | `campaign.js::renderConfiguracion` | admin | nombre, logo, color, lista/opción (para mensajes de WhatsApp) |

**Superadmin** (`superadmin.js`): crea candidatos nuevos, ve stats agregadas de la plataforma.

## 6. Decisiones de arquitectura que importa recordar

1. **Cloud Functions v2, siempre.** `onCall(async (request: functions.https.CallableRequest<any>) => { request.data; request.auth })`. La firma v1 rompe TODO con "unauthenticated" incluso para el caller correcto (bug real encontrado en vivo).
2. **`collectionGroup` con reglas que dependen de `get()`/`resource.data` NO es "demostrable" para Firestore** en queries `list()` — confirmado repetidas veces en vivo. Por eso `/userCandidateIndex/{uid}` existe (lookup por `getDoc()` directo, no query). Para queries `list()` normales (no collectionGroup) dentro de una sola colección, un filtro `resource.data.campo == uid` **si funciona**, pero **solo si el `where()` de la query filtra exactamente por ese mismo campo** — si la regla depende de `resource.data.campoA` pero la query solo filtra por `campoB`, Firestore rechaza el query aunque el campoA sea correcto para cada doc individualmente (encontrado 2 veces esta sesión: `getCallHistory` para operador necesitó agregar `where('assignedUserId', '==', uid)` aunque ya filtraba por `voterId`; mismo patrón para `getCallsSince`).
3. **Reglas con `get()` encadenado SÍ funcionan para `list()`** cuando el `get()` no depende de `resource.data` del doc que se está leyendo (ej. `hasCandidateRole()` hace `get()` a un doc fijo derivado de `request.auth.uid`, no del doc en la query). Cuando el `get()` SÍ depende de `resource.data` (ej. `isDriverOwner()` resuelve `resource.data.assignedDriverId` y de ahí hace otro `get()`), también funciona **siempre que la query tenga el `where()` equivalente** — verificado en vivo esta sesión con `electionDayControl` + chofer.
4. **`voterId` = id de `savedRecords`**, nunca del padrón — repetido en Centro de Contacto y Día D Control para poder dar acceso puntual (`get()`, no `list()`) a roles operativos sin exponerles el resto de `savedRecords`.
5. **No hay Cloud Scheduler.** Alertas e informes periódicos (Día D Control) son *client-computed*: se generan con un botón manual o un `setInterval` mientras el panel está abierto, y se persisten en Firestore. Si se necesita alerta 24/7 sin nadie mirando la pantalla, hace falta una Cloud Function programada — no implementada, es una decisión de infra más grande que quedó fuera de alcance.
6. **`estado_dia_d` y `chofer_asignado` en `savedRecords` son campos legacy** que Día D Admin (no tocado) sigue leyendo/escribiendo. `setDiaDStatus()` (Día D Control nuevo) ya NO escribe `estado_dia_d` (nada lo lee en el modelo candidato-scoped, solo generaba `permission-denied` para chofer/mesario que no pueden escribir `savedRecords`). Sí sincroniza `chofer_asignado` cuando admin asigna chofer, y hace un intento *best-effort* (con try/catch) de `marcarVoto()` al marcar "Votó" — best-effort porque esa función exige `isMesarioOfMesa()` (mecanismo viejo de seccional+mesa en el perfil), no `assignedTableUserId` (mecanismo nuevo). **Estos dos mecanismos de mesario no están unificados — pendiente si se quiere.**
7. **Metodología de verificación:** cada feature nueva se prueba con un script `.mjs` desechable en la raíz del repo que usa el client SDK, inicia sesión como usuarios reales (existentes o creados/borrados en el mismo script), ejercita el flujo exacto, corre asserts, y se autolimpia (`deleteDoc`/`deleteUser` propio vía self-delete). El script se borra al final. Nunca se toca una cuenta que el usuario haya creado manualmente para su propio testing.

## 7. Pendientes / no implementado (mencionado explícitamente en cierres de sesión anteriores)

- Unificar el mecanismo de asignación de mesario (`assignedTableUserId` nuevo vs. `seccional`/`mesa` en el perfil, viejo).
- Cloud Scheduler para alertas/informes de Día D Control verdaderamente 24/7.
- Commitear todo el trabajo de esta sesión a git (ver sección 2).
- El repo tiene chunks de build >500kB sin code-splitting (warning de Vite, no bloqueante).

## 8. Convenciones de código (para mantener consistencia)

- Estilos inline en template strings, sin CSS framework. Paleta: rojo/vino `#c41e3a` para Día D, morado `#6a1b9a`/`#9c27b0` para Centro de Contacto/dirigente, azul `#1976d2`/`#2196f3` para chofer/mesario, verde `#2e7d32` para confirmaciones.
- `escapeHtml()` (`src/lib/escapeHtml.js`) SIEMPRE al interpolar datos de usuario en `innerHTML`.
- `debounce()` (`src/lib/debounce.js`) en inputs de búsqueda (250ms).
- Filtros de tabla: combinables con AND, nunca mutuamente excluyentes.
- `normalizarTelefonoPY()` / `normalizarTelefono()`: agrega prefijo `595`, saca el `0` inicial, para links `wa.me`.
- Todas las funciones de `firebaseCandidate.js` reciben `candidateId` como primer parámetro explícito — nunca se lee de un campo editable del cliente, siempre viene de la sesión resuelta (`candidateContext.js` → `main.js` → `campaign.js`).
- Antes de cualquier deploy de rules/indexes/functions: `node --check` en los `.js` tocados, `npm run build`, `npx tsc --noEmit` en `functions/`.
- **Autonomía:** actuar sin pedir confirmación en pasos rutinarios/reversibles (crear/editar código, deploys de rules/functions, tests desechables). Pausar solo para lo genuinamente irreversible/alto impacto (force-push, borrar datos que el usuario creó manualmente, etc.).

## 9. Cómo retomar

1. Leer este archivo.
2. `git status` para confirmar qué sigue sin commitear.
3. Si hace falta verificar que producción sigue como acá describe: `firebase deploy --only firestore:rules` (dry via compile check) o simplemente leer `firestore.rules`/`firestore.indexes.json`/`functions/src/index.ts` directo del filesystem — son la fuente de verdad, no este documento si hay diferencias.
4. Credenciales de prueba conocidas: `candidato-test-admin@example.com` / `PruebaCand2026` sobre `candidateId = 'candidato-test'`.
