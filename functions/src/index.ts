import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

admin.initializeApp();

const ALLOWED_ROLES = ["militante", "mesario", "veedor", "admin", "user"];
const CANDIDATE_ROLES = [
  "campaign_admin",
  "coordinator",
  "dirigente",
  "mesario",
  "operador",
  "chofer",
  "viewer",
  "auditor",
];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// NOTA IMPORTANTE: firebase-functions v7 (instalado en este proyecto) usa
// la API de Cloud Functions v2, donde onCall recibe UN SOLO argumento
// `request: CallableRequest<T>` (request.data / request.auth), no el viejo
// `(data, context)` de v1. Usar la firma vieja hace que el segundo
// parámetro llegue `undefined` y toda función falle con "unauthenticated"
// SIEMPRE, incluso para el caller correcto — esto se encontró probando en
// vivo contra producción (crearCandidato rechazaba al superadmin real).
type Auth = functions.https.CallableRequest["auth"];

async function requireCallerIsAdmin(auth: Auth) {
  if (!auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión"
    );
  }
  const callerDoc = await admin
    .firestore()
    .collection("users")
    .doc(auth.uid)
    .get();
  if (callerDoc.data()?.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Solo administradores pueden realizar esta acción"
    );
  }
  return auth.uid;
}

async function requireSuperAdmin(auth: Auth) {
  if (!auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión"
    );
  }
  const doc = await admin
    .firestore()
    .collection("platformUsers")
    .doc(auth.uid)
    .get();
  if (doc.data()?.globalRole !== "superadmin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Solo superadmin puede realizar esta acción"
    );
  }
  return auth.uid;
}

// Superadmin siempre pasa. Si no, exige que el caller tenga uno de los
// roles candidate-scoped indicados en /candidates/{candidateId}/users/{uid}.
async function requireCandidateRole(
  auth: Auth,
  candidateId: string,
  roles: string[]
) {
  if (!auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión"
    );
  }
  const platformDoc = await admin
    .firestore()
    .collection("platformUsers")
    .doc(auth.uid)
    .get();
  if (platformDoc.data()?.globalRole === "superadmin") {
    return auth.uid;
  }
  const memberDoc = await admin
    .firestore()
    .collection("candidates")
    .doc(candidateId)
    .collection("users")
    .doc(auth.uid)
    .get();
  if (!memberDoc.exists || !roles.includes(memberDoc.data()?.role)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "No tenés permiso para esta acción en este candidato"
    );
  }
  return auth.uid;
}

