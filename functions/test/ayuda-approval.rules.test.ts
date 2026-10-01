// Ayuda Gs. — Fase 2 (control y aprobación), pruebas de Firestore Rules
// contra el Emulador real (NUNCA por inspección) — mismo criterio que el
// resto de functions/test/*.rules.test.ts. PROJECT_ID propio para no
// compartir namespace con otra suite que también hace clearFirestore().
//
// Cubre exactamente lo pedido antes de cualquier deploy:
//   1) un dirigente NO puede autoaprobarse;
//   2) tampoco puede modificar approvedAmount/approvedBy/approvedAt/
//      rejectedBy/rejectedAt directamente;
//   3) modificación controlada de una solicitud ya aprobada (bloqueo del
//      cambio directo + forma válida de reapertura);
//   4) aprobación/rechazo por roles autorizados (legacy y RBAC);
//   5) auditoría (financeAuditLogs: quién puede crear qué, inmutable).
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import * as admin from "firebase-admin";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ID = "demo-ayuda-approval-test";
const CAND = "cand-ayuda-approval-test";

const DIRIGENTE_UID = "dirigente-uid";
const OTHER_DIRIGENTE_UID = "other-dirigente-uid";
const CAMPAIGN_ADMIN_UID = "campaign-admin-uid";
const FINANCE_ADMIN_UID = "finance-admin-uid";
const COORDINATOR_UID = "coordinator-uid";
const AUDITOR_UID = "auditor-uid";
const SUPERADMIN_UID = "superadmin-uid";
// Rol personalizado (RBAC) SIN ningún rol legacy de administración —
// solo tiene el permiso efectivo finance.approve vía scopedPermissions.
const RBAC_APPROVER_UID = "rbac-approver-uid";

// Fase 2.1 — actores de las 3 vías genéricas que NO tienen
// finance.approve/finance.reject, para probar que el gap quedó cerrado.
const RECORDS_EDIT_ACTOR_UID = "records-edit-actor-uid"; // hasEffectivePermission(records.edit) vía scope all_candidate
const SCOPE_ACTOR_UID = "scope-actor-uid"; // canAccessSavedRecordByScope(records.edit, 'own')
const ASSIGNED_ACTOR_UID = "assigned-actor-uid"; // isAssignedToSavedRecord(records.edit) vía electionDayControl

const RECORD_ID = "saved-record-1";
const RECORD_ID_SCOPE = "saved-record-scope";
const RECORD_ID_ASSIGNED = "saved-record-assigned";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST no está seteado — corré con `npm test`");
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
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

function ctx(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function recordRef(db: FirebaseFirestore.Firestore) {
  return db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_ID);
}

