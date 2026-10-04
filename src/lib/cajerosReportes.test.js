import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tipoPago, construirFilaBeneficiario, construirReportePagosCajerosDD } from './cajerosReportes.js'

// Solo prueba lógica PURA — cajerosReportes.js no importa firebase/
// firestore a propósito, así que esta suite corre sin config de Firebase
// ni red (mismo criterio que ayudaGs.test.js).

function mov(overrides = {}) {
  return {
    id: 'mov-' + Math.random().toString(36).slice(2),
    cashAccountId: 'cuenta-1',
    type: 'expense',
    status: 'confirmed',
    amount: 100000,
    beneficiaryVoterId: 'voter-1',
    beneficiaryCI: '1111111',
    beneficiaryName: 'Fulano',
    createdAt: new Date('2026-10-03T14:00:00Z'),
    fuenteMonto: 'CONFIG_GENERAL',
    exceptionAuthorization: null,
    ...overrides,
  }
}

function fila(movOverrides = {}, enriquecido = {}) {
  return construirFilaBeneficiario(mov(movOverrides), enriquecido)
}

// ── tipoPago ───────────────────────────────────────────────────────────
test('tipoPago: exceptionAuthorization manda por sobre cualquier fuenteMonto', () => {
  assert.equal(tipoPago(mov({ fuenteMonto: 'ESPECIAL_CAJERO', exceptionAuthorization: { exceptionDocId: 'x' } })), 'AUTORIZACION_EXCEPCIONAL')
})
test('tipoPago: ESPECIAL_CAJERO sin excepción', () => {
  assert.equal(tipoPago(mov({ fuenteMonto: 'ESPECIAL_CAJERO' })), 'MONTO_ESPECIAL_CAJERO')
})
test('tipoPago: INDIVIDUAL sin excepción', () => {
  assert.equal(tipoPago(mov({ fuenteMonto: 'INDIVIDUAL' })), 'MONTO_INDIVIDUAL')
})
test('tipoPago: CONFIG_GENERAL -> NORMAL', () => {
  assert.equal(tipoPago(mov({ fuenteMonto: 'CONFIG_GENERAL' })), 'NORMAL')
})
test('tipoPago: movimiento legado sin fuenteMonto -> NORMAL (nunca rompe con datos viejos)', () => {
  assert.equal(tipoPago(mov({ fuenteMonto: undefined })), 'NORMAL')
})

// ── construirFilaBeneficiario ───────────────────────────────────────────
test('construirFilaBeneficiario: status voided -> Estado Anulado', () => {
  const f = fila({ status: 'voided' })
  assert.equal(f.estado, 'Anulado')
})
test('construirFilaBeneficiario: status confirmed -> Estado Confirmado', () => {
  const f = fila({ status: 'confirmed' })
  assert.equal(f.estado, 'Confirmado')
})
test('construirFilaBeneficiario: motivoExcepcion pasa tal cual (resuelto aparte por el llamante), vacío por defecto', () => {
  assert.equal(fila().motivoExcepcion, '')
  assert.equal(fila({}, { motivoExcepcion: 'No pertenece a nuestros votantes' }).motivoExcepcion, 'No pertenece a nuestros votantes')
})

// ── construirReportePagosCajerosDD — consolidado ────────────────────────
test('consolidado: total pagado y cantidad de beneficiarios (distintos, no pagos)', () => {
  const filas = [
    fila({ beneficiaryVoterId: 'v1', amount: 100000 }),
    fila({ beneficiaryVoterId: 'v1', amount: 50000, exceptionAuthorization: { exceptionDocId: 'e1' } }), // reasistencia al MISMO v1
    fila({ beneficiaryVoterId: 'v2', amount: 70000 }),
  ]
  const { consolidado } = construirReportePagosCajerosDD(filas, { cuentas: [] })
  assert.equal(consolidado.totalPagado, 220000)
  assert.equal(consolidado.cantidadBeneficiarios, 2) // v1 y v2, no 3 pagos
  assert.equal(consolidado.promedioPorBeneficiario, 110000)
})

