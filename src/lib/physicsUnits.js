// Fixed illustrative calibration; coordinates and charges use model units.
// Preserve superposition and magnitude comparisons as sources and probes move.
export const MODEL_TO_MV = 0.001
export const DOT_UNIT_TO_MV = 0.1

export function modelMillivolts(value) {
  return value * MODEL_TO_MV
}

export function formatMillivolts(value) {
  return `${(Math.abs(value) < 0.0005 ? 0 : value).toFixed(3)} mV`
}

export function gridDotProduct(a, b, pixelsPerUnit) {
  return (a.x * b.x + a.y * b.y) / (pixelsPerUnit * pixelsPerUnit)
}
