import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

export const crearNuevoUsuario = functions.https.onCall(
  async (data: any, context: any) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Debes iniciar sesión"
      );
    }

    const adminDoc = await admin
      .firestore()
      .collection("users")
      .doc(context.auth.uid)
      .get();

    if (adminDoc.data()?.role !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Solo administradores pueden crear usuarios"
      );
    }

    const { nombre, email, password, rol } = data;

    if (!nombre || !email || !password) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos"
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
          createdBy: context.auth.uid,
          estado: "activo",
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