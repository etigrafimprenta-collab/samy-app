// AUDITORÍA 2026-10-03 — escenario B: "nuestro" votante sin ayuda
// individual todavía. aprobarYPagarAyudaCajero aprueba (monto DEFAULT de
// Finanzas > Configuración, nunca del cliente) y paga en una sola
// operación atómica. Incluye la prueba de carrera explícitamente pedida:
// 2 confirmaciones casi simultáneas para el MISMO beneficiario no deben
// descontar el saldo dos veces.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-cajero-aprobar-pagar-test";
const CAND = "cand-cajero-aprobar-pagar-test";

const CAJERO_UID = "cajero-aprobar-uid";
const OTRO_CAJERO_UID = "otro-cajero-aprobar-uid";
const ADMIN_UID = "admin-aprobar-uid";

const CUENTA_ID = "cuenta-aprobar-test";
const CUENTA2_ID = "cuenta2-aprobar-test"; // segunda cuenta para la prueba de carrera

const CI_B = "4000002"; // "nuestro", sin ayuda aprobada
const CI_YA_APROBADO = "4000005"; // "nuestro", YA con ayuda aprobada (no debe poder usar esta función)
const CI_AJENO = "4000006"; // no es "nuestro"

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad" });
  await db.collection("candidates").doc(CAND).collection("config").doc("financeSettings").set({ maxVoterAssistanceAmount: 100000 });

  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_UID).set({ role: "dirigente", nombre: "Cajero Test", isFieldCashier: true });
  await db.collection("candidates").doc(CAND).collection("users").doc(OTRO_CAJERO_UID).set({ role: "dirigente", nombre: "Otro Cajero Test", isFieldCashier: true });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID).set({ role: "campaign_admin", nombre: "Admin Test" });

  await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_ID).set({
    candidateId: CAND, responsibleUserId: CAJERO_UID, name: "Cajero Test", balance: 1000000, currency: "PYG", status: "active",
  });
  // Segunda cuenta — misma localidad/candidato, para la prueba de carrera
  // "2 cajeros distintos confirmando casi al mismo tiempo para el MISMO
  // beneficiario" (cada cajero paga desde su propia cuenta).
  await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA2_ID).set({
    candidateId: CAND, responsibleUserId: OTRO_CAJERO_UID, name: "Otro Cajero Test", balance: 1000000, currency: "PYG", status: "active",
  });

  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-b").set({
    uid: CAJERO_UID, cedula: CI_B, nombre: "Votante B Test",
  });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-aprobado").set({
    uid: CAJERO_UID, cedula: CI_YA_APROBADO, nombre: "Votante Ya Aprobado", assistanceStatus: "approved", approvedAmount: 70000,
  });

  await db.collection("voters").doc("voter-b").set({ cedula: CI_B, localidad: "test-localidad", nombre: "Votante B Test" });
  await db.collection("voters").doc("voter-aprobado").set({ cedula: CI_YA_APROBADO, localidad: "test-localidad", nombre: "Votante Ya Aprobado" });
  await db.collection("voters").doc("voter-ajeno").set({ cedula: CI_AJENO, localidad: "test-localidad", nombre: "Votante Ajeno" });
}, 30000);

async function loadFns() {
  return await import("../src/cashierFunds.js");
}

describe("buscarBeneficiarioCajero — escenario B ahora trae el monto sugerido", () => {
  it("trae maxVoterAssistanceAmount de Finanzas > Configuración", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_B },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("B");
    expect(r.maxVoterAssistanceAmount).toBe(100000);
  });
});

