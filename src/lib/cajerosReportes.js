// AUDITORÍA 2026-10-03 — Finanzas > Reportes > "Pagos Cajeros DD".
//
// Agregación PURA (sin Firestore acá adentro) sobre filas YA resueltas —
// así es trivialmente testeable con fixtures (ver cajerosReportes.test.js),
// sin depender del emulador. Quien llama (finanzas-candidate.js, vía los
// helpers nuevos de firebaseCandidate.js) hace el trabajo de traer los
// datos crudos y enriquecerlos (local/mesa del votante, nombre del
// cajero, dirigente) ANTES de pasarlos acá.
//
// FUENTE DE VERDAD, confirmada antes de escribir esto (pedido explícito
// "primero identificá las colecciones actuales"): cashierMovements es la
// ÚNICA colección transaccional real de plata — cashierOperations es
// solo el caché de idempotencia (nunca se lee para reportes, duplicaría
// nada útil), cashierAccounts tiene el saldo YA consolidado por cada
// escritura transaccional (nunca se recalcula a mano, se lee tal cual),
// cashierBeneficiaryExceptions es metadata de la autorización, no de la
// plata en sí (el movimiento real queda en cashierMovements con
// exceptionAuthorization apuntando a ese doc).
//
// Un pago real = cashierMovements con type:'expense'. status:'confirmed'
// es el estado vigente; status:'voided' es EL MISMO pago, reversado (no
// se borra ni se duplica, ver resolverAnulacionMovimiento) — por eso
// nunca se cuenta en el consolidado/agrupaciones (que reflejan dinero
// REALMENTE en la calle ahora), pero SÍ aparece en el detalle de
// beneficiarios con Estado:'Anulado', una sola vez, nunca como una fila
// aparte additional a la original.

// Tipo de pago (pedido explícito: NORMAL / MONTO_INDIVIDUAL /
// MONTO_ESPECIAL_CAJERO / AUTORIZACIÓN_EXCEPCIONAL) — derivado de los
// campos que cashierFunds.ts ya escribe en cada movimiento:
//   - exceptionAuthorization != null           → AUTORIZACION_EXCEPCIONAL
//     (reasistencia o beneficiario que no es "nuestro" votante — manda
//     por sobre cualquier fuenteMonto, es la excepción la que define el
//     camino, no de dónde salió el número).
//   - fuenteMonto === 'ESPECIAL_CAJERO'         → MONTO_ESPECIAL_CAJERO
//     (aprobarYPagarAyudaCajero usó el monto especial temporal vigente).
//   - fuenteMonto === 'INDIVIDUAL'               → MONTO_INDIVIDUAL
//     (registrarEgresoCajero pagando un monto YA autorizado para ESE
//     votante en particular, nunca el default general).
//   - fuenteMonto === 'CONFIG_GENERAL' o ausente → NORMAL
//     (aprobarYPagarAyudaCajero con el default de Finanzas > Config, o
//     un movimiento legado de antes de que existiera este campo).
export function tipoPago(mov) {
  if (mov.exceptionAuthorization) return 'AUTORIZACION_EXCEPCIONAL'
  if (mov.fuenteMonto === 'ESPECIAL_CAJERO') return 'MONTO_ESPECIAL_CAJERO'
  if (mov.fuenteMonto === 'INDIVIDUAL') return 'MONTO_INDIVIDUAL'
  return 'NORMAL'
}

export const TIPO_LABELS = {
  NORMAL: 'Normal',
  MONTO_INDIVIDUAL: 'Monto individual',
  MONTO_ESPECIAL_CAJERO: 'Monto especial cajero',
  AUTORIZACION_EXCEPCIONAL: 'Autorización excepcional',
}

// Movimiento crudo de cashierMovements (type:'expense', cualquier
// status) + lo que el llamante resolvió aparte → una fila plana, lista
// para filtrar/agrupar/exportar. `createdAt` se espera ya convertido a
// Date (o null) — nunca un Timestamp de Firestore (mantiene este módulo
// sin ninguna dependencia de Firestore).
export function construirFilaBeneficiario(mov, { local = '', mesa = '', dirigenteNombre = '', cajeroNombre = '', motivoExcepcion = '' } = {}) {
  return {
    id: mov.id,
    cashAccountId: mov.cashAccountId,
    fecha: mov.createdAt || null,
    beneficiaryVoterId: mov.beneficiaryVoterId || null,
    beneficiaryName: mov.beneficiaryName || '',
    beneficiaryCI: mov.beneficiaryCI || '',
    local,
    mesa,
    dirigenteNombre,
    cajeroNombre,
    amount: Number(mov.amount) || 0,
    tipo: tipoPago(mov),
    estado: mov.status === 'voided' ? 'Anulado' : 'Confirmado',
    // Solo tiene valor cuando tipo === 'AUTORIZACION_EXCEPCIONAL' — el
    // llamante lo resuelve aparte (cashierBeneficiaryExceptions por
    // exceptionDocId, ver getExceptionReasonsByIds) porque esta función
    // se mantiene sin ninguna dependencia de Firestore (ver cabecera).
    motivoExcepcion,
  }
}

function coincideFiltros(fila, filtros) {
  if (!filtros) return true
  if (filtros.desde && (!fila.fecha || fila.fecha < filtros.desde)) return false
  if (filtros.hasta && (!fila.fecha || fila.fecha > filtros.hasta)) return false
  if (filtros.cashAccountId && fila.cashAccountId !== filtros.cashAccountId) return false
  if (filtros.local && fila.local !== filtros.local) return false
  if (filtros.busqueda) {
    const q = String(filtros.busqueda).trim().toLowerCase()
    if (q && !(String(fila.beneficiaryCI).toLowerCase().includes(q) || String(fila.beneficiaryName).toLowerCase().includes(q))) {
      return false
    }
  }
  return true
}

