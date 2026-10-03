// Cajeros DD — fondos operativos por cajero (Finanzas → 💵 Cajeros DD).
//
// DECISIÓN DE ARQUITECTURA (mismo criterio que driverZones.ts, ver su
// comentario de cabecera): TODA escritura de cuentas/movimientos de
// cajero pasa por acá. Dos razones:
//   1. Saldo nunca puede quedar negativo bajo concurrencia — solo
//      demostrable con runTransaction() server-side (Admin SDK).
//   2. Auditoría de manejo de fondos tiene que ser server-authoritative,
//      no autoatestiguada por el cliente (financeAuditLogs hoy se escribe
//      con addDoc() desde el navegador — acá se escribe con Admin SDK,
//      DENTRO de la misma transacción que el movimiento de plata, para
//      que sea imposible mover fondos sin dejar auditoría).
//
// COLECCIONES PROPIAS, SEPARADAS DE LA CAJA GENERAL (Plan C — decisión
// tomada tras auditar Firestore: una regla de lectura para `cashier` que
// dependiera de `resource.data` dentro de la MISMA colección que usa Caja
// general rompía `getCashAccounts()`, que hoy consulta sin ningún filtro
// — Firestore rechaza list()/count() completos cuando la regla no es
// probable a partir de los filtros de la query, no los filtra mal). Por
// eso Cajeros DD vive en `cashierAccounts`/`cashierMovements`,
// completamente separadas de `cashAccounts`/`cashMovements` (Caja
// general, ver firebaseCandidate.js:2946-3038, createCashAccount/
// createCashMovement/getCashAccountBalance — sin ningún cambio, ni un
// campo `type` agregado ahí).
//
// IDEMPOTENCIA: cada función recibe `operationId` (generado en el
// CLIENTE antes de llamar, conservado durante reintentos de esa misma
// operación — nunca generado de nuevo acá). withIdempotency() guarda
// también un fingerprint de los parámetros: mismo operationId + mismos
// parámetros devuelve el resultado cacheado; mismo operationId + parámetros
// DISTINTOS rechaza con error en vez de reusar el resultado viejo en
// silencio (ver función más abajo).
//
// NUNCA se lee/escribe electionDayControl, savedRecords.wantsToBeMesario
// ni ningún flag de compromiso electoral desde este archivo — la
// resolución de beneficiaryVoterId es de solo lectura contra /voters,
// pura trazabilidad administrativa, nunca infiere ni marca preferencia
// electoral de nadie.

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { Auth } from "./lib";

const CASHIER_ROLE = "cashier";
const CASHIER_ADMIN_ROLES = ["campaign_admin", "finance_admin"];

function db() {
  return admin.firestore();
}

function candidateRef(candidateId: string) {
  return db().collection("candidates").doc(candidateId);
}

function cashierAccountsCol(candidateId: string) {
  return candidateRef(candidateId).collection("cashierAccounts");
}

function cashierMovementsCol(candidateId: string) {
  return candidateRef(candidateId).collection("cashierMovements");
}

function cashierOperationsCol(candidateId: string) {
  return candidateRef(candidateId).collection("cashierOperations");
}

function cashierExceptionsCol(candidateId: string) {
  return candidateRef(candidateId).collection("cashierBeneficiaryExceptions");
}

// Fingerprint estable de los parámetros "que definen" una operación —
// JSON.stringify con claves ordenadas, para que el mismo objeto en
// cualquier orden de propiedades produzca el mismo string. No es
// criptográfico, es solo para detectar "¿estos son los MISMOS parámetros
// que la vez pasada?", no para seguridad por oscuridad.
function paramsFingerprint(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of sortedKeys) normalized[k] = params[k] ?? null;
  return JSON.stringify(normalized);
}

