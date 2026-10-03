// AUDITORÍA 2026-10-03 — búsqueda de beneficiario (escenarios A/B/C/D) +
// flujo de solicitud/aprobación/rechazo de excepción, invocado de verdad
// vía .run() contra el emulador de Firestore.
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-cajero-busqueda-test";
const CAND = "cand-cajero-busqueda-test";

const CAJERO_UID = "cajero-busqueda-uid";
const OTRO_DIRIGENTE_UID = "otro-dirigente-busqueda-uid";
const ADMIN_UID = "admin-busqueda-uid";

const CUENTA_ID = "cuenta-busqueda-test";

// Escenario A: "nuestro" votante, capturado por OTRO dirigente (no el
// cajero), con ayuda APROBADA — debe encontrarse igual (candidato
// entero, no acotado por uid).
const CI_A = "1000001";
const RECORD_A = "record-a";
// Escenario B: "nuestro" votante, sin ayuda aprobada.
const CI_B = "1000002";
const RECORD_B = "record-b";
// Escenario C: NO es "nuestro", pero SÍ está en el padrón.
const CI_C = "1000003";
// Escenario D: no está en ningún lado.
const CI_D = "1000004";

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
  await db.collection("candidates").doc(CAND).collection("users").doc(OTRO_DIRIGENTE_UID).set({ role: "dirigente", nombre: "Otro Dirigente" });
  await db.collection("candidates").doc(CAND).collection("users").doc(ADMIN_UID).set({ role: "campaign_admin", nombre: "Admin Test" });

  await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_ID).set({
    candidateId: CAND, responsibleUserId: CAJERO_UID, name: "Cajero Test", balance: 1000000, currency: "PYG", status: "active",
  });

  // Escenario A: capturado por OTRO dirigente, ayuda APROBADA.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_A).set({
    uid: OTRO_DIRIGENTE_UID, cedula: CI_A, nombre: "Votante Escenario A",
    needsAssistance: true, montoAyuda: 100000, assistanceStatus: "approved", approvedAmount: 150000,
  });
  // Escenario B: "nuestro", sin aprobar.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_B).set({
    uid: CAJERO_UID, cedula: CI_B, nombre: "Votante Escenario B",
    needsAssistance: true, montoAyuda: 80000,
  });
  // Padrón completo (/voters) — A y B también están ahí (son reales),
  // C solo está acá (no es "nuestro"), D no está en ningún lado.
  await db.collection("voters").doc("voter-a").set({ cedula: CI_A, localidad: "test-localidad", nombre: "Votante Escenario A" });
  await db.collection("voters").doc("voter-b").set({ cedula: CI_B, localidad: "test-localidad", nombre: "Votante Escenario B" });
  await db.collection("voters").doc("voter-c").set({ cedula: CI_C, localidad: "test-localidad", nombre: "Votante Escenario C" });
}, 30000);

async function loadFns() {
  return await import("../src/cashierFunds.js");
}

describe("buscarBeneficiarioCajero — escenarios A/B/C/D", () => {
  it("A: votante capturado por OTRO dirigente, con ayuda aprobada — se encuentra igual (candidato entero)", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_A },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("A");
    expect(r.approvedAmount).toBe(150000);
    expect(r.dirigenteNombre).toBe("Otro Dirigente");
  });

  it("B: 'nuestro' votante sin ayuda aprobada", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_B },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("B");
    expect(r.nombre).toBe("Votante Escenario B");
  });

  it("C: no es 'nuestro' pero SÍ está en el padrón completo — trae el monto sugerido de Finanzas", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_C },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("C");
    expect(r.maxVoterAssistanceAmount).toBe(100000);
    expect(r.excepcion).toBe(null);
  });

  it("D: no está en ningún lado", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_D },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("D");
  });

  it("DENEGADO: otro dirigente (no dueño de la cuenta, no admin) no puede buscar en esta cuenta", async () => {
    const fns = await loadFns();
    await expect(
      fns.buscarBeneficiarioCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_A },
        auth: { uid: OTRO_DIRIGENTE_UID, token: {} as any },
      } as any)
    ).rejects.toThrow();
  });
});

