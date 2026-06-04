import * as XLSX from 'xlsx'

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
