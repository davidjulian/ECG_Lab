// Illustrative frontal cardiac vector model, independent of the physiology simulator.
// Smooth regional contributions create a changing vector; units are mV-equivalent.
export const QRS_MS = 100
export const FRONTAL_LEADS = [
  { name: 'I', angle: 0 }, { name: 'II', angle: 60 },
  { name: 'III', angle: 120 }, { name: 'aVR', angle: -150 },
  { name: 'aVL', angle: -30 }, { name: 'aVF', angle: 90 },
]
const rad = degrees => degrees * Math.PI / 180
export function vectorAt(time, rotation = 0) {
  const components = [
    { start: 0, end: 32, amplitude: 0.24, angle: -135 },
    { start: 12, end: 82, amplitude: 1.25, angle: 50 },
    { start: 48, end: 100, amplitude: 0.38, angle: 135 },
  ]
  return components.reduce((v, c) => {
    const phase = (time - c.start) / (c.end - c.start)
    const magnitude = phase > 0 && phase < 1 ? c.amplitude * Math.sin(Math.PI * phase) ** 2 : 0
    return { x: v.x + magnitude * Math.cos(rad(c.angle + rotation)), y: v.y + magnitude * Math.sin(rad(c.angle + rotation)) }
  }, { x: 0, y: 0 })
}
export const project = (v, angle) => v.x * Math.cos(rad(angle)) + v.y * Math.sin(rad(angle))
export function averageVector(rotation = 0, through = QRS_MS) {
  // Partial contributions use the same full-QRS denominator: they add to the final mean.
  const end = Math.max(0, Math.min(QRS_MS, through))
  let x = 0, y = 0
  for (let t = 0; t < end; t += 0.25) {
    const next = Math.min(t + 0.25, end)
    const a = vectorAt(t, rotation), b = vectorAt(next, rotation)
    x += (a.x + b.x) * (next - t) / 2 / QRS_MS
    y += (a.y + b.y) * (next - t) / 2 / QRS_MS
  }
  return { x, y, angle: Math.atan2(y, x) * 180 / Math.PI }
}

// One shared full-cycle source: the QRS window is exactly vectorAt(t - QRS_START).
export const CYCLE_MS = 800
export const QRS_START = 200
export const PHASES = [
  { name: 'P', start: 40, end: 140, color: '#60a5fa', description: 'Atrial depolarization' },
  { name: 'QRS', start: QRS_START, end: QRS_START + QRS_MS, color: '#c4b5fd', description: 'Ventricular depolarization' },
  { name: 'T', start: 380, end: 580, color: '#fb923c', description: 'Ventricular repolarization' },
]
export function cycleVectorAt(time, rotation = 0) {
  const qrs = vectorAt(time - QRS_START, rotation)
  // Overlapping contributions with different orientations give P and T changing directions.
  const components = [
    { start: 40, end: 115, amplitude: 0.12, angle: 30 },
    { start: 65, end: 140, amplitude: 0.13, angle: 80 },
    { start: 380, end: 540, amplitude: 0.24, angle: 35 },
    { start: 420, end: 580, amplitude: 0.20, angle: 85 },
  ]
  return components.reduce((v, c) => {
    const phase = (time - c.start) / (c.end - c.start)
    const magnitude = phase > 0 && phase < 1 ? c.amplitude * Math.sin(Math.PI * phase) ** 2 : 0
    return { x: v.x + magnitude * Math.cos(rad(c.angle + rotation)), y: v.y + magnitude * Math.sin(rad(c.angle + rotation)) }
  }, qrs)
}
