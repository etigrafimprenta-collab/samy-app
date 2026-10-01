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

// records: array de savedRecords ({id, uid, cedula, nombre, local, mesa,
//   orden, telefono, needsAssistance, montoAyuda}).
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

  for (const r of records) {
    totalRegistrados++
    // 3 grupos: uid real y resoluble (clave = el uid), sin uid, o uid
    // presente pero sin doc en /users — estos últimos se FUSIONAN en una
    // sola clave '(no-disponible)' (nunca una fila por cada uid fantasma).
    const key = !r.uid ? '(sin-uid)' : (usuarios.has(r.uid) ? r.uid : '(no-disponible)')
    if (!porDirigente.has(key)) {
      porDirigente.set(key, { registrados: 0, necesitanAyuda: 0, conMonto: 0, sinMonto: 0, totalSolicitado: 0 })
    }
    const acc = porDirigente.get(key)
    acc.registrados++

    if (r.needsAssistance === true) {
      necesitanAyuda++
      acc.necesitanAyuda++
      const monto = Number(r.montoAyuda) || 0
      if (monto > 0) {
        conMonto++
        acc.conMonto++
        montoTotal += monto
        acc.totalSolicitado += monto
      } else {
        sinMonto++
        acc.sinMonto++
      }
      registrosConAyuda.push({
        id: r.id,
        groupKey: key,
        uid: r.uid || null,
        cedula: norm(r.cedula), nombre: norm(r.nombre),
        local: norm(r.local), mesa: norm(r.mesa), orden: norm(r.orden), telefono: norm(r.telefono),
        montoAyuda: monto
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
      promedioConMonto: conMonto > 0 ? montoTotal / conMonto : 0
    },
    porDirigente: porDirigenteArr,
    registrosConAyuda
  }
}
