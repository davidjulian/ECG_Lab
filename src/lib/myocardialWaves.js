// Schematic regional timing fields, not a measured human activation map.
// ECG wave timing supplies the clock; voltage amplitude is not tissue state.
export const TISSUE_COLORS = {
  depolarizing: [253, 224, 71], depolarized: [223, 105, 76],
  repolarizing: [56, 189, 248], ectopic: [167, 139, 250],
}
const clamp = value => Math.max(0, Math.min(1, value))
const IDS = ['ra', 'la', 'rv', 'lv']

export function buildTissueEvents(map, waves) {
  return Object.fromEntries(IDS.map(id => {
    const events = map.filter(e => e.id === id && ['active', 'ectopic', 'fusion', 'delayed'].includes(e.state))
      .sort((a, b) => a.onsetMs - b.onsetMs)
      .map((entry, index, all) => {
        const atrial = id === 'ra' || id === 'la'
        const start = entry.onsetMs
        const end = Math.max(start + 1, entry.offsetMs)
        const next = all[index + 1]?.onsetMs ?? Infinity
        const t = atrial ? null : waves.filter(w => w.name === 'T' && w.center > start && w.center < next)
          .sort((a, b) => a.center - b.center)[0]
        // Atrial recovery is not separately visible on the ECG; illustrate a
        // delayed recovery after P. Ventricular recovery follows the T window.
        const recoveryStart = Math.max(end + 1, t ? t.center - 2 * t.sigma : end + 80)
        const recoveryEnd = Math.max(recoveryStart + 1, t ? t.center + 2 * t.sigma : end + 160)
        return { start, end, recoveryStart, recoveryEnd, state: entry.state, focusIndex: entry.focusIndex }
      })
    return [id, { events, disorganized: map.some(e => e.id === id && e.state === 'shimmer') }]
  }))
}

export function latestTissueEvent(events, time, period) {
  let selected = null
  let youngest = Infinity
  for (const event of events) {
    const elapsed = ((time - event.start) % period + period) % period
    if (elapsed < youngest) { youngest = elapsed; selected = { ...event, time: event.start + elapsed } }
  }
  return selected
}

// Transparent means resting: the original artwork remains visible underneath.
export function tissueColor(event, activation, recovery) {
  if (!event) return null
  const depDuration = event.end - event.start
  const rise = Math.min(12, depDuration * .2)
  const activationTime = event.start + activation * Math.max(0, depDuration - rise)
  const recoveryDuration = event.recoveryEnd - event.recoveryStart
  const fall = Math.min(25, recoveryDuration * .25)
  const recoveryTime = Math.max(activationTime + rise, event.recoveryStart + recovery * Math.max(0, recoveryDuration - fall))
  if (event.time < activationTime || event.time >= recoveryTime + fall) return null
  if (event.time >= recoveryTime) return [...TISSUE_COLORS.repolarizing, Math.round(230 * (1 - clamp((event.time - recoveryTime) / fall)))]
  const blend = clamp((event.time - activationTime) / rise)
  const front = ['ectopic', 'fusion'].includes(event.state) ? TISSUE_COLORS.ectopic : TISSUE_COLORS.depolarizing
  return [...front.map((c, i) => Math.round(c + (TISSUE_COLORS.depolarized[i] - c) * blend)), 230]
}

// Local activation/recovery cycles form broken fronts instead of making an
// entire chamber flash together. This is an illustration, not an ionic model
// or a reconstruction of the circuits underlying the surface tracing.
export function fibrillationColor(point, time) {
  const phase = ((time / point.fibrillationPeriod + point.fibrillationPhase
    + .10 * Math.sin(time * .003 + point.fibrillationWarp)) % 1 + 1) % 1
  if (phase < .10) return [...TISSUE_COLORS.depolarizing, 245]
  if (phase < .48) return [...TISSUE_COLORS.depolarized, 225]
  if (phase < .72) return [...TISSUE_COLORS.repolarizing, Math.round(225 * (1 - (phase - .48) / .24))]
  return null
}

