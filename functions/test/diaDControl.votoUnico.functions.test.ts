// AUDITORÍA 2026-10-03 — voto único por elector, idempotencia y
// atomicidad. Replica EXACTA de la matriz de pruebas pedida:
// 4742/0 -> dirigente marca X -> 4741/1 -> mesario marca el MISMO X ->
// sigue 4741/1 -> admin marca el MISMO X -> sigue 4741/1 -> revertir ->
// vuelve exacto al estado original. También una prueba de carrera
// (2 marcas casi simultáneas) para la condición de atomicidad.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-voto-unico-test";
const CAND = "cand-voto-unico-test";

const DIRIGENTE_UID = "dirigente-vu-uid";
const MESARIO_UID = "mesario-vu-uid";
const ADMIN_UID = "admin-vu-uid";

const RECORD_X = "record-elector-x"; // "pertenece" al dirigente (uid=DIRIGENTE_UID)
const OTROS_RECORDS = Array.from({ length: 4741 }, (_, i) => `record-otro-${i}`);

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad" });
  await db.collection("candidates").doc(CAND).collection("diaD").doc("current").set({ enabled: true });

  await db.collection("candidates").doc(CAND).collection("users").doc(DIRIGENTE_UID)
    .set({ role: "dirigente", nombre: "Dirigente Test" });
  await db.collection("candidates").doc(CAND).collection("users").doc(MESARIO_UID)
    .set({ role: "mesario", nombre: "Mesario Test", local: "Local X", mesa: "8" });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID)
    .set({ role: "campaign_admin", nombre: "Admin Test" });

  // 4742 "comprometidos" reales — RECORD_X es del dirigente, del local/mesa
  // del mesario; el resto son relleno para que el conteo total sea 4742.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_X)
    .set({ uid: DIRIGENTE_UID, cedula: "5551234", nombre: "Elector X", local: "Local X", mesa: "8", seccional: "" });

  let batch = db.batch();
  let n = 0;
  for (const id of OTROS_RECORDS) {
    batch.set(db.collection("candidates").doc(CAND).collection("savedRecords").doc(id), {
      uid: DIRIGENTE_UID, cedula: `9${id}`, nombre: "Relleno", local: "Local Y", mesa: "1", seccional: "",
    });
    n++;
    if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
}, 60000);

async function loadFns() {
  return await import("../src/diaDControl.js");
}

async function contarAdmin() {
  const db = admin.firestore();
  const recordsSnap = await db.collection("candidates").doc(CAND).collection("savedRecords").get();
  const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").get();
  const controlByVoterId: Record<string, any> = {};
  controlSnap.forEach((d) => { controlByVoterId[d.id] = d.data(); });
  const totalComprometidos = recordsSnap.size;
  const yaVotaron = recordsSnap.docs.filter((d) => controlByVoterId[d.id]?.status === "voted").length;
  const pendientes = recordsSnap.docs.filter((d) => !controlByVoterId[d.id] || controlByVoterId[d.id].status === "pending").length;
  return { totalComprometidos, yaVotaron, pendientes };
}

