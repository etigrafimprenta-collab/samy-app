// Lógica PURA de agregación de "Ayuda Gs." (Reportes > Ayudas), separada
// de firebaseCandidate.js a propósito — igual criterio que offlineQueue.js
// (ver su cabecera): este archivo NO importa firebase.js/firebase/firestore,
// así que se puede testear con node:test sin tocar Firestore ni necesitar
// config de Firebase. getAyudaGsSummary (firebaseCandidate.js) es un
// wrapper fino sobre esto: pagina savedRecords/users y le pasa el
// resultado a computeAyudaGsSummary.
//
// `needsAssistance` (necesidad marcada por el dirigente) y `montoAyuda`
// (importe cuantificado) son conceptos DISTINTOS — nunca se asume que el
// primero implica el segundo.

function norm(v) {
  return String(v ?? '').trim()
}

// ── Fase 2: control y aprobación ────────────────────────────────────
// `montoAyuda` SIGUE siendo exclusivamente el monto SOLICITADO por el
// dirigente — nunca se reinterpreta como aprobado. La decisión
// administrativa vive en 4 campos nuevos, separados:
//   assistanceStatus  : 'pending_amount' | 'pending_approval' | 'approved' | 'rejected' | null
//   approvedAmount/approvedBy/approvedAt   (solo si approved)
//   rejectedBy/rejectedAt/rejectionReason  (solo si rejected)
//
// Compatibilidad con los registros legacy (sin ningún campo nuevo
// seteado) — pedido explícito, SIN migración masiva: el estado se
// DERIVA en lectura, nunca se escribe retroactivamente.
//   needsAssistance=false                                        → null (sin solicitud)
//   needsAssistance=true && montoAyuda<=0                         → 'pending_amount'
//   needsAssistance=true && montoAyuda>0 && sin assistanceStatus  → 'pending_approval'
//   assistanceStatus ya seteado                                  → se respeta tal cual
export function resolveAssistanceStatus(record) {
  if (record.assistanceStatus) return record.assistanceStatus
  if (record.needsAssistance !== true) return null
  if (!(Number(record.montoAyuda) > 0)) return 'pending_amount'
  return 'pending_approval'
}

// records: array de savedRecords ({id, uid, cedula, nombre, local, mesa,
//   orden, telefono, needsAssistance, montoAyuda, assistanceStatus?,
//   approvedAmount?, approvedBy?, approvedAt?, rejectedBy?, rejectedAt?,
//   rejectionReason?}).
// usuarios: Map uid -> {nombre, email} (o cualquier objeto con esos
//   campos) — SOLO los uid que SÍ existen en candidates/{id}/users.
export function computeAyudaGsSummary(records, usuarios) {
  const porDirigente = new Map() // key -> acumulador
  const registrosConAyuda = []
  let totalRegistrados = 0
  let necesitanAyuda = 0
  let conMonto = 0
  let sinMonto = 0
  let montoTotal = 0
  let pendingAmount = 0
  let pendingApproval = 0
  let approved = 0
  let rejected = 0
  let totalAprobado = 0

  for (const r of records) {
    totalRegistrados++
    // 3 grupos: uid real y resoluble (clave = el uid), sin uid, o uid
    // presente pero sin doc en /users — estos últimos se FUSIONAN en una
    // sola clave '(no-disponible)' (nunca una fila por cada uid fantasma).
    const key = !r.uid ? '(sin-uid)' : (usuarios.has(r.uid) ? r.uid : '(no-disponible)')
    if (!porDirigente.has(key)) {
      porDirigente.set(key, {
        registrados: 0, necesitanAyuda: 0, conMonto: 0, sinMonto: 0, totalSolicitado: 0,
        pendingAmount: 0, pendingApproval: 0, approved: 0, rejected: 0, totalAprobado: 0
      })
    }
    const acc = porDirigente.get(key)
    acc.registrados++

    if (r.needsAssistance === true) {
      necesitanAyuda++
      acc.necesitanAyuda++
      const monto = Number(r.montoAyuda) || 0
      const status = resolveAssistanceStatus(r)

      if (monto > 0) {
        conMonto++
        acc.conMonto++
        montoTotal += monto
        acc.totalSolicitado += monto
      } else {
        sinMonto++
        acc.sinMonto++
      }

      if (status === 'pending_amount') { pendingAmount++; acc.pendingAmount++ }
      else if (status === 'pending_approval') { pendingApproval++; acc.pendingApproval++ }
      else if (status === 'approved') {
        approved++; acc.approved++
        const montoAprobado = Number(r.approvedAmount) || 0
        totalAprobado += montoAprobado
        acc.totalAprobado += montoAprobado
      } else if (status === 'rejected') { rejected++; acc.rejected++ }

      registrosConAyuda.push({
        id: r.id,
        groupKey: key,
        uid: r.uid || null,
        cedula: norm(r.cedula), nombre: norm(r.nombre),
        local: norm(r.local), mesa: norm(r.mesa), orden: norm(r.orden), telefono: norm(r.telefono),
        montoAyuda: monto,
        assistanceStatus: status,
        approvedAmount: r.approvedAmount != null ? Number(r.approvedAmount) : null,
        approvedBy: r.approvedBy || null,
        approvedAt: r.approvedAt || null,
        rejectedBy: r.rejectedBy || null,
        rejectedAt: r.rejectedAt || null,
        rejectionReason: r.rejectionReason || ''
      })
    }
  }

  const porDirigenteArr = [...porDirigente.entries()].map(([key, acc]) => {
    let nombre, estado
    if (key === '(sin-uid)') {
      nombre = '(Sin dirigente asignado)'
      estado = 'sin-uid'
    } else if (key === '(no-disponible)') {
      nombre = 'Dirigente no disponible / usuario eliminado'
      estado = 'no-disponible'
    } else {
      const u = usuarios.get(key)
      nombre = (u && (u.nombre || u.email)) || key
      estado = 'ok'
    }
    return { uid: key, nombre, estado, ...acc }
  }).sort((a, b) => b.totalSolicitado - a.totalSolicitado || b.necesitanAyuda - a.necesitanAyuda)

  return {
    resumen: {
      totalRegistrados,
      necesitanAyuda,
      conMonto,
      sinMonto,
      montoTotal,
      // Deliberadamente SOLO sobre los que tienen monto>0 — promediar
      // sobre el total de "necesita ayuda" (incluyendo los que están en
      // 0) da un número financieramente engañoso.
      promedioConMonto: conMonto > 0 ? montoTotal / conMonto : 0,
      // Fase 2 — nunca se muestra "diferencia" como plata disponible,
      // solo como comparación (ver UI).
      pendingAmount,
      pendingApproval,
      approved,
      rejected,
      totalSolicitado: montoTotal,
      totalAprobado,
      diferencia: montoTotal - totalAprobado
    },
    porDirigente: porDirigenteArr,
    registrosConAyuda
  }
}
