// Genérico para reportes — mismo shape de entrada que exportGenericToExcel/
// exportGenericToCsv (array de objetos {columna: valor}). jspdf/
// jspdf-autotable se importan de forma dinámica adentro de la función
// (mismo criterio que firebaseCandidate.js con getCountFromServer) para
// no engordar el chunk principal — solo se bajan cuando alguien exporta
// a PDF.
export async function exportGenericToPdf(rows, filename = 'reporte.pdf', title = 'Reporte') {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text(title, 14, 16)

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const body = rows.map(row => columns.map(col => (row[col] === null || row[col] === undefined) ? '' : String(row[col])))

  autoTable(doc, {
    head: [columns],
    body,
    startY: 22,
    styles: { fontSize: 8 }
  })

  doc.save(filename)
}
