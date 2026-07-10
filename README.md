# samy-app — plataforma multicandidato

App de gestión de votantes/campaña electoral. Construida en Vite + JavaScript vanilla + Firebase (Auth, Firestore, Cloud Functions). Soporta múltiples candidatos aislados entre sí sobre la misma base de Firebase.

Este documento cubre lo que se hizo en la migración de "un solo candidato" (Samy Fidabel) a "plataforma multicandidato", y las operaciones que quedan a cargo de quien administra la plataforma (rotar credenciales, desplegar reglas, migrar datos, crear candidatos).

## Estado de esta migración

Lo que **ya está hecho en el código** (revisado, compila, no se desplegó a producción todavía):

- Seguridad crítica cerrada: auto-escalado de rol, contraseñas en texto plano, secretos versionados en git, historial de git purgado.
- Modelo de datos nuevo (`/platformUsers`, `/candidates/{candidateId}/...`) y reglas de Firestore completas para ese modelo, conviviendo con el esquema legacy de Samy Fidabel sin romperlo.
- Cloud Functions nuevas para crear candidatos/usuarios y cambiar roles/contraseñas, todas con validación server-side.
- Scripts de backup y migración (con dry-run) de los datos actuales de Samy Fidabel hacia `/candidates/samy-fidabel/...`.
- Optimizaciones de performance (paginación, debounce, lazy loading por rol, Día D sin releer la colección completa en cada voto).
- Paneles nuevos: superadmin (crear/administrar candidatos) y campaña (por candidato).
- Limpieza de ~23 archivos de código muerto.

Lo que **falta y requiere una acción tuya** (no lo hace el código solo):