test('consolidado: un pago ANULADO no se cuenta como pagado', () => {
  const filas = [
    fila({ beneficiaryVoterId: 'v1', amount: 100000, status: 'voided' }),
    fila({ beneficiaryVoterId: 'v2', amount: 70000, status: 'confirmed' }),
  ]
  const { consolidado, beneficiarios } = construirReportePagosCajerosDD(filas, { cuentas: [] })
  assert.equal(consolidado.totalPagado, 70000)
  assert.equal(consolidado.cantidadBeneficiarios, 1)
  // pero SÍ aparece en el detalle de beneficiarios, una sola vez, marcado Anulado
  assert.equal(beneficiarios.length, 2)
  assert.equal(beneficiarios.find(b => b.beneficiaryVoterId === 'v1').estado, 'Anulado')
})

test('consolidado: separa pagos normales vs excepcionales', () => {
  const filas = [
    fila({ beneficiaryVoterId: 'v1', amount: 100000 }), // normal
    fila({ beneficiaryVoterId: 'v2', amount: 50000, exceptionAuthorization: { exceptionDocId: 'e1' } }), // excepcional
  ]
  const { consolidado } = construirReportePagosCajerosDD(filas, { cuentas: [] })
  assert.equal(consolidado.pagosNormalesCantidad, 1)
  assert.equal(consolidado.pagosNormalesMonto, 100000)
  assert.equal(consolidado.pagosExcepcionalesCantidad, 1)
  assert.equal(consolidado.pagosExcepcionalesMonto, 50000)
})

// ── Identidad matemática pedida explícitamente: ────────────────────────
// Fondos asignados − pagos confirmados ± anulaciones = saldo de cajeros.
test('identidad matemática: asignado - pagado = saldo (con fund_assignment y expense reales de una cuenta)', () => {
  const cuenta = { id: 'cuenta-1', name: 'Cajero Test', status: 'active', totalAssigned: 1000000, balance: 1000000 - 150000 - 80000 }
  const filas = [
    fila({ cashAccountId: 'cuenta-1', amount: 150000, beneficiaryVoterId: 'v1' }),
    fila({ cashAccountId: 'cuenta-1', amount: 80000, beneficiaryVoterId: 'v2' }),
  ]
  const { consolidado, porCajero } = construirReportePagosCajerosDD(filas, { cuentas: [cuenta] })
  assert.equal(consolidado.totalAsignado - consolidado.totalPagado, consolidado.saldoTotal)
  assert.equal(porCajero[0].fondosRecibidos - porCajero[0].montoTotal, porCajero[0].saldoActual)
})

test('identidad matemática: con una anulación (void_compensation ya reflejada en balance/totalAssigned), sigue cerrando', () => {
  // Fondos asignados 1.000.000, se pagan 150.000, LUEGO se anula ese pago
  // (void_compensation +150.000 a la cuenta) — el movimiento original
  // queda status:'voided' (no se cuenta como pagado), así que el saldo
  // real vuelve a 1.000.000 y "pagado" (según cashierMovements) es 0.
  const cuenta = { id: 'cuenta-1', name: 'Cajero Test', status: 'active', totalAssigned: 1000000, balance: 1000000 }
  const filas = [
    fila({ cashAccountId: 'cuenta-1', amount: 150000, beneficiaryVoterId: 'v1', status: 'voided' }),
  ]
  const { consolidado } = construirReportePagosCajerosDD(filas, { cuentas: [cuenta] })
  assert.equal(consolidado.totalPagado, 0)
  assert.equal(consolidado.totalAsignado - consolidado.totalPagado, consolidado.saldoTotal)
})

