import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTissueEvents, latestTissueEvent, tissueColor, fibrillationColor } from '../src/lib/myocardialWaves.js'
const map = [{ id: 'lv', onsetMs: 180, offsetMs: 250, state: 'active' }]
const timing = buildTissueEvents(map, [{ name: 'T', center: 380, sigma: 35 }])
const event = timing.lv.events[0]

test('ventricular tissue holds depolarization between QRS and T', () => {
  assert.equal(tissueColor({ ...event, time: 179 }, 0, 0), null)
  assert.deepEqual(tissueColor({ ...event, time: 280 }, .5, .5), [223, 105, 76, 230])
  assert.equal(tissueColor({ ...event, time: 451 }, .5, .5), null)
})
test('recovery follows a distinct spatial order and does not precede activation', () => {
  assert.equal(tissueColor({ ...event, time: 345 }, .9, 0), null)
  assert.deepEqual(tissueColor({ ...event, time: 345 }, .1, 1), [223, 105, 76, 230])
})
test('cycle boundaries preserve recovery from the previous beat', () => {
  const wrapped = { start: 700, end: 780, recoveryStart: 850, recoveryEnd: 950, state: 'active' }
  const atStart = latestTissueEvent([wrapped], 20, 800)
  assert.equal(atStart.time, 820)
  assert.deepEqual(tissueColor(atStart, .5, .5), [223, 105, 76, 230])
  assert.equal(tissueColor(latestTissueEvent([wrapped], 200, 800), .5, .5), null)
})
test('absent ventricular events do not invent a conducted beat', () => {
  const blocked = buildTissueEvents([{ id: 'av', onsetMs: 130, offsetMs: 330, state: 'blocked' }], [])
  assert.equal(latestTissueEvent(blocked.lv.events, 200, 800), null)
})
test('irregular beats match their own T wave and latest activation', () => {
  const series = buildTissueEvents([...map, { id: 'lv', onsetMs: 900, offsetMs: 1020, state: 'ectopic' }],
    [{ name: 'T', center: 380, sigma: 35 }, { name: 'T', center: 1150, sigma: 40 }]).lv.events
  assert.equal(series[1].recoveryEnd, 1230)
  assert.equal(latestTissueEvent(series, 950, 1600).state, 'ectopic')
})
test('fibrillation stays disorganized and never gains a sinus activation event', () => {
  const result = buildTissueEvents([{ id: 'ra', state: 'shimmer' }], [])
  assert.equal(result.ra.disorganized, true)
  assert.equal(result.ra.events.length, 0)
})

test('fibrillation shows local activation, recovery, and rest and is stable while paused', () => {
  const point = { fibrillationPhase: .31, fibrillationPeriod: 180, fibrillationWarp: .8 }
  const colors = Array.from({ length: 200 }, (_, time) => fibrillationColor(point, time))
  assert.ok(colors.some(c => c === null))
  assert.ok(colors.some(c => c?.[0] === 253))
  assert.ok(colors.some(c => c?.[0] === 223))
  assert.ok(colors.some(c => c?.[0] === 56))
  assert.deepEqual(fibrillationColor(point, 57), fibrillationColor(point, 57))
  const neighbor = { ...point, fibrillationPhase: point.fibrillationPhase + .5 }
  assert.notDeepEqual(fibrillationColor(point, 57), fibrillationColor(neighbor, 57))
})
