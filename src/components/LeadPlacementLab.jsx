import { GRID_MINOR, GRID_MAJOR, BASELINE } from '../lib/diagramColors'
import Explanation from './Explanation'
import { useEffect, useRef, useState } from 'react'
import { cycleVoltage, buildRhythmFromParams } from '../lib/ECGEngine'

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
const CX = 284, CY = 143.25

// How many px = 1 mV on the body diagram dipole arrow
const DIPOLE_SCALE = 34

// ECG strip constants
const PX_MS = 0.20
const PX_MV = 40
// Symmetric headroom keeps either polarity visible when leads are reversed.
const BL    = 0.5          // baseline y-fraction in ECG canvas

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
  RA: { x: 244, y: 100.5 },
  LA: { x: 340, y: 100.5 },
  LL: { x: 324, y: 186 },
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
// Front-facing figure with a natural stance. Limb connections are schematic.
const BODY_POINTS = [[48,111],[30,117],[16,171],[29,175],[44,139],[42,177],[38,239],[55,239],[62,188],[69,239],[86,239],[82,177],[80,139],[95,175],[108,171],[94,117],[76,111]].map(([x,y]) => ({x:168+2*x,y:-79.5+1.5*y}))
function onBody(x,y) {
  let inside=false
  for(let i=0,j=BODY_POINTS.length-1;i<BODY_POINTS.length;j=i++) {
    const a=BODY_POINTS[i],b=BODY_POINTS[j]
    if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside
  }
  return inside
}
function drawBody(ctx) {
  ctx.save(); ctx.fillStyle='#0f172a'; ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.5
  ctx.beginPath(); ctx.ellipse(292,55.5,26,25.5,0,0,Math.PI*2); ctx.fill();ctx.stroke()
  ctx.beginPath(); BODY_POINTS.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.stroke()
  ctx.restore()
}
function drawConnections(ctx, augmented) {
  const sites={RA:{x:28,y:95},LA:{x:143.2,y:95},LL:{x:124,y:197.6}}
  ctx.save();ctx.textAlign='center';ctx.font='10px sans-serif';ctx.fillStyle='#94a3b8'
  ctx.fillText('Electrode connections',86,24)
  if (augmented) {
    // Keep the placement outline faint, then show the selected derived lead.
    ctx.strokeStyle='#334155';ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(sites.RA.x,sites.RA.y);ctx.lineTo(sites.LA.x,sites.LA.y);ctx.lineTo(sites.LL.x,sites.LL.y);ctx.closePath();ctx.stroke()
    const [a,b]=augmented.reference.map(id=>sites[id])
    const reference={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
    const positive=sites[augmented.positive]
    ctx.strokeStyle='#fbbf24';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([])
    drawArrow(ctx,reference.x,reference.y,positive.x,positive.y,'#60a5fa',2,false)
    // A hollow diamond marks a calculated reference, not an electrode.
    ctx.fillStyle='#030712';ctx.strokeStyle='#fbbf24';ctx.beginPath()
    ctx.moveTo(reference.x,reference.y-5);ctx.lineTo(reference.x+5,reference.y);ctx.lineTo(reference.x,reference.y+5);ctx.lineTo(reference.x-5,reference.y);ctx.closePath();ctx.fill();ctx.stroke()
    ctx.fillStyle='#60a5fa';ctx.font='bold 11px sans-serif'
    const name=Object.keys(AUGMENTED).find(key=>AUGMENTED[key]===augmented)
    ctx.fillText(`Lead ${name}`,86,55)
    ctx.font='10px sans-serif';ctx.fillStyle='#fbbf24'
    ctx.fillText('◇ Average reference',86,244)
    ctx.fillText(`(${augmented.reference.join(' + ')}) / 2`,86,260)
  } else {
  EIN_LEADS.forEach(({a,b,label,color})=>{
    ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(sites[a].x,sites[a].y);ctx.lineTo(sites[b].x,sites[b].y);ctx.stroke()
    ctx.fillStyle=color;ctx.textAlign = label === 'II' ? 'right' : label === 'III' ? 'left' : 'center'
    ctx.fillText(`Lead ${label}`,(sites[a].x+sites[b].x)/2+(label==='II'?-15:label==='III'?7:0),(sites[a].y+sites[b].y)/2-8)
    ctx.textAlign = 'center'
  })
  }
  Object.entries(sites).forEach(([id,p])=>{
    ctx.fillStyle=augmented?(id===augmented.positive?'#60a5fa':'#fbbf24'):'#94a3b8'
    ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.fillText(id,p.x,p.y+(id==='LL'?18:-14))
  })
  ctx.fillStyle='#64748b';ctx.fillText('Schematic placement',86,283);ctx.restore()
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
    ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID_MINOR
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = GRID_MINOR
  for (let y = by; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = by; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = BASELINE
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
    plus: { ...EIN.LL },
    minus: { ...EIN.RA },
  })
  const dragging   = useRef(null)   // 'plus' | 'minus' | null

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
      const gain = augmented ? dist / 96 : 1
      // Linear potential model: derived references average the two limb inputs.
      const limbPotential = pos => (Vx * (pos.x - (EIN.RA.x + EIN.LA.x + EIN.LL.x) / 3) + Vy * (pos.y - (EIN.RA.y + EIN.LA.y + EIN.LL.y) / 3)) / 96
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
      bCtx.fillText('Simplified electrode locations · front view', 310, 18)
      drawBody(bCtx)
      if (overlayRef.current !== 'none') drawConnections(bCtx, augmented)

      // Einthoven triangle
      if (overlayRef.current !== 'none') {
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


      }

      // Lead axis — extend across full canvas
      {
        bCtx.save()
        bCtx.beginPath(); bCtx.rect(180, 30, BW_L - 180, BH_L - 30); bCtx.clip()
        const extend = 600
        const ax = CX - ux * extend, ay = CY - uy * extend
        const bx = CX + ux * extend, by = CY + uy * extend
        bCtx.strokeStyle = '#ffffff'
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
        const foot = projectPointOntoLine(tipX, tipY, CX, CY, CX + ux, CY + uy)

        // Origin projected onto lead axis
        const orig = { x: CX, y: CY }

        // Dashed perpendicular from tip to foot
        bCtx.setLineDash([4, 4])
        bCtx.strokeStyle = '#e2e8f0'
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
        bCtx.strokeStyle = '#e2e8f0'
        bCtx.lineWidth   = 1.5
        bCtx.beginPath()
        bCtx.moveTo(foot.x - perpLen * uy, foot.y + perpLen * ux)
        bCtx.lineTo(foot.x + perpLen * uy, foot.y - perpLen * ux)
        bCtx.stroke()

        // ΔV label on the projected segment itself, so the number is tied
        // directly to the visual segment that represents it.
        const midX = CX, midY = CY - 20
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
          bCtx.setLineDash([4, 4]); bCtx.strokeStyle = '#fbbf24'; bCtx.lineWidth = 1
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
      eCtx.strokeStyle = '#6ee7b7'
      eCtx.lineWidth   = 3
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
    if (!onBody(mx, my)) return
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
              The ECG plots ΔV = V(+) − V(−). Use Source rotation to change its orientation.
            </p>
          </div>

        </div>
      </div>

      {/* Playback controls */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-3 flex-wrap">
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
          <span className="text-xs uppercase tracking-widest text-gray-400 mr-0.5">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded-md text-xs font-mono border transition-colors ${
                speed === s
                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50'
                  : 'text-gray-400 border-gray-700 hover:text-gray-300'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 shrink-0">Cycle time</span>
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
        <span ref={scrubLabelRef} className="text-xs font-mono text-gray-400 tabular-nums w-28 text-right">
          0 / {Math.round(RHYTHM.cycleMs)} ms
        </span>
      </div>

      {/* Rotate the cardiac vector itself, independent of electrode placement */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-gray-400 shrink-0">Source rotation</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={axisRotation}
          onChange={e => setAxisRotation(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-amber-500"
        />
        <span className="text-xs font-mono text-gray-400 tabular-nums w-28 text-right">
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
              {overlay === 'standard' && EIN_LEADS.map(({a,b,label}) => <button key={label} onClick={() => { elec.current = { minus: {...EIN[a]}, plus: {...EIN[b]} } }} className="border border-gray-700 rounded px-2 py-1 text-gray-200">{label}</button>)}
              <span className="text-gray-400">{overlay === 'augmented' ? `${augmentedLead} = ${AUGMENTED[augmentedLead].positive} − (${AUGMENTED[augmentedLead].reference.join(' + ')}) / 2` : 'Drag + and − on the figure'}</span>
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
              <p className="text-xs text-gray-400 text-center font-mono">
                {overlay === 'augmented' ? 'Dashed lines combine electrode potentials into a calculated reference' : 'Dashed axis passes through the cardiac origin, parallel to the electrode connection'}
              </p>
            </div>
          </div>

          {/* ECG strip */}
          <div className="border-t border-gray-800">
            <div className="flex items-center gap-3 px-3 pt-2.5 pb-1">
              <p className="text-xs uppercase tracking-widest text-gray-400">Live ECG output</p>
              <span className="text-xs text-indigo-300">Line = current instant</span>

            </div>
            <canvas
              ref={ECGRef}
              width={EW}
              height={EH}
              style={{ width: '100%', maxWidth: EW, display: 'block', backgroundColor: '#030712' }}
            />
            <p className="text-xs text-gray-400 text-right px-3 pb-2">Vertical grid lines: 40 ms apart · Horizontal grid lines: 0.5 mV apart</p>
          </div>
        </div>

        {/* Info panel */}
        <div className="w-64 shrink-0 bg-gray-900/80 border-l border-gray-800 p-4 flex flex-col gap-4 justify-center">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Angle θ</p>
              <p ref={angleRef} className="text-lg font-bold font-mono text-white tabular-nums">—</p>
              <p className="text-xs text-gray-400">between dipole &amp; lead axis</p>
            </div>
            <div className="rounded-lg bg-gray-900/70 border border-gray-800 px-2.5 py-2">
              <p className="text-xs text-gray-400 mb-1">Electrode voltages</p>
              <p className="text-xs font-mono tabular-nums"><span className="text-blue-400">V(+)</span> <span ref={vPlusRef} className="text-blue-300">—</span></p>
              <p className="text-xs font-mono tabular-nums"><span className="text-amber-400">{overlay === 'augmented' ? 'V(reference)' : 'V(−)'}</span> <span ref={vMinusRef} className="text-amber-300">—</span></p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">ΔV = V(+) − V(−)</p>
              <p ref={dotRef} className="text-lg font-bold font-mono text-blue-400 tabular-nums">—</p>
              <p className="text-xs text-gray-400">this is what the ECG plots</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Relative projection magnitude</p>
              <p ref={projRef} className="text-lg font-bold font-mono text-emerald-400 tabular-nums">—</p>
              <p className="text-xs text-gray-400">|cos θ| × 100%</p>
            </div>
          </div>

          <Explanation>
            <p>Electrode connections show simplified body placement, not the conventional equilateral Einthoven model. These illustrative voltages use a projection model, not an anatomical volume conductor. The dashed axis is parallel to the electrode connection and passes through the cardiac origin. The lead records the projection of the cardiac vector onto its direction.
              A parallel vector gives the largest positive contribution, a perpendicular vector
              gives zero contribution at that instant, and an opposite vector gives a negative contribution.</p>
            <p className="mt-2">Exchanging the recording connections reverses the sign of ΔV.
              Rotating the source can also change its sign while the connections stay fixed.</p>
          </Explanation>


        </div>
      </div>

    </div>
  )
}