// ── Idempotencia ───────────────────────────────────────────────────────
// Doc-id == operationId (idempotency key). Guarda `type` (a qué función
// pertenece) Y `paramsFingerprint` (con qué parámetros se llamó) — dos
// protecciones distintas:
//   1. mismo operationId + función DISTINTA → rechazado (bug de cliente
//      reusando un id entre llamadas a funciones distintas).
//   2. mismo operationId + MISMA función pero parámetros DISTINTOS →
//      rechazado explícitamente, nunca se devuelve el resultado viejo
//      en silencio (así un operationId reciclado por error para "otra
//      operación" del mismo tipo, ej. otro monto, no pasa desapercibido).
// Solo "mismo operationId + mismos parámetros" devuelve el resultado
// cacheado sin escribir nada nuevo — la definición real de idempotencia.
//
// Se lee como PRIMERA operación de la transacción (Firestore exige todas
// las lecturas antes de cualquier escritura) — si ya existe y calza,
// devuelve `result` cacheado; si no existe, corre `work()` (que hace sus
// propias lecturas/escrituras dentro de la misma transacción) y persiste
// el resultado al final.
async function withIdempotency<T>(
  candidateId: string,
  operationType: string,
  operationId: string,
  params: Record<string, unknown>,
  work: (tx: FirebaseFirestore.Transaction) => Promise<T>
): Promise<T> {
  if (!operationId || typeof operationId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Falta operationId — el cliente debe generarlo antes de llamar y conservarlo en reintentos"
    );
  }
  const fingerprint = paramsFingerprint(params);
  const opRef = cashierOperationsCol(candidateId).doc(operationId);
  return db().runTransaction(async (tx) => {
    const opSnap = await tx.get(opRef);
    if (opSnap.exists) {
      const existing = opSnap.data() as { type: string; paramsFingerprint: string; result: T };
      if (existing.type !== operationType) {
        throw new functions.https.HttpsError(
          "already-exists",
          `El operationId ya se usó para una operación distinta (${existing.type})`
        );
      }
      if (existing.paramsFingerprint !== fingerprint) {
        throw new functions.https.HttpsError(
          "already-exists",
          "El operationId ya se usó con parámetros distintos — no se puede reutilizar para otra operación, generá uno nuevo"
        );
      }
      return existing.result;
    }
    const result = await work(tx);
    tx.set(opRef, {
      type: operationType,
      paramsFingerprint: fingerprint,
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

// ── Roles del caller (más granular que requireCandidateRole de lib.ts —
// acá hace falta distinguir admin vs. dueño de cuenta puntual, no solo
// "tiene algún rol permitido") ───────────────────────────────────────────
async function readCallerRoles(
  tx: FirebaseFirestore.Transaction,
  candidateId: string,
  uid: string
) {
  const [platformSnap, memberSnap] = await Promise.all([
    tx.get(db().collection("platformUsers").doc(uid)),
    tx.get(candidateRef(candidateId).collection("users").doc(uid)),
  ]);
  const isSuperAdmin = platformSnap.data()?.globalRole === "superadmin";
  const memberData = memberSnap.data();
  const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
  const roles = new Set<string>([memberData?.role, ...roleIds].filter(Boolean));
  const isAdmin = isSuperAdmin || CASHIER_ADMIN_ROLES.some((r) => roles.has(r));
  if (!isSuperAdmin && !memberSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "No pertenecés a este candidato");
  }
  return { isSuperAdmin, isAdmin, roles, memberExists: memberSnap.exists };
}

function requireAuth(auth: Auth): string {
  if (!auth) {
    throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesión");
  }
  return auth.uid;
}

// Auditoría DENTRO de la transacción — nunca queda un movimiento sin su
// entrada de auditoría, ni al revés. Reusa la colección financeAuditLogs
// existente (mismo shape que logFinanceAudit en firebaseCandidate.js) pero
// escrita con Admin SDK, no por el cliente.
function writeAuditInTx(
  tx: FirebaseFirestore.Transaction,
  candidateId: string,
  entry: {
    actorUid: string;
    action: string;
    entityType: string;
    entityId: string;
    previousData: any;
    newData: any;
    reason?: string;
  }
) {
  const ref = candidateRef(candidateId).collection("financeAuditLogs").doc();
  tx.set(ref, {
    candidateId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    previousData: entry.previousData,
    newData: entry.newData,
    performedBy: entry.actorUid,
    reason: entry.reason || "",
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ── 1. crearCuentaCajero ─────────────────────────────────────────────────
// Un cajero, una cuenta cajero_dia_d ACTIVA a la vez por candidato (ver
// decisión de diseño del plan) — para "reiniciar" a un cajero hay que
// cerrar la vieja y crear una nueva, nunca reasignar responsibleUserId.
export const crearCuentaCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, responsibleUserId, name, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !responsibleUserId || !operationId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan candidateId/responsibleUserId/operationId"
      );
    }

    return withIdempotency(candidateId, "crearCuentaCajero", operationId, { responsibleUserId, name }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden crear cuentas de cajero"
        );
      }

      const responsibleSnap = await tx.get(
        candidateRef(candidateId).collection("users").doc(responsibleUserId)
      );
      const respData = responsibleSnap.data();
      const respRoleIds: string[] = Array.isArray(respData?.roleIds) ? respData!.roleIds : [];
      const esCajero = respData?.role === CASHIER_ROLE || respRoleIds.includes(CASHIER_ROLE);
      if (!responsibleSnap.exists || !esCajero) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "El usuario indicado no tiene rol cashier en este candidato"
        );
      }

      const existingSnap = await tx.get(
        cashierAccountsCol(candidateId)
          .where("responsibleUserId", "==", responsibleUserId)
          .where("status", "==", "active")
      );
      if (!existingSnap.empty) {
        throw new functions.https.HttpsError(
          "already-exists",
          "Este cajero ya tiene una cuenta activa — cerrala antes de crear otra"
        );
      }

      const ref = cashierAccountsCol(candidateId).doc();
      const payload = {
        candidateId,
        status: "active",
        name: name || `Cajero — ${respData?.nombre || responsibleUserId}`,
        responsibleUserId,
        initialBalance: 0,
        balance: 0,
        currency: "PYG",
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ref, payload);
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_account_create",
        entityType: "cashierAccounts",
        entityId: ref.id,
        previousData: null,
        newData: payload,
      });
      return { cashAccountId: ref.id };
    });
  }
);

// ── 2. asignarFondosCajero ───────────────────────────────────────────────
export const asignarFondosCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cashAccountId, amount, reason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !operationId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan campos requeridos");
    }
    const montoNum = Number(amount);
    if (!(montoNum > 0)) {
      throw new functions.https.HttpsError("invalid-argument", "El monto debe ser mayor a 0");
    }

    return withIdempotency(candidateId, "asignarFondosCajero", operationId, { cashAccountId, amount: montoNum, reason }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden asignar fondos"
        );
      }

      const accountRef = cashierAccountsCol(candidateId).doc(cashAccountId);
      const accountSnap = await tx.get(accountRef);
      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      const account = accountSnap.data()!;
      if (account.status !== "active") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "La cuenta está cerrada — reabrila antes de asignar fondos"
        );
      }

      const saldoActual = Number(account.balance || 0);
      const nuevoBalance = saldoActual + montoNum;

      const movRef = cashierMovementsCol(candidateId).doc();
      const movPayload = {
        candidateId,
        cashAccountId,
        // Denormalizado desde la cuenta a propósito (lesson learned del
        // proyecto, PROJECT_CONTEXT_MASTER.md §4): una regla de lectura
        // de list()/count() que depende de get() a OTRO doc se rechaza
        // por completo si no hay un filtro de query que la respalde —
        // con responsibleUserId acá mismo, la regla de cashierMovements
        // compara contra resource.data directo (sin get()) y la query del
        // cliente siempre filtra where('responsibleUserId','==',uid),
        // así Firestore puede probar la regla contra el filtro.
        responsibleUserId: account.responsibleUserId,
        type: "fund_assignment",
        amount: montoNum,
        currency: account.currency || "PYG",
        concept: "Asignación de fondos",
        description: reason || "",
        beneficiaryVoterId: null,
        beneficiaryCI: null,
        beneficiaryName: null,
        status: "confirmed",
        balanceAfter: nuevoBalance,
        operationId,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(movRef, movPayload);
      tx.update(accountRef, { balance: nuevoBalance, updatedAt: FieldValue.serverTimestamp() });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_fund_assignment",
        entityType: "cashierMovements",
        entityId: movRef.id,
        previousData: { balance: saldoActual },
        newData: { balance: nuevoBalance, amount: montoNum },
        reason,
      });
      return { movementId: movRef.id, balanceAfter: nuevoBalance };
    });
  }
);

