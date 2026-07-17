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
  "finance_admin",
  "finance_operator",
  "cashier",
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

// ═══════════════════════════════════════════════════════════════════
// Administración de plataforma — backup y borrado de candidatos, ambas
// exclusivas de superadmin. No hay backend "de prueba": operan sobre el
// mismo Firestore real, por eso backupCandidato existe como respaldo
// manual antes de un borrado (o para uso periódico), y eliminarCandidato
// exige escribir el nombre exacto del candidato como confirmación server-
// side (no alcanza con el confirm() del navegador).
// ═══════════════════════════════════════════════════════════════════

const CANDIDATE_SUBCOLLECTIONS = [
  "users", "savedRecords", "drivers", "mesarios", "roles", "roleAuditLogs",
  "financeObligations", "financePayments", "paymentBatches", "cashAccounts",
  "cashMovements", "financeReceipts", "financeAuditLogs", "callAssignments",
  "electionStatus", "calls", "followUps", "incidents", "electionDayControl",
  "electionDayMovements", "electionDayAlerts", "electionDayReports",
  "config", "auditLogs",
];

export const backupCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    await requireSuperAdmin(request.auth);
    const { candidateId } = request.data ?? {};
    if (!candidateId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta candidateId");
    }

    const candidateRef = admin.firestore().collection("candidates").doc(candidateId);
    const candidateSnap = await candidateRef.get();
    if (!candidateSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Candidato no encontrado");
    }

    const backup: Record<string, any> = {
      _meta: { candidateId, exportedAt: new Date().toISOString() },
      candidate: candidateSnap.data(),
    };

    for (const sub of CANDIDATE_SUBCOLLECTIONS) {
      const snap = await candidateRef.collection(sub).get();
      backup[sub] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    return backup;
  }
);

export const eliminarCandidato = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    await requireSuperAdmin(request.auth);
    const { candidateId, confirmName } = request.data ?? {};
    if (!candidateId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta candidateId");
    }

    const candidateRef = admin.firestore().collection("candidates").doc(candidateId);
    const candidateSnap = await candidateRef.get();
    if (!candidateSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Candidato no encontrado");
    }
    const candidateData = candidateSnap.data();
    if (!confirmName || confirmName.trim() !== (candidateData?.name || "")) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "El nombre de confirmación no coincide con el nombre del candidato — no se borró nada."
      );
    }

    // Recolectar uids ANTES de borrar, para poder limpiar Auth +
    // userCandidateIndex después de que la data ya no exista.
    const usersSnap = await candidateRef.collection("users").get();
    const uids = usersSnap.docs.map((d) => d.id);

    // Borra el documento del candidato y TODAS sus subcolecciones,
    // recursivamente (incluye cualquier subcolección aunque no esté en
    // CANDIDATE_SUBCOLLECTIONS — recursiveDelete no depende de esa lista,
    // esa lista es solo para el backup).
    await admin.firestore().recursiveDelete(candidateRef);

    // Por cada usuario: si además pertenece a otro candidato, se le quita
    // solo esta membresía del índice; si este era el único, se borra la
    // cuenta de Auth completa.
    let usersDeleted = 0;
    for (const uid of uids) {
      const idxRef = admin.firestore().collection("userCandidateIndex").doc(uid);
      const idxSnap = await idxRef.get();
      const data = idxSnap.data() || {};
      delete data[candidateId];
      if (Object.keys(data).length > 0) {
        await idxRef.set(data);
      } else {
        await idxRef.delete();
        try {
          await admin.auth().deleteUser(uid);
          usersDeleted++;
        } catch (err: any) {
          console.warn(`No se pudo borrar la cuenta de Auth ${uid}:`, err.message);
        }
      }
    }

    return { success: true, candidateId, usersDeleted };
  }
);

