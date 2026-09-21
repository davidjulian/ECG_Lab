import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRhythmFromPhysiology as build, ECGVoltage, physiologyToRhythmId, PHYSIOLOGY_DEFAULTS } from '../src/lib/ECGEngine.js'
import { buildTissueEvents } from '../src/lib/myocardialWaves.js'

const beats = rhythm => rhythm.timing.ventricles
const premature = rhythm => beats(rhythm).filter(e => e.source === 'premature')
const near = (a, b, tolerance = .01) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)

test('baseline controls match effective settings and one P conducts to each QRS', () => {
  const r = build({})
  near(r.derived.ventricularRateBpm, 75)
  near(r.derived.effectiveAvDelayMs, PHYSIOLOGY_DEFAULTS.avDelayMs)
  assert.equal(r.timing.atria.length, beats(r).length)
  assert.equal(r.derived.avBlockPattern, null)
})

test('AV delay lengthens PR without changing refractory period or QRS', () => {
  const normal = build({}), delayed = build({ avDelayMs: 250 })
  near(delayed.derived.prIntervalMs - normal.derived.prIntervalMs, 125)
  near(delayed.derived.qrsDurationMs, normal.derived.qrsDurationMs)
  assert.equal(delayed.derived.effectiveAvRefractoryMs, normal.derived.effectiveAvRefractoryMs)
  assert.equal(delayed.derived.ventricularRateBpm, 75)
})

test('slow recovery produces progressive PR, a blocked P, and recovery after the pause', () => {
  const r = build({ avRecoveryMs: 1600 })
  assert.equal(r.derived.avBlockPattern, 'wenckebach')
  const group = r.timing.atria
  assert.equal(group.at(-1).blocked, 'av')
  const conducted = group.filter(e => !e.blocked)
  assert.ok(conducted.length >= 3)
  for (let i = 1; i < conducted.length; i++) assert.ok(conducted[i].pr > conducted[i - 1].pr)
  near(conducted[0].pr, 160)
  assert.ok(r.derived.prRangeMs[1] - r.derived.prRangeMs[0] > 100)
  assert.equal(r.conductionMap.filter(e => e.id === 'lv').length, conducted.length)
})

test('slower atrial firing can restore 1:1 conduction with the same recovery setting', () => {
  const r = build({ avRecoveryMs: 1600, saAutomaticity: 50 })
  assert.equal(r.derived.avBlockPattern, null)
  assert.equal(r.derived.ventricularRateBpm, 50)
})

test('increasing SA rate alone differs from sympathetic stimulation at the same rate', () => {
  const sympathetic = build({ sympatheticTone: 70 })
  const isolated = build({ saAutomaticity: sympathetic.derived.effectiveSaRate })
  near(sympathetic.derived.effectiveSaRate, isolated.derived.effectiveSaRate)
  assert.ok(sympathetic.derived.prIntervalMs < isolated.derived.prIntervalMs)
  assert.ok(sympathetic.derived.effectiveAvRefractoryMs < isolated.derived.effectiveAvRefractoryMs)
})

test('distal failures preserve conducted PR and block below the AV node', () => {
  const r = build({ distalConductionFailure: 'frequent' })
  assert.equal(r.derived.avBlockPattern, 'distal')
  near(r.derived.prRangeMs[0], r.derived.prRangeMs[1])
  assert.ok(r.conductionMap.some(e => e.id === 'his' && e.state === 'blocked'))
})

test('complete AV nodal block permits junctional escape; bilateral bundle failure does not', () => {
  const av = build({ avConduction: 'interrupted' })
  assert.equal(av.derived.escapeSource, 'purkinje')
  assert.equal(av.derived.ventricularRateBpm, 45)
  assert.equal(av.derived.prIntervalMs, undefined)
  const distal = build({ leftBundleVelocityPct: 0, rightBundleVelocityPct: 0 })
  assert.equal(distal.derived.escapeSource, 'ventricular')
  assert.equal(distal.derived.ventricularRateBpm, 30)
  assert.ok(distal.derived.qrsDurationMs > av.derived.qrsDurationMs)
})

test('SA suppression exposes backup pacemakers and no pacemakers gives a flat baseline, not VF', () => {
  const escape = build({ saAutomaticity: 0 })
  assert.equal(escape.derived.escapeSource, 'purkinje')
  assert.equal(escape.waves.some(w => w.name === 'P'), false)
  const stopped = build({ saAutomaticity: 0, purkinjeAutomaticity: 0, ventricularEscapeRate: 0 })
  assert.equal(stopped.derived.ventricularRateBpm, 0)
  assert.equal(stopped.derived.qrsDurationMs, null)
  for (let t = 0; t < 4000; t += 53) assert.ok(Math.abs(ECGVoltage(t, stopped.cycleMs, stopped.waves, 60, stopped.nativeCycleMs)) < .1)
})

