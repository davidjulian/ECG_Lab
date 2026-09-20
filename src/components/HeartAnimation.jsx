import { useEffect, useRef, useMemo } from 'react'
import { buildTissueEvents, createTissueRenderer } from '../lib/myocardialWaves'

// ─── Multi-beat conducted-beat series ──────────────────────────────────────
// A repeating multi-beat `waves` array (irregular SA firing, a fusion
// cycle's plain-conducted beats, etc.) shares the same wave *names* across
// every beat, distinguished only by `center`. Unlike `beatWindows` below
// (which anchors to the first-match wave in the whole array via closures
// over the full `waves` list), this walks every `Q` occurrence and builds
// one normal SA→atria→AV→His→ventricle→repol window set per beat, matching
// each beat's own nearby P/R/S/T by nearest-center — the same
// nearest-occurrence pattern already used by the 'pvcs'/'pacs'/'mobitzI'/
// 'mobitzII' cases below for their own multi-beat waves.
function buildBeatSeries(waves, { avState = 'active' } = {}) {
  const pWaves = waves.filter(wv => wv.name === 'P')
  const qWaves = waves.filter(wv => wv.name === 'Q')
  const rWaves = waves.filter(wv => wv.name === 'R')
  const sWaves = waves.filter(wv => wv.name === 'S')
  const tWaves = waves.filter(wv => wv.name === 'T')
  const map = []
  qWaves.forEach(qw => {
    const qOn   = qw.center - 2 * qw.sigma
    const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
    const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
    const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
    const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - qw.center) < Math.abs(b.center - qw.center) ? tv : b, { center: 9999, sigma: 20 })
    const sOff = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
    const tOff = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130

    if (nearP.center < 9999) {
      const pOn  = nearP.center - 2 * nearP.sigma
      const pOff = nearP.center + 2 * nearP.sigma
      map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
      map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
      map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
      map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
      map.push({ id: 'av',       onsetMs: pOff,      offsetMs: qOn,      state: avState })
    }
    map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
    map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
    map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
    map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
    map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
    map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
    map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
    map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
    if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
  })
  return map
}

// ─── Conduction map builder ──────────────────────────────────────────────────
export function buildConductionMap(rhythmId, waves) {
  const w   = name => waves.find(wv => wv.name === name)
  const has  = name => !!w(name)
  const on   = name => has(name) ? w(name).center - 2 * w(name).sigma : 0
  const off  = name => has(name) ? w(name).center + 2 * w(name).sigma : 0

  const beatWindows = (beatOffset, opts = {}) => {
    const {
      state        = 'active',
      hideSA       = false,
      hideAtria    = false,
      hideAV       = false,
      hideBundles  = false,
      lbundleState = 'active',
      rbundleState = 'active',
      avState      = 'active',
      ectopicAtria = false,
      pacerBeat    = false,
      lvDelay      = 0,
      rvDelay      = 0,
    } = opts

    const pOn  = beatOffset + (has('P') ? on('P')  : 30)
    const pOff = beatOffset + (has('P') ? off('P') : 130)
    const qOn  = beatOffset + (has('Q') ? on('Q')  : 250)
    const sOff = beatOffset + (has('S') ? off('S') : 320)
    const tOff = beatOffset + (has('T') ? off('T') : 430)
    const rCtr = beatOffset + (has('R') ? w('R').center : 284)
    const rSig = has('R') ? w('R').sigma : 12

    const entries = []

    if (!hideSA && !ectopicAtria && !pacerBeat)
      entries.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40,           state })
    if (!hideAtria && !ectopicAtria && !pacerBeat) {
      entries.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,               state })
      // Bachmann's bundle: explicit right-to-left interatrial pathway
      entries.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32,           state })
      entries.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,               state })
    }
    if (ectopicAtria && !pacerBeat) {
      entries.push({ id: 'ectopicFocus', onsetMs: pOn,      offsetMs: pOn + 40,       state: 'ectopic' })
      entries.push({ id: 'ra',           onsetMs: pOn + 15, offsetMs: pOff,           state: 'ectopic' })
      entries.push({ id: 'la',           onsetMs: pOn,      offsetMs: pOff,           state: 'ectopic' })
    }
    if (!hideAV && !pacerBeat)
      entries.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,                state: avState })
    if (!hideBundles && !pacerBeat) {
      entries.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,           state })
      entries.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45 + rvDelay, state: rbundleState })
      entries.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45 + lvDelay, state: lbundleState })
    }

    if (pacerBeat)
      entries.push({ id: 'pacer', onsetMs: beatOffset + 188, offsetMs: beatOffset + 210, state: 'ectopic' })

    const rvOn = pacerBeat ? (beatOffset + 200) : (qOn + (hideBundles ? 10 : 20) + rvDelay)
    const lvOn = pacerBeat ? (beatOffset + 200) : (qOn + (hideBundles ? 10 : 20) + lvDelay)
    entries.push({ id: 'rv',   onsetMs: rvOn,                      offsetMs: sOff + rvDelay,             state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: 'lv',   onsetMs: lvOn,                      offsetMs: sOff + lvDelay,             state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: 'apex', onsetMs: Math.max(rvOn, lvOn) + 15, offsetMs: sOff + Math.max(rvDelay, lvDelay) + 20, state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: '_rwave', onsetMs: rCtr, offsetMs: rCtr, rCenter: rCtr, rSigma: rSig, state: 'meta' })

    // Ventricular repolarization: base-to-apex (opposite direction to depolarization)
    entries.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff, state: 'repol' })
    entries.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff, state: 'repol' })

    return entries
  }

  switch (rhythmId) {
    case 'normalSinus':
    case 'sinusTachycardia':
    case 'sinusBradycardia': {
      // Physiology-driven waves aren't always a single beat (irregular/
      // respiratory SA firing repeats the same beat 6 times over a longer
      // cycle) — build one window set per real Q occurrence rather than
      // anchoring everything to the first beat found. Falls back to the
      // old single-beat helper if there's somehow no Q wave at all.
      const series = buildBeatSeries(waves)
      return series.length ? series : beatWindows(0)
    }

    // Same entries as normalSinus, but atria/ventricles/repolarization carry
    // an extra `continuousWaves` descriptor so the frame loop derives their
    // sweep progress from the actual P / Q+R+S / T Gaussian curves instead of
    // a fixed onset/offset window. SA/AV/His/bundle-branches are left exactly
    // as-is — they're too small to correspond to a distinguishable voltage
    // bump, so there's nothing meaningful to derive their timing from.
    case 'normalSinusVoltage': {
      const entries = beatWindows(0)
      const wave = name => waves.find(wv => wv.name === name)
      const attach = (id, names, delayMs = 0) => {
        const e = entries.find(en => en.id === id)
        if (!e) return
        const comps = names.map(wave).filter(Boolean)
        if (comps.length) { e.continuousWaves = comps; e.continuousDelay = delayMs }
      }
      // Small delay so the atria's visible fill never starts before SA does —
      // a Gaussian's tail is never truly zero, so without this the atria
      // could start ramping a hair before SA's own onset.
      attach('ra', ['P'], 12); attach('la', ['P'], 12); attach('bachmann', ['P'], 12)

      // The bundle branches previously started (qOn+10) while the His bundle
      // was still fading out (it doesn't finish until qOn+20) — the overlap
      // made a branch look like it was firing before His had even finished.
      // Push both branches to start exactly when His's own window ends (its
      // "bottom"), keeping their original sweep duration.
      const hisEntry   = entries.find(en => en.id === 'his')
      const qOnMs      = hisEntry ? hisEntry.onsetMs  : 0 // his.onsetMs === qOn (see beatWindows above)
      const hisBottomMs = hisEntry ? hisEntry.offsetMs : 0
      ;['rbundle', 'lbundle'].forEach(id => {
        const e = entries.find(en => en.id === id)
        if (!e) return
        const dur = e.offsetMs - e.onsetMs
        e.onsetMs = hisBottomMs
        e.offsetMs = hisBottomMs + dur
      })

      // Ventricular progress is delayed to match "His bottom" (qOn →
      // hisBottomMs) plus an extra 20ms — even gated at hisBottomMs, the
      // Q/R/S curve was already far enough along there to show a visible
      // sliver immediately, so the extra 20ms holds it back a bit further.
      const ventDelay = hisBottomMs - qOnMs + 20
      attach('rv', ['Q', 'R', 'S'], ventDelay); attach('lv', ['Q', 'R', 'S'], ventDelay); attach('apex', ['Q', 'R', 'S'], ventDelay + 4)
      attach('repolLV', ['T']); attach('repolRV', ['T'])
      return entries
    }

    case 'firstDegreeBlock': {
      const series = buildBeatSeries(waves, { avState: 'delayed' })
      return series.length ? series : beatWindows(0, { avState: 'delayed' })
    }

    // Fusion beat: buildFusionCycle overlaps a normal conducted beat with an
    // ectopic-focus template (R/S/T only, no P/Q) at the same point in the
    // cycle. The normal beats (each has its own Q) get the usual conduction
    // sequence via buildBeatSeries; the ectopic contribution has no Q, so it
    // shows up as an R wave with no nearby Q — animate that beat's
    // ventricles with a distinct 'fusion' state instead of 'active' so the
    // merged beat visibly reads as different from a normal one.
    case 'fusion': {
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      const map = buildBeatSeries(waves)
      const orphanRs = rWaves.filter(rw => {
        const nearestQDist = qWaves.reduce((best, qw) => Math.min(best, Math.abs(qw.center - rw.center)), Infinity)
        return nearestQDist > 150
      })
      orphanRs.forEach(rw => {
        const rOn  = rw.center - 2 * rw.sigma
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - rw.center) < Math.abs(b.center - rw.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - rw.center) < Math.abs(b.center - rw.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : rOn + 60
        const tOff = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        map.push({ id: 'rv',      onsetMs: rOn,        offsetMs: sOff,      state: 'fusion' })
        map.push({ id: 'lv',      onsetMs: rOn,        offsetMs: sOff,      state: 'fusion' })
        map.push({ id: 'apex',    onsetMs: rOn + 15,   offsetMs: sOff + 20, state: 'fusion' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60,  offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 60,  offsetMs: tOff,      state: 'repol'  })
      })
      return map
    }

    // Sine-wave hyperkalemia: QRS and T have merged into one indistinct
    // blob (see applyIonEffects) — there is no organized SA→AV→His
    // sequence left to show, so unlike the default fallback (which would
    // fabricate a normal-looking beat from missing-wave defaults), show
    // the ventricles as continuously chaotic instead of a false normal beat.
    case 'vfib':
      return ['ra', 'la', 'rv', 'lv', 'apex'].map(id => ({
        id, onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.05, shimmerFreq2: 0.033,
      }))

    case 'lbbb': {
      // The real QRS widens continuously with impairment severity
      // (qrsDuration = 85 + maxImp*65 in ECGEngine.js) — derive the extra
      // bundle-branch delay from that same widening (already reflected in
      // the Q/S wave spacing) instead of a fixed step, so dragging the
      // bundle-velocity slider produces a proportional change here too.
      const bundleDelay = Math.max(0, Math.round((off('S') - on('Q') - 85) * 0.85))
      return beatWindows(0, { lbundleState: 'blocked', lvDelay: bundleDelay })
    }

    case 'rbbb': {
      const bundleDelay = Math.max(0, Math.round((off('S') - on('Q') - 85) * 0.85))
      return beatWindows(0, { rbundleState: 'blocked', rvDelay: bundleDelay })
    }

    case 'vtach':
      return beatWindows(0, { hideSA: true, hideAtria: true, hideAV: true, hideBundles: true, state: 'ectopic' })

    case 'thirdDegreeBlock': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      pWaves.forEach(pw => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
      })
      map.push({ id: 'av', onsetMs: 0, offsetMs: 9999, state: 'blocked' })
      // Escape beats built by buildEscapeOrStandstill never include a Q wave
      // (no discrete septal depolarization to show in a ventricular escape),
      // so gate on R instead — and iterate every escape beat's R (there are
      // normally 3 in a cycle), not just the first, so all of them animate.
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      rWaves.forEach(rEsc => {
        const rOn   = rEsc.center - 2 * rEsc.sigma
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - rEsc.center) < Math.abs(b.center - rEsc.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - rEsc.center) < Math.abs(b.center - rEsc.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : rOn + 80
        const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        map.push({ id: 'rv',      onsetMs: rOn,        offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: rOn,        offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: rOn + 15,   offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60,  offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 60,  offsetMs: tOff,      state: 'repol'  })
        map.push({ id: '_rwave',  onsetMs: rEsc.center, offsetMs: rEsc.center, rCenter: rEsc.center, rSigma: rEsc.sigma, state: 'meta' })
      })
      return map
    }

    case 'atrialFlutter': {
      const map = []
      map.push({ id: 'ra', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.016 })
      map.push({ id: 'la', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.016 })
      const qWaves = waves.filter(wv => wv.name === 'Q')
      qWaves.forEach(qw => {
        const qOn  = qw.center - 2 * qw.sigma
        const sWave = waves.reduce((best, wv) => {
          if (wv.name !== 'S') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 10 })
        const sOff = sWave.center + 2 * sWave.sigma
        const tWave = waves.reduce((best, wv) => {
          if (wv.name !== 'T') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 20 })
        const tOff = tWave.center < 9999 ? tWave.center + 2 * tWave.sigma : sOff + 130
        const rWave = waves.reduce((best, wv) => {
          if (wv.name !== 'R') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 12 })
        map.push({ id: 'av',      onsetMs: qOn - 100, offsetMs: qOn,       state: 'active' })
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        if (rWave.center < 9999) map.push({ id: '_rwave', onsetMs: rWave.center, offsetMs: rWave.center, rCenter: rWave.center, rSigma: rWave.sigma, state: 'meta' })
      })
      return map
    }

    case 'atrialFibrillation': {
      const map = []
      map.push({ id: 'ra', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.08,  shimmerFreq2: 0.053 })
      map.push({ id: 'la', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.071, shimmerFreq2: 0.047 })
      const qWaves = waves.filter(wv => wv.name === 'Q')
      qWaves.forEach(qw => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = waves.reduce((best, wv) => {
          if (wv.name !== 'R') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 12 })
        const nearS = waves.reduce((best, wv) => {
          if (wv.name !== 'S') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 10 })
        const nearT = waves.reduce((best, wv) => {
          if (wv.name !== 'T') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 20 })
        const sOff = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        map.push({ id: 'av',      onsetMs: qOn - 80,  offsetMs: qOn,       state: 'active' })
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'pvcs': {
      const map = []
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const pWaves = waves.filter(wv => wv.name === 'P')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - qw.center) < Math.abs(b.center - qw.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        const isPVC = idx === 3
        if (!isPVC) {
          const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
          if (nearP.center < 9999) {
            const pOn  = nearP.center - 2 * nearP.sigma
            const pOff = nearP.center + 2 * nearP.sigma
            map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
            map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'av',       onsetMs: pOff,      offsetMs: qOn,      state: 'active' })
            map.push({ id: 'his',      onsetMs: qOn,       offsetMs: qOn + 20, state: 'active' })
            map.push({ id: 'rbundle',  onsetMs: qOn + 10,  offsetMs: qOn + 45, state: 'active' })
            map.push({ id: 'lbundle',  onsetMs: qOn + 10,  offsetMs: qOn + 45, state: 'active' })
          }
        }
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol' })
        map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol' })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'pacs': {
      const map = []
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      const pWaves = waves.filter(wv => wv.name === 'P')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - qw.center) < Math.abs(b.center - qw.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        const isPAC = idx === 2
        const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
        if (nearP.center < 9999) {
          const pOn  = nearP.center - 2 * nearP.sigma
          const pOff = nearP.center + 2 * nearP.sigma
          if (isPAC) {
            map.push({ id: 'ectopicFocus', onsetMs: pOn,      offsetMs: pOn + 40, state: 'ectopic' })
            map.push({ id: 'ra',           onsetMs: pOn + 15, offsetMs: pOff,     state: 'ectopic' })
            map.push({ id: 'la',           onsetMs: pOn,      offsetMs: pOff,     state: 'ectopic' })
          } else {
            map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
            map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
          }
          map.push({ id: 'av', onsetMs: pOff, offsetMs: qOn, state: 'active' })
        }
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'mobitzI': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      const avStates = ['active', 'delayed', 'blocked_flash']
      // The physiology engine only ever produces a 2- or 3-beat group
      // (conductionRatio 2 or 3) — derive the dropped-beat index from the
      // actual P count instead of a literal sized for the old static preset.
      const blockedIdx = pWaves.length - 1
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < blockedIdx) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? tv : b, { center: 9999, sigma: 20 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
          map.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,       state: avStates[idx] ?? 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
          map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
          map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
          if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
        } else if (idx === blockedIdx) {
          map.push({ id: 'av', onsetMs: pOff, offsetMs: pOff + 200, state: 'blocked' })
        }
      })
      return map
    }

    case 'mobitzII': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      // Same reasoning as mobitzI above: derive from the actual P count
      // (physiology engine only produces conductionRatio 2 or 3) rather
      // than a literal sized for the old static preset.
      const blockedIdx = pWaves.length - 1
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < blockedIdx) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? tv : b, { center: 9999, sigma: 20 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
          map.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,       state: 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
          map.push({ id: 'repolLV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
          map.push({ id: 'repolRV', onsetMs: sOff + 60, offsetMs: tOff,      state: 'repol'  })
          if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
        } else if (idx === blockedIdx) {
          map.push({ id: 'av', onsetMs: pOff, offsetMs: pOff + 200, state: 'blocked' })
        }
      })
      return map
    }

    case 'ventricularPaced': {
      const spikeWave = waves.find(wv => wv.name === 'Spike')
      const qWave     = waves.find(wv => wv.name === 'Q')
      const rWave     = waves.find(wv => wv.name === 'R')
      const sWave     = waves.find(wv => wv.name === 'S')
      const tWave     = waves.find(wv => wv.name === 'T')
      const map = []
      if (spikeWave) {
        const spikeOn = spikeWave.center - 2 * spikeWave.sigma
        map.push({ id: 'pacer', onsetMs: spikeOn, offsetMs: spikeOn + 25, state: 'ectopic' })
      }
      if (qWave) {
        const qOn  = qWave.center - 2 * qWave.sigma
        const sOff = sWave ? sWave.center + 2 * sWave.sigma : qOn + 130
        const tOff = tWave ? tWave.center + 2 * tWave.sigma : sOff + 130
        map.push({ id: 'rv',      onsetMs: qOn + 10,  offsetMs: sOff,      state: 'ectopic' })
        map.push({ id: 'lv',      onsetMs: qOn + 40,  offsetMs: sOff + 40, state: 'ectopic' })
        map.push({ id: 'apex',    onsetMs: qOn,        offsetMs: qOn + 30,  state: 'ectopic' })
        map.push({ id: 'repolLV', onsetMs: sOff + 60,  offsetMs: tOff,     state: 'repol'   })
        map.push({ id: 'repolRV', onsetMs: sOff + 60,  offsetMs: tOff,     state: 'repol'   })
        if (rWave) map.push({ id: '_rwave', onsetMs: rWave.center, offsetMs: rWave.center, rCenter: rWave.center, rSigma: rWave.sigma, state: 'meta' })
      }
      return map
    }

    default:
      return beatWindows(0)
  }
}


