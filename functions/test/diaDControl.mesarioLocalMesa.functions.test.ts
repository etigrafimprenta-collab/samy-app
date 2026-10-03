// Nueva rama de autorización en resolverContexto (diaDControl.ts): un
// mesario SIN assignedTableUserId previo, pero cuyo perfil (local+mesa)
// coincide con el del savedRecord, debe poder marcar/revertir "voted" —
// esto es lo que arregla la sincronización Control Día D (admin) vs la
// vista dedicada de mesario (que opera por local+mesa, no por
// assignedTableUserId asignado a mano).
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-diad-mesario-sync-test";
const CAND = "cand-diad-mesario-sync-test";

const MESARIO_UID = "mesario-local-mesa-uid";
const OTRO_MESARIO_UID = "otro-mesario-uid";

const RECORD_DE_SU_MESA = "record-de-su-mesa";
const RECORD_DE_OTRA_MESA = "record-de-otra-mesa";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad" });
  await db.collection("candidates").doc(CAND).collection("diaD").doc("current").set({ enabled: true });

  // Mesario con perfil local+mesa (mecanismo NUEVO) — SIN ningún
  // electionDayControl.assignedTableUserId asignado a mano todavía.
  await db.collection("candidates").doc(CAND).collection("users").doc(MESARIO_UID)
    .set({ role: "mesario", nombre: "Mesario Test", local: "Local X", mesa: "8" });
  // Otro mesario, de una mesa distinta.
  await db.collection("candidates").doc(CAND).collection("users").doc(OTRO_MESARIO_UID)
    .set({ role: "mesario", nombre: "Otro Mesario", local: "Local Y", mesa: "3" });

  // savedRecord real de la mesa del primer mesario.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_DE_SU_MESA)
    .set({ uid: null, cedula: "9991111", nombre: "Votante De Su Mesa", local: "Local X", mesa: "8", seccional: "" });
  // savedRecord de OTRA mesa (no le corresponde a ningún mesario de arriba).
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_DE_OTRA_MESA)
    .set({ uid: null, cedula: "9992222", nombre: "Votante De Otra Mesa", local: "Local Z", mesa: "99", seccional: "" });
});

async function loadFns() {
  return await import("../src/diaDControl.js");
}

describe("setDiaDStatusFn — mesario por local+mesa (sin assignedTableUserId previo)", () => {
  it("PERMITIDO: marca 'voted' sobre un savedRecord de SU propia mesa, crea electionDayControl correctamente", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_DE_SU_MESA, newStatus: "voted" },
      auth: { uid: MESARIO_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_DE_SU_MESA).get();
    expect(controlSnap.exists).toBe(true);
    expect(controlSnap.data()!.status).toBe("voted");
    expect(controlSnap.data()!.lastUpdatedRole).toBe("mesario");

    // Espejo en diaD/votes (sincronizarDiaDVotes) también debe quedar voted:true.
    const votesSnap = await db.collection("candidates").doc(CAND).collection("diaD").doc("current")
      .collection("votes").doc("_8_9991111").get();
    expect(votesSnap.exists).toBe(true);
    expect(votesSnap.data()!.voted).toBe(true);
  });

  it("revertir a 'pending' PERMITIDO (mismo mesario, mismo mecanismo) y desmarca el espejo en diaD/votes", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_DE_SU_MESA, newStatus: "pending" },
      auth: { uid: MESARIO_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_DE_SU_MESA).get();
    expect(controlSnap.data()!.status).toBe("pending");

    const votesSnap = await db.collection("candidates").doc(CAND).collection("diaD").doc("current")
      .collection("votes").doc("_8_9991111").get();
    expect(votesSnap.data()!.voted).toBe(false);
  });

  it("DENEGADO: un mesario de OTRA mesa no puede tocar este savedRecord", async () => {
    const fns = await loadFns();
    await expect(
      fns.setDiaDStatusFn.run({
        data: { candidateId: CAND, voterId: RECORD_DE_SU_MESA, newStatus: "voted" },
        auth: { uid: OTRO_MESARIO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow();
  });

  it("DENEGADO: el mesario de Local X/Mesa 8 no puede tocar un savedRecord de otra mesa (Local Z/Mesa 99)", async () => {
    const fns = await loadFns();
    await expect(
      fns.setDiaDStatusFn.run({
        data: { candidateId: CAND, voterId: RECORD_DE_OTRA_MESA, newStatus: "voted" },
        auth: { uid: MESARIO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow();
  });
});
