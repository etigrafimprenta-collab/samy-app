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
import { FieldValue, FieldPath } from "firebase-admin/firestore";
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

// AUDITORÍA 2026-10-04 — extraído de setDiaDStatusFn tal cual estaba
// (mismo orden de lecturas, misma transacción, mismo chequeo de
// idempotencia) para que "Verificar beneficiarios y marcar votos"
// (Cajeros DD → Finanzas) reuse EXACTAMENTE esta lógica en vez de
// reimplementarla — pedido explícito: "reutilizar setDiaDStatusFn o la
// lógica transaccional/idempotente equivalente existente". `roleLabel` es
// lo que antes se recalculaba inline con rolParaRegistro(ctx.roles) — se
// pasa ya resuelto porque el llamante masivo no vuelve a derivar roles
// por cada votante. `source`, si viene, queda en electionDayMovements
// como rastro de qué disparó el cambio (null = comportamiento de
// siempre, no cambia nada para setDiaDStatusFn).
async function ejecutarCambioEstadoVoto(
  candidateId: string,
  voterId: string,
  newStatus: string,
  callerUid: string,
  roleLabel: string,
  ctx: Contexto,
  source: string | null = null
): Promise<{ ok: true; changed: boolean; previousStatus: string | null }> {
  const record = ctx.record;
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
      lastUpdatedRole: roleLabel,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(candidateRef(candidateId).collection("electionDayMovements").doc(), {
      candidateId,
      voterId,
      previousStatus,
      newStatus,
      updatedBy: callerUid,
      role: roleLabel,
      note: "",
      location: null,
      source: source,
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

export const setDiaDStatusFn = functions.https.onCall(
  DIA_D_OPTS,
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, voterId, newStatus } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !voterId || !newStatus) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/voterId/newStatus");
    }

    const ctx = await resolverContexto(candidateId, voterId, callerUid);
    return ejecutarCambioEstadoVoto(candidateId, voterId, newStatus, callerUid, rolParaRegistro(ctx.roles), ctx);
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

// AUDITORÍA 2026-10-04: quita espacios/puntos/guiones/cualquier no-dígito
// — nunca toca la secuencia de dígitos en sí (un cero a la izquierda
// real, parte de la cédula, se conserva tal cual). Mismo criterio que
// normalizarCedula del script de import de hoy, centralizado acá porque
// ahora hace falta aplicarlo a los 2 lados del cruce (beneficiaryCI y
// cedula) antes de compararlos, para que un espacio o guión de cualquiera
// de los 2 orígenes no produzca un falso "no encontrado".
function normalizarCedula(c: unknown): string {
  return String(c ?? "").replace(/\D/g, "");
}

// ── verificarBeneficiariosYMarcarVoto ────────────────────────────────────
// NUEVA FUNCIÓN EVENTUAL (pedido explícito 2026-10-04) — admin-only,
// manual, NUNCA se dispara sola ni desde ningún pago de Cajeros DD (cero
// referencias a esta función fuera de este archivo y del botón dedicado
// en Finanzas → Cajeros DD).
//
// Cruce: cashierMovements (expense, confirmed) trae beneficiaryVoterId,
// que es el id del padrón COMPARTIDO (/voters) — una colección DISTINTA
// de savedRecords, así que NO se puede cruzar por ese id. El cruce real
// es por CI normalizada (beneficiaryCI vs. cedula), igual que ya hace
// buscarBeneficiarioCajero — de ahí sale el id real a usar en
// electionDayControl (mismo id que savedRecords, ver resolverContexto).
//
// "Ya votó" se determina SOLO contra electionDayControl.status==='voted'
// (la fuente transaccional, nunca el espejo diaD/votes, que puede quedar
// desincronizado — ver auditoría del reset de esta misma mañana).
//
// Inconsistencias: una CI pagada que matchea MÁS DE UN savedRecords (ya
// confirmado contra datos reales: existen 18 cédulas así hoy) no se
// resuelve sola — no hay forma automática de saber a cuál de los 2
// dirigentes corresponde. Se excluye de "pendientes" y se reporta aparte,
// nunca se le adivina un dueño.
//
// Marcar reusa ejecutarCambioEstadoVoto tal cual (misma transacción/
// idempotencia que setDiaDStatusFn) — la propia transacción vuelve a leer
// `status` FRESCO justo antes de escribir, así que si entre la vista
// previa y la confirmación un mesario/dirigente ya marcó a ese elector,
// la transacción lo detecta sola (previousStatus === newStatus) y no
// escribe nada — eso es lo que distingue "marcados efectivamente ahora"
// de "ya estaban votados al ejecutar" en el resultado final.
//
// dryRun:true  -> solo lee, calcula el resumen, no escribe nada.
// dryRun:false -> recalcula el cruce FRESCO (nunca reusa un resumen viejo
//                 que el cliente pudiera tener cacheado) y recién ahí
//                 marca los pendientes, uno por uno.
const IN_CHUNK = 30;
// INCIDENTE 2026-10-04 16:38 (producción): con 1453 pendientes reales, el
// marcado secuencial (uno por uno) tardaba ~2.3s por transacción -> ~56min
// totales, muy por encima de cualquier timeout razonable. El cliente dio
// "Error INTERNAL" a los ~19min aunque el servidor seguía escribiendo de
// fondo (486 marcados reales, sin duplicados, atribución intacta — ver
// auditoría del incidente). Fix mínimo: cada pendiente toca documentos
// DISTINTOS (su propio electionDayControl/movimiento/voto), así que no hay
// contención posible entre ellos -> procesarlos en lotes paralelos es
// seguro y no cambia ninguna garantía de idempotencia/atribución, solo
// reduce el tiempo total ~20x. timeoutSeconds:300 como margen adicional.
const EXEC_CONCURRENCY = 25;

export const verificarBeneficiariosYMarcarVoto = functions.https.onCall(
  { timeoutSeconds: 300 },
  async (request: functions.https.CallableRequest<any>) => {
    // `incluirExternos` (pedido explícito 2026-10-04, posterior a la
    // aprobación original): OPT-IN, default false — el comportamiento ya
    // aprobado (excluir externos, nunca tocarlos) sigue intacto salvo que
    // el admin lo prenda a propósito en ESTE llamado puntual. Nunca se
    // activa solo ni queda "recordado" de una corrida a otra.
    const { candidateId, dryRun, incluirExternos } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId) {
      throw new functions.https.HttpsError("invalid-argument", "Falta candidateId");
    }

    const [platformSnap, memberSnap] = await Promise.all([
      db().collection("platformUsers").doc(callerUid).get(),
      candidateRef(candidateId).collection("users").doc(callerUid).get(),
    ]);
    const isSuperAdmin = platformSnap.data()?.globalRole === "superadmin";
    const memberData = memberSnap.data();
    const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
    const roles = new Set<string>([memberData?.role, ...roleIds].filter(Boolean));
    const isAdmin = isSuperAdmin || roles.has("campaign_admin") || roles.has("coordinator");
    if (!isAdmin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Solo campaign_admin/coordinator pueden usar esta función"
      );
    }

    // 1) Pagos confirmados de Cajeros DD — CI normalizada, deduplicada.
    // "Duplicados eliminados por CI" = movimientos totales − CI únicas
    // (un beneficiario con reasistencia, 2 pagos, cuenta una sola vez).
    const movSnap = await candidateRef(candidateId).collection("cashierMovements")
      .where("type", "==", "expense").where("status", "==", "confirmed").get();
    const cis = new Set<string>();
    const nombrePorCI = new Map<string, string>();
    const voterIdPorCI = new Map<string, string>();
    let movimientosConCI = 0;
    movSnap.forEach((d) => {
      const data = d.data();
      const ci = normalizarCedula(data.beneficiaryCI);
      if (!ci) return;
      movimientosConCI++;
      cis.add(ci);
      if (!nombrePorCI.has(ci)) nombrePorCI.set(ci, data.beneficiaryName || "");
      if (!voterIdPorCI.has(ci) && data.beneficiaryVoterId) voterIdPorCI.set(ci, data.beneficiaryVoterId);
    });
    const duplicadosEliminadosPorCI = movimientosConCI - cis.size;

    // 2) ¿Cuáles son "nuestro" votante? (savedRecords por cédula
    // normalizada, en tandas de 30 — límite del operador "in"). Si una CI
    // matchea más de un doc, es una inconsistencia — se excluye, no se
    // adivina a qué dirigente pertenece.
    const ciList = [...cis];
    const docsPorCedula = new Map<string, Array<{ id: string; data: FirebaseFirestore.DocumentData }>>();
    for (let i = 0; i < ciList.length; i += IN_CHUNK) {
      const chunk = ciList.slice(i, i + IN_CHUNK);
      if (chunk.length === 0) continue;
      const snap = await candidateRef(candidateId).collection("savedRecords").where("cedula", "in", chunk).get();
      snap.forEach((d) => {
        const ci = normalizarCedula(d.data().cedula);
        if (!docsPorCedula.has(ci)) docsPorCedula.set(ci, []);
        docsPorCedula.get(ci)!.push({ id: d.id, data: d.data() });
      });
    }

    const noPropios = ciList.filter((ci) => !docsPorCedula.has(ci));
    const inconsistentes = [...docsPorCedula.entries()].filter(([, docs]) => docs.length > 1);
    const propios = [...docsPorCedula.entries()]
      .filter(([, docs]) => docs.length === 1)
      .map(([ci, docs]) => ({ ci, id: docs[0].id, data: docs[0].data }));

    // 3) Estado efectivo actual de cada "nuestro" sin ambigüedad
    // (electionDayControl por id de documento, en tandas de 30).
    const voterIds = propios.map((r) => r.id);
    const controlByVoterId = new Map<string, FirebaseFirestore.DocumentData>();
    for (let i = 0; i < voterIds.length; i += IN_CHUNK) {
      const chunk = voterIds.slice(i, i + IN_CHUNK);
      if (chunk.length === 0) continue;
      const snap = await candidateRef(candidateId).collection("electionDayControl")
        .where(FieldPath.documentId(), "in", chunk).get();
      snap.forEach((d) => controlByVoterId.set(d.id, d.data()));
    }

    const yaVotaron = propios.filter((r) => controlByVoterId.get(r.id)?.status === "voted");
    const pendientes = propios.filter((r) => controlByVoterId.get(r.id)?.status !== "voted");

    // 4) Solo si el admin prendió incluirExternos: resolver contra el
    // padrón REAL (/voters, raíz, por el beneficiaryVoterId que el pago
    // ya validó al momento de pagar) los datos mínimos (nombre/local/
    // mesa/seccional/orden) para poder crear un savedRecords nuevo, sin
    // dueño (uid:null — nunca se le adivina un dirigente), por cada
    // externo. Si no hay beneficiaryVoterId o el /voters ya no existe,
    // queda reportado aparte y NUNCA se crea nada para esa CI.
    const externosResolubles = new Map<string, { voterId: string; data: FirebaseFirestore.DocumentData }>();
    const externosSinDatos: string[] = [];
    if (incluirExternos && noPropios.length > 0) {
      const voterIdsExternos = noPropios
        .map((ci) => ({ ci, voterId: voterIdPorCI.get(ci) }))
        .filter((x): x is { ci: string; voterId: string } => !!x.voterId);
      const voterDataById = new Map<string, FirebaseFirestore.DocumentData>();
      const idsUnicos = [...new Set(voterIdsExternos.map((x) => x.voterId))];
      for (let i = 0; i < idsUnicos.length; i += IN_CHUNK) {
        const chunk = idsUnicos.slice(i, i + IN_CHUNK);
        if (chunk.length === 0) continue;
        const snap = await db().collection("voters").where(FieldPath.documentId(), "in", chunk).get();
        snap.forEach((d) => voterDataById.set(d.id, d.data()));
      }
      for (const ci of noPropios) {
        const voterId = voterIdPorCI.get(ci);
        const data = voterId ? voterDataById.get(voterId) : undefined;
        if (voterId && data) externosResolubles.set(ci, { voterId, data });
        else externosSinDatos.push(ci);
      }
    }

    const resumenBase = {
      pagosConfirmadosUnicos: cis.size,
      nuestrosBeneficiarios: propios.length + inconsistentes.length, // antes de descartar ambiguos
      yaVotaron: yaVotaron.length,
      pendientesAMarcar: pendientes.length,
      beneficiariosExternos: noPropios.length,
      duplicadosEliminadosPorCI,
      inconsistencias: inconsistentes.length,
      externosDetalle: noPropios.slice(0, 100).map((ci) => ({ cedula: ci, nombre: nombrePorCI.get(ci) || "" })),
      inconsistenciasDetalle: inconsistentes.slice(0, 100).map(([ci, docs]) => ({
        cedula: ci, nombre: nombrePorCI.get(ci) || "", docs: docs.map((d) => d.id),
      })),
      incluirExternos: !!incluirExternos,
      ...(incluirExternos ? {
        externosACrearYMarcar: externosResolubles.size,
        externosSinDatosDeVotante: externosSinDatos.length,
        externosSinDatosDetalle: externosSinDatos.slice(0, 100).map((ci) => ({ cedula: ci, nombre: nombrePorCI.get(ci) || "" })),
      } : {}),
    };

    if (dryRun) {
      return { dryRun: true, ...resumenBase };
    }

    // ── EJECUCIÓN — solo llega acá después de que el admin confirmó ────
    // "pendientesAMarcar" de ESTE recalculo (no el de una vista previa
    // anterior) es el universo intentado. Cada intento re-lee `status`
    // DENTRO de su propia transacción (ejecutarCambioEstadoVoto) — si ya
    // pasó a 'voted' en el ínterin, `changed:false` y no se cuenta como
    // nuevo marcado ni se escribe nada de más.
    let marcadosAhora = 0;
    let yaVotadosAlEjecutar = 0;
    const errores: Array<{ cedula: string; error: string }> = [];
    for (let i = 0; i < pendientes.length; i += EXEC_CONCURRENCY) {
      const lote = pendientes.slice(i, i + EXEC_CONCURRENCY);
      const resultados = await Promise.all(lote.map(async (rec) => {
        try {
          const ctx: Contexto = {
            roles,
            record: rec.data,
            recordExists: true,
            control: controlByVoterId.get(rec.id),
            controlExists: controlByVoterId.has(rec.id),
            controlRef: candidateRef(candidateId).collection("electionDayControl").doc(rec.id),
            recordRef: candidateRef(candidateId).collection("savedRecords").doc(rec.id),
          };
          const r = await ejecutarCambioEstadoVoto(
            candidateId, rec.id, "voted", callerUid, "campaign_admin", ctx, "FINANZAS_BENEFICIARIOS"
          );
          return { ok: true as const, changed: r.changed };
        } catch (e: any) {
          return { ok: false as const, cedula: rec.data.cedula, error: e.message || String(e) };
        }
      }));
      for (const r of resultados) {
        if (!r.ok) { errores.push({ cedula: r.cedula, error: r.error }); continue; }
        if (r.changed) marcadosAhora++; else yaVotadosAlEjecutar++;
      }
    }

    // ── EXTERNOS (solo si incluirExternos) — crear savedRecords nuevo
    // (uid:null, sin dueño) + marcar voted, reusando ejecutarCambioEstadoVoto
    // tal cual. La creación va en una transacción que RE-CHEQUEA que
    // todavía no exista ningún savedRecords con esa cédula (por si otro
    // dirigente lo capturó mientras tanto, o esta misma herramienta corrió
    // 2 veces en paralelo) — si ya existe, se salta esta CI sin crear un
    // duplicado; la próxima corrida la verá como "propia" normal.
    let externosCreadosYMarcados = 0;
    let externosYaResueltosPorOtraVia = 0;
    const erroresExternos: Array<{ cedula: string; error: string }> = [];
    if (incluirExternos && externosResolubles.size > 0) {
      const entradas = [...externosResolubles.entries()];
      for (let i = 0; i < entradas.length; i += EXEC_CONCURRENCY) {
        const lote = entradas.slice(i, i + EXEC_CONCURRENCY);
        const resultados = await Promise.all(lote.map(async ([ci, { voterId, data: voterData }]) => {
          try {
            const savedRecordsCol = candidateRef(candidateId).collection("savedRecords");
            const nuevoRef = savedRecordsCol.doc();
            const creado = await db().runTransaction(async (tx) => {
              const existeSnap = await tx.get(savedRecordsCol.where("cedula", "==", ci));
              if (!existeSnap.empty) return null;
              const nombre = voterData.nombre || nombrePorCI.get(ci) || "";
              const payload = {
                uid: null,
                createdBy: callerUid,
                teamId: null,
                cedula: ci,
                nombre,
                nombre_upper: String(nombre).toUpperCase(),
                direccion: "",
                telefono: "",
                nota: "",
                requiresPickup: false,
                canBeDriver: false,
                wantsToBeMesario: false,
                ccAssignedUserId: null,
                importadoDesdeExcel: false,
                conciliadoConPadron: true,
                mesa: voterData.mesa || "",
                seccional: voterData.seccional || "",
                local: voterData.local || "",
                orden: voterData.orden || "",
                voterId,
                createdAt: FieldValue.serverTimestamp(),
                savedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                // Auditoría/reversibilidad (pedido explícito 2026-10-04):
                // distingue estos registros de una captura real de
                // dirigente — nunca se borran ni revierten solos, pero
                // quedan filtrables si hace falta.
                creadoDesde: "verificarBeneficiariosYMarcarVoto",
                creadoPor: callerUid,
              };
              tx.set(nuevoRef, payload);
              return payload;
            });
            if (!creado) return { ok: true as const, creado: false };

            const ctx: Contexto = {
              roles,
              record: creado,
              recordExists: true,
              control: undefined,
              controlExists: false,
              controlRef: candidateRef(candidateId).collection("electionDayControl").doc(nuevoRef.id),
              recordRef: nuevoRef,
            };
            await ejecutarCambioEstadoVoto(
              candidateId, nuevoRef.id, "voted", callerUid, "campaign_admin", ctx, "FINANZAS_BENEFICIARIOS_EXTERNO"
            );
            return { ok: true as const, creado: true };
          } catch (e: any) {
            return { ok: false as const, cedula: ci, error: e.message || String(e) };
          }
        }));
        for (const r of resultados) {
          if (!r.ok) { erroresExternos.push({ cedula: r.cedula, error: r.error }); continue; }
          if (r.creado) externosCreadosYMarcados++; else externosYaResueltosPorOtraVia++;
        }
      }
    }

    // Auditoría de la ejecución completa — un solo doc resumen, reusa
    // financeAuditLogs (mismo criterio que Cajeros DD).
    const auditRef = candidateRef(candidateId).collection("financeAuditLogs").doc();
    await auditRef.set({
      candidateId,
      entityType: "diaDBulkVoteSync",
      entityId: auditRef.id,
      action: "cashier_beneficiaries_vote_sync",
      performedBy: callerUid,
      previousData: null,
      newData: {
        pendientesPrevistos: pendientes.length,
        marcadosAhora,
        yaVotadosAlEjecutar,
        errores: errores.length,
        erroresDetalle: errores.slice(0, 20),
        incluirExternos: !!incluirExternos,
        externosCreadosYMarcados,
        externosYaResueltosPorOtraVia,
        erroresExternos: erroresExternos.length,
        erroresExternosDetalle: erroresExternos.slice(0, 20),
      },
      reason: "",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      dryRun: false,
      ...resumenBase,
      pendientesPrevistos: pendientes.length,
      marcadosAhora,
      yaVotadosAlEjecutar,
      errores: errores.length,
      erroresDetalle: errores.slice(0, 20),
      externosCreadosYMarcados,
      externosYaResueltosPorOtraVia,
      erroresExternos: erroresExternos.length,
      erroresExternosDetalle: erroresExternos.slice(0, 20),
    };
  }
);
