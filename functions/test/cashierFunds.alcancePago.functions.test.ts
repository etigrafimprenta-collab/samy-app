// AUDITORÍA 2026-10-03 — "Alcance de pago autorizado" (Finanzas–Cajero/a).
// 3 modalidades guardadas en candidates/{id}/users/{uid}.paymentScope,
// reusando el MISMO campo .local que ya usa Mesa/Local:
//   'local'            → solo votantes cuyo .local coincide con el .local
//                          del cajero.
//   'all_our_voters'   → cualquier "nuestro" votante, nunca el padrón
//                          general.
//   ausente/'full_padron' → sin restricción (comportamiento histórico,
//                          default para no romper cajeros existentes).
// Server-side SIEMPRE (el cliente nunca puede eludirlo editando la
// petición) — se verifica en buscarBeneficiarioCajero, registrarEgresoCajero,
// aprobarYPagarAyudaCajero y solicitarExcepcionBeneficiario.
//
// Pruebas obligatorias (pedido explícito del usuario):
//   1. Cajero LOCAL intenta pagar votante de otro local → bloqueado.
//   2. Cajero LOCAL paga votante de su local → permitido.
//   3. Cajero TODOS A paga cualquier votante nuestro → permitido.
//   4. Cajero TODOS B encuentra una CI del padrón que no es nuestra →
//      debe ingresar correctamente al flujo excepcional definido.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-cajero-alcance-pago-test";
const CAND = "cand-cajero-alcance-pago-test";

const CAJERO_LOCAL_UID = "cajero-local-uid";
const CAJERO_TODOS_A_UID = "cajero-todos-a-uid";
const CAJERO_TODOS_B_UID = "cajero-todos-b-uid";
const CAJERO_SIN_SCOPE_UID = "cajero-sin-scope-uid"; // legacy, paymentScope ausente

const CUENTA_LOCAL = "cuenta-local-test";
const CUENTA_TODOS_A = "cuenta-todos-a-test";
const CUENTA_TODOS_B = "cuenta-todos-b-test";
const CUENTA_SIN_SCOPE = "cuenta-sin-scope-test";

const LOCAL_A = "ESCUELA LOCAL A";
const LOCAL_B = "ESCUELA LOCAL B";

const CI_EN_LOCAL_A = "5000001"; // "nuestro", local A, ya con ayuda aprobada
const CI_EN_LOCAL_B = "5000002"; // "nuestro", local B, ya con ayuda aprobada
const CI_PADRON_GENERAL = "5000003"; // NO es "nuestro", solo padrón
const CI_SIN_AYUDA_LOCAL_A = "5000004"; // "nuestro", local A, SIN ayuda aprobada aún
const CI_SIN_AYUDA_LOCAL_B = "5000005"; // "nuestro", local B, SIN ayuda aprobada aún