// `filas`: TODAS las filas de pago (confirmadas Y anuladas, ver cabecera)
// ya construidas con construirFilaBeneficiario. `cuentas`: cashierAccounts
// crudas + totalAssigned ya calculado por el llamante (suma de
// fund_assignment confirmados de ESA cuenta — lo trae el llamante porque
// este módulo no filtra movimientos por tipo más que 'expense', para no
// duplicar esa lógica en dos lugares).
//
// Devuelve: { consolidado, porCajero, porLocal, beneficiarios } — las 4
// vistas pedidas, cada una derivada de la MISMA lista de filas (nunca se
// vuelve a leer nada "aparte" para una vista puntual, así un pago no
// puede aparecer con números distintos en dos pestañas).
export function construirReportePagosCajerosDD(filas, { cuentas = [], filtros = null } = {}) {
  const filasFiltradas = filas.filter(f => coincideFiltros(f, filtros))
  const confirmadas = filasFiltradas.filter(f => f.estado === 'Confirmado')

  const totalPagado = confirmadas.reduce((s, f) => s + f.amount, 0)
  // "Cantidad de beneficiarios pagados" es gente distinta, no pagos —
  // alguien con reasistencia (2 pagos vía excepción) cuenta como 1.
  const beneficiariosUnicos = new Set(confirmadas.map(f => f.beneficiaryVoterId || `ci:${f.beneficiaryCI}`))
  const normales = confirmadas.filter(f => f.tipo !== 'AUTORIZACION_EXCEPCIONAL')
  const excepcionales = confirmadas.filter(f => f.tipo === 'AUTORIZACION_EXCEPCIONAL')

  // El consolidado de fondos/saldo es SIEMPRE de TODAS las cuentas (no se
  // filtra por fecha/cajero/local — son fotos del estado actual, no
  // series filtrables) salvo que el propio filtro de cajero acote cuáles
  // cuentas entran, lo que sí tiene sentido.
  const cuentasRelevantes = filtros?.cashAccountId ? cuentas.filter(c => c.id === filtros.cashAccountId) : cuentas
  const totalAsignado = cuentasRelevantes.reduce((s, c) => s + (Number(c.totalAssigned) || 0), 0)
  const saldoTotal = cuentasRelevantes.reduce((s, c) => s + (Number(c.balance) || 0), 0)

  const consolidado = {
    totalAsignado,
    totalPagado,
    cantidadBeneficiarios: beneficiariosUnicos.size,
    saldoTotal,
    pagosNormalesCantidad: normales.length,
    pagosNormalesMonto: normales.reduce((s, f) => s + f.amount, 0),
    pagosExcepcionalesCantidad: excepcionales.length,
    pagosExcepcionalesMonto: excepcionales.reduce((s, f) => s + f.amount, 0),
    promedioPorBeneficiario: beneficiariosUnicos.size > 0 ? totalPagado / beneficiariosUnicos.size : 0,
  }

  // Por cajero (una fila por CUENTA — un mismo cajero reiniciado tiene
  // cuentas distintas, cada una con su propio saldo/historial, igual
  // criterio que el resto de Cajeros DD).
  const porCajeroMap = new Map()
  for (const cuenta of cuentasRelevantes) {
    porCajeroMap.set(cuenta.id, {
      cashAccountId: cuenta.id,
      cajeroNombre: cuenta.name || cuenta.id,
      status: cuenta.status,
      fondosRecibidos: Number(cuenta.totalAssigned) || 0,
      saldoActual: Number(cuenta.balance) || 0,
      cantidadPagos: 0,
      montoTotal: 0,
      cantidadExcepcionales: 0,
      montoExcepcionales: 0,
      beneficiarios: [],
    })
  }
  for (const f of confirmadas) {
    if (!porCajeroMap.has(f.cashAccountId)) continue // cuenta fuera del filtro activo
    const g = porCajeroMap.get(f.cashAccountId)
    g.cantidadPagos++
    g.montoTotal += f.amount
    if (f.tipo === 'AUTORIZACION_EXCEPCIONAL') { g.cantidadExcepcionales++; g.montoExcepcionales += f.amount }
    g.beneficiarios.push(f)
  }
  const porCajero = [...porCajeroMap.values()].sort((a, b) => b.montoTotal - a.montoTotal)

  // Por local de votación del BENEFICIARIO (no el local asignado al
  // cajero — pedido explícito).
  const porLocalMap = new Map()
  for (const f of confirmadas) {
    const clave = f.local || '(sin local)'
    if (!porLocalMap.has(clave)) porLocalMap.set(clave, { local: clave, cantidadBeneficiarios: 0, montoTotal: 0, beneficiarios: [] })
    const g = porLocalMap.get(clave)
    g.cantidadBeneficiarios++
    g.montoTotal += f.amount
    g.beneficiarios.push(f)
  }
  const porLocal = [...porLocalMap.values()].sort((a, b) => b.montoTotal - a.montoTotal)

  const beneficiarios = [...filasFiltradas].sort((a, b) => (b.fecha?.getTime?.() || 0) - (a.fecha?.getTime?.() || 0))

  return { consolidado, porCajero, porLocal, beneficiarios }
}
