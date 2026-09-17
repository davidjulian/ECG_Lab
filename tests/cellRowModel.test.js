import test from 'node:test'
import assert from 'node:assert/strict'
import { CELL_XS, ROW_Y, CELL_CENTER_X, CELL_LEAD_RADIUS, cellLeadProbes, CELL_CYCLE_MS, CENTERED_PULSE_MS, CELL_SMOOTHING_MS, cellState, sourcesForStates, cellSourcesAt, cellPotential, cellField } from '../src/lib/cellRowModel.js'

const defaultProbes = cellLeadProbes(0)
const a = [defaultProbes.a.x, defaultProbes.a.y]
const b = [defaultProbes.b.x, defaultProbes.b.y]
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
  for (const t of [0, 150, 255, 2000, CELL_CYCLE_MS]) {
    assert.ok(CELL_XS.every((_, i) => cellState(i, t) === 1))
  }
  for (let t = 0; t <= CELL_CYCLE_MS; t++) {
    assert.ok(Math.abs(cellSourcesAt(t).reduce((sum, s) => sum + s.q, 0)) < 1e-12)
    assert.ok(CELL_XS.some((_, i) => cellState(i, t) !== -1))
  }
})
test('centered patch gives equal nonzero end-probe potentials but moving one probe reveals a signal', () => {
  const states = CELL_XS.map((_, i) => cellState(i, CENTERED_PULSE_MS))
  states.forEach((state, i) => assert.ok(Math.abs(state - states[9 - i]) < 1e-12))
  assert.ok(states[0] > 0.9 && states.includes(-1))
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
  for (let t = 1590; t <= 1740; t++) assert.ok(difference(t) > 0)
})
test('probes mirrored above and below the row cancel throughout activity', () => {
  for (let t = 0; t <= CELL_CYCLE_MS; t += 10) {
    assert.ok(Math.abs(difference(t, [210, ROW_Y - 55], [210, ROW_Y + 55])) < 1e-10)
  }
})

test('averaging matches the same centered window applied to the underlying sources', () => {
  for (const t of [280, 710, CENTERED_PULSE_MS, 1820]) {
    const steps = 1000
    let integral = 0
    for (let k = 0; k <= steps; k++) {
      const time = t + (k / steps - 0.5) * CELL_SMOOTHING_MS
      const weight = k === 0 || k === steps ? 0.5 : 1
      integral += weight * cellPotential(...a, cellSourcesAt(time, false)) / steps
    }
    assert.ok(Math.abs(integral - cellPotential(...a, cellSourcesAt(t))) < 0.002)
  }
})
test('default smoothed lead has two phases, with symmetric peak magnitudes and midpoint zero', () => {
  let negative = 0, positive = 0, previousSign = 0, crossings = 0
  for (let t = 0; t <= CELL_CYCLE_MS; t++) {
    const v = difference(t)
    negative = Math.min(negative, v)
    positive = Math.max(positive, v)
    const sign = Math.abs(v) > 1 ? Math.sign(v) : 0
    if (sign && previousSign && sign !== previousSign) crossings++
    if (sign) previousSign = sign
  }
  assert.equal(crossings, 1)
  assert.ok(positive > 400 && positive < 700)
  assert.ok(Math.abs(positive + negative) < 1e-8)
})
test('averaging reduces sharp cell-to-cell changes', () => {
  const roughness = smoothing => {
    const values = Array.from({ length: CELL_CYCLE_MS + 1 }, (_, t) => {
      const sources = cellSourcesAt(t, smoothing)
      return cellPotential(...a, sources) - cellPotential(...b, sources)
    })
    return values.slice(1, -1).reduce((sum, v, i) => sum + (values[i] - 2 * v + values[i + 2]) ** 2, 0)
  }
  assert.ok(roughness(true) < roughness(false) / 2)
})

test('rotation fixes midpoint, radius and electrode separation at every angle', () => {
  for (let angle = 0; angle < 360; angle++) {
    const { a, b } = cellLeadProbes(angle)
    assert.ok(Math.abs((a.x + b.x) / 2 - CELL_CENTER_X) < 1e-10)
    assert.ok(Math.abs((a.y + b.y) / 2 - ROW_Y) < 1e-10)
    assert.ok(Math.abs(Math.hypot(a.x - CELL_CENTER_X, a.y - ROW_Y) - CELL_LEAD_RADIUS) < 1e-10)
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 2 * CELL_LEAD_RADIUS) < 1e-10)
  }
})
test('vertical lead cancels, half-turn reverses polarity, centered pulse cancels at every angle', () => {
  const voltage = (angle, time) => {
    const { a, b } = cellLeadProbes(angle)
    const sources = cellSourcesAt(time)
    return cellPotential(a.x, a.y, sources) - cellPotential(b.x, b.y, sources)
  }
  for (let t = 0; t <= CELL_CYCLE_MS; t += 10) {
    assert.ok(Math.abs(voltage(90, t)) < 1e-10)
    assert.ok(Math.abs(voltage(180, t) + voltage(0, t)) < 1e-10)
  }
  for (let angle = 0; angle < 360; angle += 5) {
    assert.ok(Math.abs(voltage(angle, CENTERED_PULSE_MS)) < 1e-9)
  }
  assert.ok(Math.abs(voltage(0, 450)) > 100)
})
