import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecordatorioVotoMessage, formatElectionDate } from './campaignMessages.js'

const record = { nombre: 'Ana Pérez', local: 'Escuela 5', mesa: '12', orden: '34' }

test('formatElectionDate formatea una fecha ISO en español, sin año', () => {
  assert.equal(formatElectionDate('2026-11-15'), '15 de noviembre')
})

test('formatElectionDate devuelve el valor tal cual si no es ISO parseable', () => {
  assert.equal(formatElectionDate('próximo domingo'), 'próximo domingo')
})

test('formatElectionDate devuelve null si no hay valor', () => {
  assert.equal(formatElectionDate(undefined), null)
  assert.equal(formatElectionDate(''), null)
})

test('mensaje completo: candidato con fecha, lista y opción configuradas', () => {
  const candidate = { name: 'Víctor Isasi', electionDate: '2026-11-15', lista: '1', opcion: 'A' }
  const msg = buildRecordatorioVotoMessage(candidate, record)

  assert.match(msg, /Hola Ana Pérez/)
  assert.match(msg, /equipo de campaña de "Víctor Isasi"/)
  assert.match(msg, /Escuela 5/)
  assert.match(msg, /mesa 12/)
  assert.match(msg, /orden 34/)
  assert.match(msg, /el 15 de noviembre/)
  assert.match(msg, /Vota Lista "1" Opción "A"/)
})

test('retrocompatibilidad: candidato sin electionDate/lista/opcion produce el mensaje original', () => {
  const candidate = { name: 'Samy Fidabel' }
  const msg = buildRecordatorioVotoMessage(candidate, record)

  assert.equal(
    msg,
    'Hola Ana Pérez, te escribimos desde el equipo de campaña de "Samy Fidabel". ' +
    'Tu lugar de votación es Escuela 5, mesa 12, orden 34. ¡Contamos con tu voto!'
  )
})

test('si falta la fecha, se omite esa parte sin romper el resto del mensaje', () => {
  const candidate = { name: 'Samy Fidabel', lista: '6', opcion: '1' }
  const msg = buildRecordatorioVotoMessage(candidate, record)

  assert.doesNotMatch(msg, /voto el /)
  assert.match(msg, /¡Contamos con tu voto!/)
  assert.match(msg, /Vota Lista "6" Opción "1"/)
})

test('si falta solo lista u opción, no se agrega la línea de lista/opción', () => {
  const soloLista = buildRecordatorioVotoMessage({ name: 'X', lista: '6' }, record)
  const soloOpcion = buildRecordatorioVotoMessage({ name: 'X', opcion: '1' }, record)

  assert.doesNotMatch(soloLista, /Vota Lista/)
  assert.doesNotMatch(soloOpcion, /Vota Lista/)
})

test('datos del registro faltantes caen a "N/A" en vez de romper el mensaje', () => {
  const candidate = { name: 'X' }
  const msg = buildRecordatorioVotoMessage(candidate, { nombre: 'Ana' })

  assert.match(msg, /Escuela.*N\/A|N\/A, mesa N\/A, orden N\/A/)
})

test('no produce errores ni "undefined" visible cuando faltan fecha, lista y opción', () => {
  const msg = buildRecordatorioVotoMessage({ name: 'X' }, record)
  assert.doesNotMatch(msg, /undefined/)
})
