// Test de concurrencia + reglas contra el emulador de Firestore. Corre con
// `npm test` (envuelve este archivo en `firebase emulators:exec --only
// firestore`, ver package.json), NUNCA contra producción.
//
// Objetivo central (punto 3 del pedido): verificar que 2 intentos
// simultáneos de reservar el MISMO votante en 2 zonas distintas resuelven
// en exactamente 1 ganador — la garantía que hoy NO existe en
// assignVotantesToDriver()/updateRecord() (ver diagnóstico del plan).
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";
import {
  initializeTestEnvironment,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ID = "demo-test";
const CANDIDATE_ID = "candidato-test";
const ADMIN_UID = "admin-uid";
const DRIVER_A_UID = "driver-a-uid";
const DRIVER_B_UID = "driver-b-uid";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST no está seteado — corré este test con `npm test`, no con `vitest` directo"
    );
  }
  const [hostname, portStr] = host.split(":");

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: hostname,
      port: Number(portStr),
      rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });

  process.env.GCLOUD_PROJECT = PROJECT_ID;
  admin.initializeApp({ projectId: PROJECT_ID });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  const db = admin.firestore();
  await db
    .collection("candidates")
    .doc(CANDIDATE_ID)
    .collection("users")
    .doc(ADMIN_UID)
    .set({ role: "campaign_admin" });
  await db.collection("candidates").doc(CANDIDATE_ID).collection("drivers").doc("driver-a").set({
    nombre: "Chofer A",
    usuarioAsignado: DRIVER_A_UID,
  });
  await db.collection("candidates").doc(CANDIDATE_ID).collection("drivers").doc("driver-b").set({
    nombre: "Chofer B",
    usuarioAsignado: DRIVER_B_UID,
  });
  await db
    .collection("candidates")
    .doc(CANDIDATE_ID)
    .collection("savedRecords")
    .doc("voter-1")
    .set({
      nombre: "Juan Votante",
      cedula: "1234567",
      requiresPickup: true,
      latitude: -25.32,
      longitude: -57.58,
    });
});

// Importado DESPUÉS de setear FIRESTORE_EMULATOR_HOST (ver vitest config /
// package.json test script, que lo exporta antes de invocar vitest) para
// que admin.firestore() dentro de driverZones.ts apunte al emulador y no
// intente contra producción.
async function loadFns() {
  return await import("../src/driverZones.js");
}