// ═══════════════════════════════════════════════════════════════════
// El padrón (/voters) es compartido entre todos los candidatos y solo
// el superadmin puede escribirlo directamente (ver firestore.rules).
// Pero los teléfonos del padrón vienen de una carga vieja y suelen estar
// desactualizados — cuando un dirigente/operador captura un votante en
// "Buscar votante" y carga un teléfono más reciente, esta función lo
// refleja de vuelta en /voters para que el resto de los candidatos
// también se beneficien del dato actualizado. Requiere que el caller
// tenga un rol real en ALGÚN candidato (no expone /voters a cualquier
// cuenta autenticada) y solo toca el campo telefono — nunca mesa, local,
// dirección ni ningún otro dato del padrón oficial.
export const actualizarTelefonoVotante = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cedula, telefono } = request.data ?? {};
    if (!candidateId || !cedula || !telefono) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId, cedula o telefono"
      );
    }
    const callerUid = await requireCandidateRole(
      request.auth,
      candidateId,
      CANDIDATE_ROLES
    );

    const votersRef = admin.firestore().collection("voters");
    const snap = await votersRef.where("cedula", "==", String(cedula)).limit(1).get();
    if (snap.empty) {
      // La CI no está en el padrón (puede pasar: el militante guardó un
      // contacto que no figura en la base oficial) — no es un error, no
      // hay nada que actualizar.
      return { success: true, updated: false };
    }

    // El teléfono vive en una subcolección privada (voters/{id}/private/data),
    // NUNCA en el doc principal de voters — ese doc es de lectura abierta a
    // cualquier autenticado (isAuth()) y firestore.rules no puede ocultar un
    // campo dentro de un documento permitido, solo el documento entero. Ver
    // reglas de /voters/{voterId}/private/{docId}: solo superadmin lee ahí
    // directo; cualquier otro acceso pasa por buscarTelefonosPadron, que
    // resuelve la excepción de dueño/asignado antes de exponerlo.
    const voterDoc = snap.docs[0];
    const privateRef = voterDoc.ref.collection("private").doc("data");
    const privateSnap = await privateRef.get();
    const telefonoAnterior = privateSnap.data()?.telefono || "";
    if (telefonoAnterior === String(telefono)) {
      return { success: true, updated: false };
    }

    await privateRef.set(
      {
        telefono: String(telefono),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPhoneUpdateBy: callerUid,
        lastPhoneUpdateCandidateId: candidateId,
      },
      { merge: true }
    );

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "voter_phone_update",
      entityType: "voter",
      entityId: String(cedula),
      before: { telefono: telefonoAnterior },
      after: { telefono: String(telefono) },
    });

    return { success: true, updated: true };
  }
);

// Roles que pueden usar la pestaña "Buscar votante" (ver TAB_ROLES.votantes
// en campaign.js) — la única lista que importa acá, porque operador/chofer
// ni siquiera ven esa pestaña.
const VOTER_SEARCH_ROLES = ["campaign_admin", "coordinator", "dirigente", "mesario"];