const MONTO_APROBADO = 50000;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad-alcance" });
  await db.collection("candidates").doc(CAND).collection("config").doc("financeSettings").set({ maxVoterAssistanceAmount: MONTO_APROBADO });

  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_LOCAL_UID).set({
    role: "cashier", nombre: "Cajero Local Test", local: LOCAL_A, paymentScope: "local",
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_TODOS_A_UID).set({
    role: "cashier", nombre: "Cajero Todos A Test", paymentScope: "all_our_voters",
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_TODOS_B_UID).set({
    role: "cashier", nombre: "Cajero Todos B Test", paymentScope: "full_padron",
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_SIN_SCOPE_UID).set({
    role: "cashier", nombre: "Cajero Sin Scope Test", // sin paymentScope — legacy
  });

  for (const [cuentaId, uid] of [
    [CUENTA_LOCAL, CAJERO_LOCAL_UID],
    [CUENTA_TODOS_A, CAJERO_TODOS_A_UID],
    [CUENTA_TODOS_B, CAJERO_TODOS_B_UID],
    [CUENTA_SIN_SCOPE, CAJERO_SIN_SCOPE_UID],
  ] as const) {
    await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(cuentaId).set({
      candidateId: CAND, responsibleUserId: uid, name: `Cuenta ${cuentaId}`, balance: 1000000, currency: "PYG", status: "active",
    });
  }

  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-local-a").set({
    uid: CAJERO_LOCAL_UID, cedula: CI_EN_LOCAL_A, nombre: "Votante Local A", local: LOCAL_A,
    assistanceStatus: "approved", approvedAmount: MONTO_APROBADO,
  });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-local-b").set({
    uid: CAJERO_LOCAL_UID, cedula: CI_EN_LOCAL_B, nombre: "Votante Local B", local: LOCAL_B,
    assistanceStatus: "approved", approvedAmount: MONTO_APROBADO,
  });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-sin-ayuda-a").set({
    uid: CAJERO_LOCAL_UID, cedula: CI_SIN_AYUDA_LOCAL_A, nombre: "Votante Sin Ayuda A", local: LOCAL_A,
  });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-sin-ayuda-b").set({
    uid: CAJERO_LOCAL_UID, cedula: CI_SIN_AYUDA_LOCAL_B, nombre: "Votante Sin Ayuda B", local: LOCAL_B,
  });

  await db.collection("voters").doc("voter-local-a").set({ cedula: CI_EN_LOCAL_A, localidad: "test-localidad-alcance", nombre: "Votante Local A", local: LOCAL_A });
  await db.collection("voters").doc("voter-local-b").set({ cedula: CI_EN_LOCAL_B, localidad: "test-localidad-alcance", nombre: "Votante Local B", local: LOCAL_B });
  await db.collection("voters").doc("voter-padron-general").set({ cedula: CI_PADRON_GENERAL, localidad: "test-localidad-alcance", nombre: "Votante Padrón General" });
  await db.collection("voters").doc("voter-sin-ayuda-a").set({ cedula: CI_SIN_AYUDA_LOCAL_A, localidad: "test-localidad-alcance", nombre: "Votante Sin Ayuda A", local: LOCAL_A });
  await db.collection("voters").doc("voter-sin-ayuda-b").set({ cedula: CI_SIN_AYUDA_LOCAL_B, localidad: "test-localidad-alcance", nombre: "Votante Sin Ayuda B", local: LOCAL_B });
}, 30000);

async function loadFns() {
  return await import("../src/cashierFunds.js");
}

describe("buscarBeneficiarioCajero — alcance de pago", () => {
  it("Cajero LOCAL buscando votante de OTRO local → FUERA_DE_ALCANCE", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LOCAL, ci: CI_EN_LOCAL_B },
      auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("FUERA_DE_ALCANCE");
  });

  it("Cajero LOCAL buscando votante de SU local → escenario normal (A)", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LOCAL, ci: CI_EN_LOCAL_A },
      auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("A");
  });

  it("Cajero TODOS (A) buscando cualquier 'nuestro' votante (otro local) → escenario normal (A)", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_TODOS_A, ci: CI_EN_LOCAL_B },
      auth: { uid: CAJERO_TODOS_A_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("A");
  });

  it("Cajero TODOS (A) buscando una CI del padrón que NO es nuestra → FUERA_DE_ALCANCE (sin flujo de excepción)", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_TODOS_A, ci: CI_PADRON_GENERAL },
      auth: { uid: CAJERO_TODOS_A_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("FUERA_DE_ALCANCE");
  });

  it("Cajero TODOS (B) buscando una CI del padrón que NO es nuestra → escenario C (flujo excepcional)", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_TODOS_B, ci: CI_PADRON_GENERAL },
      auth: { uid: CAJERO_TODOS_B_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("C");
  });

  it("Cajero SIN paymentScope (legacy) sigue comportándose como Todos (B) — no se rompen asignaciones actuales", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_SIN_SCOPE, ci: CI_PADRON_GENERAL },
      auth: { uid: CAJERO_SIN_SCOPE_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("C");
  });
});

