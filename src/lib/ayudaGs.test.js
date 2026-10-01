import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAyudaGsSummary, resolveAssistanceStatus } from './ayudaGs.js'

// Solo prueba lógica PURA — ayudaGs.js no importa firebase/firestore a
// propósito (ver su cabecera), así que esta suite corre sin config de
// Firebase ni red, a diferencia de firebaseCandidate.test.js.

function rec(overrides = {}) {
  return {
    id: overrides.id || 'rec-' + Math.random().toString(36).slice(2),
    uid: 'uid-1',
    cedula: '1111111',
    nombre: 'FULANO DE TAL',
    local: 'Escuela Nº 1',
    mesa: '5',
    orden: '10',
    telefono: '0981000000',
    needsAssistance: false,
    montoAyuda: 0,
    ...overrides
  }
}

test('needsAssistance=true + montoAyuda=100000 → cuenta como "con monto" y entra al total', () => {
  const { resumen } = computeAyudaGsSummary([rec({ needsAssistance: true, montoAyuda: 100000 })], new Map())
  assert.equal(resumen.necesitanAyuda, 1)
  assert.equal(resumen.conMonto, 1)
  assert.equal(resumen.sinMonto, 0)
  assert.equal(resumen.montoTotal, 100000)
})

test('needsAssistance=true + montoAyuda=0 → cuenta como "sin monto", NO entra al total ni al promedio', () => {
  const { resumen } = computeAyudaGsSummary([rec({ needsAssistance: true, montoAyuda: 0 })], new Map())
  assert.equal(resumen.necesitanAyuda, 1)
  assert.equal(resumen.conMonto, 0)
  assert.equal(resumen.sinMonto, 1)
  assert.equal(resumen.montoTotal, 0)
  assert.equal(resumen.promedioConMonto, 0)
})

test('needsAssistance=false + montoAyuda=0 → no cuenta como "necesita ayuda" en absoluto', () => {
  const { resumen, registrosConAyuda } = computeAyudaGsSummary([rec({ needsAssistance: false, montoAyuda: 0 })], new Map())
  assert.equal(resumen.totalRegistrados, 1)
  assert.equal(resumen.necesitanAyuda, 0)
  assert.equal(resumen.conMonto, 0)
  assert.equal(resumen.sinMonto, 0)
  assert.equal(registrosConAyuda.length, 0)
})

test('UID válido (resuelve en /users) → se agrupa bajo su propio nombre, estado "ok"', () => {
  const usuarios = new Map([['uid-1', { nombre: 'Gustavo Daniel Franco' }]])
  const { porDirigente } = computeAyudaGsSummary([rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 })], usuarios)
  assert.equal(porDirigente.length, 1)
  assert.equal(porDirigente[0].uid, 'uid-1')
  assert.equal(porDirigente[0].nombre, 'Gustavo Daniel Franco')
  assert.equal(porDirigente[0].estado, 'ok')
})

test('UID inexistente (no está en /users) → se agrupa como "Dirigente no disponible / usuario eliminado"', () => {
  const { porDirigente } = computeAyudaGsSummary([rec({ uid: 'uid-fantasma', needsAssistance: true, montoAyuda: 50000 })], new Map())
  assert.equal(porDirigente.length, 1)
  assert.equal(porDirigente[0].uid, '(no-disponible)')
  assert.equal(porDirigente[0].nombre, 'Dirigente no disponible / usuario eliminado')
  assert.equal(porDirigente[0].estado, 'no-disponible')
})

test('varios registros del mismo dirigente → se acumulan en una sola fila', () => {
  const usuarios = new Map([['uid-1', { nombre: 'Gustavo Daniel Franco' }]])
  const records = [
    rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 }),
    rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 }),
    rec({ uid: 'uid-1', needsAssistance: false, montoAyuda: 0 })
  ]
  const { porDirigente } = computeAyudaGsSummary(records, usuarios)
  assert.equal(porDirigente.length, 1)
  assert.equal(porDirigente[0].registrados, 3)
  assert.equal(porDirigente[0].necesitanAyuda, 2)
  assert.equal(porDirigente[0].conMonto, 2)
  assert.equal(porDirigente[0].totalSolicitado, 200000)
})

