// Zonas de búsqueda (módulo Choferes) — agrupa votantes por cercanía
// geográfica a un punto y los asigna en bloque a un chofer para el Día D.
//
// DECISIÓN DE ARQUITECTURA: a diferencia del resto de Choferes hoy
// (createDriver/updateDriver/assignVotantesToDriver en firebaseCandidate.js
// son updateDoc/addDoc directos del cliente, sin transacción ni auditoría),
// TODA escritura acá pasa por estas Cloud Functions. Dos razones, ambas ya
// establecidas en el resto del proyecto, no inventadas para esto:
//   1. auditLogs SOLO lo escriben Cloud Functions (ver writeCandidateAuditLog
//      en lib.ts, mismo patrón que cambiarRolUsuarioCandidato) — el pedido
//      exige auditoría completa de zonas.
//   2. La garantía de "un votante nunca queda asignado a 2 choferes" bajo
//      concurrencia solo es demostrable con una transacción server-side
//      (Admin SDK). firestore.rules no puede expresar "revalidar contra el
//      estado actual de OTRO documento en el momento exacto de escribir" de
//      forma atómica — por eso driverZoneVoters tiene `allow write: if
//      false` y todo pasa por acá.
//
// MODELO DE DATOS (Firestore, no relacional — ver plan de implementación):
//   candidates/{candidateId}/driverZones/{zoneId}
//   candidates/{candidateId}/driverZoneVoters/{voterId}   ← id = savedRecords id
// El id de documento de driverZoneVoters IGUAL al voterId es lo que hace de
// "restricción única": dos reservas concurrentes al mismo votante son, por
// construcción, dos escrituras al mismo doc, resueltas en una única
// runTransaction().
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { requireCandidateRole, writeCandidateAuditLog } from "./lib";

const ADMIN_ROLES = ["campaign_admin", "coordinator"];

