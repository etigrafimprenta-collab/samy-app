// Día D Control (diaDControl.ts) — invocado de verdad vía .run() contra
// el emulador de Firestore (mismo patrón que incidents.functions.test.ts).
// Cubre la reescritura de rendimiento (resolverContexto con una sola
// tanda de lecturas) para confirmar que, pese al refactor, el resultado
// sigue siendo exactamente el mismo que antes de optimizar.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-diad-control-fn-test";
const CAND = "cand-diad-fn-test";

const DIRIGENTE_UID = "dirigente-fn-uid";
const OTRO_DIRIGENTE_UID = "otro-dirigente-fn-uid";
const ADMIN_UID = "admin-fn-uid";

const RECORD_PROPIO = "record-propio";
const RECORD_AJENO = "record-ajeno";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test" });
  await db.collection("candidates").doc(CAND).collection("users").doc(DIRIGENTE_UID)
    .set({ role: "dirigente", nombre: "Dirigente Test" });
  await db.collection("candidates").doc(CAND).collection("users").doc(OTRO_DIRIGENTE_UID)
    .set({ role: "dirigente", nombre: "Otro Dirigente" });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID)
    .set({ role: "campaign_admin", nombre: "Admin Test" });

  // RECORD_PROPIO le pertenece a DIRIGENTE_UID; RECORD_AJENO a OTRO_DIRIGENTE_UID.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_PROPIO)
    .set({ uid: DIRIGENTE_UID, cedula: "1111111", nombre: "Votante Propio", local: "Local A", mesa: "5", seccional: "10" });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_AJENO)
    .set({ uid: OTRO_DIRIGENTE_UID, cedula: "2222222", nombre: "Votante Ajeno", local: "Local B", mesa: "6", seccional: "11" });
});

async function loadFns() {
  return await import("../src/diaDControl.js");
}

describe("setDiaDStatusFn — dirigente, primer click sobre un votante propio nunca tocado", () => {
  it("permite la escritura y crea electionDayControl con assignedLeaderId CORRECTO (no null)", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_PROPIO, newStatus: "contacted" },
      auth: { uid: DIRIGENTE_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_PROPIO).get();
    expect(controlSnap.exists).toBe(true);
    const control = controlSnap.data()!;
    // El chequeo central de esta suite: NUNCA debe quedar en null (ese
    // fue el bug real que rompía esto para cualquier dirigente real).
    expect(control.assignedLeaderId).toBe(DIRIGENTE_UID);
    expect(control.status).toBe("contacted");

    const movSnap = await db.collection("candidates").doc(CAND).collection("electionDayMovements")
      .where("voterId", "==", RECORD_PROPIO).get();
    expect(movSnap.size).toBe(1);
    expect(movSnap.docs[0].data().newStatus).toBe("contacted");
    expect(movSnap.docs[0].data().previousStatus).toBe(null);
  });

  it("un segundo cambio de estado (update, doc ya existe) también funciona y mantiene assignedLeaderId", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_PROPIO, newStatus: "voted" },
      auth: { uid: DIRIGENTE_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_PROPIO).get();
    expect(controlSnap.data()!.assignedLeaderId).toBe(DIRIGENTE_UID);
    expect(controlSnap.data()!.status).toBe("voted");
  });
});

describe("setDiaDStatusFn — dirigente intenta tocar un votante AJENO", () => {
  it("DENEGADO (permission-denied)", async () => {
    const fns = await loadFns();
    await expect(
      fns.setDiaDStatusFn.run({
        data: { candidateId: CAND, voterId: RECORD_AJENO, newStatus: "voted" },
        auth: { uid: DIRIGENTE_UID, token: {} as any },
      } as any)
    ).rejects.toThrow();
  });
});

describe("setDiaDStatusFn — campaign_admin sobre cualquier votante", () => {
  it("PERMITIDO, sin necesidad de vínculo previo", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: RECORD_AJENO, newStatus: "contacted" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);
  });
});

describe("setDiaDFlagsFn — dirigente sobre su propio votante", () => {
  it("PERMITIDO, setea el flag sin tocar status", async () => {
    const fns = await loadFns();
    const result: any = await fns.setDiaDFlagsFn.run({
      data: { candidateId: CAND, voterId: RECORD_PROPIO, flags: { requiresPickup: true } },
      auth: { uid: DIRIGENTE_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_PROPIO).get();
    expect(controlSnap.data()!.requiresPickup).toBe(true);
    expect(controlSnap.data()!.status).toBe("voted"); // no lo tocó
  });
});

describe("reportarIncidenciaDiaDFn — dirigente sobre su propio votante", () => {
  it("PERMITIDO, crea la incidencia y marca incidentOpen", async () => {
    const fns = await loadFns();
    const result: any = await fns.reportarIncidenciaDiaDFn.run({
      data: { candidateId: CAND, voterId: RECORD_PROPIO, type: "Otro", description: "Prueba" },
      auth: { uid: DIRIGENTE_UID, token: {} as any },
    } as any);
    expect(result.ok).toBe(true);

    const db = admin.firestore();
    const incSnap = await db.collection("candidates").doc(CAND).collection("incidents")
      .where("voterId", "==", RECORD_PROPIO).get();
    expect(incSnap.size).toBe(1);
    const controlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_PROPIO).get();
    expect(controlSnap.data()!.incidentOpen).toBe(true);
  });
});
