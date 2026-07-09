import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

admin.initializeApp();

const ALLOWED_ROLES = ["militante", "mesario", "veedor", "admin", "user"];

async function requireCallerIsAdmin(context: any) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión"
    );
  }
  const callerDoc = await admin
    .firestore()
    .collection("users")
    .doc(context.auth.uid)
    .get();
  if (callerDoc.data()?.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Solo administradores pueden realizar esta acción"
    );
  }
  return context.auth.uid as string;
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

export const crearNuevoUsuario = functions.https.onCall(
  async (data: any, context: any) => {
    const callerUid = await requireCallerIsAdmin(context);

    const { nombre, email, password, rol } = data;

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
        actorEmail: context.auth.token.email || null,
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
  async (data: any, context: any) => {
    const callerUid = await requireCallerIsAdmin(context);

    const { uid, newRole } = data;

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
      actorEmail: context.auth.token.email || null,
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
  async (data: any, context: any) => {
    const callerUid = await requireCallerIsAdmin(context);

    const { uid, newPassword } = data;

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
      actorEmail: context.auth.token.email || null,
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