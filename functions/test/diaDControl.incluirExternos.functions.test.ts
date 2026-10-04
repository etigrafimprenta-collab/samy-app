// MEJORA 2026-10-04 (post-aprobación original) — "alzar como votados
// Beneficiarios externos/no propios": opt-in explícito `incluirExternos`
// en verificarBeneficiariosYMarcarVoto. Por default (ausente/false) el
// comportamiento YA aprobado (excluir externos) sigue intacto — estos
// tests cubren SOLO el camino nuevo, activado a propósito.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-incluir-externos-test";
const CAND = "cand-incluir-externos-test";
const ADMIN_UID = "admin-ie-uid";
const VOTER_ID_1 = "voter-externo-1";
const VOTER_ID_2 = "voter-externo-2";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad" });
  await db.collection("candidates").doc(CAND).collection("diaD").doc("current").set({ enabled: true });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID)
    .set({ role: "campaign_admin", nombre: "Admin Test" });

  // Padrón raíz real — estos 2 "externos" SÍ existen en /voters (por eso
  // se los pudo pagar con autorización excepcional), pero NO tienen
  // ningún savedRecords todavía.
  await db.collection("voters").doc(VOTER_ID_1).set({
    cedula: "5551001", nombre: "EXTERNO UNO", local: "Escuela Externos", mesa: "9", seccional: "12", orden: "50", localidad: "test-localidad",
  });
  await db.collection("voters").doc(VOTER_ID_2).set({
    cedula: "5551002", nombre: "EXTERNO DOS", local: "Escuela Externos", mesa: "9", seccional: "12", orden: "51", localidad: "test-localidad",
  });

  await db.collection("candidates").doc(CAND).collection("cashierMovements").doc("mov-ext-1").set({
    type: "expense", status: "confirmed", beneficiaryCI: "5551001", beneficiaryName: "Externo Uno", beneficiaryVoterId: VOTER_ID_1,
  });
  await db.collection("candidates").doc(CAND).collection("cashierMovements").doc("mov-ext-2").set({
    type: "expense", status: "confirmed", beneficiaryCI: "5551002", beneficiaryName: "Externo Dos", beneficiaryVoterId: VOTER_ID_2,
  });
}, 60000);

async function loadFns() {
  return await import("../src/diaDControl.js");
}

describe("incluirExternos — opt-in explícito, comportamiento default intacto", () => {
  it("sin incluirExternos (default): el externo queda excluido, sin campos nuevos en la respuesta", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: true },
      auth: { uid: ADMIN_UID, token: {} },
    } as any);
    expect(r.beneficiariosExternos).toBe(2);
    expect(r.incluirExternos).toBe(false);
    expect(r.externosACrearYMarcar).toBeUndefined();
  });

  it("incluirExternos:true + dryRun — cero escrituras, muestra cuántos se crearían", async () => {
    const db = admin.firestore();
    const antes = (await db.collection("candidates").doc(CAND).collection("savedRecords").get()).size;
    expect(antes).toBe(0);

    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: true, incluirExternos: true },
      auth: { uid: ADMIN_UID, token: {} },
    } as any);
    expect(r.incluirExternos).toBe(true);
    expect(r.externosACrearYMarcar).toBe(2);
    expect(r.externosSinDatosDeVotante).toBe(0);

    const despues = (await db.collection("candidates").doc(CAND).collection("savedRecords").get()).size;
    expect(despues).toBe(0); // sigue en cero, dryRun no escribe nada
  });

  it("incluirExternos:true + ejecución — crea savedRecords sin dueño (uid:null) y marca voted", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: false, incluirExternos: true },
      auth: { uid: ADMIN_UID, token: {} },
    } as any);
    expect(r.externosCreadosYMarcados).toBe(2);
    expect(r.externosYaResueltosPorOtraVia).toBe(0);
    expect(r.erroresExternos).toBe(0);

    const db = admin.firestore();
    const snap = await db.collection("candidates").doc(CAND).collection("savedRecords").where("cedula", "==", "5551001").get();
    expect(snap.size).toBe(1); // nunca 2 — una sola creación real
    const nuevo = snap.docs[0];
    expect(nuevo.data().uid).toBeNull(); // sin dueño, pedido explícito
    expect(nuevo.data().voterId).toBe(VOTER_ID_1);
    expect(nuevo.data().local).toBe("Escuela Externos");
    expect(nuevo.data().mesa).toBe("9");
    expect(nuevo.data().seccional).toBe("12");
    expect(nuevo.data().nombre).toBe("EXTERNO UNO"); // viene del padrón real, no del movimiento
    expect(nuevo.data().creadoDesde).toBe("verificarBeneficiariosYMarcarVoto");
    expect(nuevo.data().creadoPor).toBe(ADMIN_UID);

    const ctrlSnap = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(nuevo.id).get();
    expect(ctrlSnap.data()!.status).toBe("voted");
    expect(ctrlSnap.data()!.assignedLeaderId).toBeNull(); // sin dirigente, pedido explícito
  });

  it("re-consultar (dryRun, incluirExternos:true) — ya no son externos, son 'nuestros' y ya votaron", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: true, incluirExternos: true },
      auth: { uid: ADMIN_UID, token: {} },
    } as any);
    expect(r.beneficiariosExternos).toBe(0);
    expect(r.externosACrearYMarcar).toBe(0);
    expect(r.yaVotaron).toBe(2);
    expect(r.pendientesAMarcar).toBe(0);
  });

  it("re-ejecutar (incluirExternos:true) — idempotente, 0 creados de nuevo, 0 errores", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: false, incluirExternos: true },
      auth: { uid: ADMIN_UID, token: {} },
    } as any);
    expect(r.externosCreadosYMarcados).toBe(0);
    expect(r.erroresExternos).toBe(0);
  });
});

