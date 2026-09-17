import Explanation from './Explanation'
import { useEffect, useRef, useState } from 'react'
import { cycleVoltage, buildRhythmFromParams, meanQRSAxis } from '../lib/ECGEngine'
import { AxisSummaryPanel } from './MeanAxisPanel'

function PlayIcon()  { return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> }
function PauseIcon() { return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg> }

const SPEEDS = [0.25, 0.5, 1]

// ── Canvas sizes ──────────────────────────────────────────────────────────────
// RENDER_SCALE resizes the actual rendered canvases relative to the
// hand-tuned body-diagram coordinates below (torso path, electrode
// positions, arrow math, etc.) — those are all still authored in the
// original *_L "logical" space. Each frame draws through a canvas transform
// that maps logical space onto the physical canvas, and mouse hit-testing
// divides back out by the same factor before comparing against electrode
// positions (which stay in logical space).
const RENDER_SCALE = 1.15
const BW_L = 500, BH_L = 330    // body canvas — logical drawing space
const EW_L = 500, EH_L = 150    // ECG strip canvas — logical drawing space
const BW = Math.round(BW_L * RENDER_SCALE), BH = Math.round(BH_L * RENDER_SCALE)   // actual body canvas pixels
const EW = Math.round(EW_L * RENDER_SCALE), EH = Math.round(EH_L * RENDER_SCALE)   // actual ECG canvas pixels

// Cardiac dipole origin (center of chest in body canvas coords)
const CX = 250, CY = 158

// How many px = 1 mV on the body diagram dipole arrow
const DIPOLE_SCALE = 52

// ECG strip constants
const PX_MS = 0.20
const PX_MV = 45
// Baseline sits lower than center since the R wave (up to 1.5mV) swings much
// further above baseline than the Q/S waves swing below it — this leaves
// enough headroom on both sides that the trace no longer clips the top edge.
const BL    = 0.62          // baseline y-fraction in ECG canvas

// Slows the whole animation down relative to real time so the cardiac vector
// and its projection are easier to follow (1 = real-time heart rate).
const TIME_SCALE = 0.5

// Pre-built rhythm (normal sinus, constant — only lead axis changes)
const RHYTHM = buildRhythmFromParams({
  saNodeRate: 70, avConductionRatio: 'all', prInterval: 160,
  qrsDuration: 80, qtInterval: 380, pWaveMode: 'present', escapeRhythm: 'none',
})

// Standard Einthoven electrode positions on body canvas
const EIN = {
  RA: { x: 138, y: 105 },
  LA: { x: 362, y: 105 },
  LL: { x: 250, y: 105 + 112 * Math.sqrt(3) },
}
const EIN_LEADS = [
  { a: 'RA', b: 'LA', label: 'I',   color: '#60a5fa' },
  { a: 'RA', b: 'LL', label: 'II',  color: '#34d399' },
  { a: 'LA', b: 'LL', label: 'III', color: '#f472b6' },
]

const AUGMENTED = {
  aVR: { positive: 'RA', reference: ['LA', 'LL'] },
  aVL: { positive: 'LA', reference: ['RA', 'LL'] },
  aVF: { positive: 'LL', reference: ['RA', 'LA'] },
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
// Anatomical placement key, separate from the idealized lead geometry.
function drawBodyKey(ctx, augmented) {
  ctx.save()
  ctx.strokeStyle = '#334155'; ctx.fillStyle = '#0f172a'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.ellipse(62, 90, 13, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(48, 111); ctx.lineTo(30, 117); ctx.lineTo(16, 171)
  ctx.lineTo(29, 175); ctx.lineTo(44, 139); ctx.lineTo(42, 177)
  ctx.lineTo(38, 239); ctx.lineTo(55, 239); ctx.lineTo(62, 188)
  ctx.lineTo(69, 239); ctx.lineTo(86, 239); ctx.lineTo(82, 177)
  ctx.lineTo(80, 139); ctx.lineTo(95, 175); ctx.lineTo(108, 171)
  ctx.lineTo(94, 117); ctx.lineTo(76, 111); ctx.closePath(); ctx.fill(); ctx.stroke()
  const sites = { RA: { x: 24, y: 160 }, LA: { x: 100, y: 160 }, LL: { x: 78, y: 228 } }
  for (const [id, p] of Object.entries(sites)) {
    ctx.fillStyle = augmented ? (id === augmented.positive ? '#60a5fa' : '#fbbf24') : '#94a3b8'
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(id, p.x, p.y + (id === 'LL' ? 23 : -10))
  }
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Body locations', 62, 59)
  ctx.fillText('Front view', 62, 269)
  ctx.restore()
}

function drawArrow(ctx, x1, y1, x2, y2, color, width, glow) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return
  const ux = dx / len, uy = dy / len
  const headLen = Math.min(14, len * 0.35)

  if (glow) {
    ctx.shadowColor  = color
    ctx.shadowBlur   = 10
  }

  ctx.strokeStyle = color
  ctx.lineWidth   = width
  ctx.lineCap     = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2 - headLen * ux * 0.6, y2 - headLen * uy * 0.6)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * (ux + 0.42 * uy), y2 - headLen * (uy - 0.42 * ux))
  ctx.lineTo(x2 - headLen * (ux - 0.42 * uy), y2 - headLen * (uy + 0.42 * ux))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  ctx.shadowBlur = 0
}