export function createTissueRenderer(canvas, elements) {
  // The source chamber paths all use this same local SVG coordinate system.
  const left = 230, top = 390, width = 270, height = 290
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  const frame = ctx.createImageData(width, height)
  const regions = IDS.map(id => {
    const path = new Path2D(elements[id].getAttribute('d'))
    const points = []
    let aMin = Infinity, aMax = -Infinity, rMin = Infinity, rMax = -Infinity
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x + left + .5, sy = y + top + .5
      if (!ctx.isPointInPath(path, sx, sy)) continue
      const atrial = id === 'ra' || id === 'la'
      // RA spreads from the SA region; LA starts near interatrial entry.
      // Ventricular activation sweeps from apical regions toward the base.
      // Separate curved recovery fields avoid fading along the activation path.
      const sourceX = id === 'ra' ? 280 : id === 'la' ? 405 : id === 'rv' ? 405 : 467
      const sourceY = id === 'ra' ? 425 : id === 'la' ? 412 : id === 'rv' ? 660 : 642
      const activation = Math.hypot(.8 * (sx - sourceX), sy - sourceY)
      const recovery = atrial ? activation : Math.hypot(.65 * (sx - (id === 'rv' ? 345 : 440)), sy - (id === 'rv' ? 513 : 478))
      const sources = atrial ? [[405, 415], [270, 475], [435, 475]] : [[465, 640], [325, 535], [490, 545]]
      const ectopicActivation = sources.map(([x, y]) => Math.hypot(.8 * (sx - x), sy - y))
      points.push({ ectopicActivation, offset: (y * width + x) * 4, activation, recovery,
        x: sx, y: sy,
      })
      aMin = Math.min(aMin, activation); aMax = Math.max(aMax, activation)
      rMin = Math.min(rMin, recovery); rMax = Math.max(rMax, recovery)
    }
    // Separate local wavelets: no single sweeping front or chamber-wide flash.
    // Seed locations and phases are deterministic, so pause freezes the image.
    const atrial = id === 'ra' || id === 'la'
    const seeds = Array.from({ length: atrial ? 9 : 13 }, (_, i) =>
      points[Math.floor(((i * .61803398875 + .23) % 1) * points.length)])
    const ectopicBounds = [0, 1, 2].map(i => points.reduce(([lo, hi], p) => [Math.min(lo, p.ectopicActivation[i]), Math.max(hi, p.ectopicActivation[i])], [Infinity, -Infinity]))
    for (const p of points) {
      let nearest = 0, distance = Infinity
      seeds.forEach((seed, i) => {
        const d = Math.hypot(p.x - seed.x, p.y - seed.y)
        if (d < distance) { distance = d; nearest = i }
      })
      const chamberPhase = IDS.indexOf(id) * .37
      p.fibrillationPhase = nearest * .381966 + chamberPhase - distance / 95
      p.fibrillationPeriod = (atrial ? 145 : 175) + ((nearest * 37) % 85)
      p.fibrillationWarp = nearest * 1.7 + chamberPhase
      p.ectopicActivation = p.ectopicActivation.map((v, i) => (v - ectopicBounds[i][0]) / (ectopicBounds[i][1] - ectopicBounds[i][0] || 1))
      p.activation = (p.activation - aMin) / (aMax - aMin || 1)
      p.recovery = (p.recovery - rMin) / (rMax - rMin || 1)
    }
    return { id, points }
  })
  return (time, period, timing, continuousTime = time) => {
    frame.data.fill(0)
    for (const region of regions) {
      const descriptor = timing[region.id]
      const event = latestTissueEvent(descriptor.events, time, period)
      for (const p of region.points) {
        const color = descriptor.disorganized
          ? fibrillationColor(p, continuousTime)
          : tissueColor(event, event?.focusIndex !== undefined ? p.ectopicActivation[event.focusIndex] : p.activation, p.recovery)
        if (color) frame.data.set(color, p.offset)
      }
    }
    ctx.putImageData(frame, 0, 0)
  }
}
