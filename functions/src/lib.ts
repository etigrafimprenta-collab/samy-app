// Helpers compartidos entre index.ts y driverZones.ts. Separado de
// index.ts para que ambos puedan importarlos sin crear un import
// circular (index.ts reexporta driverZones.ts con `export * from
// "./driverZones"`, así que driverZones.ts no puede depender de index.ts).
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// NOTA IMPORTANTE: firebase-functions v7 (instalado en este proyecto) usa
// la API de Cloud Functions v2, donde onCall recibe UN SOLO argumento
// `request: CallableRequest<T>` (request.data / request.auth), no el viejo
// `(data, context)` de v1. Usar la firma vieja hace que el segundo
// parámetro llegue `undefined` y toda función falle con "unauthenticated"
// SIEMPRE, incluso para el caller correcto — esto se encontró probando en
// vivo contra producción (crearCandidato rechazaba al superadmin real).
export type Auth = functions.https.CallableRequest["auth"];

// Superadmin siempre pasa. Si no, exige que el caller tenga uno de los
// roles candidate-scoped indicados en /candidates/{candidateId}/users/{uid}.
// LIMITACIÓN CORREGIDA (auditoría RBAC): hasta acá, esta función solo
// miraba `role` (legacy) — firestore.rules ya reconoce roleIds vía
// hasCandidateRole() desde Etapa 8 parcial, pero ninguna Cloud Function lo
// hacía, así que un usuario con un rol de SISTEMA adicional asignado por
// roleIds (ej. "auditor" sumado a un dirigente) ya tenía acceso correcto
// vía reglas de Firestore, pero seguía recibiendo permission-denied en
// cualquier acción que pasara por una Cloud Function. Se agrega el mismo
// chequeo OR que ya usa hasCandidateRole en firestore.rules — nunca resta
// acceso, solo lo amplía para quien ya lo tenía por roleIds.
export async function requireCandidateRole(
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
  const memberData = memberDoc.data();
  const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
  const tieneRol = roles.includes(memberData?.role) || roleIds.some((r) => roles.includes(r));
  if (!memberDoc.exists || !tieneRol) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "No tenés permiso para esta acción en este candidato"
    );
  }
  return auth.uid;
}

export async function writeCandidateAuditLog(
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