async function setupBaseFixtures() {
  const db = admin.firestore();
  await db.collection("candidates").doc(CAND).set({ name: "Candidato Ayuda Test", status: "active" });
  await db.collection("candidates").doc(CAND).collection("users").doc(DIRIGENTE_UID).set({ role: "dirigente" });
  await db.collection("candidates").doc(CAND).collection("users").doc(OTHER_DIRIGENTE_UID).set({ role: "dirigente" });
  await db.collection("candidates").doc(CAND).collection("users").doc(CAMPAIGN_ADMIN_UID).set({ role: "campaign_admin" });
  await db.collection("candidates").doc(CAND).collection("users").doc(FINANCE_ADMIN_UID).set({ role: "finance_admin" });
  await db.collection("candidates").doc(CAND).collection("users").doc(COORDINATOR_UID).set({ role: "coordinator" });
  await db.collection("candidates").doc(CAND).collection("users").doc(AUDITOR_UID).set({ role: "auditor" });
  // Rol RBAC puro: ningún role legacy de peso (dirigente, el más bajo),
  // pero con el permiso efectivo finance.approve otorgado — mismo
  // mecanismo real que usa hasEffectivePermission (scopedPermissions en
  // el propio doc de usuario, ver firestore.rules/hasScopedPermission).
  await db.collection("candidates").doc(CAND).collection("users").doc(RBAC_APPROVER_UID).set({
    role: "dirigente",
    scopedPermissions: { "finance.approve": ["all_candidate"], "finance.reject": ["all_candidate"] },
  });
  await db.collection("platformUsers").doc(SUPERADMIN_UID).set({ globalRole: "superadmin" });

  // Los 3 actores de vías genéricas — rol "viewer" a propósito (el rol
  // legacy más bajo, sin ninguna relación con aprobación) para que la
  // ÚNICA razón por la que puedan escribir sea el permiso/scope/assigned
  // bajo prueba, nunca el rol.
  await db.collection("candidates").doc(CAND).collection("users").doc(RECORDS_EDIT_ACTOR_UID).set({
    role: "viewer",
    scopedPermissions: { "records.edit": ["all_candidate"] },
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(SCOPE_ACTOR_UID).set({
    role: "viewer",
    scopedPermissions: { "records.edit": ["own"] },
  });
  await db.collection("candidates").doc(CAND).collection("users").doc(ASSIGNED_ACTOR_UID).set({
    role: "viewer",
    scopedPermissions: { "records.edit": ["assigned"] },
  });

  await recordRef(db).set({
    uid: DIRIGENTE_UID,
    cedula: "1234567",
    nombre: "Juan Votante",
    needsAssistance: true,
    montoAyuda: 100000,
    // Sin assistanceStatus — legacy "recién solicitado", pending_approval derivado.
  });

  // Registro propio de SCOPE_ACTOR_UID (scope 'own' exige data.uid == quien llama).
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_ID_SCOPE).set({
    uid: SCOPE_ACTOR_UID,
    cedula: "2222222",
    nombre: "Votante Scope",
    needsAssistance: true,
    montoAyuda: 100000,
  });

  // Registro asignado a ASSIGNED_ACTOR_UID vía electionDayControl (mismo
  // id de documento, ver isAssignedToSavedRecord/firestore.rules).
  await db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_ID_ASSIGNED).set({
    uid: OTHER_DIRIGENTE_UID,
    cedula: "3333333",
    nombre: "Votante Assigned",
    needsAssistance: true,
    montoAyuda: 100000,
  });
  await db.collection("candidates").doc(CAND).collection("electionDayControl").doc(RECORD_ID_ASSIGNED).set({
    assignedLeaderId: ASSIGNED_ACTOR_UID,
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await setupBaseFixtures();
});

describe("1) un dirigente NO puede autoaprobarse", () => {
  it("escribir assistanceStatus=approved+approvedAmount+approvedBy=sí mismo → falla", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        assistanceStatus: "approved",
        approvedAmount: 100000,
        approvedBy: DIRIGENTE_UID,
        approvedAt: new Date(),
      })
    );
  });

  it("intentar atribuirle la aprobación a OTRO uid tampoco pasa (no es solo 'approvedBy debe ser el que llama')", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        assistanceStatus: "approved",
        approvedAmount: 100000,
        approvedBy: CAMPAIGN_ADMIN_UID,
        approvedAt: new Date(),
      })
    );
  });

  it("escribir assistanceStatus=rejected sobre sí mismo también falla", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        assistanceStatus: "rejected",
        rejectedBy: DIRIGENTE_UID,
        rejectedAt: new Date(),
        rejectionReason: "Me auto-rechazo",
      })
    );
  });

  it("otro dirigente (ni siquiera dueño del registro) tampoco puede", async () => {
    await assertFails(
      recordRef(ctx(OTHER_DIRIGENTE_UID)).update({
        assistanceStatus: "approved",
        approvedAmount: 100000,
        approvedBy: OTHER_DIRIGENTE_UID,
        approvedAt: new Date(),
      })
    );
  });
});

describe("2) un dirigente NO puede modificar los campos administrativos individualmente", () => {
  it("NO puede tocar approvedAmount solo (sin cambiar assistanceStatus)", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ approvedAmount: 999999 }));
  });
  it("NO puede tocar approvedBy solo", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ approvedBy: DIRIGENTE_UID }));
  });
  it("NO puede tocar approvedAt solo", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ approvedAt: new Date() }));
  });
  it("NO puede tocar rejectedBy solo", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ rejectedBy: DIRIGENTE_UID }));
  });
  it("NO puede tocar rejectedAt solo", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ rejectedAt: new Date() }));
  });
  it("NO puede tocar rejectionReason solo", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ rejectionReason: "porque sí" }));
  });

  it("control de cordura: SÍ puede seguir editando campos propios normales (nota, montoAyuda) — la restricción es puntual, no rompe lo existente", async () => {
    await assertSucceeds(recordRef(ctx(DIRIGENTE_UID)).update({ nota: "Visité al votante" }));
    await assertSucceeds(recordRef(ctx(DIRIGENTE_UID)).update({ montoAyuda: 150000, needsAssistance: true }));
  });
});