// ── 2b. buscarBeneficiarioCajero ─────────────────────────────────────────
// AUDITORÍA 2026-10-03: antes el cliente buscaba el beneficiario con un
// query directo a savedRecords (getOwnRecordByCedula/getRecordByCedula,
// firebaseCandidate.js) — eso solo puede funcionar si firestore.rules
// puede "demostrar" el permiso a partir de la query. Para un cajero
// común (no admin) la única regla que aplica es resource.data.uid ==
// request.auth.uid, así que la query NECESITABA además un
// where('uid','==',...) — eso acotaba la búsqueda a "votantes capturados
// por ESTE MISMO uid", cuando lo que pide el negocio es "cualquiera de
// nuestros votantes" (candidato entero, sin importar qué dirigente lo
// capturó — por eso se muestra "dirigente responsable" en vez de
// restringir por él). Esa fue la causa real de "No se encontró esa CI
// entre tus registros" para una CI real y bien cargada, de OTRO
// dirigente: no era un problema de normalización de CI (confirmado
// contra datos reales de producción — cedula siempre string limpio) ni
// de candidateId/localidad, era directamente una búsqueda demasiado
// angosta. Server-side (Admin SDK) no tiene esa limitación, así que la
// búsqueda completa (candidato entero + padrón completo) se resuelve
// acá, con la MISMA autorización de acceso que registrarEgresoCajero
// (dueño de ESTA cuenta de cajero, o admin de Finanzas) — nunca le
// devuelve datos de otro candidato ni de otra cuenta.
export const buscarBeneficiarioCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cashAccountId, ci } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !ci) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/cashAccountId/ci");
    }
    const ciLimpia = String(ci).trim();
    if (!ciLimpia) {
      throw new functions.https.HttpsError("invalid-argument", "CI vacía");
    }

    const [platformSnap, memberSnap, accountSnap, candidateSnap] = await Promise.all([
      db().collection("platformUsers").doc(callerUid).get(),
      candidateRef(candidateId).collection("users").doc(callerUid).get(),
      cashierAccountsCol(candidateId).doc(cashAccountId).get(),
      candidateRef(candidateId).get(),
    ]);
    if (!accountSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
    }
    const account = accountSnap.data()!;
    const isSuperAdmin = platformSnap.data()?.globalRole === "superadmin";
    const memberData = memberSnap.data();
    const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
    const roles = new Set<string>([memberData?.role, ...roleIds].filter(Boolean));
    const isAdmin = isSuperAdmin || CASHIER_ADMIN_ROLES.some((r) => roles.has(r));
    const isOwner = account.responsibleUserId === callerUid;
    if (!isAdmin && !isOwner) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Solo el cajero dueño de esta cuenta (o un admin de Finanzas) puede buscar beneficiarios acá"
      );
    }

    // A/B: "nuestro" votante — savedRecords de TODO el candidato (nunca
    // acotado a un dirigente puntual, ver cabecera de arriba).
    const recordSnap = await candidateRef(candidateId)
      .collection("savedRecords")
      .where("cedula", "==", ciLimpia)
      .limit(1)
      .get();

    if (!recordSnap.empty) {
      const rec = recordSnap.docs[0];
      const data = rec.data();
      let dirigenteNombre: string | null = null;
      if (data.uid) {
        const dirSnap = await candidateRef(candidateId).collection("users").doc(data.uid).get();
        dirigenteNombre = dirSnap.data()?.nombre || dirSnap.data()?.email || null;
      }
      if (data.assistanceStatus === "approved" && Number(data.approvedAmount) > 0) {
        return {
          scenario: "A",
          recordId: rec.id,
          nombre: data.nombre || "",
          cedula: data.cedula,
          approvedAmount: Number(data.approvedAmount),
          dirigenteNombre,
        };
      }
      return { scenario: "B", nombre: data.nombre || "", cedula: data.cedula, dirigenteNombre };
    }

    // C/D: no es "nuestro" — ver si existe en el padrón completo de la
    // localidad de este candidato.
    const localidad = candidateSnap.data()?.localidad || "";
    const voterSnap = await db()
      .collection("voters")
      .where("cedula", "==", ciLimpia)
      .where("localidad", "==", localidad)
      .limit(1)
      .get();
    if (voterSnap.empty) {
      return { scenario: "D" };
    }
    const voter = voterSnap.docs[0].data();

    // ¿Ya hay una excepción activa (pendiente o aprobada sin consumir)
    // para este beneficiario? Como máximo debería haber una a la vez
    // (solicitarExcepcionBeneficiario lo exige), pero por las dudas se
    // prioriza: aprobada > pendiente > rechazada (una rechazada no
    // bloquea pedir de nuevo).
    const excSnap = await cashierExceptionsCol(candidateId)
      .where("beneficiaryCI", "==", ciLimpia)
      .where("consumed", "==", false)
      .get();
    let excepcion: any = null;
    for (const d of excSnap.docs) {
      const e = d.data();
      const status = e.status ?? "approved";
      if (status === "approved") { excepcion = { id: d.id, status, approvedAmount: Number(e.approvedAmount) || 0 }; break; }
      if (status === "pending" && !excepcion) excepcion = { id: d.id, status, suggestedAmount: Number(e.suggestedAmount) || 0 };
    }

    const settingsSnap = await candidateRef(candidateId).collection("config").doc("financeSettings").get();
    return {
      scenario: "C",
      nombre: voter.nombre || "",
      cedula: ciLimpia,
      maxVoterAssistanceAmount: Number(settingsSnap.data()?.maxVoterAssistanceAmount) || 0,
      excepcion,
    };
  }
);

// Centraliza el chequeo de que una excepción indicada sea USABLE para
// pagar — reusado por los 2 casos de registrarEgresoCajero que la
// necesitan (reasistencia y beneficiario que no es "nuestro"). Nunca
// escribe nada, solo valida y devuelve los datos de la excepción.
function validarExcepcionUsable(
  exceptionSnap: FirebaseFirestore.DocumentSnapshot | null,
  exceptionAuthorizationId: string | undefined,
  candidateId: string,
  beneficiaryVoterId: string,
  montoNum: number,
  mensajeSiFalta: string
): FirebaseFirestore.DocumentData {
  if (!exceptionAuthorizationId || !exceptionSnap || !exceptionSnap.exists) {
    throw new functions.https.HttpsError("failed-precondition", mensajeSiFalta);
  }
  const exc = exceptionSnap.data()!;
  if (exc.candidateId !== candidateId || exc.beneficiaryVoterId !== beneficiaryVoterId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "La autorización excepcional indicada no corresponde a este beneficiario"
    );
  }
  if (exc.consumed) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Esta autorización excepcional ya fue utilizada — se necesita una nueva"
    );
  }
  // `status` es nuevo (auditoría 2026-10-03) — docs legacy creados por
  // autorizarExcepcionBeneficiario antes de este cambio no lo tienen, y
  // SIEMPRE fueron ya-aprobados en el momento de crearse (no existía
  // estado 'pending' todavía), así que ausencia de status se trata
  // igual que 'approved'. Una excepción todavía 'pending' o ya
  // 'rejected' nunca puede usarse para pagar.
  const status = exc.status ?? "approved";
  if (status !== "approved") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      status === "pending"
        ? "Esta autorización excepcional todavía está pendiente de aprobación por un administrador"
        : "Esta autorización excepcional fue rechazada"
    );
  }
  // El monto a pagar con una excepción es el que el administrador
  // aprobó, nunca uno distinto que el cajero pueda escribir — mismo
  // principio que "el cajero solo visualiza y confirma". Las excepciones
  // legacy (creadas por autorizarExcepcionBeneficiario, que no pide
  // monto) quedan con approvedAmount en null/0 — ahí no hay nada que
  // comparar, se mantiene el comportamiento de siempre.
  const montoAprobado = Number(exc.approvedAmount);
  if (montoAprobado > 0 && montoNum !== montoAprobado) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `El monto no coincide con el aprobado para esta excepción (Gs. ${montoAprobado})`
    );
  }
  return exc;
}