test('suppressed backup automaticity and heterogeneity do not create premature beats', () => {
  const r = build({ ventricularEscapeRate: 40, repolHeterogeneity: 'high' })
  assert.equal(r.derived.ventricularPrematureBeats, 0)
  assert.equal(beats(r).length, r.timing.atria.length)
})

test('multifocal atrial premature activity changes P morphology without widening conducted QRS', () => {
  const r = build({ atrialPrematureActivity: 'frequent', atrialPrematureFoci: 'multifocal' })
  assert.ok(r.derived.atrialPrematureBeats >= 3)
  assert.ok(new Set(r.waves.filter(w => w.name === 'P').map(w => w.axisDeg)).size >= 4)
  near(r.derived.qrsDurationMs, build({}).derived.qrsDurationMs)
  assert.ok(r.conductionMap.some(e => e.id === 'la' && e.state === 'ectopic'))
  assert.equal(new Set(r.conductionMap.filter(e => e.id === 'la' && e.state === 'ectopic').map(e => e.focusIndex)).size, 3)
})

test('single-focus PVCs repeat one shape; multifocal PVCs have different paths and widths', () => {
  const single = build({ ventricularPrematureActivity: 'frequent' })
  const multi = build({ ventricularPrematureActivity: 'frequent', ventricularPrematureFoci: 'multifocal' })
  assert.ok(premature(single).length >= 3)
  const axes = r => new Set(r.waves.filter(w => w.name === 'R' && w.axisDeg !== 60).map(w => w.axisDeg))
  assert.equal(axes(single).size, 1)
  assert.equal(axes(multi).size, 3)
  assert.ok(multi.derived.qrsRangeMs[1] > multi.derived.qrsRangeMs[0])
  assert.equal(single.derived.prIntervalMs, multi.derived.prIntervalMs)
  assert.equal(new Set(multi.conductionMap.filter(e => e.id === 'lv' && e.state === 'ectopic').map(e => e.focusIndex)).size, 3)
})

test('premature frequency and timing change events; sufficiently early atrial impulses fail', () => {
  const occasional = build({ atrialPrematureActivity: 'occasional' })
  const frequent = build({ atrialPrematureActivity: 'frequent' })
  assert.ok(frequent.derived.atrialPrematureBeats / frequent.cycleMs > occasional.derived.atrialPrematureBeats / occasional.cycleMs)
  const early = build({ atrialPrematureActivity: 'frequent', atrialPrematurityPct: 40, atrialRefractoryMs: 350 })
  assert.equal(early.derived.atrialPrematureBeats, 0)
})

test('flutter and fibrillation remain accessible; AV refractory period filters flutter', () => {
  const flutter = build({ atrialRefractoryMs: 190 })
  const filtered = build({ atrialRefractoryMs: 190, avRefractoryMs: 500 })
  assert.equal(flutter.derived.atrialRegime, 'flutter')
  assert.ok(filtered.derived.ventricularRateBpm < flutter.derived.ventricularRateBpm)
  assert.equal(build({ atrialRefractoryMs: 150 }).derived.atrialRegime, 'fibrillation')
})

test('complete block preserves ongoing flutter and fibrillation activity', () => {
  for (const [atrialRefractoryMs, name] of [[190, 'F'], [150, 'f']]) {
    const r = build({ atrialRefractoryMs, avConduction: 'interrupted' })
    assert.ok(r.waves.some(w => w.name === name))
    assert.equal(r.derived.ventricularRateBpm, 45)
    assert.equal(r.derived.avRatio, Infinity)
  }
})

test('parameter combinations produce finite waveforms and valid measurements', () => {
  for (const saAutomaticity of [0, 30, 75, 120, 200]) {
    for (const avRecoveryMs of [100, 1000, 1800]) {
      for (const activity of ['off', 'frequent']) {
        const r = build({ saAutomaticity, avRecoveryMs, atrialPrematureActivity: activity,
          ventricularPrematureActivity: activity, atrialPrematureFoci: 'multifocal', ventricularPrematureFoci: 'multifocal' })
        assert.ok(r.cycleMs > 0 && Number.isFinite(r.cycleMs))
        assert.ok(r.waves.every(w => [w.center, w.sigma, w.amplitude, w.axisDeg].every(Number.isFinite)))
        assert.ok(r.derived.ventricularRateBpm >= 0)
        for (const range of [r.derived.prRangeMs, r.derived.qrsRangeMs, r.derived.qtRangeMs]) {
          if (range) assert.ok(range[0] > 0 && range[1] >= range[0])
        }
      }
    }
  }
})

