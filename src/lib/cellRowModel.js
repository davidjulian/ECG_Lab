// Educational one-dimensional cable source model. Cell state represents
// membrane polarization, not a net charge on an entire cell. Differences
// between neighboring states create balanced extracellular sources/sinks.
export const CELL_COUNT = 10
export const REST_BEFORE = 300
export const STEP_DELAY = 90
export const TRANS_DUR = 60
// A longer plateau separates the effects of the advancing and recovering
// boundaries while retaining overlap (the entire row never depolarizes).
export const APD = 650
export const CELL_SMOOTHING_MS = 90
export const LAST_DEPOL_END = REST_BEFORE + (CELL_COUNT - 1) * STEP_DELAY + TRANS_DUR
export const LAST_REPOL_END = LAST_DEPOL_END + APD + TRANS_DUR
export const CELL_CYCLE_MS = LAST_REPOL_END + 500
export const CENTERED_PULSE_MS = REST_BEFORE + ((CELL_COUNT - 1) * STEP_DELAY + 2 * TRANS_DUR + APD) / 2
export const CELL_WIDTH = (560 - 2 * 54 - (CELL_COUNT - 1) * 6) / CELL_COUNT
export const CELL_XS = Array.from({ length: CELL_COUNT }, (_, i) => 54 + CELL_WIDTH / 2 + i * (CELL_WIDTH + 6))
export const ROW_Y = 375 * 0.54

const smooth = f => f * f * (3 - 2 * f)
function integratedStep(x) {
  if (x <= 0) return 0
  if (x >= TRANS_DUR) return x - TRANS_DUR / 2
  const f = x / TRANS_DUR
  return TRANS_DUR * (f ** 3 - f ** 4 / 2)
}

export function cellState(i, t, smoothing = true) {
  const d = t - REST_BEFORE - i * STEP_DELAY
  if (smoothing) {
    // Centered box average, evaluated analytically. Apply the same average
    // before both drawing cells and deriving sources, so every view agrees.
    // It depends on model time, never frame history or playback speed.
    const half = CELL_SMOOTHING_MS / 2
    if (d <= -half || d >= 2 * TRANS_DUR + APD + half) return 1
    if (d >= TRANS_DUR + half && d <= TRANS_DUR + APD - half) return -1
    const averageStep = x => (integratedStep(x + half) - integratedStep(x - half)) / CELL_SMOOTHING_MS
    return Math.max(-1, Math.min(1, 1 - 2 * averageStep(d) + 2 * averageStep(d - TRANS_DUR - APD)))
  }
  if (d < 0) return 1
  if (d < TRANS_DUR) return 1 - 2 * smooth(d / TRANS_DUR)
  if (d < TRANS_DUR + APD) return -1
  if (d < 2 * TRANS_DUR + APD) return -1 + 2 * smooth((d - TRANS_DUR - APD) / TRANS_DUR)
  return 1
}

export function sourcesForStates(states) {
  const strengths = states.map(() => 0)
  for (let i = 0; i < states.length - 1; i++) {
    const difference = 3 * (states[i + 1] - states[i]) / 2
    strengths[i] -= difference
    strengths[i + 1] += difference
  }
  return strengths.map((q, i) => ({ x: CELL_XS[i], y: ROW_Y, q }))
}

export const cellSourcesAt = (t, smoothing = true) => sourcesForStates(CELL_XS.map((_, i) => cellState(i, t, smoothing)))

// A finite source radius keeps probe readings smooth near a source.
// These internal units use the same fixed mV conversion as the physics panels.
const K = 29556
export function cellPotential(x, y, sources) {
  return sources.reduce((v, c) => v + K * c.q / Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2 + 64), 0)
}

export function cellField(x, y, sources) {
  return sources.reduce(([ex, ey], c) => {
    const dx = x - c.x, dy = y - c.y
    const f = K * c.q / (dx * dx + dy * dy + 64) ** 1.5
    return [ex + f * dx, ey + f * dy]
  }, [0, 0])
}