// Determina si el caller puede ver el teléfono de un savedRecords puntual,
// replicando EXACTAMENTE el mismo criterio que ya usa firestore.rules para
// `allow read` de /candidates/{candidateId}/savedRecords/{recordId} (sección
// "Mantener las reglas actuales de acceso según roles y propiedad") — nunca
// se relaja ni se endurece ese criterio acá, solo se reusa para decidir si
// el teléfono entra en la respuesta de búsqueda del padrón compartido.
async function callerCanSeeSavedRecordPhone(
  candidateId: string,
  callerUid: string,
  role: string,
  savedRecordDoc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<boolean> {
  if (role === "campaign_admin" || role === "coordinator") return true;

  const data = savedRecordDoc.data();
  if (data?.uid === callerUid) return true;

  if (role === "dirigente" || role === "mesario") {
    const edcSnap = await admin
      .firestore()
      .collection("candidates")
      .doc(candidateId)
      .collection("electionDayControl")
      .doc(savedRecordDoc.id)
      .get();
    if (!edcSnap.exists) return false;
    const edcData = edcSnap.data();
    if (role === "dirigente" && edcData?.assignedLeaderId === callerUid) return true;
    if (role === "mesario" && edcData?.assignedTableUserId === callerUid) return true;
  }

  return false;
}

// Única fuente autorizada de teléfonos para la búsqueda de "Buscar votante"
// (campaign.js::renderVotantes). Nunca se devuelve el teléfono del padrón
// compartido salvo a superadmin — para cualquier otro rol, el teléfono
// devuelto es siempre el de SU PROPIO savedRecords (o el de un registro
// formalmente asignado a su gestión), nunca el que pudo cargar el dirigente
// de OTRO candidato sobre la misma cédula. Objetivo (pedido de privacidad):
// evitar que el padrón compartido se convierta en guía telefónica cruzando
// candidatos.
export const buscarTelefonosPadron = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cedulas } = request.data ?? {};
    if (!candidateId || !Array.isArray(cedulas) || cedulas.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId o cedulas"
      );
    }
    if (cedulas.length > 50) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Máximo 50 cédulas por consulta"
      );
    }
    if (!request.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesión");
    }

    const callerUid = request.auth.uid;
    const platformDoc = await admin
      .firestore()
      .collection("platformUsers")
      .doc(callerUid)
      .get();
    const isSuperAdmin = platformDoc.data()?.globalRole === "superadmin";

    let role: string | null = null;
    if (!isSuperAdmin) {
      const memberDoc = await admin
        .firestore()
        .collection("candidates")
        .doc(candidateId)
        .collection("users")
        .doc(callerUid)
        .get();
      role = memberDoc.exists ? memberDoc.data()?.role ?? null : null;
      if (!role || !VOTER_SEARCH_ROLES.includes(role)) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "No tenés permiso para buscar en el padrón de este candidato"
        );
      }
    }

    const uniqueCedulas = [...new Set(cedulas.map((c: any) => String(c)))];
    const telefonos: Record<string, string | null> = {};

    await Promise.all(
      uniqueCedulas.map(async (cedula) => {
        telefonos[cedula] = null;

        if (isSuperAdmin) {
          const votersSnap = await admin
            .firestore()
            .collection("voters")
            .where("cedula", "==", cedula)
            .limit(1)
            .get();
          if (votersSnap.empty) return;
          const privateSnap = await votersSnap.docs[0].ref
            .collection("private")
            .doc("data")
            .get();
          telefonos[cedula] = privateSnap.data()?.telefono || null;
          return;
        }

        const savedSnap = await admin
          .firestore()
          .collection("candidates")
          .doc(candidateId)
          .collection("savedRecords")
          .where("cedula", "==", cedula)
          .limit(1)
          .get();
        if (savedSnap.empty) return;

        const savedDoc = savedSnap.docs[0];
        const puedeVer = await callerCanSeeSavedRecordPhone(
          candidateId,
          callerUid,
          role as string,
          savedDoc
        );
        if (puedeVer) {
          telefonos[cedula] = savedDoc.data()?.telefono || null;
        }
      })
    );

    return { telefonos };
  }
);

// ═══════════════════════════════════════════════════════════════════
// Invitaciones — reemplaza al viejo self-registro sin candidato del
// login. Solo campaign_admin genera el link (mismo criterio que
// crearUsuarioCandidato); quien lo recibe crea su cuenta contra una
// invitación puntual con rol y candidato ya fijados de antemano, nunca
// eligiéndolos él mismo. /invites no tiene reglas de Firestore propias
// a propósito: nadie lee ni escribe esa colección directo desde el
// cliente, todo pasa por estas 3 funciones (Admin SDK).
// ═══════════════════════════════════════════════════════════════════

const INVITE_TTL_DAYS = 7;

