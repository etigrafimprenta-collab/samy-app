// Día D Control — camino alternativo server-side para los roles
// operativos (dirigente/mesario/chofer/operador).
//
// CONTEXTO (auditoría 2026-10-02): un dirigente real (cuenta/datos
// verificados correctos, reproducido también contra el emulador de
// Firestore Rules con las reglas REALMENTE desplegadas — ambos
// confirmaron que la escritura directa debería permitirse) recibía
// "permission-denied" de forma consistente y reproducible en su sesión
// real del navegador, en todos los dispositivos/redes probados, al
// escribir directo a electionDayControl/electionDayMovements vía el SDK
// cliente de Firestore (protocolo WebChannel de conexión larga). La
// causa puntual de ESA sesión no se pudo identificar a distancia. Este
// archivo ofrece el mismo resultado por un camino de transporte
// completamente distinto (HTTPS Callable normal, no WebChannel), para
// no depender de diagnosticar esa falla específica antes del Día D real.
//
// La vista de administrador (campaign_admin/coordinator) NO se toca —
// sigue escribiendo directo a Firestore como siempre, porque ya se
// confirmó muchas veces que funciona sin problema.
//
// Autorización: replica exactamente la misma lógica que firestore.rules
// (hasAuthoritativeLinkToVoter / electionDayControl allow create/update)
// pero evaluada acá, en el servidor — nunca otorga más de lo que las
// reglas ya permiten.
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { Auth } from "./lib";

function db() {
  return admin.firestore();
}

function candidateRef(candidateId: string) {
  return db().collection("candidates").doc(candidateId);
}

const ELECTION_DAY_CONTROL_DEFAULTS = {
  assignedDriverId: null,
  assignedLeaderId: null,
  assignedTableUserId: null,
  pollingPlace: "",
  tableNumber: "",
  status: "pending",
  requiresPickup: false,
  needsAssistance: false,
  incidentOpen: false,
  critical: false,
};

function requireAuth(auth: Auth): string {
  if (!auth) {
    throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesión");
  }
  return auth.uid;
}

async function callerRoles(candidateId: string, uid: string) {
  const memberSnap = await candidateRef(candidateId).collection("users").doc(uid).get();
  const memberData = memberSnap.data();
  const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
  const roles = new Set<string>([memberData?.role, ...roleIds].filter(Boolean));
  return { roles, memberExists: memberSnap.exists, nombre: memberData?.nombre };
}

async function isSuperAdmin(uid: string): Promise<boolean> {
  const snap = await db().collection("platformUsers").doc(uid).get();
  return snap.data()?.globalRole === "superadmin";
}

async function isDriverOwner(candidateId: string, driverId: string | null, uid: string): Promise<boolean> {
  if (!driverId) return false;
  const snap = await candidateRef(candidateId).collection("drivers").doc(driverId).get();
  return snap.exists && snap.data()?.usuarioAsignado === uid;
}

async function isOperatorOfVoter(candidateId: string, voterId: string, uid: string): Promise<boolean> {
  const snap = await candidateRef(candidateId).collection("callAssignments").doc(voterId).get();
  return snap.exists && snap.data()?.assignedUserId === uid;
}

// Mismo criterio que hasAuthoritativeLinkToVoter() en firestore.rules —
// cubre tanto "ya tiene electionDayControl asignado" como "todavía no
// existe el doc, pero el votante es genuinamente suyo" (dirigente).
async function tieneVinculoConVotante(
  candidateId: string,
  voterId: string,
  callerUid: string,
  roles: Set<string>
): Promise<boolean> {
  if (roles.has("dirigente")) {
    const [controlSnap, recordSnap] = await Promise.all([
      candidateRef(candidateId).collection("electionDayControl").doc(voterId).get(),
      candidateRef(candidateId).collection("savedRecords").doc(voterId).get(),
    ]);
    if (controlSnap.exists && controlSnap.data()?.assignedLeaderId === callerUid) return true;
    if (recordSnap.exists && recordSnap.data()?.uid === callerUid) return true;
  }
  if (roles.has("mesario")) {
    const controlSnap = await candidateRef(candidateId).collection("electionDayControl").doc(voterId).get();
    if (controlSnap.exists && controlSnap.data()?.assignedTableUserId === callerUid) return true;
  }
  if (roles.has("chofer")) {
    const [recordSnap, zoneSnap] = await Promise.all([
      candidateRef(candidateId).collection("savedRecords").doc(voterId).get(),
      candidateRef(candidateId).collection("driverZoneVoters").doc(voterId).get(),
    ]);
    if (recordSnap.exists && (await isDriverOwner(candidateId, recordSnap.data()?.chofer_asignado ?? null, callerUid))) return true;
    if (zoneSnap.exists && (await isDriverOwner(candidateId, zoneSnap.data()?.driverId ?? null, callerUid))) return true;
  }
  if (roles.has("operador")) {
    if (await isOperatorOfVoter(candidateId, voterId, callerUid)) return true;
  }
  return false;
}

async function requireVinculoConVotante(candidateId: string, voterId: string, callerUid: string) {
  if (await isSuperAdmin(callerUid)) {
    return { roles: new Set<string>(["superadmin"]) };
  }
  const { roles, memberExists } = await callerRoles(candidateId, callerUid);
  if (!memberExists) {
    throw new functions.https.HttpsError("permission-denied", "No pertenecés a este candidato");
  }
  if (roles.has("campaign_admin") || roles.has("coordinator")) {
    return { roles };
  }
  if (await tieneVinculoConVotante(candidateId, voterId, callerUid, roles)) {
    return { roles };
  }
  throw new functions.https.HttpsError("permission-denied", "No tenés permiso para actualizar este votante");
}