// ─── Color / state helpers ────────────────────────────────────────────────────
// The user asked for the conduction system to read as yellow when active.
const STATE_FILL = {
  active:        '#eab308',  // yellow — depolarization
  delayed:       '#f59e0b',  // amber  — slow conduction
  blocked:       '#a855f7',  // purple — block
  blocked_flash: '#a855f7',  // purple — block flash
  ectopic:       '#818cf8',  // indigo — ectopic focus
  fusion:        '#c026d3',  // fuchsia — blended normal + ectopic wavefronts
  shimmer:       '#eab308',  // yellow — fibrillatory shimmer
  repol:         '#1d4ed8',  // dark blue — repolarization
  hidden:        '#1e293b',
  meta:          null,
}
const INACTIVE_FILL   = '#1e293b'
const INACTIVE_STROKE = '#334155'

// Each traced anatomical shape's own resting color (from the source artwork),
// used to reset elements back to their natural dormant appearance every frame.
const REST_FILL = {
  sa: '#404040', av: '#414141',
  ra: '#532e2b', la: '#532e2b', rv: '#532e2b', lv: '#532e2b',
  rbundle: '#414141', lbundle: '#414141',
}

function computeIntensity(progress) {
  const RISE = 0.40
  const FALL = 0.75
  if (progress <= 0 || progress >= 1) return 0
  if (progress < RISE) return progress / RISE
  if (progress > FALL) return (1 - progress) / (1 - FALL)
  return 1.0
}

// ─── Depolarization sweep table (top-to-bottom clip rect by default) ──────────
// fullH values match each traced shape's own bounding-box height in its local
// (pre-transform) coordinate space, taken from the source SVG. The ventricles
// use `reverse` (bottom-to-top, apex-to-base) since real ventricular
// depolarization travels up from the apex via the bundle branches/Purkinje
// fibers, unlike the atria which depolarize outward from the SA node at top.
const SWEEP_TABLE = {
  ra: { overlayId: 'ra_overlay', glowId: 'ra_glow', clipId: 'ra_clipRect', topY: 409.708, fullH: 119.821, gradientId: 'ra_gradient', gradStopId: 'ra_gradStop1' },
  la: { overlayId: 'la_overlay', glowId: 'la_glow', clipId: 'la_clipRect', topY: 392.865, fullH: 75.3993, gradientId: 'la_gradient', gradStopId: 'la_gradStop1' },
  rv: { overlayId: 'rv_overlay', glowId: 'rv_glow', clipId: 'rv_clipRect', topY: 512.874, fullH: 154.843, reverse: true, gradientId: 'rv_gradient', gradStopId: 'rv_gradStop1' },
  lv: { overlayId: 'lv_overlay', glowId: 'lv_glow', clipId: 'lv_clipRect', topY: 477.776, fullH: 167.742, reverse: true, gradientId: 'lv_gradient', gradStopId: 'lv_gradStop1' },
  // Bundle branches use a radial (not rectangular) reveal — see `radial` below.
  lbundle: { overlayId: 'lbundle_overlay', glowId: 'lbundle_glow', radial: true, leadId: 'lbundle_leadCircle', trailId: 'lbundle_trailCircle', gradientId: 'lbundle_gradient', gradStopId: 'lbundle_gradStop1' },
  rbundle: { overlayId: 'rbundle_overlay', glowId: 'rbundle_glow', radial: true, leadId: 'rbundle_leadCircle', trailId: 'rbundle_trailCircle', gradientId: 'rbundle_gradient', gradStopId: 'rbundle_gradStop1' },
}
// The reveal origin sits at the path's own start vertex (matches the AV
// node position, so the sweep visually begins right at the top where the
// bundle of His actually originates). Because that point is NOT centered
// between the two clip halves (rbundle: x 284–400, lbundle: x 400–510), the
// two sides need different max horizontal reach to each fully cover their
// own clip region at the same relative progress — otherwise the farther
// side (lbundle) would visibly lag/never catch up. Each is set to the
// distance from the origin to that side's own far clip edge.
const BUNDLE_MAX_RX_R = 85  // rbundle: reaches its far edge (x=284.15) from origin
const BUNDLE_MAX_RX_L = 195 // lbundle: reaches its far edge (x=509.79) from origin
const BUNDLE_MAX_RY = 220

// The bundle-branch reveal travels down the trunk before fanning out to the
// lateral tips — a plain circle reaches a horizontally-far tip just as fast
// as a vertically-far point at the same Euclidean distance, which let the
// far right/left tips light up before the bottom was actually reached.
// Growing an ellipse's vertical radius (ry) to completion well before its
// horizontal radius (rx) starts approximates "down, then out" without
// needing to actually track a bent conduction path.
const BUNDLE_DOWN_FRAC  = 0.55 // ry reaches full reach by this fraction of progress
const BUNDLE_OUT_START  = 0.3  // rx starts growing at this fraction of progress
// A slight extra vertical reach late in the sweep, once the branches have
// already fanned out sideways — approximates the Purkinje network curling
// up a little as it wraps around the ventricular walls, after reaching the
// bottom and spreading out. Kept small/subtle on purpose.
const BUNDLE_UP_START = 0.75
const BUNDLE_UP_EXTRA = 0.12 // fraction of BUNDLE_MAX_RY added on top, at most
function anisoRadius(t, maxRx) {
  const ry = Math.min(1, t / BUNDLE_DOWN_FRAC) * BUNDLE_MAX_RY
  const rx = Math.max(0, (t - BUNDLE_OUT_START) / (1 - BUNDLE_OUT_START)) * maxRx
  const upBoost = Math.max(0, (t - BUNDLE_UP_START) / (1 - BUNDLE_UP_START)) * BUNDLE_UP_EXTRA * BUNDLE_MAX_RY
  return [rx, ry + upBoost]
}

// A traveling "band" of activation: the leading edge advances across the full
// sweep while a trailing edge follows BAND_FRAC behind it (as a fraction of
// the full sweep length), so the region fades away in the same direction it
// activated in, rather than the whole area dimming uniformly at once. Both
// edges are timed to reach the far end together at progress === 1.
const BAND_FRAC = 0.3
function bandEdges(progress) {
  const speed = 1 + BAND_FRAC
  const lead  = Math.min(1, progress * speed)
  const trail = Math.max(0, Math.min(1, progress * speed - BAND_FRAC))
  return [trail, lead]
}

// Depolarization "spread, hold, fade in the same order": the leading edge
// fills across the chamber quickly (FILL_FRAC), the whole thing then holds
// fully lit (HOLD_FRAC) — real myocardium must depolarize together for
// atrial/ventricular systole to actually pump — and only then does a second
// edge sweep through in the SAME direction/order the fill went, fading each
// region away in the order it originally lit up (FADE_FRAC), rather than the
// whole chamber dimming everywhere at once.
const FILL_FRAC = 0.35 // fraction of the window spent spreading across the chamber
const HOLD_FRAC = 0.30 // fraction spent fully lit before the fade-sweep begins
const FADE_FRAC = 1 - FILL_FRAC - HOLD_FRAC
function fillHoldFade(progress) {
  const lead = Math.min(1, progress / FILL_FRAC)
  const fadeStart = FILL_FRAC + HOLD_FRAC
  const trail = Math.max(0, Math.min(1, (progress - fadeStart) / FADE_FRAC))
  return [trail, lead]
}

// ─── Voltage-driven progress (normalSinusVoltage only) ────────────────────────
// Instead of a linear ramp across a fixed onset/offset window, derive a
// structure's sweep progress from the actual continuous Gaussian curve(s) of
// the ECG wave(s) it corresponds to (P → atria, Q/R/S → ventricles, T →
// repolarization) — the same wave objects ECGVoltage sums to produce the
// trace, so the animation's timing is now grounded in the same continuous
// model instead of an independently-chosen ±2σ cutoff.
function erf(x) {
  // Abramowitz & Stegun 7.1.26 rational approximation, accurate to ~1.5e-7.
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}
function gaussianCDF(t, center, sigma) {
  if (!sigma) return t < center ? 0 : 1
  return 0.5 * (1 + erf((t - center) / (sigma * Math.SQRT2)))
}
// Weighted average of each component wave's CDF, weighted by |amplitude| so
// the dominant component (e.g. R within a Q/R/S group) governs most of the
// shape while still blending in the smaller ones.
function continuousProgress(t, components) {
  let num = 0, den = 0
  for (const c of components) {
    const w = Math.abs(c.amplitude) || 1e-6
    num += w * gaussianCDF(t, c.center, c.sigma)
    den += w
  }
  return den > 0 ? Math.max(0, Math.min(1, num / den)) : 0
}

