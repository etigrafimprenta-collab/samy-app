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
    // AUDITORÍA 2026-10-03 (sincronización Control Día D): mecanismo
    // NUEVO en paralelo al de arriba — un mesario de la vista de Día D
    // Control que opera por local+mesa (renderMesarioView, el padrón
    // completo de su mesa) nunca tiene un electionDayControl.
    // assignedTableUserId seteado (nadie lo asigna a mano en ese flujo),
    // así que sin esto quedaba sin forma de marcar "voted" para ninguno
    // de sus votantes "nuestros" (los que SÍ están en savedRecords).
    // Seguro porque memberData (el perfil del propio caller, leído acá
    // server-side con Admin SDK) es admin-only/no autoeditable por el
    // cliente — comparar record.local/mesa contra ESE perfil no es un
    // auto-reclamo del cliente (a diferencia del hueco de seguridad ya
    // documentado en firestore.rules para la creación de
    // electionDayControl, que comparaba contra un campo de la MISMA
    // escritura). Mismo criterio exacto que isMesarioOfMesa()
    // (firestore.rules) y getVotersByMesa() (firebaseCandidate.js):
    // local+mesa es la fuente de verdad cuando el perfil tiene `local`;
    // sin `local`, cae a seccional+mesa para perfiles legado.
    else if (ctx.recordExists && memberData?.mesa && String(memberData.mesa) === String(ctx.record?.mesa)) {
      if (memberData?.local) {
        if (memberData.local === ctx.record?.local) autorizado = true;
      } else if (memberData?.seccional && memberData.seccional === ctx.record?.seccional) {
        autorizado = true;
      }
    }
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

// AUDITORÍA 2026-10-03 (voto único por elector, idempotencia y
// atomicidad): antes, esto hacía 3 escrituras independientes
// (electionDayControl, electionDayMovements, diaD/votes) basadas en una
// lectura de `previousStatus` ya tomada por resolverContexto() — si dos
// llamadas (dirigente + mesario + admin, cualquier combinación) tocaban
// el MISMO voterId casi al mismo tiempo, ambas podían leer
// previousStatus=null y las dos escribir como si fueran "la primera vez"
// (2 movimientos de auditoría duplicados, y en el peor caso una
// condición de carrera real). Reescrito como transacción de Firestore:
// la lectura de `status` pasa a ser DENTRO de la transacción (fresca,
// nunca la de resolverContexto) y las 3 escrituras van atómicas con ella
// — Firestore reintenta automáticamente la transacción que pierde la
// carrera, así que la que gana ve el estado YA actualizado por la otra.
//
// Idempotencia: si `status` ya es el valor pedido, no se escribe nada —
// ni electionDayControl, ni un movimiento nuevo, ni diaD/votes. Esto es
// lo que hace que "Elector X" marcado por dirigente y después también
// por mesario/admin nunca pase de contar 1 a contar 2: el dashboard
// cuenta sobre ese mismo campo único (status==='voted'), así que si no
// cambia, tampoco cambia el conteo — sin importar cuántas veces ni
// quiénes lo toquen.
function construirUpdateVotes(
  record: FirebaseFirestore.DocumentData,
  recordId: string,
  callerUid: string,
  nuevoVoted: boolean
) {
  return nuevoVoted
    ? {
        voterId: record.voterId ?? null,
        savedRecordId: recordId,
        cedula: record.cedula,
        seccional: record.seccional ?? "",
        mesa: String(record.mesa),
        local: record.local || "",
        voted: true,
        markedBy: callerUid,
        markedAt: FieldValue.serverTimestamp(),
      }
    : { voted: false, unmarkedBy: callerUid, unmarkedAt: FieldValue.serverTimestamp() };
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
    const record = ctx.record;
    // BUG REAL (encontrado probando la sincronización de mesario por
    // local+mesa): esto exigía `seccional` SIEMPRE — `seccional` queda
    // vacío a propósito para perfiles/votantes del mecanismo nuevo
    // (local es la fuente de verdad).
    const tieneUbicacion = !!(record?.mesa && (record?.seccional || record?.local));
    const votesRef = tieneUbicacion
      ? candidateRef(candidateId).collection("diaD").doc("current").collection("votes")
          .doc(`${record!.seccional ?? ""}_${record!.mesa}_${record!.cedula}`)
      : null;
    const diaDConfigRef = candidateRef(candidateId).collection("diaD").doc("current");

    const resultado = await db().runTransaction(async (tx) => {
      // TODAS las lecturas de la transacción van primero (requisito de
      // Firestore: ningún get() después del primer set()/update()).
      const [controlSnap, configSnap, votesSnap] = await Promise.all([
        tx.get(ctx.controlRef),
        votesRef ? tx.get(diaDConfigRef) : Promise.resolve(null),
        votesRef ? tx.get(votesRef) : Promise.resolve(null),
      ]);
      const previousStatus = controlSnap.exists ? controlSnap.data()?.status ?? null : null;

      if (previousStatus === newStatus) {
        return { changed: false, previousStatus };
      }

      const base = controlSnap.exists ? {} : baseElectionDayControl(candidateId, voterId, ctx);

      tx.set(ctx.controlRef, {
        ...base,
        status: newStatus,
        lastMovementAt: FieldValue.serverTimestamp(),
        lastUpdatedBy: callerUid,
        lastUpdatedRole: rolParaRegistro(ctx.roles),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(candidateRef(candidateId).collection("electionDayMovements").doc(), {
        candidateId,
        voterId,
        previousStatus,
        newStatus,
        updatedBy: callerUid,
        role: rolParaRegistro(ctx.roles),
        note: "",
        location: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (votesRef) {
        if (newStatus === "voted") {
          if (configSnap?.exists && configSnap.data()?.enabled === true) {
            tx.set(votesRef, construirUpdateVotes(record!, voterId, callerUid, true), { merge: true });
          }
        } else if (previousStatus === "voted" && votesSnap?.exists) {
          tx.set(votesRef, construirUpdateVotes(record!, voterId, callerUid, false), { merge: true });
        }
      }

      return { changed: true, previousStatus };
    });

    return { ok: true, ...resultado };
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
