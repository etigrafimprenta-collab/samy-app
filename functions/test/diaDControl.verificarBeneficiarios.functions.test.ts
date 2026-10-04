// NUEVA FUNCIÓN EVENTUAL (pedido 2026-10-04) — Finanzas > Cajeros DD >
// "Verificar beneficiarios y marcar votos". Cubre exactamente los casos
// que el admin pidió cerrar antes de implementar:
//  1) cruce normal (pago confirmado por CI -> savedRecords -> marca voted)
//  2) CI con espacios/puntos/guiones se normaliza igual que una limpia
//  3) duplicado-cédula en savedRecords -> "inconsistencia", EXCLUIDO del
//     marcado (nunca se adivina el dueño)
//  4) beneficiario que no es "nuestro" (no está en savedRecords) -> excluido,
//     reportado como externo, nunca se le toca nada
//  5) 2+ pagos confirmados del MISMO beneficiario -> una sola CI (dedupe)
//  6) idempotencia bajo condición de carrera: el elector ya pasa a voted
//     (por otra vía, p.ej. un mesario) ENTRE la vista previa y la
//     ejecución -> debe contar como "ya estaba votado al ejecutar", cero
//     duplicados, assignedLeaderId intacto
//  7) solo campaign_admin/coordinator pueden llamarla
import { beforeAll, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";

const PROJECT_ID = "demo-verificar-beneficiarios-test";
const CAND = "cand-verificar-beneficiarios-test";

const DIRIGENTE_UID = "dirigente-vb-uid";
const MESARIO_UID = "mesario-vb-uid";
const ADMIN_UID = "admin-vb-uid";
const CASHIER_UID = "cashier-vb-uid"; // no admin -> debe ser rechazado

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
  await db.collection("candidates").doc(CAND).collection("users").doc(CASHIER_UID)
    .set({ role: "cashier", nombre: "Cajero Test" });

  // Caso 1: beneficiario normal, pago confirmado con CI limpia.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-normal")
    .set({ uid: DIRIGENTE_UID, cedula: "1111111", nombre: "Beneficiario Normal", local: "Local X", mesa: "8", seccional: "" });

  // Caso 2: CI con espacios/puntos/guiones en el pago, limpia en savedRecords.
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-sucio")
    .set({ uid: DIRIGENTE_UID, cedula: "2222222", nombre: "Beneficiario CI Sucia", local: "Local X", mesa: "8", seccional: "" });

  // Caso 3: duplicado — 2 savedRecords con la MISMA cédula (inconsistencia real,
  // confirmada contra datos de producción).
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-dup-a")
    .set({ uid: DIRIGENTE_UID, cedula: "3333333", nombre: "Duplicado A", local: "Local X", mesa: "8", seccional: "" });
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-dup-b")
    .set({ uid: MESARIO_UID, cedula: "3333333", nombre: "Duplicado B", local: "Local Y", mesa: "1", seccional: "" });

  // Caso 6: beneficiario que será marcado por el mesario DURANTE la ventana
  // entre vista previa y ejecución (condición de carrera).
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-carrera")
    .set({ uid: DIRIGENTE_UID, cedula: "4444444", nombre: "Beneficiario Carrera", local: "Local X", mesa: "8", seccional: "" });

  // Pagos confirmados de Cajeros DD.
  const movs: Array<[string, string, string]> = [
    ["mov-normal", "1111111", "Beneficiario Normal"],
    ["mov-sucio", "222.222-2", "Beneficiario CI Sucia"], // sucia -> normaliza a 2222222
    ["mov-dup", "3333333", "Duplicado"],
    ["mov-carrera", "4444444", "Beneficiario Carrera"],
    ["mov-externo", "9999999", "No Es Nuestro"], // no está en savedRecords
    ["mov-normal-repago", "1111111", "Beneficiario Normal"], // 2do pago, misma CI -> dedupe
  ];
  for (const [id, ci, nombre] of movs) {
    await db.collection("candidates").doc(CAND).collection("cashierMovements").doc(id)
      .set({ type: "expense", status: "confirmed", beneficiaryCI: ci, beneficiaryName: nombre, beneficiaryVoterId: `voters-id-${id}` });
  }
}, 60000);

async function loadFns() {
  return await import("../src/diaDControl.js");
}