// Reserva temporal mientras se arma la zona (punto 4 del pedido: "puede
// vencer automáticamente si la asignación no se confirma"). Expiración
// LAZY (comparar reservedUntil contra Date.now() en cada lectura/escritura)
// en vez de Cloud Scheduler: el proyecto hoy no usa Scheduler en ningún
// lado (ver PROJECT_CONTEXT_MASTER.md §3) y no hace falta introducirlo solo
// para esto.
const RESERVATION_TTL_MS = 15 * 60 * 1000;

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Fórmula Haversine (punto 9 del pedido, rama "no Postgres/PostGIS" — este
// proyecto es Firestore). Firestore no tiene queries de radio nativas, así
// que el filtro se hace en memoria sobre los savedRecords con
// requiresPickup=true del candidato — a la escala real de este proyecto
// (candidato más grande: 1708 savedRecords) es equivalente en costo a
// getAllRecords(), que el resto de Choferes ya usa hoy sin paginar.
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// Mismo patrón de extracción que ya usa campaign.js del lado del cliente
// (.../@lat,lng... o ...q=lat,lng...) — acá vive una copia server-side
// mínima solo para poder resolver el punto central de la zona cuando el
// admin pega un link en vez de marcar en el mapa (punto 1 del pedido). No
// se comparte un paquete entre src/ (browser) y functions/ (Node) porque
// hoy no existe ninguno en este repo — mantenerlas sincronizadas manualmente
// es aceptable para una regex de 1 línea que no cambió en meses.
export function extractLatLngFromMapsUrl(
  url: string
): { latitude: number; longitude: number } | null {
  const match = (url || "").match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;
  return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
}

type ZoneVoterDoc = {
  zoneId: string;
  driverId: string;
  assignmentStatus: "RESERVADO" | "ASIGNADO" | "CANCELADO";
  reservedUntil?: admin.firestore.Timestamp | null;
};

// DISPONIBLE (punto 4 del pedido) es implícito: no existe doc, o existe con
// assignmentStatus CANCELADO, o es un RESERVADO vencido. Todo lo demás
// (RESERVADO vigente, ASIGNADO) cuenta como "ocupado" para efectos de
// exclusión mutua.
function isVoterTaken(data: ZoneVoterDoc | undefined): boolean {
  if (!data) return false;
  if (data.assignmentStatus === "ASIGNADO") return true;
  if (data.assignmentStatus === "RESERVADO") {
    const until = data.reservedUntil ? data.reservedUntil.toMillis() : 0;
    return until > Date.now();
  }
  return false; // CANCELADO
}

function db() {
  return admin.firestore();
}

function zonesCol(candidateId: string) {
  return db().collection("candidates").doc(candidateId).collection("driverZones");
}

function zoneVotersCol(candidateId: string) {
  return db().collection("candidates").doc(candidateId).collection("driverZoneVoters");
}

// ── previewVotersInZone ──────────────────────────────────────────────────
// Solo lectura: NO reserva nada todavía (evitar reservar votantes que el
// admin ni siquiera terminó de seleccionar). Devuelve candidatos dentro del
// radio, ordenados por distancia, ya excluyendo a quien esté ocupado.
export const previewVotersInZone = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, latitude, longitude, radiusMeters, maxVoters } =
      request.data ?? {};
    await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);

    if (
      !candidateId ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof radiusMeters !== "number" ||
      radiusMeters <= 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId/latitude/longitude/radiusMeters válidos"
      );
    }
    const limit = typeof maxVoters === "number" && maxVoters > 0 ? maxVoters : 25;

    const [recordsSnap, zoneVotersSnap] = await Promise.all([
      db()
        .collection("candidates")
        .doc(candidateId)
        .collection("savedRecords")
        .where("requiresPickup", "==", true)
        .get(),
      zoneVotersCol(candidateId).get(),
    ]);

    const takenIds = new Set<string>();
    zoneVotersSnap.forEach((doc) => {
      if (isVoterTaken(doc.data() as ZoneVoterDoc)) takenIds.add(doc.id);
    });

    const candidates = recordsSnap.docs
      .filter((doc) => !takenIds.has(doc.id))
      .map((doc) => {
        const r = doc.data();
        if (typeof r.latitude !== "number" || typeof r.longitude !== "number") {
          return null;
        }
        const distanceMeters = haversineMeters(
          latitude,
          longitude,
          r.latitude,
          r.longitude
        );
        if (distanceMeters > radiusMeters) return null;
        return {
          voterId: doc.id,
          nombre: r.nombre || "",
          cedula: r.cedula || "",
          telefono: r.telefono || "",
          direccion: r.direccion || "",
          local: r.local || "",
          mesa: r.mesa || "",
          orden: r.orden || "",
          distanceMeters: Math.round(distanceMeters),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);

    return { voters: candidates };
  }
);

// ── updateZoneMeta ───────────────────────────────────────────────────────
// Edita solo name/maxVoters de una zona ya creada (punto 5 del pedido,
// "Editar zona"). A propósito NO permite mover el punto central ni cambiar
// el radio acá — eso dejaría votantes ya asignados fuera del radio real
// sin revalidar nada; la UI pide cancelar y crear una zona nueva para eso.
export const updateZoneMeta = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, zoneId, name, maxVoters } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);
    if (!candidateId || !zoneId || !name) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/zoneId/name");
    }

    const zoneRef = zonesCol(candidateId).doc(zoneId);
    const before = await zoneRef.get();
    if (!before.exists) {
      throw new functions.https.HttpsError("not-found", "La zona no existe");
    }

    await zoneRef.set(
      {
        name,
        maxVoters: typeof maxVoters === "number" ? maxVoters : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_update_meta",
      entityType: "driverZones",
      entityId: zoneId,
      before: { name: before.data()?.name, maxVoters: before.data()?.maxVoters },
      after: { name, maxVoters },
    });

    return { ok: true };
  }
);