// ── porCajero / porLocal — sin duplicar el mismo pago entre vistas ─────
test('porCajero y porLocal reflejan el MISMO total que el consolidado (ninguna vista duplica ni pierde un pago)', () => {
  const cuentas = [
    { id: 'cuenta-1', name: 'Cajero A', status: 'active', totalAssigned: 500000, balance: 350000 },
    { id: 'cuenta-2', name: 'Cajero B', status: 'active', totalAssigned: 500000, balance: 480000 },
  ]
  const filas = [
    fila({ cashAccountId: 'cuenta-1', amount: 150000, beneficiaryVoterId: 'v1' }, { local: 'Escuela A' }),
    fila({ cashAccountId: 'cuenta-2', amount: 20000, beneficiaryVoterId: 'v2' }, { local: 'Escuela B' }),
  ]
  const { consolidado, porCajero, porLocal } = construirReportePagosCajerosDD(filas, { cuentas })
  const totalPorCajero = porCajero.reduce((s, c) => s + c.montoTotal, 0)
  const totalPorLocal = porLocal.reduce((s, l) => s + l.montoTotal, 0)
  assert.equal(totalPorCajero, consolidado.totalPagado)
  assert.equal(totalPorLocal, consolidado.totalPagado)
})

test('porLocal agrupa por el local del BENEFICIARIO, no el de la cuenta', () => {
  const filas = [
    fila({ cashAccountId: 'cuenta-1', amount: 100000, beneficiaryVoterId: 'v1' }, { local: 'Escuela X' }),
    fila({ cashAccountId: 'cuenta-1', amount: 100000, beneficiaryVoterId: 'v2' }, { local: 'Escuela Y' }),
  ]
  const { porLocal } = construirReportePagosCajerosDD(filas, { cuentas: [{ id: 'cuenta-1', name: 'Cajero A', balance: 0 }] })
  assert.equal(porLocal.length, 2)
  assert.ok(porLocal.some(l => l.local === 'Escuela X'))
  assert.ok(porLocal.some(l => l.local === 'Escuela Y'))
})

// ── Filtros ──────────────────────────────────────────────────────────────
test('filtro por búsqueda de CI/nombre', () => {
  const filas = [
    fila({ beneficiaryCI: '1111111', beneficiaryName: 'Ana Gomez', beneficiaryVoterId: 'v1' }),
    fila({ beneficiaryCI: '2222222', beneficiaryName: 'Beto Perez', beneficiaryVoterId: 'v2' }),
  ]
  const porNombre = construirReportePagosCajerosDD(filas, { cuentas: [], filtros: { busqueda: 'Ana' } })
  assert.equal(porNombre.beneficiarios.length, 1)
  assert.equal(porNombre.beneficiarios[0].beneficiaryName, 'Ana Gomez')
  const porCI = construirReportePagosCajerosDD(filas, { cuentas: [], filtros: { busqueda: '2222222' } })
  assert.equal(porCI.beneficiarios.length, 1)
  assert.equal(porCI.beneficiarios[0].beneficiaryCI, '2222222')
})

test('filtro por cashAccountId acota también porCajero/porLocal/consolidado', () => {
  const cuentas = [
    { id: 'cuenta-1', name: 'Cajero A', status: 'active', totalAssigned: 500000, balance: 350000 },
    { id: 'cuenta-2', name: 'Cajero B', status: 'active', totalAssigned: 500000, balance: 480000 },
  ]
  const filas = [
    fila({ cashAccountId: 'cuenta-1', amount: 150000, beneficiaryVoterId: 'v1' }),
    fila({ cashAccountId: 'cuenta-2', amount: 20000, beneficiaryVoterId: 'v2' }),
  ]
  const { consolidado, porCajero } = construirReportePagosCajerosDD(filas, { cuentas, filtros: { cashAccountId: 'cuenta-1' } })
  assert.equal(consolidado.totalPagado, 150000)
  assert.equal(porCajero.length, 1)
  assert.equal(porCajero[0].cashAccountId, 'cuenta-1')
})

test('filtro por rango de fecha', () => {
  const filas = [
    fila({ beneficiaryVoterId: 'v1', amount: 100000, createdAt: new Date('2026-10-01T10:00:00Z') }),
    fila({ beneficiaryVoterId: 'v2', amount: 100000, createdAt: new Date('2026-10-03T10:00:00Z') }),
  ]
  const { consolidado } = construirReportePagosCajerosDD(filas, {
    cuentas: [], filtros: { desde: new Date('2026-10-02T00:00:00Z'), hasta: new Date('2026-10-04T00:00:00Z') },
  })
  assert.equal(consolidado.totalPagado, 100000)
  assert.equal(consolidado.cantidadBeneficiarios, 1)
})
