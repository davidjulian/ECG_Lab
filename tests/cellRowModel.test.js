import test from 'node:test'
import assert from 'node:assert/strict'
import { CELL_XS, ROW_Y, CELL_CYCLE_MS, CENTERED_PULSE_MS, cellState, sourcesForStates, cellSourcesAt, cellPotential, cellField } from '../src/lib/cellRowModel.js'

const a = [CELL_XS[0] - 31, ROW_Y - 48.5]
const b = [CELL_XS[9] + 31, ROW_Y - 48.5]
const difference = (t, first = a, second = b) => {
  const sources = cellSourcesAt(t)
  return cellPotential(...first, sources) - cellPotential(...second, sources)
}
test('uniform membrane polarization creates no extracellular source or field', () => {
  for (const state of [1, -1]) {
    const sources = sourcesForStates(Array(10).fill(state))
    for (const point of [[20, 40], [280, ROW_Y], [440, 305]]) {
      assert.equal(cellPotential(...point, sources), 0)
      assert.deepEqual(cellField(...point, sources), [0, 0])
    }
  }
})
test('cycle has initial and final resting intervals and balanced sources throughout', () => {
  for (const t of [0, 150, 300, 1500, CELL_CYCLE_MS]) {
    assert.ok(CELL_XS.every((_, i) => cellState(i, t) === 1))
  }
  for (let t = 0; t <= CELL_CYCLE_MS; t++) {
    assert.ok(Math.abs(cellSourcesAt(t).reduce((sum, s) => sum + s.q, 0)) < 1e-12)
    assert.ok(CELL_XS.some((_, i) => cellState(i, t) !== -1))
  }
})
test('centered patch gives equal nonzero end-probe potentials but moving one probe reveals a signal', () => {
  const states = CELL_XS.map((_, i) => cellState(i, CENTERED_PULSE_MS))
  assert.deepEqual(states, states.slice().reverse())
  assert.ok(states.includes(1) && states.includes(-1))
  assert.ok(Math.abs(difference(CENTERED_PULSE_MS)) < 1e-10)
  assert.ok(Math.abs(cellPotential(...a, cellSourcesAt(CENTERED_PULSE_MS))) > 100)
  assert.ok(Math.abs(difference(CENTERED_PULSE_MS, [CELL_XS[3], ROW_Y - 48.5])) > 100)
})
test('a single resting/depolarized boundary retains a nonzero dipole signal', () => {
  const sources = sourcesForStates([-1, -1, -1, -1, -1, 1, 1, 1, 1, 1])
  assert.ok(Math.abs(cellPotential(...a, sources) - cellPotential(...b, sources)) > 1)
  assert.ok(Math.abs(sources.reduce((sum, s) => sum + s.q * s.x, 0)) > 1)
})
test('lesson activation/recovery intervals have opposite polarity at default probes', () => {
  for (let t = 400; t <= 550; t++) assert.ok(difference(t) < 0)
  for (let t = 1200; t <= 1350; t++) assert.ok(difference(t) > 0)
})
test('probes mirrored above and below the row cancel throughout activity', () => {
  for (let t = 0; t <= CELL_CYCLE_MS; t += 10) {
    assert.ok(Math.abs(difference(t, [210, ROW_Y - 55], [210, ROW_Y + 55])) < 1e-10)
  }
})
