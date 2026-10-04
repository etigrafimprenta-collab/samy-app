import * as XLSX from 'xlsx'
import { TIPO_LABELS } from './cajerosReportes.js'
import { formatParaguayDate, formatParaguayTime } from './paraguayTime.js'

export const exportToExcel = (records, filename = 'registros_samy.xlsx') => {
  const data = records.map((r, i) => ({
    '#': i + 1,
    'Cédula': r.cedula || '',
    'Nombre': r.nombre || '',
    'Dirección': r.direccion || '',
    'Seccional': r.seccional || '',
    'Teléfono': r.telefono || '',
    'Nota': r.nota || '',
    'Fecha Guardado': r.savedAt?.toDate
      ? r.savedAt.toDate().toLocaleString('es-PY')
      : ''
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data)

  // Column widths
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 35 }, { wch: 35 },
    { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 20 }
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Registros')
  XLSX.writeFile(wb, filename)
}

// Genérico para reportes (a diferencia de exportToExcel/exportToExcelFull,
// que están fijas a la forma de un registro de votante) — cada fila ya
// viene formada como objeto {columna: valor}, así sirve para cualquier
// tabla (Finanzas, etc.) sin tener que agregar una función nueva por caso.
export const exportGenericToExcel = (rows, filename = 'reporte.xlsx', sheetName = 'Reporte') => {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// MEJORA 2026-10-04 — Finanzas > Pagos Cajeros DD > Beneficiarios >
// "Exportar Excel (beneficiarios)". Mismo motor que exportGenericToExcel
// (json_to_sheet + writeFile), con un resumen de reconciliación agregado
// DEBAJO de las filas en la misma hoja (vía sheet_add_aoa) — así el total
// de la última fila es, literalmente, contar las filas de la hoja, sin
// tener que creerle a un número aparte. `resumen` espera exactamente la
// forma de reporte.consolidado de cajerosReportes.js (misma fuente que ya
// alimenta la pestaña Consolidado, nunca un recálculo paralelo).
export const exportBeneficiariosCDDExcel = (filas, resumen, filename = 'pagos_cajeros_dd_beneficiarios.xlsx') => {
  const rows = filas.map(f => ({
    Fecha: f.fecha ? formatParaguayDate(f.fecha) : '',
    Hora: f.fecha ? formatParaguayTime(f.fecha) : '',
    Beneficiario: f.beneficiaryName,
    CI: f.beneficiaryCI,
    'Local de votación': f.local,
    Mesa: f.mesa,
    Dirigente: f.dirigenteNombre,
    Cajero: f.cajeroNombre,
    'Monto pagado': f.amount,
    'Tipo de pago': TIPO_LABELS[f.tipo] || f.tipo,
    Estado: f.estado,
    'Motivo / Autorización': f.motivoExcepcion || '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.sheet_add_aoa(ws, [
    [],
    ['RESUMEN (filtros activos al momento de exportar)'],
    ['Cantidad total de pagos exportados', filas.length],
    ['Cantidad de beneficiarios únicos', resumen.cantidadBeneficiarios],
    ['Monto total pagado', resumen.totalPagado],
    ['Pagos normales — cantidad', resumen.pagosNormalesCantidad],
    ['Pagos normales — monto', resumen.pagosNormalesMonto],
    ['Pagos excepcionales — cantidad', resumen.pagosExcepcionalesCantidad],
    ['Pagos excepcionales — monto', resumen.pagosExcepcionalesMonto],
  ], { origin: -1 })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Beneficiarios')
  XLSX.writeFile(wb, filename)
}

// Mismo shape de entrada que exportGenericToExcel — reusa el mismo
// json_to_sheet y solo cambia el writer, para no reimplementar el
// escapado/BOM de CSV a mano.
export const exportGenericToCsv = (rows, filename = 'reporte.csv', sheetName = 'Reporte') => {
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const readExcelFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
      resolve(data)
    }
    reader.onerror = reject
    reader.readAsBinaryString(file)
  })
}

export const exportToExcelFull = (records, filename = 'registros_samy.xlsx') => {
  const data = records.map((r, i) => ({
    '#': i + 1,
    'Cédula': r.cedula || '',
    'Nombre': r.nombre || '',
    'Dirección': r.direccion || '',
    'Seccional': r.seccional || '',
    'Local de Votación': r.local || '',
    'Mesa': r.mesa || '',
    'Orden': r.orden || '',
    'Teléfono': r.telefono || '',
    'Nota': r.nota || '',
    'Fecha Guardado': r.savedAt?.toDate
      ? r.savedAt.toDate().toLocaleString('es-PY')
      : ''
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 35 }, { wch: 35 },
    { wch: 10 }, { wch: 30 }, { wch: 8 }, { wch: 8 },
    { wch: 15 }, { wch: 20 }, { wch: 20 }
  ]
  XLSX.utils.book_append_sheet(wb, ws, 'Registros')
  XLSX.writeFile(wb, filename)
}