describe("aprobarYPagarAyudaCajero", () => {
  it("DENEGADO para un votante que NO es 'nuestro' (usar excepción, no esta vía)", async () => {
    const fns = await loadFns();
    await expect(
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_AJENO, operationId: "op-ajeno" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no es uno de nuestros/);
  });

  it("DENEGADO para un votante que YA tiene ayuda aprobada (usar pago normal)", async () => {
    const fns = await loadFns();
    await expect(
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_YA_APROBADO, operationId: "op-ya-aprobado" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/ya tiene una ayuda aprobada/);
  });

  it("CONFIRMAR PAGO: aprueba con el monto DEFAULT y paga en un solo paso — saldo baja exactamente ese monto", async () => {
    const fns = await loadFns();
    const r: any = await fns.aprobarYPagarAyudaCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_B, operationId: "op-confirmar-1" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.approvedAmount).toBe(100000);
    expect(r.balanceAfter).toBe(1000000 - 100000);

    const db = admin.firestore();
    const recSnap = await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-b").get();
    expect(recSnap.data()!.assistanceStatus).toBe("approved");
    expect(recSnap.data()!.approvedAmount).toBe(100000);
    expect(recSnap.data()!.approvedBy).toBe(CAJERO_UID); // auditoría: quién confirmó
  });

  it("un SEGUNDO intento (ya aprobado y pagado) está bloqueado — no descuenta de nuevo", async () => {
    const fns = await loadFns();
    await expect(
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_B, operationId: "op-confirmar-2" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/ya tiene una ayuda aprobada/);

    const db = admin.firestore();
    const accSnap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_ID).get();
    expect(accSnap.data()!.balance).toBe(1000000 - 100000); // sin cambios
  });
});

describe("CARRERA — 2 cajeros distintos confirman casi al mismo tiempo para el MISMO beneficiario", () => {
  const CI_CARRERA = "4000009";
  // Cuentas DEDICADAS a esta prueba (nunca tocadas por los tests de
  // arriba) — así el saldo final se puede comparar contra un balance
  // inicial conocido, sin depender del orden de ejecución de otros tests
  // en este mismo archivo/emulador.
  const CUENTA_CARRERA_1 = "cuenta-carrera-1";
  const CUENTA_CARRERA_2 = "cuenta-carrera-2";

  it("exactamente UNO de los dos paga; el saldo de la cuenta ganadora baja una sola vez", async () => {
    const db = admin.firestore();
    await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_CARRERA_1).set({
      candidateId: CAND, responsibleUserId: CAJERO_UID, name: "Cuenta Carrera 1", balance: 1000000, currency: "PYG", status: "active",
    });
    await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_CARRERA_2).set({
      candidateId: CAND, responsibleUserId: OTRO_CAJERO_UID, name: "Cuenta Carrera 2", balance: 1000000, currency: "PYG", status: "active",
    });
    await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-carrera").set({
      uid: CAJERO_UID, cedula: CI_CARRERA, nombre: "Votante Carrera Test",
    });
    await db.collection("voters").doc("voter-carrera").set({ cedula: CI_CARRERA, localidad: "test-localidad", nombre: "Votante Carrera Test" });

    const fns = await loadFns();
    const [r1, r2] = await Promise.allSettled([
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_CARRERA_1, beneficiaryCI: CI_CARRERA, operationId: "op-carrera-1" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any),
      fns.aprobarYPagarAyudaCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_CARRERA_2, beneficiaryCI: CI_CARRERA, operationId: "op-carrera-2" },
        auth: { uid: OTRO_CAJERO_UID, token: {} as any },
      } as any),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Cada cuenta de esta prueba arrancó en 1000000 (dedicada, nunca
    // tocada antes) — la ganadora debe quedar en 900000, la otra
    // INTACTA en 1000000.
    const cuenta1Snap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_CARRERA_1).get();
    const cuenta2Snap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_CARRERA_2).get();
    const balances = [cuenta1Snap.data()!.balance, cuenta2Snap.data()!.balance].sort((a, b) => a - b);
    expect(balances).toEqual([900000, 1000000]); // una bajó, la otra quedó exactamente igual

    // Un solo movimiento confirmado para este beneficiario en todo el candidato.
    const movSnap = await db.collection("candidates").doc(CAND).collection("cashierMovements")
      .where("beneficiaryCI", "==", CI_CARRERA).where("status", "==", "confirmed").get();
    expect(movSnap.size).toBe(1);
  });
});