test('varios dirigentes → cada uno en su propia fila, sin mezclarse', () => {
  const usuarios = new Map([
    ['uid-1', { nombre: 'Gustavo Daniel Franco' }],
    ['uid-2', { nombre: 'Cynthia Raquel Benitez' }]
  ])
  const records = [
    rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 }),
    rec({ uid: 'uid-2', needsAssistance: true, montoAyuda: 0 }),
    rec({ uid: 'uid-2', needsAssistance: true, montoAyuda: 0 })
  ]
  const { porDirigente } = computeAyudaGsSummary(records, usuarios)
  assert.equal(porDirigente.length, 2)
  const gustavo = porDirigente.find(d => d.uid === 'uid-1')
  const cynthia = porDirigente.find(d => d.uid === 'uid-2')
  assert.equal(gustavo.necesitanAyuda, 1)
  assert.equal(gustavo.totalSolicitado, 100000)
  assert.equal(cynthia.necesitanAyuda, 2)
  assert.equal(cynthia.conMonto, 0)
  assert.equal(cynthia.sinMonto, 2)
  assert.equal(cynthia.totalSolicitado, 0)
})

test('suma total — monto total general es la suma exacta de todos los montoAyuda>0', () => {
  const records = [
    rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 }),
    rec({ uid: 'uid-2', needsAssistance: true, montoAyuda: 250000 }),
    rec({ uid: 'uid-3', needsAssistance: true, montoAyuda: 0 }), // no suma
    rec({ uid: 'uid-4', needsAssistance: false, montoAyuda: 0 }) // no suma (ni cuenta)
  ]
  const { resumen } = computeAyudaGsSummary(records, new Map())
  assert.equal(resumen.montoTotal, 350000)
})

test('promedio — se calcula ÚNICAMENTE sobre los registros con montoAyuda>0, nunca sobre el total de "necesita ayuda"', () => {
  // 1 con Gs. 100.000 + 3 marcados "necesita ayuda" sin monto → promedio
  // real sobre cuantificados = 100.000, NO 25.000 (100.000/4).
  const records = [
    rec({ uid: 'uid-1', needsAssistance: true, montoAyuda: 100000 }),
    rec({ uid: 'uid-2', needsAssistance: true, montoAyuda: 0 }),
    rec({ uid: 'uid-3', needsAssistance: true, montoAyuda: 0 }),
    rec({ uid: 'uid-4', needsAssistance: true, montoAyuda: 0 })
  ]
  const { resumen } = computeAyudaGsSummary(records, new Map())
  assert.equal(resumen.necesitanAyuda, 4)
  assert.equal(resumen.conMonto, 1)
  assert.equal(resumen.promedioConMonto, 100000)
})

test('agrupación de usuarios no resolubles — varios uid fantasma DISTINTOS se fusionan en UNA sola fila, pero cada registro conserva su uid original', () => {
  const records = [
    rec({ uid: 'uid-fantasma-A', needsAssistance: true, montoAyuda: 0 }),
    rec({ uid: 'uid-fantasma-B', needsAssistance: true, montoAyuda: 0 }),
    rec({ uid: 'uid-fantasma-A', needsAssistance: true, montoAyuda: 0 })
  ]
  const { porDirigente, registrosConAyuda } = computeAyudaGsSummary(records, new Map())
  // Una sola fila fusionada, no 2 ni 3:
  assert.equal(porDirigente.length, 1)
  assert.equal(porDirigente[0].uid, '(no-disponible)')
  assert.equal(porDirigente[0].registrados, 3)
  // pero el uid ORIGINAL de cada registro se conserva para auditoría:
  assert.equal(registrosConAyuda.length, 3)
  assert.deepEqual(
    registrosConAyuda.map(r => r.uid).sort(),
    ['uid-fantasma-A', 'uid-fantasma-A', 'uid-fantasma-B'].sort()
  )
  registrosConAyuda.forEach(r => assert.equal(r.groupKey, '(no-disponible)'))
})

