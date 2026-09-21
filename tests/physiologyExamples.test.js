import test from 'node:test'
import assert from 'node:assert/strict'
import { PHYSIOLOGY_EXAMPLES, exampleSettings, RESULTING_PROPERTIES } from '../src/lib/physiologyExamples.js'
import { buildRhythmFromPhysiology as build, physiologyToRhythmId, cycleVoltage, PHYSIOLOGY_DEFAULTS } from '../src/lib/ECGEngine.js'

test('examples replace all tissue settings, including previous autonomic and ion changes', () => {
  for (const example of PHYSIOLOGY_EXAMPLES) {
    const settings = exampleSettings(example.id)
    assert.deepEqual(Object.keys(settings).sort(), Object.keys(PHYSIOLOGY_DEFAULTS).sort())
    assert.equal(settings.sympatheticTone, 20)
    assert.equal(settings.potassiumMEqL, 4)
    const derived = build(settings).derived
    for (const property of RESULTING_PROPERTIES) assert.ok(Number.isFinite(derived[property.effective]))
  }
  const modified = exampleSettings('default')
  modified.saAutomaticity = 0
  assert.equal(exampleSettings('default').saAutomaticity, 75)
})

test('named rhythm examples actually produce their representative conduction and activation patterns', () => {
  const expected = {
    pac: 'pacs', flutter: 'atrialFlutter', af: 'atrialFibrillation',
    'first-degree': 'firstDegreeBlock', 'mobitz-i': 'mobitzI', 'mobitz-ii': 'mobitzII',
    'complete-block': 'thirdDegreeBlock', lbbb: 'lbbb', rbbb: 'rbbb',
    pvc: 'pvcs', 'multifocal-pvc': 'pvcs', vt: 'vtach', vf: 'vfib',
  }
  for (const [id, rhythm] of Object.entries(expected)) {
    assert.equal(physiologyToRhythmId(build(exampleSettings(id)).derived), rhythm, id)
  }
  assert.equal(build(exampleSettings('bradycardia')).derived.ventricularRateBpm, 45)
  assert.equal(build(exampleSettings('tachycardia')).derived.ventricularRateBpm, 120)
})

test('resulting properties reflect combined influences while baseline controls remain unchanged', () => {
  const params = { ...exampleSettings('default'), sympatheticTone: 70, parasympatheticTone: 50 }
  const derived = build(params).derived
  assert.equal(params.saAutomaticity, 75)
  assert.equal(params.avDelayMs, 125)
  assert.ok(Math.abs(derived.effectiveSaRate - 124.5) < 0.01)
  assert.ok(Math.abs(derived.effectiveAvDelayMs - 118.125) < 0.01)
  assert.ok(derived.effectiveAvDelayMs !== derived.prIntervalMs)
})


test('flutter has continuous repeating atrial activity and AF example allows a slower response', () => {
  const flutter = build(exampleSettings('flutter'))
  const atrial = flutter.waves.filter(w => w.name === 'F')
  assert.equal(atrial.length, 1)
  assert.equal(atrial[0].period, 200)
  assert.ok(cycleVoltage(0, atrial, 60) > .15)
  assert.ok(cycleVoltage(164, atrial, 60) < -.15)
  assert.ok(Math.abs(cycleVoltage(200, atrial, 60) - cycleVoltage(0, atrial, 60)) < 1e-10)
  const settings = exampleSettings('af')
  const slower = build(settings).derived
  const faster = build({ ...settings, avRefractoryMs: 200 }).derived
  assert.equal(slower.atrialRegime, 'fibrillation')
  assert.ok(slower.ventricularRateBpm >= 80 && slower.ventricularRateBpm <= 100)
  assert.ok(faster.ventricularRateBpm > slower.ventricularRateBpm)
})
