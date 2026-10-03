// AUDITORÍA 2026-10-03 — "Monto especial temporal por cajero". El admin
// fija, para UN cajero puntual, un monto por votante distinto al general
// de Finanzas > Configuración, vigente solo entre dos fechas/horas
// (comparado siempre contra la hora del SERVIDOR, nunca la del cliente).
// Prioridad: 1. INDIVIDUAL (monto ya autorizado al votante/excepción) >
// 2. ESPECIAL_CAJERO (vigente ahora) > 3. CONFIG_GENERAL (default).
//
// Ejemplo del pedido: general Gs. 100.000 → especial Luis Gs. 150.000 de
// 14:00 a 17:00 → durante la vigencia paga 150.000 → otro cajero sigue
// pagando 100.000 → al vencer, Luis vuelve automáticamente a 100.000, sin
// intervención manual. Para probarlo deterministamente (sin esperar
// horas reales), las ventanas se fijan relativas a `Date.now()` en el
// momento del test, no a horas de reloj fijas.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-cajero-monto-especial-test";
const CAND = "cand-cajero-monto-especial-test";

const ADMIN_UID = "admin-monto-especial-uid";
const CAJERO_LUIS_UID = "cajero-luis-monto-especial-uid"; // tendrá un monto especial VIGENTE ahora
const CAJERO_VENCIDO_UID = "cajero-vencido-monto-especial-uid"; // ventana ya pasada
const CAJERO_FUTURO_UID = "cajero-futuro-monto-especial-uid"; // ventana todavía no empezó
const CAJERO_SIN_ESPECIAL_UID = "cajero-sin-especial-uid"; // nunca configurado

const CUENTA_LUIS = "cuenta-luis-test";
const CUENTA_VENCIDO = "cuenta-vencido-test";
const CUENTA_FUTURO = "cuenta-futuro-test";
const CUENTA_SIN_ESPECIAL = "cuenta-sin-especial-test";

const MONTO_GENERAL = 100000;
const MONTO_ESPECIAL = 150000;

const CI_LUIS = "6000001";
const CI_VENCIDO = "6000002";
const CI_FUTURO = "6000003";
const CI_SIN_ESPECIAL = "6000004";
const CI_INDIVIDUAL = "6000005"; // "nuestro", YA con ayuda aprobada — registrarEgresoCajero (siempre INDIVIDUAL)

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad-especial" });
  await db.collection("candidates").doc(CAND).collection("config").doc("financeSettings").set({ maxVoterAssistanceAmount: MONTO_GENERAL });

  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID).set({ role: "campaign_admin", nombre: "Admin Test" });

  const ahora = Date.now();
  const unaHora = 60 * 60 * 1000;

  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_LUIS_UID).set({
    role: "cashier", nombre: "Luis Peralta Test",
    specialAmount: MONTO_ESPECIAL,
    specialAmountFrom: admin.firestore.Timestamp.fromMillis(ahora - unaHora), // empezó hace 1h
    specialAmountTo: admin.firestore.Timestamp.fromMillis(ahora + unaHora), // termina en 1h — VIGENTE ahora
    specialAmountConfiguredBy: ADMIN_UID,
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_VENCIDO_UID).set({
    role: "cashier", nombre: "Cajero Vencido Test",
    specialAmount: MONTO_ESPECIAL,
    specialAmountFrom: admin.firestore.Timestamp.fromMillis(ahora - 3 * unaHora),
    specialAmountTo: admin.firestore.Timestamp.fromMillis(ahora - unaHora), // terminó hace 1h — VENCIDO
    specialAmountConfiguredBy: ADMIN_UID,
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_FUTURO_UID).set({
    role: "cashier", nombre: "Cajero Futuro Test",
    specialAmount: MONTO_ESPECIAL,
    specialAmountFrom: admin.firestore.Timestamp.fromMillis(ahora + unaHora), // empieza en 1h — TODAVÍA NO
    specialAmountTo: admin.firestore.Timestamp.fromMillis(ahora + 3 * unaHora),
    specialAmountConfiguredBy: ADMIN_UID,
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_SIN_ESPECIAL_UID).set({
    role: "cashier", nombre: "Cajero Sin Especial Test",
  });

  for (const [cuentaId, uid] of [
    [CUENTA_LUIS, CAJERO_LUIS_UID],
    [CUENTA_VENCIDO, CAJERO_VENCIDO_UID],
    [CUENTA_FUTURO, CAJERO_FUTURO_UID],
    [CUENTA_SIN_ESPECIAL, CAJERO_SIN_ESPECIAL_UID],
  ] as const) {
    await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(cuentaId).set({
      candidateId: CAND, responsibleUserId: uid, name: `Cuenta ${cuentaId}`, balance: 1000000, currency: "PYG", status: "active",
    });
  }

  for (const [uid, ci, nombre] of [
    [CAJERO_LUIS_UID, CI_LUIS, "Votante Luis Test"],
    [CAJERO_VENCIDO_UID, CI_VENCIDO, "Votante Vencido Test"],
    [CAJERO_FUTURO_UID, CI_FUTURO, "Votante Futuro Test"],
    [CAJERO_SIN_ESPECIAL_UID, CI_SIN_ESPECIAL, "Votante Sin Especial Test"],
  ] as const) {
    await db.collection("candidates").doc(CAND).collection("savedRecords").doc(`rec-${ci}`).set({ uid, cedula: ci, nombre });
    await db.collection("voters").doc(`voter-${ci}`).set({ cedula: ci, localidad: "test-localidad-especial", nombre });
  }

  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-individual").set({
    uid: CAJERO_LUIS_UID, cedula: CI_INDIVIDUAL, nombre: "Votante Individual Test",
    assistanceStatus: "approved", approvedAmount: 70000,
  });
  await db.collection("voters").doc("voter-individual").set({ cedula: CI_INDIVIDUAL, localidad: "test-localidad-especial", nombre: "Votante Individual Test" });
}, 30000);