export const crearInvitacion = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, rol } = request.data ?? {};
    if (!candidateId || !rol) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId o rol");
    }
    if (!CANDIDATE_ROLES.includes(rol)) {
      throw new functions.https.HttpsError("invalid-argument", `Rol inválido: ${rol}`);
    }
    const callerUid = await requireCandidateRole(request.auth, candidateId, ["campaign_admin"]);

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const inviteRef = admin.firestore().collection("invites").doc();
    await inviteRef.set({
      candidateId,
      role: rol,
      createdBy: callerUid,
      createdByEmail: request.auth?.token.email || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      // Multi-uso: el link sirve para cualquier cantidad de personas con
      // este rol hasta que venza (ver validarInvitacion/aceptarInvitacion).
      acceptedCount: 0,
      lastUsedBy: null,
      lastUsedAt: null,
    });

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token.email || null,
      action: "crear_invitacion",
      entityType: "invites",
      entityId: inviteRef.id,
      before: null,
      after: { role: rol, expiresAt: expiresAt.toISOString() },
    });

    return { inviteId: inviteRef.id };
  }
);

// Sin requireAuth a propósito: quien la llama todavía no tiene cuenta.
// Solo lee (Admin SDK, no expone /invites al cliente) y no muta nada.
export const validarInvitacion = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { inviteId } = request.data ?? {};
    if (!inviteId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta inviteId");
    }
    const snap = await admin.firestore().collection("invites").doc(inviteId).get();
    if (!snap.exists) return { valid: false, reason: "no_existe" };
    const invite = snap.data()!;
    // Multi-uso: el link sirve para cualquier cantidad de personas con el
    // mismo rol mientras no venza (7 días desde que se generó) -- antes
    // era de un solo uso, se invalidaba apenas alguien creaba su cuenta.
    if (invite.expiresAt.toDate() < new Date()) return { valid: false, reason: "expirada" };

    const candidateSnap = await admin.firestore().collection("candidates").doc(invite.candidateId).get();
    return {
      valid: true,
      candidateName: candidateSnap.data()?.name || invite.candidateId,
      role: invite.role,
    };
  }
);

export const aceptarInvitacion = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { inviteId, nombre, email, password } = request.data ?? {};
    if (!inviteId || !nombre || !email || !password) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan campos requeridos");
    }

    const inviteRef = admin.firestore().collection("invites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Invitación no encontrada");
    }
    const invite = inviteSnap.data()!;
    if (invite.expiresAt.toDate() < new Date()) {
      throw new functions.https.HttpsError("failed-precondition", "Esta invitación expiró");
    }

    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password, displayName: nombre });
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError("already-exists", `El email ${email} ya está registrado`);
      }
      throw new functions.https.HttpsError("internal", error.message);
    }

    await admin
      .firestore()
      .collection("candidates")
      .doc(invite.candidateId)
      .collection("users")
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,
        email,
        nombre,
        role: invite.role,
        cedula: null,
        telefono: null,
        status: "activo",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: invite.createdBy,
        createdViaInvite: inviteId,
      });
    await upsertUserCandidateIndex(userRecord.uid, invite.candidateId, invite.role);

    // Multi-uso: ya no se marca `used:true` (eso invalidaba el link para
    // todos los demás) -- solo se lleva la cuenta de cuántas veces se usó
    // y quién fue la última persona, a fines informativos/auditoría.
    await inviteRef.update({
      acceptedCount: admin.firestore.FieldValue.increment(1),
      lastUsedBy: userRecord.uid,
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await writeCandidateAuditLog(invite.candidateId, {
      actorUid: userRecord.uid,
      actorEmail: email,
      action: "aceptar_invitacion",
      entityType: "users",
      entityId: userRecord.uid,
      before: null,
      after: { email, nombre, role: invite.role },
    });

    return { uid: userRecord.uid, email: userRecord.email, candidateId: invite.candidateId };
  }
);
