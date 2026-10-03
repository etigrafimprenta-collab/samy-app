// AUDITORÍA 2026-10-03 — "no quiero que el administrador tenga que
// adivinar por qué está aprobando": solicitarExcepcionBeneficiario debe
// guardar un `motivo` AUTOMÁTICO (nunca escrito a mano por el cajero) y
// el `paymentScopeAtRequest` (alcance del cajero al momento de pedirla);
// resolverExcepcionBeneficiario debe dejar en financeAuditLogs
// beneficiario/CI/motivo/monto solicitado/monto aprobado/quién solicitó,
// tanto al aprobar como al rechazar.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-cajero-motivo-excepcion-test";
const CAND = "cand-cajero-motivo-excepcion-test";

const CAJERO_UID = "cajero-motivo-uid";
const ADMIN_UID = "admin-motivo-uid";
const CUENTA_ID = "cuenta-motivo-test";
const CI_PADRON_GENERAL = "7000001";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
  }
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Test", localidad: "test-localidad-motivo" });
  await db.collection("candidates").doc(CAND).collection("config").doc("financeSettings").set({ maxVoterAssistanceAmount: 90000 });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAJERO_UID).set({ role: "cashier", nombre: "Cajero Test", paymentScope: "full_padron" });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID).set({ role: "campaign_admin", nombre: "Admin Test" });
  await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_ID).set({
    candidateId: CAND, responsibleUserId: CAJERO_UID, name: "Cajero Test", balance: 1000000, currency: "PYG", status: "active",
  });
  await db.collection("voters").doc("voter-padron-general-motivo").set({ cedula: CI_PADRON_GENERAL, localidad: "test-localidad-motivo", nombre: "Votante Padrón General" });
}, 30000);

async function loadFns() {
  return await import("../src/cashierFunds.js");
}

describe("solicitarExcepcionBeneficiario — motivo automático + alcance al momento de pedir", () => {
  it("guarda motivo y paymentScopeAtRequest sin que el cajero escriba nada", async () => {
    const fns = await loadFns();
    await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_PADRON_GENERAL, operationId: "op-solicitar-motivo" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);

    const db = admin.firestore();
    const snap = await db.collection("candidates").doc(CAND).collection("cashierBeneficiaryExceptions")
      .where("beneficiaryCI", "==", CI_PADRON_GENERAL).limit(1).get();
    expect(snap.empty).toBe(false);
    const exc = snap.docs[0].data();
    expect(exc.motivo).toMatch(/No pertenece a nuestros votantes/);
    expect(exc.paymentScopeAtRequest).toBe("TODOS_B");
  });
});

describe("resolverExcepcionBeneficiario — auditoría enriquecida (aprobar y rechazar)", () => {
  it("al APROBAR, financeAuditLogs trae beneficiario/CI/motivo/monto solicitado/quién solicitó", async () => {
    const db = admin.firestore();
    const ci = "7000002";
    await db.collection("voters").doc("voter-aprobar-motivo").set({ cedula: ci, localidad: "test-localidad-motivo", nombre: "Votante A Aprobar" });

    const fns = await loadFns();
    const sol: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: ci, operationId: "op-solicitar-aprobar-motivo" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);

    await fns.resolverExcepcionBeneficiario.run({
      data: { candidateId: CAND, exceptionId: sol.exceptionId, decision: "approve", approvedAmount: 123000, operationId: "op-resolver-aprobar-motivo" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    const auditSnap = await db.collection("candidates").doc(CAND).collection("financeAuditLogs")
      .where("action", "==", "cashier_exception_approve").where("entityId", "==", sol.exceptionId).limit(1).get();
    expect(auditSnap.empty).toBe(false);
    const audit = auditSnap.docs[0].data();
    expect(audit.previousData.beneficiaryCI).toBe(ci);
    expect(audit.previousData.beneficiaryName).toBe("Votante A Aprobar");
    expect(audit.previousData.motivo).toMatch(/No pertenece a nuestros votantes/);
    expect(audit.previousData.suggestedAmount).toBe(90000); // monto solicitado (sugerido)
    expect(audit.previousData.requestedBy).toBe(CAJERO_UID);
    expect(audit.newData.approvedAmount).toBe(123000); // monto finalmente aprobado (distinto al sugerido)
    expect(audit.performedBy).toBe(ADMIN_UID); // quién resolvió
  });

  it("al RECHAZAR, financeAuditLogs trae la misma información de contexto", async () => {
    const db = admin.firestore();
    const ci = "7000003";
    await db.collection("voters").doc("voter-rechazar-motivo").set({ cedula: ci, localidad: "test-localidad-motivo", nombre: "Votante A Rechazar" });

    const fns = await loadFns();
    const sol: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: ci, operationId: "op-solicitar-rechazar-motivo" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);

    await fns.resolverExcepcionBeneficiario.run({
      data: { candidateId: CAND, exceptionId: sol.exceptionId, decision: "reject", rejectionReason: "No corresponde", operationId: "op-resolver-rechazar-motivo" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    const auditSnap = await db.collection("candidates").doc(CAND).collection("financeAuditLogs")
      .where("action", "==", "cashier_exception_reject").where("entityId", "==", sol.exceptionId).limit(1).get();
    expect(auditSnap.empty).toBe(false);
    const audit = auditSnap.docs[0].data();
    expect(audit.previousData.beneficiaryCI).toBe(ci);
    expect(audit.previousData.motivo).toMatch(/No pertenece a nuestros votantes/);
    expect(audit.previousData.requestedBy).toBe(CAJERO_UID);
    expect(audit.newData.rejectionReason).toBe("No corresponde");
  });
});
