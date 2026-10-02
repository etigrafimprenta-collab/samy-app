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
//
// RENDIMIENTO (auditoría 2026-10-02, 50-100 usuarios concurrentes
// esperados el Día D): la primera versión de este archivo leía
// savedRecords/electionDayControl más de una vez por invocación (una vez
// para autorizar, otra para construir el `base` del lazy-create, otra
// para sincronizar diaD/votes) — hasta 4 round-trips secuenciales para
// 2 documentos únicos. `resolverContexto()` ahora hace UNA sola tanda de
// lecturas en paralelo (Promise.all) al principio de cada función, y
// todo lo que sigue reusa esos mismos snapshots — nunca vuelve a pedir
// el mismo documento.
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

// Día D: instancia siempre caliente para las 3 funciones de este archivo
// — evita el cold-start (1-3s) en la primera tanda de clicks después de
// cualquier período sin uso, esperable con 50-100 dirigentes/mesarios/
// choferes concurrentes el día del evento. Tiene un costo fijo chico
// mientras esté en 1 (instancia mínima corriendo 24/7).
//
// REVERTIR DESPUÉS DEL DÍA D (elegir una opción, no hace falta las dos):
//   A) Rápido, sin tocar código ni redeployar (gcloud directo):
//        gcloud functions deploy setDiaDStatusFn --project=samy-fidabel --region=us-central1 --gen2 --min-instances=0
//        gcloud functions deploy setDiaDFlagsFn --project=samy-fidabel --region=us-central1 --gen2 --min-instances=0
//        gcloud functions deploy reportarIncidenciaDiaDFn --project=samy-fidabel --region=us-central1 --gen2 --min-instances=0
//   B) Por código (deja constancia en el historial de git): cambiar la
//      línea de abajo a `{ minInstances: 0 }` (o borrar DIA_D_OPTS y sus
//      3 usos) y volver a desplegar con:
//        firebase deploy --only functions:setDiaDStatusFn,functions:setDiaDFlagsFn,functions:reportarIncidenciaDiaDFn --project samy-fidabel --force
const DIA_D_OPTS = { minInstances: 1 };

function requireAuth(auth: Auth): string {
  if (!auth) {
    throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesión");
  }
  return auth.uid;
}

function rolParaRegistro(roles: Set<string>): string {
  for (const r of ["dirigente", "mesario", "chofer", "operador", "campaign_admin", "coordinator", "superadmin"]) {
    if (roles.has(r)) return r;
  }
  return "desconocido";
}

// isDriverOwner()/isVoterAssignedToDriver() (chofer) y isOperatorOfVoter()
// (operador) quedan como reads EXTRA solo cuando el caller tiene ese rol
// — no son parte de la tanda principal porque dirigente (el camino con
// más volumen de lejos) nunca los necesita, y agregarlos siempre sería
// pagar lecturas de más para el caso común.
async function isDriverOwner(candidateId: string, driverId: string | null, uid: string): Promise<boolean> {
  if (!driverId) return false;
  const snap = await candidateRef(candidateId).collection("drivers").doc(driverId).get();
  return snap.exists && snap.data()?.usuarioAsignado === uid;
}

async function isOperatorOfVoter(candidateId: string, voterId: string, uid: string): Promise<boolean> {
  const snap = await candidateRef(candidateId).collection("callAssignments").doc(voterId).get();
  return snap.exists && snap.data()?.assignedUserId === uid;
}

interface Contexto {
  roles: Set<string>;
  record: FirebaseFirestore.DocumentData | undefined;
  recordExists: boolean;
  control: FirebaseFirestore.DocumentData | undefined;
  controlExists: boolean;
  controlRef: FirebaseFirestore.DocumentReference;
  recordRef: FirebaseFirestore.DocumentReference;
}

// UNA sola tanda de lecturas (en paralelo) + autorización, reusada por
// las 3 funciones de abajo. Mismo criterio de autorización que
// hasAuthoritativeLinkToVoter()/electionDayControl allow create/update
// en firestore.rules.
async function resolverContexto(candidateId: string, voterId: string, callerUid: string): Promise<Contexto> {
  const recordRef = candidateRef(candidateId).collection("savedRecords").doc(voterId);
  const controlRef = candidateRef(candidateId).collection("electionDayControl").doc(voterId);

  const [platformSnap, memberSnap, recordSnap, controlSnap] = await Promise.all([
    db().collection("platformUsers").doc(callerUid).get(),
    candidateRef(candidateId).collection("users").doc(callerUid).get(),
    recordRef.get(),
    controlRef.get(),
  ]);

  const isSuperAdmin = platformSnap.data()?.globalRole === "superadmin";
  const memberData = memberSnap.data();
  const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
  const roles = new Set<string>(isSuperAdmin ? ["superadmin"] : [memberData?.role, ...roleIds].filter(Boolean));

  const ctx: Contexto = {
    roles,
    record: recordSnap.data(),
    recordExists: recordSnap.exists,
    control: controlSnap.data(),
    controlExists: controlSnap.exists,
    controlRef,
    recordRef,
  };

  if (isSuperAdmin || roles.has("campaign_admin") || roles.has("coordinator")) {
    return ctx;
  }
  if (!isSuperAdmin && !memberSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "No pertenecés a este candidato");
  }

  let autorizado = false;
  if (roles.has("dirigente")) {
    if (ctx.controlExists && ctx.control?.assignedLeaderId === callerUid) autorizado = true;
    else if (ctx.recordExists && ctx.record?.uid === callerUid) autorizado = true;
  }
  if (!autorizado && roles.has("mesario")) {
    if (ctx.controlExists && ctx.control?.assignedTableUserId === callerUid) autorizado = true;
  }
  if (!autorizado && roles.has("chofer")) {
    const [zoneSnap] = await Promise.all([
      candidateRef(candidateId).collection("driverZoneVoters").doc(voterId).get(),
    ]);
    if (ctx.recordExists && (await isDriverOwner(candidateId, ctx.record?.chofer_asignado ?? null, callerUid))) autorizado = true;
    else if (zoneSnap.exists && (await isDriverOwner(candidateId, zoneSnap.data()?.driverId ?? null, callerUid))) autorizado = true;
  }
  if (!autorizado && roles.has("operador")) {
    if (await isOperatorOfVoter(candidateId, voterId, callerUid)) autorizado = true;
  }
  if (!autorizado) {
    throw new functions.https.HttpsError("permission-denied", "No tenés permiso para actualizar este votante");
  }
  return ctx;
}

