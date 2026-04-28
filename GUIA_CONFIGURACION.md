# 🔴⭐ SAMY FIDABEL – App de Campaña
## Guía completa de configuración y despliegue

---

## 1. CREAR PROYECTO EN FIREBASE

1. Ir a https://console.firebase.google.com
2. Click en **"Agregar proyecto"**
3. Nombre: `samy-fidabel` (o el que prefieras)
4. Desactivar Google Analytics (opcional)
5. Click **"Crear proyecto"**

---

## 2. CONFIGURAR AUTHENTICATION

1. En el panel lateral → **Authentication** → **Comenzar**
2. Ir a la pestaña **"Sign-in method"**
3. Habilitar **"Correo electrónico/contraseña"**
4. Guardar

---

## 3. CONFIGURAR FIRESTORE DATABASE

1. En el panel lateral → **Firestore Database** → **Crear base de datos**
2. Elegir modo: **"Comenzar en modo de producción"** (usaremos las reglas del archivo)
3. Seleccionar región: **`us-central1`** (o la más cercana)
4. Click **"Habilitar"**

### Aplicar reglas de seguridad:
1. Ir a **Firestore → Reglas**
2. Copiar el contenido de `firestore.rules` y pegarlo
3. Click **"Publicar"**

### Crear índices:
1. Ir a **Firestore → Índices**
2. Crear índices compuestos manualmente O esperar que aparezcan los enlaces en la consola del navegador cuando uses la app por primera vez

---

## 4. OBTENER CONFIGURACIÓN DE LA APP WEB

1. En el panel principal → ⚙️ **Configuración del proyecto**
2. Bajar hasta **"Tus apps"** → Click en el ícono **`</>`** (Web)
3. Registrar app: nombre `samy-web`
4. **NO** marcar Firebase Hosting (usaremos Netlify)
5. Copiar el objeto `firebaseConfig` que aparece

---

## 5. PEGAR LA CONFIGURACIÓN EN EL CÓDIGO

Abrir el archivo `src/lib/firebase.js` y reemplazar:

```javascript
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROJECT.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
}
```

Con los valores reales que copiaste del paso anterior.

---

## 6. CREAR EL PRIMER USUARIO ADMINISTRADOR

1. Abrir la app (localmente o en Netlify)
2. Registrarse con tu email y contraseña
3. Ir a **Firestore → users** en la consola de Firebase
4. Buscar tu documento de usuario (tiene tu UID)
5. Editar el campo `role` → cambiar de `"user"` a `"admin"`
6. Guardar

A partir de ahí, desde el panel Admin de la app podés dar rol de Admin a otros usuarios.

---

## 7. IMPORTAR EL PADRÓN

### Opción A – Desde la app (recomendado para padrón pequeño o conexión rápida):
1. Iniciar sesión como admin
2. Ir a **Admin → Importar Padrón**
3. Subir el archivo `padron_fernando_de_la_mora.xlsx`
4. Esperar que complete (puede tardar 10-20 minutos para 57.000 registros)

### Opción B – Script local (más rápido, para conexión lenta):
```bash
npm install firebase-admin xlsx
node importar_padron.js
```
*(crear script separado usando firebase-admin)*

---

## 8. COMPILAR EL PROYECTO

```bash
# Instalar dependencias
npm install

# Compilar para producción
npm run build
```

Esto genera la carpeta `dist/` lista para Netlify.

---

## 9. DESPLEGAR EN NETLIFY

### Opción A – Netlify Drop (más fácil):
1. Ir a https://app.netlify.com/drop
2. Arrastrar la carpeta `dist/` al área indicada
3. ¡Listo! Te da una URL automáticamente

### Opción B – Netlify con GitHub (recomendado para actualizaciones):
1. Subir el proyecto a GitHub (no la carpeta `dist/`, sino el proyecto completo)
2. En Netlify → **"Add new site" → "Import from Git"**
3. Conectar tu repositorio
4. Configurar:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. Click **"Deploy site"**

### Configurar dominio personalizado (opcional):
1. En Netlify → **Domain management**
2. Agregar tu dominio

---

## 10. ESTRUCTURA DE FIRESTORE

```
voters/                  ← Padrón de afiliados (importado)
  {voterId}/
    cedula: "1234567"
    nombre: "GARCIA LOPEZ JUAN"
    nombre_upper: "GARCIA LOPEZ JUAN"  ← para búsqueda
    direccion: "Calle Principal 123"
    seccional: "169"
    nacimiento: "01/01/1980"
    afiliacion: "15/06/2005"

users/                   ← Perfiles de usuarios
  {uid}/
    email: "usuario@ejemplo.com"
    displayName: "Juan García"
    role: "user" | "admin"
    createdAt: timestamp

savedRecords/            ← Registros guardados por campaña
  {recordId}/
    uid: "uid-del-usuario"
    cedula: "1234567"
    nombre: "GARCIA LOPEZ JUAN"
    direccion: "Calle Principal 123"
    seccional: "169"
    telefono: "0981123456"
    nota: "vecino de la cuadra"
    savedAt: timestamp
```

---

## FUNCIONALIDADES DE LA APP

| Funcionalidad | Descripción |
|---|---|
| 🔍 Búsqueda por cédula | Búsqueda exacta por número de CI |
| 🔍 Búsqueda por nombre | Búsqueda por apellidos y nombres |
| 💾 Guardar con teléfono | Guarda el afiliado con su número |
| 📲 Compartir WhatsApp | Comparte el registro por WA |
| 📋 Mis Registros | Lista personal de guardados |
| 📥 Exportar Excel | Descarga registros propios en .xlsx |
| ⚙️ Panel Admin | Solo para admins |
| 📊 Estadísticas | Resumen de actividad de campaña |
| 👥 Gestión de usuarios | Dar/quitar roles de admin |
| 📤 Importar Padrón | Subir el Excel del padrón a Firebase |

---

## SOPORTE

Ante cualquier problema técnico, revisar:
- Consola del navegador (F12) para errores de Firebase
- Reglas de Firestore (permisos)
- Índices de Firestore (si hay error de "index required", seguir el link que aparece)