describe("registrarEgresoCajero — alcance de pago", () => {
  it("Cajero LOCAL intenta pagar votante de OTRO local → bloqueado", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: {
          candidateId: CAND, cashAccountId: CUENTA_LOCAL, amount: MONTO_APROBADO,
          concept: "Ayuda", beneficiaryCI: CI_EN_LOCAL_B, operationId: "op-local-bloqueado",
        },
        auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/alcance de pago autorizado/);

    const db = admin.firestore();
    const accSnap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_LOCAL).get();
    expect(accSnap.data()!.balance).toBe(1000000); // sin cambios
  });

  it("Cajero LOCAL paga votante de SU local → permitido, y queda auditado como LOCAL", async () => {
    const fns = await loadFns();
    const r: any = await fns.registrarEgresoCajero.run({
      data: {
        candidateId: CAND, cashAccountId: CUENTA_LOCAL, amount: MONTO_APROBADO,
        concept: "Ayuda", beneficiaryCI: CI_EN_LOCAL_A, operationId: "op-local-permitido",
      },
      auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
    } as any);
    expect(r.balanceAfter).toBe(1000000 - MONTO_APROBADO);

    const db = admin.firestore();
    const movSnap = await db.collection("candidates").doc(CAND).collection("cashierMovements").doc(r.movementId).get();
    expect(movSnap.data()!.paymentScopeAtPayment).toBe("LOCAL");
    expect(movSnap.data()!.paymentScopeLocalAtPayment).toBe(LOCAL_A);
  });

  it("Cajero TODOS (A) paga cualquier votante nuestro (otro local) → permitido, auditado como TODOS_A", async () => {
    const fns = await loadFns();
    const r: any = await fns.registrarEgresoCajero.run({
      data: {
        candidateId: CAND, cashAccountId: CUENTA_TODOS_A, amount: MONTO_APROBADO,
        concept: "Ayuda", beneficiaryCI: CI_EN_LOCAL_B, operationId: "op-todos-a-permitido",
      },
      auth: { uid: CAJERO_TODOS_A_UID, token: {} as any },
    } as any);
    expect(r.balanceAfter).toBe(1000000 - MONTO_APROBADO);

    const db = admin.firestore();
    const movSnap = await db.collection("candidates").doc(CAND).collection("cashierMovements").doc(r.movementId).get();
    expect(movSnap.data()!.paymentScopeAtPayment).toBe("TODOS_A");
  });

  it("Cajero TODOS (A) no puede pagar a alguien del padrón general (fuera de alcance, ni siquiera llega al chequeo de excepción)", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: {
          candidateId: CAND, cashAccountId: CUENTA_TODOS_A, amount: 10000,
          concept: "Ayuda", beneficiaryCI: CI_PADRON_GENERAL, operationId: "op-todos-a-padron-bloqueado",
        },
        auth: { uid: CAJERO_TODOS_A_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/alcance de pago autorizado/);
  });
});

describe("aprobarYPagarAyudaCajero — alcance de pago", () => {
  it("Cajero LOCAL intenta aprobar-y-pagar a votante SIN ayuda de OTRO local → bloqueado", async () => {
    const fns = await loadFns();
    await expect(
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_LOCAL, beneficiaryCI: CI_SIN_AYUDA_LOCAL_B, operationId: "op-aprobar-local-bloqueado" },
        auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/alcance de pago autorizado/);
  });

  it("Cajero LOCAL aprueba-y-paga a votante SIN ayuda de SU local → permitido", async () => {
    const fns = await loadFns();
    const r: any = await fns.aprobarYPagarAyudaCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_LOCAL, beneficiaryCI: CI_SIN_AYUDA_LOCAL_A, operationId: "op-aprobar-local-permitido" },
      auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
    } as any);
    expect(r.approvedAmount).toBe(MONTO_APROBADO);
  });
});

describe("solicitarExcepcionBeneficiario — alcance de pago", () => {
  it("Cajero LOCAL no puede solicitar una excepción (su alcance no incluye el padrón general)", async () => {
    const fns = await loadFns();
    await expect(
      fns.solicitarExcepcionBeneficiario.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_LOCAL, beneficiaryCI: CI_PADRON_GENERAL, operationId: "op-solicitar-local-bloqueado" },
        auth: { uid: CAJERO_LOCAL_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no incluye el padrón general/);
  });

  it("Cajero TODOS (A) tampoco puede solicitar una excepción", async () => {
    const fns = await loadFns();
    await expect(
      fns.solicitarExcepcionBeneficiario.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_TODOS_A, beneficiaryCI: CI_PADRON_GENERAL, operationId: "op-solicitar-todos-a-bloqueado" },
        auth: { uid: CAJERO_TODOS_A_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no incluye el padrón general/);
  });

  it("Cajero TODOS (B) puede solicitar la excepción normalmente — entra correctamente al flujo excepcional", async () => {
    const fns = await loadFns();
    const r: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_TODOS_B, beneficiaryCI: CI_PADRON_GENERAL, operationId: "op-solicitar-todos-b-ok" },
      auth: { uid: CAJERO_TODOS_B_UID, token: {} as any },
    } as any);
    expect(r.exceptionId).toBeTruthy();
  });
});