async function writeAuditLog(entry: {
  actorUid: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: any;
  after: any;
}) {
  await admin.firestore().collection("auditLogs").add({
    ...entry,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Mantiene /userCandidateIndex/{uid} (candidateId -> {role}) al día. El
// cliente lo lee con un get() por su propio uid en vez de una query
// collectionGroup sobre "users" filtrada por uid, que Firestore rechaza
// como "no demostrable" para efectos de seguridad de list — confirmado
// probando en vivo contra producción.
async function upsertUserCandidateIndex(
  uid: string,
  candidateId: string,
  role: string
) {
  await admin
    .firestore()
    .collection("userCandidateIndex")
    .doc(uid)
    .set(
      {
        [candidateId]: {
          role,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
}

async function writeCandidateAuditLog(
  candidateId: string,
  entry: {
    actorUid: string;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before: any;
    after: any;
  }
) {
  await admin
    .firestore()
    .collection("candidates")
    .doc(candidateId)
    .collection("auditLogs")
    .add({
      ...entry,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

export const crearNuevoUsuario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const callerUid = await requireCallerIsAdmin(request.auth);

    const { nombre, email, password, rol } = request.data ?? {};

    if (!nombre || !email || !password) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos"
      );
    }

    if (rol && !ALLOWED_ROLES.includes(rol)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Rol inválido: ${rol}`
      );
    }

    try {
      const usuarioRecord = await admin.auth().createUser({
        email,
        password,
        displayName: nombre,
      });

      await admin
        .firestore()
        .collection("users")
        .doc(usuarioRecord.uid)
        .set({
          email,
          nombre,
          role: rol || "user",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
          estado: "activo",
        });

      await writeAuditLog({
        actorUid: callerUid,
        actorEmail: request.auth?.token.email || null,
        action: "crear_usuario",
        entityType: "users",
        entityId: usuarioRecord.uid,
        before: null,
        after: { email, nombre, role: rol || "user" },
      });

      return {
        uid: usuarioRecord.uid,
        email: usuarioRecord.email,
        nombre: nombre,
        mensaje: `Usuario ${nombre} creado exitosamente`,
      };
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError(
          "already-exists",
          `El email ${email} ya está registrado`
        );
      }
      throw new functions.https.HttpsError("internal", error.message);
    }
  }
);

// Cambia el rol de otro usuario. El rol NUNCA se escribe desde el cliente
// directamente a Firestore (ver firestore.rules) — este es el único camino
// server-side válido, y deja rastro en auditLogs.
export const cambiarRolUsuario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const callerUid = await requireCallerIsAdmin(request.auth);

    const { uid, newRole } = request.data ?? {};

    if (!uid || !newRole || !ALLOWED_ROLES.includes(newRole)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "uid o newRole inválido"
      );
    }

    if (uid === callerUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No podés cambiar tu propio rol"
      );
    }

    const targetRef = admin.firestore().collection("users").doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Usuario no encontrado");
    }
    const before = targetSnap.data();

    await targetRef.set({ role: newRole }, { merge: true });

    await writeAuditLog({
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "cambiar_rol",
      entityType: "users",
      entityId: uid,
      before: { role: before?.role || null },
      after: { role: newRole },
    });

    return { success: true, uid, newRole };
  }
);

// Resetea la contraseña de otro usuario usando Firebase Auth directamente.
// Nunca se guarda una contraseña en Firestore (ver firestore.rules, que
// rechaza cualquier escritura con un campo `password`).
export const resetearPasswordUsuario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const callerUid = await requireCallerIsAdmin(request.auth);

    const { uid, newPassword } = request.data ?? {};

    if (!uid) {
      throw new functions.https.HttpsError("invalid-argument", "Falta uid");
    }

    const usaPasswordGenerada = !newPassword || String(newPassword).length < 6;
    const password = usaPasswordGenerada
      ? crypto.randomBytes(9).toString("base64url")
      : String(newPassword);

    await admin.auth().updateUser(uid, { password });

    await writeAuditLog({
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "reset_password",
      entityType: "users",
      entityId: uid,
      before: null,
      after: null,
    });

    return {
      success: true,
      uid,
      generatedPassword: usaPasswordGenerada ? password : undefined,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════
// Plataforma multicandidato
// ═══════════════════════════════════════════════════════════════════════

// Crea un candidato nuevo y su primer campaign_admin en una sola
// operación. Solo superadmin. El candidato arranca 100% vacío: no se
// copia ni referencia ningún dato de otro candidato.
export const crearCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const callerUid = await requireSuperAdmin(request.auth);

    const {
      candidateId,
      name,
      electionName,
      electionDate,
      adminNombre,
      adminEmail,
      adminPassword,
    } = request.data ?? {};

    if (!candidateId || !SLUG_RE.test(candidateId)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "candidateId inválido: usá minúsculas, números y guiones (ej: juan-perez)"
      );
    }
    if (!name || !adminNombre || !adminEmail || !adminPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos (name, adminNombre, adminEmail, adminPassword)"
      );
    }

    const candidateRef = admin.firestore().collection("candidates").doc(candidateId);
    const existing = await candidateRef.get();
    if (existing.exists) {
      throw new functions.https.HttpsError(
        "already-exists",
        `Ya existe un candidato con id "${candidateId}"`
      );
    }

    try {
      const adminRecord = await admin.auth().createUser({
        email: adminEmail,
        password: adminPassword,
        displayName: adminNombre,
      });

      const batch = admin.firestore().batch();
      batch.set(candidateRef, {
        name,
        slug: candidateId,
        status: "active",
        plan: "basic",
        logoUrl: "",
        primaryColor: "",
        electionName: electionName || "",
        electionDate: electionDate || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });
      batch.set(candidateRef.collection("users").doc(adminRecord.uid), {
        uid: adminRecord.uid,
        email: adminEmail,
        nombre: adminNombre,
        role: "campaign_admin",
        status: "activo",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });
      batch.set(candidateRef.collection("config").doc("electionDay"), {
        enabled: false,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        toggledBy: callerUid,
      });
      await batch.commit();
      await upsertUserCandidateIndex(adminRecord.uid, candidateId, "campaign_admin");

      await writeCandidateAuditLog(candidateId, {
        actorUid: callerUid,
        actorEmail: request.auth?.token.email || null,
        action: "crear_candidato",
        entityType: "candidates",
        entityId: candidateId,
        before: null,
        after: { name, adminEmail },
      });

      return {
        candidateId,
        adminUid: adminRecord.uid,
        mensaje: `Candidato "${name}" creado con administrador ${adminEmail}`,
      };
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError(
          "already-exists",
          `El email ${adminEmail} ya está registrado`
        );
      }
      throw new functions.https.HttpsError("internal", error.message);
    }
  }
);

// Crea un usuario (militante/mesario/coordinador/etc.) dentro de un
// candidato ya existente. Superadmin o campaign_admin de ESE candidato.
export const crearUsuarioCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, nombre, email, password, rol, cedula, telefono } =
      request.data ?? {};

    if (!candidateId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta candidateId");
    }

    const callerUid = await requireCandidateRole(request.auth, candidateId, [
      "campaign_admin",
    ]);

    if (!nombre || !email || !password || !rol) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos"
      );
    }
    if (!CANDIDATE_ROLES.includes(rol)) {
      throw new functions.https.HttpsError("invalid-argument", `Rol inválido: ${rol}`);
    }

    try {
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: nombre,
      });

      await admin
        .firestore()
        .collection("candidates")
        .doc(candidateId)
        .collection("users")
        .doc(userRecord.uid)
        .set({
          uid: userRecord.uid,
          email,
          nombre,
          role: rol,
          cedula: cedula || null,
          telefono: telefono || null,
          status: "activo",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
        });
      await upsertUserCandidateIndex(userRecord.uid, candidateId, rol);

      await writeCandidateAuditLog(candidateId, {
        actorUid: callerUid,
        actorEmail: request.auth?.token.email || null,
        action: "crear_usuario",
        entityType: "users",
        entityId: userRecord.uid,
        before: null,
        after: { email, nombre, role: rol },
      });

      return {
        uid: userRecord.uid,
        email: userRecord.email,
        mensaje: `Usuario ${nombre} creado en ${candidateId}`,
      };
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError(
          "already-exists",
          `El email ${email} ya está registrado`
        );
      }
      throw new functions.https.HttpsError("internal", error.message);
    }
  }
);

// REGLA OBLIGATORIA 1: nadie cambia su propio rol, tampoco acá.
export const cambiarRolUsuarioCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, uid, newRole } = request.data ?? {};

    if (!candidateId || !uid || !newRole || !CANDIDATE_ROLES.includes(newRole)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "candidateId, uid o newRole inválido"
      );
    }

    const callerUid = await requireCandidateRole(request.auth, candidateId, [
      "campaign_admin",
    ]);

    if (uid === callerUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No podés cambiar tu propio rol"
      );
    }

    const targetRef = admin
      .firestore()
      .collection("candidates")
      .doc(candidateId)
      .collection("users")
      .doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Usuario no encontrado");
    }
    const before = targetSnap.data();

    await targetRef.set({ role: newRole }, { merge: true });
    await upsertUserCandidateIndex(uid, candidateId, newRole);

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "cambiar_rol",
      entityType: "users",
      entityId: uid,
      before: { role: before?.role || null },
      after: { role: newRole },
    });

    return { success: true, uid, newRole };
  }
);

export const resetearPasswordUsuarioCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, uid, newPassword } = request.data ?? {};

    if (!candidateId || !uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Falta candidateId o uid"
      );
    }

    const callerUid = await requireCandidateRole(request.auth, candidateId, [
      "campaign_admin",
    ]);

    const targetSnap = await admin
      .firestore()
      .collection("candidates")
      .doc(candidateId)
      .collection("users")
      .doc(uid)
      .get();
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Usuario no encontrado");
    }

    const usaPasswordGenerada = !newPassword || String(newPassword).length < 6;
    const password = usaPasswordGenerada
      ? crypto.randomBytes(9).toString("base64url")
      : String(newPassword);

    await admin.auth().updateUser(uid, { password });

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "reset_password",
      entityType: "users",
      entityId: uid,
      before: null,
      after: null,
    });

    return {
      success: true,
      uid,
      generatedPassword: usaPasswordGenerada ? password : undefined,
    };
  }
);

// Auditoría cruzada de padrón: compara las cédulas guardadas por ESTE
// candidato contra las de TODOS los demás candidatos de la plataforma.
// Corre con Admin SDK (server-side) porque firestore.rules justamente
// prohíbe que un candidato lea savedRecords de otro — este es el único
// camino legítimo para esa comparación, y a propósito NO devuelve de qué
// candidato se trata ni ningún dato suyo: solo "en cuántos otros
// candidatos aparece esta misma cédula".
export const auditarCoincidenciasEntreCandidatos = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId } = request.data ?? {};
    if (!candidateId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta candidateId");
    }
    await requireCandidateRole(request.auth, candidateId, [
      "campaign_admin",
      "auditor",
    ]);

    const ownSnap = await admin
      .firestore()
      .collection("candidates")
      .doc(candidateId)
      .collection("savedRecords")
      .get();

    const cedulaToRecordIds = new Map<string, string[]>();
    ownSnap.forEach((doc) => {
      const cedula = doc.data().cedula;
      if (!cedula) return;
      if (!cedulaToRecordIds.has(cedula)) cedulaToRecordIds.set(cedula, []);
      cedulaToRecordIds.get(cedula)!.push(doc.id);
    });
    const ownCedulas = [...cedulaToRecordIds.keys()];

    const otherCandidatesByCedula = new Map<string, Set<string>>();
    const CHUNK = 30;
    for (let i = 0; i < ownCedulas.length; i += CHUNK) {
      const chunk = ownCedulas.slice(i, i + CHUNK);
      if (chunk.length === 0) continue;
      const snap = await admin
        .firestore()
        .collectionGroup("savedRecords")
        .where("cedula", "in", chunk)
        .get();
      snap.forEach((doc) => {
        const otherCandidateId = doc.ref.parent.parent?.id;
        if (!otherCandidateId || otherCandidateId === candidateId) return;
        const cedula = doc.data().cedula;
        if (!otherCandidatesByCedula.has(cedula)) {
          otherCandidatesByCedula.set(cedula, new Set());
        }
        otherCandidatesByCedula.get(cedula)!.add(otherCandidateId);
      });
    }

    const coincidencias = [...otherCandidatesByCedula.entries()].map(
      ([cedula, candidatos]) => ({
        cedula,
        recordIds: cedulaToRecordIds.get(cedula) || [],
        otrosCandidatos: candidatos.size,
      })
    );

    return {
      totalPropio: ownCedulas.length,
      coincidencias,
    };
  }
);