1. **Rotar la clave de servicio de Firebase** (`firebase-service-account.json` estuvo expuesta en git). Ver [Rotar credenciales](#rotar-credenciales).
2. **Desplegar** las reglas y las Cloud Functions nuevas a Firebase (nada de esto está en producción todavía).
3. **Crear el primer superadmin** con `scripts/create-superadmin.js`.
4. **Correr la migración** de Samy Fidabel (`scripts/migrate-to-candidate.js`) cuando quieras cortar a los datos existentes hacia el modelo nuevo.
5. Validar con las 6 cuentas de prueba de la sección [Plan de pruebas](#plan-de-pruebas) antes de dar por cerrada la migración.

Hasta que no se haga el punto 4, **la app de Samy Fidabel sigue funcionando exactamente igual que antes** sobre las colecciones legacy (`users`, `voters`, `savedRecords`, etc.) — el modelo nuevo convive en paralelo sin interferir.

## Arquitectura

```
/voters/{voterId}                             → padrón electoral ÚNICO, COMPARTIDO por todos los candidatos
/platformUsers/{uid}                          → solo superadmins de plataforma
/candidates/{candidateId}                     → metadata del candidato (nombre, logo, color, elección)
/candidates/{candidateId}/users/{uid}          → usuarios de ESE candidato (campaign_admin, coordinator, operator, mesario, viewer, auditor)
/candidates/{candidateId}/savedRecords/{id}    → registros/contactos de campaña (privados de ese candidato)
/candidates/{candidateId}/diaD/current/votes/{id} → votos marcados el día D (privados de ese candidato)
/candidates/{candidateId}/drivers/{id}         → choferes (privados de ese candidato)
/candidates/{candidateId}/config/electionDay   → interruptor de Día D (privado de ese candidato)
/candidates/{candidateId}/auditLogs/{id}       → auditoría (solo la escriben las Cloud Functions)
```

**El padrón (`/voters`) es la única excepción al aislamiento: es el mismo registro electoral para todos los candidatos**, no un dato de campaña — cualquier usuario autenticado (de cualquier candidato) puede leerlo/buscarlo, pero solo superadmin (o el admin legacy de Samy) puede cargarlo/actualizarlo. Todo lo demás — militantes, mesarios, choferes, registros/contactos, votos de Día D — es privado de cada candidato y `firestore.rules` lo garantiza a nivel de path (un usuario solo tiene un doc de membresía bajo el/los candidateId a los que pertenece; las reglas de cada subcolección exigen esa membresía para el candidateId exacto de la ruta que se está consultando). Los datos actuales de Samy Fidabel (militantes, choferes, mesarios, registros) nunca se comparten ni se tocan al crear o migrar otro candidato.

Roles: `superadmin` (plataforma completa, vive en `/platformUsers`) y, por candidato, `campaign_admin`, `coordinator`, `operator`, `mesario`, `viewer`, `auditor`.

Código relevante:
- `src/lib/firebaseCandidate.js` — todas las consultas/escrituras candidate-scoped (paginadas, con `where`/`limit`, nunca `getDocs` sin acotar).
- `src/lib/candidateContext.js` — resuelve a qué candidato(s) pertenece el usuario logueado y cuál queda activo.
- `src/pages/superadmin.js` — panel de plataforma.
- `src/pages/campaign.js` — panel de campaña por candidato.
- `functions/src/index.ts` — Cloud Functions (creación de usuarios/candidatos, cambio de rol, reset de contraseña — todo validado en el servidor).
- `src/lib/firebase.js`, `src/pages/admin.js`, `src/modules/dia-d-*.js` — el esquema legacy de un solo candidato (Samy Fidabel), que se mantiene funcionando hasta la migración.

## Rotar credenciales

La clave de Firebase Admin SDK (`firebase-service-account.json`) estuvo commiteada en el repo. Se sacó del working tree y se purgó del historial de git, pero **la clave en sí sigue siendo válida hasta que la revoques**:

1. Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio.
2. "Generar nueva clave privada" → descargar el JSON.
3. Guardarlo como `firebase-service-account.json` en la raíz del repo (ya está en `.gitignore`, no se va a commitear).
4. En la misma pantalla, revocar/eliminar la clave vieja.

Los scripts de `scripts/` buscan la clave automáticamente en `firebase-service-account.json` o `serviceAccountKey.json` en la raíz, o en la ruta que pongas en `FIREBASE_SERVICE_ACCOUNT_PATH`.

## Desplegar reglas, índices y Cloud Functions

Nada de lo nuevo está en producción hasta que corras esto (requiere `firebase-tools` autenticado contra el proyecto `samy-fidabel`):

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
cd functions && npm install && npm run build && cd ..
firebase deploy --only functions
```

Recomendado: revisar `firestore.rules` en el simulador de reglas de la consola de Firebase antes de desplegar a producción, sobre todo la primera vez.

## Crear el primer superadmin

```bash
node scripts/create-superadmin.js --email=vos@tuempresa.com --name="Tu Nombre"
```

Si el email no existe en Firebase Auth, se crea la cuenta y se imprime una contraseña generada (copiala, no se vuelve a mostrar). Si ya existe, solo se le agrega el rol.

## Crear un candidato nuevo

Desde el panel (una vez que entrás como superadmin, hay un formulario en la pantalla principal), o por script:

```bash
node scripts/create-candidate.js \
  --id=juan-perez \
  --name="Juan Pérez" \
  --admin-name="María González" \
  --admin-email=maria@juanperez2026.com
```

El candidato arranca **100% vacío**: sin votantes, sin registros, sin votos, sin choferes — nada se copia de Samy Fidabel ni de ningún otro candidato. Se crea únicamente el candidato y su primer `campaign_admin`; desde el panel de campaña, ese admin crea al resto de su equipo y carga su propio padrón.

## Migrar los datos de Samy Fidabel

Los datos actuales (padrón, usuarios, registros, votos, choferes) siguen en las colecciones legacy de siempre. Cuando quieras pasarlos al modelo nuevo bajo `/candidates/samy-fidabel/...`:

```bash
# 1. Dry run — no escribe nada, solo muestra el plan y los conteos
node scripts/migrate-to-candidate.js

# 2. Revisá el plan impreso. Si está bien, migrá de verdad:
node scripts/migrate-to-candidate.js --confirm
```

`--confirm` primero hace un backup completo en `backups/pre-migration-<timestamp>/` (JSON, no se commitea) y recién después escribe. **Las colecciones legacy NO se borran** — la migración es aditiva. Podés correrla de nuevo si hace falta (no duplica el candidato si ya existe, aunque sí re-escribiría los documentos migrados).

Si en algún momento querés un backup manual sin migrar nada:

```bash
node scripts/backup.js
```

### Rollback

Como la migración nunca borra las colecciones legacy, el "rollback" más simple es: no cortar el tráfico de la app vieja hacia el modelo nuevo (no hay switch global — cada usuario entra por el modelo nuevo solo si tiene un doc de membresía en `/candidates/*/users` o `/platformUsers`). Si algo salió mal en `/candidates/samy-fidabel/...`, se puede borrar esa subcolección entera desde la consola de Firebase y volver a correr la migración — los datos originales siguen intactos en `voters`, `users`, `savedRecords`, etc. Para recuperar un estado exacto, los JSON de `backups/pre-migration-*/` tienen todo lo que había en cada colección legacy en el momento de migrar.

## Validar seguridad

Cosas concretas para chequear después de desplegar:

- Loguearse con una cuenta sin rol de admin e intentar, desde la consola del navegador, `updateDoc(doc(db,'candidates','samy-fidabel','users', miUid), { role: 'campaign_admin' })` (o el equivalente legacy sobre `/users/{uid}`) — debe fallar con `permission-denied`.
- Confirmar que `firebase-service-account.json`, `serviceAccountKey.json*`, `*.xlsx`, `*.csv` no aparecen en `git status` ni en `git ls-files`.
- Con un usuario del candidato A logueado, intentar leer `/candidates/B/savedRecords`, `/candidates/B/users` o `/candidates/B` desde la consola — debe fallar. Sí debería poder leer `/voters` (es compartido a propósito).
- Revisar que `netlify.toml` no tenga `SECRETS_SCAN_SMART_DETECTION_ENABLED = "false"`.
- Revisar `candidates/{id}/auditLogs` después de crear un usuario o cambiar un rol — debe haber quedado un registro.

## Plan de pruebas

Antes de considerar la migración cerrada, probar con estas 6 cuentas:

1. **Superadmin** — entra al panel de plataforma, ve todos los candidatos, crea uno nuevo, entra a su panel sin que se mezclen datos con otro candidato.
2. **Admin de Samy Fidabel (legacy, sin migrar)** — sigue entrando al panel de siempre (`src/pages/admin.js`), con todos sus datos intactos.
3. **Militante de Samy Fidabel (legacy)** — sigue pudiendo buscar votantes y guardar registros como siempre.
4. **Mesario de Samy Fidabel (legacy)** — sigue entrando al control de votación de su mesa.
5. **Usuario de un candidato nuevo, recién creado** — entra vacío: sin votantes, sin registros, sin choferes.
6. **Usuario de un candidato intentando acceder a datos de otro** — debe ser rechazado por las reglas (ver [Validar seguridad](#validar-seguridad)).

Y, si ya se corrió la migración:

7. **Admin de Samy Fidabel migrado** — entra por el modelo nuevo (`/candidates/samy-fidabel`), ve todos los votantes/registros/usuarios que tenía antes.

## Scripts

| Script | Qué hace |
|---|---|
| `scripts/backup.js` | Exporta todas las colecciones legacy a JSON en `backups/<timestamp>/`. |
| `scripts/migrate-to-candidate.js` | Migra los datos legacy a `/candidates/{id}/...`. Dry-run por defecto, `--confirm` para escribir. |
| `scripts/create-candidate.js` | Crea un candidato nuevo vacío + su primer campaign_admin. |
| `scripts/create-superadmin.js` | Otorga (o crea) el rol de superadmin de plataforma para un email. |

Todos usan `scripts/lib/adminApp.js`, que busca la clave de servicio en `firebase-service-account.json`/`serviceAccountKey.json` en la raíz, o en `FIREBASE_SERVICE_ACCOUNT_PATH`.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción → dist/
```

No hay test runner configurado.

## Pendientes conocidos (no bloqueantes)

- El panel legacy de admin (`src/pages/admin.js`) sigue teniendo varios `getDocs` de colección completa mitigados con un cache de 30s en memoria, no con paginación real por cursor — suficiente para el volumen actual, pero si el padrón crece mucho más conviene portarlo al patrón de `firebaseCandidate.js`.
- El escapado de HTML (`src/lib/escapeHtml.js`) se aplicó a los templates con datos de votantes más expuestos (`dia-d-control.js`); una pasada completa sobre el resto de los `innerHTML` con datos de usuario (nombre, nota, teléfono) en `admin.js` y `dia-d-admin.js` queda como mejora de seguridad adicional recomendada.
- No hay App Check configurado en las Cloud Functions.
- El bundle principal sigue pesando ~620KB (mayormente el SDK de Firebase) — aceptable para esta app, pero si crece más conviene revisar `manualChunks` en `vite.config.js`.