describe("3) modificación controlada de una solicitud ya decidida", () => {
  beforeEach(async () => {
    // Estado previo: ya aprobada por el admin (vía Admin SDK, bypassea reglas — es setup).
    await recordRef(admin.firestore()).update({
      assistanceStatus: "approved",
      approvedAmount: 100000,
      approvedBy: CAMPAIGN_ADMIN_UID,
      approvedAt: new Date(),
    });
  });

  it("cambiar montoAyuda DIRECTO mientras está approved, SIN pasar a pending_approval → falla (bloqueo real, no solo de UI)", async () => {
    await assertFails(recordRef(ctx(DIRIGENTE_UID)).update({ montoAyuda: 150000 }));
  });

  it("reapertura con la forma correcta (monto nuevo + pending_approval, conservando approvedAmount/approvedBy/approvedAt) → funciona", async () => {
    await assertSucceeds(
      recordRef(ctx(DIRIGENTE_UID)).update({
        montoAyuda: 150000,
        assistanceStatus: "pending_approval",
      })
    );
    const after = (await recordRef(admin.firestore()).get()).data();
    expect(after?.montoAyuda).toBe(150000);
    expect(after?.assistanceStatus).toBe("pending_approval");
    // El historial de la aprobación anterior se conserva intacto:
    expect(after?.approvedAmount).toBe(100000);
    expect(after?.approvedBy).toBe(CAMPAIGN_ADMIN_UID);
  });

  it("intentar reabrir pero ADEMÁS limpiar/cambiar approvedAmount en la misma escritura → falla (debe conservarse intacto)", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        montoAyuda: 150000,
        assistanceStatus: "pending_approval",
        approvedAmount: 0,
      })
    );
  });

  it("intentar reabrir pero poner assistanceStatus=approved directamente (saltarse la revisión) → falla", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        montoAyuda: 150000,
        assistanceStatus: "approved",
      })
    );
  });

  it("'reapertura' sin cambiar realmente el monto (mismo valor) → falla (no es una reapertura real)", async () => {
    await assertFails(
      recordRef(ctx(DIRIGENTE_UID)).update({
        montoAyuda: 100000, // igual al actual
        assistanceStatus: "pending_approval",
      })
    );
  });
});

describe("4) aprobación/rechazo por roles autorizados", () => {
  it("campaign_admin puede aprobar", async () => {
    await assertSucceeds(
      recordRef(ctx(CAMPAIGN_ADMIN_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: CAMPAIGN_ADMIN_UID, approvedAt: new Date(),
      })
    );
  });

  it("finance_admin puede aprobar", async () => {
    await assertSucceeds(
      recordRef(ctx(FINANCE_ADMIN_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: FINANCE_ADMIN_UID, approvedAt: new Date(),
      })
    );
  });

  it("superadmin puede aprobar", async () => {
    await assertSucceeds(
      recordRef(ctx(SUPERADMIN_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: SUPERADMIN_UID, approvedAt: new Date(),
      })
    );
  });

  it("un rol personalizado con permiso efectivo finance.approve puede aprobar (modelo RBAC, no solo roles legacy)", async () => {
    await assertSucceeds(
      recordRef(ctx(RBAC_APPROVER_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: RBAC_APPROVER_UID, approvedAt: new Date(),
      })
    );
  });

  it("finance_admin puede rechazar con motivo", async () => {
    await assertSucceeds(
      recordRef(ctx(FINANCE_ADMIN_UID)).update({
        assistanceStatus: "rejected", rejectedBy: FINANCE_ADMIN_UID, rejectedAt: new Date(), rejectionReason: "No corresponde",
      })
    );
  });

  it("rechazar SIN motivo (vacío) falla, aunque lo haga un rol autorizado", async () => {
    await assertFails(
      recordRef(ctx(FINANCE_ADMIN_UID)).update({
        assistanceStatus: "rejected", rejectedBy: FINANCE_ADMIN_UID, rejectedAt: new Date(), rejectionReason: "",
      })
    );
  });

  it("coordinator NO puede aprobar (no tiene finance.approve ni es campaign_admin/finance_admin)", async () => {
    await assertFails(
      recordRef(ctx(COORDINATOR_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: COORDINATOR_UID, approvedAt: new Date(),
      })
    );
  });

  it("auditor (solo lectura financiera) NO puede aprobar", async () => {
    await assertFails(
      recordRef(ctx(AUDITOR_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: AUDITOR_UID, approvedAt: new Date(),
      })
    );
  });
});