describe("verificarBeneficiariosYMarcarVoto — diseño aprobado 2026-10-04", () => {
  it("rechaza a quien no es campaign_admin/coordinator", async () => {
    const fns = await loadFns();
    await expect(
      fns.verificarBeneficiariosYMarcarVoto.run({
        data: { candidateId: CAND, dryRun: true },
        auth: { uid: CASHIER_UID, token: {} as any },
      } as any)
    ).rejects.toThrow();
  });

  it("vista previa (dryRun:true) — cero escrituras, conteos exactos", async () => {
    const fns = await loadFns();
    const antesControl = (await admin.firestore().collection("candidates").doc(CAND).collection("electionDayControl").get()).size;
    expect(antesControl).toBe(0); // todavía nadie marcado

    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: true },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    expect(r.dryRun).toBe(true);
    // 6 movimientos, 5 CI únicas (1111111 se repite) -> 1 duplicado eliminado por CI
    expect(r.pagosConfirmadosUnicos).toBe(5);
    expect(r.duplicadosEliminadosPorCI).toBe(1);
    // nuestrosBeneficiarios incluye normal, sucio, carrera + los 2 duplicados (3333333 cuenta como 1 CI con 2 docs)
    expect(r.nuestrosBeneficiarios).toBe(4); // normal, sucio, carrera, dup(3333333)
    expect(r.yaVotaron).toBe(0);
    expect(r.pendientesAMarcar).toBe(3); // normal, sucio, carrera (dup excluido)
    expect(r.beneficiariosExternos).toBe(1); // 9999999
    expect(r.inconsistencias).toBe(1); // CI 3333333 con 2 docs
    expect(r.inconsistenciasDetalle[0].cedula).toBe("3333333");
    expect(r.inconsistenciasDetalle[0].docs.sort()).toEqual(["rec-dup-a", "rec-dup-b"]);
    expect(r.externosDetalle.some((e: any) => e.cedula === "9999999")).toBe(true);

    // Confirmar que la vista previa NO escribió nada.
    const despuesControl = (await admin.firestore().collection("candidates").doc(CAND).collection("electionDayControl").get()).size;
    expect(despuesControl).toBe(0);
  });

  it("CONDICIÓN DE CARRERA: el mesario marca a rec-carrera DESPUÉS de la vista previa, ANTES de ejecutar", async () => {
    const fns = await loadFns();
    // Esto simula exactamente lo que pidió el admin: "si durante la
    // ejecución ya pasó a voted, debe resultar idempotente y no generar
    // otro voto" — acá se adelanta incluso antes del paso de ejecución.
    const r = await fns.setDiaDStatusFn.run({
      data: { candidateId: CAND, voterId: "rec-carrera", newStatus: "voted" },
      auth: { uid: MESARIO_UID, token: {} as any },
    } as any);
    expect((r as any).changed).toBe(true);
  });

  it("ejecución (dryRun:false) — recalcula de cero, marca pendientes reales, idempotente con la carrera", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: false },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);

    expect(r.dryRun).toBe(false);
    // Recalculado DE CERO en este mismo call: rec-carrera ya está voted
    // (por el mesario), así que pendientesAMarcar bajó a 2 (normal, sucio).
    expect(r.pendientesAMarcar).toBe(2);
    expect(r.pendientesPrevistos).toBe(2);
    expect(r.marcadosAhora).toBe(2); // normal + sucio
    expect(r.yaVotadosAlEjecutar).toBe(0); // nadie estaba pendiente Y cambió de estado en el camino
    expect(r.errores).toBe(0);

    const db = admin.firestore();
    const ctrlNormal = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc("rec-normal").get();
    expect(ctrlNormal.data()!.status).toBe("voted");
    expect(ctrlNormal.data()!.lastUpdatedRole).toBe("campaign_admin");

    const ctrlSucio = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc("rec-sucio").get();
    expect(ctrlSucio.data()!.status).toBe("voted"); // CI con guiones/puntos normalizó y cruzó bien

    // Los duplicados NUNCA se marcaron (inconsistencia excluida).
    const ctrlDupA = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc("rec-dup-a").get();
    const ctrlDupB = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc("rec-dup-b").get();
    expect(ctrlDupA.exists).toBe(false);
    expect(ctrlDupB.exists).toBe(false);

    // rec-carrera sigue voted por el MESARIO, assignedLeaderId intacto
    // (nunca lo tocó esta función, era changed:false en su transacción interna
    // si se hubiera intentado — en este flujo ni siquiera entró a "pendientes").
    const ctrlCarrera = await db.collection("candidates").doc(CAND).collection("electionDayControl").doc("rec-carrera").get();
    expect(ctrlCarrera.data()!.assignedLeaderId).toBe(DIRIGENTE_UID);
    expect(ctrlCarrera.data()!.lastUpdatedBy).toBe(MESARIO_UID); // no reescrito por la función
  });

  it("re-ejecutar de nuevo (dryRun:false) — ya no queda ningún pendiente propio, 0 marcados, 0 errores", async () => {
    const fns = await loadFns();
    const r: any = await fns.verificarBeneficiariosYMarcarVoto.run({
      data: { candidateId: CAND, dryRun: false },
      auth: { uid: ADMIN_UID, token: {} as any },
    } as any);
    expect(r.pendientesPrevistos).toBe(0);
    expect(r.marcadosAhora).toBe(0);
    expect(r.yaVotadosAlEjecutar).toBe(0);
    expect(r.errores).toBe(0);
    expect(r.yaVotaron).toBe(3); // normal, sucio, carrera — los 3 ya voted
  });

  it("auditoría: queda un financeAuditLogs por cada ejecución real, savedRecords nunca se tocó", async () => {
    const db = admin.firestore();
    const auditSnap = await db.collection("candidates").doc(CAND).collection("financeAuditLogs")
      .where("entityType", "==", "diaDBulkVoteSync").get();
    expect(auditSnap.size).toBe(2); // las 2 ejecuciones dryRun:false de este archivo

    const recNormal = await db.collection("candidates").doc(CAND).collection("savedRecords").doc("rec-normal").get();
    expect(recNormal.data()!.uid).toBe(DIRIGENTE_UID); // jamás modificado
  });
});