const vulnerableVentricle = { ventricularConductionVelocityPct: 30, ventricularPrematureActivity: 'frequent' }
test('myocardial slowing broadens QRS without creating a bundle block or changing SA rate', () => {
  const normal = build({}), slow = build({ ventricularConductionVelocityPct: 30 })
  assert.ok(slow.derived.qrsDurationMs > normal.derived.qrsDurationMs)
  assert.equal(slow.derived.ventricularRegime, 'organized')
  assert.equal(slow.derived.leftImpairment, 0)
  assert.equal(slow.derived.ventricularRateBpm, 75)
})

test('a premature impulse and vulnerable tissue together select VT or VF', () => {
  for (const params of [
    { repolHeterogeneity: 'high' },
    { ...vulnerableVentricle },
    { ventricularConductionVelocityPct: 30, repolHeterogeneity: 'high' },
    { ventricularPrematureActivity: 'frequent', repolHeterogeneity: 'high' },
  ]) assert.equal(build(params).derived.ventricularRegime, 'organized')
  const vt = build({ ...vulnerableVentricle, repolHeterogeneity: 'moderate' })
  assert.equal(physiologyToRhythmId(vt.derived), 'vtach')
  assert.ok(vt.derived.ventricularRateBpm > 150)
  assert.equal(vt.derived.atrialRateBpm, 75)
  assert.ok(vt.derived.qrsDurationMs > 120)
  assert.equal(vt.derived.prIntervalMs, null)
  const ventricularEvents = vt.conductionMap.filter(e => e.id === 'lv')
  assert.equal(ventricularEvents.length, vt.waves.filter(w => w.name === 'R' && w.center >= 0).length)
  assert.ok(ventricularEvents.length > vt.conductionMap.filter(e => e.id === 'ra').length)
  const vf = build({ ...vulnerableVentricle, repolHeterogeneity: 'high' })
  assert.equal(physiologyToRhythmId(vf.derived), 'vfib')
  for (const field of ['ventricularRateBpm', 'prIntervalMs', 'qrsDurationMs', 'qtIntervalMs']) assert.equal(vf.derived[field], null)
  assert.ok(vf.waves.every(w => w.name === 'f'))
  const tissue = buildTissueEvents(vf.conductionMap, vf.waves)
  assert.equal(tissue.ra.disorganized, false)
  assert.ok(tissue.ra.events.length > 0)
  assert.equal(tissue.rv.disorganized, true)
  assert.equal(tissue.lv.disorganized, true)
  assert.equal(tissue.lv.events.length, 0)
  const voltages = Array.from({ length: 1000 }, (_, i) => ECGVoltage(i * 11, vf.cycleMs, vf.waves, 60, vf.nativeCycleMs))
  assert.ok(voltages.every(Number.isFinite))
  assert.ok(Math.max(...voltages) - Math.min(...voltages) > .5)
})

test('reset restores organized activity and hyperkalemic sine waves are not labeled VF', () => {
  const restored = build(PHYSIOLOGY_DEFAULTS)
  assert.equal(restored.derived.ventricularRegime, 'organized')
  assert.equal(physiologyToRhythmId(restored.derived), 'normalSinus')
  const potassium = build({ potassiumMEqL: 9 })
  assert.equal(physiologyToRhythmId(potassium.derived), 'hyperkalemia')
})


test('maximal sympathetic activity reaches about 185 bpm with coordinated 1:1 conduction', () => {
  const baseline = build({})
  const stimulated = build({ sympatheticTone: 100, parasympatheticTone: 0 })
  near(baseline.derived.effectiveSaRate, 75)
  near(stimulated.derived.effectiveSaRate, 185, 1)
  assert.equal(stimulated.derived.ventricularRateBpm, 185)
  assert.equal(stimulated.derived.avBlockPattern, null)
  assert.equal(stimulated.timing.atria.length, stimulated.timing.ventricles.length)
  assert.ok(stimulated.timing.atria.every(event => !event.blocked))
  assert.ok(stimulated.derived.effectiveAvDelayMs < baseline.derived.effectiveAvDelayMs)
  assert.ok(stimulated.derived.effectiveAvRecoveryMs < baseline.derived.effectiveAvRecoveryMs)
  const suppressed = build({ saAutomaticity: 0, sympatheticTone: 100, parasympatheticTone: 0 })
  assert.equal(suppressed.derived.effectiveSaRate, 0)
})