describe("5) auditoría (financeAuditLogs)", () => {
  function logsCol(db: FirebaseFirestore.Firestore) {
    return db.collection("candidates").doc(CAND).collection("financeAuditLogs");
  }

  it("campaign_admin puede crear un log de aprobación", async () => {
    await assertSucceeds(
      logsCol(ctx(CAMPAIGN_ADMIN_UID)).add({
        candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "approve",
        previousData: { montoAyuda: 100000 }, newData: { assistanceStatus: "approved", approvedAmount: 100000 },
        performedBy: CAMPAIGN_ADMIN_UID, performedByRole: "campaign_admin", reason: "",
      })
    );
  });

  it("el dirigente DUEÑO del registro puede crear su propio log de reapertura", async () => {
    await assertSucceeds(
      logsCol(ctx(DIRIGENTE_UID)).add({
        candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "reopened_after_edit",
        previousData: { montoAyuda: 100000 }, newData: { montoAyuda: 150000, assistanceStatus: "pending_approval" },
        performedBy: DIRIGENTE_UID, performedByRole: "dirigente", reason: "",
      })
    );
  });

  it("un dirigente que NO es dueño del registro NO puede crear un log de reapertura sobre él", async () => {
    await assertFails(
      logsCol(ctx(OTHER_DIRIGENTE_UID)).add({
        candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "reopened_after_edit",
        previousData: { montoAyuda: 100000 }, newData: { montoAyuda: 150000, assistanceStatus: "pending_approval" },
        performedBy: OTHER_DIRIGENTE_UID, performedByRole: "dirigente", reason: "",
      })
    );
  });

  it("el dirigente NO puede crear un log de tipo 'approve' (solo 'reopened_after_edit' le está permitido)", async () => {
    await assertFails(
      logsCol(ctx(DIRIGENTE_UID)).add({
        candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "approve",
        previousData: {}, newData: { assistanceStatus: "approved", approvedAmount: 999999 },
        performedBy: DIRIGENTE_UID, performedByRole: "dirigente", reason: "",
      })
    );
  });

  it("un log de auditoría es inmutable: nadie puede actualizarlo ni borrarlo, ni siquiera campaign_admin", async () => {
    const logRef = logsCol(admin.firestore()).doc("existing-log");
    await logRef.set({
      candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "approve",
      previousData: {}, newData: {}, performedBy: CAMPAIGN_ADMIN_UID, performedByRole: "campaign_admin", reason: "",
    });
    await assertFails(logsCol(ctx(CAMPAIGN_ADMIN_UID)).doc("existing-log").update({ reason: "editado" }));
    await assertFails(logsCol(ctx(CAMPAIGN_ADMIN_UID)).doc("existing-log").delete());
  });

  it("auditor puede LEER los logs (ya existía, no debe romperse)", async () => {
    const logRef = logsCol(admin.firestore()).doc("existing-log-2");
    await logRef.set({
      candidateId: CAND, entityType: "ayuda_votante", entityId: RECORD_ID, action: "approve",
      previousData: {}, newData: {}, performedBy: CAMPAIGN_ADMIN_UID, performedByRole: "campaign_admin", reason: "",
    });
    await assertSucceeds(logsCol(ctx(AUDITOR_UID)).doc("existing-log-2").get());
  });
});

// ══════════════ 6) Fase 2.1 — cierre del gap de permisos ══════════════
// Las 3 vías genéricas (records.edit, scope, assigned) daban paso a TODO
// el documento, incluidos los 7 campos administrativos, a cualquiera con
// ese permiso/scope aunque no tuviera finance.approve/finance.reject.
// Estas pruebas demuestran que ahora están bloqueadas, sin romper lo que
// legítimamente sí pueden seguir haciendo.
const ADMIN_FIELD_ATTEMPTS: Record<string, any> = {
  assistanceStatus: "approved",
  approvedAmount: 999999,
  approvedBy: "cualquiera",
  approvedAt: new Date(),
  rejectedBy: "cualquiera",
  rejectedAt: new Date(),
  rejectionReason: "intento no autorizado",
};