function projectPointOntoLine(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: ax, y: ay, t: 0 }
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  return { x: ax + t * dx, y: ay + t * dy, t }
}

function drawGrid(ctx, w, h) {
  const by = h * BL
  const step = 40 * PX_MS
  ctx.lineWidth = 1
  let i = 0
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.07)'
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = 'rgba(16,185,129,0.07)'
  for (let y = by; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = by; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(w, by); ctx.stroke()
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadPlacementLab() {
  const bodyRef = useRef(null)
  const ECGRef  = useRef(null)

  // Live info panel refs (avoid state re-renders)
  const angleRef    = useRef(null)
  const dotRef      = useRef(null)
  const projRef     = useRef(null)
  const vPlusRef    = useRef(null)
  const vMinusRef   = useRef(null)
  const scrubRef      = useRef(null)
  const scrubLabelRef = useRef(null)
  const scrubbingRef  = useRef(false)

  // Electrode positions (mutable ref — no re-render on drag)
  const elec = useRef({
    plus:  { x: 330, y: 272 },
    minus: { x: 138, y: 105 },
  })
  const dragging   = useRef(null)   // 'plus' | 'minus' | null

  // RHYTHM is a fixed module constant, so its OWN (unrotated) mean axis is
  // fixed too — compute once per render (cheap) rather than per animation
  // frame. The Cardiac Vector Axis slider below then rotates this by
  // `axisRotation` for display (see rotatedAxis).
  const baseAxis = meanQRSAxis(RHYTHM.waves)

  const [overlay, setOverlay] = useState('standard')
  const [augmentedLead, setAugmentedLead] = useState('aVF')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(TIME_SCALE)
  // Degrees added to every wave's axis, i.e. rotates the whole instantaneous
  // cardiac vector (and its P/QRS/T loop) rigidly, independent of electrode
  // placement — lets the axis-deviation scenario be explored without moving
  // the leads.
  const [axisRotation, setAxisRotation] = useState(0)

  // Track state in refs for use inside rAF without re-subscribing the loop
  const overlayRef = useRef(overlay)
  const augmentedRef = useRef(augmentedLead)
  const playingRef = useRef(playing)
  const speedRef   = useRef(speed)
  const rotationRef = useRef(axisRotation)
  useEffect(() => { overlayRef.current = overlay; dragging.current = null }, [overlay])
  useEffect(() => { augmentedRef.current = augmentedLead }, [augmentedLead])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { rotationRef.current = axisRotation }, [axisRotation])

  // A wave's contribution to a lead reading depends only on the DIFFERENCE
  // between its own axis and the lead's axis (see cycleVoltage's
  // projectionFactor), so subtracting `rot` from every lead axis we query is
  // mathematically identical to adding `rot` to every wave's own axis —
  // rotating the whole cardiac vector without touching ECGEngine.js at all.
  // Reused for the live vectors below and for the static mean-axis display.
  const rotRad = axisRotation * Math.PI / 180
  const rotatedAxis = {
    angleDeg:  (((baseAxis.angleDeg + axisRotation) + 180) % 360 + 360) % 360 - 180,
    leadIMm:   baseAxis.leadIMm * Math.cos(rotRad) - baseAxis.leadAVFMm * Math.sin(rotRad),
    leadAVFMm: baseAxis.leadIMm * Math.sin(rotRad) + baseAxis.leadAVFMm * Math.cos(rotRad),
  }

  // Accumulated simulation time (ms) — advances only while playing, at the
  // current speed multiplier, so pausing freezes it and changing speed
  // never causes a jump in the animation.
  const simTimeRef = useRef(0)
  const lastTsRef  = useRef(null)

  useEffect(() => {
    const bodyCanvas = bodyRef.current
    const ECGCanvas  = ECGRef.current
    const bCtx = bodyCanvas.getContext('2d')
    const eCtx = ECGCanvas.getContext('2d')
    let animId

    const { waves, cycleMs, nativeCycleMs } = RHYTHM

    const frame = (ts) => {
      if (lastTsRef.current === null) lastTsRef.current = ts
      const dtReal = ts - lastTsRef.current
      lastTsRef.current = ts
      if (playingRef.current && !scrubbingRef.current) simTimeRef.current += dtReal * speedRef.current
      const elapsed = simTimeRef.current
      const tMs = ((elapsed % cycleMs) + cycleMs) % cycleMs

      // Keep the scrub slider's thumb following playback, unless the user is
      // actively dragging it (in which case its own onChange drives simTimeRef).
      if (!scrubbingRef.current) {
        if (scrubRef.current) scrubRef.current.value = String(Math.round(tMs))
      }
      if (scrubLabelRef.current) scrubLabelRef.current.textContent = `${Math.round(tMs)} / ${Math.round(cycleMs)} ms`

      const augmented = overlayRef.current === 'augmented' ? AUGMENTED[augmentedRef.current] : null
      const refs = augmented?.reference.map(id => EIN[id])
      const plus = augmented ? EIN[augmented.positive] : elec.current.plus
      const minus = augmented ? { x: (refs[0].x + refs[1].x) / 2, y: (refs[0].y + refs[1].y) / 2 } : elec.current.minus
      const dx = plus.x - minus.x
      const dy = plus.y - minus.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const ux = dx / dist, uy = dy / dist
      const leadAxisDeg = Math.atan2(dy, dx) * 180 / Math.PI
      const rot = rotationRef.current

      // Cardiac vector components (Lead I=x, aVF=y) — querying at
      // (0 - rot)/(90 - rot) instead of 0/90 rotates the whole cardiac
      // vector by `rot` (see the rotationRef comment above).
      const Vx = cycleVoltage(tMs * (nativeCycleMs ?? cycleMs) / cycleMs, waves, 0 - rot)
      const Vy = cycleVoltage(tMs * (nativeCycleMs ?? cycleMs) / cycleMs, waves, 90 - rot)

      // Dot product = projection of cardiac vector onto lead axis. This is the
      // voltage the lead actually records; we present it to the student as a
      // difference between two electrode readings (split symmetrically around
      // the body's electrical center) so it's clear ΔV = V(+) − V(−) is what
      // drives the trace, not some abstract unexplained number.
      const projection = Vx * ux + Vy * uy
      const gain = augmented ? dist / 224 : 1
      // Linear potential model: derived references average the two limb inputs.
      const limbPotential = pos => (Vx * (pos.x - 250) + Vy * (pos.y - (105 + 112 / Math.sqrt(3)))) / 224
      const vPlus = augmented ? limbPotential(plus) : projection / 2
      const vMinus = augmented ? (limbPotential(refs[0]) + limbPotential(refs[1])) / 2 : -projection / 2
      const dotProd = vPlus - vMinus

      // Angle between cardiac vector and lead axis
      const vMag   = Math.sqrt(Vx * Vx + Vy * Vy)
      const cosTheta = vMag > 0.001 ? Math.max(-1, Math.min(1, projection / vMag)) : 0
      const thetaDeg = Math.acos(cosTheta) * 180 / Math.PI

      // ── Body canvas ────────────────────────────────────────────────────
      bCtx.setTransform(1, 0, 0, 1, 0, 0)
      bCtx.clearRect(0, 0, BW, BH)
      bCtx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
      bCtx.fillStyle = '#64748b'
      bCtx.font = '11px sans-serif'
      bCtx.textAlign = 'center'
      bCtx.fillText('Lead geometry (schematic)', 300, 24)
      drawBodyKey(bCtx, augmented)

      // Einthoven triangle
      if (overlayRef.current !== 'none') {
        if (!augmented) EIN_LEADS.forEach(({ a, b, label, color }) => {
          bCtx.strokeStyle = color + '55'
          bCtx.lineWidth   = 1.5
          bCtx.setLineDash([5, 4])
          bCtx.beginPath()
          bCtx.moveTo(EIN[a].x, EIN[a].y)
          bCtx.lineTo(EIN[b].x, EIN[b].y)
          bCtx.stroke()
          bCtx.setLineDash([])
          // Label at midpoint
          const mx = (EIN[a].x + EIN[b].x) / 2
          const my = (EIN[a].y + EIN[b].y) / 2
          bCtx.fillStyle = color + 'cc'
          bCtx.font = 'bold 11px monospace'
          bCtx.textAlign = 'center'
          bCtx.fillText(`Lead ${label}`, mx + (label === 'I' ? 0 : label === 'II' ? -22 : 22), my)
        })
        // Einthoven electrode dots
        Object.entries(EIN).forEach(([id, pos]) => {
          bCtx.beginPath()
          bCtx.arc(pos.x, pos.y, 5, 0, Math.PI * 2)
          bCtx.fillStyle = '#475569'
          bCtx.fill()
          bCtx.fillStyle = '#94a3b8'
          bCtx.font = '9px monospace'
          bCtx.textAlign = 'center'
          bCtx.fillText(id, pos.x, pos.y - 9)
        })

        // ── Mean QRS axis arrow — bold, bright, distinct from the indigo
        // instantaneous vector below. Same (Lead I, aVF) axis convention as
        // Vx/Vy, just built from the net QRS deflection instead of one
        // instant, then rotated by `rot` the same way Vx/Vy are.
        const { leadINet: baseI, leadAVFNet: baseAVF } = meanQRSAxis(waves)
        const rotR = rot * Math.PI / 180
        const leadINet  = baseI * Math.cos(rotR) - baseAVF * Math.sin(rotR)
        const leadAVFNet = baseI * Math.sin(rotR) + baseAVF * Math.cos(rotR)
        const meanAngle = (((Math.atan2(baseAVF, baseI) * 180 / Math.PI + rot) + 180) % 360 + 360) % 360 - 180
        const meanTipX = CX + leadINet  * DIPOLE_SCALE
        const meanTipY = CY + leadAVFNet * DIPOLE_SCALE
        drawArrow(bCtx, CX, CY, meanTipX, meanTipY, '#facc15', 4, true)
        bCtx.fillStyle = '#facc15'
        bCtx.font = 'bold 10px monospace'
        bCtx.textAlign = 'center'
        bCtx.fillText(`Mean QRS Axis ${meanAngle >= 0 ? '+' : ''}${meanAngle.toFixed(0)}°`, meanTipX, meanTipY - 10)
      }

      // Lead axis — extend across full canvas
      {
        bCtx.save()
        bCtx.beginPath(); bCtx.rect(125, 40, BW_L - 125, BH_L - 40); bCtx.clip()
        const extend = 600
        const ax = minus.x - ux * extend, ay = minus.y - uy * extend
        const bx = minus.x + ux * extend, by = minus.y + uy * extend
        bCtx.strokeStyle = 'rgba(100,116,139,0.35)'
        bCtx.lineWidth   = 1
        bCtx.setLineDash([8, 6])
        bCtx.beginPath()
        bCtx.moveTo(ax, ay)
        bCtx.lineTo(bx, by)
        bCtx.stroke()
        bCtx.setLineDash([])
        bCtx.restore()
      }

      // ── Cardiac vector ──────────────────────────────────────────────────
      const vsx = Vx * DIPOLE_SCALE, vsy = Vy * DIPOLE_SCALE
      const tipX = CX + vsx, tipY = CY + vsy

      // Small origin circle
      bCtx.beginPath()
      bCtx.arc(CX, CY, 4, 0, Math.PI * 2)
      bCtx.fillStyle = 'rgba(99,102,241,0.4)'
      bCtx.fill()

      // Draw arrow only when magnitude is visible
      if (vMag > 0.03) {
        drawArrow(bCtx, CX, CY, tipX, tipY, '#818cf8', 2.5, true)
      }

      // ── Projection visualization ────────────────────────────────────────
      if (vMag > 0.03) {
        // Foot of perpendicular from DIPOLE TIP to lead axis
        const foot = projectPointOntoLine(tipX, tipY, minus.x, minus.y, plus.x, plus.y)

        // Origin projected onto lead axis
        const orig = projectPointOntoLine(CX, CY, minus.x, minus.y, plus.x, plus.y)

        // Dashed perpendicular from tip to foot
        bCtx.setLineDash([4, 4])
        bCtx.strokeStyle = 'rgba(148,163,184,0.55)'
        bCtx.lineWidth   = 1.5
        bCtx.beginPath()
        bCtx.moveTo(tipX, tipY)
        bCtx.lineTo(foot.x, foot.y)
        bCtx.stroke()
        bCtx.setLineDash([])

        // Projected component segment on lead axis (colored by sign)
        const projColor = dotProd >= 0 ? '#3b82f6' : '#f59e0b'
        bCtx.strokeStyle = projColor
        bCtx.lineWidth   = 5
        bCtx.lineCap     = 'round'
        bCtx.shadowColor = projColor
        bCtx.shadowBlur  = 8
        bCtx.beginPath()
        bCtx.moveTo(orig.x, orig.y)
        bCtx.lineTo(foot.x, foot.y)
        bCtx.stroke()
        bCtx.shadowBlur  = 0

        // Right-angle tick at foot
        const perpLen = 6
        bCtx.strokeStyle = 'rgba(148,163,184,0.7)'
        bCtx.lineWidth   = 1.5
        bCtx.beginPath()
        bCtx.moveTo(foot.x - perpLen * uy, foot.y + perpLen * ux)
        bCtx.lineTo(foot.x + perpLen * uy, foot.y - perpLen * ux)
        bCtx.stroke()

        // ΔV label on the projected segment itself, so the number is tied
        // directly to the visual segment that represents it.
        const midX = (orig.x + foot.x) / 2, midY = (orig.y + foot.y) / 2
        bCtx.fillStyle = projColor
        bCtx.font = 'bold 11px monospace'
        bCtx.textAlign = 'center'
        bCtx.fillText(`ΔV = ${dotProd.toFixed(2)} mV`, midX - 14 * uy, midY + 14 * ux)
      }

      // ── Electrodes ─────────────────────────────────────────────────────
      const drawElectrode = (pos, label, color) => {
        bCtx.beginPath()
        bCtx.arc(pos.x, pos.y, 11, 0, Math.PI * 2)
        bCtx.fillStyle = color + '33'
        bCtx.fill()
        bCtx.strokeStyle = color
        bCtx.lineWidth   = 2
        bCtx.stroke()
        bCtx.fillStyle   = color
        bCtx.font        = 'bold 13px monospace'
        bCtx.textAlign   = 'center'
        bCtx.textBaseline = 'middle'
        bCtx.fillText(label, pos.x, pos.y)
        bCtx.textBaseline = 'alphabetic'
      }
      drawElectrode(plus,  '+', '#3b82f6')
      if (!augmented) drawElectrode(minus, '−', '#f59e0b')
      if (augmented) {
        // Dashed connections lead to an explicit arithmetic reference box,
        // never an extra physical electrode at the geometric midpoint.
        const box = { x: 371, y: 222, w: 123, h: 66 }
        refs.forEach((pos, i) => {
          drawElectrode(pos, '', '#f59e0b')
          bCtx.fillStyle = '#fbbf24'; bCtx.font = '10px monospace'; bCtx.textAlign = 'center'
          bCtx.fillText(`${limbPotential(pos).toFixed(3)} mV`, pos.x, pos.y + 24)
          bCtx.setLineDash([4, 4]); bCtx.strokeStyle = '#f59e0b88'; bCtx.lineWidth = 1
          bCtx.beginPath(); bCtx.moveTo(pos.x, pos.y)
          bCtx.lineTo(box.x, box.y + 16 + i * 20); bCtx.stroke(); bCtx.setLineDash([])
        })
        bCtx.fillStyle = '#111827'; bCtx.fillRect(box.x, box.y, box.w, box.h)
        bCtx.strokeStyle = '#f59e0b'; bCtx.strokeRect(box.x, box.y, box.w, box.h)
        bCtx.textAlign = 'center'; bCtx.font = '10px sans-serif'; bCtx.fillStyle = '#fbbf24'
        bCtx.fillText('Average reference (−)', box.x + box.w / 2, box.y + 16)
        bCtx.fillText(`(${augmented.reference.join(' + ')}) / 2`, box.x + box.w / 2, box.y + 33)
        bCtx.fillText(`${vMinus.toFixed(3)} mV`, box.x + box.w / 2, box.y + 51)
      }

      // Per-electrode voltage readout — the actual numbers being differenced
      // to produce ΔV, shown right at the electrode that reads them.
      bCtx.font      = 'bold 10px monospace'
      bCtx.textAlign = 'center'
      bCtx.fillStyle = '#60a5fa'
      bCtx.fillText(`${vPlus >= 0 ? '+' : ''}${vPlus.toFixed(2)} mV`, plus.x, plus.y + 24)
      bCtx.fillStyle = '#fbbf24'
      if (!augmented) bCtx.fillText(`${vMinus >= 0 ? '+' : ''}${vMinus.toFixed(2)} mV`, minus.x, minus.y + 24)

      // ── Live info panel update ──────────────────────────────────────────
      if (angleRef.current)  angleRef.current.textContent  = `${thetaDeg.toFixed(1)}°`
      if (dotRef.current)    dotRef.current.textContent    = dotProd.toFixed(3) + ' mV'
      if (vPlusRef.current)  vPlusRef.current.textContent  = `${vPlus >= 0 ? '+' : ''}${vPlus.toFixed(3)} mV`
      if (vMinusRef.current) vMinusRef.current.textContent = `${vMinus >= 0 ? '+' : ''}${vMinus.toFixed(3)} mV`
      if (projRef.current) {
        const percent = (Math.abs(cosTheta) * 100).toFixed(0)
        projRef.current.textContent = `${percent}% of max`
      }

      // ── ECG strip ──────────────────────────────────────────────────────
      eCtx.setTransform(1, 0, 0, 1, 0, 0)
      eCtx.clearRect(0, 0, EW, EH)
      eCtx.fillStyle = '#030712'
      eCtx.fillRect(0, 0, EW, EH)
      eCtx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
      drawGrid(eCtx, EW_L, EH_L)

      const by = EH_L * BL
      eCtx.beginPath()
      for (let x = 0; x <= EW_L; x++) {
        const v = gain * cycleVoltage(((x / PX_MS) % cycleMs) * (nativeCycleMs ?? cycleMs) / cycleMs, waves, leadAxisDeg - rot)
        const y = by - v * PX_MV
        if (x === 0) eCtx.moveTo(x, y); else eCtx.lineTo(x, y)
      }
      eCtx.strokeStyle = '#10b981'
      eCtx.lineWidth   = 2
      eCtx.lineJoin    = 'round'
      eCtx.stroke()

      // Sweep through a complete central beat using the same phase as the
      // instantaneous cardiac vector. The trace stays still for inspection.
      const cursorCycle = Math.max(0, Math.round((EW_L / PX_MS / cycleMs - 1) / 2))
      const cursorX = (cursorCycle * cycleMs + tMs) * PX_MS
      const cursorY = by - dotProd * PX_MV
      eCtx.strokeStyle = '#a5b4fc'
      eCtx.lineWidth = 1.5
      eCtx.beginPath()
      eCtx.moveTo(cursorX, 0)
      eCtx.lineTo(cursorX, EH_L)
      eCtx.stroke()
      eCtx.fillStyle = '#a5b4fc'
      eCtx.beginPath()
      eCtx.arc(cursorX, cursorY, 3.5, 0, Math.PI * 2)
      eCtx.fill()

      animId = requestAnimationFrame(frame)
    }

    animId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animId)
  }, [])

  // ── Drag handling ─────────────────────────────────────────────────────────
  const HIT_R = 18

  // Mouse position arrives in real device pixels (0..BW); divide by
  // RENDER_SCALE to land back in the logical space electrode positions are
  // actually stored/drawn in (0..BW_L) — see the RENDER_SCALE comment above.
  const onMouseDown = (e) => {
    if (overlayRef.current === 'augmented') return
    const rect = bodyRef.current.getBoundingClientRect()
    const scaleX = BW / rect.width
    const scaleY = BH / rect.height
    const mx = (e.clientX - rect.left) * scaleX / RENDER_SCALE
    const my = (e.clientY - rect.top)  * scaleY / RENDER_SCALE
    const { plus, minus } = elec.current
    const dPlus  = Math.hypot(mx - plus.x,  my - plus.y)
    const dMinus = Math.hypot(mx - minus.x, my - minus.y)
    if (dPlus  < HIT_R) dragging.current = 'plus'
    else if (dMinus < HIT_R) dragging.current = 'minus'
  }

  const onMouseMove = (e) => {
    if (!dragging.current) return
    const rect = bodyRef.current.getBoundingClientRect()
    const scaleX = BW / rect.width
    const scaleY = BH / rect.height
    const mx = (e.clientX - rect.left) * scaleX / RENDER_SCALE
    const my = (e.clientY - rect.top)  * scaleY / RENDER_SCALE
    elec.current[dragging.current] = {
      x: Math.max(10, Math.min(BW_L - 10, mx)),
      y: Math.max(10, Math.min(BH_L - 10, my)),
    }
  }

  const onMouseUp = () => { dragging.current = null }

  const onTouchStart = (e) => {
    e.preventDefault()
    onMouseDown(e.touches[0])
  }
  const onTouchMove = (e) => {
    e.preventDefault()
    onMouseMove(e.touches[0])
  }

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">

      {/* Header */}
      <div className="px-3 pt-2.5 pb-1.5 border-b border-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Lead Placement Lab</h3>
            <p className="text-xs text-gray-400 leading-relaxed max-w-lg">
              Explore a movable electrode pair or select an augmented limb lead.
              The ECG plots ΔV = V(+) − V(−). Cardiac Vector Axis rotates the source.
            </p>
          </div>

        </div>
      </div>

      {/* Playback controls */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => setPlaying(v => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            playing
              ? 'bg-gray-800 text-gray-300 border-gray-700'
              : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
          }`}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-widest text-gray-600 mr-0.5">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded-md text-xs font-mono border transition-colors ${
                speed === s
                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50'
                  : 'text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Scrub through the cardiac cycle */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-gray-600 shrink-0">Scrub</span>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={Math.round(RHYTHM.cycleMs)}
          defaultValue={0}
          step={1}
          onMouseDown={() => { scrubbingRef.current = true; setPlaying(false) }}
          onTouchStart={() => { scrubbingRef.current = true; setPlaying(false) }}
          onMouseUp={() => { scrubbingRef.current = false }}
          onTouchEnd={() => { scrubbingRef.current = false }}
          onChange={e => { setPlaying(false); simTimeRef.current = Number(e.target.value) }}
          aria-label="Cycle time"
          className="flex-1 min-w-[120px] accent-cyan-500"
        />
        <span ref={scrubLabelRef} className="text-xs font-mono text-gray-500 tabular-nums w-28 text-right">
          0 / {Math.round(RHYTHM.cycleMs)} ms
        </span>
      </div>

      {/* Rotate the cardiac vector itself, independent of electrode placement */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-gray-600 shrink-0">Cardiac Vector Axis</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={axisRotation}
          onChange={e => setAxisRotation(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-amber-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-28 text-right">
          {axisRotation >= 0 ? '+' : ''}{axisRotation}° {axisRotation !== 0 && '(rotated)'}
        </span>
      </div>

      <div className="flex gap-0">
        {/* Left column: body canvas + ECG strip stacked below it, so the
            strip fills the space the (taller) info panel would otherwise
            leave blank next to a shorter canvas, instead of repeating as a
            separate full-width section underneath everything. */}
        <div className="flex-1 min-w-0">
          <div className="relative">
            <div className="px-3 py-2 bg-gray-900/60 flex items-center gap-2 flex-wrap text-xs">
              <label htmlFor="lead-overlay" className="text-gray-400">Lead diagram</label>
              <select id="lead-overlay" value={overlay} onChange={e => setOverlay(e.target.value)} className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-gray-200">
                <option value="none">None</option><option value="standard">I–III</option><option value="augmented">Augmented</option>
              </select>
              {overlay === 'augmented' && <select aria-label="Augmented lead" value={augmentedLead} onChange={e => setAugmentedLead(e.target.value)} className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-gray-200">
                {Object.keys(AUGMENTED).map(lead => <option key={lead}>{lead}</option>)}
              </select>}
              <span className="text-gray-400">{overlay === 'augmented' ? `${augmentedLead} = ${AUGMENTED[augmentedLead].positive} − (${AUGMENTED[augmentedLead].reference.join(' + ')}) / 2` : 'Drag + and − to explore'}</span>
            </div>
            <canvas
              ref={bodyRef}
              width={BW}
              height={BH}
              style={{ width: '100%', maxWidth: BW, display: 'block', cursor: overlay === 'augmented' ? 'default' : 'grab', backgroundColor: '#030712' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onMouseUp}
            />
            {/* Floating annotation */}
            <div className="px-3 py-2 pointer-events-none">
              <p className="text-xs text-gray-600 text-center font-mono">
                {overlay === 'augmented' ? 'Dashed lines combine electrode potentials into a calculated reference' : 'Electrode spacing is schematic; explore lead direction'}
              </p>
            </div>
          </div>

          {/* ECG strip */}
          <div className="border-t border-gray-800">
            <div className="flex items-center gap-3 px-3 pt-2.5 pb-1">
              <p className="text-xs uppercase tracking-widest text-gray-600">Live ECG output</p>
              <span className="text-xs text-indigo-300">Line = current instant</span>

            </div>
            <canvas
              ref={ECGRef}
              width={EW}
              height={EH}
              style={{ width: '100%', maxWidth: EW, display: 'block', backgroundColor: '#030712' }}
            />
            <p className="text-xs text-gray-700 text-right px-3 pb-2">40 ms / square · 0.5 mV / square</p>
          </div>
        </div>

        {/* Info panel */}
        <div className="w-64 shrink-0 bg-gray-900/80 border-l border-gray-800 p-4 flex flex-col gap-4 justify-center">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Angle θ</p>
              <p ref={angleRef} className="text-lg font-bold font-mono text-white tabular-nums">—</p>
              <p className="text-xs text-gray-600">between dipole &amp; lead axis</p>
            </div>
            <div className="rounded-lg bg-gray-900/70 border border-gray-800 px-2.5 py-2">
              <p className="text-xs text-gray-500 mb-1">Electrode voltages</p>
              <p className="text-xs font-mono tabular-nums"><span className="text-blue-400">V(+)</span> <span ref={vPlusRef} className="text-blue-300">—</span></p>
              <p className="text-xs font-mono tabular-nums"><span className="text-amber-400">{overlay === 'augmented' ? 'V(reference)' : 'V(−)'}</span> <span ref={vMinusRef} className="text-amber-300">—</span></p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">ΔV = V(+) − V(−)</p>
              <p ref={dotRef} className="text-lg font-bold font-mono text-blue-400 tabular-nums">—</p>
              <p className="text-xs text-gray-600">this is what the ECG plots</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Efficiency</p>
              <p ref={projRef} className="text-lg font-bold font-mono text-emerald-400 tabular-nums">—</p>
              <p className="text-xs text-gray-600">cosθ × 100</p>
            </div>
          </div>

          <Explanation>
            <p>The lead records the projection of the cardiac vector onto its direction.
              A parallel vector gives the largest positive contribution, a perpendicular vector
              gives zero contribution at that instant, and an opposite vector gives a negative contribution.</p>
            <p className="mt-2">Exchanging the recording connections reverses the sign of ΔV.
              Rotating the source can also change its sign while the connections stay fixed.</p>
          </Explanation>

          {overlay !== 'none' && (
            <div className="border-t border-gray-800 pt-3">
              <AxisSummaryPanel angleDeg={rotatedAxis.angleDeg} leadIMm={rotatedAxis.leadIMm} leadAVFMm={rotatedAxis.leadAVFMm} />
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
