// A teaching model of impulse timing, not an ionic or spatial heart model.
// Recovery memory produces additional delay and eventual failure; a missed
// activation allows recovery. Constants are chosen for accessible experiments.
export function conductAtrialImpulses(inputs, { delayMs, refractoryMs, recoveryMs, distalFailure }) {
  let memory = 0, previous = -Infinity, lastActivation = -Infinity, lastExit = -Infinity, count = 0
  return inputs.map(input => {
    const elapsed = input.time - previous
    memory *= Math.exp(-elapsed / Math.max(1, recoveryMs))
    previous = input.time
    const blocked = input.time - lastActivation < refractoryMs + 450 * memory || input.time < lastExit
    if (blocked) {
      memory = 0 // representative recovery after a missed activation
      return { ...input, blocked: 'av', delay: null }
    }
    const delay = delayMs + 200 * memory
    lastActivation = input.time
    lastExit = input.time + delay
    memory += 1
    count++
    const every = distalFailure === 'frequent' ? 3 : distalFailure === 'occasional' ? 5 : Infinity
    return { ...input, delay, blocked: count % every === 0 ? 'distal' : null }
  })
}

export function organizedTiming(phys, effective) {
  const rr = 60000 / effective.effectiveSaRate
  const every = phys.atrialPrematureActivity === 'frequent' ? 3 : phys.atrialPrematureActivity === 'occasional' ? 6 : Infinity
  const varying = phys.firingRegularity !== 'regular' || Number.isFinite(every) || phys.distalConductionFailure !== 'none'
  const count = 180
  let time = 0
  const inputs = []
  for (let i = 0; i < count; i++) {
    const premature = i % every === every - 1
    const variation = phys.firingRegularity === 'respiratory' ? 1 + .08 * Math.sin(i * Math.PI / 3)
      : phys.firingRegularity === 'irregular' ? [1, .82, 1.16, .93, 1.24, .85][i % 6] : 1
    if (i) time += rr * (premature ? phys.atrialPrematurityPct / 100 : variation)
    inputs.push({ time, premature })
  }
  const atrialDelay = 35 * 100 / phys.atrialConductionVelocityPct
  let lastAtrial = -Infinity
  const activated = inputs.filter(e => {
    if (e.premature && e.time - lastAtrial < phys.atrialRefractoryMs) return false
    lastAtrial = e.time
    return true
  })
  const all = conductAtrialImpulses(activated, {
    delayMs: effective.effectiveAvDelayMs, refractoryMs: effective.effectiveAvRefractoryMs,
    recoveryMs: effective.effectiveAvRecoveryMs, distalFailure: phys.distalConductionFailure,
  })
  // Use a complete repeating group for regular AV block. Otherwise retain a
  // full period of the illustrative premature/irregular/distal pattern.
  let start = Math.max(0, all.length - 60), end = all.length - 30
  if (!varying) {
    const blocked = all.map((e, i) => e.blocked ? i : -1).filter(i => i >= 100)
    if (blocked.length >= 2) {
      start = blocked[0] + 1
      end = blocked[1] + 1
    } else { start = 120; end = 126 }
  }
  // PVC frequency uses six or three sinus intervals, so include six groups.
  if (phys.ventricularPrematureActivity !== 'off' && !varying) end = start + (end - start) * 6
  end = Math.min(end, all.length - 1)
  const origin = all[start].time
  const cycleMs = all[end].time - origin
  const atria = all.slice(start, end).map(e => ({ ...e, time: e.time - origin, pr: e.delay === null ? null : atrialDelay + e.delay }))
  const candidates = atria.filter(e => !e.blocked).map((e, i) => ({ time: e.time + e.pr, source: 'conducted', atrialTime: e.time, index: i }))
  const pvcEvery = phys.ventricularPrematureActivity === 'frequent' ? 3 : phys.ventricularPrematureActivity === 'occasional' ? 6 : Infinity
  const conductedCandidates = [...candidates]
  for (let i = 0; i < conductedCandidates.length; i++) {
    if (i % pvcEvery === pvcEvery - 2) {
      candidates.push({ time: conductedCandidates[i].time + rr * phys.ventricularPrematurityPct / 100, source: 'premature' })
    }
  }
  candidates.sort((a, b) => a.time - b.time)
  const ventRefractory = Math.max(180, effective.effectiveApdMs * .85)
  // Warm up across the boundary so a late PVC can suppress the next QRS.
  let last = -Infinity
  const ventricles = []
  for (let cycle = -1; cycle <= 0; cycle++) {
    for (const event of candidates) {
      const t = event.time + cycle * cycleMs
      if (t - last < ventRefractory) continue
      last = t
      if (cycle === 0) ventricles.push(event)
    }
  }
  const conducted = new Set(ventricles.filter(e => e.source === 'conducted').map(e => e.atrialTime))
  for (const e of atria) if (!e.blocked && !conducted.has(e.time)) e.blocked = 'ventricular'
  return { atria, ventricles, cycleMs }
}

// Explicit events keep the heart animation aligned with blocked and premature
// impulses even when several mechanisms are combined.
export function physiologyConductionMap(atria, beats, pDuration, derived) {
  const map = []
  const add = (id, onsetMs, offsetMs, state = 'active', focusIndex) => map.push({ id, onsetMs, offsetMs: Math.max(onsetMs + 1, offsetMs), state, focusIndex })
  for (const a of atria) {
    if (!a.premature) add('sa', a.time, a.time + 35)
    const state = a.premature ? 'ectopic' : 'active'
    add('ra', a.time + 10, a.time + pDuration, state, a.focusIndex)
    add('la', a.time + 25, a.time + pDuration, state, a.focusIndex)
    add('bachmann', a.time + 12, a.time + 32, state)
    add('av', a.time + pDuration, a.time + (a.pr ?? pDuration + 60), a.blocked === 'av' ? 'blocked' : 'active')
    if (a.blocked === 'distal') add('his', a.time + a.pr, a.time + a.pr + 60, 'blocked')
  }
  for (const beat of beats) {
    const wave = name => beat.waves.find(w => w.name === name)
    const q = wave('Q'), r = wave('R'), s = wave('S'), t = wave('T')
    const on = q.center - 2 * q.sigma, off = s.center + 2 * s.sigma
    const ectopic = beat.source === 'premature'
    if (!ectopic) {
      add('his', on, on + 20)
      add('lbundle', on + 10, on + 45, derived.leftImpairment >= .95 ? 'blocked' : 'active')
      add('rbundle', on + 10, on + 45, derived.rightImpairment >= .95 ? 'blocked' : 'active')
    }
    add('lv', on + 15 + (ectopic ? 0 : 25 * derived.leftImpairment), off, ectopic ? 'ectopic' : 'active', beat.focusIndex)
    add('rv', on + 15 + (ectopic ? 0 : 25 * derived.rightImpairment), off, ectopic ? 'ectopic' : 'active', beat.focusIndex)
    add('apex', on + 25, off + 20, ectopic ? 'ectopic' : 'active')
    add('repolLV', t.center - 2 * t.sigma, t.center + 2 * t.sigma, 'repol')
    add('repolRV', t.center - 2 * t.sigma, t.center + 2 * t.sigma, 'repol')
    map.push({ id: '_rwave', onsetMs: r.center, offsetMs: r.center, rCenter: r.center, rSigma: r.sigma, state: 'meta' })
  }
  return map
}