describe("6) records.edit (scope all_candidate) sin finance.approve/reject", () => {
  it("NO puede modificar NINGÚN campo administrativo, uno por vez", async () => {
    for (const [field, value] of Object.entries(ADMIN_FIELD_ATTEMPTS)) {
      await assertFails(recordRef(ctx(RECORDS_EDIT_ACTOR_UID)).update({ [field]: value }));
    }
  });

  it("SÍ puede seguir editando campos ordinarios (nota, montoAyuda) — el permiso legítimo no se rompió", async () => {
    await assertSucceeds(recordRef(ctx(RECORDS_EDIT_ACTOR_UID)).update({ nota: "Seguimiento" }));
    await assertSucceeds(recordRef(ctx(RECORDS_EDIT_ACTOR_UID)).update({ montoAyuda: 150000 }));
  });

  it("combinar un cambio ordinario permitido + uno administrativo prohibido en la MISMA escritura → falla completa", async () => {
    await assertFails(recordRef(ctx(RECORDS_EDIT_ACTOR_UID)).update({ nota: "Nota legítima", approvedAmount: 999999 }));
  });
});

describe("7) scope 'own' (records.edit) sin finance.approve/reject", () => {
  function ownRef(db: FirebaseFirestore.Firestore) {
    return db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_ID_SCOPE);
  }

  it("NO puede modificar NINGÚN campo administrativo, uno por vez", async () => {
    for (const [field, value] of Object.entries(ADMIN_FIELD_ATTEMPTS)) {
      await assertFails(ownRef(ctx(SCOPE_ACTOR_UID)).update({ [field]: value }));
    }
  });

  it("SÍ puede seguir editando campos ordinarios de su propio registro", async () => {
    await assertSucceeds(ownRef(ctx(SCOPE_ACTOR_UID)).update({ nota: "Seguimiento" }));
    await assertSucceeds(ownRef(ctx(SCOPE_ACTOR_UID)).update({ montoAyuda: 150000 }));
  });

  it("combinar ordinario + administrativo en la misma escritura → falla completa", async () => {
    await assertFails(ownRef(ctx(SCOPE_ACTOR_UID)).update({ nota: "Nota legítima", rejectedBy: SCOPE_ACTOR_UID }));
  });
});

describe("8) assigned (records.edit) sin finance.approve/reject", () => {
  function assignedRef(db: FirebaseFirestore.Firestore) {
    return db.collection("candidates").doc(CAND).collection("savedRecords").doc(RECORD_ID_ASSIGNED);
  }

  it("NO puede modificar NINGÚN campo administrativo, uno por vez", async () => {
    for (const [field, value] of Object.entries(ADMIN_FIELD_ATTEMPTS)) {
      await assertFails(assignedRef(ctx(ASSIGNED_ACTOR_UID)).update({ [field]: value }));
    }
  });

  it("SÍ puede seguir editando campos ordinarios del registro que tiene asignado", async () => {
    await assertSucceeds(assignedRef(ctx(ASSIGNED_ACTOR_UID)).update({ nota: "Seguimiento" }));
    await assertSucceeds(assignedRef(ctx(ASSIGNED_ACTOR_UID)).update({ montoAyuda: 150000 }));
  });

  it("combinar ordinario + administrativo en la misma escritura → falla completa", async () => {
    await assertFails(assignedRef(ctx(ASSIGNED_ACTOR_UID)).update({ nota: "Nota legítima", assistanceStatus: "rejected" }));
  });
});

describe("9) control de cordura — la vía correcta sigue funcionando después del cierre del gap", () => {
  it("campaign_admin aprueba normalmente", async () => {
    await assertSucceeds(
      recordRef(ctx(CAMPAIGN_ADMIN_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: CAMPAIGN_ADMIN_UID, approvedAt: new Date(),
      })
    );
  });

  it("rol RBAC con finance.approve aprueba normalmente", async () => {
    await assertSucceeds(
      recordRef(ctx(RBAC_APPROVER_UID)).update({
        assistanceStatus: "approved", approvedAmount: 100000, approvedBy: RBAC_APPROVER_UID, approvedAt: new Date(),
      })
    );
  });

  it("la reapertura controlada del dirigente dueño sigue funcionando", async () => {
    await recordRef(admin.firestore()).update({
      assistanceStatus: "approved", approvedAmount: 100000, approvedBy: CAMPAIGN_ADMIN_UID, approvedAt: new Date(),
    });
    await assertSucceeds(
      recordRef(ctx(DIRIGENTE_UID)).update({ montoAyuda: 150000, assistanceStatus: "pending_approval" })
    );
  });
});