// ── createZoneAndReserve ─────────────────────────────────────────────────
// Crea la zona y reserva (RESERVADO) los votantes elegidos, revalidando
// server-side en la MISMA transacción que ninguno se haya ocupado entre el
// preview y el clic de "guardar" (punto 3 del pedido: revalidar antes de
// confirmar para evitar duplicados por 2 usuarios trabajando a la vez).
export const createZoneAndReserve = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const {
      candidateId,
      name,
      latitude,
      longitude,
      radiusMeters,
      maxVoters,
      driverId,
      voterIds,
    } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);

    if (
      !candidateId ||
      !name ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof radiusMeters !== "number" ||
      !driverId ||
      !Array.isArray(voterIds) ||
      voterIds.length === 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos para crear la zona"
      );
    }
    if (typeof maxVoters === "number" && voterIds.length > maxVoters) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Seleccionaste ${voterIds.length} votantes, el máximo de la zona es ${maxVoters}`
      );
    }

    const driverDoc = await db()
      .collection("candidates")
      .doc(candidateId)
      .collection("drivers")
      .doc(driverId)
      .get();
    if (!driverDoc.exists) {
      throw new functions.https.HttpsError("not-found", "El chofer indicado no existe");
    }

    const zoneRef = zonesCol(candidateId).doc();
    const reservedUntil = admin.firestore.Timestamp.fromMillis(
      Date.now() + RESERVATION_TTL_MS
    );

    const { reserved, lost } = await db().runTransaction(async (tx) => {
      // Firestore exige TODAS las lecturas antes de cualquier escritura en
      // una transacción — por eso el loop de lecturas está separado del de
      // escrituras.
      const voterRefs = voterIds.map((id: string) => zoneVotersCol(candidateId).doc(id));
      const voterSnaps = await Promise.all(voterRefs.map((ref: FirebaseFirestore.DocumentReference) => tx.get(ref)));

      const reservedIds: string[] = [];
      const lostIds: string[] = [];

      voterSnaps.forEach((snap, i) => {
        const data = snap.exists ? (snap.data() as ZoneVoterDoc) : undefined;
        if (isVoterTaken(data)) {
          lostIds.push(voterIds[i]);
        } else {
          reservedIds.push(voterIds[i]);
        }
      });

      tx.set(zoneRef, {
        name,
        latitude,
        longitude,
        radiusMeters,
        maxVoters: typeof maxVoters === "number" ? maxVoters : null,
        driverId,
        status: "active",
        createdBy: callerUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      reservedIds.forEach((voterId) => {
        tx.set(zoneVotersCol(candidateId).doc(voterId), {
          zoneId: zoneRef.id,
          driverId,
          assignmentStatus: "RESERVADO",
          reservedBy: callerUid,
          reservedAt: admin.firestore.FieldValue.serverTimestamp(),
          reservedUntil,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return { reserved: reservedIds, lost: lostIds };
    });

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_create",
      entityType: "driverZones",
      entityId: zoneRef.id,
      before: null,
      after: { name, latitude, longitude, radiusMeters, driverId, reserved, lost },
    });

    return { zoneId: zoneRef.id, reserved, lost };
  }
);

// ── confirmZoneAssignment ────────────────────────────────────────────────
// RESERVADO → ASIGNADO, y fan-out atómico a savedRecords.chofer_asignado +
// electionDayControl.assignedDriverId (mismo doc id = voterId en las 3
// colecciones) para que "Votantes asignados" y Día D Control lo vean sin
// tocar su código — ver diagnóstico: hoy esos 2 campos son 2 de los 3
// mecanismos de asignación de chofer que ya existían sin sincronizar.
export const confirmZoneAssignment = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, zoneId } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);
    if (!candidateId || !zoneId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/zoneId");
    }

    const zoneRef = zonesCol(candidateId).doc(zoneId);
    const confirmedIds = await db().runTransaction(async (tx) => {
      const zoneSnap = await tx.get(zoneRef);
      if (!zoneSnap.exists) {
        throw new functions.https.HttpsError("not-found", "La zona no existe");
      }
      const zone = zoneSnap.data()!;
      if (zone.status !== "active") {
        throw new functions.https.HttpsError("failed-precondition", "La zona no está activa");
      }

      const reservedSnap = await tx.get(
        zoneVotersCol(candidateId)
          .where("zoneId", "==", zoneId)
          .where("assignmentStatus", "==", "RESERVADO")
      );

      const ids: string[] = [];
      reservedSnap.forEach((doc) => {
        const data = doc.data() as ZoneVoterDoc;
        // Reserva vencida: no se confirma, queda libre para otra zona.
        if (!isVoterTaken(data)) return;
        ids.push(doc.id);
      });

      ids.forEach((voterId) => {
        tx.update(zoneVotersCol(candidateId).doc(voterId), {
          assignmentStatus: "ASIGNADO",
          assignedBy: callerUid,
          assignedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(
          db().collection("candidates").doc(candidateId).collection("savedRecords").doc(voterId),
          { chofer_asignado: zone.driverId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        tx.set(
          db()
            .collection("candidates")
            .doc(candidateId)
            .collection("electionDayControl")
            .doc(voterId),
          {
            assignedDriverId: zone.driverId,
            requiresPickup: true,
            lastUpdatedBy: callerUid,
            lastUpdatedRole: "campaign_admin",
          },
          { merge: true }
        );
      });

      return ids;
    });

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_confirm",
      entityType: "driverZones",
      entityId: zoneId,
      before: null,
      after: { confirmedVoterIds: confirmedIds },
    });

    return { confirmed: confirmedIds };
  }
);

// Lógica de liberación compartida por releaseZoneVoters (puntual) y
// cancelZone (todos los votantes activos de la zona) — extraída a función
// simple (no un onCall) porque un CloudFunction<T> de firebase-functions v2
// no se puede invocar directamente desde otra función, solo desde HTTP; acá
// se llama como cualquier función TS normal, cada caller hace su propio
// chequeo de auth/auditoría.
async function releaseVotersInternal(
  candidateId: string,
  zoneId: string,
  voterIds: string[],
  callerUid: string
): Promise<string[]> {
  const zoneSnap = await zonesCol(candidateId).doc(zoneId).get();
  if (!zoneSnap.exists) {
    throw new functions.https.HttpsError("not-found", "La zona no existe");
  }
  const driverId = zoneSnap.data()!.driverId;

  const released = await db().runTransaction(async (tx) => {
    const refs = voterIds.map((id: string) => zoneVotersCol(candidateId).doc(id));
    const snaps = await Promise.all(refs.map((r: FirebaseFirestore.DocumentReference) => tx.get(r)));

    const ids: string[] = [];
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const data = snap.data() as ZoneVoterDoc;
      if (data.zoneId !== zoneId) return; // ya no pertenece a esta zona
      ids.push(voterIds[i]);
    });

    ids.forEach((voterId) => {
      tx.update(zoneVotersCol(candidateId).doc(voterId), {
        assignmentStatus: "CANCELADO",
        releasedBy: callerUid,
        releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const savedRef = db()
        .collection("candidates")
        .doc(candidateId)
        .collection("savedRecords")
        .doc(voterId);
      tx.set(
        savedRef,
        { chofer_asignado: admin.firestore.FieldValue.delete() },
        { merge: true }
      );
    });

    return ids;
  });

  // El chequeo de "seguía apuntando a este chofer" en electionDayControl se
  // hace fuera de la transacción anterior (necesita un read por doc que ya
  // no cabía limpio junto a las lecturas de zoneVoters) — es una segunda
  // pasada de best-effort, mismo criterio que setDiaDStatus ya usa hoy para
  // mesarios (PROJECT_CONTEXT_MASTER.md §5.4).
  await Promise.all(
    released.map(async (voterId) => {
      const ref = db()
        .collection("candidates")
        .doc(candidateId)
        .collection("electionDayControl")
        .doc(voterId);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.assignedDriverId === driverId) {
        await ref.set(
          { assignedDriverId: admin.firestore.FieldValue.delete() },
          { merge: true }
        );
      }
    })
  );

  return released;
}

// ── releaseZoneVoters ────────────────────────────────────────────────────
// Libera votantes puntuales de una zona (punto 5, "Liberar votantes").
// Solo limpia chofer_asignado/assignedDriverId si TODAVÍA apuntan a esta
// misma zona/chofer — así no pisa una reasignación manual posterior hecha
// desde Día D Control (ver riesgo documentado en el plan).
export const releaseZoneVoters = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, zoneId, voterIds } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);
    if (!candidateId || !zoneId || !Array.isArray(voterIds) || voterIds.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId/zoneId/voterIds"
      );
    }

    const released = await releaseVotersInternal(candidateId, zoneId, voterIds, callerUid);

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_release_voters",
      entityType: "driverZones",
      entityId: zoneId,
      before: { voterIds },
      after: { released },
    });

    return { released };
  }
);

// ── cancelZone ────────────────────────────────────────────────────────────
// Cancela la zona completa: libera todos sus votantes RESERVADO/ASIGNADO y
// marca la zona como cancelled.
export const cancelZone = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, zoneId } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);
    if (!candidateId || !zoneId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/zoneId");
    }

    const activeSnap = await zoneVotersCol(candidateId)
      .where("zoneId", "==", zoneId)
      .where("assignmentStatus", "in", ["RESERVADO", "ASIGNADO"])
      .get();
    const voterIds = activeSnap.docs.map((d) => d.id);

    await zonesCol(candidateId).doc(zoneId).set(
      {
        status: "cancelled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const released =
      voterIds.length > 0
        ? await releaseVotersInternal(candidateId, zoneId, voterIds, callerUid)
        : [];

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_cancel",
      entityType: "driverZones",
      entityId: zoneId,
      before: null,
      after: { releasedVoterIds: released },
    });

    return { released };
  }
);

// ── changeZoneDriver ─────────────────────────────────────────────────────
// Cambia el chofer responsable de una zona ya confirmada, con el mismo
// fan-out atómico que confirmZoneAssignment (punto 5: "Asignar o cambiar
// chofer").
export const changeZoneDriver = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, zoneId, newDriverId } = request.data ?? {};
    const callerUid = await requireCandidateRole(request.auth, candidateId, ADMIN_ROLES);
    if (!candidateId || !zoneId || !newDriverId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId/zoneId/newDriverId"
      );
    }

    const newDriverDoc = await db()
      .collection("candidates")
      .doc(candidateId)
      .collection("drivers")
      .doc(newDriverId)
      .get();
    if (!newDriverDoc.exists) {
      throw new functions.https.HttpsError("not-found", "El chofer indicado no existe");
    }

    const zoneRef = zonesCol(candidateId).doc(zoneId);
    const changedIds = await db().runTransaction(async (tx) => {
      const zoneSnap = await tx.get(zoneRef);
      if (!zoneSnap.exists) {
        throw new functions.https.HttpsError("not-found", "La zona no existe");
      }
      const oldDriverId = zoneSnap.data()!.driverId;

      const assignedSnap = await tx.get(
        zoneVotersCol(candidateId)
          .where("zoneId", "==", zoneId)
          .where("assignmentStatus", "==", "ASIGNADO")
      );

      const ids: string[] = [];
      assignedSnap.forEach((doc) => ids.push(doc.id));

      tx.set(
        zoneRef,
        { driverId: newDriverId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      ids.forEach((voterId) => {
        tx.set(
          zoneVotersCol(candidateId).doc(voterId),
          { driverId: newDriverId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        tx.set(
          db().collection("candidates").doc(candidateId).collection("savedRecords").doc(voterId),
          { chofer_asignado: newDriverId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        tx.set(
          db()
            .collection("candidates")
            .doc(candidateId)
            .collection("electionDayControl")
            .doc(voterId),
          { assignedDriverId: newDriverId },
          { merge: true }
        );
      });

      return { ids, oldDriverId };
    });

    await writeCandidateAuditLog(candidateId, {
      actorUid: callerUid,
      actorEmail: request.auth?.token?.email ?? null,
      action: "driver_zone_change_driver",
      entityType: "driverZones",
      entityId: zoneId,
      before: { driverId: changedIds.oldDriverId },
      after: { driverId: newDriverId, voterIds: changedIds.ids },
    });

    return { changed: changedIds.ids };
  }
);