// ─── Repolarization sweep table (bottom-to-top clip rect — base-to-apex) ──────
const REPOL_TABLE = {
  repolLV: { overlayId: 'lv_repol_overlay', glowId: 'lv_repol_glow', clipId: 'lv_repol_clipRect', topY: 477.776, fullH: 167.742, gradientId: 'lv_repol_gradient', gradStopId: 'lv_repol_gradStop1' },
  repolRV: { overlayId: 'rv_repol_overlay', glowId: 'rv_repol_glow', clipId: 'rv_repol_clipRect', topY: 512.874, fullH: 154.843, gradientId: 'rv_repol_gradient', gradStopId: 'rv_repol_gradStop1' },
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function HeartAnimation({ clockRef, rhythmId, rhythm, className = '', width = 280, height = 330, tissueWaves = false, compact = false }) {
  const elRefs        = useRef({})
  const conductionMap = useMemo(() => rhythm.conductionMap ?? buildConductionMap(rhythmId, rhythm.waves), [rhythmId, rhythm])

  const tissueCanvas = useRef(null)
  const tissueTiming = useMemo(() => buildTissueEvents(conductionMap, rhythm.waves), [conductionMap, rhythm])
  const timingRef = useRef(tissueTiming)
  useEffect(() => { timingRef.current = tissueTiming }, [tissueTiming])
  const mapRef = useRef(conductionMap)
  mapRef.current = conductionMap

  useEffect(() => {
    let rafId
    const renderTissue = tissueWaves ? createTissueRenderer(tissueCanvas.current, elRefs.current) : null

    const frame = () => {
      const { tInCycle, cycleMs, nativeCycleMs } = clockRef.current
      const tMs = nativeCycleMs !== null
        ? tInCycle * (nativeCycleMs / cycleMs)
        : tInCycle

      const map = mapRef.current
      const els = elRefs.current

      // Reset all depol sweep overlays
      Object.values(SWEEP_TABLE).forEach(({ overlayId, glowId, clipId, radial, leadId, trailId }) => {
        const ov = els[overlayId]
        const gw = els[glowId]
        if (ov) ov.style.opacity = '0'
        if (gw) gw.style.opacity = '0'
        if (radial) {
          const leadEl  = els[leadId]
          const trailEl = els[trailId]
          if (leadEl)  { leadEl.setAttribute('rx', '0'); leadEl.setAttribute('ry', '0') }
          if (trailEl) { trailEl.setAttribute('rx', '0'); trailEl.setAttribute('ry', '0') }
        } else {
          const cr = els[clipId]
          if (cr) cr.setAttribute('height', '0')
        }
      })

      // Reset all repol sweep overlays (start at bottom, height=0)
      Object.values(REPOL_TABLE).forEach(({ overlayId, glowId, clipId, topY, fullH }) => {
        const ov = els[overlayId]
        const gw = els[glowId]
        const cr = els[clipId]
        if (ov) ov.style.opacity = '0'
        if (gw) gw.style.opacity = '0'
        if (cr) {
          cr.setAttribute('y', String(topY + fullH))
          cr.setAttribute('height', '0')
        }
      })

      const activeIds = new Set()

      map.forEach(entry => {
        if (entry.state === 'meta') return
        if (tissueWaves && ['ra', 'la', 'rv', 'lv', 'repolLV', 'repolRV', 'apex'].includes(entry.id)) return

        if (entry.state === 'blocked' || entry.state === 'blocked_flash') {
          const el = els[entry.id]
          if (el) {
            el.setAttribute('fill', STATE_FILL.blocked)
            el.setAttribute('filter', 'url(#ECG-glow-purple)')
            activeIds.add(entry.id + '_blocked')
          }
          return
        }

        if (entry.state === 'shimmer') {
          const el = els[entry.id]
          if (!el) return
          const f1 = entry.shimmerFreq  ?? 0.016
          const f2 = entry.shimmerFreq2 ?? 0
          const osc = f2
            ? Math.abs(Math.sin(tMs * f1) * Math.sin(tMs * f2))
            : (0.5 + 0.5 * Math.sin(tMs * f1))
          const opacity = 0.25 + 0.6 * osc
          el.setAttribute('fill', STATE_FILL.shimmer)
          el.style.opacity = opacity
          el.setAttribute('filter', opacity > 0.6 ? 'url(#ECG-glow)' : 'none')
          activeIds.add(entry.id + '_shimmer')
          return
        }

        const isContinuous = !!entry.continuousWaves
        if (isContinuous || (tMs >= entry.onsetMs && tMs <= entry.offsetMs)) {
          // Continuous entries still respect their own onsetMs as a hard
          // floor (progress forced to exactly 0 before it) — a Gaussian's
          // tail never truly reaches zero, so without this an entry could
          // show a faint-but-real sliver before another structure that's
          // supposed to strictly precede it (e.g. SA before the atria).
          const progress = isContinuous
            ? (tMs < entry.onsetMs ? 0 : continuousProgress(tMs - (entry.continuousDelay || 0), entry.continuousWaves))
            : (() => {
                const windowMs = entry.offsetMs - entry.onsetMs
                return windowMs > 0 ? (tMs - entry.onsetMs) / windowMs : 1
              })()
          const intensity = computeIntensity(progress)

          // Repolarization: a traveling band following the same apex-to-base
          // direction the ventricular depolarization band took.
          if (entry.state === 'repol') {
            const repDef = REPOL_TABLE[entry.id]
            if (repDef) {
              const overlay   = els[repDef.overlayId]
              const glow      = els[repDef.glowId]
              const clipRect  = els[repDef.clipId]
              const gradEl    = els[repDef.gradientId]
              const gradStop  = els[repDef.gradStopId]
              const [trail, lead] = bandEdges(progress)
              const bandH = (lead - trail) * repDef.fullH
              const y = repDef.topY + repDef.fullH * (1 - lead)
              if (clipRect) {
                clipRect.setAttribute('y', String(y))
                clipRect.setAttribute('height', String(bandH))
              }
              if (gradEl) {
                gradEl.setAttribute('y1', String(y))
                gradEl.setAttribute('y2', String(y + bandH))
              }
              if (gradStop) gradStop.setAttribute('stop-color', STATE_FILL.repol)
              if (overlay) {
                overlay.style.opacity = 1
                overlay.setAttribute('fill', STATE_FILL.repol)
                overlay.setAttribute('filter', 'url(#ECG-glow-amber)')
              }
              if (glow) glow.style.opacity = 1
            }
            return
          }

          const fill   = STATE_FILL[entry.state] ?? STATE_FILL.active
          const filter = entry.state === 'ectopic' ? 'url(#ECG-glow-indigo)'
                       : entry.state === 'fusion'  ? 'url(#ECG-glow-indigo)'
                       : entry.state === 'delayed' ? 'url(#ECG-glow-amber)'
                       : 'url(#ECG-glow)'

          const swpDef = SWEEP_TABLE[entry.id]
          if (swpDef) {
            const overlay  = els[swpDef.overlayId]
            const glow     = els[swpDef.glowId]
            const gradEl   = els[swpDef.gradientId]
            const gradStop = els[swpDef.gradStopId]
            // Bundle branches keep the thin traveling reveal (they're a
            // conduction pathway, not contracting muscle); chambers use the
            // spread/hold/fade-in-the-same-order fill.
            const [trail, lead] = swpDef.radial
              ? bandEdges(progress)
              : fillHoldFade(progress)

            if (swpDef.radial) {
              const leadEl  = els[swpDef.leadId]
              const trailEl = els[swpDef.trailId]
              const maxRx = entry.id === 'lbundle' ? BUNDLE_MAX_RX_L : BUNDLE_MAX_RX_R
              const [leadRx, leadRy]   = anisoRadius(lead, maxRx)
              const [trailRx, trailRy] = anisoRadius(trail, maxRx)
              if (leadEl)  { leadEl.setAttribute('rx', String(leadRx)); leadEl.setAttribute('ry', String(leadRy)) }
              if (trailEl) { trailEl.setAttribute('rx', String(trailRx)); trailEl.setAttribute('ry', String(trailRy)) }
              if (gradEl)  gradEl.setAttribute('r', String(Math.max(1, leadRx, leadRy)))
            } else {
              const clipRect = els[swpDef.clipId]
              const bandH = (lead - trail) * swpDef.fullH
              const y = swpDef.reverse
                ? swpDef.topY + swpDef.fullH * (1 - lead)
                : swpDef.topY + swpDef.fullH * trail
              if (clipRect) {
                clipRect.setAttribute('y', String(y))
                clipRect.setAttribute('height', String(bandH))
              }
              if (gradEl) {
                gradEl.setAttribute('y1', String(y))
                gradEl.setAttribute('y2', String(y + bandH))
              }
            }
            if (gradStop) gradStop.setAttribute('stop-color', fill)
            if (overlay) {
              overlay.style.opacity = 1
              overlay.setAttribute('fill', fill)
              overlay.setAttribute('filter', filter)
            }
            if (glow) glow.style.opacity = 1
          } else {
            const el = els[entry.id]
            if (el) {
              el.setAttribute('fill',   fill)
              el.setAttribute('filter', filter)
              el.style.opacity = intensity
              activeIds.add(entry.id)
            }
          }
        }
      })

      // Reset inactive elements to their own dormant/resting appearance
      // (skip every auxiliary ref used by the sweep/mask/gradient machinery —
      // only actual base shapes get their fill reset here).
      Object.entries(els).forEach(([id, el]) => {
        if (!el) return
        if (
          id.endsWith('_overlay') || id.endsWith('_clipRect') || id.endsWith('_glow') ||
          id.endsWith('_leadCircle') || id.endsWith('_trailCircle') ||
          id.endsWith('_gradient') || id.includes('_gradStop')
        ) return
        if (activeIds.has(id) || activeIds.has(id + '_blocked') || activeIds.has(id + '_shimmer')) return

        el.setAttribute('fill', REST_FILL[id] ?? INACTIVE_FILL)
        el.setAttribute('filter', 'none')
        el.style.opacity = '1'
      })

      if (renderTissue) renderTissue(tMs, nativeCycleMs ?? cycleMs, timingRef.current)
      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [clockRef, tissueWaves])

  const ref = id => el => { elRefs.current[id] = el }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {!compact && <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Conduction System</p>}
      <svg viewBox="33.46476 45.636623 131.51485 155.00606" width={width} height={height} style={{ overflow: 'visible' }}>
        <defs>
          {/* Yellow glow for depolarization */}
          <filter id="ECG-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Purple glow for blocks */}
          <filter id="ECG-glow-purple" x="-40%" y="-40%" width="180%" height="180%">
            <feFlood floodColor="#a855f7" floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="SourceGraphic" operator="in" result="tinted" />
            <feGaussianBlur in="tinted" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Amber glow for delayed/repolarization */}
          <filter id="ECG-glow-amber" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Indigo glow for ectopic */}
          <filter id="ECG-glow-indigo" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* ── Depol clip paths (top-to-bottom sweep) — coordinates are in each
               shape's own local space (pre-transform), matching the traced artwork. */}
          <clipPath id="clip-ra"><rect ref={ref('ra_clipRect')} x="235.919" y="409.708" width="83.2007" height="0" /></clipPath>
          <clipPath id="clip-la"><rect ref={ref('la_clipRect')} x="401.064" y="392.865" width="80.3025" height="0" /></clipPath>
          <clipPath id="clip-rv"><rect ref={ref('rv_clipRect')} x="268.029" y="512.874" width="155.441" height="0" /></clipPath>
          <clipPath id="clip-lv"><rect ref={ref('lv_clipRect')} x="381.933" y="477.776" width="110.279" height="0" /></clipPath>

          {/* Bundle branches share one traced conduction shape, split into a
              right half / left half by a fixed vertical line near the septum. */}
          <clipPath id="clip-rbundle-half"><rect x="284.15" y="486.355" width="115.85" height="191.411" /></clipPath>
          <clipPath id="clip-lbundle-half"><rect x="400" y="486.355" width="109.79" height="191.411" /></clipPath>

          {/* Repol clip paths (bottom-to-top, initial y at bottom) */}
          <clipPath id="clip-rv-repol"><rect ref={ref('rv_repol_clipRect')} x="268.029" y="667.717" width="155.441" height="0" /></clipPath>
          <clipPath id="clip-lv-repol"><rect ref={ref('lv_repol_clipRect')} x="381.933" y="645.518" width="110.279" height="0" /></clipPath>

          {/* Bundle branches reveal outward from the AV node/His bundle origin
              via a growing-then-shrinking radius, masked into an annulus (a
              white "lead" disc revealing, a black "trail" disc re-hiding the
              already-passed interior) so distant branch tips never light up
              before the conduction front actually reaches them. */}
          {/* Ellipses, not circles: the reveal grows mostly vertically at
              first (traveling down the trunk) before widening horizontally
              (fanning out) — see anisoRadius() in the frame loop. */}
          <mask id="mask-rbundle" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
            <ellipse ref={ref('rbundle_leadCircle')} cx="318.469" cy="486.397" rx="0" ry="0" fill="#ffffff" />
            <ellipse ref={ref('rbundle_trailCircle')} cx="318.469" cy="486.397" rx="0" ry="0" fill="#000000" />
          </mask>
          <mask id="mask-lbundle" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
            <ellipse ref={ref('lbundle_leadCircle')} cx="318.469" cy="486.397" rx="0" ry="0" fill="#ffffff" />
            <ellipse ref={ref('lbundle_trailCircle')} cx="318.469" cy="486.397" rx="0" ry="0" fill="#000000" />
          </mask>

          {/* ── Soft-edged gradients: a moving/growing transparent-opaque-
               transparent band so the depol/repol wave fades in and out at
               its own edges instead of a hard-edged flat-colored region. */}
          <linearGradient ref={ref('ra_gradient')} id="grad-ra" gradientUnits="userSpaceOnUse" x1="277" y1="409.708" x2="277" y2="529.529">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('ra_gradStop1')} offset="0.5" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </linearGradient>
          <linearGradient ref={ref('la_gradient')} id="grad-la" gradientUnits="userSpaceOnUse" x1="441" y1="392.865" x2="441" y2="468.264">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('la_gradStop1')} offset="0.5" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </linearGradient>
          <linearGradient ref={ref('rv_gradient')} id="grad-rv" gradientUnits="userSpaceOnUse" x1="345" y1="512.874" x2="345" y2="667.717">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('rv_gradStop1')} offset="0.5" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </linearGradient>
          <linearGradient ref={ref('lv_gradient')} id="grad-lv" gradientUnits="userSpaceOnUse" x1="437" y1="477.776" x2="437" y2="645.518">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('lv_gradStop1')} offset="0.5" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </linearGradient>
          <linearGradient ref={ref('rv_repol_gradient')} id="grad-rv-repol" gradientUnits="userSpaceOnUse" x1="345" y1="512.874" x2="345" y2="667.717">
            <stop offset="0" stopColor="#1d4ed8" stopOpacity="0" />
            <stop ref={ref('rv_repol_gradStop1')} offset="0.5" stopColor="#1d4ed8" stopOpacity="1" />
            <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
          </linearGradient>
          <linearGradient ref={ref('lv_repol_gradient')} id="grad-lv-repol" gradientUnits="userSpaceOnUse" x1="437" y1="477.776" x2="437" y2="645.518">
            <stop offset="0" stopColor="#1d4ed8" stopOpacity="0" />
            <stop ref={ref('lv_repol_gradStop1')} offset="0.5" stopColor="#1d4ed8" stopOpacity="1" />
            <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
          </linearGradient>
          <radialGradient ref={ref('rbundle_gradient')} id="grad-rbundle" gradientUnits="userSpaceOnUse" cx="318.469" cy="486.397" r="1">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('rbundle_gradStop1')} offset="0.55" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </radialGradient>
          <radialGradient ref={ref('lbundle_gradient')} id="grad-lbundle" gradientUnits="userSpaceOnUse" cx="318.469" cy="486.397" r="1">
            <stop offset="0" stopColor="#414141" stopOpacity="0" />
            <stop ref={ref('lbundle_gradStop1')} offset="0.55" stopColor="#414141" stopOpacity="1" />
            <stop offset="1" stopColor="#414141" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Traced anatomy: vessels, wall shading, outlines (static) ─────── */}
        <path d="m 70.784384,110.96097 c -1.288105,1.10409 -2.637546,2.39219 -3.710973,3.77231 -1.073427,1.38013 -1.870809,2.85222 -2.514866,4.23235 -0.644057,1.38012 -1.134755,2.6682 -1.472117,4.10966 -0.337363,1.44147 -0.521374,3.03623 -0.644051,4.50837 -0.122678,1.47213 -0.184014,2.82154 -0.06133,4.07899 0.12268,1.25745 0.429365,2.42285 0.828069,3.58829 0.398704,1.16544 0.889399,2.33084 1.625469,3.09757 0.736071,0.76674 1.717465,1.13476 2.913575,1.44145 1.196109,0.3067 2.606863,0.55205 4.078998,0.36803 1.472136,-0.18403 3.00556,-0.7974 4.539033,-1.62547 1.533472,-0.82808 3.0669,-1.87081 4.201666,-2.8829 1.134767,-1.0121 1.87081,-1.99349 2.453528,-3.1896 0.582717,-1.19611 1.012077,-2.60686 1.226761,-4.14034 0.214684,-1.53347 0.214684,-3.18957 0.245354,-4.6617 0.03067,-1.47213 0.09201,-2.76021 -0.03067,-4.14034 -0.122679,-1.38012 -0.429365,-2.85221 -0.858739,-4.44703 -0.429374,-1.59481 -0.981408,-3.31225 -1.778815,-4.44701 -0.797407,-1.13476 -1.840141,-1.6868 -3.09759,-2.02416 -1.257449,-0.33736 -2.729539,-0.46003 -4.078992,-0.0613 -1.349453,0.39871 -2.576197,1.31877 -3.864302,2.42286 z" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 62.749069,113.35316 c -1.042751,2.51487 -2.085502,5.02974 -2.913575,7.94334 -0.828072,2.9136 -1.441443,6.2258 -1.410767,9.41542 0.03068,3.18963 0.705382,6.25648 1.686808,8.7407 0.981426,2.48422 2.269506,4.38567 3.189587,5.70445 0.920081,1.31878 1.472111,2.05482 1.809473,3.37361 0.337362,1.3188 0.460037,3.22025 0.889412,5.12175 0.429376,1.90151 1.16542,3.80296 2.238852,5.64313 1.073433,1.84016 2.484188,3.61894 4.845744,6.01116 2.361557,2.39222 5.673763,5.39774 8.710034,7.60593 3.036271,2.20819 5.79644,3.61895 8.526022,4.87639 2.729581,1.25745 5.428412,2.36151 8.710048,3.46561 3.281633,1.1041 7.145873,2.20817 11.378263,2.94423 4.23238,0.73607 8.83266,1.10409 12.08361,1.01208 3.25095,-0.092 5.1524,-0.64405 7.05391,-1.87083 1.9015,-1.22678 3.80295,-3.12823 5.1524,-5.5818 1.34945,-2.45356 2.14683,-5.45908 2.94424,-9.23142 0.79741,-3.77235 1.59479,-8.3113 1.96282,-11.83828 0.36803,-3.52697 0.30669,-6.04179 -0.2147,-9.29276 -0.52138,-3.25097 -1.50278,-7.23788 -2.54554,-10.27415 -1.04276,-3.03626 -2.14683,-5.12172 -3.09758,-6.71652 -0.95075,-1.59481 -1.74813,-2.69888 -2.02415,-4.32436 -0.27602,-1.62549 -0.0307,-3.77229 0.0613,-5.64312 0.092,-1.87084 0.0307,-3.4656 -0.49071,-5.73515 -0.52139,-2.26955 -1.50278,-5.21372 -2.76023,-7.32991 -1.25745,-2.11618 -2.79088,-3.40426 -4.72306,-4.29367 -1.93218,-0.88941 -4.26298,-1.3801 -6.71654,-1.41077 -2.45356,-0.0307 -5.02971,0.39869 -6.8392,1.10409 -1.8095,0.7054 -2.85222,1.68679 -3.77231,3.12826 -0.92008,1.44147 -1.71746,3.34292 -2.26951,4.93773 -0.55205,1.59481 -0.85873,2.88289 -0.55203,4.41636 0.3067,1.53348 1.22676,3.31225 2.05483,4.84572 0.82807,1.53347 1.56412,2.82155 2.30018,4.10966" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 62.720137,113.40825 c 1.5431,-2.22654 3.086204,-4.45309 4.563157,-5.78105 1.476954,-1.32795 2.887707,-1.75731 4.237164,-2.064 1.349456,-0.3067 2.637535,-0.49071 4.477706,-0.24535 1.840171,0.24536 4.232318,0.92007 5.765783,1.47212 1.533465,0.55205 2.20817,0.9814 3.026797,2.26058 0.818627,1.27917 1.781099,3.40802 2.486504,3.4387 0.705406,0.0307 1.153657,-2.03685 2.267219,-4.45081 1.113562,-2.41396 2.892337,-5.17413 4.05777,-6.98362 1.165432,-1.809486 1.717464,-2.668204 1.840138,-3.557618 0.122674,-0.889414 -0.184013,-1.809471 -0.490704,-2.729544" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 101.02417,131.40526 c 0.36803,-4.36124 0.73605,-8.72238 1.47212,-12.95791 0.73607,-4.23554 1.84014,-8.34512 2.82156,-11.13603 0.98142,-2.7909 1.84014,-4.26299 3.55764,-5.27508 1.7175,-1.01209 4.29365,-1.56412 6.6552,-1.80947 2.36155,-0.245357 4.50834,-0.18402 6.40985,-0.092 1.9015,0.092 3.5576,0.21468 4.72303,0.30669 1.16544,0.092 1.84015,0.15334 2.36153,-1e-5 0.52138,-0.15334 0.8894,-0.521368 1.19609,-0.981408 0.3067,-0.46004 0.55205,-1.012076 0.70539,-1.809484 0.15335,-0.797408 0.21468,-1.840141 0.18401,-2.729553 -0.0307,-0.889413 -0.15334,-1.625456 -0.33736,-2.146836 -0.18402,-0.52138 -0.42937,-0.828065 -0.95075,-1.042749 -0.52138,-0.214684 -1.31876,-0.337358 -4.96846,-0.490706 -3.64969,-0.153348 -10.15142,-0.33736 -15.4879,-0.337358 -5.33647,2e-6 -9.507386,0.184014 -13.678388,0.368029" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 128.07434,100.47212 c -0.18401,-1.04275 -0.36803,-2.085505 -0.46003,-3.128266 -0.092,-1.042761 -0.092,-2.085492 0.092,-2.882895 0.18402,-0.797403 0.55204,-1.349436 0.98141,-1.748138 0.42938,-0.398702 0.92008,-0.644051 1.41078,-0.889401" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 124.49314,103.41636 c 3.27923,-0.30669 6.55847,-0.61339 8.41278,-0.4907 1.85431,0.12268 2.28367,0.67471 2.49835,1.2881 0.21469,0.61339 0.21469,1.2881 0.24536,1.93215 0.0307,0.64406 0.092,1.25744 0.073,1.71358 -0.019,0.45614 -0.11827,0.75502 -1.11867,1.11916 -1.00041,0.36413 -2.90186,0.79349 -4.80335,1.22286" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 133.77881,103.04833 c -0.12268,0.92007 -0.24535,1.84015 -0.24535,2.60688 0,0.76674 0.12267,1.38011 0.42937,1.87082 0.3067,0.49071 0.79739,0.85873 1.2881,1.22676" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 130.28253,111.14498 c 2.14684,-0.0613 4.29368,-0.12268 5.52045,-0.0613 1.22676,0.0613 1.53345,0.24535 1.7788,0.64406 0.24536,0.3987 0.42937,1.01207 0.55204,1.71747 0.12268,0.7054 0.18402,1.50279 0.15335,2.17752 -0.0307,0.67472 -0.15334,1.22675 -0.64406,1.56411 -0.49071,0.33737 -1.34943,0.46004 -2.40338,0.52137 -1.05394,0.0613 -2.30305,0.0613 -3.55217,0.0613" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 136.90706,111.329 c -0.30669,0.67472 -0.61338,1.34944 -0.73606,2.0855 -0.12267,0.73607 -0.0613,1.53346 0.0613,2.17751 0.12268,0.64406 0.30669,1.13475 0.46866,1.42077 0.16197,0.28603 0.30189,0.36736 0.4418,0.4487" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 193.58364,115.56134 c 0,0 0,0 0,0" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 111.57128,104.82458 c -0.85874,0.39869 -1.74661,0.78334 -2.37456,1.15968 -0.62796,0.37634 -0.99598,0.74436 -1.36401,1.35775 -0.36804,0.6134 -0.73606,1.47212 -1.04275,2.3922 -0.3067,0.92008 -0.55205,1.90148 -0.67472,2.82156 -0.12268,0.92008 -0.12268,1.7788 -0.0307,2.63754 0.092,0.85875 0.27602,1.71747 0.61339,2.60688 0.33737,0.88942 0.82806,1.80947 1.34944,2.54553 0.52138,0.73607 1.07342,1.28811 1.71748,1.80949 0.64406,0.52138 1.3801,1.01207 2.42286,1.31877 1.04277,0.30669 2.39219,0.42936 3.58829,0.4907 1.19611,0.0613 2.23884,0.0613 3.52696,0 1.28812,-0.0613 2.82154,-0.18401 4.10966,-0.46004 1.28811,-0.27603 2.33084,-0.70538 3.03624,-1.80949 0.70539,-1.10411 1.07341,-2.88288 1.01207,-4.81506 -0.0614,-1.93218 -0.55204,-4.01764 -1.22677,-5.76579 -0.67473,-1.74816 -1.53345,-3.15891 -2.72956,-4.26301 -1.19611,-1.10409 -2.72954,-1.90147 -4.35502,-2.39218 -1.62548,-0.49071 -3.34292,-0.67472 -4.61647,-0.56035 -1.27355,0.11438 -2.10313,0.52712 -2.96186,0.92582 z" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 70.93773,144.72769 c -0.33736,1.38011 0.153348,3.77231 1.073435,6.22586 0.920088,2.45356 2.269503,4.96838 3.802979,7.23792 1.533475,2.26954 3.250913,4.29366 5.397779,6.10315 2.146865,1.8095 4.723019,3.40426 7.667291,4.8764 2.944273,1.47213 6.256472,2.82154 8.98605,3.89497 2.729576,1.07343 4.876366,1.87081 6.777876,2.4842 1.9015,0.61338 3.5576,1.04274 4.6617,1.16542 1.10409,0.12267 1.65612,-0.0613 2.11617,-0.46004 0.46004,-0.39871 0.82806,-1.01208 0.73605,-1.56413 -0.092,-0.55204 -0.64403,-1.04273 -1.25743,-1.80948 -0.6134,-0.76675 -1.15794,-1.60832 -2.10917,-3.4376 -0.95122,-1.82928 -1.4524,-2.93186 -2.49317,-5.16023 -1.04078,-2.22837 -1.96084,-4.12982 -2.88093,-6.15402 -0.92009,-2.0242 -1.84013,-4.17096 -2.69888,-6.10316 -0.858758,-1.93219 -1.656125,-3.64959 -2.177512,-5.48978 -0.521388,-1.84019 -0.766728,-3.80293 -1.012087,-5.79647 -0.245359,-1.99354 -0.490703,-4.01761 -2.300228,-4.78436 -1.809524,-0.76674 -5.183043,-0.27605 -7.667245,0.39868 -2.484201,0.67472 -4.090645,1.53973 -5.886909,2.54442 -1.796264,1.00469 -3.839772,2.18125 -5.21761,2.82399 -1.377837,0.64274 -2.113872,0.76541 -3.064632,1.01077 -0.950759,0.24536 -2.116167,0.61338 -2.453527,1.99349 z" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 127.09293,129.73048 c 0.0613,1.65613 0.42937,4.04833 0.95075,6.37921 0.52139,2.33087 1.1961,4.60034 1.53346,6.77787 0.33736,2.17753 0.33736,4.263 0.46004,6.44053 0.12268,2.17753 0.36803,4.447 0.27601,6.77788 -0.092,2.33088 -0.52137,4.72302 -1.16543,6.86988 -0.64406,2.14686 -1.50278,4.04831 -2.05483,5.39776 -0.55205,1.34945 -0.7974,2.14684 -1.65614,2.42286 -0.85875,0.27601 -2.33084,0.0307 -3.68029,-0.92009 -1.34946,-0.95076 -2.5762,-2.60686 -3.6803,-4.38569 -1.1041,-1.77883 -2.0855,-3.68028 -3.15893,-5.85782 -1.07343,-2.17753 -2.23883,-4.63101 -3.28159,-6.96189 -1.04276,-2.33088 -1.96282,-4.53901 -3.03625,-6.71654 -1.07343,-2.17753 -2.30017,-4.32433 -3.55762,-6.22583 -1.25745,-1.90151 -2.54553,-3.55761 -3.34293,-5.09108 -0.7974,-1.53347 -1.10409,-2.94422 -0.33734,-3.74162 0.76675,-0.7974 2.60686,-0.98141 3.89497,-1.22677 1.28811,-0.24535 2.02416,-0.55204 3.15893,-0.70539 1.13478,-0.15334 2.66816,-0.15335 4.23233,-0.27603 1.56416,-0.12268 3.15888,-0.36802 4.44701,-0.58271 1.28814,-0.21469 2.26951,-0.39869 3.03625,-0.58271 0.76675,-0.18402 1.31877,-0.36802 1.96283,-0.61338 0.64407,-0.24536 1.38011,-0.55204 2.05484,-0.61338 0.67473,-0.0613 1.28809,0.12267 1.84015,0.15334 0.55205,0.0307 1.04274,-0.092 1.16542,0.30671 0.12268,0.39871 -0.12267,1.31876 -0.0613,2.97489 z" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 68.019355,107.07378 c 0.574093,-2.69126 1.148186,-5.38252 1.465902,-8.200299 0.317717,-2.817778 0.379054,-5.761958 0.563072,-9.288951 0.184018,-3.526992 0.490703,-7.636575 0.52137,-11.592933 0.03067,-3.956358 -0.214682,-7.759256 -0.306688,-9.783422 -0.09201,-2.024166 -0.03067,-2.269514 0.644063,-2.392191 0.674734,-0.122676 1.962813,-0.122676 3.189591,-0.245355 1.226777,-0.122679 2.392182,-0.368028 3.250923,-0.552045 0.858741,-0.184016 1.410776,-0.30669 1.748138,0.306707 0.337361,0.613397 0.460034,1.962811 0.705391,3.097579 0.245356,1.134767 0.613379,2.054824 1.472129,2.238833 0.85875,0.18401 2.208166,-0.368024 3.220254,-0.828065 1.012088,-0.46004 1.686797,-0.828063 2.269515,-1.012077 0.582718,-0.184015 1.073414,-0.184015 1.533456,0.03067 0.460042,0.214688 0.889403,0.644048 1.349445,1.472127 0.460042,0.828078 0.950738,2.054819 1.134751,2.882891 0.184013,0.828072 0.06134,1.257432 -0.674735,1.901492 -0.736074,0.64406 -2.085488,1.502779 -3.281595,2.330854 -1.196107,0.828075 -2.238837,1.625456 -3.03624,2.514871 -0.797403,0.889415 -1.349437,1.87081 -1.870817,3.342948 -0.521379,1.472137 -1.012077,3.434925 -1.410778,5.520449 -0.398702,2.085523 -0.705387,4.293657 -0.766724,6.317839 -0.06134,2.024181 0.122675,3.864294 0.347359,5.361935 0.224685,1.49764 0.490027,2.65271 0.745383,3.62898 0.255356,0.97627 0.500705,1.77365 0.746059,2.57105" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 87.591076,68.637546 c 0.06134,1.165426 0.122677,2.330855 0.429374,3.220266 0.306698,0.889411 0.858732,1.502782 1.349442,1.962822 0.490711,0.46004 0.92007,0.766725 1.349437,1.073416" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 70.109664,87.775091 c -1.717472,0 -3.434943,0 -4.35502,0.552056 -0.920076,0.552056 -1.04275,1.656122 -1.042749,2.453525 10e-7,0.797402 0.122676,1.288101 0.337363,1.809481 0.214687,0.521381 0.521373,1.073415 1.318784,1.349437 0.79741,0.276023 2.085489,0.276023 3.373592,0.276023" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 69.67455,95.664345 c -1.388418,0.19181 -2.776839,0.383621 -3.685736,0.724884 -0.908897,0.341263 -1.338258,0.831961 -1.522271,1.445351 -0.184013,0.61339 -0.122676,1.349434 0.153351,2.116171 0.276028,0.766739 0.766722,1.564119 1.533461,1.901479 0.766738,0.33736 1.80947,0.21469 2.852221,0.092" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 94.775926,99.157095 c -0.0028,-2.199205 -0.0055,-4.398409 0.238441,-5.988729 0.243975,-1.590321 0.734671,-2.571712 1.624089,-3.277107 0.889418,-0.705394 2.177496,-1.134753 3.233685,-0.901121 1.056189,0.233632 1.880429,1.130233 2.704679,2.026847" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 114.82527,90.903344 c -0.67472,-2.637546 -1.34944,-5.275092 -1.87082,-7.17659 -0.52137,-1.901498 -0.88939,-3.066903 -1.34944,-4.078994 -0.46004,-1.012092 -1.01208,-1.870812 -1.95831,-2.805027 -0.94624,-0.934214 -2.2866,-1.943855 -2.30986,-4.143464 -0.0233,-2.199609 1.27058,-5.588975 1.16384,-7.035752 -0.10674,-1.446777 -1.61409,-0.950868 -2.83302,-1.25788 -1.21894,-0.307011 -2.14944,-1.416931 -2.84462,-0.07868 -0.69519,1.338247 -1.15502,5.124577 -1.53829,7.017771 -0.38327,1.893193 -0.68996,1.893193 -0.46085,-0.01583 0.22912,-1.909026 0.99399,-5.72685 0.65041,-7.044366 -0.34358,-1.317516 -1.795584,-0.134563 -3.079486,-0.239296 -1.283901,-0.104732 -2.399549,-1.497136 -2.884049,-0.179621 -0.484499,1.317515 -0.337788,5.34487 -0.509789,7.603948 -0.172001,2.259078 -0.662697,2.749775 -1.276087,2.412402 -0.61339,-0.337372 -1.349436,-1.502778 -2.116172,-3.312282 -0.766736,-1.809503 -1.564118,-4.262984 -2.044506,-5.688606 -0.480388,-1.425621 -0.643758,-1.823311 -1.319197,-1.757579 -0.675439,0.06573 -1.862869,0.594878 -3.123727,0.777902 -1.260858,0.183024 -2.594995,0.01991 -2.839648,0.996945 -0.244653,0.977039 0.600223,3.094162 1.445116,5.211327" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 85.500767,78.47513 c 0.267402,1.014486 0.534804,2.02897 0.269798,2.90425 -0.265005,0.875281 -1.062386,1.611325 -2.043459,2.927714 -0.981072,1.316389 -2.145773,3.213032 -3.310494,5.109709" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 84.27881,128.62639 c 1.840147,0.30669 3.680297,0.61339 5.796492,1.01209 2.116195,0.39871 4.50834,0.8894 6.348501,1.96284 1.84016,1.07343 3.128239,2.72953 4.631047,4.66171 1.5028,1.93218 3.22024,4.14031 4.75371,6.68588 1.53347,2.54557 2.88289,5.42841 3.74163,7.17656 0.85874,1.74815 1.22676,2.36152 1.71747,3.52696 0.49072,1.16545 1.10408,2.88288 1.65614,4.20167 0.55205,1.31878 1.04274,2.23884 1.65614,3.61897 0.61339,1.38013 1.34943,3.22024 2.05483,4.60036 0.70539,1.38012 1.3801,2.30017 2.05482,3.06691 0.67473,0.76673 1.34944,1.38011 2.02417,1.80948 0.67473,0.42937 1.34944,0.67472 2.11617,0.79739 0.76674,0.12268 1.62546,0.12268 2.3922,0 0.76673,-0.12268 1.44144,-0.36803 2.0855,-1.01209 0.64405,-0.64406 1.25743,-1.68679 1.80948,-3.06692 0.55205,-1.38013 1.04274,-3.09757 1.41078,-4.69238 0.36803,-1.59481 0.61338,-3.0669 0.98141,-4.53903 0.36803,-1.47214 0.85873,-2.94423 1.04274,-4.04833 0.18401,-1.10409 0.0613,-1.84013 -0.12267,-2.42285 -0.18402,-0.58272 -0.42937,-1.01208 -0.70539,-1.28811 -0.27603,-0.27602 -0.58272,-0.39869 -0.7974,-0.58271 -0.21469,-0.18402 -0.33736,-0.42936 -0.27602,-0.61338 0.0613,-0.18402 0.30669,-0.30669 0.58271,-0.21468 0.27603,0.092 0.58271,0.39869 0.88941,0.7974 0.30669,0.3987 0.61338,0.8894 0.79739,0.92007 0.18402,0.0307 0.24535,-0.3987 0.21468,-0.73606 -0.0307,-0.33737 -0.15334,-0.58272 -0.36803,-1.04276 -0.21469,-0.46004 -0.52137,-1.13475 -0.82806,-1.80947" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 131.95127,147.44827 c -0.0655,-0.93753 -0.13108,-1.87506 0.14284,-1.57708 0.27393,0.29798 0.8873,1.83141 1.286,2.16876 0.3987,0.33735 0.58271,-0.52136 0.64405,0.0614 0.0613,0.58273 0,2.60686 -0.12268,4.14032 -0.12268,1.53347 -0.30669,2.5762 -0.4907,3.40428 -0.18402,0.82807 -0.36803,1.44144 -0.15334,1.62545 0.21469,0.18401 0.82806,-0.0613 1.22676,-0.49071 0.3987,-0.42937 0.58271,-1.04274 0.61338,-0.88938 0.0307,0.15335 -0.092,1.0734 -0.49071,1.62545 -0.39871,0.55205 -1.07341,0.73606 -1.62546,1.10409 -0.55205,0.36804 -0.98141,0.92007 -1.16542,1.53346 -0.18402,0.61339 -0.12268,1.2881 -0.12268,1.96283 0,0.67473 -0.0613,1.34943 0.18402,1.41076 0.24535,0.0613 0.79739,-0.4907 1.22676,-1.07342 0.42937,-0.58272 0.73606,-1.19609 1.04275,-1.56412 0.3067,-0.36803 0.61338,-0.4907 0.36802,0.12269 -0.24536,0.6134 -1.04274,1.96282 -1.71747,2.85222 -0.67472,0.88941 -1.22676,1.31877 -1.62546,1.9935 -0.3987,0.67473 -0.64405,1.59479 -0.27601,2.02416 0.36804,0.42936 1.34943,0.36803 1.96281,-0.15336 0.61339,-0.52138 0.85874,-1.50278 1.1961,-1.99349 0.33737,-0.4907 0.76673,-0.4907 0.82806,-0.30668 0.0613,0.18402 -0.24534,0.55204 -0.4907,1.1961 -0.24536,0.64406 -0.42937,1.56412 -1.16544,2.08549 -0.73607,0.52138 -2.02415,0.64405 -2.91356,1.1041 -0.88941,0.46005 -1.38011,1.25743 -2.0855,1.80948 -0.7054,0.55204 -1.62546,0.85873 -2.82157,1.07341 -1.19611,0.21469 -2.6682,0.33736 -3.74163,0.24535 -1.07343,-0.092 -1.74813,-0.39869 -2.54554,-1.16543 -0.79741,-0.76674 -1.71747,-1.99348 -2.69889,-3.52696 -0.98142,-1.53348 -2.02415,-3.37359 -2.88289,-5.09108 -0.85875,-1.71748 -1.53346,-3.31225 -2.30019,-5.18309 -0.76674,-1.87084 -1.62546,-4.01763 -2.45353,-6.01115 -0.82808,-1.99351 -1.62546,-3.83362 -2.63755,-5.73513 -1.0121,-1.9015 -2.23884,-3.86429 -3.37361,-5.48977 -1.13477,-1.62548 -2.17749,-2.91356 -2.69887,-2.82153 -0.521376,0.092 -0.521376,1.56411 -0.245348,3.40428 0.276028,1.84017 0.828068,4.04831 1.502788,6.07249 0.67473,2.02418 1.47211,3.86429 2.42287,5.8578 0.95075,1.99352 2.05482,4.14032 3.22026,6.22584 1.16544,2.08552 2.39218,4.10965 3.43494,5.94982 1.04276,1.84016 1.90148,3.49626 2.51486,4.84571 0.61339,1.34945 0.98141,2.39218 1.13476,3.64963 0.15334,1.25745 0.092,2.72954 -0.27603,3.64962 -0.36804,0.92008 -1.04275,1.2881 -1.87082,1.50279 -0.82808,0.21468 -1.80947,0.27602 -2.5762,0.30669 -0.76674,0.0307 -1.31877,0.0307 -2.79092,-0.3067 -1.47214,-0.33737 -3.86428,-1.01208 -5.70444,-1.5948 -1.840165,-0.58272 -3.128245,-1.07341 -4.232344,-1.19609 -1.104099,-0.12267 -2.024154,0.12268 -2.484191,0.092 -0.460037,-0.0307 -0.460037,-0.33736 -0.092,-0.52138 0.368035,-0.18401 1.104083,-0.24535 0.981398,-0.58272 -0.122685,-0.33736 -1.104077,-0.95073 -2.054831,-1.31877 -0.950754,-0.36803 -1.87081,-0.4907 -2.668214,-0.55204 -0.797404,-0.0613 -1.472113,-0.0613 -1.993488,-0.092 -0.521376,-0.0307 -0.889406,-0.092 -1.04275,-0.27602 -0.153344,-0.18402 -0.09201,-0.4907 0.15335,-0.58271 0.245357,-0.092 0.674714,0.0307 1.104084,0.12268 0.429371,0.092 0.858736,0.15334 0.521365,-0.15335 -0.337371,-0.3067 -1.441441,-0.98141 -2.698889,-1.38011 -1.257448,-0.3987 -2.668201,-0.52137 -3.557611,-0.88941 -0.88941,-0.36804 -1.257432,-0.98141 -1.502786,-1.56413 -0.245354,-0.58272 -0.368027,-1.13475 -1.1041,-1.74814 -0.736072,-0.61339 -2.085489,-1.2881 -3.005569,-1.77881 -0.92008,-0.49071 -1.410775,-0.79739 -1.717468,-1.19609 -0.306694,-0.39871 -0.429367,-0.8894 -0.184009,-0.95074 0.245358,-0.0613 0.858732,0.30669 1.441452,0.64405 0.582721,0.33737 1.134751,0.64405 1.809482,0.98141 0.67473,0.33737 1.472109,0.70539 2.024158,1.13476 0.552049,0.42938 0.858732,0.92007 1.104088,1.34945 0.245356,0.42937 0.429366,0.79739 0.644053,1.07341 0.214687,0.27603 0.460035,0.46004 0.82807,0.67472 0.368035,0.21469 0.858731,0.46004 1.533461,0.70539 0.67473,0.24536 1.533449,0.49071 2.300183,0.70539 0.766734,0.21469 1.441442,0.3987 1.99349,0.67473 0.552047,0.27602 0.981409,0.64405 1.380112,0.8894 0.398703,0.24536 0.766725,0.36803 1.134755,0.46004 0.36803,0.092 0.73606,0.15334 1.13476,0.21468 0.398699,0.0613 0.828065,0.12268 1.288107,0.21469 0.460042,0.092 0.950739,0.21468 1.44145,0.46004 0.49071,0.24535 0.981407,0.61337 1.472119,0.92007 0.490712,0.30669 0.981409,0.55204 1.44145,0.79739 0.460041,0.24536 0.889402,0.49071 1.349444,0.73606 0.460041,0.24536 0.950741,0.49071 1.104081,0.42937 0.15335,-0.0613 -0.0307,-0.42937 -0.15334,-0.76673 -0.12268,-0.33735 -0.18402,-0.64405 0.092,-0.4907 0.27603,0.15336 0.8894,0.76673 1.34944,1.1961 0.46004,0.42937 0.76672,0.67471 1.2881,0.85873 0.52139,0.18402 1.25744,0.30669 2.26953,0.52138 1.0121,0.21469 2.30017,0.52137 3.22025,0.67471 0.92008,0.15335 1.47211,0.15335 1.9935,0.0307 0.52138,-0.12268 1.01207,-0.36802 1.44144,-0.76673 0.42938,-0.3987 0.7974,-0.95074 0.85874,-1.87082 0.0613,-0.92009 -0.18402,-2.20817 -0.52138,-3.37361 -0.33737,-1.16543 -0.76673,-2.20817 -1.47213,-3.52696 -0.7054,-1.31878 -1.68679,-2.91355 -2.60687,-4.41635 -0.92009,-1.5028 -1.7788,-2.91355 -2.63755,-4.47769 -0.85874,-1.56415 -1.71746,-3.28159 -2.60688,-5.02975 -0.88941,-1.74816 -1.80947,-3.52693 -2.48419,-5.0604 -0.67473,-1.53347 -1.104088,-2.82155 -1.502791,-4.32435 -0.398703,-1.50281 -0.766726,-3.22025 -1.04275,-4.96841 -0.276024,-1.74816 -0.460035,-3.52693 -0.766732,-4.81504 -0.306698,-1.28812 -0.736056,-2.0855 -1.717483,-2.72955 -0.981427,-0.64406 -2.514855,-1.13475 -4.140337,-1.50279 -1.625481,-0.36803 -3.342917,-0.61338 -4.631028,-0.76672 -1.28811,-0.15335 -2.146835,-0.21469 -3.005569,-0.27603" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 509.72751,590.79669 c -0.2348,0.0601 -0.33929,0.29178 -0.45969,0.47724 -0.13012,0.21811 -0.30437,0.41199 -0.40644,0.64477 -0.0909,0.26644 0.0873,0.57488 0.35994,0.63737 0.10282,0.0221 0.17223,0.1189 0.28217,0.13009 0.26927,0.0717 0.55518,-0.12161 0.6195,-0.38709 0.0869,-0.32745 0.18141,-0.65492 0.23806,-0.98901 0.0184,-0.27185 -0.21212,-0.52984 -0.48696,-0.52938 -0.0486,-0.005 -0.098,0.0123 -0.14658,0.016 z" fill="#414141" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 498.94184,551.35598 c -0.2262,0.0416 -0.39706,0.24822 -0.41339,0.47507 -0.0249,0.19995 -0.0356,0.40205 -0.0459,0.60269 0.0127,0.2604 0.25572,0.48052 0.51651,0.46379 0.13869,0.003 0.25069,-0.0931 0.38587,-0.10975 0.26007,-0.0525 0.46082,-0.3156 0.41821,-0.58199 -0.0263,-0.19806 -0.16933,-0.35059 -0.26635,-0.51748 -0.088,-0.1463 -0.20896,-0.289 -0.38396,-0.32614 -0.0695,-0.0169 -0.14036,-0.0159 -0.21097,-0.006 z" fill="#414141" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 508.15257,607.13516 c -0.23218,0.01 -0.39236,0.19501 -0.55473,0.33728 -0.19127,0.18383 -0.38312,0.37059 -0.54288,0.58291 -0.14419,0.21026 -0.0961,0.52515 0.11185,0.6756 0.0723,0.0715 0.18959,0.0735 0.24671,0.16246 0.13136,0.16153 0.35358,0.25062 0.55732,0.18876 0.179,-0.0499 0.30451,-0.20448 0.36414,-0.37475 0.13326,-0.32667 0.26326,-0.65796 0.33953,-1.00304 0.0387,-0.24992 -0.13985,-0.50716 -0.38793,-0.55711 -0.0434,-0.008 -0.0896,-0.0124 -0.13401,-0.0121 z" fill="#414141" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 295.89242,245.7203 c -4.7077,0.44599 -9.27196,1.86263 -13.97794,2.33438 -4.76019,0.6172 -9.60712,0.54859 -14.3557,1.27435 -1.55206,0.27588 -1.57483,2.16506 -1.61723,3.39846 0.0346,8.16793 0.72145,16.31946 0.94011,24.48397 0.40717,13.88083 0.26873,27.78234 -0.57934,41.64596 -0.859,14.45349 -1.47414,28.92006 -2.30272,43.37491 -0.60654,10.92392 -2.09192,21.78176 -4.3738,32.47905 -0.52305,2.8253 -1.291,5.66138 -1.68927,8.4769 0.62717,0.15678 1.12732,-0.6912 1.72806,-0.82899 5.29529,-2.91365 11.30866,-4.18025 17.24505,-4.95803 5.31414,-0.36258 10.68117,-0.0443 15.87124,1.18703 5.00024,1.01938 9.89461,2.47444 14.76396,3.97678 0.57687,-0.032 -0.0799,-0.90829 -0.0648,-1.25723 -3.84023,-12.51823 -6.7106,-25.49646 -6.4956,-38.65218 -0.15554,-9.62231 1.35434,-19.16446 3.16416,-28.58629 1.69293,-8.12507 3.52974,-16.31022 6.88415,-23.93399 2.62681,-6.00433 7.32522,-10.76325 12.50786,-14.65441 5.10884,-3.8732 10.64173,-7.18323 15.70114,-11.12885 0.60725,-0.61928 1.571,-1.08297 1.94247,-1.8457 -2.18355,-1.87027 -4.50592,-3.64707 -6.23279,-5.9867 -3.29006,-3.8891 -3.87126,-9.15758 -4.15063,-14.05177 -0.18686,-0.74123 0.11831,-1.77472 -0.43138,-2.36003 -3.04448,0.26818 -5.73729,1.97466 -8.50565,3.14641 -3.6864,1.62291 -7.38838,3.55145 -11.37517,4.19603 -1.83786,0.0737 -3.95103,0.42555 -5.45314,-0.91737 -3.04718,-2.56158 -3.61213,-6.7901 -4.34829,-10.46896 -0.65372,-3.06439 -0.90489,-6.30532 -2.28947,-9.15602 -0.47676,-0.93909 -1.51359,-1.27061 -2.50526,-1.18771 z" fill="#a96b6c" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 260.81433,332.22176 c -3.87059,0.24183 -7.96452,0.079 -11.5547,1.76052 -2.67486,1.33861 -4.00932,4.34077 -4.08009,7.2218 -0.32338,3.94469 0.19374,8.21966 2.78361,11.3798 2.27435,2.62647 6.06189,2.67395 9.26006,2.94616 2.00944,0.009 4.0669,0.29387 6.0546,0.0262 0.51306,-0.66742 0.14036,-1.71561 0.33559,-2.50328 0.40042,-6.94677 0.56889,-13.90825 1.08864,-20.84712 -1.1811,-0.22234 -2.62706,0.0486 -3.88771,0.0159 z" fill="#a96b6c" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 261.30599,362.31868 c -4.53358,0.74946 -9.26176,1.17443 -13.44331,3.21755 -2.28035,1.08648 -3.83142,3.38594 -4.02098,5.89854 -0.38204,4.05809 1.13073,8.24519 3.83005,11.2664 2.4094,2.52734 6.16504,2.85488 9.44747,2.47701 1.11057,-0.1609 2.37997,-0.008 3.39784,-0.45685 1.32394,-7.23056 2.11565,-14.5654 2.53759,-21.9027 0.32551,-1.31163 -1.07057,-0.4199 -1.74866,-0.49995 z" fill="#814b4c" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 332.04932,259.97656 c -1.24377,0.22756 -0.55331,1.9473 -0.62061,2.78418 0.31066,5.06261 1.1917,10.46251 4.78898,14.32048 1.63621,1.70781 3.29958,3.60134 5.4493,4.64192 1.35114,0.0442 1.43191,-1.81124 1.521,-2.80859 -0.43744,-4.63102 -2.5245,-8.93598 -4.60059,-13.03711 -1.37147,-2.52848 -3.47523,-5.48206 -6.53808,-5.90088 z" fill="#714243" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 262.53756,362.12188 c -4.47585,0.47537 -9.00725,1.10266 -13.25342,2.65614 -2.5548,0.91093 -4.92239,2.88703 -5.42414,5.67308 -0.77444,3.89341 0.5751,7.97963 2.8008,11.17319 0.87456,1.0915 1.86602,2.33541 3.24793,2.73969 0.10756,0.46254 0.81982,0.26337 1.18427,0.52757 1.95438,0.81844 4.13691,0.27381 6.18753,0.34837 1.12054,-0.0938 2.33245,0.0208 3.37705,-0.38463 1.19075,-7.17516 2.11569,-14.41108 2.49783,-21.67654 -0.0219,-0.46605 0.15081,-1.27406 -0.61785,-1.05687 z" fill="#a96b6c" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 84.640599,108.84686 c 0.363802,2.0416 0.727597,4.08316 0.980998,5.57439 0.253402,1.49122 0.396387,2.43197 0.516387,3.25735 0.12,0.82539 0.216997,1.53529 0.327864,2.51391 0.110867,0.97861 0.235588,2.22582 0.21716,3.69137 -0.01843,1.46556 -0.180006,3.14932 -0.267617,4.01752 -0.08761,0.8682 -0.101265,0.92086 -0.114891,0.97341" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 86.101713,130.35988 c -0.200728,0.63726 -0.401461,1.27454 -0.673328,1.90499 -0.271867,0.63046 -0.614859,1.25408 -0.973449,1.95567 -0.358591,0.70159 -0.732761,1.48111 -0.873075,2.12033 -0.140314,0.63922 -0.04677,1.13812 0.04677,1.63702" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 73.104897,142.79542 c -1.512298,-0.0156 -3.024599,-0.0312 -4.419982,-0.28843 -1.395383,-0.25725 -2.673796,-0.75615 -4.139341,-1.44994 -1.465545,-0.6938 -3.118128,-1.58245 -4.770744,-2.47112" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 126.92977,126.52722 c 0.70504,-0.23008 1.41008,-0.46015 2.19221,-0.8252 0.78213,-0.36504 1.64135,-0.86505 2.50057,-1.36506" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 107.95016,124.13333 c 0.28063,0.38977 0.56127,0.77954 0.6704,1.26286 0.10914,0.48331 0.0468,1.06016 0.0468,1.65262 10e-6,0.59245 0.0624,1.20047 0.12473,1.80851" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 86.452603,120.12083 c 0.440971,-1.05833 0.881942,-2.11666 1.289846,-3.18603 0.407904,-1.06937 0.782724,-2.14973 1.223702,-3.02066 0.440979,-0.87093 0.948084,-1.53237 1.466231,-1.97335 0.518148,-0.44097 1.047303,-0.66145 1.587499,-0.82682 0.540196,-0.16537 1.091402,-0.27561 1.664671,-0.28663 0.57327,-0.011 1.168572,0.0772 1.86311,0.28664 0.694539,0.20946 1.488276,0.54018 2.138716,0.92604 0.650439,0.38585 1.157545,0.82682 1.532372,1.37804 0.374827,0.55122 0.617357,1.21267 0.760674,1.97336 0.143316,0.76068 0.187416,1.62056 0.176396,2.55763 -0.011,0.93708 -0.0772,1.9513 -0.10198,2.78364 -0.0248,0.83234 -0.008,1.48275 -0.0138,2.11115 -0.006,0.62839 -0.0331,1.23471 -0.0303,2.49426 0.003,1.25955 0.0358,3.1722 0.19629,4.38929 0.16046,1.21709 0.44831,1.73849 0.73617,2.25991" fill="none" stroke="#000000" strokeWidth="0.3" />
        <path d="m 89.099114,115.47813 c -0.04615,0.43732 -0.0923,0.87465 0.0094,1.2804 0.101654,0.40576 0.351097,0.77992 0.740872,1.08394 0.389776,0.30403 0.919848,0.53788 1.457733,0.71717 0.537884,0.1793 1.083551,0.30402 1.746167,0.41316 0.662616,0.10914 1.44213,0.20268 2.190493,0.25725 0.748362,0.0546 1.46552,0.0702 2.073559,0.0312 0.608038,-0.039 1.106939,-0.13252 1.481118,-0.24946 0.374179,-0.11693 0.623628,-0.25724 0.773469,-0.41504 0.149842,-0.1578 0.200072,-0.33308 0.250302,-0.50836" fill="none" stroke="#000000" strokeWidth="0.3" transform="translate(0.23386084,-2.245064)" />
        <path d="m 380.87344,497.09607 c -2.07112,-5.20884 -2.64979,-13.73393 -2.2919,-33.76435 0.43213,-24.18517 0.43466,-24.00642 -0.39335,-27.83233 -1.5147,-6.99888 -4.99886,-11.03396 -12.29241,-14.23613 -7.05776,-3.09863 -12.38835,-3.57634 -18.43477,-1.65203 -3.14128,0.99972 -4.99256,2.10193 -7.0989,4.22652 -2.64228,2.66516 -4.73552,6.39888 -7.22602,12.88907 -0.80215,2.09039 -2.50263,6.42584 -3.77883,9.63433 l -2.32037,5.83364 -0.13289,-0.97228 c -1.28213,-9.38091 -2.76094,-18.57243 -5.14787,-31.99658 -0.52728,-2.96543 -0.93732,-5.41456 -0.9112,-5.44251 0.0261,-0.028 1.06272,1.69648 2.30355,3.83208 4.1209,7.09253 5.8753,8.8096 7.80121,7.63523 1.23525,-0.75322 1.91971,-2.08244 4.83188,-9.38356 4.1844,-10.4907 7.71961,-16.99078 17.9789,-33.05724 4.1971,-6.57281 4.73632,-8.23717 4.84738,-10.44813 0.18004,-3.58411 0.0638,-8.67081 0.18177,-11.35229 0.0889,-2.02078 -0.28643,-1.46339 0.006,-2.50637 0.51491,-1.8349 0.0617,-0.62093 0.0627,-0.8397 0.004,-0.85451 0.62808,-5.24726 0.88611,-6.62882 0.54463,-2.91602 1.73531,-6.35303 2.03364,-5.87031 0.1184,0.19157 1.02821,0.19534 5.15182,0.0213 20.92437,-0.883 29.81961,-1.08848 47.08087,-1.08759 16.67355,8.6e-4 31.94638,0.27412 49.40909,0.88403 17.19956,0.60072 24.82891,1.16517 26.58914,1.96718 0.43652,0.1989 0.41682,0.22057 -0.86409,0.95053 -6.14211,3.50023 -8.18559,8.87962 -7.33153,19.29998 0.1908,2.32801 1.03273,8.48684 1.48117,10.835 0.13903,0.728 0.21803,1.35838 0.17555,1.40086 -0.0425,0.0425 -1.36928,-0.0195 -2.94847,-0.13781 -13.75608,-1.0302 -20.17815,-1.39212 -27.5316,-1.55154 -18.38822,-0.39864 -34.60386,2.74377 -42.94375,8.32204 -2.93299,1.96177 -5.02204,4.13257 -7.01367,7.28813 -2.54284,4.0289 -5.3318,11.10528 -8.35057,21.18777 -0.58174,1.94297 -1.46252,4.84054 -1.95728,6.43904 -0.49476,1.59851 -1.134,4.06454 -1.42053,5.48008 -0.28653,1.41554 -0.88375,4.15327 -1.32716,6.08385 -3.73673,16.26954 -5.86951,31.64742 -8.14331,58.71525 -0.25319,3.01405 -0.52545,5.67896 -0.60503,5.92202 l -0.14467,0.44195 z" fill="#a96b6c" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 128.12206,100.30291 c -0.0946,-0.26941 -0.42507,-2.71368 -0.48372,-3.578071 -0.15777,-2.325267 0.46923,-3.746058 2.00372,-4.540401 0.36875,-0.190888 0.44831,-0.203311 0.58631,-0.09155 0.22501,0.182224 0.48039,0.708758 0.63593,1.311127 0.19751,0.764953 0.16863,3.497167 -0.046,4.349811 -0.32486,1.290568 -0.89936,2.162452 -1.64177,2.491554 -0.4448,0.19718 -0.99488,0.22719 -1.05448,0.0575 z" fill="#714243" stroke="none" strokeWidth="0.3" />
        <path d="m 354.32617,418.92139 c -6.50219,-0.0546 -13.34078,3.02985 -16.51709,8.90527 -1.15917,3.44506 0.0559,7.73681 3.35059,9.56396 5.58584,3.35486 12.28624,4.03402 18.63082,4.75588 4.42986,0.29101 8.93615,0.24835 13.32399,-0.44688 2.15563,-0.47305 5.12756,-1.70993 4.98171,-4.36515 -0.60996,-4.96633 -2.87693,-9.94234 -7.18042,-12.7453 -4.88983,-3.23139 -10.63551,-5.72199 -16.5896,-5.66778 z" fill="#714243" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 334.03407,238.89851 c -5.28312,0.91868 -10.37031,2.89555 -15.75696,3.2922 -2.49802,0.34267 -6.24544,0.28179 -6.91811,3.42601 -0.50319,5.01182 1.96682,9.74008 3.49157,14.38684 0.72925,1.42006 0.97558,3.54288 2.00508,4.57798 4.88032,-1.69298 9.36688,-5.20719 14.70354,-5.12445 5.03974,0.41377 7.25721,5.70991 9.16063,9.65366 1.74644,4.09781 4.02045,8.76313 2.16275,13.22442 0.0104,1.03609 -1.47169,0.66646 -1.93281,1.52055 -5.38925,4.5672 -11.64895,8.05886 -17.08381,12.51731 -0.15242,2.71612 1.19169,5.37997 0.87215,8.14831 0.28407,3.21824 -1.47101,5.99473 -3.42707,8.37604 -6.38972,8.01528 -12.05803,16.6115 -17.05969,25.54712 -3.19232,15.03895 -3.47579,30.71598 -0.42715,45.80908 1.29158,6.20854 2.59366,12.48714 4.84656,18.42232 1.26333,1.51276 3.64374,1.52845 5.19558,2.72554 7.37345,4.01544 9.34756,13.04841 14.94316,18.79219 1.11057,1.64208 2.63674,-0.16545 3.09428,-1.32651 3.22018,-6.83494 5.5304,-14.09257 9.33079,-20.66214 4.97472,-9.50216 11.23411,-18.27545 16.52832,-27.57995 0.94214,-9.99859 -0.87921,-20.6116 3.27759,-30.06625 3.01564,-5.77474 10.04281,-9.67658 16.54696,-8.42411 4.19432,1.02847 7.10889,4.49245 10.17087,7.2658 14.99755,-0.12925 30.01232,0.28236 44.99934,-0.2776 1.42597,-0.0666 -0.0559,-1.94881 0.0596,-2.72576 -3.26755,-12.2665 -5.96062,-24.73245 -10.25603,-36.69475 -2.25048,-6.57096 -7.12271,-11.6533 -11.84818,-16.52448 -3.05331,-3.19365 -5.55406,-7.35932 -5.05661,-11.93381 -0.60664,-9.54305 4.18413,-18.44698 3.96211,-27.94383 -0.82582,-2.82829 -4.16828,-2.89066 -6.57344,-3.12324 -3.95109,-0.13866 -7.42673,-2.16269 -11.17121,-3.09433 -2.96591,0.19317 -3.64843,3.88318 -4.39732,6.1644 -2.43095,8.91044 -3.07196,18.23333 -5.63545,27.09102 -0.19884,1.22393 -1.72713,0.8404 -1.4073,-0.33352 0.57877,-10.32545 3.7098,-20.57379 2.63783,-30.97805 -0.0879,-1.90589 -2.22437,-2.4832 -3.76893,-1.90035 -3.72745,1.02443 -7.76594,1.79931 -11.41729,0.0124 -1.75735,-0.40804 -3.72125,-2.05512 -5.53256,-1.26091 -2.05026,2.33286 -1.62261,5.83605 -2.04571,8.72745 -0.71207,9.33873 -0.2322,18.8391 -2.03396,28.049 -0.22459,1.97651 -2.10842,3.83224 -4.11973,2.84639 -4.81005,-3.66358 -6.77343,-9.74619 -9.12062,-15.08738 -3.31033,-7.94582 -5.46045,-16.34398 -8.96239,-24.20262 -0.39249,-0.77243 -1.11918,-1.41223 -2.03638,-1.31202 z" fill="#bb4738" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 517.88721,421.00928 c -0.47727,0.30027 -0.51967,1.04873 -0.81793,1.51203 -1.18715,2.66643 -2.2396,5.48224 -2.1844,8.44689 -0.17118,3.85225 0.38707,7.85953 2.26111,11.27496 0.33513,0.48308 0.7672,1.42437 1.49854,1.05835 1.54656,-0.57532 2.8344,-1.83053 3.24097,-3.4563 0.54579,-1.91519 0.28214,-3.94854 0.31616,-5.91406 -0.0714,-3.49758 -0.6403,-7.02807 -1.9419,-10.28564 -0.48164,-1.0357 -1.1762,-2.33945 -2.37255,-2.63623 z" fill="#64261d" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 506.177,389.99951 c -0.46045,0.13218 -0.2451,0.8557 -0.40454,1.21118 -0.44861,3.89444 -1.06635,7.87747 -0.3645,11.77906 0.54418,3.12349 2.87484,5.55705 5.42846,7.24609 0.60193,0.26283 0.99283,-0.54552 1.32276,-0.91821 0.72094,-1.17745 0.36114,-2.66454 0.39107,-3.9683 -0.21261,-3.32539 -0.18677,-6.68692 -0.78066,-9.97392 -0.35644,-2.01098 -1.50862,-4.01687 -3.50469,-4.76231 -0.66651,-0.26926 -1.36066,-0.57903 -2.0879,-0.61359 z" fill="#64261d" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 497.78589,389.14551 c -7.49311,0.02 -14.95425,0.82314 -22.41493,1.43173 -1.08553,0.12579 -2.19137,0.15567 -3.26159,0.37417 -0.52019,0.53195 0.47705,0.83995 0.79921,1.12084 6.17738,3.84771 11.02923,9.60515 14.35551,16.03587 1.39003,2.53148 2.49329,5.19849 3.67243,7.82962 0.60825,0.40377 1.40268,-0.11621 2.06194,-0.15228 5.37281,-1.26599 10.8035,-2.38593 16.0289,-4.18935 0.44396,-0.27584 1.3652,-0.28586 1.32567,-0.92546 -2.16397,-1.76264 -4.48552,-3.72955 -5.23316,-6.54443 -1.04556,-3.8485 -0.43805,-7.91204 -0.0291,-11.82589 0.0274,-0.87366 0.36826,-1.80981 0.0967,-2.65849 -0.83844,-0.48534 -1.92387,-0.29243 -2.86035,-0.42012 -1.51277,-0.0644 -3.02725,-0.0792 -4.54126,-0.0762 z" fill="#bb4738" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 507.95239,419.91308 c -4.91377,0.0735 -9.8338,0.0951 -14.7409,0.35611 -1.00982,0.027 -0.17657,1.17933 -0.0929,1.72396 2.45827,7.31105 4.30861,14.84185 5.08059,22.5276 0.19895,0.68527 1.14802,0.35524 1.67114,0.45544 5.18981,-0.0866 10.4048,-0.0398 15.56396,-0.6798 0.60823,-0.18984 1.52152,-0.0505 1.896,-0.65821 0.046,-0.5177 -0.6153,-0.74406 -0.7251,-1.23681 -1.85923,-3.55815 -2.45539,-7.70534 -2.31567,-11.65674 0.12067,-3.4439 1.48593,-6.70572 2.89014,-9.80322 0.0195,-0.70149 -0.99626,-0.57474 -1.45933,-0.70232 -2.57835,-0.27855 -5.17623,-0.34365 -7.76797,-0.32601 z" fill="#bb4738" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 390.81529,432.66269 c -2.49965,10.45215 -4.12308,21.12373 -5.50857,31.78499 -1.166,10.04833 -2.14651,20.1227 -2.9484,30.20562 0.46699,0.20694 0.8962,-0.65932 1.32169,-0.86938 3.02407,-2.1764 6.88346,-2.62574 10.44212,-3.40014 5.48187,-0.93063 10.83993,-2.45892 16.29466,-3.49968 0.71071,-0.35599 0.0856,-1.38321 0.2024,-1.99151 -0.34051,-2.96521 -0.22892,-5.93386 -0.22519,-8.90615 -0.0338,-2.46167 -1.22153,-4.67846 -2.62506,-6.62636 -5.06437,-9.11429 -10.54807,-18.06412 -14.49604,-27.73668 -1.17966,-2.87369 -1.86778,-5.92302 -2.36473,-8.96451 z" fill="#63251e" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 280.12305,398.04199 c -6.83537,0.29144 -13.75296,1.75968 -19.85266,4.92999 -7.71768,4.32787 -12.8304,11.85165 -17.96824,18.80689 -2.31897,3.42461 -5.15365,6.60187 -6.4162,10.61755 -7.42234,17.93564 -13.79421,36.72961 -14.51833,56.29675 -0.51579,11.81726 0.92989,23.801 4.97564,34.94159 9.51668,4.87435 18.79103,10.51058 29.08887,13.61573 6.67656,1.88739 13.69237,2.08037 20.58398,2.02929 9.08271,-1.2869 17.09405,-6.0791 25.00603,-10.40843 4.76522,-2.65577 9.57519,-5.31715 14.32796,-7.94606 -0.13955,-3.27139 0.0575,-6.62189 1.60028,-9.58078 2.60888,-5.96677 6.10904,-11.62013 7.80987,-17.94803 0.25976,-1.13173 -1.4362,-0.67537 -2.04345,-0.90381 -1.77954,-0.1005 -3.61817,-0.29948 -5.3379,-0.43603 -2.02506,7.18768 -5.59023,14.01034 -10.98319,19.25121 -6.64138,6.50142 -14.74163,11.40319 -23.15548,15.26734 -6.27205,2.8057 -13.20789,4.41603 -20.0795,3.39441 -5.38994,-0.74654 -10.98519,-1.78685 -15.69003,-4.68054 -5.53079,-3.70791 -7.6631,-10.45547 -9.6626,-16.46973 -3.00652,-8.96758 -2.96402,-18.55678 -2.00854,-27.86612 0.80559,-10.21741 2.71174,-20.46359 7.1378,-29.7729 4.31191,-9.78935 10.21947,-18.97047 18.05632,-26.30871 5.81289,-5.35913 11.71841,-11.00392 19.02976,-14.2544 4.48612,-1.93545 9.56005,-1.67434 14.31884,-1.23097 5.95519,0.97739 12.03347,3.6749 15.39112,8.94141 4.607,7.10531 6.32665,15.56591 8.3042,23.67041 2.51676,10.49863 1.54395,21.38161 1.47108,32.07342 -0.0362,3.92871 -0.50085,7.91482 -0.70253,11.77765 2.32967,0.28471 4.73191,1.00669 7.03662,1.01074 1.56754,-11.89081 1.88128,-23.98531 0.21619,-35.88675 -1.73357,-12.89966 -3.92512,-25.74187 -6.4115,-38.51608 -0.42288,-2.62971 -2.91397,-4.24275 -4.84961,-5.77637 -5.57867,-3.16617 -11.89997,-4.71914 -18.04931,-6.37651 -5.43491,-1.34301 -11.00389,-2.39044 -16.62549,-2.26216 z" fill="#aa5f59" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 335.9624,432.08105 c -3.05631,7.12595 -5.76628,14.40214 -8.60986,21.61182 -0.3257,2.47766 0.45602,4.98551 0.40812,7.48268 0.55877,8.66051 -0.3498,17.41731 -1.18205,25.96263 10.69774,1.97399 21.58314,3.46342 31.88318,7.07887 6.90333,2.44985 12.78937,7.13967 17.39325,12.7725 7.78342,9.38783 15.26432,19.05782 21.92416,29.28309 7.08596,11.00596 12.49658,22.96626 18.3504,34.6458 3.37548,6.72915 6.42977,13.60969 9.05836,20.66728 4.00584,10.07281 8.83326,19.789 13.07359,29.76252 3.19819,7.27106 7.002,14.45781 12.82683,19.99063 4.20768,4.51088 10.06486,7.62664 16.30962,7.75456 5.49352,0.37514 11.7733,-1.02547 15.05427,-5.83712 4.94683,-7.01804 7.3813,-15.42079 9.60698,-23.61235 2.42477,-9.91042 4.17845,-19.97907 7.0493,-29.77883 1.48437,-5.25293 2.80985,-10.99808 0.78635,-16.30812 -0.89143,-2.67166 -3.08593,-4.5368 -5.29285,-6.12195 -1.14335,-0.8473 -1.73218,-2.9253 -0.0786,-3.59131 2.12817,-0.57801 3.6749,1.60844 4.94267,2.97719 1.01003,1.06667 1.753,2.61543 2.9665,3.39097 1.05083,-1.52136 0.12163,-3.55375 -0.55227,-5.05833 -1.04918,-2.76726 -2.70875,-5.36235 -3.50163,-8.17669 0.096,-2.01172 -0.50227,-4.18227 0.18525,-6.10824 0.83695,-0.492 1.28755,1.02539 1.72508,1.51465 1.45375,2.27819 2.27615,5.09086 4.27247,6.96289 0.76323,0.16389 1.78315,-1.33449 2.17235,-0.0317 0.61308,4.02932 -0.008,8.16168 -0.0966,12.22028 -0.28775,7.06103 -1.52968,14.01164 -2.84203,20.93968 -0.2359,0.69235 -0.27727,1.90363 0.7873,1.73799 3.02103,-0.35462 4.3097,-3.4663 6.04883,-5.48535 0.70492,0.84356 -6e-4,2.23755 -0.0991,3.22803 -0.51537,3.04166 -2.88767,5.35756 -5.5946,6.63656 -3.7113,1.76471 -6.88562,5.35174 -6.8014,9.65299 -0.0153,3.10188 -0.26692,6.29057 0.22803,9.34375 1.08757,0.15643 1.91872,-1.09485 2.69287,-1.71143 2.53103,-2.69396 4.00803,-6.2476 6.60498,-8.85644 0.5168,-0.52745 1.7185,-0.33221 1.3125,0.58593 -1.61778,4.60334 -4.46198,8.69568 -7.34735,12.59851 -2.76638,3.6219 -6.85968,6.9366 -7.2044,11.81214 -0.29788,1.80247 1.3103,3.36649 3.09472,3.1499 2.79758,0.17121 5.13545,-1.80012 6.33535,-4.18506 1.4262,-2.10983 2.0333,-5.17739 4.50793,-6.35595 1.00005,-0.57146 1.94627,0.4668 1.50047,1.45654 -0.93012,2.42475 -2.01877,4.82432 -2.90137,7.28271 -1.06843,2.90416 -3.32798,5.21473 -6.3486,5.9785 -3.715,1.48268 -8.06918,2.00803 -10.9297,5.07326 -3.14825,3.02549 -6.3819,6.3207 -10.76303,7.43599 -6.68869,1.87145 -13.76958,2.6213 -20.68962,1.87993 -5.69399,-0.65653 -9.51934,-5.43627 -12.85617,-9.61603 -8.32599,-11.07258 -14.9402,-23.36275 -20.61384,-35.97197 -7.30561,-16.61468 -13.42829,-33.74477 -21.26154,-50.12724 -5.63577,-11.13217 -12.02911,-21.9549 -19.7831,-31.75302 -1.57772,-1.65903 -2.95764,-3.94846 -5.25097,-4.64112 -1.3442,0.24113 -1.22028,2.12319 -1.38477,3.16016 -0.28851,8.90238 2.03056,17.63982 4.41065,26.14355 5.58409,19.19352 14.98383,36.97718 24.68773,54.35383 7.68037,13.66243 16.0945,26.99035 22.33668,41.3991 3.04118,7.59537 4.40018,16.27605 1.93945,24.20997 -1.07758,3.53671 -4.47685,5.76813 -7.97305,6.39083 -4.88191,0.94875 -9.93966,1.16229 -14.89755,0.80008 -9.60825,-1.67467 -18.93354,-4.70358 -28.2554,-7.52087 -6.09818,-1.75116 -12.20631,-4.60223 -18.70683,-3.87081 -1.95074,-0.0598 -4.06268,0.53059 -5.92644,-0.0614 -1.3722,-0.73284 0.0254,-2.20545 1.01367,-2.44238 0.8847,-0.53338 2.5261,-0.40844 2.89795,-1.50831 -0.81913,-1.72463 -2.85635,-2.49347 -4.39502,-3.46582 -6.70532,-3.85517 -14.68294,-3.32743 -22.09863,-4.06298 -1.67215,0.14739 -3.73861,-1.37336 -2.57862,-3.15235 1.49546,-1.32483 3.70192,-0.14314 5.41748,-0.0425 0.31193,0.0793 1.70603,0.36012 1.02149,-0.26562 -5.02649,-3.69573 -11.0948,-5.53234 -17.15772,-6.66258 -3.68327,-0.8805 -7.98786,-1.55038 -10.29004,-4.92629 -2.27758,-2.97444 -2.71888,-7.21119 -6.01538,-9.41905 -5.16715,-3.99049 -11.52549,-6.12978 -16.65942,-10.13564 -1.21998,-1.16347 -2.59954,-3.00165 -1.93653,-4.75537 1.26327,-0.85173 2.83194,0.4192 4.02284,0.89651 5.12412,2.98324 10.52249,5.47659 15.61047,8.51511 3.07915,2.1681 5.13134,5.37325 6.90401,8.62121 2.25846,3.81007 6.76215,5.322 10.69755,6.75094 5.43391,1.98749 11.30481,2.86904 16.43701,5.61857 2.80201,1.86477 5.60483,3.95118 9.02881,4.47413 5.71522,1.30683 12.02578,1.42233 16.86963,5.11474 5.2159,3.21652 10.57563,6.24437 16.11084,8.86914 1.01954,0.29103 0.49957,-1.15618 0.31933,-1.6123 -0.13884,-0.91521 -1.05215,-2.17632 -0.33447,-3 1.37217,-0.24571 2.26942,1.3457 3.29057,1.99944 2.64956,2.40001 5.1481,5.35441 8.84469,6.07607 7.0236,1.73978 14.11241,3.28654 21.25711,4.43918 4.82166,0.85466 10.42386,-0.97231 12.72726,-5.54741 2.28436,-4.44638 0.90208,-9.62123 -0.0737,-14.22607 -2.06148,-8.93988 -6.58085,-17.0131 -11.32893,-24.76813 -7.08657,-11.65018 -14.23937,-23.28255 -20.32796,-35.49331 -5.55368,-11.11921 -11.6447,-22.0296 -16.12046,-33.6409 -5.00091,-13.68881 -7.0252,-28.18816 -9.17187,-42.5337 -0.86013,-4.97908 -1.79517,-10.64884 -6.12158,-13.8833 -5.59092,-4.05524 -12.55328,-5.50561 -19.16811,-6.99701 -5.79562,-1.10475 -11.64905,-2.17085 -17.53892,-2.50543 -1.3215,3.0897 -2.2433,6.41467 -3.82045,9.42598 -2.02581,4.58338 -5.01709,8.88781 -5.87438,13.90068 -0.0418,1.35545 -0.40107,2.97022 0.26612,4.15332 10.69083,-5.03961 22.40926,-8.14692 34.25146,-8.34945 4.93755,-0.017 10.63297,0.70789 13.84424,4.91781 3.87381,5.07649 3.82916,11.84145 4.81738,17.879 1.16131,9.49187 2.7816,19.04132 6.61647,27.86719 10.81754,25.44564 22.30698,50.6065 34.50258,75.42074 3.21666,6.46933 6.81283,12.81619 11.64365,18.23297 1.5279,1.84493 3.00497,4.45955 1.60156,6.7876 -1.37814,2.81729 -4.16788,5.37193 -7.51074,4.95459 -6.61395,0.30713 -12.94442,-2.06532 -19.20515,-3.8669 -16.35315,-5.31906 -32.32975,-11.74319 -48.12279,-18.52678 -18.23677,-7.99907 -36.37602,-17.55217 -50.21405,-32.17712 -11.79209,-12.70559 -21.10751,-27.76866 -27.15447,-44.01608 -2.10239,-6.09181 -4.22026,-12.39949 -3.87081,-18.93607 -0.15251,-2.56761 0.0937,-5.36099 1.98817,-7.30566 1.11442,-1.35417 2.55095,-2.44006 4.18798,-3.10303 -1.15061,-0.39364 -2.88764,-0.11611 -4.27361,-0.31103 -6.57708,-0.26567 -13.1726,-1.17071 -19.28849,-3.70949 -8.06567,-3.12392 -15.54596,-7.53273 -23.29483,-11.3203 -0.23301,0.76096 0.59258,1.71304 0.76245,2.50381 3.62521,9.21026 9.27014,17.39476 14.85752,25.49204 3.47898,4.8128 4.50204,10.77166 5.28652,16.51526 1.1848,8.40762 2.80904,16.84929 6.3722,24.61356 6.48206,15.00803 18.28514,26.78425 29.89308,37.93418 13.64787,12.87336 28.32093,24.94312 45.07091,33.57738 22.4214,11.73808 46.34693,20.54883 70.88427,26.69483 17.51717,4.3184 35.49856,6.68165 53.51462,7.4241 6.14195,-0.1033 12.3302,0.12833 18.43418,-0.6562 9.41586,-1.2742 18.26946,-5.73407 25.07251,-12.34072 7.22988,-6.65528 12.68488,-15.11632 15.94208,-24.37689 5.00222,-14.04109 7.56972,-28.78897 10.35245,-43.38882 2.6359,-15.31433 5.17222,-30.8023 4.7021,-46.39415 -0.89063,-15.41545 -4.22428,-30.59743 -8.4677,-45.40941 -3.58888,-12.67145 -8.80735,-24.8849 -15.6823,-36.12551 -3.15308,-5.07503 -6.24723,-10.49597 -6.65895,-16.58885 -0.26318,-1.08388 0.0143,-2.58403 -0.52638,-3.48633 -5.0834,2.8022 -10.3167,5.47283 -15.76562,7.42529 -0.3005,8.86843 -0.33205,17.81198 1.39827,26.55475 2.6342,15.35501 8.0996,30.22748 8.76325,45.89057 0.49685,11.1778 1.3428,22.34392 1.776,33.52423 0.20958,15.43313 -3.17102,30.79927 -9.26315,44.95581 -1.9559,4.55786 -3.5621,9.2966 -5.85747,13.69379 -1.29303,2.08503 -3.6228,3.41499 -6.0874,3.27441 -6.99905,0.25492 -13.15435,-4.26357 -17.57837,-9.28973 -8.41761,-9.81694 -14.06898,-21.58631 -19.90084,-33.02784 -7.9752,-15.83305 -14.89315,-32.16473 -22.28429,-48.27275 -5.68397,-12.293 -12.73118,-23.89937 -20.47728,-34.99351 -3.38951,-5.33771 -7.39578,-10.43466 -9.52781,-16.44688 -0.81938,-2.76439 -0.76113,-5.79641 -2.26852,-8.35601 -2.07491,-6.0708 -1.69187,-12.63517 -1.89368,-18.97362 -0.0861,-11.76687 0.29648,-23.53317 0.37659,-35.2964 0.0417,-1.17058 -0.29037,-2.2942 -1.35498,-0.99219 -3.73966,2.23279 -8.34724,1.99668 -12.56445,2.04346 -7.32989,-0.29628 -14.88411,-0.94567 -21.63917,-4.02197 -2.91728,-1.25547 -5.39569,-3.97238 -5.42239,-7.28964 -0.004,-2.48943 -0.7442,0.10483 -1.21286,0.81649 z" fill="#aa5f59" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />
        <path d="m 439.99098,384.72478 c -10.19977,0.35684 -21.04431,1.65442 -29.68675,7.53787 -7.36653,5.40946 -11.01873,14.23079 -14.47296,22.38197 -1.70853,5.00693 -3.61102,10.10459 -3.98984,15.41648 -0.42972,7.73385 3.49117,14.67372 6.84521,21.34325 3.52372,7.21941 8.00652,13.93424 11.49261,21.16326 1.5654,4.43948 0.39402,9.37371 1.3562,13.91081 2.57947,0.70163 5.44528,-0.12956 8.10825,-0.0465 13.93221,-0.95883 27.99452,-2.57031 41.31406,-6.94455 4.19404,-1.66777 8.66612,-3.17436 13.20921,-2.11977 6.6768,1.22278 13.02514,-1.94202 18.63965,-5.16758 1.29947,-0.92791 3.11457,-1.46063 4.07262,-2.74468 0.82378,-11.87216 1.78393,-23.99159 -0.94813,-35.70423 -2.60621,-11.03422 -6.3458,-22.08133 -12.93506,-31.41636 -6.75676,-9.71997 -18.17433,-14.99843 -29.60785,-16.74802 -4.427,-0.69168 -8.91934,-0.93312 -13.39722,-0.86198 z m -3.88287,7.83135 c 11.31531,-0.24883 22.88285,3.68813 31.21766,11.42626 7.8316,7.61179 11.49667,18.41615 13.75957,28.83601 0.90327,6.16758 0.92699,12.50795 0.28312,18.70104 -1.08704,5.43818 -3.61827,11.30886 -9.07016,13.61388 -9.59259,4.05887 -20.28824,3.32346 -30.47671,3.62118 -9.41656,0.11119 -19.83762,-0.3962 -27.25331,-6.95784 -7.57048,-6.32129 -12.64104,-15.68514 -13.75651,-25.47792 -0.33644,-7.05498 -0.28581,-14.27626 2.34423,-20.94527 2.04354,-5.94454 4.4017,-12.88991 10.6299,-15.6496 5.2924,-2.52184 10.47004,-5.59236 16.20822,-6.97163 2.01855,-0.25834 4.07771,-0.16943 6.11399,-0.19611 z" fill="#aa5f59" stroke="none" strokeWidth="0.3" transform="scale(0.26458333)" />

        {/* ── Conduction system ─────────────────────────────────────────────── */}

        {/* SA node */}
        <path ref={ref('sa')} data-region="sa" d="m 70.723047,114.27323 c -0.184016,-0.55204 0.42937,-1.47212 1.196107,-2.0855 0.766737,-0.61339 1.686791,-0.92008 2.45353,-1.04275 0.766739,-0.12268 1.380103,-0.0613 1.625456,0.27603 0.245353,0.33736 0.122676,0.95074 -0.460047,1.62547 -0.582723,0.67472 -1.625454,1.41077 -2.637546,1.68679 -1.012092,0.27602 -1.993484,0.092 -2.1775,-0.46004 z" fill="#404040" stroke="#000000" strokeWidth="0.1" />

        {/* AV node */}
        <path ref={ref('av')} data-region="av" d="m 82.714685,127.49164 c -0.64405,-0.21469 -1.380113,-0.27603 -1.809483,0.12268 -0.42937,0.39871 -0.552044,1.25743 -0.460033,1.90148 0.09201,0.64406 0.398696,1.07342 0.981417,1.25743 0.582721,0.18402 1.441442,0.12268 1.993489,-0.3067 0.552048,-0.42937 0.797396,-1.22675 0.644045,-1.80947 -0.153352,-0.58272 -0.705385,-0.95074 -1.349435,-1.16542 z" fill="#414141" stroke="#000000" strokeWidth="0.1" />

        {/* Bundle branches (right/left halves of the same traced conduction shape) */}
        <path id="shape-cond" ref={ref('rbundle')} data-region="purkinje" d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" transform="scale(0.26458333)" fill="#414141" clipPath="url(#clip-rbundle-half)" />
        <path d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" ref={ref('lbundle')} data-region="purkinje" transform="scale(0.26458333)" fill="#414141" clipPath="url(#clip-lbundle-half)" />
        <path d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" ref={ref('rbundle_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-rbundle-half)" mask="url(#mask-rbundle)" style={{ opacity: 0 }} />
        <path d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" ref={ref('rbundle_glow')} transform="scale(0.26458333)" fill="url(#grad-rbundle)" clipPath="url(#clip-rbundle-half)" mask="url(#mask-rbundle)" style={{ opacity: 0 }} />
        <path d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" ref={ref('lbundle_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-lbundle-half)" mask="url(#mask-lbundle)" style={{ opacity: 0 }} />
        <path d="m 318.46874,486.39693 c -0.40798,1.55136 -0.92223,3.24713 -0.83762,4.87517 1.99987,0.91077 4.52008,0.50899 6.70165,0.93126 11.78881,1.29636 23.87595,2.79764 34.79737,7.69558 4.30401,1.82839 7.70851,5.61013 8.65371,10.27589 2.59277,10.8733 3.35198,22.10096 5.98492,32.98054 2.36321,11.08042 6.57904,21.66054 11.81825,31.68082 7.5636,15.38298 15.35012,30.6796 24.441,45.23085 7.11744,12.06873 15.50647,24.24271 17.10265,38.51534 0.27683,3.42655 0.5544,7.28001 -1.89847,10.05268 -2.35761,3.04023 -6.29916,4.84557 -10.15914,4.35313 -7.23819,-0.24345 -14.21703,-2.39928 -21.28135,-3.90511 -4.16842,-0.76692 -7.76032,-3.08419 -10.61016,-6.10171 -0.99947,-0.5317 -1.99532,-2.66859 -3.18554,-1.84827 -0.34538,1.28153 1.47571,2.95388 0.3715,3.99681 -2.84343,-0.55372 -5.37254,-2.52029 -8.03725,-3.73181 -5.13392,-2.40404 -9.52237,-6.22529 -14.93336,-8.03972 -6.24069,-1.89873 -13.4246,-1.43995 -18.65218,-5.88898 -6.37244,-4.01036 -14.12952,-4.69183 -20.94322,-7.71616 -3.96746,-1.36723 -7.45263,-4.22945 -9.16044,-8.14875 -3.49324,-6.50437 -10.96399,-8.80765 -16.93462,-12.30533 -2.37406,-1.04285 -4.56115,-3.12077 -7.20576,-3.28693 -1.06411,1.1424 0.55673,2.86809 1.39695,3.7496 5.61743,5.11547 13.72722,6.78672 18.80186,12.56426 2.68577,3.45855 3.35972,8.8211 7.96876,10.46159 6.92495,2.48165 14.57094,2.80518 20.928,6.83247 1.15382,0.80395 2.89932,1.52319 3.33115,2.89439 -2.31922,0.35924 -4.85641,-1.35837 -7.0683,-0.29071 -1.09356,1.3175 0.848,2.47137 2.06055,2.39891 8.32993,0.88466 17.37365,0.37501 24.57541,5.39376 0.93931,0.79386 2.95566,1.61067 2.63163,3.06805 -1.01732,1.40173 -3.57427,0.89188 -4.25507,2.50733 0.76702,1.35124 2.91329,0.45659 4.20535,0.66912 5.43232,-0.65475 10.72119,0.62141 15.80632,2.40168 11.21592,3.43216 22.3937,7.34452 34.02836,9.09179 5.57755,0.028 11.45915,0.16621 16.69689,-2.0297 4.70924,-2.07572 5.46609,-7.76661 5.47161,-12.31617 0.4712,-7.55755 -1.86316,-14.91369 -5.2551,-21.57724 -8.8474,-18.36418 -20.22546,-35.36376 -29.33319,-53.59599 -9.60431,-18.76412 -18.0566,-38.72451 -19.90019,-59.9251 0.0659,-2.29593 -0.6063,-5.57209 1.56337,-7.08488 2.44383,0.0498 3.87982,2.65889 5.4566,4.2095 12.47542,15.64502 21.61982,33.68522 28.99459,52.22839 7.25119,17.43142 13.80884,35.2563 23.47949,51.5495 4.38946,7.24085 8.79892,14.69839 14.9835,20.57347 4.44956,4.20013 10.95341,4.18037 16.64877,3.56729 6.84223,-0.71885 14.48556,-1.6157 19.33564,-7.08487 2.74281,-3.30061 6.48454,-5.26726 10.57069,-6.35223 3.33181,-1.08056 7.23387,-2.29352 8.56677,-5.92961 1.03914,-2.73137 2.41183,-5.38199 3.19027,-8.19181 -0.65908,-1.55733 -2.35292,0.17166 -2.71035,1.0869 -2.03043,3.36366 -3.61085,8.1852 -8.15659,8.71869 -2.21193,0.52899 -4.98623,-1.0543 -4.4422,-3.57766 0.32698,-5.84076 5.65962,-9.43856 8.52326,-14.05168 1.87264,-2.95752 4.37725,-5.74654 5.36199,-9.14197 -0.75251,-1.48144 -1.79502,0.79404 -2.29671,1.43009 -1.96743,2.80256 -3.72601,6.24233 -6.92813,7.7761 -1.41182,0.0479 -0.75814,-2.16294 -1.01893,-2.99608 0.11316,-4.53587 -0.94942,-9.80226 2.51394,-13.42827 2.70639,-3.45354 8.40849,-4.02322 9.54387,-8.74008 0.18898,-1.2456 -1.32484,-0.86779 -1.63104,-0.0263 -1.21205,0.91374 -3.22057,2.67667 -4.68183,1.39419 -0.47524,-3.45711 1.09373,-6.84324 1.40806,-10.2888 1.17397,-7.72901 1.71204,-15.58361 1.68209,-23.39544 -0.24485,-1.5385 -2.16524,-0.008 -2.76905,-1.31202 -1.88447,-2.0185 -2.44383,-4.99148 -4.31998,-6.95851 -1.54414,0.0494 -0.62645,2.25142 -0.7147,3.24896 0.61174,4.94815 4.60698,9.01433 4.50021,14.07516 -0.16309,1.35947 -1.57674,0.98025 -2.05365,0.0746 -1.87372,-1.82604 -3.1165,-5.23021 -6.09051,-5.3758 -1.56602,-0.0382 -1.3507,1.91317 -0.35286,2.5674 2.30052,1.8735 4.80764,3.72011 5.53946,6.77207 2.65212,6.42024 -0.13619,13.22346 -1.60433,19.5536 -4.33837,15.42156 -5.81211,31.82653 -13.24353,46.20802 -2.3635,4.75887 -6.48558,9.12721 -12.01391,9.75103 -6.57798,0.85661 -13.89902,0.1847 -19.10372,-4.37131 -8.90845,-6.86657 -14.02197,-17.19703 -18.29076,-27.3311 -5.12057,-11.43575 -10.26129,-22.86301 -14.85684,-34.52325 -6.12833,-13.77049 -12.89996,-27.26353 -20.14681,-40.4781 -6.84533,-11.86971 -15.39662,-22.65023 -23.96474,-33.30392 -5.22111,-6.4336 -11.6181,-12.3176 -19.6922,-14.8164 -11.30692,-3.79008 -23.23474,-5.16351 -34.90074,-7.42726 -1.32411,-0.1213 -2.69714,-0.71238 -4.00139,-0.51097 z" ref={ref('lbundle_glow')} transform="scale(0.26458333)" fill="url(#grad-lbundle)" clipPath="url(#clip-lbundle-half)" mask="url(#mask-lbundle)" style={{ opacity: 0 }} />

        {/* ── Chambers (base = always-visible resting fill, overlay = depol sweep) ── */}
        <g>
          <path id="shape-rv" ref={ref('rv')} data-region="ventricle" d="m 349.85074,512.87822 c -13.77799,0.10004 -27.17251,4.68252 -39.10086,11.36942 -9.21867,4.70861 -17.85962,10.78594 -27.75594,14.01461 -4.59009,1.56133 -10.33613,1.96412 -13.43848,6.16578 -2.6823,4.76105 -1.21598,10.52628 -0.22424,15.55937 4.46504,17.66879 13.72938,33.88657 25.24297,47.9007 11.62414,14.12162 27.19246,24.35767 43.57864,32.15304 18.14848,8.62033 36.87519,16.02157 55.85549,22.59525 7.21897,2.21041 14.52235,4.88931 22.14336,5.08095 3.39968,-0.043 6.68686,-2.7936 7.31551,-6.11468 0.1087,-3.67302 -3.36682,-6.092 -5.20241,-8.90376 -6.80531,-9.36638 -11.17269,-20.21949 -16.28955,-30.54309 -9.49013,-20.33422 -18.95346,-40.70097 -27.53794,-61.43738 -4.86528,-12.12875 -5.12454,-25.37609 -7.84869,-38.02082 -1.26341,-5.02818 -5.57974,-9.30652 -10.89939,-9.59704 -1.93862,-0.20223 -3.8906,-0.23958 -5.83847,-0.22235 z" transform="scale(0.26458333)" fill="#532e2b" />
          <path d="m 349.85074,512.87822 c -13.77799,0.10004 -27.17251,4.68252 -39.10086,11.36942 -9.21867,4.70861 -17.85962,10.78594 -27.75594,14.01461 -4.59009,1.56133 -10.33613,1.96412 -13.43848,6.16578 -2.6823,4.76105 -1.21598,10.52628 -0.22424,15.55937 4.46504,17.66879 13.72938,33.88657 25.24297,47.9007 11.62414,14.12162 27.19246,24.35767 43.57864,32.15304 18.14848,8.62033 36.87519,16.02157 55.85549,22.59525 7.21897,2.21041 14.52235,4.88931 22.14336,5.08095 3.39968,-0.043 6.68686,-2.7936 7.31551,-6.11468 0.1087,-3.67302 -3.36682,-6.092 -5.20241,-8.90376 -6.80531,-9.36638 -11.17269,-20.21949 -16.28955,-30.54309 -9.49013,-20.33422 -18.95346,-40.70097 -27.53794,-61.43738 -4.86528,-12.12875 -5.12454,-25.37609 -7.84869,-38.02082 -1.26341,-5.02818 -5.57974,-9.30652 -10.89939,-9.59704 -1.93862,-0.20223 -3.8906,-0.23958 -5.83847,-0.22235 z" ref={ref('rv_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-rv)" style={{ opacity: 0 }} />
          <path d="m 349.85074,512.87822 c -13.77799,0.10004 -27.17251,4.68252 -39.10086,11.36942 -9.21867,4.70861 -17.85962,10.78594 -27.75594,14.01461 -4.59009,1.56133 -10.33613,1.96412 -13.43848,6.16578 -2.6823,4.76105 -1.21598,10.52628 -0.22424,15.55937 4.46504,17.66879 13.72938,33.88657 25.24297,47.9007 11.62414,14.12162 27.19246,24.35767 43.57864,32.15304 18.14848,8.62033 36.87519,16.02157 55.85549,22.59525 7.21897,2.21041 14.52235,4.88931 22.14336,5.08095 3.39968,-0.043 6.68686,-2.7936 7.31551,-6.11468 0.1087,-3.67302 -3.36682,-6.092 -5.20241,-8.90376 -6.80531,-9.36638 -11.17269,-20.21949 -16.28955,-30.54309 -9.49013,-20.33422 -18.95346,-40.70097 -27.53794,-61.43738 -4.86528,-12.12875 -5.12454,-25.37609 -7.84869,-38.02082 -1.26341,-5.02818 -5.57974,-9.30652 -10.89939,-9.59704 -1.93862,-0.20223 -3.8906,-0.23958 -5.83847,-0.22235 z" ref={ref('rv_glow')} transform="scale(0.26458333)" fill="url(#grad-rv)" clipPath="url(#clip-rv)" style={{ opacity: 0 }} />
          <path d="m 349.85074,512.87822 c -13.77799,0.10004 -27.17251,4.68252 -39.10086,11.36942 -9.21867,4.70861 -17.85962,10.78594 -27.75594,14.01461 -4.59009,1.56133 -10.33613,1.96412 -13.43848,6.16578 -2.6823,4.76105 -1.21598,10.52628 -0.22424,15.55937 4.46504,17.66879 13.72938,33.88657 25.24297,47.9007 11.62414,14.12162 27.19246,24.35767 43.57864,32.15304 18.14848,8.62033 36.87519,16.02157 55.85549,22.59525 7.21897,2.21041 14.52235,4.88931 22.14336,5.08095 3.39968,-0.043 6.68686,-2.7936 7.31551,-6.11468 0.1087,-3.67302 -3.36682,-6.092 -5.20241,-8.90376 -6.80531,-9.36638 -11.17269,-20.21949 -16.28955,-30.54309 -9.49013,-20.33422 -18.95346,-40.70097 -27.53794,-61.43738 -4.86528,-12.12875 -5.12454,-25.37609 -7.84869,-38.02082 -1.26341,-5.02818 -5.57974,-9.30652 -10.89939,-9.59704 -1.93862,-0.20223 -3.8906,-0.23958 -5.83847,-0.22235 z" ref={ref('rv_repol_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-rv-repol)" style={{ opacity: 0 }} />
          <path d="m 349.85074,512.87822 c -13.77799,0.10004 -27.17251,4.68252 -39.10086,11.36942 -9.21867,4.70861 -17.85962,10.78594 -27.75594,14.01461 -4.59009,1.56133 -10.33613,1.96412 -13.43848,6.16578 -2.6823,4.76105 -1.21598,10.52628 -0.22424,15.55937 4.46504,17.66879 13.72938,33.88657 25.24297,47.9007 11.62414,14.12162 27.19246,24.35767 43.57864,32.15304 18.14848,8.62033 36.87519,16.02157 55.85549,22.59525 7.21897,2.21041 14.52235,4.88931 22.14336,5.08095 3.39968,-0.043 6.68686,-2.7936 7.31551,-6.11468 0.1087,-3.67302 -3.36682,-6.092 -5.20241,-8.90376 -6.80531,-9.36638 -11.17269,-20.21949 -16.28955,-30.54309 -9.49013,-20.33422 -18.95346,-40.70097 -27.53794,-61.43738 -4.86528,-12.12875 -5.12454,-25.37609 -7.84869,-38.02082 -1.26341,-5.02818 -5.57974,-9.30652 -10.89939,-9.59704 -1.93862,-0.20223 -3.8906,-0.23958 -5.83847,-0.22235 z" ref={ref('rv_repol_glow')} transform="scale(0.26458333)" fill="url(#grad-rv-repol)" clipPath="url(#clip-rv-repol)" style={{ opacity: 0 }} />

          <path id="shape-lv" ref={ref('lv')} data-region="ventricle" d="m 469.92631,477.77562 c -5.53596,0.23011 -10.36623,3.48933 -15.77662,4.4277 -13.20212,3.03235 -26.69227,4.57204 -40.21006,5.22432 -7.61312,0.51599 -14.94958,2.80525 -22.42552,4.18766 -3.31031,0.96163 -7.89043,1.51365 -9.2642,5.21836 -1.50729,6.42908 2.67795,12.32045 5.85097,17.52811 8.00449,11.87825 16.23727,23.68411 22.34722,36.69402 11.81437,24.67463 21.82563,50.3046 35.92798,73.82513 4.86191,7.49894 10.03773,15.82439 18.63735,19.4091 3.1869,1.13621 7.05034,1.90155 10.22654,0.36694 2.89892,-2.28452 3.63086,-6.26325 5.23648,-9.41991 5.63892,-13.21323 10.60176,-26.99069 11.4316,-41.4617 1.05541,-13.72651 -0.94289,-27.42011 -1.34909,-41.12957 -0.37902,-16.92572 -6.47403,-32.946 -9.15528,-49.51859 -1.52834,-8.07164 -0.88196,-16.33215 -1.437,-24.47391 -3.23928,-0.6788 -6.71623,-0.75473 -10.04037,-0.87766 z" transform="scale(0.26458333)" fill="#532e2b" />
          <path d="m 469.92631,477.77562 c -5.53596,0.23011 -10.36623,3.48933 -15.77662,4.4277 -13.20212,3.03235 -26.69227,4.57204 -40.21006,5.22432 -7.61312,0.51599 -14.94958,2.80525 -22.42552,4.18766 -3.31031,0.96163 -7.89043,1.51365 -9.2642,5.21836 -1.50729,6.42908 2.67795,12.32045 5.85097,17.52811 8.00449,11.87825 16.23727,23.68411 22.34722,36.69402 11.81437,24.67463 21.82563,50.3046 35.92798,73.82513 4.86191,7.49894 10.03773,15.82439 18.63735,19.4091 3.1869,1.13621 7.05034,1.90155 10.22654,0.36694 2.89892,-2.28452 3.63086,-6.26325 5.23648,-9.41991 5.63892,-13.21323 10.60176,-26.99069 11.4316,-41.4617 1.05541,-13.72651 -0.94289,-27.42011 -1.34909,-41.12957 -0.37902,-16.92572 -6.47403,-32.946 -9.15528,-49.51859 -1.52834,-8.07164 -0.88196,-16.33215 -1.437,-24.47391 -3.23928,-0.6788 -6.71623,-0.75473 -10.04037,-0.87766 z" ref={ref('lv_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-lv)" style={{ opacity: 0 }} />
          <path d="m 469.92631,477.77562 c -5.53596,0.23011 -10.36623,3.48933 -15.77662,4.4277 -13.20212,3.03235 -26.69227,4.57204 -40.21006,5.22432 -7.61312,0.51599 -14.94958,2.80525 -22.42552,4.18766 -3.31031,0.96163 -7.89043,1.51365 -9.2642,5.21836 -1.50729,6.42908 2.67795,12.32045 5.85097,17.52811 8.00449,11.87825 16.23727,23.68411 22.34722,36.69402 11.81437,24.67463 21.82563,50.3046 35.92798,73.82513 4.86191,7.49894 10.03773,15.82439 18.63735,19.4091 3.1869,1.13621 7.05034,1.90155 10.22654,0.36694 2.89892,-2.28452 3.63086,-6.26325 5.23648,-9.41991 5.63892,-13.21323 10.60176,-26.99069 11.4316,-41.4617 1.05541,-13.72651 -0.94289,-27.42011 -1.34909,-41.12957 -0.37902,-16.92572 -6.47403,-32.946 -9.15528,-49.51859 -1.52834,-8.07164 -0.88196,-16.33215 -1.437,-24.47391 -3.23928,-0.6788 -6.71623,-0.75473 -10.04037,-0.87766 z" ref={ref('lv_glow')} transform="scale(0.26458333)" fill="url(#grad-lv)" clipPath="url(#clip-lv)" style={{ opacity: 0 }} />
          <path d="m 469.92631,477.77562 c -5.53596,0.23011 -10.36623,3.48933 -15.77662,4.4277 -13.20212,3.03235 -26.69227,4.57204 -40.21006,5.22432 -7.61312,0.51599 -14.94958,2.80525 -22.42552,4.18766 -3.31031,0.96163 -7.89043,1.51365 -9.2642,5.21836 -1.50729,6.42908 2.67795,12.32045 5.85097,17.52811 8.00449,11.87825 16.23727,23.68411 22.34722,36.69402 11.81437,24.67463 21.82563,50.3046 35.92798,73.82513 4.86191,7.49894 10.03773,15.82439 18.63735,19.4091 3.1869,1.13621 7.05034,1.90155 10.22654,0.36694 2.89892,-2.28452 3.63086,-6.26325 5.23648,-9.41991 5.63892,-13.21323 10.60176,-26.99069 11.4316,-41.4617 1.05541,-13.72651 -0.94289,-27.42011 -1.34909,-41.12957 -0.37902,-16.92572 -6.47403,-32.946 -9.15528,-49.51859 -1.52834,-8.07164 -0.88196,-16.33215 -1.437,-24.47391 -3.23928,-0.6788 -6.71623,-0.75473 -10.04037,-0.87766 z" ref={ref('lv_repol_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-lv-repol)" style={{ opacity: 0 }} />
          <path d="m 469.92631,477.77562 c -5.53596,0.23011 -10.36623,3.48933 -15.77662,4.4277 -13.20212,3.03235 -26.69227,4.57204 -40.21006,5.22432 -7.61312,0.51599 -14.94958,2.80525 -22.42552,4.18766 -3.31031,0.96163 -7.89043,1.51365 -9.2642,5.21836 -1.50729,6.42908 2.67795,12.32045 5.85097,17.52811 8.00449,11.87825 16.23727,23.68411 22.34722,36.69402 11.81437,24.67463 21.82563,50.3046 35.92798,73.82513 4.86191,7.49894 10.03773,15.82439 18.63735,19.4091 3.1869,1.13621 7.05034,1.90155 10.22654,0.36694 2.89892,-2.28452 3.63086,-6.26325 5.23648,-9.41991 5.63892,-13.21323 10.60176,-26.99069 11.4316,-41.4617 1.05541,-13.72651 -0.94289,-27.42011 -1.34909,-41.12957 -0.37902,-16.92572 -6.47403,-32.946 -9.15528,-49.51859 -1.52834,-8.07164 -0.88196,-16.33215 -1.437,-24.47391 -3.23928,-0.6788 -6.71623,-0.75473 -10.04037,-0.87766 z" ref={ref('lv_repol_glow')} transform="scale(0.26458333)" fill="url(#grad-lv-repol)" clipPath="url(#clip-lv-repol)" style={{ opacity: 0 }} />
        </g>

        <path id="shape-ra" ref={ref('ra')} data-region="atrium" d="m 288.26479,409.71314 c -8.20833,-0.1937 -14.98522,5.32245 -20.93492,10.31243 -8.92914,7.53939 -16.76844,16.54565 -21.76988,27.18583 -6.70799,12.72637 -9.23993,27.1748 -9.5231,41.44023 -0.51421,7.89588 0.65592,15.84037 3.51072,23.22531 1.90177,5.72275 4.94988,11.81861 10.86901,14.22639 9.37026,3.84111 20.2542,4.85082 29.78825,0.95984 10.92513,-4.482 21.36881,-10.92568 29.06872,-19.99856 3.26238,-4.059 5.45337,-8.93756 7.07659,-13.8383 -1.45371,0.0318 -2.8365,1.48019 -4.42494,1.51849 -3.29543,0.76875 -7.52816,-0.82129 -8.01365,-4.54441 -0.54411,-3.03671 -0.27249,-7.37575 2.94444,-8.85748 3.4343,-1.02251 7.39071,0.34442 9.94921,2.74419 0.97959,2.1355 1.49604,0.49323 1.52678,-0.96951 0.60109,-11.01002 1.25486,-22.0928 0.31695,-33.10144 -1.16801,-9.30244 -3.48458,-18.53472 -7.17322,-27.16301 -2.30872,-5.49426 -6.8937,-10.06226 -12.72245,-11.64638 -3.37569,-1.10601 -6.94525,-1.53006 -10.48851,-1.49362 z m -4.52784,9.88361 c 1.84286,-0.18415 4.38678,0.68173 4.16323,2.9396 -0.50935,4.51451 -4.74823,7.59451 -8.42244,9.6951 -3.31809,2.03456 -7.60267,2.53482 -11.25363,1.29889 -3.72986,-3.21097 1.56094,-8.0983 4.19706,-10.242 3.21838,-2.37107 7.35148,-3.5882 11.31578,-3.69159 z" transform="scale(0.26458333)" fill="#532e2b" />
        <path d="m 288.26479,409.71314 c -8.20833,-0.1937 -14.98522,5.32245 -20.93492,10.31243 -8.92914,7.53939 -16.76844,16.54565 -21.76988,27.18583 -6.70799,12.72637 -9.23993,27.1748 -9.5231,41.44023 -0.51421,7.89588 0.65592,15.84037 3.51072,23.22531 1.90177,5.72275 4.94988,11.81861 10.86901,14.22639 9.37026,3.84111 20.2542,4.85082 29.78825,0.95984 10.92513,-4.482 21.36881,-10.92568 29.06872,-19.99856 3.26238,-4.059 5.45337,-8.93756 7.07659,-13.8383 -1.45371,0.0318 -2.8365,1.48019 -4.42494,1.51849 -3.29543,0.76875 -7.52816,-0.82129 -8.01365,-4.54441 -0.54411,-3.03671 -0.27249,-7.37575 2.94444,-8.85748 3.4343,-1.02251 7.39071,0.34442 9.94921,2.74419 0.97959,2.1355 1.49604,0.49323 1.52678,-0.96951 0.60109,-11.01002 1.25486,-22.0928 0.31695,-33.10144 -1.16801,-9.30244 -3.48458,-18.53472 -7.17322,-27.16301 -2.30872,-5.49426 -6.8937,-10.06226 -12.72245,-11.64638 -3.37569,-1.10601 -6.94525,-1.53006 -10.48851,-1.49362 z m -4.52784,9.88361 c 1.84286,-0.18415 4.38678,0.68173 4.16323,2.9396 -0.50935,4.51451 -4.74823,7.59451 -8.42244,9.6951 -3.31809,2.03456 -7.60267,2.53482 -11.25363,1.29889 -3.72986,-3.21097 1.56094,-8.0983 4.19706,-10.242 3.21838,-2.37107 7.35148,-3.5882 11.31578,-3.69159 z" ref={ref('ra_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-ra)" style={{ opacity: 0 }} />
          <path d="m 288.26479,409.71314 c -8.20833,-0.1937 -14.98522,5.32245 -20.93492,10.31243 -8.92914,7.53939 -16.76844,16.54565 -21.76988,27.18583 -6.70799,12.72637 -9.23993,27.1748 -9.5231,41.44023 -0.51421,7.89588 0.65592,15.84037 3.51072,23.22531 1.90177,5.72275 4.94988,11.81861 10.86901,14.22639 9.37026,3.84111 20.2542,4.85082 29.78825,0.95984 10.92513,-4.482 21.36881,-10.92568 29.06872,-19.99856 3.26238,-4.059 5.45337,-8.93756 7.07659,-13.8383 -1.45371,0.0318 -2.8365,1.48019 -4.42494,1.51849 -3.29543,0.76875 -7.52816,-0.82129 -8.01365,-4.54441 -0.54411,-3.03671 -0.27249,-7.37575 2.94444,-8.85748 3.4343,-1.02251 7.39071,0.34442 9.94921,2.74419 0.97959,2.1355 1.49604,0.49323 1.52678,-0.96951 0.60109,-11.01002 1.25486,-22.0928 0.31695,-33.10144 -1.16801,-9.30244 -3.48458,-18.53472 -7.17322,-27.16301 -2.30872,-5.49426 -6.8937,-10.06226 -12.72245,-11.64638 -3.37569,-1.10601 -6.94525,-1.53006 -10.48851,-1.49362 z m -4.52784,9.88361 c 1.84286,-0.18415 4.38678,0.68173 4.16323,2.9396 -0.50935,4.51451 -4.74823,7.59451 -8.42244,9.6951 -3.31809,2.03456 -7.60267,2.53482 -11.25363,1.29889 -3.72986,-3.21097 1.56094,-8.0983 4.19706,-10.242 3.21838,-2.37107 7.35148,-3.5882 11.31578,-3.69159 z" ref={ref('ra_glow')} transform="scale(0.26458333)" fill="url(#grad-ra)" clipPath="url(#clip-ra)" style={{ opacity: 0 }} />

        <path id="shape-la" ref={ref('la')} data-region="atrium" d="m 435.43691,392.87032 c -8.21385,0.24489 -15.57905,4.47113 -22.68957,8.16073 -5.20806,3.06748 -7.14618,9.31748 -9.0819,14.6773 -2.97439,8.8707 -3.68746,18.67525 -0.6096,27.62177 3.04796,9.4328 9.61226,18.23181 18.8977,22.19059 10.61834,3.75523 22.1128,2.67039 33.15574,2.35251 6.53163,-0.55405 13.56663,-0.98239 19.21505,-4.66304 5.28519,-3.8507 6.48878,-10.8954 6.99529,-16.98655 0.49762,-12.71814 -2.96421,-25.66841 -9.90037,-36.35443 -7.14932,-10.72606 -20.23822,-15.79011 -32.65535,-16.88356 -1.10632,-0.0901 -2.21686,-0.13636 -3.32699,-0.11532 z" transform="scale(0.26458333)" fill="#532e2b" />
        <path d="m 435.43691,392.87032 c -8.21385,0.24489 -15.57905,4.47113 -22.68957,8.16073 -5.20806,3.06748 -7.14618,9.31748 -9.0819,14.6773 -2.97439,8.8707 -3.68746,18.67525 -0.6096,27.62177 3.04796,9.4328 9.61226,18.23181 18.8977,22.19059 10.61834,3.75523 22.1128,2.67039 33.15574,2.35251 6.53163,-0.55405 13.56663,-0.98239 19.21505,-4.66304 5.28519,-3.8507 6.48878,-10.8954 6.99529,-16.98655 0.49762,-12.71814 -2.96421,-25.66841 -9.90037,-36.35443 -7.14932,-10.72606 -20.23822,-15.79011 -32.65535,-16.88356 -1.10632,-0.0901 -2.21686,-0.13636 -3.32699,-0.11532 z" ref={ref('la_overlay')} transform="scale(0.26458333)" fill="none" clipPath="url(#clip-la)" style={{ opacity: 0 }} />
          <path d="m 435.43691,392.87032 c -8.21385,0.24489 -15.57905,4.47113 -22.68957,8.16073 -5.20806,3.06748 -7.14618,9.31748 -9.0819,14.6773 -2.97439,8.8707 -3.68746,18.67525 -0.6096,27.62177 3.04796,9.4328 9.61226,18.23181 18.8977,22.19059 10.61834,3.75523 22.1128,2.67039 33.15574,2.35251 6.53163,-0.55405 13.56663,-0.98239 19.21505,-4.66304 5.28519,-3.8507 6.48878,-10.8954 6.99529,-16.98655 0.49762,-12.71814 -2.96421,-25.66841 -9.90037,-36.35443 -7.14932,-10.72606 -20.23822,-15.79011 -32.65535,-16.88356 -1.10632,-0.0901 -2.21686,-0.13636 -3.32699,-0.11532 z" ref={ref('la_glow')} transform="scale(0.26458333)" fill="url(#grad-la)" clipPath="url(#clip-la)" style={{ opacity: 0 }} />
        {tissueWaves && (
          <foreignObject x="230" y="390" width="270" height="290" transform="scale(0.26458333)" pointerEvents="none" aria-hidden="true">
            <canvas ref={tissueCanvas} style={{ width: 270, height: 290, display: 'block' }} />
          </foreignObject>
        )}
      </svg>
      {tissueWaves && (
        <div className={`mt-2 text-[10px] leading-relaxed text-gray-400 ${compact ? 'w-max' : 'max-w-[210px]'}`}>
          <div className={`flex justify-center gap-x-3 gap-y-1 ${compact ? 'whitespace-nowrap' : 'flex-wrap'}`} aria-label="Tissue color legend">
            <span><span style={{ color: '#fde047' }}>●</span> Depolarizing</span>
            <span><span style={{ color: '#df694c' }}>●</span> Depolarized</span>
            <span><span style={{ color: '#38bdf8' }}>●</span> Repolarizing</span>
          </div>
        </div>
      )}
    </div>
  )
}