describe("Voto único por elector — matriz exacta pedida", () => {
  it("4742/0 -> dirigente marca X -> 4741/1", async () => {
    const antes = await contarAdmin();
    expect(antes).toEqual({ totalComprometidos: 4742, yaVotaron: 0, pendientes: 4742 });

    const fns = await loadFns();
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_X, newStatus: "voted" },
      auth: { uid: DIRIGENTE_UID, token: {} as any },
    } as any);
    expect((r as any).ok).toBe(true);
    expect((r as any).changed).toBe(true);

    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 1, pendientes: 4741 });
  });

  it("mesario marca el MISMO X -> sigue 4741/1 (idempotente, no duplica)", async () => {
    const fns = await loadFns();
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_X, newStatus: "voted" },
      auth: { uid: MESARIO_UID, token: {} as any },
    } as any);
    expect((r as any).ok).toBe(true);
    expect((r as any).changed).toBe(false); // no-op idempotente

    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 1, pendientes: 4741 });
  });

  it("admin marca el MISMO X -> sigue 4741/1 (idempotente)", async () => {
    const fns = await loadFns();
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_X, newStatus: "voted" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect((r as any).ok).toBe(true);
    expect((r as any).changed).toBe(false);

    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 1, pendientes: 4741 });
  });

  it("atribución intacta: assignedLeaderId sigue siendo el dirigente original (las re-marcas de mesario/admin fueron no-ops idempotentes, nunca escribieron nada)", async () => {
    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_X).get();
    expect(controlSnap.data()!.assignedLeaderId).toBe(DIRIGENTE_UID);
    // La transición REAL (pending->voted) la hizo el dirigente — mesario y
    // admin marcaron el mismo elector después, pero como ya estaba
    // 'voted' eso fue un no-op idempotente (changed:false, sin escritura
    // alguna), así que lastUpdatedBy/Role siguen siendo los de la
    // transición real, no los del último que lo tocó sin cambiar nada.
    expect(controlSnap.data()!.lastUpdatedBy).toBe(DIRIGENTE_UID);
    expect(controlSnap.data()!.lastUpdatedRole).toBe("dirigente");
  });

  it("revertir (pending) -> vuelve exacto a 4742/0, incluso con 3 marcas previas de 3 actores distintos", async () => {
    const fns = await loadFns();
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_X, newStatus: "pending" },
      auth: { uid: MESARIO_UID, token: {} as any },
    } as any);
    expect((r as any).ok).toBe(true);
    expect((r as any).changed).toBe(true);

    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 0, pendientes: 4742 });

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_X).get();
    expect(controlSnap.data()!.status).toBe("pending");
    expect(controlSnap.data()!.assignedLeaderId).toBe(DIRIGENTE_UID); // sigue intacto
  });

  it("revertir de nuevo (ya pending) -> no-op idempotente, sigue 4742/0", async () => {
    const fns = await loadFns();
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_X, newStatus: "pending" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect((r as any).changed).toBe(false);
    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 0, pendientes: 4742 });
  });

  it("CONCURRENCIA: dos marcas casi simultáneas sobre el mismo elector -> un solo voto contado, un solo movimiento real", async () => {
    const fns = await loadFns();
    const [r1, r2] = await Promise.all([
      fns.setDiaDStatusFn.run({
        data: { candidateId: CAND, voterId: RECORD_X, newStatus: "voted" },
        auth: { uid: MESARIO_UID, token: {} as any },
      } as any),
      fns.setDiaDStatusFn.run({
        data: { candidateId: CAND, voterId: RECORD_X, newStatus: "voted" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any),
    ]);
    expect((r1 as any).ok).toBe(true);
    expect((r2 as any).ok).toBe(true);
    // Exactamente UNA de las dos debe haber hecho el cambio real (changed:true);
    // la otra, al perder la carrera / ver el estado ya actualizado, es un no-op.
    const changedCount = [(r1 as any).changed, (r2 as any).changed].filter(Boolean).length;
    expect(changedCount).toBe(1);

    const despues = await contarAdmin();
    expect(despues).toEqual({ totalComprometidos: 4742, yaVotaron: 1, pendientes: 4741 });

    const db = admin.firestore();
    const movSnap = await db.collection("candidates").doc(CAND).collection("electionDayMovements")
      .where("voterId", "==", RECORD_X).where("newStatus", "==", "voted").get();
    // Un solo movimiento real de transición pending->voted para esta ronda
    // (puede haber movimientos de rondas anteriores en el test anterior,
    // así que filtramos por previousStatus=pending, el único estado posible
    // justo antes de esta prueba).
    const transicionesReales = movSnap.docs.filter(d => d.data().previousStatus === 'pending');
    expect(transicionesReales.length).toBe(1);
  });
});