test('dataset vacío — no rompe, devuelve ceros y arrays vacíos', () => {
  const { resumen, porDirigente, registrosConAyuda } = computeAyudaGsSummary([], new Map())
  assert.deepEqual(resumen, {
    totalRegistrados: 0, necesitanAyuda: 0, conMonto: 0, sinMonto: 0, montoTotal: 0, promedioConMonto: 0,
    pendingAmount: 0, pendingApproval: 0, approved: 0, rejected: 0,
    totalSolicitado: 0, totalAprobado: 0, diferencia: 0
  })
  assert.deepEqual(porDirigente, [])
  assert.deepEqual(registrosConAyuda, [])
})

test('registro sin uid en absoluto → se agrupa aparte como "(Sin dirigente asignado)", no se mezcla con "no disponible"', () => {
  const { porDirigente } = computeAyudaGsSummary([rec({ uid: null, needsAssistance: true, montoAyuda: 10000 })], new Map())
  assert.equal(porDirigente.length, 1)
  assert.equal(porDirigente[0].uid, '(sin-uid)')
  assert.equal(porDirigente[0].nombre, '(Sin dirigente asignado)')
  assert.equal(porDirigente[0].estado, 'sin-uid')
})

test('reproduce el caso real de Víctor Isasi — Gustavo Daniel Franco y Cynthia Raquel Benitez', () => {
  const usuarios = new Map([
    ['gustavo', { nombre: 'Gustavo Daniel Franco' }],
    ['cynthia', { nombre: 'Cynthia Raquel Benitez' }]
  ])
  const records = [
    ...Array.from({ length: 69 }, () => rec({ uid: 'gustavo', needsAssistance: false, montoAyuda: 0 })),
    ...Array.from({ length: 14 }, () => rec({ uid: 'gustavo', needsAssistance: true, montoAyuda: 100000 })),
    ...Array.from({ length: 27 }, () => rec({ uid: 'cynthia', needsAssistance: true, montoAyuda: 0 }))
  ]
  const { porDirigente } = computeAyudaGsSummary(records, usuarios)
  const gustavo = porDirigente.find(d => d.uid === 'gustavo')
  const cynthia = porDirigente.find(d => d.uid === 'cynthia')
  assert.deepEqual(
    { registrados: gustavo.registrados, necesitanAyuda: gustavo.necesitanAyuda, conMonto: gustavo.conMonto, sinMonto: gustavo.sinMonto, totalSolicitado: gustavo.totalSolicitado },
    { registrados: 83, necesitanAyuda: 14, conMonto: 14, sinMonto: 0, totalSolicitado: 1400000 }
  )
  assert.deepEqual(
    { registrados: cynthia.registrados, necesitanAyuda: cynthia.necesitanAyuda, conMonto: cynthia.conMonto, sinMonto: cynthia.sinMonto, totalSolicitado: cynthia.totalSolicitado },
    { registrados: 27, necesitanAyuda: 27, conMonto: 0, sinMonto: 27, totalSolicitado: 0 }
  )
})

// ══════════════ Fase 2 — control y aprobación ══════════════

test('resolveAssistanceStatus — legacy: needsAssistance=false → sin solicitud (null)', () => {
  assert.equal(resolveAssistanceStatus(rec({ needsAssistance: false, montoAyuda: 0 })), null)
})

test('resolveAssistanceStatus — legacy: needsAssistance=true + montoAyuda=0 → pending_amount', () => {
  assert.equal(resolveAssistanceStatus(rec({ needsAssistance: true, montoAyuda: 0 })), 'pending_amount')
})

test('resolveAssistanceStatus — legacy: needsAssistance=true + montoAyuda>0 + SIN assistanceStatus → pending_approval (NO aprobado automáticamente)', () => {
  assert.equal(resolveAssistanceStatus(rec({ needsAssistance: true, montoAyuda: 100000 })), 'pending_approval')
})