function baseElectionDayControl(candidateId: string, voterId: string, ctx: Contexto) {
  if (ctx.controlExists) return {};
  const record = ctx.record ?? {};
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

// Espejo de marcarVoto()/desmarcarVoto() (firebaseCandidate.js) — reusa
// el `record` ya leído por resolverContexto(), nunca vuelve a pedirlo.
// Solo se toca si Día D está habilitado y el votante tiene seccional+mesa.
async function sincronizarDiaDVotes(
  candidateId: string,
  ctx: Contexto,
  newStatus: string,
  previousStatus: string | null,
  callerUid: string
) {
  const record = ctx.record;
  if (!record?.seccional || !record?.mesa) return;

  const docId = `${record.seccional}_${record.mesa}_${record.cedula}`;
  const votesRef = candidateRef(candidateId).collection("diaD").doc("current").collection("votes").doc(docId);

  if (newStatus === "voted") {
    const configSnap = await candidateRef(candidateId).collection("diaD").doc("current").get();
    if (!configSnap.exists || configSnap.data()?.enabled !== true) return;
    await votesRef.set({
      voterId: record.voterId ?? null,
      savedRecordId: ctx.recordRef.id,
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
  DIA_D_OPTS,
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, newStatus } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !newStatus) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/newStatus");
    }

    const ctx = await resolverContexto(candidateId, voterId, callerUid);
    const previousStatus = ctx.controlExists ? ctx.control?.status ?? null : null;
    const base = baseElectionDayControl(candidateId, voterId, ctx);

    // Las 2 escrituras de acá no dependen una de la otra (ambas solo
    // dependen de lo ya leído en ctx/previousStatus) — van en paralelo.
    // sincronizarDiaDVotes SÍ puede tocar el mismo doc de diaD/votes que
    // otra escritura futura, pero nunca el mismo doc que estas dos, así
    // que también entra en la misma tanda.
    await Promise.all([
      ctx.controlRef.set({
        ...base,
        status: newStatus,
        lastMovementAt: FieldValue.serverTimestamp(),
        lastUpdatedBy: callerUid,
        lastUpdatedRole: rolParaRegistro(ctx.roles),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      candidateRef(candidateId).collection("electionDayMovements").add({
        candidateId,
        voterId,
        previousStatus,
        newStatus,
        updatedBy: callerUid,
        role: rolParaRegistro(ctx.roles),
        note: "",
        location: null,
        createdAt: FieldValue.serverTimestamp(),
      }),
      sincronizarDiaDVotes(candidateId, ctx, newStatus, previousStatus, callerUid),
    ]);

    return { ok: true };
  }
);

export const setDiaDFlagsFn = functions.https.onCall(
  DIA_D_OPTS,
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, flags } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !flags || typeof flags !== "object") {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/flags");
    }

    const ctx = await resolverContexto(candidateId, voterId, callerUid);
    const base = baseElectionDayControl(candidateId, voterId, ctx);

    await ctx.controlRef.set({
      ...base,
      ...flags,
      lastUpdatedBy: callerUid,
      lastUpdatedRole: rolParaRegistro(ctx.roles),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true };
  }
);

export const reportarIncidenciaDiaDFn = functions.https.onCall(
  DIA_D_OPTS,
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, type, description } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !type) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/type");
    }

    const ctx = await resolverContexto(candidateId, voterId, callerUid);
    const base = baseElectionDayControl(candidateId, voterId, ctx);
    const assignedUid = ctx.controlExists ? ctx.control?.assignedLeaderId : null;

    // Independientes entre sí — en paralelo.
    await Promise.all([
      candidateRef(candidateId).collection("incidents").add({
        candidateId,
        voterId,
        assignedUserId: assignedUid || ctx.record?.uid || null,
        reportedBy: callerUid,
        type,
        description: description || "",
        status: "open",
        createdAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        resolvedBy: null,
      }),
      ctx.controlRef.set({
        ...base,
        incidentOpen: true,
        lastUpdatedBy: callerUid,
        lastUpdatedRole: rolParaRegistro(ctx.roles),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);

    return { ok: true };
  }
);