function rolParaRegistro(roles: Set<string>): string {
  for (const r of ["dirigente", "mesario", "chofer", "operador", "campaign_admin", "coordinator", "superadmin"]) {
    if (roles.has(r)) return r;
  }
  return "desconocido";
}

async function baseElectionDayControl(candidateId: string, voterId: string, existing: boolean) {
  if (existing) return {};
  const recordSnap = await candidateRef(candidateId).collection("savedRecords").doc(voterId).get();
  const record = recordSnap.data() ?? {};
  return {
    candidateId,
    voterId,
    // ...ELECTION_DAY_CONTROL_DEFAULTS va PRIMERO a propósito — también
    // trae assignedLeaderId:null, así que si fuera después pisaría el uid
    // real (ver el mismo bug real encontrado y corregido en
    // setDiaDStatus/setDiaDFlags, src/lib/firebaseCandidate.js).
    ...ELECTION_DAY_CONTROL_DEFAULTS,
    assignedLeaderId: record.uid ?? null,
    assignedDriverId: record.chofer_asignado ?? null,
    pollingPlace: record.local ?? "",
    tableNumber: record.mesa ?? "",
    createdAt: FieldValue.serverTimestamp(),
  };
}

// Espejo de marcarVoto()/desmarcarVoto() (firebaseCandidate.js) — solo se
// toca si Día D está habilitado y el votante tiene seccional+mesa.
async function sincronizarDiaDVotes(
  candidateId: string,
  voterId: string,
  newStatus: string,
  previousStatus: string | null,
  callerUid: string
) {
  const recordSnap = await candidateRef(candidateId).collection("savedRecords").doc(voterId).get();
  const record = recordSnap.data();
  if (!record?.seccional || !record?.mesa) return;

  const docId = `${record.seccional}_${record.mesa}_${record.cedula}`;
  const votesRef = candidateRef(candidateId).collection("diaD").doc("current").collection("votes").doc(docId);

  if (newStatus === "voted") {
    const configSnap = await candidateRef(candidateId).collection("diaD").doc("current").get();
    if (!configSnap.exists || configSnap.data()?.enabled !== true) return;
    await votesRef.set({
      voterId: record.voterId ?? null,
      savedRecordId: voterId,
      cedula: record.cedula,
      seccional: record.seccional,
      mesa: String(record.mesa),
      local: record.local || "",
      voted: true,
      markedBy: callerUid,
      markedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else if (previousStatus === "voted") {
    const votesSnap = await votesRef.get();
    if (!votesSnap.exists) return;
    await votesRef.set({ voted: false, unmarkedBy: callerUid, unmarkedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

export const setDiaDStatusFn = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, newStatus } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !newStatus) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/newStatus");
    }

    const { roles } = await requireVinculoConVotante(candidateId, voterId, callerUid);

    const controlRef = candidateRef(candidateId).collection("electionDayControl").doc(voterId);
    const controlSnap = await controlRef.get();
    const previousStatus = controlSnap.exists ? controlSnap.data()?.status ?? null : null;
    const base = await baseElectionDayControl(candidateId, voterId, controlSnap.exists);

    await controlRef.set({
      ...base,
      status: newStatus,
      lastMovementAt: FieldValue.serverTimestamp(),
      lastUpdatedBy: callerUid,
      lastUpdatedRole: rolParaRegistro(roles),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await candidateRef(candidateId).collection("electionDayMovements").add({
      candidateId,
      voterId,
      previousStatus,
      newStatus,
      updatedBy: callerUid,
      role: rolParaRegistro(roles),
      note: "",
      location: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await sincronizarDiaDVotes(candidateId, voterId, newStatus, previousStatus, callerUid);

    return { ok: true };
  }
);

export const setDiaDFlagsFn = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, flags } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !flags || typeof flags !== "object") {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/flags");
    }

    const { roles } = await requireVinculoConVotante(candidateId, voterId, callerUid);

    const controlRef = candidateRef(candidateId).collection("electionDayControl").doc(voterId);
    const controlSnap = await controlRef.get();
    const base = await baseElectionDayControl(candidateId, voterId, controlSnap.exists);

    await controlRef.set({
      ...base,
      ...flags,
      lastUpdatedBy: callerUid,
      lastUpdatedRole: rolParaRegistro(roles),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true };
  }
);

export const reportarIncidenciaDiaDFn = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, type, description } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !type) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/type");
    }

    const { roles } = await requireVinculoConVotante(candidateId, voterId, callerUid);

    const controlRef = candidateRef(candidateId).collection("electionDayControl").doc(voterId);
    const controlSnap = await controlRef.get();
    const assignedUid = controlSnap.exists ? controlSnap.data()?.assignedLeaderId : null;
    const recordSnap = await candidateRef(candidateId).collection("savedRecords").doc(voterId).get();
    const base = await baseElectionDayControl(candidateId, voterId, controlSnap.exists);

    await candidateRef(candidateId).collection("incidents").add({
      candidateId,
      voterId,
      assignedUserId: assignedUid || recordSnap.data()?.uid || null,
      reportedBy: callerUid,
      type,
      description: description || "",
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    });

    await controlRef.set({
      ...base,
      incidentOpen: true,
      lastUpdatedBy: callerUid,
      lastUpdatedRole: rolParaRegistro(roles),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true };
  }
);