test('resolveAssistanceStatus — si assistanceStatus ya está seteado, se respeta tal cual (no se recalcula)', () => {
  assert.equal(resolveAssistanceStatus(rec({ needsAssistance: true, montoAyuda: 100000, assistanceStatus: 'approved' })), 'approved')
  assert.equal(resolveAssistanceStatus(rec({ needsAssistance: true, montoAyuda: 100000, assistanceStatus: 'rejected' })), 'rejected')
})

test('computeAyudaGsSummary — los 25 casos con monto de Víctor Isasi (legacy) caen en pending_approval, NO quedan aprobados', () => {
  const records = Array.from({ length: 25 }, () => rec({ needsAssistance: true, montoAyuda: 100000 }))
  const { resumen } = computeAyudaGsSummary(records, new Map())
  assert.equal(resumen.pendingApproval, 25)
  assert.equal(resumen.approved, 0)
  assert.equal(resumen.totalAprobado, 0)
  assert.equal(resumen.totalSolicitado, 2500000)
  assert.equal(resumen.diferencia, 2500000) // nada aprobado todavía → toda la diferencia es lo solicitado
})

test('computeAyudaGsSummary — un registro approved con approvedAmount distinto de montoAyuda: se conservan ambos valores', () => {
  const records = [rec({
    needsAssistance: true, montoAyuda: 100000,
    assistanceStatus: 'approved', approvedAmount: 80000, approvedBy: 'admin-uid', approvedAt: 'ts'
  })]
  const { resumen, registrosConAyuda } = computeAyudaGsSummary(records, new Map())
  assert.equal(resumen.approved, 1)
  assert.equal(resumen.totalSolicitado, 100000) // montoAyuda intacto
  assert.equal(resumen.totalAprobado, 80000)    // approvedAmount, no igual al solicitado
  assert.equal(resumen.diferencia, 20000)
  assert.equal(registrosConAyuda[0].montoAyuda, 100000)
  assert.equal(registrosConAyuda[0].approvedAmount, 80000)
})

test('computeAyudaGsSummary — un registro rejected no suma a totalAprobado ni a totalSolicitado-pendiente', () => {
  const records = [rec({
    needsAssistance: true, montoAyuda: 100000,
    assistanceStatus: 'rejected', rejectedBy: 'admin-uid', rejectedAt: 'ts', rejectionReason: 'No corresponde'
  })]
  const { resumen, registrosConAyuda } = computeAyudaGsSummary(records, new Map())
  assert.equal(resumen.rejected, 1)
  assert.equal(resumen.approved, 0)
  assert.equal(resumen.totalAprobado, 0)
  assert.equal(registrosConAyuda[0].rejectionReason, 'No corresponde')
})

test('computeAyudaGsSummary — desglose completo por dirigente: pendingAmount/pendingApproval/approved/rejected/totalAprobado', () => {
  const records = [
    rec({ uid: 'd1', needsAssistance: true, montoAyuda: 0 }),                                          // pending_amount
    rec({ uid: 'd1', needsAssistance: true, montoAyuda: 100000 }),                                      // pending_approval
    rec({ uid: 'd1', needsAssistance: true, montoAyuda: 100000, assistanceStatus: 'approved', approvedAmount: 100000 }),
    rec({ uid: 'd1', needsAssistance: true, montoAyuda: 100000, assistanceStatus: 'rejected', rejectionReason: 'x' })
  ]
  const { porDirigente } = computeAyudaGsSummary(records, new Map([['d1', { nombre: 'Dirigente Uno' }]]))
  const d1 = porDirigente.find(d => d.uid === 'd1')
  assert.deepEqual(
    { pendingAmount: d1.pendingAmount, pendingApproval: d1.pendingApproval, approved: d1.approved, rejected: d1.rejected, totalAprobado: d1.totalAprobado },
    { pendingAmount: 1, pendingApproval: 1, approved: 1, rejected: 1, totalAprobado: 100000 }
  )
})