describe("incluirExternos — condición de carrera: 2 ejecuciones simultáneas sobre el MISMO externo nunca duplican", () => {
  const VOTER_ID_3 = "voter-externo-3";
  const CAND2 = "cand-incluir-externos-race-test";
  const ADMIN2 = "admin-ie-race-uid";

  beforeAll(async () => {
    const db = admin.firestore();
    await db.collection("candidates").doc(CAND2).set({ name: "Candidato Carrera", localidad: "test-localidad" });
    await db.collection("candidates").doc(CAND2).collection("diaD").doc("current").set({ enabled: true });
    await db.collection("candidates").doc(CAND2).collection("users").doc(ADMIN2)
      .set({ role: "campaign_admin", nombre: "Admin Carrera" });
    await db.collection("voters").doc(VOTER_ID_3).set({
      cedula: "5551003", nombre: "EXTERNO TRES", local: "Escuela Carrera", mesa: "4", seccional: "7", orden: "1", localidad: "test-localidad",
    });
    await db.collection("candidates").doc(CAND2).collection("cashierMovements").doc("mov-ext-3").set({
      type: "expense", status: "confirmed", beneficiaryCI: "5551003", beneficiaryName: "Externo Tres", beneficiaryVoterId: VOTER_ID_3,
    });
  });

  it("2 ejecuciones casi simultáneas -> exactamente 1 savedRecords creado, nunca 2", async () => {
    const fns = await loadFns();
    const [r1, r2] = await Promise.all([
      fns.verificarBeneficiariosYMarcarVoto.run({
        data: { candidateId: CAND2, dryRun: false, incluirExternos: true },
        auth: { uid: ADMIN2, token: {} },
      } as any),
      fns.verificarBeneficiariosYMarcarVoto.run({
        data: { candidateId: CAND2, dryRun: false, incluirExternos: true },
        auth: { uid: ADMIN2, token: {} },
      } as any),
    ]);
    const creadosTotal = (r1 as any).externosCreadosYMarcados + (r2 as any).externosCreadosYMarcados;
    const yaResueltosTotal = (r1 as any).externosYaResueltosPorOtraVia + (r2 as any).externosYaResueltosPorOtraVia;
    expect(creadosTotal).toBe(1); // exactamente UNA de las 2 corridas ganó la carrera
    expect(yaResueltosTotal).toBe(1); // la otra detectó que ya existía y se abstuvo

    const db = admin.firestore();
    const snap = await db.collection("candidates").doc(CAND2).collection("savedRecords").where("cedula", "==", "5551003").get();
    expect(snap.size).toBe(1); // NUNCA 2 — la transacción de re-chequeo lo garantiza
  });
});