describe("createZoneAndReserve — exclusión mutua bajo concurrencia", () => {
  it("de 2 reservas simultáneas al mismo votante, solo 1 gana", async () => {
    const { createZoneAndReserve } = await loadFns();

    const baseData = {
      candidateId: CANDIDATE_ID,
      latitude: -25.32,
      longitude: -57.58,
      radiusMeters: 1000,
      maxVoters: 10,
      voterIds: ["voter-1"],
    };

    const [resA, resB] = await Promise.all([
      createZoneAndReserve.run({
        data: { ...baseData, name: "Zona A", driverId: "driver-a" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any),
      createZoneAndReserve.run({
        data: { ...baseData, name: "Zona B", driverId: "driver-b" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any),
    ]);

    const reservedCount = [resA, resB].filter((r: any) => r.reserved.includes("voter-1")).length;
    const lostCount = [resA, resB].filter((r: any) => r.lost.includes("voter-1")).length;

    expect(reservedCount).toBe(1);
    expect(lostCount).toBe(1);

    const voterDoc = await admin
      .firestore()
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("driverZoneVoters")
      .doc("voter-1")
      .get();
    expect(voterDoc.exists).toBe(true);
    expect(voterDoc.data()?.assignmentStatus).toBe("RESERVADO");
    // El zoneId ganador tiene que corresponder a la respuesta que ganó.
    const winner = resA.reserved.includes("voter-1") ? resA : resB;
    expect(voterDoc.data()?.zoneId).toBe(winner.zoneId);
  });

  it("una 2da reserva sobre un votante ya RESERVADO (vigente) lo pierde", async () => {
    const { createZoneAndReserve } = await loadFns();
    const baseData = {
      candidateId: CANDIDATE_ID,
      latitude: -25.32,
      longitude: -57.58,
      radiusMeters: 1000,
      maxVoters: 10,
      voterIds: ["voter-1"],
    };

    const first = (await createZoneAndReserve.run({
      data: { ...baseData, name: "Zona A", driverId: "driver-a" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;
    expect(first.reserved).toEqual(["voter-1"]);

    const second = (await createZoneAndReserve.run({
      data: { ...baseData, name: "Zona B", driverId: "driver-b" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;
    expect(second.reserved).toEqual([]);
    expect(second.lost).toEqual(["voter-1"]);
  });
});

describe("confirmZoneAssignment — fan-out atómico", () => {
  it("al confirmar, escribe chofer_asignado y electionDayControl.assignedDriverId", async () => {
    const { createZoneAndReserve, confirmZoneAssignment } = await loadFns();
    const created = (await createZoneAndReserve.run({
      data: {
        candidateId: CANDIDATE_ID,
        name: "Zona A",
        latitude: -25.32,
        longitude: -57.58,
        radiusMeters: 1000,
        maxVoters: 10,
        driverId: "driver-a",
        voterIds: ["voter-1"],
      },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;

    await confirmZoneAssignment.run({
      data: { candidateId: CANDIDATE_ID, zoneId: created.zoneId },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    const db = admin.firestore();
    const saved = await db
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("savedRecords")
      .doc("voter-1")
      .get();
    expect(saved.data()?.chofer_asignado).toBe("driver-a");

    const edc = await db
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("electionDayControl")
      .doc("voter-1")
      .get();
    expect(edc.data()?.assignedDriverId).toBe("driver-a");

    const zv = await db
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("driverZoneVoters")
      .doc("voter-1")
      .get();
    expect(zv.data()?.assignmentStatus).toBe("ASIGNADO");
  });
});

describe("cancelZone / changeZoneDriver", () => {
  it("cancela la zona y libera votantes RESERVADO+ASIGNADO sin pedir índice compuesto", async () => {
    const { createZoneAndReserve, confirmZoneAssignment, cancelZone } = await loadFns();
    await admin
      .firestore()
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("savedRecords")
      .doc("voter-2")
      .set({ nombre: "Otro Votante", cedula: "7654321", requiresPickup: true, latitude: -25.321, longitude: -57.581 });

    const created = (await createZoneAndReserve.run({
      data: {
        candidateId: CANDIDATE_ID,
        name: "Zona A",
        latitude: -25.32,
        longitude: -57.58,
        radiusMeters: 1000,
        maxVoters: 10,
        driverId: "driver-a",
        voterIds: ["voter-1", "voter-2"],
      },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;
    // Solo confirma voter-1: queda voter-2 en RESERVADO y voter-1 en ASIGNADO
    // — cancelZone tiene que liberar los 2 estados en la misma pasada (el
    // query usa `where(...).where('assignmentStatus','in',[...])`, que
    // tiene reglas de indexación distintas a una simple igualdad — este
    // test confirma que no hace falta crear un índice compuesto a mano).
    await confirmZoneAssignment.run({
      data: { candidateId: CANDIDATE_ID, zoneId: created.zoneId },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    const db = admin.firestore();
    // Revierte voter-2 a RESERVADO a mano para simular el caso mixto
    // (confirmZoneAssignment ya lo pasó a ASIGNADO arriba; para probar el
    // query `in` con ambos estados presentes, se fuerza uno de vuelta).
    await db
      .collection("candidates")
      .doc(CANDIDATE_ID)
      .collection("driverZoneVoters")
      .doc("voter-2")
      .set({ assignmentStatus: "RESERVADO", reservedUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 60000) }, { merge: true });

    const result = (await cancelZone.run({
      data: { candidateId: CANDIDATE_ID, zoneId: created.zoneId },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;

    expect(result.released.sort()).toEqual(["voter-1", "voter-2"]);

    const zone = await db.collection("candidates").doc(CANDIDATE_ID).collection("driverZones").doc(created.zoneId).get();
    expect(zone.data()?.status).toBe("cancelled");

    const v1 = await db.collection("candidates").doc(CANDIDATE_ID).collection("driverZoneVoters").doc("voter-1").get();
    expect(v1.data()?.assignmentStatus).toBe("CANCELADO");
    const saved1 = await db.collection("candidates").doc(CANDIDATE_ID).collection("savedRecords").doc("voter-1").get();
    expect(saved1.data()?.chofer_asignado).toBeUndefined();
  });

  it("changeZoneDriver reasigna chofer sin pedir índice compuesto", async () => {
    const { createZoneAndReserve, confirmZoneAssignment, changeZoneDriver } = await loadFns();
    const created = (await createZoneAndReserve.run({
      data: {
        candidateId: CANDIDATE_ID,
        name: "Zona A",
        latitude: -25.32,
        longitude: -57.58,
        radiusMeters: 1000,
        maxVoters: 10,
        driverId: "driver-a",
        voterIds: ["voter-1"],
      },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;
    await confirmZoneAssignment.run({
      data: { candidateId: CANDIDATE_ID, zoneId: created.zoneId },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    const result = (await changeZoneDriver.run({
      data: { candidateId: CANDIDATE_ID, zoneId: created.zoneId, newDriverId: "driver-b" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any)) as any;
    expect(result.changed).toEqual(["voter-1"]);

    const db = admin.firestore();
    const saved = await db.collection("candidates").doc(CANDIDATE_ID).collection("savedRecords").doc("voter-1").get();
    expect(saved.data()?.chofer_asignado).toBe("driver-b");
    const edc = await db.collection("candidates").doc(CANDIDATE_ID).collection("electionDayControl").doc("voter-1").get();
    expect(edc.data()?.assignedDriverId).toBe("driver-b");
  });
});

describe("firestore.rules — driverZoneVoters", () => {
  it("un cliente autenticado como campaign_admin NO puede escribir directo (todo pasa por Cloud Functions)", async () => {
    const ctx = testEnv.authenticatedContext(ADMIN_UID);
    const clientDb = ctx.firestore();
    await assertFails(
      clientDb
        .collection("candidates")
        .doc(CANDIDATE_ID)
        .collection("driverZoneVoters")
        .doc("voter-1")
        .set({ zoneId: "x", driverId: "driver-a", assignmentStatus: "ASIGNADO" })
    );
  });
});