describe("Flujo completo de excepción C → pago, con bloqueo de doble pago", () => {
  let exceptionId: string;

  it("1) cajero solicita excepción para CI_C — queda 'pending', monto sugerido = config", async () => {
    const fns = await loadFns();
    const r: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_C, operationId: "op-solicitar-1" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    exceptionId = r.exceptionId;
    expect(r.suggestedAmount).toBe(100000);

    const db = admin.firestore();
    const excSnap = await db.collection("candidates").doc(CAND).collection("cashierBeneficiaryExceptions").doc(exceptionId).get();
    expect(excSnap.data()!.status).toBe("pending");
  });

  it("buscarBeneficiarioCajero ahora refleja la excepción PENDIENTE para CI_C", async () => {
    const fns = await loadFns();
    const r: any = await fns.buscarBeneficiarioCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, ci: CI_C },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.scenario).toBe("C");
    expect(r.excepcion.status).toBe("pending");
  });

  it("2) pagar con una excepción PENDIENTE está bloqueado", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: {
          candidateId: CAND, cashAccountId: CUENTA_ID, amount: 100000, concept: "Ayuda excepcional",
          beneficiaryCI: CI_C, exceptionAuthorizationId: exceptionId, operationId: "op-pago-bloqueado",
        },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/pendiente/);
  });

  it("3) admin APRUEBA la excepción, modificando el monto a 120000", async () => {
    const fns = await loadFns();
    const r: any = await fns.resolverExcepcionBeneficiario.run({
      data: { candidateId: CAND, exceptionId, decision: "approve", approvedAmount: 120000, operationId: "op-aprobar-1" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect(r.status).toBe("approved");
    expect(r.approvedAmount).toBe(120000);
  });

  it("4) pagar con un monto DISTINTO al aprobado está bloqueado", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: {
          candidateId: CAND, cashAccountId: CUENTA_ID, amount: 100000, concept: "Ayuda excepcional",
          beneficiaryCI: CI_C, exceptionAuthorizationId: exceptionId, operationId: "op-pago-monto-incorrecto",
        },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no coincide/);
  });

  it("5) pagar con el monto APROBADO (120000) funciona — descuenta el saldo UNA sola vez", async () => {
    const fns = await loadFns();
    const r: any = await fns.registrarEgresoCajero.run({
      data: {
        candidateId: CAND, cashAccountId: CUENTA_ID, amount: 120000, concept: "Ayuda excepcional",
        beneficiaryCI: CI_C, exceptionAuthorizationId: exceptionId, operationId: "op-pago-correcto",
      },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.balanceAfter).toBe(1000000 - 120000);

    const db = admin.firestore();
    const excSnap = await db.collection("candidates").doc(CAND).collection("cashierBeneficiaryExceptions").doc(exceptionId).get();
    expect(excSnap.data()!.consumed).toBe(true);
  });

  it("6) un SEGUNDO intento de pago al mismo beneficiario, sin excepción nueva, queda bloqueado (CI_C nunca es 'nuestro' — siempre exige excepción, no solo en reasistencia)", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: {
          candidateId: CAND, cashAccountId: CUENTA_ID, amount: 50000, concept: "Otro intento",
          beneficiaryCI: CI_C, operationId: "op-pago-doble",
        },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/autorización excepcional/);

    const db = admin.firestore();
    const accSnap = await db.collection("candidates").doc(CAND).collection("cashierAccounts").doc(CUENTA_ID).get();
    // El saldo NO debe haber cambiado por el intento bloqueado.
    expect(accSnap.data()!.balance).toBe(1000000 - 120000);
  });

  it("8) voto A (nuestro, aprobado): primer pago normal, sin excepción", async () => {
    const fns = await loadFns();
    const r: any = await fns.registrarEgresoCajero.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, amount: 150000, concept: "Ayuda", beneficiaryCI: CI_A, operationId: "op-pago-a-1" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.beneficiaryVoterId).toBe("voter-a");
  });

  it("9) voto A: pagar con un monto DISTINTO al approvedAmount del votante está bloqueado (ni en el primer pago)", async () => {
    const fns = await loadFns();
    const db = admin.firestore();
    // cedula distinta para no chocar con el dupSnap del test anterior.
    await db.collection("candidates").doc(CAND).collection("savedRecords").doc("record-a2").set({
      uid: OTRO_DIRIGENTE_UID, cedula: "1000005", nombre: "Votante A2", assistanceStatus: "approved", approvedAmount: 100000,
    });
    await db.collection("voters").doc("voter-a2").set({ cedula: "1000005", localidad: "test-localidad", nombre: "Votante A2" });
    await expect(
      fns.registrarEgresoCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, amount: 999, concept: "Ayuda", beneficiaryCI: "1000005", operationId: "op-pago-a2-monto-malo" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/no coincide con la ayuda aprobada/);
  });

  it("10) voto A: un SEGUNDO pago (reasistencia) sin excepción está bloqueado", async () => {
    const fns = await loadFns();
    await expect(
      fns.registrarEgresoCajero.run({
        data: { candidateId: CAND, cashAccountId: CUENTA_ID, amount: 150000, concept: "Segunda ayuda", beneficiaryCI: CI_A, operationId: "op-pago-a-2" },
        auth: { uid: CAJERO_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/ya recibió un aporte/);
  });

  it("11) voto A: con una excepción aprobada, la reasistencia SÍ funciona", async () => {
    const fns = await loadFns();
    const sol: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: CI_A, operationId: "op-solicitar-reasistencia" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    await fns.resolverExcepcionBeneficiario.run({
      data: { candidateId: CAND, exceptionId: sol.exceptionId, decision: "approve", approvedAmount: 150000, operationId: "op-aprobar-reasistencia" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    const r: any = await fns.registrarEgresoCajero.run({
      data: {
        candidateId: CAND, cashAccountId: CUENTA_ID, amount: 150000, concept: "Segunda ayuda (excepcional)",
        beneficiaryCI: CI_A, exceptionAuthorizationId: sol.exceptionId, operationId: "op-pago-a-reasistencia",
      },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    expect(r.beneficiaryVoterId).toBe("voter-a");
  });

  it("7) una excepción ya RECHAZADA no puede volver a resolverse", async () => {
    const fns = await loadFns();
    // Nueva solicitud para otro beneficiario (CI_A ya tiene ayuda directa
    // aprobada, no haría falta excepción — usamos una CI de prueba nueva
    // en el padrón para este caso puntual).
    const db = admin.firestore();
    await db.collection("voters").doc("voter-reject-test").set({ cedula: "9999999", localidad: "test-localidad", nombre: "Votante Reject Test" });
    const sol: any = await fns.solicitarExcepcionBeneficiario.run({
      data: { candidateId: CAND, cashAccountId: CUENTA_ID, beneficiaryCI: "9999999", operationId: "op-solicitar-reject" },
      auth: { uid: CAJERO_UID, token: {} as any },
    } as any);
    const rej: any = await fns.resolverExcepcionBeneficiario.run({
      data: { candidateId: CAND, exceptionId: sol.exceptionId, decision: "reject", rejectionReason: "No corresponde", operationId: "op-rechazar-1" },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect(rej.status).toBe("rejected");

    await expect(
      fns.resolverExcepcionBeneficiario.run({
        data: { candidateId: CAND, exceptionId: sol.exceptionId, decision: "approve", operationId: "op-aprobar-tardio" },
        auth: { uid: ADMIN_UID, token: {} as any },
      } as any)
    ).rejects.toThrow(/ya fue resuelta/);
  });
});