async function loadFns() {
  return await import("../src/cashierFunds.js");
}

describe("configurarMontoEspecialCajero", () => {
  it("DENEGADO para un caller que no es admin", async () => {
    const fns = await loadFns();
    await expect(
      fns.configurarMontoEspecialCajero.run({
        data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: 999, fromMillis: Date.now(), toMillis: Date.now() + 1000, operationId: "op-no-admin" },
        auth: { uid: CAJERO_SIN_ESPECIAL_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/campaign_admin\/finance_admin/);
  });

  it("DENEGADO si el usuario destino no es cajero", async () => {
    const fns = await loadFns();
    await expect(
      fns.configurarMontoEspecialCajero.run({
        data: { candidateId: CAND, cashierUid: ADMIN_UID, specialAmount: 999, fromMillis: Date.now(), toMillis: Date.now() + 1000, operationId: "op-no-cajero" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no es un cajero/);
  });

  it("DENEGADO si Hasta no es posterior a Desde", async () => {
    const fns = await loadFns();
    const ahora = Date.now();
    await expect(
      fns.configurarMontoEspecialCajero.run({
        data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: 999, fromMillis: ahora, toMillis: ahora - 1000, operationId: "op-rango-invalido" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/Hasta debe ser posterior/);
  });

  it("admin configura un monto especial válido", async () => {
    const fns = await loadFns();
    const ahora = Date.now();
    const r: any = await fns.configurarMontoEspecialCajero.run({
      data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: 123000, fromMillis: ahora, toMillis: ahora + 1000, operationId: "op-set-ok" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect(r.ok).toBe(true);

    const db = admin.firestore();
    const snap = await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_SIN_ESPECIAL_UID).get();
    expect(snap.data()!.specialAmount).toBe(123000);
    expect(snap.data()!.specialAmountConfiguredBy).toBe(ADMIN_UID);

    // lo deja como estaba (sin especial) para no afectar los tests de abajo
    await fns.configurarMontoEspecialCajero.run({
      data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: null, fromMillis: null, toMillis: null, operationId: "op-set-clear-cleanup" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
  });

  it("admin quita un monto especial configurado (limpia los 5 campos)", async () => {
    const fns = await loadFns();
    const ahora = Date.now();
    await fns.configurarMontoEspecialCajero.run({
      data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: 50000, fromMillis: ahora, toMillis: ahora + 1000, operationId: "op-set-para-quitar" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    await fns.configurarMontoEspecialCajero.run({
      data: { candidateId: CAND, cashierUid: CAJERO_SIN_ESPECIAL_UID, specialAmount: null, fromMillis: null, toMillis: null, operationId: "op-quitar" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    const db = admin.firestore();
    const snap = await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_SIN_ESPECIAL_UID).get();
    expect(snap.data()!.specialAmount).toBeNull();
    expect(snap.data()!.specialAmountFrom).toBeNull();
    expect(snap.data()!.specialAmountTo).toBeNull();
    expect(snap.data()!.specialAmountConfiguredBy).toBeNull();
  });
});

describe("Prioridad del monto — buscarBeneficiarioCajero (escenario B)", () => {
  it("Cajero con especial VIGENTE ahora ve el monto especial, no el general", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LUIS, ci: CI_LUIS },
      auth: { uid: CAJERO_LUIS_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("B");
    expect(r.maxVoterAssistanceAmount).toBe(MONTO_ESPECIAL);
    expect(r.fuenteMonto).toBe("ESPECIAL_CAJERO");
    expect(r.vigenciaHastaMillis).toBeTruthy();
  });

  it("Cajero con especial YA VENCIDO cae automáticamente al monto general", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_VENCIDO, ci: CI_VENCIDO },
      auth: { uid: CAJERO_VENCIDO_UID, token: {} as any },
    } as any);
    expect(r.maxVoterAssistanceAmount).toBe(MONTO_GENERAL);
    expect(r.fuenteMonto).toBe("CONFIG_GENERAL");
  });

  it("Cajero con especial que TODAVÍA NO empezó usa el monto general", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_FUTURO, ci: CI_FUTURO },
      auth: { uid: CAJERO_FUTURO_UID, token: {} as any },
    } as any);
    expect(r.maxVoterAssistanceAmount).toBe(MONTO_GENERAL);
    expect(r.fuenteMonto).toBe("CONFIG_GENERAL");
  });

  it("Otro cajero (sin monto especial configurado) sigue pagando el monto general", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_SIN_ESPECIAL, ci: CI_SIN_ESPECIAL },
      auth: { uid: CAJERO_SIN_ESPECIAL_UID, token: {} as any },
    } as any);
    expect(r.maxVoterAssistanceAmount).toBe(MONTO_GENERAL);
    expect(r.fuenteMonto).toBe("CONFIG_GENERAL");
  });
});

describe("Prioridad del monto — aprobarYPagarAyudaCajero cobra lo que corresponde", () => {
  it("Durante la vigencia, Luis paga el monto ESPECIAL — auditado con fuenteMonto y vigencia", async () => {
    const fns = await loadFns();
    const r: any = await fns.aprobarYPagarAyudaCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LUIS, beneficiaryCI: CI_LUIS, operationId: "op-luis-especial" },
      auth: { uid: CAJERO_LUIS_UID, token: {} as any },
    } as any);
    expect(r.approvedAmount).toBe(MONTO_ESPECIAL);
    expect(r.fuenteMonto).toBe("ESPECIAL_CAJERO");

    const db = admin.firestore();
    const movSnap = await db.collection("candidates").doc(CAND).collection("cashierMovements").doc(r.movementId).get();
    expect(movSnap.data()!.fuenteMonto).toBe("ESPECIAL_CAJERO");
    expect(movSnap.data()!.vigenciaDesde).toBeTruthy();
    expect(movSnap.data()!.vigenciaHasta).toBeTruthy();
    expect(movSnap.data()!.montoEspecialConfiguradoPor).toBe(ADMIN_UID);

    const cuentaSnap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_LUIS).get();
    expect(cuentaSnap.data()!.balance).toBe(1000000 - MONTO_ESPECIAL);
  });

  it("Otro cajero (sin especial vigente) sigue pagando el monto GENERAL — auditado CONFIG_GENERAL", async () => {
    const fns = await loadFns();
    const r: any = await fns.aprobarYPagarAyudaCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_SIN_ESPECIAL, beneficiaryCI: CI_SIN_ESPECIAL, operationId: "op-otro-general" },
      auth: { uid: CAJERO_SIN_ESPECIAL_UID, token: {} as any },
    } as any);
    expect(r.approvedAmount).toBe(MONTO_GENERAL);
    expect(r.fuenteMonto).toBe("CONFIG_GENERAL");

    const db = admin.firestore();
    const cuentaSnap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_SIN_ESPECIAL).get();
    expect(cuentaSnap.data()!.balance).toBe(1000000 - MONTO_GENERAL);
  });

  it("Cajero con ventana ya VENCIDA paga el monto GENERAL, no el especial expirado (vuelve automáticamente, sin intervención manual)", async () => {
    const fns = await loadFns();
    const r: any = await fns.aprobarYPagarAyudaCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_VENCIDO, beneficiaryCI: CI_VENCIDO, operationId: "op-vencido-general" },
      auth: { uid: CAJERO_VENCIDO_UID, token: {} as any },
    } as any);
    expect(r.approvedAmount).toBe(MONTO_GENERAL);
    expect(r.fuenteMonto).toBe("CONFIG_GENERAL");
  });
});

describe("registrarEgresoCajero — siempre paga el monto INDIVIDUAL ya autorizado, nunca el especial del cajero", () => {
  it("fuenteMonto queda auditado como INDIVIDUAL aunque el cajero tenga un monto especial vigente", async () => {
    const fns = await loadFns();
    const r: any = await fns.registrarEgresoCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LUIS, amount: 70000, concept: "Ayuda", beneficiaryCI: CI_INDIVIDUAL, operationId: "op-individual-no-especial" },
      auth: { uid: CAJERO_LUIS_UID, token: {} as any },
    } as any);
    const db = admin.firestore();
    const movSnap = await db.collection("candidates").doc(CAND).collection("cashierMovements").doc(r.movementId).get();
    expect(movSnap.data()!.fuenteMonto).toBe("INDIVIDUAL");
    expect(movSnap.data()!.amount).toBe(70000); // NO 150000 — el monto individual ya aprobado, no el especial del cajero
  });
});