// ── 3. registrarEgresoCajero ─────────────────────────────────────────────
// La función más sensible del archivo: saldo, identidad del beneficiario
// contra el padrón de la LOCALIDAD DEL CANDIDATO, y reasistencia.
export const registrarEgresoCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const {
      candidateId,
      cashAccountId,
      amount,
      concept,
      beneficiaryCI,
      exceptionAuthorizationId,
      receiptUrl,
      operationId,
    } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !concept || !operationId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan campos requeridos");
    }
    const montoNum = Number(amount);
    if (!(montoNum > 0)) {
      throw new functions.https.HttpsError("invalid-argument", "El monto debe ser mayor a 0");
    }

    return withIdempotency(
      candidateId,
      "registrarEgresoCajero",
      operationId,
      { cashAccountId, amount: montoNum, concept, beneficiaryCI: beneficiaryCI || null, exceptionAuthorizationId: exceptionAuthorizationId || null, receiptUrl: receiptUrl || null },
      async (tx) => {
      // ── LECTURAS (todas antes de cualquier escritura) ──────────────────
      const [platformSnap, memberSnap, accountSnap, candidateSnap] = await Promise.all([
        tx.get(db().collection("platformUsers").doc(callerUid)),
        tx.get(candidateRef(candidateId).collection("users").doc(callerUid)),
        tx.get(cashierAccountsCol(candidateId).doc(cashAccountId)),
        tx.get(candidateRef(candidateId)),
      ]);

      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      const account = accountSnap.data()!;
      if (account.status !== "active") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "La cuenta está cerrada — no admite egresos"
        );
      }

      const isSuperAdmin = platformSnap.data()?.globalRole === "superadmin";
      const memberData = memberSnap.data();
      const roleIds: string[] = Array.isArray(memberData?.roleIds) ? memberData!.roleIds : [];
      const roles = new Set<string>([memberData?.role, ...roleIds].filter(Boolean));
      const isAdmin = isSuperAdmin || CASHIER_ADMIN_ROLES.some((r) => roles.has(r));
      const isOwner = account.responsibleUserId === callerUid;
      if (!isAdmin && !isOwner) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo el cajero dueño de esta cuenta (o un admin de Finanzas) puede registrar egresos acá"
        );
      }

      const candidateLocalidad = candidateSnap.data()?.localidad || "";
      const ciLimpia = beneficiaryCI ? String(beneficiaryCI).trim() : "";

      let voterSnap: FirebaseFirestore.QuerySnapshot | null = null;
      // AUDITORÍA 2026-10-03 (escenarios A/B/C/D): además del padrón
      // compartido (/voters, para resolver identidad/beneficiaryVoterId,
      // sin cambios), hace falta saber si esta CI es uno de "nuestros"
      // votantes (savedRecords de ESTE candidato, candidato entero — ver
      // mismo criterio que buscarBeneficiarioCajero) para decidir si el
      // pago sale de la ayuda ya aprobada para esa persona, o si
      // necesita sí o sí una excepción (beneficiario que no es nuestro).
      let nuestroRecordSnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (ciLimpia) {
        [voterSnap, nuestroRecordSnap] = await Promise.all([
          tx.get(
            db()
              .collection("voters")
              .where("cedula", "==", ciLimpia)
              .where("localidad", "==", candidateLocalidad)
              .limit(1)
          ),
          tx.get(
            candidateRef(candidateId).collection("savedRecords").where("cedula", "==", ciLimpia).limit(1)
          ),
        ]);
      }
      const nuestroRecord = nuestroRecordSnap && !nuestroRecordSnap.empty ? nuestroRecordSnap.docs[0].data() : null;

      let beneficiaryVoterId: string | null = null;
      let beneficiaryName: string | null = null;
      if (ciLimpia) {
        if (!voterSnap || voterSnap.empty) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `CI ${ciLimpia} no encontrada en el padrón de la localidad de este candidato (${candidateLocalidad || "sin localidad configurada"})`
          );
        }
        beneficiaryVoterId = voterSnap.docs[0].id;
        beneficiaryName = voterSnap.docs[0].data().nombre || "";
      }

      // Prevención de duplicados: candidateId + beneficiaryVoterId (el id
      // real del padrón, NO el texto de la CI) — un egreso 'expense'
      // 'confirmed' previo a este beneficiario en ESTE candidato exige
      // autorización excepcional vigente.
      let dupSnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (beneficiaryVoterId) {
        dupSnap = await tx.get(
          cashierMovementsCol(candidateId)
            .where("beneficiaryVoterId", "==", beneficiaryVoterId)
            .where("type", "==", "expense")
            .where("status", "==", "confirmed")
            .limit(1)
        );
      }

      let exceptionSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (exceptionAuthorizationId) {
        exceptionSnap = await tx.get(cashierExceptionsCol(candidateId).doc(exceptionAuthorizationId));
      }

      // ── VALIDACIONES (después de todas las lecturas) ───────────────────
      // AUDITORÍA 2026-10-03 (escenarios A/B/C/D): antes esto SOLO exigía
      // excepción para un SEGUNDO pago al mismo beneficiarioVoterId
      // (dupSnap) — nunca verificaba que el monto pagado coincidiera con
      // la ayuda realmente aprobada para esa persona (confiaba ciegamente
      // en `amount`, lo que el cliente mandara), y no existía ningún gate
      // para pagarle a alguien que NO es "nuestro" votante (solo está en
      // el padrón general) — ese caso simplemente no se contemplaba.
      // validarExcepcionUsable() (función de abajo) centraliza el
      // chequeo de excepción para los 2 casos reales que la necesitan:
      // reasistencia (ya cobró antes) y beneficiario ajeno (nunca es
      // "nuestro").
      let exceptionRef: FirebaseFirestore.DocumentReference | null = null;
      let exceptionDataUsed: FirebaseFirestore.DocumentData | null = null;
      if (ciLimpia && beneficiaryVoterId) {
        if (nuestroRecord) {
          // Camino normal: "nuestro" votante con ayuda ya aprobada por
          // Finanzas — el monto a pagar es EXACTAMENTE el aprobado, el
          // cajero nunca puede pagar un monto distinto (ver pedido
          // explícito "el cajero solo visualiza y confirma").
          if (nuestroRecord.assistanceStatus !== "approved" || !(Number(nuestroRecord.approvedAmount) > 0)) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              "Este votante pertenece a nuestros registros, pero no tiene una ayuda autorizada para cobrar"
            );
          }
          const montoAprobadoVotante = Number(nuestroRecord.approvedAmount);
          if (montoNum !== montoAprobadoVotante) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              `El monto no coincide con la ayuda aprobada para este votante (Gs. ${montoAprobadoVotante})`
            );
          }
          if (dupSnap && !dupSnap.empty) {
            // Reasistencia — ya recibió un aporte antes, hace falta una
            // excepción vigente para uno adicional (mecanismo original).
            const exc = validarExcepcionUsable(
              exceptionSnap, exceptionAuthorizationId, candidateId, beneficiaryVoterId, montoNum,
              "Este beneficiario ya recibió un aporte — se necesita una autorización excepcional aprobada para un segundo aporte"
            );
            exceptionRef = exceptionSnap!.ref;
            exceptionDataUsed = exc;
          }
        } else {
          // No es "nuestro" votante (solo está en el padrón general) —
          // SIEMPRE requiere una excepción aprobada, aunque sea el
          // primer pago a esta persona (escenario C del pedido).
          const exc = validarExcepcionUsable(
            exceptionSnap, exceptionAuthorizationId, candidateId, beneficiaryVoterId, montoNum,
            "Este beneficiario no es uno de nuestros votantes — hace falta una autorización excepcional aprobada por un administrador"
          );
          exceptionRef = exceptionSnap!.ref;
          exceptionDataUsed = exc;
        }
      }

      const saldoActual = Number(account.balance || 0);
      if (montoNum > saldoActual) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Saldo insuficiente (disponible: ${saldoActual}, solicitado: ${montoNum})`
        );
      }
      const nuevoBalance = saldoActual - montoNum;

      // ── ESCRITURAS ───────────────────────────────────────────────────
      const movRef = cashierMovementsCol(candidateId).doc();
      const movPayload = {
        candidateId,
        cashAccountId,
        responsibleUserId: account.responsibleUserId, // denormalizado, ver fund_assignment
        type: "expense",
        amount: montoNum,
        currency: account.currency || "PYG",
        concept,
        description: "",
        beneficiaryVoterId,
        beneficiaryCI: ciLimpia || null,
        beneficiaryName,
        receiptUrl: receiptUrl || null,
        status: "confirmed",
        balanceAfter: nuevoBalance,
        operationId,
        exceptionAuthorization: exceptionRef
          ? {
              authorizedBy: exceptionDataUsed!.authorizedBy,
              authorizedAt: exceptionDataUsed!.authorizedAt,
              reason: exceptionDataUsed!.reason,
              exceptionDocId: exceptionRef.id,
            }
          : null,
        createdBy: callerUid,
        createdByRole: isOwner ? "cashier" : "admin",
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(movRef, movPayload);
      tx.update(cashierAccountsCol(candidateId).doc(cashAccountId), {
        balance: nuevoBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (exceptionRef) {
        tx.update(exceptionRef, {
          consumed: true,
          consumedAt: FieldValue.serverTimestamp(),
          consumedByMovementId: movRef.id,
        });
      }
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_expense",
        entityType: "cashierMovements",
        entityId: movRef.id,
        previousData: { balance: saldoActual },
        newData: { balance: nuevoBalance, amount: montoNum, beneficiaryVoterId },
      });
      return { movementId: movRef.id, balanceAfter: nuevoBalance, beneficiaryVoterId, beneficiaryName };
    });
  }
);

// ── 4. solicitarAnulacionMovimiento ──────────────────────────────────────
export const solicitarAnulacionMovimiento = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, movementId, reason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !movementId || !reason || !operationId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos (el motivo es obligatorio)"
      );
    }

    return withIdempotency(candidateId, "solicitarAnulacionMovimiento", operationId, { movementId, reason }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      const movRef = cashierMovementsCol(candidateId).doc(movementId);
      const movSnap = await tx.get(movRef);
      if (!movSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Movimiento no encontrado");
      }
      const mov = movSnap.data()!;
      const isOwner = mov.createdBy === callerUid;
      if (!callerRoles.isAdmin && !isOwner) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo quien creó el movimiento (o un admin de Finanzas) puede solicitar su anulación"
        );
      }
      if (mov.status !== "confirmed") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Solo se puede pedir anulación de un movimiento confirmado"
        );
      }
      if (mov.voidRequest && mov.voidRequest.status === "pending") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Ya hay una solicitud de anulación pendiente para este movimiento"
        );
      }

      tx.update(movRef, {
        voidRequest: {
          requestedBy: callerUid,
          requestedAt: FieldValue.serverTimestamp(),
          reason,
          status: "pending",
          resolvedBy: null,
          resolvedAt: null,
          resolution: null,
        },
      });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_void_request",
        entityType: "cashierMovements",
        entityId: movementId,
        previousData: null,
        newData: { status: "pending" },
        reason,
      });
      return { ok: true };
    });
  }
);

// ── 5. resolverAnulacionMovimiento ───────────────────────────────────────
// Genera EXACTAMENTE un void_compensation por aprobación — el movimiento
// original NUNCA se borra ni se edita en sus campos financieros, solo
// queda marcado status:'voided' (más el resultado de voidRequest). Doble
// aprobación concurrente queda bloqueada por la relectura transaccional
// de `voidRequest.status`/`mov.status` — Firestore reintenta la
// transacción perdedora, que ve el estado ya resuelto y aborta.
export const resolverAnulacionMovimiento = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, movementId, decision, resolution, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !movementId || !operationId || !["approve", "reject"].includes(decision)) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan campos requeridos o decision inválida");
    }

    return withIdempotency(candidateId, "resolverAnulacionMovimiento", operationId, { movementId, decision, resolution: resolution || null }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden resolver anulaciones"
        );
      }

      const movRef = cashierMovementsCol(candidateId).doc(movementId);
      const movSnap = await tx.get(movRef);
      if (!movSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Movimiento no encontrado");
      }
      const mov = movSnap.data()!;
      if (!mov.voidRequest || mov.voidRequest.status !== "pending") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "No hay una solicitud de anulación pendiente para este movimiento"
        );
      }
      if (mov.status === "voided") {
        throw new functions.https.HttpsError("failed-precondition", "Este movimiento ya fue anulado");
      }
      if (!callerRoles.isSuperAdmin && mov.voidRequest.requestedBy === callerUid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Quien solicitó la anulación no puede resolverla — necesita actuar otro administrador"
        );
      }

      if (decision === "reject") {
        tx.update(movRef, {
          "voidRequest.status": "rejected",
          "voidRequest.resolvedBy": callerUid,
          "voidRequest.resolvedAt": FieldValue.serverTimestamp(),
          "voidRequest.resolution": resolution || "",
        });
        writeAuditInTx(tx, candidateId, {
          actorUid: callerUid,
          action: "cashier_void_reject",
          entityType: "cashierMovements",
          entityId: movementId,
          previousData: null,
          newData: { status: "rejected" },
          reason: resolution,
        });
        return { ok: true, approved: false };
      }

      // decision === 'approve'
      const accountRef = cashierAccountsCol(candidateId).doc(mov.cashAccountId);
      // Defensa adicional, además del mutex transaccional de arriba
      // (mov.status/voidRequest.status, que ya por sí solo hace
      // estructuralmente imposible una doble aprobación concurrente —
      // Firestore serializa las escrituras a movRef): se confirma acá
      // TAMBIÉN que no exista ya ningún void_compensation con este
      // originalMovementId, por si alguna vez se llega a este punto por
      // un camino que no pasó por el chequeo de status (ej. un bug
      // futuro). Cinturón y tirantes, no es redundante con la idempotencia
      // (esa protege contra reintentos del MISMO operationId; esto
      // protege contra dos operationId DISTINTOS apuntando al mismo
      // movementId).
      const [accountSnap, existingCompSnap] = await Promise.all([
        tx.get(accountRef),
        tx.get(cashierMovementsCol(candidateId).where("originalMovementId", "==", movementId).limit(1)),
      ]);
      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      if (!existingCompSnap.empty) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Ya existe un movimiento compensatorio para esta anulación — no se genera un segundo"
        );
      }
      const account = accountSnap.data()!;
      const saldoActual = Number(account.balance || 0);
      const montoOriginal = Number(mov.amount) || 0;
      // Compensatorio INVIERTE el efecto del original: anular un egreso
      // devuelve el monto (+); anular una asignación lo resta (-).
      const nuevoBalance =
        mov.type === "expense" ? saldoActual + montoOriginal : saldoActual - montoOriginal;
      if (nuevoBalance < 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Anular esta asignación dejaría el saldo negativo — hay que resolver el sobregiro antes de anular"
        );
      }

      const compRef = cashierMovementsCol(candidateId).doc();
      const compPayload = {
        candidateId,
        cashAccountId: mov.cashAccountId,
        responsibleUserId: account.responsibleUserId, // denormalizado, ver fund_assignment
        type: "void_compensation",
        originalMovementId: movementId,
        amount: montoOriginal,
        currency: mov.currency || "PYG",
        concept: `Anulación de movimiento ${movementId}`,
        description: resolution || "",
        beneficiaryVoterId: mov.beneficiaryVoterId || null,
        beneficiaryCI: mov.beneficiaryCI || null,
        beneficiaryName: mov.beneficiaryName || null,
        status: "confirmed",
        balanceAfter: nuevoBalance,
        operationId,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(compRef, compPayload);
      tx.update(accountRef, { balance: nuevoBalance, updatedAt: FieldValue.serverTimestamp() });
      tx.update(movRef, {
        status: "voided",
        "voidRequest.status": "approved",
        "voidRequest.resolvedBy": callerUid,
        "voidRequest.resolvedAt": FieldValue.serverTimestamp(),
        "voidRequest.resolution": resolution || "",
      });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_void_approve",
        entityType: "cashierMovements",
        entityId: movementId,
        previousData: { balance: saldoActual },
        newData: { balance: nuevoBalance, compensationMovementId: compRef.id },
        reason: resolution,
      });
      return { ok: true, approved: true, compensationMovementId: compRef.id, balanceAfter: nuevoBalance };
    });
  }
);

// ── 6. cerrarCuentaCajero ────────────────────────────────────────────────
// closed no admite egresos NI nuevas asignaciones NI cambio de
// responsable (decisión de diseño explícita del plan) — solo reabrirse.
export const cerrarCuentaCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cashAccountId, reason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !reason || !operationId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos (el motivo es obligatorio)"
      );
    }

    return withIdempotency(candidateId, "cerrarCuentaCajero", operationId, { cashAccountId, reason }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden cerrar cuentas de cajero"
        );
      }
      const accountRef = cashierAccountsCol(candidateId).doc(cashAccountId);
      const accountSnap = await tx.get(accountRef);
      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      if (accountSnap.data()?.status === "closed") {
        throw new functions.https.HttpsError("failed-precondition", "La cuenta ya está cerrada");
      }
      tx.update(accountRef, {
        status: "closed",
        closedAt: FieldValue.serverTimestamp(),
        closedBy: callerUid,
        closedReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_account_close",
        entityType: "cashierAccounts",
        entityId: cashAccountId,
        previousData: { status: "active" },
        newData: { status: "closed" },
        reason,
      });
      return { ok: true };
    });
  }
);

// ── 7. reabrirCuentaCajero ───────────────────────────────────────────────
export const reabrirCuentaCajero = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cashAccountId, reason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !reason || !operationId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos (el motivo es obligatorio)"
      );
    }

    return withIdempotency(candidateId, "reabrirCuentaCajero", operationId, { cashAccountId, reason }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden reabrir cuentas de cajero"
        );
      }
      const accountRef = cashierAccountsCol(candidateId).doc(cashAccountId);
      const accountSnap = await tx.get(accountRef);
      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      if (accountSnap.data()?.status !== "closed") {
        throw new functions.https.HttpsError("failed-precondition", "La cuenta no está cerrada");
      }
      tx.update(accountRef, {
        status: "active",
        reopenedAt: FieldValue.serverTimestamp(),
        reopenedBy: callerUid,
        reopenedReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_account_reopen",
        entityType: "cashierAccounts",
        entityId: cashAccountId,
        previousData: { status: "closed" },
        newData: { status: "active" },
        reason,
      });
      return { ok: true };
    });
  }
);

// ── 8. autorizarExcepcionBeneficiario ────────────────────────────────────
// Por beneficiario concreto (resuelto contra el padrón de la localidad
// del candidato, no texto de CI suelto), un solo uso, motivo obligatorio.
// El consumo atómico ocurre DENTRO de registrarEgresoCajero, no acá.
export const autorizarExcepcionBeneficiario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, beneficiaryCI, reason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !beneficiaryCI || !reason || !operationId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan campos requeridos (el motivo es obligatorio)"
      );
    }

    return withIdempotency(candidateId, "autorizarExcepcionBeneficiario", operationId, { beneficiaryCI, reason }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden autorizar una excepción de reasistencia"
        );
      }

      const candidateSnap = await tx.get(candidateRef(candidateId));
      const localidad = candidateSnap.data()?.localidad || "";
      const ci = String(beneficiaryCI).trim();
      const voterSnap = await tx.get(
        db().collection("voters").where("cedula", "==", ci).where("localidad", "==", localidad).limit(1)
      );
      if (voterSnap.empty) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `CI ${ci} no encontrada en el padrón de la localidad de este candidato (${localidad || "sin localidad configurada"})`
        );
      }
      const beneficiaryVoterId = voterSnap.docs[0].id;
      const beneficiaryName = voterSnap.docs[0].data().nombre || "";

      const excRef = cashierExceptionsCol(candidateId).doc();
      const payload = {
        candidateId,
        beneficiaryVoterId,
        beneficiaryCI: ci,
        beneficiaryName,
        reason,
        // `status` (auditoría 2026-10-03): esta función siempre crea la
        // excepción YA aprobada (es el admin autorizando directamente,
        // nunca una solicitud pendiente) — se deja sin `approvedAmount`
        // a propósito, porque este flujo nunca pidió un monto (lo define
        // el cajero al pagar, igual que siempre); registrarEgresoCajero
        // solo exige que el monto coincida con approvedAmount cuando ese
        // campo SÍ está seteado (ver solicitarExcepcionBeneficiario/
        // resolverExcepcionBeneficiario, que sí lo fijan).
        status: "approved",
        approvedAmount: null,
        authorizedBy: callerUid,
        authorizedAt: FieldValue.serverTimestamp(),
        consumed: false,
        consumedAt: null,
        consumedByMovementId: null,
      };
      tx.set(excRef, payload);
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_exception_authorize",
        entityType: "cashierBeneficiaryExceptions",
        entityId: excRef.id,
        previousData: null,
        newData: payload,
        reason,
      });
      return { exceptionId: excRef.id, beneficiaryVoterId, beneficiaryName };
    });
  }
);

// ── 8b. solicitarExcepcionBeneficiario ───────────────────────────────────
// Camino NUEVO, iniciado por el cajero (a diferencia de la función de
// arriba, que es el admin autorizando directo) — crea la excepción en
// estado 'pending', nunca usable todavía para pagar (ver chequeo de
// `status` en registrarEgresoCajero). El monto SUGERIDO viene de
// Finanzas > Configuración > "Ayuda máxima por votante" — el admin
// puede aprobarlo tal cual o modificarlo al resolver (ver función
// siguiente), nunca lo fija el cajero.
export const solicitarExcepcionBeneficiario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, cashAccountId, beneficiaryCI, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !cashAccountId || !beneficiaryCI || !operationId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/cashAccountId/beneficiaryCI/operationId");
    }

    return withIdempotency(candidateId, "solicitarExcepcionBeneficiario", operationId, { cashAccountId, beneficiaryCI }, async (tx) => {
      const ci = String(beneficiaryCI).trim();
      // 1ra tanda de lecturas — todavía no se conoce `localidad` (hace
      // falta candidateSnap para eso), así que la búsqueda en /voters va
      // en una 2da tanda, pero SIGUE siendo antes de cualquier escritura
      // (Firestore solo exige ese orden, no que sea una sola tanda).
      const [accountSnap, candidateSnap, settingsSnap, callerRoles] = await Promise.all([
        tx.get(cashierAccountsCol(candidateId).doc(cashAccountId)),
        tx.get(candidateRef(candidateId)),
        tx.get(candidateRef(candidateId).collection("config").doc("financeSettings")),
        readCallerRoles(tx, candidateId, callerUid),
      ]);

      if (!accountSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Cuenta de cajero no encontrada");
      }
      const account = accountSnap.data()!;
      const isOwner = account.responsibleUserId === callerUid;
      if (!callerRoles.isAdmin && !isOwner) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo el cajero dueño de esta cuenta (o un admin de Finanzas) puede solicitar una excepción acá"
        );
      }

      const localidad = candidateSnap.data()?.localidad || "";
      const [voterSnap, existingSnap] = await Promise.all([
        tx.get(db().collection("voters").where("cedula", "==", ci).where("localidad", "==", localidad).limit(1)),
        tx.get(cashierExceptionsCol(candidateId).where("beneficiaryCI", "==", ci).where("consumed", "==", false)),
      ]);
      if (voterSnap.empty) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `CI ${ci} no encontrada en el padrón de la localidad de este candidato (${localidad || "sin localidad configurada"})`
        );
      }
      const beneficiaryVoterId = voterSnap.docs[0].id;
      const beneficiaryName = voterSnap.docs[0].data().nombre || "";

      const yaActiva = existingSnap.docs.find((d) => (d.data().status ?? "approved") !== "rejected");
      if (yaActiva) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Ya existe una autorización excepcional activa (pendiente o aprobada, sin usar) para este beneficiario"
        );
      }

      const suggestedAmount = Number(settingsSnap.data()?.maxVoterAssistanceAmount) || 0;
      const excRef = cashierExceptionsCol(candidateId).doc();
      const payload = {
        candidateId,
        beneficiaryVoterId,
        beneficiaryCI: ci,
        beneficiaryName,
        status: "pending",
        suggestedAmount,
        approvedAmount: null,
        reason: null,
        requestedBy: callerUid,
        requestedAt: FieldValue.serverTimestamp(),
        requestedFromAccountId: cashAccountId,
        authorizedBy: null,
        authorizedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        consumed: false,
        consumedAt: null,
        consumedByMovementId: null,
      };
      tx.set(excRef, payload);
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_exception_request",
        entityType: "cashierBeneficiaryExceptions",
        entityId: excRef.id,
        previousData: null,
        newData: payload,
      });
      return { exceptionId: excRef.id, beneficiaryName, suggestedAmount };
    });
  }
);

// ── 8c. resolverExcepcionBeneficiario ────────────────────────────────────
// El admin aprueba (con el monto sugerido o uno modificado) o rechaza
// una solicitud 'pending' creada por solicitarExcepcionBeneficiario. Solo
// puede resolverse una vez — una ya resuelta no se puede volver a tocar
// acá (evita que una aprobación se pise con un rechazo tardío o viceversa).
export const resolverExcepcionBeneficiario = functions.https.onCall(
  async (request: functions.https.CallableRequest<any>) => {
    const { candidateId, exceptionId, decision, approvedAmount, rejectionReason, operationId } = request.data ?? {};
    const callerUid = requireAuth(request.auth);
    if (!candidateId || !exceptionId || !decision || !operationId) {
      throw new functions.https.HttpsError("invalid-argument", "Faltan candidateId/exceptionId/decision/operationId");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new functions.https.HttpsError("invalid-argument", "decision debe ser 'approve' o 'reject'");
    }
    if (decision === "reject" && !rejectionReason) {
      throw new functions.https.HttpsError("invalid-argument", "El motivo del rechazo es obligatorio");
    }

    return withIdempotency(candidateId, "resolverExcepcionBeneficiario", operationId, { exceptionId, decision, approvedAmount: approvedAmount ?? null, rejectionReason: rejectionReason ?? null }, async (tx) => {
      const callerRoles = await readCallerRoles(tx, candidateId, callerUid);
      if (!callerRoles.isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Solo campaign_admin/finance_admin pueden aprobar/rechazar una solicitud de excepción"
        );
      }
      const excRef = cashierExceptionsCol(candidateId).doc(exceptionId);
      const excSnap = await tx.get(excRef);
      if (!excSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Solicitud de excepción no encontrada");
      }
      const exc = excSnap.data()!;
      if (exc.candidateId !== candidateId) {
        throw new functions.https.HttpsError("failed-precondition", "La solicitud no corresponde a este candidato");
      }
      if (exc.status !== "pending") {
        throw new functions.https.HttpsError("failed-precondition", `Esta solicitud ya fue resuelta (estado: ${exc.status})`);
      }

      if (decision === "approve") {
        const monto = Number(approvedAmount ?? exc.suggestedAmount) || 0;
        if (!(monto > 0)) {
          throw new functions.https.HttpsError("invalid-argument", "El monto aprobado debe ser mayor a 0");
        }
        tx.update(excRef, {
          status: "approved",
          approvedAmount: monto,
          authorizedBy: callerUid,
          authorizedAt: FieldValue.serverTimestamp(),
        });
        writeAuditInTx(tx, candidateId, {
          actorUid: callerUid,
          action: "cashier_exception_approve",
          entityType: "cashierBeneficiaryExceptions",
          entityId: excRef.id,
          previousData: { status: exc.status, suggestedAmount: exc.suggestedAmount },
          newData: { status: "approved", approvedAmount: monto },
        });
        return { ok: true, status: "approved", approvedAmount: monto };
      }

      tx.update(excRef, {
        status: "rejected",
        rejectedBy: callerUid,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason,
      });
      writeAuditInTx(tx, candidateId, {
        actorUid: callerUid,
        action: "cashier_exception_reject",
        entityType: "cashierBeneficiaryExceptions",
        entityId: excRef.id,
        previousData: { status: exc.status },
        newData: { status: "rejected", rejectionReason },
        reason: rejectionReason,
      });
      return { ok: true, status: "rejected" };
    });
  }
);

// ── 9. onSavedRecordNeedsAssistanceWritten (trigger, no callable) ────────
// "Cajero de campo": cuando un dirigente tilda `needsAssistance` al
// registrar/editar un votante (candidates/{id}/savedRecords), y el
// candidato tiene `cashierFundsAutoEnroll: true`, se le suma
// `isFieldCashier: true` en su doc de candidates/{id}/users (SIN tocar
// `role` — sigue siendo dirigente, esto es un flag ADICIONAL, ver mismo
// criterio en firestore.rules/isFieldCashier()) y se le crea una cuenta de
// cajero en 0 si todavía no tiene una activa. Nunca mueve dinero — el
// saldo queda en 0 hasta que un admin le asigne fondos con
// asignarFondosCajero, exactamente como cualquier otro cajero.
//
// Por qué trigger y no callable: `saveRecord()` (firebaseCandidate.js) es
// una escritura directa del cliente (addDoc/setDoc), no pasa por ninguna
// Cloud Function — no hay ningún punto de entrada callable donde enganchar
// esto sin reescribir ese flujo. Es la PRIMERA Firestore trigger de este
// proyecto (el resto de Cajeros DD, y casi todo functions/src, son
// callables) — mismo Admin SDK y mismas invariantes que crearCuentaCajero
// (1 cuenta activa por responsable), controlado dentro de una transacción
// igual que el resto de este archivo.
//
// Solo corre en el flanco false→true (o creado ya en true) — una vez
// procesado, ediciones posteriores del mismo registro no vuelven a
// disparar nada (evita relecturas innecesarias en cada edición del
// dirigente, la idempotencia real la da el chequeo de cuenta activa
// existente, igual que en crearCuentaCajero).
export const onSavedRecordNeedsAssistanceWritten = onDocumentWritten(
  "candidates/{candidateId}/savedRecords/{recordId}",
  async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return; // borrado, nada que hacer
    const afterData = after.data() as any;
    if (afterData?.needsAssistance !== true) return;

    const before = event.data?.before;
    const wasAlreadyTrue = !!before?.exists && (before.data() as any)?.needsAssistance === true;
    if (wasAlreadyTrue) return;

    const candidateId = event.params.candidateId;
    const dirigenteUid = afterData.uid;
    if (!candidateId || !dirigenteUid || typeof dirigenteUid !== "string") return;

    const candidateSnap = await candidateRef(candidateId).get();
    if (candidateSnap.data()?.cashierFundsAutoEnroll !== true) return;

    await db().runTransaction(async (tx) => {
      const memberRef = candidateRef(candidateId).collection("users").doc(dirigenteUid);
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) return;
      const memberData = memberSnap.data()!;

      // Ya tiene acceso completo a Cajeros DD por su rol normal (admin o
      // cashier de verdad) — no necesita el flag de campo.
      const roleIds: string[] = Array.isArray(memberData.roleIds) ? memberData.roleIds : [];
      const yaCubierto = [memberData.role, ...roleIds].some((r) =>
        [...CASHIER_ADMIN_ROLES, CASHIER_ROLE].includes(r)
      );
      if (yaCubierto) return;

      const existingSnap = await tx.get(
        cashierAccountsCol(candidateId)
          .where("responsibleUserId", "==", dirigenteUid)
          .where("status", "==", "active")
      );

      if (memberData.isFieldCashier !== true) {
        tx.update(memberRef, { isFieldCashier: true });
      }

      if (!existingSnap.empty) return; // ya tiene cuenta activa, nada más que hacer

      const ref = cashierAccountsCol(candidateId).doc();
      const payload = {
        candidateId,
        status: "active",
        name: `Cajero de campo — ${memberData.nombre || dirigenteUid}`,
        responsibleUserId: dirigenteUid,
        initialBalance: 0,
        balance: 0,
        currency: "PYG",
        createdBy: dirigenteUid,
        autoEnrolled: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ref, payload);
      writeAuditInTx(tx, candidateId, {
        actorUid: dirigenteUid,
        action: "cashier_account_auto_create",
        entityType: "cashierAccounts",
        entityId: ref.id,
        previousData: null,
        newData: payload,
        reason: "Auto-enrolamiento: primer votante marcado 'necesita ayuda'",
      });
    });
  }
);
