// ECGEngine.js
//
// Rebuilt architecture: each cardiac complex is generated INDEPENDENTLY from
// physiological parameters. Heart rate controls only the RR interval — how
// often a complex fires — NOT the shape or duration of any wave component.
//
// Reference: Boron & Boulpaep, Medical Physiology, 3rd ed.
//   PR interval:  120–200 ms (normal)
//   QRS duration: < 120 ms  (normal)
//   QTc (Bazett): ≤ 440 ms  (normal)
//   QT at 75 bpm: ~380 ms

// ─── Core math ────────────────────────────────────────────────────────────────

function gaussian(t, amplitude, center, sigma) {
  return amplitude * Math.exp(-((t - center) ** 2) / (2 * sigma ** 2))
}

function projectionFactor(sourceAxisDeg, leadAxisDeg) {
  return Math.cos(((sourceAxisDeg - leadAxisDeg) * Math.PI) / 180)
}

function ECGNoise(tMs) {
  return (
    0.012 * Math.sin(tMs * 0.0157 + 1.7) +
    0.008 * Math.sin(tMs * 0.0421 + 4.1) +
    0.005 * Math.sin(tMs * 0.1093 + 0.3)
  )
}

// Seeded PRNG (mulberry32) — used where we want reproducible-but-realistic
// chaos without a fixed pattern. Seed once per builder call, not per sample.
function mulberry32(seed) {
  let s = seed
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function warpTime(tMs) {
  return (
    tMs +
    30 * Math.sin(tMs * 0.00073 + 0.9) +
    12 * Math.sin(tMs * 0.00211 + 3.4)
  )
}

// ─── Lead system ──────────────────────────────────────────────────────────────

export const LEADS = {
  I:   { id: 'I',   label: 'Lead I',   axisDeg:    0 },
  II:  { id: 'II',  label: 'Lead II',  axisDeg:   60 },
  III: { id: 'III', label: 'Lead III', axisDeg:  120 },
  aVR: { id: 'aVR', label: 'aVR',      axisDeg: -150 },
  aVL: { id: 'aVL', label: 'aVL',      axisDeg:  -30 },
  aVF: { id: 'aVF', label: 'aVF',      axisDeg:   90 },
}
export const LEAD_ORDER    = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
export const DEFAULT_LEAD_ID = 'II'

// ─── Complex timing layout ────────────────────────────────────────────────────
// From physiological intervals → Gaussian {center, sigma} for each wave.
// Convention: t=0 is the start of the complex (P wave onset, or isoelectric
// lead-in if there is no P wave). All values in milliseconds.

function layoutComplex(p) {
  const {
    hasPWave    = true,
    pDuration   = 80,    // ±2σ effective P width
    prInterval  = 160,   // P onset → QRS onset
    qrsDuration = 80,    // QRS onset → QRS offset (±2σ of S wave)
    qtInterval  = 380,   // QRS onset → T wave end (±2σ of T wave)
    tDuration   = 160,   // ±2σ effective T width
    qrsLeadIn   = 20,    // isoelectric before QRS when hasPWave=false
  } = p

  const pSigma = pDuration / 4
  const tSigma = tDuration / 4

  // Sub-wave sigmas: chosen so Q/R/S overlap naturally within qrsDuration
  const qSigma = Math.max(3, qrsDuration * 0.09)
  const rSigma = Math.max(5, qrsDuration * 0.16)
  const sSigma = Math.max(4, qrsDuration * 0.12)

  const qrsOnset = hasPWave ? prInterval : qrsLeadIn

  return {
    pCenter:         hasPWave ? pDuration / 2 : null,
    pSigma,
    qrsOnset,
    qCenter:         qrsOnset + qrsDuration * 0.22,
    qSigma,
    rCenter:         qrsOnset + qrsDuration * 0.48,
    rSigma,
    sCenter:         qrsOnset + qrsDuration * 0.80,
    sSigma,
    qrsOffset:       qrsOnset + qrsDuration,
    tCenter:         qrsOnset + qtInterval - 2 * tSigma,
    tSigma,
    complexDuration: qrsOnset + qtInterval + tDuration / 2 + 25,
  }
}

// ─── Wave array builder ───────────────────────────────────────────────────────
// Produces the [{name, amplitude, center, sigma, axisDeg}] array that
// cycleVoltage / measureIntervals / HeartAnimation all consume.

function buildWaveArray(params) {
  const {
    hasPWave       = true,
    pAmplitude     = 0.25,
    pAxis          = 60,
    qAmplitude     = -0.10,
    rAmplitude     = 1.50,
    sAmplitude     = -0.25,
    qrsAxis        = 60,
    stElevation    = 0,
    tAmplitude     = 0.35,
    tAxis          = 45,
    hasPacerSpike  = false,
    spikeAmplitude = 2.50,
    spikeDuration  = 6,
    spikeQrsDelay  = 18,
  } = params

  const pos   = layoutComplex(params)
  const waves = []

  if (hasPacerSpike) {
    const spikeSigma  = spikeDuration / 4
    const spikeCenter = pos.qrsOnset - spikeQrsDelay
    waves.push({ name: 'Spike', amplitude: spikeAmplitude, center: spikeCenter, sigma: spikeSigma, axisDeg: 0 })
  }

  if (hasPWave) {
    waves.push({ name: 'P', amplitude: pAmplitude, center: pos.pCenter, sigma: pos.pSigma, axisDeg: pAxis })
  }

  waves.push({ name: 'Q', amplitude: qAmplitude, center: pos.qCenter, sigma: pos.qSigma, axisDeg: qrsAxis })
  waves.push({ name: 'R', amplitude: rAmplitude, center: pos.rCenter, sigma: pos.rSigma, axisDeg: qrsAxis })
  waves.push({ name: 'S', amplitude: sAmplitude, center: pos.sCenter, sigma: pos.sSigma, axisDeg: qrsAxis })
  waves.push({ name: 'T', amplitude: tAmplitude, center: pos.tCenter, sigma: pos.tSigma, axisDeg: tAxis })

  if (stElevation !== 0) {
    const stCenter = pos.qrsOffset + (pos.tCenter - pos.qrsOffset) / 2
    waves.push({ name: 'ST', amplitude: stElevation, center: stCenter, sigma: 40, axisDeg: qrsAxis })
  }

  return waves
}

// ─── generateComplex — the new public API ────────────────────────────────────
// Returns [{time, voltage}] for one complete PQRST complex.
// Each wave has its own electrical axis; `leadAxisDeg` sets the viewing lead.

export function generateComplex(params, leadAxisDeg = LEADS.II.axisDeg) {
  const waves        = buildWaveArray(params)
  const pos          = layoutComplex(params)
  const sampleRateMs = params.sampleRateMs ?? 2
  const points       = []

  for (let t = 0; t <= pos.complexDuration; t += sampleRateMs) {
    let v = 0
    for (const w of waves) {
      v += gaussian(t, w.amplitude, w.center, w.sigma) *
           projectionFactor(w.axisDeg, leadAxisDeg)
    }
    points.push({ time: t, voltage: v })
  }
  return points
}

// complexWaves: exported alias — returns the wave-definition array
// (used by HeartAnimation, measureIntervals, etc.)
export function complexWaves(params) {
  return buildWaveArray(params)
}

// ─── RHYTHM_PRESETS ───────────────────────────────────────────────────────────
// Physiologically accurate parameter objects for 16 cardiac rhythms.
// Simple rhythms (no complexType) produce a single repeating complex.
// Complex rhythms (complexType set) require macro-cycle builders below.

export const RHYTHM_PRESETS = {

  normalSinus: {
    label:        'Normal Sinus Rhythm',
    description:  'Regular SA-node origin, normal AV conduction, all intervals within reference range.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
  },

  sinusTachycardia: {
    label:        'Sinus Tachycardia',
    description:  'Normal SA-node morphology at >100 bpm. QT shortens with rate (Bazett).',
    hr:            130,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  70,  pAxis:   60,
    prInterval:    140,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 120,  tAxis:   45,
    qtInterval:    295,    // Bazett: ~295 ms at 130 bpm (QTc ≈ 400 ms)
  },

  sinusBradycardia: {
    label:        'Sinus Bradycardia',
    description:  'Normal SA-node morphology at <60 bpm. QT lengthens with slow rate.',
    hr:            45,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  90,  pAxis:   60,
    prInterval:    170,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 190,  tAxis:   45,
    qtInterval:    450,    // Bazett: ~450 ms at 45 bpm
  },

  firstDegreeBlock: {
    label:        '1st-Degree AV Block',
    description:  'Every impulse conducts but with fixed prolonged AV delay. PR > 200 ms by definition.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    260,    // diagnostic criterion: >200 ms
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
  },

  lbbb: {
    label:        'Left Bundle Branch Block',
    description:  'LV depolarizes cell-to-cell (slow). QRS > 120 ms, left axis deviation, discordant T wave.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.05,  rAmplitude: 1.00, sAmplitude: -0.45,
    qrsDuration:   145,   qrsAxis:   -45,   // left axis deviation
    stElevation:  -0.08,
    tAmplitude:    0.35,  tDuration: 185,  tAxis:  135,  // discordant
    qtInterval:    450,
  },

  rbbb: {
    label:        'Right Bundle Branch Block',
    description:  'RV depolarizes late via slow myocardial spread. QRS > 120 ms, right axis, discordant T.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.08,  rAmplitude: 0.90, sAmplitude: -0.50,
    qrsDuration:   140,   qrsAxis:    90,   // right axis deviation
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 175,  tAxis:  -90,  // discordant
    qtInterval:    430,
  },

  vtach: {
    label:        'Ventricular Tachycardia',
    description:  'Rapid ventricular-origin rhythm. Wide bizarre QRS, no P waves, AV dissociation.',
    hr:            180,
    hasPWave:      false,
    qAmplitude:   -0.15,  rAmplitude: 1.20, sAmplitude: -0.60,
    qrsDuration:   160,   qrsAxis:  -120,   // extreme axis — ventricular ectopic
    stElevation:   0,
    tAmplitude:   -0.50,  tDuration: 140,  tAxis:   60,  // discordant
    qtInterval:    360,
    qrsLeadIn:     15,
  },

  ventricularPaced: {
    label:        'Ventricular-Paced Rhythm',
    description:  "Pacemaker drives each beat. Spike → wide QRS (RV apex pacing), discordant T, no native P wave.",
    hr:            70,
    hasPWave:      false,
    hasPacerSpike: true,
    spikeAmplitude: 2.50,
    spikeDuration:   6,
    spikeQrsDelay:  18,
    qAmplitude:   -0.20,  rAmplitude: 0.85, sAmplitude: -0.30,
    qrsDuration:   150,   qrsAxis:   -75,
    stElevation:   0,
    tAmplitude:    0.40,  tDuration: 200,  tAxis:  105,  // discordant
    qtInterval:    460,
    qrsLeadIn:     25,
  },

  // ── Irregular / macro-cycle rhythms (complexType required) ────────────────

  mobitzI: {
    label:        'Mobitz I (Wenckebach)',
    description:  'Progressive PR lengthening until one P wave fails to conduct. Cycle resets. Grouped beating pattern.',
    complexType:  'mobitzI',
    atrialRate:    90,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    // Diminishing PR increments (+80, +30) → RR shortens each beat before drop.
    // Classic Wenckebach: largest increment first, smaller each successive beat.
    prIntervals:   [160, 240, 270],   // 4:3 conduction — 3 beats then blocked P
    qAmplitude:   -0.10,  rAmplitude: 1.20, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 150,  tAxis:   45,
    qtInterval:    360,
  },

  mobitzII: {
    label:        'Mobitz II',
    description:  'Fixed PR on conducted beats; sudden dropped QRS without warning. More dangerous than Wenckebach.',
    complexType:  'mobitzII',
    atrialRate:    90,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,    // constant — key distinguishing feature from Mobitz I
    conductionRatio: [2, 1],   // 2:1 — every other P drops (most dramatic pattern)
    // Slightly wide QRS: Mobitz II block is typically at bundle branch level
    qAmplitude:   -0.08,  rAmplitude: 1.10, sAmplitude: -0.30,
    qrsDuration:   120,   qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.28,  tDuration: 150,  tAxis:   45,
    qtInterval:    380,
  },

  thirdDegreeBlock: {
    label:        '3rd-Degree (Complete) AV Block',
    description:  'Complete AV dissociation. P waves march independently at atrial rate; slow wide ventricular escape.',
    complexType:  'thirdDegreeBlock',
    atrialRate:    75,     // independent SA node (~75 bpm)
    ventricularRate: 32,   // slow idioventricular escape pacemaker (20–40 bpm)
    pAmplitude:    0.22,  pDuration:  80,  pAxis:   60,
    // Wide bizarre QRS: ventricular origin, no His-Purkinje conduction
    // No Q wave (absent in ventricular escapes). Axis: extreme left axis deviation.
    // qrsAxis -75° → in Lead II: R projects ×cos(-135°)=-0.71 → net complex NEGATIVE
    rAmplitude:    0.90,  sAmplitude: -0.22,
    qrsDuration:   180,   qrsAxis:   -75,
    stElevation:   0,
    // Discordant T: tAxis 105° → in Lead II projects ×cos(45°)=+0.71 → T POSITIVE
    // (opposite polarity to the predominantly negative QRS in Lead II)
    tAmplitude:    0.65,  tDuration: 230,  tAxis:  105,
    qtInterval:    520,
  },

  atrialFlutter: {
    label:        'Atrial Flutter (2:1)',
    description:  'Reentrant circuit ≈ 300 bpm. Sawtooth flutter waves; every other wave conducts (2:1) → ≈ 150 bpm.',
    complexType:  'atrialFlutter',
    flutterRate:         300,
    ventricularRate:     150,
    flutterAmplitude:    0.15,
    flutterAxis:         -15,
    qAmplitude:   -0.10,  rAmplitude: 1.10, sAmplitude: -0.20,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.25,  tDuration: 130,  tAxis:   45,
    qtInterval:    310,
  },

  atrialFibrillation: {
    label:        'Atrial Fibrillation',
    description:  'Chaotic atrial activity. No P waves — fibrillatory baseline. Irregularly irregular ventricular response.',
    complexType:  'atrialFibrillation',
    meanVentricularRate:  90,
    rrVariability:        0.22,    // ±22% deterministic variation around mean RR
    fibrillatoryAmplitude: 0.07,
    qAmplitude:   -0.10,  rAmplitude: 1.10, sAmplitude: -0.20,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.25,  tDuration: 130,  tAxis:   45,
    qtInterval:    330,
  },

  pvcs: {
    label:        'Premature Ventricular Contractions',
    description:  'Ventricular ectopic beat: wide bizarre QRS, no preceding P, discordant T, fully compensatory pause.',
    complexType:  'pvcs',
    sinusRate:     75,
    multifocal:    true,     // show two different PVC morphologies to simulate different ectopic foci
    // Normal sinus beat params
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
    // Focus 1 PVC params (left ventricular origin)
    pvcRAmplitude:   1.40,
    pvcSAmplitude:  -0.55,
    pvcQrsDuration:  155,
    pvcQrsAxis:     -100,
    pvcTAmplitude:  -0.45,   // discordant (opposite polarity to QRS)
    pvcTAxis:        80,
    pvcQtInterval:   390,
    pvcCoupling:     0.65,   // fires at 65% of normal RR (premature)
    // Focus 2 PVC params (right ventricular origin — different axis/morphology)
    pvc2RAmplitude:  1.10,
    pvc2SAmplitude: -0.80,
    pvc2QrsDuration: 160,
    pvc2QrsAxis:     130,    // right axis (RV origin)
    pvc2TAmplitude: -0.35,
    pvc2TAxis:      -50,
    pvc2QtInterval:  400,
    pvc2Coupling:    0.70,   // slightly later coupling than focus 1
  },

  pacs: {
    label:        'Premature Atrial Contractions',
    description:  'Ectopic atrial beat: different P morphology, normal QRS-T, non-compensatory pause.',
    complexType:  'pacs',
    sinusRate:     75,
    // Normal sinus beat params
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
    // PAC P wave params (ectopic atrial origin)
    pacPAmplitude:  0.13,
    pacPDuration:   60,
    pacPAxis:       30,     // different axis from normal sinus P (+60°)
    pacPrInterval:  145,    // slightly shorter PR
    pacCoupling:    0.72,   // fires at 72% of normal RR
  },

  vfib: {
    label:        'Ventricular Fibrillation',
    description:  'Completely chaotic ventricular electrical activity. No identifiable complexes. Fatal without immediate defibrillation.',
    complexType:  'vfib',
    amplitude:     0.6,
  },
}

// ─── Macro-cycle builders ─────────────────────────────────────────────────────

function placeBeat(onsetMs, waveArray) {
  return waveArray.map(w => ({ ...w, center: w.center + onsetMs }))
}

// Build a QRS-T only template at t=0 from the preset's QRS/T params.
function qrstTemplate(preset) {
  const pos = layoutComplex({
    hasPWave:    false,
    qrsDuration: preset.qrsDuration,
    qtInterval:  preset.qtInterval,
    tDuration:   160,
    qrsLeadIn:   0,
  })
  return [
    { name: 'Q', amplitude: preset.qAmplitude, center: pos.qCenter, sigma: pos.qSigma, axisDeg: preset.qrsAxis },
    { name: 'R', amplitude: preset.rAmplitude, center: pos.rCenter, sigma: pos.rSigma, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude, center: pos.sCenter, sigma: pos.sSigma, axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude, center: pos.tCenter, sigma: pos.tSigma, axisDeg: preset.tAxis },
  ]
}

function pTemplate(preset) {
  const sigma = preset.pDuration / 4
  return [{ name: 'P', amplitude: preset.pAmplitude, center: preset.pDuration / 2, sigma, axisDeg: preset.pAxis }]
}

function buildMobitzIWaves(preset) {
  const { atrialRate, prIntervals } = preset
  const pInterval = 60000 / atrialRate
  const numP      = prIntervals.length + 1   // +1 for the dropped beat P

  const waves = []
  for (let i = 0; i < numP; i++)
    waves.push(...placeBeat(i * pInterval, pTemplate(preset)))
  for (let i = 0; i < prIntervals.length; i++)
    waves.push(...placeBeat(i * pInterval + prIntervals[i], qrstTemplate(preset)))

  const cycleMs     = numP * pInterval
  const heartRateBpm = Math.round((prIntervals.length / numP) * atrialRate)
  return { waves, cycleMs, heartRateBpm }
}

function buildMobitzIIWaves(preset) {
  const { atrialRate, prInterval, conductionRatio = [3, 2] } = preset
  const [pCount, qrsCount] = conductionRatio
  const pInterval = 60000 / atrialRate

  const waves = []
  for (let i = 0; i < pCount; i++)
    waves.push(...placeBeat(i * pInterval, pTemplate(preset)))
  for (let i = 0; i < qrsCount; i++)
    waves.push(...placeBeat(i * pInterval + prInterval, qrstTemplate(preset)))

  const cycleMs      = pCount * pInterval
  const heartRateBpm = Math.round((qrsCount / pCount) * atrialRate)
  return { waves, cycleMs, heartRateBpm }
}

function buildThirdDegreeWaves(preset) {
  const { atrialRate, ventricularRate } = preset
  const atrialInterval      = 60000 / atrialRate
  const ventricularInterval = 60000 / ventricularRate
  const cycleMs             = Math.round(ventricularInterval * 3)

  // Ventricular escape: no Q wave (absent in myocardial origin beats).
  // Wide slurred R, discordant T. Both R and T use independent axes so the
  // discordance is correctly axis-projected across all leads.
  const tDuration = preset.tDuration ?? 230
  const escapePos = layoutComplex({
    hasPWave:    false,
    qrsDuration: preset.qrsDuration,
    qtInterval:  preset.qtInterval,
    tDuration,
    qrsLeadIn:   0,
  })
  const escapeTemplate = [
    { name: 'R', amplitude: preset.rAmplitude,  center: escapePos.rCenter, sigma: escapePos.rSigma * 1.15, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude,  center: escapePos.sCenter, sigma: escapePos.sSigma,        axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude,  center: escapePos.tCenter, sigma: escapePos.tSigma,        axisDeg: preset.tAxis   },
  ]

  const waves = []
  // P waves march independently (0.3 × PP offset so first P isn't at t=0)
  let pt = atrialInterval * 0.3
  while (pt < cycleMs) {
    waves.push(...placeBeat(pt, pTemplate(preset)))
    pt += atrialInterval
  }
  // Ventricular escape beats, phase-shifted so PR varies visibly across beats
  const escapeStart = ventricularInterval * 0.35
  for (let i = 0; i < 3; i++)
    waves.push(...placeBeat(escapeStart + i * ventricularInterval, escapeTemplate))

  return { waves, cycleMs, heartRateBpm: ventricularRate }
}

function buildAtrialFlutterWaves(preset) {
  const { flutterRate, ventricularRate, flutterAmplitude, flutterAxis } = preset
  const flutterInterval     = 60000 / flutterRate     // e.g., 200 ms at 300 bpm
  const ventricularInterval = 60000 / ventricularRate // e.g., 400 ms at 150 bpm
  const cycleMs             = ventricularInterval      // one ventricular beat per cycle

  const flutterWave = [
    { name: 'F', amplitude:  flutterAmplitude,        center: 20, sigma: 12, axisDeg: flutterAxis },
    { name: 'F', amplitude: -flutterAmplitude * 0.85, center: 55, sigma: 14, axisDeg: flutterAxis },
  ]

  const waves = []
  for (let t = 0; t < cycleMs; t += flutterInterval)
    waves.push(...placeBeat(t, flutterWave))
  waves.push(...placeBeat(flutterInterval, qrstTemplate(preset)))

  return { waves, cycleMs, heartRateBpm: ventricularRate }
}

function buildAFibWaves(preset) {
  const { meanVentricularRate, fibrillatoryAmplitude } = preset
  const meanRR = 60000 / meanVentricularRate

  // True randomly-irregular RR intervals — baked in at build time so the
  // macro-cycle is constant within a session but differs each page load.
  // Physiologic AFib: RR varies ±~35% around the mean, min ~350ms.
  const numBeats = 24
  const qrsOnsets = []
  let t = meanRR * 0.25
  for (let i = 0; i < numBeats; i++) {
    qrsOnsets.push(Math.round(t))
    const jitter = (Math.random() - 0.5) * meanRR * 0.70   // ±35% variation
    t += Math.max(350, Math.min(1400, meanRR + jitter))
  }
  const cycleMs = Math.round(t + meanRR * 0.3)

  // Fibrillatory baseline: 350–600 undulations per minute = every 100–170 ms.
  // Amplitude ±0.05–0.10 mV, random axis to simulate chaotic atrial activation.
  const fbWaves = []
  let ft = 0
  while (ft < cycleMs) {
    const spacing = 100 + Math.random() * 70               // 100–170 ms
    const polarity = Math.random() > 0.5 ? 1 : -1
    const amp      = polarity * (0.05 + Math.random() * 0.05)  // ±0.05–0.10 mV
    const axis     = Math.random() * 360 - 180
    fbWaves.push({ name: 'f', amplitude: amp, center: ft, sigma: 9, axisDeg: axis })
    ft += spacing
  }

  const waves = [...fbWaves, ...qrsOnsets.flatMap(onset => placeBeat(onset, qrstTemplate(preset)))]
  return { waves, cycleMs, heartRateBpm: meanVentricularRate }
}

function makePvcTemplate(p, rAmp, sAmp, tAmp, qrsDuration, qrsAxis, qtInterval, tAxis) {
  const pos = layoutComplex({ hasPWave: false, qrsDuration, qtInterval, tDuration: 170, qrsLeadIn: 15 })
  return [
    { name: 'R', amplitude: rAmp, center: pos.rCenter, sigma: pos.rSigma, axisDeg: qrsAxis },
    { name: 'S', amplitude: sAmp, center: pos.sCenter, sigma: pos.sSigma, axisDeg: qrsAxis },
    { name: 'T', amplitude: tAmp, center: pos.tCenter, sigma: pos.tSigma, axisDeg: tAxis  },
  ]
}

function buildPVCsWaves(preset) {
  const normalRR       = 60000 / preset.sinusRate
  const normalTemplate = buildWaveArray(preset)

  // Focus 1: unifocal PVC morphology
  const pvcTemplate1 = makePvcTemplate(
    preset,
    preset.pvcRAmplitude,  preset.pvcSAmplitude,  preset.pvcTAmplitude,
    preset.pvcQrsDuration, preset.pvcQrsAxis,      preset.pvcQtInterval, preset.pvcTAxis
  )
  // Focus 2: different axis / amplitude (simulates second ectopic focus)
  const pvcTemplate2 = makePvcTemplate(
    preset,
    preset.pvc2RAmplitude,  preset.pvc2SAmplitude,  preset.pvc2TAmplitude,
    preset.pvc2QrsDuration, preset.pvc2QrsAxis,      preset.pvc2QtInterval, preset.pvc2TAxis
  )

  // PVC 1 coupling: e.g. 0.65 × normalRR after beat 3
  const pvc1FiringMs = normalRR * 2 + normalRR * preset.pvcCoupling
  // Compensatory pause: next sinus beat resumes on its original schedule (beat 4 = 4×RR)
  // ∴ interval before PVC + interval after = pvcCoupling×RR + (2-pvcCoupling)×RR = 2×RR ✓

  // R-on-T detection: does PVC fire during the T wave of the preceding beat?
  const normalPos       = layoutComplex({ hasPWave: true, prInterval: preset.prInterval, qrsDuration: preset.qrsDuration, qtInterval: preset.qtInterval, tDuration: 160 })
  const beat3Onset      = normalRR * 2
  const tWaveStart      = beat3Onset + normalPos.tCenter - 2 * normalPos.tSigma
  const tWaveEnd        = beat3Onset + normalPos.tCenter + 2 * normalPos.tSigma
  const isROnT          = pvc1FiringMs >= tWaveStart && pvc1FiringMs <= tWaveEnd

  const annotations = isROnT
    ? [{ tMs: pvc1FiringMs, label: '⚠ R-on-T', type: 'warning' }]
    : []

  if (!preset.multifocal) {
    // Unifocal: single PVC in a 5-beat cycle
    return {
      waves: [
        ...placeBeat(0,            normalTemplate),
        ...placeBeat(normalRR,     normalTemplate),
        ...placeBeat(normalRR * 2, normalTemplate),
        ...placeBeat(pvc1FiringMs, pvcTemplate1),
        ...placeBeat(normalRR * 4, normalTemplate),   // compensatory: resumes original schedule
      ],
      cycleMs: normalRR * 5,
      heartRateBpm: preset.sinusRate,
      annotations,
    }
  }

  // Multifocal: two different PVC morphologies in a longer cycle.
  // Layout: 3 normal → PVC(focus1, comp pause) → 3 normal → PVC(focus2, comp pause)
  const pvc2FiringMs = normalRR * 6 + normalRR * preset.pvc2Coupling   // after beat 7 (index 6)
  const cycleMs      = normalRR * 10   // 10 RR cycle: 3+PVC+comp + 3+PVC+comp

  return {
    waves: [
      ...placeBeat(0,                normalTemplate),
      ...placeBeat(normalRR,         normalTemplate),
      ...placeBeat(normalRR * 2,     normalTemplate),
      ...placeBeat(pvc1FiringMs,     pvcTemplate1),
      ...placeBeat(normalRR * 4,     normalTemplate),  // resumes on schedule
      ...placeBeat(normalRR * 5,     normalTemplate),
      ...placeBeat(normalRR * 6,     normalTemplate),
      ...placeBeat(pvc2FiringMs,     pvcTemplate2),
      ...placeBeat(normalRR * 8,     normalTemplate),  // compensatory
      ...placeBeat(normalRR * 9,     normalTemplate),
    ],
    cycleMs,
    heartRateBpm: preset.sinusRate,
    annotations,
  }
}

function buildPACsWaves(preset) {
  const normalRR = 60000 / preset.sinusRate
  const normalTemplate = buildWaveArray(preset)

  const pacFiringMs = normalRR * 2 * preset.pacCoupling
  const pacPSigma   = preset.pacPDuration / 4

  const pacPos = layoutComplex({ hasPWave: true, pDuration: preset.pacPDuration, prInterval: preset.pacPrInterval, qrsDuration: preset.qrsDuration, qtInterval: preset.qtInterval, tDuration: 160 })
  const pacTemplate = [
    { name: 'P', amplitude: preset.pacPAmplitude, center: pacPos.pCenter, sigma: pacPSigma, axisDeg: preset.pacPAxis },
    { name: 'Q', amplitude: preset.qAmplitude, center: pacPos.qCenter, sigma: pacPos.qSigma, axisDeg: preset.qrsAxis },
    { name: 'R', amplitude: preset.rAmplitude, center: pacPos.rCenter, sigma: pacPos.rSigma, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude, center: pacPos.sCenter, sigma: pacPos.sSigma, axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude, center: pacPos.tCenter, sigma: pacPos.tSigma, axisDeg: preset.tAxis },
  ]

  // Non-compensatory pause: next sinus beat ≈ one full RR after PAC
  const nextSinusOnset = pacFiringMs + pacPos.complexDuration + 190
  const cycleMs        = Math.round(normalRR * 4)

  return {
    waves: [
      ...placeBeat(0,            normalTemplate),
      ...placeBeat(normalRR,     normalTemplate),
      ...placeBeat(pacFiringMs,  pacTemplate),
      ...placeBeat(nextSinusOnset, normalTemplate),
    ],
    cycleMs,
    heartRateBpm: preset.sinusRate,
  }
}

// VFib: chaotic sum of incommensurate sinusoids (deterministic, no wave array needed)
export function vfibVoltage(tMs) {
  const freqs  = [0.023, 0.037, 0.061, 0.089, 0.143, 0.211]
  const phases = [0.0,   1.2,   2.7,   0.8,   3.9,   1.5  ]
  const amps   = [1.0,   0.7,   0.8,   0.5,   0.6,   0.4  ]
  let v = 0
  for (let i = 0; i < freqs.length; i++)
    v += amps[i] * Math.sin(tMs * freqs[i] + phases[i])
  return 0.6 * (v / 3.5) + ECGNoise(tMs) * 3
}

function buildVFibWaves(cycleMs = 1100) {
  const waves = []
  let t = 0, i = 0
  while (t < cycleMs) {
    const spacing = 40 + 70 * Math.abs(Math.sin(i * 2.39 + 0.7))
    const amp     = 0.4 + 0.35 * Math.sin(i * 1.61 + 2.2)
    const sigma   = 10 + 18 * Math.abs(Math.sin(i * 3.17 + 0.4))
    waves.push({ name: 'f', amplitude: amp, center: t, sigma, axisDeg: 360 * Math.sin(i * 1.91 + 1.0) })
    t += spacing; i++
  }
  return waves
}

// ─── RHYTHMS — backward-compatible object ─────────────────────────────────────
// Derived from RHYTHM_PRESETS. Shape is identical to the original RHYTHMS so
// ECGWaveformPrototype.jsx and HeartAnimation.jsx require no changes.

function presetToRhythm(id, preset) {
  const base = { id, label: preset.label, description: preset.description ?? '' }

  if (!preset.complexType) {
    const measurable = preset.hasPWave !== false   // no PR interval without a P wave
    return { ...base, heartRateBpm: preset.hr, waves: buildWaveArray(preset), measurable }
  }

  const builders = {
    mobitzI:           () => buildMobitzIWaves(preset),
    mobitzII:          () => buildMobitzIIWaves(preset),
    thirdDegreeBlock:  () => buildThirdDegreeWaves(preset),
    atrialFlutter:     () => buildAtrialFlutterWaves(preset),
    atrialFibrillation:() => buildAFibWaves(preset),
    pvcs:              () => buildPVCsWaves(preset),
    pacs:              () => buildPACsWaves(preset),
    vfib:              () => ({ waves: [], cycleMs: 1100, heartRateBpm: 0 }),
  }

  const build = builders[preset.complexType]
  if (!build) return { ...base, heartRateBpm: preset.hr ?? 75, waves: [], measurable: false }

  const { waves, cycleMs, heartRateBpm } = build()
  return { ...base, heartRateBpm, cycleMs, waves, measurable: false }
}

export const RHYTHMS = Object.fromEntries(
  Object.entries(RHYTHM_PRESETS).map(([id, preset]) => [id, presetToRhythm(id, preset)])
)

export const RHYTHM_ORDER = [
  'normalSinus',
  'firstDegreeBlock',
  'lbbb',
  'rbbb',
  'thirdDegreeBlock',
  'atrialFlutter',
  'pvcs',
  'pacs',
  'mobitzI',
  'mobitzII',
  'atrialFibrillation',
  'ventricularPaced',
  'vtach',
  'vfib',
]

// ─── Utility / legacy API ─────────────────────────────────────────────────────

export function cycleLengthMs(heartRateBpm) {
  return 60000 / heartRateBpm
}

export function expectedQtMs(heartRateBpm, qtcMs = 400) {
  return qtcMs * Math.sqrt(cycleLengthMs(heartRateBpm) / 1000)
}

export function cycleVoltage(tInCycleMs, waves, leadAxisDeg = LEADS.I.axisDeg) {
  return waves.reduce((sum, wave) => {
    const axis = wave.axisDeg ?? LEADS.I.axisDeg
    return sum + gaussian(tInCycleMs, wave.amplitude, wave.center, wave.sigma) * projectionFactor(axis, leadAxisDeg)
  }, 0)
}

export function ECGVoltage(elapsedMs, cycleMs, waves, leadAxisDeg = LEADS.I.axisDeg, nativeCycleMs = null) {
  // VFib detection: no identifiable waves, just chaos
  if (!waves || waves.length === 0) return vfibVoltage(elapsedMs)

  const warpedMs   = warpTime(elapsedMs)
  const tInCycle   = ((warpedMs % cycleMs) + cycleMs) % cycleMs
  const tEvaluated = nativeCycleMs !== null ? tInCycle * (nativeCycleMs / cycleMs) : tInCycle
  return cycleVoltage(tEvaluated, waves, leadAxisDeg) + ECGNoise(elapsedMs)
}

export function measureIntervals(waves) {
  const byName    = Object.fromEntries(waves.map(w => [w.name, w]))
  const onset     = w => (w ? w.center - 2 * w.sigma : null)
  const offset    = w => (w ? w.center + 2 * w.sigma : null)
  // Null-guarded: physiological states can legitimately have no P wave (AV
  // block, escape rhythms), no Q wave (ventricular escapes never have one —
  // falls back to R onset), or a merged complex with no discrete T.
  const pOnset    = onset(byName.P)
  const qrsOnset  = onset(byName.Q) ?? onset(byName.R)
  const qrsOffset = offset(byName.S) ?? offset(byName.R)
  const tOffset   = offset(byName.T)
  return {
    prIntervalMs:  (pOnset != null && qrsOnset != null) ? qrsOnset - pOnset : null,
    qrsDurationMs: (qrsOffset != null && qrsOnset != null) ? qrsOffset - qrsOnset : null,
    qtIntervalMs:  (tOffset != null && qrsOnset != null) ? tOffset - qrsOnset : null,
  }
}

// ─── Mean QRS axis ──────────────────────────────────────────────────────────
// Standard clinical bedside method: net QRS deflection in Lead I and aVF,
// then axis = arctan(aVF/I), quadrant-corrected via atan2. Each wave's own
// amplitude/axisDeg already encodes its direction, so "net deflection in a
// lead" is just the sum of each QRS wave's amplitude projected onto that
// lead's axis — the same projection cycleVoltage() uses, evaluated at each
// wave's own peak rather than swept over time.
const MM_PER_MV = 10   // standard ECG paper convention (10mm = 1mV)

export function netQRSAmplitude(waves, leadAxisDeg) {
  return waves
    .filter(w => w.name === 'Q' || w.name === 'R' || w.name === 'S')
    .reduce((sum, w) => sum + w.amplitude * projectionFactor(w.axisDeg, leadAxisDeg), 0)
}

export function meanQRSAxis(waves) {
  const leadINet   = netQRSAmplitude(waves, LEADS.I.axisDeg)
  const leadAVFNet = netQRSAmplitude(waves, LEADS.aVF.axisDeg)
  const angleDeg = (leadINet === 0 && leadAVFNet === 0)
    ? 0
    : Math.atan2(leadAVFNet, leadINet) * 180 / Math.PI
  return {
    angleDeg,
    leadINet,
    leadAVFNet,
    leadIMm:   leadINet * MM_PER_MV,
    leadAVFMm: leadAVFNet * MM_PER_MV,
  }
}

// Normal: -30° to +90°. Left: <-30° down to -90°. Right: +90° to +180°.
// Extreme ("northwest axis"): the remaining (-180°, -90°) wedge.
export function classifyAxis(angleDeg) {
  if (angleDeg >= -30 && angleDeg <= 90) return 'normal'
  if (angleDeg < -30 && angleDeg >= -90) return 'left'
  if (angleDeg > 90 && angleDeg <= 180)  return 'right'
  return 'extreme'
}

// Legacy constant — kept for any imports that reference it directly
export const NORMAL_SINUS_WAVES = buildWaveArray(RHYTHM_PRESETS.normalSinus)
export const DEFAULT_HEART_RATE_BPM = 75

// ─── buildRhythmFromParams — live synthesis from UI parameters ────────────────
// Translates ECGSimulator's parameter controls → {waves, cycleMs, nativeCycleMs}.
// Lets students derive any rhythm by understanding which parameters produce it,
// rather than selecting a pre-labelled preset.
// Auto-mode wide-QRS axis deviation targets — chosen so each lands solidly
// inside its own classifyAxis() zone once fully deviated (widenProgress=1).
const AXIS_TARGETS = { left: -45, right: 100, extreme: -110 }

function lerp(a, b, t) { return a + (b - a) * t }
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

export function buildRhythmFromParams(ui) {
  const {
    saNodeRate        = 75,
    avConductionRatio = 'all',
    prInterval        = 160,
    qrsDuration       = 80,
    qtInterval        = 380,
    pWaveMode         = 'present',
    escapeRhythm      = 'none',
    axisOverrideDeg   = null,
    qrsAxisPattern    = 'left',
  } = ui

  const PP = 60000 / saNodeRate

  // Continuous (not step) wide-QRS deviation: 0 at qrsDuration<=120 (normal
  // axis), eased up to 1 by 170 — short of the QRS Duration slider's 200ms
  // max, so Right/Extreme are comfortably reachable well before the slider's
  // end rather than needing near-pixel-perfect dragging to the max; 170-200
  // just plateaus at full deviation. Both sides of the 120ms boundary
  // evaluate to the same value there, so morphology sweeps smoothly through
  // the threshold instead of jumping.
  const widenProgress = smoothstep((qrsDuration - 120) / (170 - 120))
  const axisTarget     = AXIS_TARGETS[qrsAxisPattern] ?? AXIS_TARGETS.left

  // Base QRS/T params for conducted beats — T becomes discordant when wide QRS
  const baseQRS = {
    qAmplitude:  -0.10,
    rAmplitude:   lerp(1.50, 0.90, widenProgress),
    sAmplitude:   lerp(-0.25, -0.40, widenProgress),
    qrsDuration,
    qrsAxis:      axisOverrideDeg ?? lerp(60, axisTarget, widenProgress),   // wide QRS deviates toward the selected pattern, mirroring the LBBB/RBBB/ectopic presets — unless manually overridden
    qtInterval,
    tDuration:    lerp(160, 185, widenProgress),
    tAmplitude:   0.35,
    tAxis:        lerp(45, 135, widenProgress),
    stElevation:  0,
  }

  // ── VFib ──────────────────────────────────────────────────────────────────
  if (pWaveMode === 'fibrillatory' && avConductionRatio === 'none')
    return { waves: [], cycleMs: 1100, nativeCycleMs: null, measurable: false }

  // ── AFib — saNodeRate controls mean ventricular rate in this mode ─────────
  if (pWaveMode === 'fibrillatory') {
    const { waves, cycleMs } = buildAFibWaves({
      meanVentricularRate: saNodeRate, fibrillatoryAmplitude: 0.07, ...baseQRS,
    })
    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── Complete AV block ─────────────────────────────────────────────────────
  if (avConductionRatio === 'none') {
    const pWv = pWaveMode === 'present'
      ? pTemplate({ pAmplitude: 0.25, pDuration: 80, pAxis: 60 }) : []

    if (escapeRhythm === 'none') {
      const cycleMs = PP * 5
      const waves = []
      for (let i = 0; i < 5; i++) waves.push(...placeBeat(i * PP, pWv))
      return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
    }

    const isJ    = escapeRhythm === 'junctional'
    const escRR  = 60000 / (isJ ? 50 : 32)
    const escPos = layoutComplex({
      hasPWave:    false,
      qrsDuration: isJ ? 90  : 180,
      qtInterval:  isJ ? qtInterval : Math.max(qtInterval, 480),
      tDuration:   isJ ? 160 : 230,
      qrsLeadIn:   0,
    })
    // Ventricular escape has no qrsDuration-driven ramp of its own (it's
    // already a fixed wide morphology), so it deviates fully toward whichever
    // pattern is selected — previously hard-coded to -75 (Left) always,
    // making Right/Extreme unreachable via this path regardless of selection.
    const escQrsAxis = axisOverrideDeg ?? (isJ ? 60 : axisTarget)
    const escTemplate = [
      { name: 'R', amplitude: isJ ? 1.10 : 0.90,  center: escPos.rCenter, sigma: escPos.rSigma * (isJ ? 1.0 : 1.15), axisDeg: escQrsAxis },
      { name: 'S', amplitude: isJ ? -0.20 : -0.22, center: escPos.sCenter, sigma: escPos.sSigma,                       axisDeg: escQrsAxis },
      { name: 'T', amplitude: isJ ?  0.28 : 0.65,  center: escPos.tCenter, sigma: escPos.tSigma,                       axisDeg: isJ ?  45 : 105 },
    ]

    const cycleMs = Math.round(escRR * 3)
    const waves   = []
    if (pWv.length) {
      let pt = PP * 0.3
      while (pt < cycleMs) { waves.push(...placeBeat(pt, pWv)); pt += PP }
    }
    for (let i = 0; i < 3; i++)
      waves.push(...placeBeat(escRR * 0.35 + i * escRR, escTemplate))

    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── Partial AV block (Mobitz II-style: fixed PR on conducted beats) ───────
  if (avConductionRatio !== 'all') {
    const ratioMap   = { '3:2': [3, 2], '2:1': [2, 1], '3:1': [3, 1] }
    const [pCt, qCt] = ratioMap[avConductionRatio] ?? [2, 1]
    const cycleMs    = pCt * PP
    const qrstPos    = layoutComplex({ hasPWave: false, qrsDuration, qtInterval, tDuration: baseQRS.tDuration, qrsLeadIn: 0 })
    const waves      = []

    if (pWaveMode === 'present')
      for (let i = 0; i < pCt; i++)
        waves.push({ name: 'P', amplitude: 0.25, center: i * PP + 40, sigma: 20, axisDeg: 60 })

    for (let i = 0; i < qCt; i++) {
      const o = i * PP + prInterval
      waves.push(
        { name: 'Q', amplitude: baseQRS.qAmplitude,  center: o + qrstPos.qCenter, sigma: qrstPos.qSigma, axisDeg: baseQRS.qrsAxis },
        { name: 'R', amplitude: baseQRS.rAmplitude,  center: o + qrstPos.rCenter, sigma: qrstPos.rSigma, axisDeg: baseQRS.qrsAxis },
        { name: 'S', amplitude: baseQRS.sAmplitude,  center: o + qrstPos.sCenter, sigma: qrstPos.sSigma, axisDeg: baseQRS.qrsAxis },
        { name: 'T', amplitude: baseQRS.tAmplitude,  center: o + qrstPos.tCenter, sigma: qrstPos.tSigma, axisDeg: baseQRS.tAxis },
      )
    }
    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── 1:1 conduction ────────────────────────────────────────────────────────
  const hasPWave = pWaveMode === 'present'
  const waves    = complexWaves({ hasPWave, pAmplitude: 0.25, pDuration: 80, pAxis: 60, prInterval, ...baseQRS })
  return { waves, cycleMs: PP, nativeCycleMs: null, measurable: hasPWave }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Physiology-driven engine (Module 3 rebuild) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Students manipulate PHYSIOLOGICAL properties of cardiac tissue — every EKG
// measurement (PR, QRS, QT, axis) is a computed OUTPUT, never a direct input.
// Reuses every primitive above (buildWaveArray/complexWaves, layoutComplex,
// placeBeat, qrstTemplate, pTemplate, lerp, smoothstep, AXIS_TARGETS, and all
// six macro-cycle builders) unchanged. buildRhythmFromParams itself is left
// completely untouched — LeadPlacementLab.jsx / CardiacBridge.jsx still call
// it with their fixed default rhythm.

export const PHYSIOLOGY_DEFAULTS = {
  // Section 1 — SA Node
  saAutomaticity:   75,          // bpm
  firingRegularity: 'regular',   // 'regular' | 'respiratory' | 'irregular'

  // Section 2 — Atrial Myocardium
  atrialConductionVelocityPct: 100,
  atrialRefractoryMs:          250,

  // Section 3 — AV Node
  avConductionVelocityPct: 100,
  avRecoveryBehavior:      'uniform',   // 'uniform' | 'fatigue'
  avRefractoryMs:          300,

  // Section 4 — His-Purkinje
  leftBundleVelocityPct:  100,
  rightBundleVelocityPct: 100,
  purkinjeAutomaticity:   0,      // bpm, 0 = off

  // Section 5 — Ventricular Myocardium
  ventricularApdMs:      380,    // ≈ QT interval
  repolHeterogeneity:    'none', // 'none' | 'moderate' | 'high'
  ventricularEctopicRate: 0,     // bpm, 0 = off

  // Section 6 — Autonomic tone (collapsed)
  sympatheticTone:     20,   // %
  parasympatheticTone: 20,   // %

  // Section 7 — Ion concentrations (collapsed)
  potassiumMEqL: 4.0,
  calciumMgDl:   9.5,
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Layer 1: autonomic tone + severe ion derangement pre-modify the raw ────
// section 1/3/4/5 sliders. Ion effects here are deliberately modest (a
// teaching-tool-scale nudge, not a full ionic model) and mirror the same
// thresholds/shape applyIonEffects already uses for its own wave-morphology
// changes, so the rate/conduction shift and the visual explanation stay
// consistent with each other.
function applyAutonomicTone(phys) {
  const {
    saAutomaticity, avConductionVelocityPct, ventricularApdMs,
    purkinjeAutomaticity, ventricularEctopicRate,
    sympatheticTone, parasympatheticTone, potassiumMEqL,
  } = phys
  const symp = sympatheticTone / 100
  const para = parasympatheticTone / 100

  // Severe hyperkalemia suppresses SA automaticity and AV conduction
  // broadly, not just QRS/T-wave morphology (which applyIonEffects handles
  // separately, later, purely as wave shape).
  const hyperkalemiaSuppression = potassiumMEqL > 7.5 ? smoothstep((potassiumMEqL - 7.5) / 1.0) : 0
  // Hypokalemia raises ectopic-focus excitability.
  const hypokalemiaExcitability = potassiumMEqL < 3.5 ? smoothstep((3.5 - potassiumMEqL) / 1.5) : 0

  return {
    effectiveSaRate:        clamp(saAutomaticity * (1 + 0.8 * symp - 0.6 * para) * (1 - 0.5 * hyperkalemiaSuppression), 15, 260),
    effectiveAvVelocityPct: clamp(avConductionVelocityPct * (1 + 0.35 * symp - 0.45 * para) * (1 - 0.6 * hyperkalemiaSuppression), 0, 100),
    effectiveApdMs:         clamp(ventricularApdMs * (1 - 0.25 * symp + 0.08 * para), 150, 600),
    // Catecholamine excess raises latent-pacemaker/ectopic-focus
    // automaticity (the arrhythmogenic mechanism the app's own ectopic-rate
    // slider hint already describes) — vagal tone doesn't suppress
    // ventricular-level automaticity, so only sympathetic tone scales these.
    // Hypokalemia additionally raises ectopic excitability specifically.
    effectivePurkinjeRate: purkinjeAutomaticity > 0 ? clamp(purkinjeAutomaticity * (1 + 0.4 * symp), 0, 260) : 0,
    effectiveEctopicRate:  ventricularEctopicRate > 0 ? clamp(ventricularEctopicRate * (1 + 0.4 * symp) * (1 + 0.3 * hypokalemiaExcitability), 0, 260) : 0,
  }
}

// ── Atrial regime (the re-entry "discovery moment") ─────────────────────────
const FLUTTER_THRESHOLD_MS = 200
const FIB_THRESHOLD_MS     = 180

function atrialRegimeFrom(atrialRefractoryMs, atrialConductionVelocityPct = 100) {
  // Re-entry risk is wavelength = conduction velocity × refractory period,
  // not refractory period alone. Slower conduction shortens the effective
  // wavelength for a given refractory period, so scale the refractory value
  // compared against the thresholds by velocity — at the reference 100%
  // velocity this is a no-op, preserving existing default-velocity behavior.
  const effectiveRefractoryMs = atrialRefractoryMs * clamp(atrialConductionVelocityPct, 20, 100) / 100
  if (effectiveRefractoryMs >= FLUTTER_THRESHOLD_MS) return 'organized'
  if (effectiveRefractoryMs >= FIB_THRESHOLD_MS)      return 'flutter'
  return 'fibrillation'
}

// ── AV node: velocity + refractory unified into one conduction-ratio calc ──
function velocityPenalty(avVelocityPct) {
  // Below ~70% the node starts struggling to conduct reliably — modeled as
  // an effective lengthening of its own refractory period, steep enough
  // that velocity ALONE (independent of the separate refractory slider)
  // can produce block at a normal resting atrial rate: at 40% velocity the
  // default 300ms refractory effectively exceeds a 75bpm PP interval
  // (~769ms), matching the spec's velocity-only threshold descriptions
  // ("40-20%: some fail to conduct" / "~20%: intermittent failure").
  const impairment = smoothstep((70 - avVelocityPct) / 70)   // 0 at >=70%, 1 at 0%
  return lerp(1, 9, impairment)
}

function computeAvRatio(effectiveAvRefractoryMs, atrialIntervalMs) {
  const ratio = Math.max(1, Math.round(effectiveAvRefractoryMs / atrialIntervalMs))
  return Math.min(ratio, 8)   // clamp to a sane, renderable range
}

function prIntervalFromVelocity(atrialVelocityPct, avVelocityPct) {
  const atrialTerm = 35 * (100 / clamp(atrialVelocityPct, 20, 100))
  const avTerm     = 125 * (100 / clamp(avVelocityPct, 5, 100))
  return clamp(atrialTerm + avTerm, 90, 500)
}

// ── His-Purkinje: same smoothstep shape as the existing wide-QRS axis sweep ─
function bundleImpairment(velocityPct) {
  // Fully normal above 60% velocity, fully established block pattern at/below 30%.
  return 1 - smoothstep((velocityPct - 30) / 30)
}

// ── Escape/ectopic capture: one comparison pattern, used twice ──────────────
function classifyCapture(focusRate, effectiveRate) {
  if (focusRate <= 0) return 'inactive'
  if (focusRate > effectiveRate + 10) return 'captured'
  if (focusRate >= effectiveRate - 10) return 'fusion'
  return 'suppressed'
}

// Ventricular escape (Purkinje) or standstill when AV conduction isn't
// delivering a beat at all (complete block, or a ratio too high to be
// physiological). Mirrors buildThirdDegreeWaves but the escape source is
// whichever of Purkinje/ventricular-ectopic automaticity is faster (if any).
function buildEscapeOrStandstill({ purkinjeAutomaticity, ventricularEctopicRate, baseQRS, derived, atrialIntervalMs = null, pAmplitude = 0.25, pDuration = 80 }) {
  const purkinjeActive    = purkinjeAutomaticity > 0
  const ventricularActive = ventricularEctopicRate > 0
  let escapeRate = 0, source = 'none'
  if (purkinjeActive && ventricularActive) {
    if (purkinjeAutomaticity >= ventricularEctopicRate) { escapeRate = purkinjeAutomaticity; source = 'purkinje' }
    else { escapeRate = ventricularEctopicRate; source = 'ventricular' }
  } else if (purkinjeActive)    { escapeRate = purkinjeAutomaticity;    source = 'purkinje' }
  else if (ventricularActive)   { escapeRate = ventricularEctopicRate;  source = 'ventricular' }

  derived.escapeSource   = source
  derived.escapeRateBpm  = escapeRate

  const pWv = pDuration ? pTemplate({ pAmplitude, pDuration, pAxis: 60 }) : []

  if (escapeRate === 0) {
    const cycleMs = atrialIntervalMs ? atrialIntervalMs * 5 : 4000
    const waves = []
    if (pWv.length && atrialIntervalMs)
      for (let i = 0; i < 5; i++) waves.push(...placeBeat(i * atrialIntervalMs, pWv))
    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm: 0 }
  }

  const escRR     = 60000 / escapeRate
  const isNarrow  = source === 'purkinje'
  const escQrsAxis = isNarrow ? 60 : baseQRS.qrsAxis
  const escPos = layoutComplex({
    hasPWave:    false,
    qrsDuration: isNarrow ? 95 : Math.max(baseQRS.qrsDuration, 160),
    qtInterval:  isNarrow ? baseQRS.qtInterval : Math.max(baseQRS.qtInterval, 480),
    tDuration:   isNarrow ? 160 : 230,
    qrsLeadIn:   0,
  })
  const escTemplate = [
    { name: 'R', amplitude: isNarrow ? 1.10 : 0.90,  center: escPos.rCenter, sigma: escPos.rSigma * (isNarrow ? 1.0 : 1.15), axisDeg: escQrsAxis },
    { name: 'S', amplitude: isNarrow ? -0.20 : -0.30, center: escPos.sCenter, sigma: escPos.sSigma, axisDeg: escQrsAxis },
    { name: 'T', amplitude: isNarrow ? 0.28 : 0.55,   center: escPos.tCenter, sigma: escPos.tSigma, axisDeg: isNarrow ? 45 : (escQrsAxis > 0 ? -90 : 135) },
  ]

  const cycleMs = Math.round(escRR * 3)
  const waves   = []
  if (pWv.length && atrialIntervalMs) {
    let pt = atrialIntervalMs * 0.3
    while (pt < cycleMs) { waves.push(...placeBeat(pt, pWv)); pt += atrialIntervalMs }
  }
  for (let i = 0; i < 3; i++) waves.push(...placeBeat(escRR * 0.35 + i * escRR, escTemplate))

  return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm: escapeRate }
}

// Fusion beat: rather than true dual-clock pacemaker racing (no existing
// scaffolding — see plan), one beat in a short repeating cycle gets BOTH a
// normal-conducted and an ectopic-focus QRST template placed at overlapping
// centers. cycleVoltage() sums every wave's Gaussian contribution regardless
// of "which pacemaker" produced it, so the summed trace genuinely shows a
// blended morphology — which is what a fusion beat physiologically is.
function buildFusionCycle({ saRate, pAmplitude, pDuration, prMs, baseQRS }) {
  const normalTemplate = complexWaves({ hasPWave: true, pAmplitude, pDuration, pAxis: 60, prInterval: prMs, ...baseQRS })
  const ectopicPos = layoutComplex({ hasPWave: false, qrsDuration: 150, qtInterval: baseQRS.qtInterval, tDuration: 170, qrsLeadIn: 15 })
  const ectopicTemplate = [
    { name: 'R', amplitude: 1.2,  center: ectopicPos.rCenter, sigma: ectopicPos.rSigma, axisDeg: AXIS_TARGETS.extreme },
    { name: 'S', amplitude: -0.5, center: ectopicPos.sCenter, sigma: ectopicPos.sSigma, axisDeg: AXIS_TARGETS.extreme },
    { name: 'T', amplitude: -0.35, center: ectopicPos.tCenter, sigma: ectopicPos.tSigma, axisDeg: 80 },
  ]
  const normalRR = 60000 / saRate
  const fusionOffset = normalRR * 0.4   // ectopic fires partway through the beat, overlapping the normal QRS

  const waves = [
    ...placeBeat(0,                          normalTemplate),
    ...placeBeat(normalRR,                   normalTemplate),
    ...placeBeat(normalRR * 2,               normalTemplate),
    ...placeBeat(normalRR * 2 + fusionOffset, ectopicTemplate),
    ...placeBeat(normalRR * 3,               normalTemplate),
  ]
  return { waves, cycleMs: normalRR * 4, nativeCycleMs: normalRR * 4, measurable: false, heartRateBpm: Math.round(saRate) }
}

// Reshapes an already-built single-beat cycle into a short repeating
// multi-beat cycle with varying PP intervals — only meaningful for a plain
// organized, 1:1 SA-driven rhythm (the case students will be exploring it in).
function applyFiringRegularity(result, firingRegularity, effectiveSaRate) {
  const baseRR = 60000 / effectiveSaRate
  const template = result.waves
  const numBeats = 6
  const waves = []
  let t = 0
  const rng = mulberry32(0x9e3779b9)
  for (let i = 0; i < numBeats; i++) {
    let rr = baseRR
    if (firingRegularity === 'respiratory')     rr = baseRR * (1 + 0.08 * Math.sin((i / numBeats) * Math.PI * 2))
    else if (firingRegularity === 'irregular')  rr = baseRR * (0.7 + rng() * 0.6)
    waves.push(...placeBeat(t, template))
    t += rr
  }
  return { ...result, waves, cycleMs: t, nativeCycleMs: t }
}

// ── Layer 3: ion concentration post-processing overrides ────────────────────
function applyIonEffects(waves, k, ca, derived) {
  let out = waves
  derived.potassiumMEqL = k
  derived.calciumMgDl   = ca

  if (k > 8.5) {
    // QRS-T merger: replace the whole complex with one wide low-frequency blob.
    // QRS/QT are no longer meaningfully measurable — that's the point being
    // taught — so null them rather than report a stale pre-merge number.
    const qWave = out.find(w => w.name === 'Q') ?? out.find(w => w.name === 'R')
    const center = qWave ? qWave.center + 150 : 250
    out = out.filter(w => !['Q', 'R', 'S', 'T', 'ST', 'U'].includes(w.name))
    out.push({ name: 'R', amplitude: 0.9, center, sigma: 220, axisDeg: 30 })
    derived.ionAlert = 'Sine-wave pattern — QRS and T have merged. Immediately life-threatening.'
    derived.qrsDurationMs = null
    derived.qtIntervalMs  = null
  } else if (k >= 7.5) {
    const t = smoothstep((k - 7.5) / 1.0)
    out = out.map(w => (w.name === 'Q' || w.name === 'R' || w.name === 'S')
      ? { ...w, sigma: w.sigma * lerp(1, 1.8, t) } : w)
    derived.ionAlert = 'Ventricular conduction is slowing globally — approaching electrical failure.'
  } else if (k >= 6.5) {
    const t = smoothstep((k - 6.5) / 1.0)
    out = out.map(w => w.name === 'P' ? { ...w, amplitude: w.amplitude * lerp(1, 0.05, t) } : w)
    derived.ionAlert = 'Atrial muscle is significantly depolarized — P waves are flattening.'
  } else if (k >= 5.5) {
    const t = smoothstep((k - 5.5) / 1.0)
    out = out.map(w => w.name === 'T' ? { ...w, amplitude: w.amplitude * lerp(1, 2.2, t) + 0.15 * t, sigma: w.sigma * lerp(1, 0.6, t) } : w)
    derived.ionAlert = 'T waves are becoming tall, narrow, and symmetric ("tented").'
  } else if (k < 3.5) {
    const t = smoothstep((3.5 - k) / 1.5)   // 0 at 3.5, 1 at 2.0
    out = out.map(w => w.name === 'T' ? { ...w, amplitude: w.amplitude * lerp(1, 0.25, t) } : w)
    const tWave = out.find(w => w.name === 'T')
    if (tWave && t > 0.15) out = [...out, { name: 'U', amplitude: 0.10 * t, center: tWave.center + 90, sigma: 30, axisDeg: tWave.axisDeg }]
    derived.ionAlert = 'Repolarization is prolonged — a U wave is appearing.'
  }
  if (k > 7.0) derived.hyperkalemiaAlert = true

  const caShift = ca < 8.5 ? (8.5 - ca) * 12 : ca > 10.5 ? -(ca - 10.5) * 10 : 0
  if (caShift !== 0)
    out = out.map(w => w.name === 'T' ? { ...w, center: w.center + caShift } : w)

  if (ca > 13) {
    const sWave = out.find(w => w.name === 'S')
    if (sWave) out = [...out, { name: 'J', amplitude: 0.18, center: sWave.center + 25, sigma: 12, axisDeg: sWave.axisDeg }]
  }

  return out
}

// ─── buildRhythmFromPhysiology — the new Module 3 entry point ──────────────
export function buildRhythmFromPhysiology(phys0) {
  const phys = { ...PHYSIOLOGY_DEFAULTS, ...phys0 }
  const {
    firingRegularity,
    atrialConductionVelocityPct, atrialRefractoryMs,
    avConductionVelocityPct, avRecoveryBehavior, avRefractoryMs,
    repolHeterogeneity,
    potassiumMEqL, calciumMgDl,
  } = phys

  const {
    effectiveSaRate, effectiveAvVelocityPct, effectiveApdMs,
    effectivePurkinjeRate, effectiveEctopicRate,
  } = applyAutonomicTone(phys)

  const derived = { avRecoveryBehavior, effectiveSaRate, effectiveAvVelocityPct, effectivePurkinjeRate, effectiveEctopicRate }

  // ── Bundle-branch derived QRS morphology (shared by every branch below) ──
  const leftImp    = bundleImpairment(phys.leftBundleVelocityPct)
  const rightImp   = bundleImpairment(phys.rightBundleVelocityPct)
  const maxImp     = Math.max(leftImp, rightImp)
  const bundleSide = leftImp >= rightImp ? 'left' : 'right'
  const qrsDuration = 85 + maxImp * 65
  const qrsAxisTarget = bundleSide === 'left' ? AXIS_TARGETS.left : AXIS_TARGETS.right
  const qrsAxis = lerp(60, qrsAxisTarget, maxImp)
  const rAmplitude = lerp(1.50, 0.90, maxImp)
  const sAmplitude = lerp(-0.25, -0.45, maxImp)
  const tAxisDiscordant = bundleSide === 'left' ? 135 : -90
  const tAxis = lerp(45, tAxisDiscordant, maxImp)

  const hetero = repolHeterogeneity === 'high' ? 1 : repolHeterogeneity === 'moderate' ? 0.5 : 0
  const tAmplitude = lerp(0.35, hetero >= 1 ? -0.15 : 0.12, hetero)
  const tDuration  = lerp(160, 210, maxImp)

  const qtInterval = clamp(effectiveApdMs, 150, 600)

  const baseQRS = {
    qAmplitude: -0.10, rAmplitude, sAmplitude,
    qrsDuration, qrsAxis, qtInterval, tDuration, tAmplitude, tAxis,
    stElevation: 0,
  }

  derived.qrsDurationMs  = qrsDuration
  derived.qtIntervalMs   = qtInterval
  derived.qrsAxisDeg     = qrsAxis
  derived.leftImpairment = leftImp
  derived.rightImpairment = rightImp
  derived.heterogeneity  = repolHeterogeneity

  // ── Atrial regime ─────────────────────────────────────────────────────
  const atrialRegime = atrialRegimeFrom(atrialRefractoryMs, atrialConductionVelocityPct)
  derived.atrialRegime = atrialRegime

  const pDuration  = clamp(80 + (100 - atrialConductionVelocityPct) * 1.8, 80, 240)
  const pAmplitude = 0.25 * (0.7 + 0.3 * atrialConductionVelocityPct / 100)
  derived.pDurationMs = pDuration

  let result

  if (atrialRegime === 'fibrillation') {
    const effectiveAvRefractoryMs = avConductionVelocityPct === 0 ? Infinity : avRefractoryMs * velocityPenalty(effectiveAvVelocityPct)
    // AV node filters the chaotic atrial input — a faster effective AV
    // refractory means MORE impulses are filtered out, so ventricular rate
    // is inversely related to it.
    const meanVentricularRate = avConductionVelocityPct === 0
      ? 0
      : clamp(Math.round(90000 / Math.max(50, effectiveAvRefractoryMs)), 40, 180)
    derived.meanVentricularRateBpm = meanVentricularRate
    if (meanVentricularRate === 0) {
      result = buildEscapeOrStandstill({ purkinjeAutomaticity: effectivePurkinjeRate, ventricularEctopicRate: effectiveEctopicRate, baseQRS, derived })
    } else {
      const { waves, cycleMs, heartRateBpm } = buildAFibWaves({ meanVentricularRate, fibrillatoryAmplitude: 0.07, ...baseQRS })
      result = { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm }
    }
  } else if (atrialRegime === 'flutter') {
    const atrialIntervalMs = 60000 / 300
    const effectiveAvRefractoryMs = avConductionVelocityPct === 0 ? Infinity : avRefractoryMs * velocityPenalty(effectiveAvVelocityPct)
    const ratio = avConductionVelocityPct === 0 ? Infinity : computeAvRatio(effectiveAvRefractoryMs, atrialIntervalMs)
    derived.avRatio = ratio
    derived.atrialIntervalMs = atrialIntervalMs
    derived.effectiveAvRefractoryMs = avConductionVelocityPct === 0 ? null : effectiveAvRefractoryMs
    if (avConductionVelocityPct === 0 || !Number.isFinite(ratio) || ratio >= 8) {
      result = buildEscapeOrStandstill({ purkinjeAutomaticity: effectivePurkinjeRate, ventricularEctopicRate: effectiveEctopicRate, baseQRS, derived })
    } else {
      const ventricularRate = 300 / ratio
      const { waves, cycleMs, heartRateBpm } = buildAtrialFlutterWaves({
        flutterRate: 300, ventricularRate, flutterAmplitude: 0.15, flutterAxis: -15, ...baseQRS,
      })
      result = { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm }
    }
  } else {
    // organized atrial rhythm
    derived.atrialErraticness = smoothstep((250 - atrialRefractoryMs) / 50)

    const atrialIntervalMs = 60000 / effectiveSaRate
    derived.atrialIntervalMs = atrialIntervalMs

    // Bilateral complete bundle-branch block (both bundles maximally
    // impaired) is anatomically infra-Hisian complete heart block — no path
    // left for a supraventricular impulse to reach the ventricles — so it
    // gets the same escape/standstill treatment as avConductionVelocityPct
    // === 0, instead of silently conducting 1:1 at an ever-widening QRS.
    const bilateralCompleteBundleBlock = Math.min(leftImp, rightImp) >= 0.95
    if (avConductionVelocityPct === 0 || bilateralCompleteBundleBlock) {
      derived.avRatio = Infinity
      result = buildEscapeOrStandstill({ purkinjeAutomaticity: effectivePurkinjeRate, ventricularEctopicRate: effectiveEctopicRate, baseQRS, derived, atrialIntervalMs, pAmplitude, pDuration })
    } else {
      const effectiveAvRefractoryMs = avRefractoryMs * velocityPenalty(effectiveAvVelocityPct)
      const ratio = computeAvRatio(effectiveAvRefractoryMs, atrialIntervalMs)
      derived.avRatio = ratio
      derived.effectiveAvRefractoryMs = effectiveAvRefractoryMs
      const prMs = prIntervalFromVelocity(atrialConductionVelocityPct, effectiveAvVelocityPct)
      // Only assigned to derived.prIntervalMs in the branches below where a
      // single real conducted PR value applies (plain 1:1 sinus conduction,
      // Mobitz I/II) — left unset for escape/dissociated/ectopic-override
      // rhythms, where "PR interval" isn't a meaningful measurement (the UI
      // renders it as "—" when unset).

      // Unlike flutter's fixed-ratio builder, Mobitz I/II both produce a
      // "mostly conducting, one drop per group" pattern (conductionRatio
      // [N, N-1]) — correct for a genuinely grouped-beating ratio (2-3), but
      // wrong for severe block, which should be mostly-BLOCKING and
      // escape-dependent instead. Route ratio>=4 to the escape/standstill
      // path rather than stretching the Mobitz builders past what they mean.
      if (ratio >= 4) {
        result = buildEscapeOrStandstill({ purkinjeAutomaticity: effectivePurkinjeRate, ventricularEctopicRate: effectiveEctopicRate, baseQRS, derived, atrialIntervalMs, pAmplitude, pDuration })
      } else if (ratio === 1) {
        // "Fastest pacemaker wins": a Purkinje/junctional escape focus that
        // now outpaces the (possibly suppressed) SA node should take over
        // even though AV conduction itself is intact — this is the same
        // overdrive-suppression comparison buildEscapeOrStandstill already
        // makes between purkinje/ventricular foci, just also checked against
        // effectiveSaRate here since AV conduction hasn't failed. Checked
        // before the ventricular-ectopic capture logic below (left
        // untouched) so its existing 'vtach'/'fusion'/'pvcs' routing doesn't
        // regress when the ventricular focus is the faster/only one.
        const purkinjeCapture = effectivePurkinjeRate > 0 ? classifyCapture(effectivePurkinjeRate, effectiveSaRate) : 'inactive'

        if (purkinjeCapture === 'captured' && effectivePurkinjeRate >= effectiveEctopicRate) {
          result = buildEscapeOrStandstill({ purkinjeAutomaticity: effectivePurkinjeRate, ventricularEctopicRate: effectiveEctopicRate, baseQRS, derived, atrialIntervalMs, pAmplitude, pDuration })
        } else {
          const capture = effectiveEctopicRate > 0 ? classifyCapture(effectiveEctopicRate, effectiveSaRate) : 'inactive'
          derived.ectopicCapture = capture

          if (capture === 'captured') {
            const rate = effectiveEctopicRate
            const waves = complexWaves({
              hasPWave: false, qrsLeadIn: 15, ...baseQRS,
              qrsAxis: AXIS_TARGETS.extreme, rAmplitude: 1.1, sAmplitude: -0.5,
              qrsDuration: Math.max(qrsDuration, 150),
            })
            result = { waves, cycleMs: 60000 / rate, nativeCycleMs: null, measurable: false, heartRateBpm: Math.round(rate) }
          } else if (capture === 'fusion') {
            result = buildFusionCycle({ saRate: effectiveSaRate, pAmplitude, pDuration, prMs, baseQRS })
          } else if (capture === 'suppressed' || (repolHeterogeneity === 'high' && effectiveEctopicRate === 0)) {
            // A suppressed ectopic focus (rate below SA) still occasionally
            // fires early when the SA impulse arrives during its vulnerable
            // period — a premature wide beat — rather than producing no
            // visible effect at all. High repolarization heterogeneity seeds
            // the same kind of re-entrant beat via a different mechanism; the
            // two triggers share this path but never double-stack (guarded
            // above by `effectiveEctopicRate === 0`). Recorded as
            // 'suppressed' either way so physiologyToRhythmId routes both
            // triggers to the same (correct, multi-beat) HeartAnimation case.
            derived.ectopicCapture = 'suppressed'
            const built = buildPVCsWaves({
              sinusRate: effectiveSaRate, multifocal: false,
              pAmplitude, pDuration, pAxis: 60, prInterval: prMs, ...baseQRS,
              pvcRAmplitude: 1.3, pvcSAmplitude: -0.5, pvcQrsDuration: 150,
              pvcQrsAxis: -100, pvcTAmplitude: -0.4, pvcTAxis: 90,
              pvcQtInterval: 380, pvcCoupling: 0.7,
            })
            result = { ...built, nativeCycleMs: built.cycleMs, measurable: false }
          } else {
            const waves = complexWaves({ hasPWave: true, pAmplitude, pDuration, pAxis: 60, prInterval: prMs, ...baseQRS })
            result = { waves, cycleMs: atrialIntervalMs, nativeCycleMs: null, measurable: true, heartRateBpm: Math.round(effectiveSaRate) }
            derived.prIntervalMs = prMs
          }
        }
      } else {
        const qCt = ratio - 1
        derived.prIntervalMs = prMs
        if (avRecoveryBehavior === 'fatigue') {
          // Classic Wenckebach: PR lengthens each beat, but by a SMALLER
          // amount each time (largest jump right after the pause,
          // progressively smaller increments as the node approaches its
          // refractory limit) — geometric decay, not a constant step, so RR
          // also shortens each beat before the drop. Total prolongation by
          // the last conducted beat matches what the old constant-step
          // formula produced; only how it's distributed across beats changes.
          const totalStep = (effectiveAvRefractoryMs - prMs) / ratio * qCt
          const decay = 0.55
          const decaySum = qCt === 1 ? 1 : (1 - Math.pow(decay, qCt)) / (1 - decay)
          const firstIncrement = totalStep / decaySum
          const prIntervals = []
          let pr = prMs, increment = firstIncrement
          for (let i = 0; i < qCt; i++) {
            pr += increment
            prIntervals.push(Math.round(pr))
            increment *= decay
          }
          const { waves, cycleMs, heartRateBpm } = buildMobitzIWaves({
            atrialRate: effectiveSaRate, prIntervals, pAmplitude, pDuration, pAxis: 60, ...baseQRS,
          })
          result = { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm }
        } else {
          const { waves, cycleMs, heartRateBpm } = buildMobitzIIWaves({
            atrialRate: effectiveSaRate, prInterval: prMs, conductionRatio: [ratio, qCt],
            pAmplitude, pDuration, pAxis: 60, ...baseQRS,
          })
          result = { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false, heartRateBpm }
        }
      }
    }
  }

  if (firingRegularity !== 'regular' && atrialRegime === 'organized' && result.measurable)
    result = applyFiringRegularity(result, firingRegularity, effectiveSaRate)

  result.waves = applyIonEffects(result.waves, potassiumMEqL, calciumMgDl, derived)

  // QT/QRS were captured above before ion effects could shift the T wave
  // (calcium) or widen the QRS complex (potassium) — re-derive them from the
  // now-final waves so the displayed numbers track what's actually drawn.
  // Skip when applyIonEffects has intentionally nulled them (QRS/T merged
  // into one blob at severe hyperkalemia — no longer meaningfully
  // measurable, so a re-derived number would just be a fabricated one).
  if (derived.qtIntervalMs !== null) {
    const remeasured = measureIntervals(result.waves)
    if (remeasured.qtIntervalMs  != null) derived.qtIntervalMs  = remeasured.qtIntervalMs
    if (remeasured.qrsDurationMs != null) derived.qrsDurationMs = remeasured.qrsDurationMs
  }

  derived.ventricularRateBpm = result.heartRateBpm ?? 0
  result.derived = derived
  return result
}

// ─── physiologyToRhythmId — maps regime facts to the closest existing ──────
// HeartAnimation rhythmId (same pattern as the old paramsToRhythmId, just
// physiology-driven instead of measurement-driven). See plan Context: the
// heart animation itself is untouched — this only picks which of its
// existing branches gives the least-wrong generic animation.
export function physiologyToRhythmId(derived) {
  if (derived.ionAlert?.startsWith('Sine-wave')) return 'vfib'
  if (derived.atrialRegime === 'fibrillation') return 'atrialFibrillation'
  if (derived.atrialRegime === 'flutter')      return 'atrialFlutter'
  // `escapeSource` is set (even to 'none') whenever buildEscapeOrStandstill
  // built the waves — covers literal complete block (avRatio===Infinity)
  // AND severe/high-grade block (finite avRatio>=4, routed to the same
  // builder since Mobitz I/II's wave structure wouldn't match there).
  if (derived.escapeSource !== undefined) return 'thirdDegreeBlock'
  if (derived.ectopicCapture === 'captured')  return 'vtach'
  if (derived.ectopicCapture === 'fusion')    return 'fusion'
  if (derived.ectopicCapture === 'suppressed') return 'pvcs'
  if (derived.avRatio > 1) return derived.avRecoveryBehavior === 'fatigue' ? 'mobitzI' : 'mobitzII'
  if (derived.leftImpairment >= 0.5 && derived.leftImpairment >= derived.rightImpairment) return 'lbbb'
  if (derived.rightImpairment >= 0.5 && derived.rightImpairment > derived.leftImpairment) return 'rbbb'
  if (derived.prIntervalMs > 200) return 'firstDegreeBlock'
  return 'normalSinus'
}
