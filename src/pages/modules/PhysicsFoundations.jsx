import { useEffect, useRef, useState } from 'react'
import p5 from 'p5'
import { CELL_COUNT, CELL_WIDTH, CELL_XS, ROW_Y, REST_BEFORE, STEP_DELAY, TRANS_DUR, APD, LAST_DEPOL_END, LAST_REPOL_END, CELL_CYCLE_MS, CENTERED_PULSE_MS, cellState, cellSourcesAt, cellPotential, cellField } from '../../lib/cellRowModel'
import ModulePage from '../../components/ModulePage'
import Explanation from '../../components/Explanation'
import { useNavigate } from 'react-router-dom'
import { useTabState, usePublishTabs } from '../../components/ModuleTabs'
import { modelMillivolts, formatMillivolts, gridDotProduct, DOT_UNIT_TO_MV } from '../../lib/physicsUnits'

const TABS = [
  { id: '2A', label: '2A · Charges' },
  { id: '2B', label: '2B · Dipole' },
  { id: '2C', label: '2C · Depolarization' },
  { id: '2D', label: '2D · Dot Product' },
]

// ── Layout helpers ────────────────────────────────────────────────────────────
function Section({ label, title, children }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-teal-500/80 bg-teal-950/40 border border-teal-800/40 px-2 py-0.5 rounded-full">
          {label}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Callout({ children }) {
  return <Explanation className="my-2">{children}</Explanation>
}

function Equation({ children, label }) {
  return (
    <div className="flex items-center gap-4 my-1.5">
      <div className="flex-1 rounded-lg bg-gray-900 border border-gray-800 px-4 py-1.5 font-mono text-sm text-indigo-300 text-center">
        {children}
      </div>
      {label && <p className="text-xs text-gray-600 w-36 leading-tight">{label}</p>}
    </div>
  )
}

// When `onNext` is given, the pill becomes a real "advance to the next tab"
// button instead of just a static label — the tabs replaced the old
// continuous-scroll flow, so this is how that same forward momentum still
// works.
function ForwardLink({ children, onNext }) {
  return (
    <div className="flex items-center gap-3 mt-2 mb-1 text-xs text-gray-600">
      <div className="flex-1 h-px bg-gray-800" />
      {onNext ? (
        <button
          onClick={onNext}
          className="shrink-0 px-3 py-1 rounded-full border border-teal-800/50 text-teal-400 hover:bg-teal-950/40 transition-colors"
        >
          {children} →
        </button>
      ) : (
        <span className="shrink-0 px-3 py-1 rounded-full border border-gray-800 text-gray-600">
          {children}
        </span>
      )}
      <div className="flex-1 h-px bg-gray-800" />
    </div>
  )
}

function CanvasWrap({ containerRef, children }) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 mb-4">
      <div ref={containerRef} />
      {children}
    </div>
  )
}

function SimBar({ children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900/80 border-t border-gray-800 text-xs text-gray-500 flex-wrap">
      {children}
    </div>
  )
}

// ── 2A: Point charges, field lines, equipotentials ───────────────────────────
function Sim2A() {
  const containerRef = useRef()
  const showEqRef = useRef(false)
  const [showEq, setShowEq] = useState(false)

  useEffect(() => { showEqRef.current = showEq }, [showEq])

  useEffect(() => {
    // Scaled to ~0.78x the original 720×400 (uniform factor f applied to
    // every distance constant — canvas, charge offset, radius — plus K
    // scaled by the same f so potential ∝ K/r keeps the same visual
    // magnitude at the smaller size) so the sim fits on-screen alongside
    // its own tab's text/Callout without changing how the field looks.
    const W = 560, H = 310, K = 29556, CR = 9
    let cancelled = false

    const sketch = (p) => {
      const charges = [
        { x: W / 2 - 109, y: H / 2, q: 1 },
        { x: W / 2 + 109, y: H / 2, q: -1 },
      ]
      let dragging = null
      let lastTap = { t: 0, i: -1 }

      function volt(x, y) {
        let v = 0
        for (const c of charges) {
          const r = Math.max(Math.hypot(x - c.x, y - c.y), 8)
          v += K * c.q / r
        }
        return v
      }

      function fld(x, y) {
        let ex = 0, ey = 0
        for (const c of charges) {
          const dx = x - c.x, dy = y - c.y
          const r2 = Math.max(dx * dx + dy * dy, 64), r = Math.sqrt(r2)
          const f = K * c.q / (r2 * r)
          ex += f * dx; ey += f * dy
        }
        return [ex, ey]
      }

      // Voltage "glow": fill a small low-res buffer (one cell per few real
      // pixels) and scale it up with the browser's own image smoothing, so
      // the field tint reads as a soft gradient instead of a blocky grid.
      let heatBuf
      const HEAT_SCALE = 6
      function drawHeatmap() {
        heatBuf.clear()
        const bw = heatBuf.width, bh = heatBuf.height
        heatBuf.noStroke()
        for (let bx = 0; bx < bw; bx++) {
          for (let by = 0; by < bh; by++) {
            const x = (bx + 0.5) * HEAT_SCALE, y = (by + 0.5) * HEAT_SCALE
            const v = volt(x, y)
            const c = Math.max(-1, Math.min(1, v / 2800))
            if (c > 0) heatBuf.fill(59, 130, 246, c * 80)
            else heatBuf.fill(245, 158, 11, -c * 80)
            heatBuf.rect(bx, by, 1, 1)
          }
        }
        p.image(heatBuf, 0, 0, W, H)
      }

      function chargeAt(x, y) {
        for (let i = charges.length - 1; i >= 0; i--)
          if (Math.hypot(x - charges[i].x, y - charges[i].y) < CR + 5) return i
        return -1
      }

      // Walks from a seed point along the field, stopping at a charge of
      // opposite sign to `source` (lines are free to run past the canvas
      // edge — p5 clips rendering to the canvas automatically). Seeds from a
      // negative source walk against the local field vector, since a line
      // "leaving" a negative charge does so opposite to fld()'s direction.
      //
      // If an opposite-sign charge exists anywhere in the scene, the trace
      // is never allowed to give up just because the local field is weak —
      // it keeps following the field (up to a generous step budget) until it
      // actually reaches one, so every line from a positive charge ends up
      // connecting to a negative whenever one exists. Only when there's no
      // opposite charge at all does a weak field mean "let it escape to
      // infinity" (nothing to reach).
      function traceField(sx, sy, source) {
        const pts = [[sx, sy]]
        let x = sx, y = sy
        const sign = source.q > 0 ? 1 : -1
        const hasOpposite = charges.some(c => Math.sign(c.q) !== Math.sign(source.q))
        const maxSteps = hasOpposite ? 2000 : 600
        for (let i = 0; i < maxSteps; i++) {
          const [ex, ey] = fld(x, y)
          const m = Math.hypot(ex, ey)
          if (m < 1e-6) break // true numerical null point — direction is undefined
          if (!hasOpposite && m < 0.03) break
          x += sign * 3 * ex / m; y += sign * 3 * ey / m
          let stop = false
          for (const c of charges) {
            if (c === source) continue
            if (Math.sign(c.q) !== Math.sign(source.q) && Math.hypot(x - c.x, y - c.y) < CR + 7) { stop = true; break }
          }
          pts.push([x, y])
          if (stop) break
        }
        return pts
      }

      // One arrowhead roughly every 70px along the path (step size is 3px),
      // repeated for the whole line so direction stays legible along its
      // entire length, not just at one spot.
      function drawArrowheads(pts) {
        const everyN = Math.max(1, Math.round(70 / 3))
        for (let idx = everyN; idx < pts.length; idx += everyN) {
          const [x0, y0] = pts[idx - 1], [x1, y1] = pts[idx]
          const ang = Math.atan2(y1 - y0, x1 - x0), len = 5
          p.push()
          p.translate(x1, y1); p.rotate(ang)
          p.noStroke(); p.fill(80, 140, 255, 180)
          p.triangle(0, 0, -len, len * 0.5, -len, -len * 0.5)
          p.pop()
        }
      }

      function drawFieldLines() {
        // Seed from positive charges only — each line already runs from a
        // positive to whichever negative it terminates at, so also seeding
        // from negatives would retrace nearly the same physical lines a
        // second time (drawn as a visible near-duplicate pair). Only fall
        // back to seeding from negatives when there's no positive charge at
        // all, so an isolated negative still shows its own field lines.
        const positives = charges.filter(c => c.q > 0)
        const sources = positives.length > 0 ? positives : charges.filter(c => c.q < 0)
        if (sources.length === 0) return
        const nSeeds = Math.max(3, Math.min(16, Math.floor(64 / sources.length)))
        p.noFill(); p.stroke(80, 140, 255, 150); p.strokeWeight(1.3)
        for (const src of sources) {
          for (let k = 0; k < nSeeds; k++) {
            const a = (k / nSeeds) * Math.PI * 2
            const pts = traceField(src.x + (CR + 5) * Math.cos(a), src.y + (CR + 5) * Math.sin(a), src)
            if (pts.length > 1) {
              // A trace seeded at a negative charge is walked outward (away from
              // it) to build the path, so reverse it here for drawing purposes —
              // the arrowhead must always point from + toward -.
              const ordered = src.q < 0 ? pts.slice().reverse() : pts
              p.beginShape()
              ordered.forEach(([px, py]) => p.vertex(px, py))
              p.endShape()
              drawArrowheads(ordered)
            }
          }
        }
      }

      // ── Equipotentials: marching squares over a cached voltage grid ──
      // cols/rows MUST be integers — they're used both as the Float32Array
      // stride and as loop bounds. A fractional stride silently breaks
      // every grid write/read past row 0 (non-integer typed-array indices
      // are no-ops, not errors), which defeats the "skip uniform cells"
      // fast path almost everywhere and forces tens of thousands of
      // degenerate/NaN line draws per frame — enough to lock up the tab
      // once Equipotentials is toggled on.
      const gsEq = 6, cols = Math.round(W / gsEq), rows = Math.round(H / gsEq)
      const cornerV = new Float32Array((cols + 1) * (rows + 1))

      function computeCornerGrid() {
        for (let j = 0; j <= rows; j++)
          for (let i = 0; i <= cols; i++)
            cornerV[j * (cols + 1) + i] = volt(i * gsEq, j * gsEq)
      }
      const V = (i, j) => cornerV[j * (cols + 1) + i]

      function pickLevels() {
        let maxV = 0
        const step = 18
        for (let x = step / 2; x < W; x += step) {
          for (let y = step / 2; y < H; y += step) {
            let near = false
            for (const c of charges) if (Math.hypot(x - c.x, y - c.y) < CR * 3) { near = true; break }
            if (near) continue
            maxV = Math.max(maxV, Math.abs(volt(x, y)))
          }
        }
        if (maxV < 1) return []
        // Geometric progression (constant ratio between consecutive levels)
        // for even, non-clumping spacing. The top of the range is pulled back
        // from maxV (0.55 instead of 0.85) because equipotential rings pack
        // tightly close to any point charge no matter how levels are chosen —
        // staying further from that near-charge extreme keeps the innermost
        // two rings from landing right on top of each other.
        const N = 8, levels = []
        const lo = maxV * 0.1, hi = maxV * 0.55
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1)
          const v = lo * Math.pow(hi / lo, t)
          levels.push(v, -v)
        }
        // A dedicated, much lower-magnitude "outer" level: since it's small
        // enough that the region beyond it can span more than one charge, its
        // contour naturally merges across nearby charges (rather than staying
        // a small closed loop around just one) and reaches all the way to the
        // canvas edge, instead of every ring stopping short as an isolated shape.
        const outer = maxV * 0.015
        levels.push(outer, -outer)
        return levels
      }

      function lerpPt(va, vb, pa, pb, level) {
        const t = (level - va) / (vb - va)
        return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
      }

      function drawContour(level) {
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const x0 = i * gsEq, y0 = j * gsEq
            const v00 = V(i, j), v10 = V(i + 1, j), v11 = V(i + 1, j + 1), v01 = V(i, j + 1)
            const above = [v00 > level, v10 > level, v11 > level, v01 > level]
            if (above[0] === above[1] && above[1] === above[2] && above[2] === above[3]) continue
            const cTL = [x0, y0], cTR = [x0 + gsEq, y0], cBR = [x0 + gsEq, y0 + gsEq], cBL = [x0, y0 + gsEq]
            const crosses = []
            if (above[0] !== above[1]) crosses.push(lerpPt(v00, v10, cTL, cTR, level))
            if (above[1] !== above[2]) crosses.push(lerpPt(v10, v11, cTR, cBR, level))
            if (above[2] !== above[3]) crosses.push(lerpPt(v01, v11, cBL, cBR, level))
            if (above[3] !== above[0]) crosses.push(lerpPt(v00, v01, cTL, cBL, level))
            if (crosses.length === 2) {
              p.line(crosses[0][0], crosses[0][1], crosses[1][0], crosses[1][1])
            } else if (crosses.length === 4) {
              // Saddle cell: pair edges by which diagonal corner is "above" the level.
              if (above[0]) {
                p.line(crosses[0][0], crosses[0][1], crosses[3][0], crosses[3][1])
                p.line(crosses[1][0], crosses[1][1], crosses[2][0], crosses[2][1])
              } else {
                p.line(crosses[0][0], crosses[0][1], crosses[1][0], crosses[1][1])
                p.line(crosses[2][0], crosses[2][1], crosses[3][0], crosses[3][1])
              }
            }
          }
        }
      }

      function drawEquipotentials() {
        computeCornerGrid()
        const levels = pickLevels()
        p.stroke(110, 220, 140, 150); p.strokeWeight(1)
        for (const level of levels) drawContour(level)
      }

      function drawCharge(c) {
        p.strokeWeight(2)
        if (c.q > 0) { p.stroke(100, 160, 255); p.fill(59, 130, 246) }
        else { p.stroke(255, 180, 60); p.fill(245, 158, 11) }
        p.circle(c.x, c.y, CR * 2)
        p.fill(255); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(15)
        p.text(c.q > 0 ? '+' : '−', c.x, c.y)
      }

      p.setup = () => {
        const cnv = p.createCanvas(W, H)
        cnv.elt.addEventListener('contextmenu', e => e.preventDefault())
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        // Backing buffer must have enough real pixels for the CSS-stretched
        // display size (plus device pixel ratio) or the upscale looks blurry.
        const rectW = cnv.elt.getBoundingClientRect().width || W
        const density = Math.min(3, Math.max(1, rectW / W) * (window.devicePixelRatio || 1))
        p.pixelDensity(density)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        p.textFont('monospace')
        heatBuf = p.createGraphics(Math.ceil(W / HEAT_SCALE), Math.ceil(H / HEAT_SCALE))
        if (cancelled) p.remove()
      }

      p.draw = () => {
        p.background(15, 20, 30)

        drawHeatmap()

        // Field lines + equipotentials (skip during drag for performance)
        if (dragging === null) {
          drawFieldLines()
          if (showEqRef.current) drawEquipotentials()
        }

        charges.forEach(drawCharge)

        // Voltage at cursor
        if (p.mouseX >= 0 && p.mouseX < W && p.mouseY >= 0 && p.mouseY < H) {
          const mv = volt(p.mouseX, p.mouseY)
          p.fill(255, 255, 255, 150); p.noStroke()
          p.textAlign(p.LEFT, p.TOP); p.textSize(10)
          p.text(`V = ${formatMillivolts(modelMillivolts(mv))}`, 8, 8)
        }
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        const i = chargeAt(p.mouseX, p.mouseY)
        const now = Date.now()
        if (i >= 0) {
          if (now - lastTap.t < 320 && lastTap.i === i) {
            charges.splice(i, 1); lastTap = { t: 0, i: -1 }
          } else {
            dragging = i; lastTap = { t: now, i }
          }
          return
        }
        if (p.mouseButton.right) charges.push({ x: p.mouseX, y: p.mouseY, q: -1 })
        else charges.push({ x: p.mouseX, y: p.mouseY, q: 1 })
      }
      p.mouseDragged = () => {
        if (dragging !== null && charges[dragging]) {
          charges[dragging].x = p.mouseX; charges[dragging].y = p.mouseY
        }
      }
      p.mouseReleased = () => { dragging = null }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => { cancelled = true; inst.remove() }
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span className="flex-1">Left-click: add + &nbsp;·&nbsp; Right-click: add − &nbsp;·&nbsp; Drag to move &nbsp;·&nbsp; Double-click to remove</span>
        <button
          onClick={() => setShowEq(v => !v)}
          className={`shrink-0 px-3 py-1 rounded-full border text-xs transition-colors cursor-pointer ${showEq ? 'bg-teal-900/50 border-teal-700 text-teal-300' : 'border-gray-700 text-gray-500 hover:text-gray-400'}`}
        >
          Equipotentials {showEq ? 'ON' : 'OFF'}
        </button>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 2B: Dipole rotation, test-point voltage ───────────────────────────────────
function Sim2B() {
  const containerRef = useRef()

  useEffect(() => {
    // Scaled ~0.78x from the original 720×420 (same uniform-factor rule as
    // Sim2A — see its comment).
    const W = 560, H = 327, K = 38889, SEP = 84
    let cancelled = false

    const sketch = (p) => {
      let angle = 0
      let testPt = { x: W * 0.73, y: H * 0.28 }
      let dragDipole = false, dragTest = false

      const posC = () => ({ x: W / 2 + SEP * Math.cos(angle), y: H / 2 + SEP * Math.sin(angle) })
      const negC = () => ({ x: W / 2 - SEP * Math.cos(angle), y: H / 2 - SEP * Math.sin(angle) })

      function volt(x, y) {
        const { x: px, y: py } = posC(), { x: nx, y: ny } = negC()
        const rp = Math.max(Math.hypot(x - px, y - py), 8)
        const rn = Math.max(Math.hypot(x - nx, y - ny), 8)
        return K * (1 / rp - 1 / rn)
      }

      // Voltage "glow": fill a small low-res buffer (one cell per few real
      // pixels) and scale it up with the browser's own image smoothing, so
      // the field tint reads as a soft gradient instead of a blocky grid.
      let heatBuf
      const HEAT_SCALE = 6
      function drawHeatmap() {
        heatBuf.clear()
        const bw = heatBuf.width, bh = heatBuf.height
        heatBuf.noStroke()
        for (let bx = 0; bx < bw; bx++) {
          for (let by = 0; by < bh; by++) {
            const x = (bx + 0.5) * HEAT_SCALE, y = (by + 0.5) * HEAT_SCALE
            const v = volt(x, y)
            const c = Math.max(-1, Math.min(1, v / 1800))
            if (c > 0) heatBuf.fill(59, 130, 246, c * 80)
            else heatBuf.fill(245, 158, 11, -c * 80)
            heatBuf.rect(bx, by, 1, 1)
          }
        }
        p.image(heatBuf, 0, 0, W, H)
      }

      function arrow(x1, y1, x2, y2, r, g, b, a = 220, sw = 3) {
        p.stroke(r, g, b, a); p.strokeWeight(sw)
        p.line(x1, y1, x2, y2)
        const ang = Math.atan2(y2 - y1, x2 - x1), hs = 13
        p.fill(r, g, b, a); p.noStroke()
        p.triangle(x2, y2,
          x2 - hs * Math.cos(ang - 0.42), y2 - hs * Math.sin(ang - 0.42),
          x2 - hs * Math.cos(ang + 0.42), y2 - hs * Math.sin(ang + 0.42))
      }

      function drawCharge(x, y, positive) {
        const R = 15
        p.strokeWeight(2.5)
        if (positive) { p.stroke(100, 160, 255); p.fill(59, 130, 246) }
        else { p.stroke(255, 180, 60); p.fill(245, 158, 11) }
        p.circle(x, y, R * 2)
        p.fill(255); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(17)
        p.text(positive ? '+' : '−', x, y)
      }

      p.setup = () => {
        const cnv = p.createCanvas(W, H)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        // Backing buffer must have enough real pixels for the CSS-stretched
        // display size (plus device pixel ratio) or the upscale looks blurry.
        const rectW = cnv.elt.getBoundingClientRect().width || W
        const density = Math.min(3, Math.max(1, rectW / W) * (window.devicePixelRatio || 1))
        p.pixelDensity(density)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        p.textFont('monospace')
        heatBuf = p.createGraphics(Math.ceil(W / HEAT_SCALE), Math.ceil(H / HEAT_SCALE))
        if (cancelled) p.remove()
      }

      p.draw = () => {
        p.background(15, 20, 30)

        drawHeatmap()

        const { x: px, y: py } = posC(), { x: nx, y: ny } = negC()

        // Dipole moment arrow (neg → pos)
        arrow(nx, ny, px, py, 255, 255, 255, 210, 3)

        drawCharge(px, py, true)
        drawCharge(nx, ny, false)

        // Test point
        const tv = volt(testPt.x, testPt.y)
        p.fill(52, 211, 153); p.stroke(52, 211, 153, 200); p.strokeWeight(1.8)
        p.circle(testPt.x, testPt.y, 12)
        const lbl = `V = ${formatMillivolts(modelMillivolts(tv))}`
        const lw = lbl.length * 7.2 + 9
        p.fill(15, 20, 30, 200); p.noStroke()
        p.rect(testPt.x + 9, testPt.y - 9, lw, 17, 3.5)
        p.fill(52, 211, 153); p.textAlign(p.LEFT, p.CENTER); p.textSize(12)
        p.text(lbl, testPt.x + 11, testPt.y)

        // Instructions
        p.fill(255, 255, 255, 65); p.noStroke()
        p.textAlign(p.LEFT, p.TOP); p.textSize(11)
        p.text('Drag center region to rotate · Drag green dot to measure V', 9, 9)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        if (Math.hypot(p.mouseX - testPt.x, p.mouseY - testPt.y) < 11) { dragTest = true; return }
        if (Math.hypot(p.mouseX - W / 2, p.mouseY - H / 2) < 89) dragDipole = true
      }
      p.mouseDragged = () => {
        if (dragTest) { testPt.x = p.mouseX; testPt.y = p.mouseY; return }
        if (dragDipole) angle = Math.atan2(p.mouseY - H / 2, p.mouseX - W / 2)
      }
      p.mouseReleased = () => { dragDipole = false; dragTest = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => { cancelled = true; inst.remove() }
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span>Drag the <strong className="text-white">center region</strong> to rotate the dipole &nbsp;·&nbsp; Drag the <span className="text-emerald-400">green dot</span> to probe voltage at any point</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 2C: Extracellular sources from a row of cells ───────────
function PlayIcon()  { return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> }
function PauseIcon() { return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg> }
const CELL_SPEEDS = [0.25, 0.5, 1, 1.5, 2]
function SimCells() {
  const containerRef = useRef()

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [showField, setShowField] = useState(false)
  const [showEq, setShowEq] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [voltageRange, setVoltageRange] = useState(2)
  const voltageRangeRef = useRef(voltageRange)
  useEffect(() => { voltageRangeRef.current = voltageRange }, [voltageRange])

  const playingRef = useRef(playing)
  const speedRef = useRef(speed)
  const showFieldRef = useRef(showField)
  const showEqRef = useRef(showEq)
  const showCurrentRef = useRef(showCurrent)
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { showFieldRef.current = showField }, [showField])
  useEffect(() => { showEqRef.current = showEq }, [showEq])
  useEffect(() => { showCurrentRef.current = showCurrent }, [showCurrent])

  // Scrubber plumbing — uncontrolled DOM node + refs, matching
  // LeadPlacementLab's pattern, so dragging never triggers a React re-render
  // during the p5 draw loop.
  const resetProbesRef = useRef(() => {})
  const simTimeRef = useRef(0)
  const jumpTo = time => {
    playingRef.current = false
    setPlaying(false)
    simTimeRef.current = time
  }
  const scrubbingRef = useRef(false)
  const scrubRef = useRef(null)
  const scrubLabelRef = useRef(null)

  useEffect(() => {
    // Scaled ~0.78x from the original 720×480 (same uniform-factor rule as
    // Sim2A — see its comment).
    const W = 560, H = 375
    const N = CELL_COUNT, CELL_W = CELL_WIDTH, CELL_H = 47
    const CX = W / 2
    const TOTAL_CYCLE = CELL_CYCLE_MS

    let cancelled = false

    const sketch = (p) => {
      const xs = CELL_XS

      // Two draggable probes — the actual "electrodes" reading the voltage
      // this changing charge distribution produces, so ΔV isn't an
      // unexplained number: it's V(A) − V(B) measured at two real points.
      const PR = 7
      let probeA = { x: xs[0] - 31, y: ROW_Y - CELL_H / 2 - 25 }
      let probeB = { x: xs[N - 1] + 31, y: ROW_Y - CELL_H / 2 - 25 }
      resetProbesRef.current = () => {
        probeA = { x: xs[0] - 31, y: ROW_Y - CELL_H / 2 - 25 }
        probeB = { x: xs[N - 1] + 31, y: ROW_Y - CELL_H / 2 - 25 }
      }
      let dragA = false, dragB = false

      // A "perpendicular" (zero) reading requires the two probes to be
      // exact mirror images across the row (same x, equal-and-opposite
      // distance from ROW_Y) — every cell is then equidistant from both,
      // so V(A)=V(B) exactly. That's a precise target to hit by hand, so
      // while dragging one probe close to its exact mirror point (relative
      // to the OTHER probe's current position), snap it there instead of
      // leaving the reading only approximately zero.
      const SNAP_RADIUS = 18

      const sAt = cellState
      const chargesAt = cellSourcesAt
      const volt = cellPotential
      const fld = cellField
      function phaseName(t) {
        if (t <= REST_BEFORE || t >= LAST_REPOL_END) return 'resting (polarized)'
        if (t < REST_BEFORE + TRANS_DUR + APD) return 'depolarization'
        if (t < LAST_DEPOL_END) return 'activation and recovery'
        return 'repolarization'
      }

      const CR = 5
      function traceField(sx, sy, source, cs) {
        const pts = [[sx, sy]]
        let x = sx, y = sy
        const sign = source.q > 0 ? 1 : -1
        const hasOpposite = cs.some(c => Math.sign(c.q) !== Math.sign(source.q) && Math.abs(c.q) > 0.05)
        const maxSteps = hasOpposite ? 500 : 200
        for (let i = 0; i < maxSteps; i++) {
          const [ex, ey] = fld(x, y, cs)
          const m = Math.hypot(ex, ey)
          if (m < 1e-6) break
          if (!hasOpposite && m < 0.03) break
          x += sign * 3 * ex / m; y += sign * 3 * ey / m
          let stop = false
          for (const c of cs) {
            if (c === source) continue
            if (Math.sign(c.q) !== Math.sign(source.q) && Math.abs(c.q) > 0.05 && Math.hypot(x - c.x, y - c.y) < CR + 7) { stop = true; break }
          }
          pts.push([x, y])
          if (stop) break
        }
        return pts
      }

      function traceAllLines(cs) {
        const positives = cs.filter(c => c.q > 0.05)
        const sources = positives.length > 0 ? positives : cs.filter(c => c.q < -0.05)
        const lines = []
        if (sources.length === 0) return lines
        const nSeeds = Math.max(2, Math.min(6, Math.floor(40 / sources.length)))
        for (const src of sources) {
          for (let k = 0; k < nSeeds; k++) {
            const a = (k / nSeeds) * Math.PI * 2
            const pts = traceField(src.x + (CR + 5) * Math.cos(a), src.y + (CR + 5) * Math.sin(a), src, cs)
            if (pts.length > 1) lines.push(src.q < 0 ? pts.slice().reverse() : pts)
          }
        }
        return lines
      }

      function drawArrowheads(pts, alpha) {
        const everyN = Math.max(1, Math.round(70 / 3))
        for (let idx = everyN; idx < pts.length; idx += everyN) {
          const [x0, y0] = pts[idx - 1], [x1, y1] = pts[idx]
          const ang = Math.atan2(y1 - y0, x1 - x0), len = 5
          p.push()
          p.translate(x1, y1); p.rotate(ang)
          p.noStroke(); p.fill(80, 140, 255, alpha)
          p.triangle(0, 0, -len, len * 0.5, -len, -len * 0.5)
          p.pop()
        }
      }

      function drawFieldLines(lines) {
        p.noFill(); p.stroke(80, 140, 255, 150); p.strokeWeight(1.3)
        for (const pts of lines) {
          p.beginShape()
          pts.forEach(([px, py]) => p.vertex(px, py))
          p.endShape()
          drawArrowheads(pts, 180)
        }
      }

      function drawCurrentLines(lines) {
        p.push()
        p.noFill(); p.stroke(52, 211, 153, 200); p.strokeWeight(1.6)
        p.drawingContext.setLineDash([6, 7])
        p.drawingContext.lineDashOffset = -(p.frameCount * 0.6) % 13
        for (const pts of lines) {
          p.beginShape()
          pts.forEach(([px, py]) => p.vertex(px, py))
          p.endShape()
        }
        p.drawingContext.setLineDash([])
        p.pop()
      }

      // ── Equipotentials: marching squares over a per-frame voltage grid ──
      const gsEq = 6, cols = Math.round(W / gsEq), rows = Math.round(H / gsEq)
      const cornerV = new Float32Array((cols + 1) * (rows + 1))

      function computeCornerGrid(cs) {
        for (let j = 0; j <= rows; j++)
          for (let i = 0; i <= cols; i++)
            cornerV[j * (cols + 1) + i] = volt(i * gsEq, j * gsEq, cs)
      }
      const V = (i, j) => cornerV[j * (cols + 1) + i]

      function pickLevels(cs) {
        let maxV = 0
        const step = 19
        for (let x = step / 2; x < W; x += step) {
          for (let y = step / 2; y < H; y += step) {
            let near = false
            for (const c of cs) if (Math.hypot(x - c.x, y - c.y) < CR * 3) { near = true; break }
            if (near) continue
            maxV = Math.max(maxV, Math.abs(volt(x, y, cs)))
          }
        }
        if (maxV < 1) return []
        const N2 = 6, levels = []
        const lo = maxV * 0.1, hi = maxV * 0.55
        for (let i = 0; i < N2; i++) {
          const t = i / (N2 - 1)
          const v = lo * Math.pow(hi / lo, t)
          levels.push(v, -v)
        }
        return levels
      }

      function lerpPt(va, vb, pa, pb, level) {
        const t = (level - va) / (vb - va)
        return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
      }

      function drawContour(level) {
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const x0 = i * gsEq, y0 = j * gsEq
            const v00 = V(i, j), v10 = V(i + 1, j), v11 = V(i + 1, j + 1), v01 = V(i, j + 1)
            const above = [v00 > level, v10 > level, v11 > level, v01 > level]
            if (above[0] === above[1] && above[1] === above[2] && above[2] === above[3]) continue
            const cTL = [x0, y0], cTR = [x0 + gsEq, y0], cBR = [x0 + gsEq, y0 + gsEq], cBL = [x0, y0 + gsEq]
            const crosses = []
            if (above[0] !== above[1]) crosses.push(lerpPt(v00, v10, cTL, cTR, level))
            if (above[1] !== above[2]) crosses.push(lerpPt(v10, v11, cTR, cBR, level))
            if (above[2] !== above[3]) crosses.push(lerpPt(v01, v11, cBL, cBR, level))
            if (above[3] !== above[0]) crosses.push(lerpPt(v00, v01, cTL, cBL, level))
            if (crosses.length === 2) {
              p.line(crosses[0][0], crosses[0][1], crosses[1][0], crosses[1][1])
            } else if (crosses.length === 4) {
              if (above[0]) {
                p.line(crosses[0][0], crosses[0][1], crosses[3][0], crosses[3][1])
                p.line(crosses[1][0], crosses[1][1], crosses[2][0], crosses[2][1])
              } else {
                p.line(crosses[0][0], crosses[0][1], crosses[1][0], crosses[1][1])
                p.line(crosses[2][0], crosses[2][1], crosses[3][0], crosses[3][1])
              }
            }
          }
        }
      }

      function drawEquipotentials(cs) {
        computeCornerGrid(cs)
        const levels = pickLevels(cs)
        p.stroke(110, 220, 140, 150); p.strokeWeight(1)
        for (const level of levels) drawContour(level)
      }

      function lerpColor(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
      }

      function drawCell(x, s, transitioning, transitionSign) {
        const AMBER = [245, 158, 11], BLUE = [59, 130, 246]
        const [r, g, b] = lerpColor(AMBER, BLUE, (s + 1) / 2)
        if (transitioning) {
          p.drawingContext.shadowBlur = 14
          p.drawingContext.shadowColor = transitionSign > 0 ? 'rgba(129,140,248,0.9)' : 'rgba(253,224,71,0.9)'
        }
        p.fill(r, g, b); p.stroke(255, 255, 255, 60); p.strokeWeight(1.2)
        p.rectMode(p.CENTER)
        p.rect(x, ROW_Y, CELL_W, CELL_H, 13)
        p.drawingContext.shadowBlur = 0
        p.rectMode(p.CORNER)

        // A stable nucleus identifies the shape as a cell; the surrounding
        // cell color and R/D label encode membrane state, not nuclear activity.
        p.fill(39, 35, 65, 220); p.stroke(224, 210, 255, 150); p.strokeWeight(0.8)
        p.ellipse(x, ROW_Y - 7, 17, 21)
        p.noStroke(); p.fill(174, 156, 203, 170)
        p.ellipse(x + 2, ROW_Y - 9, 5, 6)

        p.textAlign(p.CENTER, p.CENTER); p.textSize(10)
        p.fill(255, 255, 255, 220)
        p.text(s > 0.99 ? 'R' : s < -0.99 ? 'D' : '…', x, ROW_Y + 14)

      }

      function arrow(x1, y1, x2, y2, r, g, b, a = 220, sw = 3) {
        p.stroke(r, g, b, a); p.strokeWeight(sw)
        p.line(x1, y1, x2, y2)
        const ang = Math.atan2(y2 - y1, x2 - x1), hs = 11
        p.fill(r, g, b, a); p.noStroke()
        p.triangle(x2, y2,
          x2 - hs * Math.cos(ang - 0.42), y2 - hs * Math.sin(ang - 0.42),
          x2 - hs * Math.cos(ang + 0.42), y2 - hs * Math.sin(ang + 0.42))
      }

      p.setup = () => {
        const cnv = p.createCanvas(W, H)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        const rectW = cnv.elt.getBoundingClientRect().width || W
        const density = Math.min(3, Math.max(1, rectW / W) * (window.devicePixelRatio || 1))
        p.pixelDensity(density)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        p.textFont('monospace')
        if (cancelled) p.remove()
      }

      p.draw = () => {
        if (playingRef.current && !scrubbingRef.current) simTimeRef.current += p.deltaTime * speedRef.current
        const t = ((simTimeRef.current % TOTAL_CYCLE) + TOTAL_CYCLE) % TOTAL_CYCLE

        if (!scrubbingRef.current && scrubRef.current) scrubRef.current.value = String(Math.round(t))
        if (scrubLabelRef.current) scrubLabelRef.current.textContent = `${Math.round(t)} / ${TOTAL_CYCLE} ms`

        p.background(15, 20, 30)

        const cs = chargesAt(t)
        const needsLines = showFieldRef.current || showCurrentRef.current
        const lines = needsLines ? traceAllLines(cs) : []
        if (showFieldRef.current) drawFieldLines(lines)
        if (showCurrentRef.current) drawCurrentLines(lines)
        if (showEqRef.current) drawEquipotentials(cs)

        // Cells
        for (let i = 0; i < N; i++) {
          const ti = REST_BEFORE + i * STEP_DELAY, depolEnd = ti + TRANS_DUR
          const repolStart = depolEnd + APD, repolEnd = repolStart + TRANS_DUR
          const s = sAt(i, t)
          const transitioning = (t >= ti && t < depolEnd) || (t >= repolStart && t < repolEnd)
          const transitionSign = (t >= repolStart && t < repolEnd) ? 1 : -1
          drawCell(xs[i], s, transitioning, transitionSign)
        }

        // Probes — actual electrode voltage readout, driving ΔV
        const vA = volt(probeA.x, probeA.y, cs)
        const vB = volt(probeB.x, probeB.y, cs)
        const dv = vA - vB

        p.strokeWeight(1); p.stroke(150, 150, 150, 70)
        p.drawingContext.setLineDash([4, 3])
        p.line(probeA.x, probeA.y, probeB.x, probeB.y)
        p.drawingContext.setLineDash([])

        p.fill(52, 211, 153); p.stroke(52, 211, 153, 180); p.strokeWeight(2)
        p.circle(probeA.x, probeA.y, PR * 2)
        p.fill(168, 85, 247); p.stroke(168, 85, 247, 180)
        p.circle(probeB.x, probeB.y, PR * 2)

        p.noStroke(); p.textAlign(p.CENTER, p.BOTTOM); p.textSize(10)
        p.fill(52, 211, 153, 220)
        p.text(`A  ${formatMillivolts(modelMillivolts(vA))}`, probeA.x, probeA.y - PR - 3)
        p.fill(168, 85, 247, 220)
        p.text(`B  ${formatMillivolts(modelMillivolts(vB))}`, probeB.x, probeB.y - PR - 3)

        // Sample ΔV(t) as currently measured by the dragged probes, over one
        // full cycle — this is what actually depends on electrode placement
        // (unlike p(t), which is an intrinsic property of the charge
        // distribution and never changes). Reused below for both the
        // electrode-reading arrow and the "ECG output" strip chart.
        const steps = 120
        const dvSamples = new Array(steps + 1)
        let maxDV = 1e-6
        for (let k = 0; k <= steps; k++) {
          const ts = (k / steps) * TOTAL_CYCLE
          const csk = chargesAt(ts)
          const dvk = volt(probeA.x, probeA.y, csk) - volt(probeB.x, probeB.y, csk)
          dvSamples[k] = dvk
          maxDV = Math.max(maxDV, Math.abs(dvk))
        }

        // Electrode reading vector, drawn above the row — how much of the
        // field the current probe pair actually picks up, so dragging A/B
        // visibly changes the arrow.
        const rangeMv = voltageRangeRef.current
        const normDV = Math.max(-1, Math.min(1, modelMillivolts(dv) / rangeMv))
        const arrowY = ROW_Y - CELL_H / 2 - 55
        const maxLen = 130
        p.stroke(255, 255, 255, 40); p.strokeWeight(1)
        p.line(CX - maxLen, arrowY, CX + maxLen, arrowY)
        if (Math.abs(normDV) > 0.02) {
          arrow(CX, arrowY, CX + normDV * maxLen, arrowY, 245, 158, 11, 230, 3)
        }
        p.fill(245, 158, 11, 180); p.noStroke()
        p.textAlign(p.CENTER, p.BOTTOM); p.textSize(11)
        p.text('electrode reading ΔV(t)', CX, arrowY - 10)

        // Snapped-perpendicular badge — confirms (and explains) why the
        // reading is exactly 0 rather than just approximately small.
        const isPerpendicular = Math.abs(probeA.x - probeB.x) < 0.5 && Math.abs((probeA.y - ROW_Y) + (probeB.y - ROW_Y)) < 0.5
        if (isPerpendicular) {
          p.fill(34, 211, 238, 220); p.noStroke()
          p.textAlign(p.CENTER, p.TOP); p.textSize(11)
          p.text('Mirrored probe positions', CX, arrowY + 10)
        }

        // Info panel
        p.fill(15, 20, 30, 210); p.noStroke()
        p.rect(9, 9, 190, 42, 7)
        p.textAlign(p.LEFT, p.TOP); p.textSize(11)
        p.fill(255, 255, 255, 210); p.text(`t = ${Math.round(t)} ms`, 18, 18)
        p.fill(150, 150, 150, 150); p.text(phaseName(t), 18, 34)

        // Probe readout panel — V(A), V(B) and their difference
        p.fill(15, 20, 30, 210); p.noStroke()
        p.rect(9, H - 68, 190, 59, 7)
        p.textAlign(p.LEFT, p.TOP); p.textSize(11)
        p.fill(52, 211, 153, 220); p.text(`V(A) = ${formatMillivolts(modelMillivolts(vA))}`, 18, H - 60)
        p.fill(168, 85, 247, 220); p.text(`V(B) = ${formatMillivolts(modelMillivolts(vB))}`, 18, H - 44)
        p.fill(255, 255, 255, 210); p.text(`ΔV = ${formatMillivolts(modelMillivolts(dv))}`, 18, H - 28)
        p.fill(255, 255, 255, 60); p.textSize(9)
        p.text('drag A/B to probe the field', 18, H - 14)

        // "ECG output" strip chart — the ΔV(t) actually seen by the current
        // electrode pair, so it visibly changes shape as A/B are dragged
        // (unlike the underlying dipole, which is fixed).
        const chW = 205, chH = 100, chX = W - chW - 9, chY = 9
        const plotX = chX + 48, plotW = chW - 54
        const plotTop = chY + 16, plotBottom = chY + chH - 25
        const plotMid = (plotTop + plotBottom) / 2, plotHalf = (plotBottom - plotTop) / 2
        p.fill(15, 20, 30, 210); p.noStroke()
        p.rect(chX, chY, chW, chH, 7)
        p.textSize(9); p.textAlign(p.RIGHT, p.CENTER)
        for (const [value, y] of [[rangeMv, plotTop], [0, plotMid], [-rangeMv, plotBottom]]) {
          p.stroke(255, 255, 255, 30); p.strokeWeight(1)
          p.line(plotX, y, plotX + plotW, y)
          p.noStroke(); p.fill(200, 200, 200, 180)
          p.text(`${value > 0 ? '+' : ''}${value} mV`, plotX - 5, y)
        }
        p.noFill(); p.stroke(245, 158, 11, 200); p.strokeWeight(1.5)
        p.beginShape()
        for (let k = 0; k <= steps; k++) {
          const fraction = Math.max(-1, Math.min(1, modelMillivolts(dvSamples[k]) / rangeMv))
          p.vertex(plotX + (k / steps) * plotW, plotMid - fraction * plotHalf)
        }
        p.endShape()
        const cursorX = plotX + (t / TOTAL_CYCLE) * plotW
        p.stroke(255, 255, 255, 120); p.strokeWeight(1)
        p.line(cursorX, plotTop, cursorX, plotBottom)
        p.fill(245, 158, 11, 200); p.noStroke()
        p.textAlign(p.LEFT, p.BOTTOM); p.textSize(9)
        const offScale = modelMillivolts(maxDV) > rangeMv
        p.text(offScale ? 'Off scale: choose a larger range' : 'Full-cycle ECG output ΔV', chX + 5, chY + chH - 4)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        if (Math.hypot(p.mouseX - probeA.x, p.mouseY - probeA.y) < PR + 6) { dragA = true; return }
        if (Math.hypot(p.mouseX - probeB.x, p.mouseY - probeB.y) < PR + 6) dragB = true
      }
      p.mouseDragged = () => {
        if (dragA) {
          const mirrorX = probeB.x, mirrorY = 2 * ROW_Y - probeB.y
          if (Math.hypot(p.mouseX - mirrorX, p.mouseY - mirrorY) < SNAP_RADIUS) {
            probeA.x = mirrorX; probeA.y = mirrorY
          } else {
            probeA.x = p.mouseX; probeA.y = p.mouseY
          }
        }
        if (dragB) {
          const mirrorX = probeA.x, mirrorY = 2 * ROW_Y - probeA.y
          if (Math.hypot(p.mouseX - mirrorX, p.mouseY - mirrorY) < SNAP_RADIUS) {
            probeB.x = mirrorX; probeB.y = mirrorY
          } else {
            probeB.x = p.mouseX; probeB.y = p.mouseY
          }
        }
      }
      p.mouseReleased = () => { dragA = false; dragB = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => { cancelled = true; inst.remove() }
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <button
          onClick={() => setPlaying(v => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            playing ? 'bg-gray-800 text-gray-300 border-gray-700' : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
          }`}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-widest text-gray-600 mr-0.5">Speed</span>
          {CELL_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded-md text-xs font-mono border transition-colors ${
                speed === s ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50' : 'text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowField(v => !v)}
          className={`shrink-0 px-3 py-1 rounded-full border text-xs transition-colors cursor-pointer ${showField ? 'bg-blue-900/50 border-blue-700 text-blue-300' : 'border-gray-700 text-gray-500 hover:text-gray-400'}`}
        >
          Field lines {showField ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => setShowEq(v => !v)}
          className={`shrink-0 px-3 py-1 rounded-full border text-xs transition-colors cursor-pointer ${showEq ? 'bg-teal-900/50 border-teal-700 text-teal-300' : 'border-gray-700 text-gray-500 hover:text-gray-400'}`}
        >
          Equipotentials {showEq ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => setShowCurrent(v => !v)}
          className={`shrink-0 px-3 py-1 rounded-full border text-xs transition-colors cursor-pointer ${showCurrent ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' : 'border-gray-700 text-gray-500 hover:text-gray-400'}`}
        >
          Current lines {showCurrent ? 'ON' : 'OFF'}
        </button>
      </SimBar>
      <SimBar>
        <button onClick={() => jumpTo(0)} className="px-3 py-1 rounded border border-gray-700 text-gray-300">Start</button>
        <button onClick={() => jumpTo(CENTERED_PULSE_MS)} className="px-3 py-1 rounded border border-gray-700 text-gray-300">Mid-cycle</button>
        <button onClick={() => resetProbesRef.current()} className="px-3 py-1 rounded border border-gray-700 text-gray-300">Reset probes</button>
        <span><span className="text-blue-400">R = resting (polarized)</span> · <span className="text-amber-400">D = depolarized</span></span>
      </SimBar>
      <SimBar>
        <span className="text-xs uppercase tracking-widest text-gray-600 shrink-0">Scrub</span>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={CELL_CYCLE_MS}
          defaultValue={0}
          step={1}
          onMouseDown={() => { scrubbingRef.current = true; setPlaying(false) }}
          onTouchStart={() => { scrubbingRef.current = true; setPlaying(false) }}
          onMouseUp={() => { scrubbingRef.current = false }}
          onTouchEnd={() => { scrubbingRef.current = false }}
          onChange={e => jumpTo(Number(e.target.value))}
          aria-label="Cycle time"
          className="flex-1 min-w-[120px] accent-emerald-500"
        />
        <span ref={scrubLabelRef} className="text-xs font-mono text-gray-500 tabular-nums w-28 text-right">
          0 / {CELL_CYCLE_MS} ms
        </span>
      </SimBar>
      <SimBar>
        <label className="flex items-center gap-2">
          Voltage range
          <select aria-label="Voltage range" value={voltageRange} onChange={e => setVoltageRange(Number(e.target.value))}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-300">
            {[1, 2, 5, 10].map(value => <option key={value} value={value}>±{value} mV</option>)}
          </select>
        </label>
        <span>Graph and arrow keep this scale as probes move. Readouts show the full values.</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 2D: Draggable vectors, dot product, projection ───────────────────────────
function SimDotProduct() {
  const containerRef = useRef()

  useEffect(() => {
    // Scaled ~0.78x from the original 720×450 (same uniform-factor rule as
    // Sim2A — see its comment).
    const W = 560, H = 350
    const OX = W / 2, OY = H / 2
    let cancelled = false

    const sketch = (p) => {
      let vecA = { x: 75, y: -56 }
      let vecB = { x: 107, y: 26 }
      let dragA = false, dragB = false
      const DR = 11
      const GRID = 37

      function dot(a, b) { return a.x * b.x + a.y * b.y }
      function mag(v) { return Math.hypot(v.x, v.y) }
      function norm(v) { const m = mag(v) || 1; return { x: v.x / m, y: v.y / m } }

      function arrow(x1, y1, x2, y2, r, g, b, a = 220, sw = 3) {
        p.stroke(r, g, b, a); p.strokeWeight(sw)
        p.line(x1, y1, x2, y2)
        const ang = Math.atan2(y2 - y1, x2 - x1), hs = 13
        p.fill(r, g, b, a); p.noStroke()
        p.triangle(x2, y2,
          x2 - hs * Math.cos(ang - 0.42), y2 - hs * Math.sin(ang - 0.42),
          x2 - hs * Math.cos(ang + 0.42), y2 - hs * Math.sin(ang + 0.42))
      }

      p.setup = () => {
        const cnv = p.createCanvas(W, H)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        // Backing buffer must have enough real pixels for the CSS-stretched
        // display size (plus device pixel ratio) or the upscale looks blurry.
        const rectW = cnv.elt.getBoundingClientRect().width || W
        const density = Math.min(3, Math.max(1, rectW / W) * (window.devicePixelRatio || 1))
        p.pixelDensity(density)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        p.textFont('monospace')
        if (cancelled) p.remove()
      }

      p.draw = () => {
        p.background(15, 20, 30)

        // Grid
        p.stroke(255, 255, 255, 11); p.strokeWeight(1)
        for (let x = OX % GRID; x < W; x += GRID) p.line(x, 0, x, H)
        for (let y = OY % GRID; y < H; y += GRID) p.line(0, y, W, y)

        // Axes
        p.stroke(255, 255, 255, 32); p.strokeWeight(1)
        p.line(0, OY, W, OY); p.line(OX, 0, OX, H)

        const bm = mag(vecB)
        const bn = norm(vecB)
        const am = mag(vecA)

        // Projection of A onto B
        if (bm > 0.1) {
          const projLen = dot(vecA, bn)
          const projX = OX + bn.x * projLen
          const projY = OY + bn.y * projLen

          // Dashed perpendicular from A tip to projection point
          p.stroke(59, 130, 246, 100); p.strokeWeight(1.4)
          p.drawingContext.setLineDash([4, 3])
          p.line(OX + vecA.x, OY + vecA.y, projX, projY)
          p.drawingContext.setLineDash([])

          // Projection segment on B axis
          p.stroke(59, 130, 246, 180); p.strokeWeight(4)
          p.line(OX, OY, projX, projY)

          // Projection endpoint marker
          p.fill(59, 130, 246, 200); p.noStroke()
          p.circle(projX, projY, 8)
        }

        // Resultant A+B (dashed, gray)
        const sx = OX + vecA.x + vecB.x, sy = OY + vecA.y + vecB.y
        p.stroke(150, 150, 150, 55); p.strokeWeight(1.8)
        p.drawingContext.setLineDash([5, 4])
        p.line(OX + vecA.x, OY + vecA.y, sx, sy)
        p.line(OX + vecB.x, OY + vecB.y, sx, sy)
        p.drawingContext.setLineDash([])
        arrow(OX, OY, sx, sy, 150, 150, 150, 70, 1.8)

        // Vector B (amber — the "lead axis")
        arrow(OX, OY, OX + vecB.x, OY + vecB.y, 245, 158, 11, 220, 3)
        const bAng = Math.atan2(vecB.y, vecB.x)
        p.fill(245, 158, 11, 190); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(14)
        p.text('B', OX + vecB.x + 17 * Math.cos(bAng + 0.5), OY + vecB.y + 17 * Math.sin(bAng + 0.5))

        // Vector A (blue — the "cardiac vector")
        arrow(OX, OY, OX + vecA.x, OY + vecA.y, 59, 130, 246, 220, 3)
        const aAng = Math.atan2(vecA.y, vecA.x)
        p.fill(59, 130, 246, 190); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(14)
        p.text('A', OX + vecA.x + 17 * Math.cos(aAng + 0.5), OY + vecA.y + 17 * Math.sin(aAng + 0.5))

        // Drag handles
        p.fill(59, 130, 246); p.noStroke()
        p.circle(OX + vecA.x, OY + vecA.y, DR * 2)
        p.fill(245, 158, 11)
        p.circle(OX + vecB.x, OY + vecB.y, DR * 2)

        // Info panel
        const dotVal = dot(vecA, vecB)
        const cosT = am > 0 && bm > 0 ? dotVal / (am * bm) : 0
        const theta = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI

        p.fill(15, 20, 30, 215); p.noStroke()
        p.rect(9, 9, 275, 110, 7)
        p.textAlign(p.LEFT, p.TOP); p.textSize(12)
        const gridDot = gridDotProduct(vecA, vecB, GRID)
        p.fill(255, 255, 255, 210); p.text(`A · B = ${gridDot.toFixed(3)} model units²`, 18, 18)
        p.fill(200, 200, 200, 150)
        p.text(`Compare length and angle`, 18, 34)
        p.fill(180, 180, 180, 130)
        p.text(`θ = ${theta.toFixed(1)}°    cosθ = ${cosT.toFixed(3)}`, 18, 50)
        p.fill(120, 120, 120, 100)
        p.text(`|A| = ${(am / GRID).toFixed(2)}    |B| = ${(bm / GRID).toFixed(2)}`, 18, 66)

        // Legend
        p.fill(59, 130, 246, 150); p.textSize(10); p.textAlign(p.LEFT, p.TOP)
        p.text('Lengths: model units (1 per grid square)', 18, 82)
        p.fill(52, 211, 153, 220); p.textSize(12)
        p.text(`Equivalent lead = ${formatMillivolts(gridDot * DOT_UNIT_TO_MV)}`, 18, 100)

        // Hint
        p.fill(255, 255, 255, 60); p.textAlign(p.LEFT, p.BOTTOM); p.textSize(12)
        p.text('Drag blue tip (A) or amber tip (B)', 9, H - 7)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        const mx = p.mouseX - OX, my = p.mouseY - OY
        if (Math.hypot(mx - vecA.x, my - vecA.y) < DR + 4) { dragA = true; return }
        if (Math.hypot(mx - vecB.x, my - vecB.y) < DR + 4) dragB = true
      }
      p.mouseDragged = () => {
        const mx = p.mouseX - OX, my = p.mouseY - OY
        if (dragA) { vecA.x = mx; vecA.y = my }
        if (dragB) { vecB.x = mx; vecB.y = my }
      }
      p.mouseReleased = () => { dragA = false; dragB = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => { cancelled = true; inst.remove() }
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span><span className="text-blue-400">Blue</span> = dipole vector (A) &nbsp;·&nbsp; <span className="text-amber-400">Amber</span> = lead axis (B) &nbsp;·&nbsp; <span className="text-gray-400">Projection shown on B axis</span></span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PhysicsFoundations() {
  const navigate = useNavigate()
  const { active, setActive } = useTabState(TABS.map(t => t.id))
  // Tabs now render as a sub-menu in the sidebar (see Sidebar.jsx) instead
  // of an in-page pill bar — this just publishes the same state there.
  usePublishTabs('physics', TABS, { active, setActive })

  return (
    <ModulePage
      moduleId="physics"
      number={2}
      title="Electrical Fields"
    >
      <p className="text-xs text-gray-400 mb-3">
        Model potentials are scaled to millivolts to illustrate ECG principles. The scale stays fixed
        as sources and probes move. Readings are rounded to 0.001 mV; 0.000 mV can be a small rounded value.
      </p>
      {/* ── 2A ──────────────────────────────────────────────────────────────── */}
      {active === '2A' && (
        <Section label="2A" title="Point charges create an electric field and potential">
          <p className="text-xs text-gray-400 leading-snug mb-2">
            Move the cursor without clicking to sample potential. Drag a charge to move it.
            The colored background represents potential: blue = positive, amber = negative.
            White lines and arrows represent the electric field. Toggle equipotential contours
            and compare cursor readings along and across them.
          </p>

          <Sim2A />

          <Callout>
            Electric field arrows point toward decreasing potential. Equipotential contours join
            locations of equal potential and cross field lines at right angles.
            <br /><br />When cardiac muscle depolarizes, positive
            ions rush into cells and a charge separation forms across the wavefront — positive charges
            ahead, negative charges behind. This is the same physics as two opposite charges on the canvas.
            The net effect at electrode distance approximates a single equivalent dipole.
          </Callout>

          <ForwardLink onNext={() => setActive('2B')}>continues in 2B — the dipole model</ForwardLink>
        </Section>
      )}

      {/* ── 2B ──────────────────────────────────────────────────────────────── */}
      {active === '2B' && (
        <Section label="2B" title="A dipole: the simplest model of the heart's field">
          <p className="text-xs text-gray-400 leading-snug mb-2">
            A dipole is a linked +/− pair with fixed separation. Drag its center region to rotate it.
            Drag the green probe to select a sampling location and read its potential in mV.
            Compare readings while changing one part of the arrangement at a time.
          </p>

          <Sim2B />

          <Callout>
            Potential depends on distance and direction relative to the dipole.
            <Equation label="θ = angle between dipole axis and probe direction">
              {'V(r, θ) ≈ (kp cos θ) / r²'}
            </Equation>
            This approximation applies at distances large compared with the charge separation.
            At equal distances from the two opposite charges, their potential contributions cancel.
            An equivalent dipole is a simplified representation of the heart's distributed sources.
          </Callout>

          <ForwardLink onNext={() => setActive('2C')}>continue to 2C — Depolarization</ForwardLink>
        </Section>
      )}

      {/* ── 2C ──────────────────────────────────────────────────────────────── */}
      {active === '2C' && (
        <Section label="2C" title="Compare cell states and extracellular recordings">
          <p className="text-xs text-gray-400 leading-snug mb-2">
            Ten cells are shown in a row. Blue R marks resting (polarized) cells; amber D marks depolarized cells.
            Use Play, Pause, and Scrub to inspect their states. Start and Mid-cycle select two instants;
            Reset probes restores the initial electrode positions.
            Drag the green (A) and purple (B) probes to sample extracellular potential.
            The graph shows ΔV = V(A) − V(B) over a full cycle; its cursor and the amber arrow mark the selected instant.
            Probes snap into a mirrored arrangement when placed at matching positions above and below
            the row. Use Voltage range to set the graph scale. Field lines, equipotentials, and
            current lines can be toggled below the animation.
          </p>

          <SimCells />

          <Callout>
            Extracellular sources arise where neighboring cells have different membrane potentials.
            A uniformly resting row has no sources in this model: each probe reads zero wherever it is placed.
            A uniformly depolarized row would also have no sources, but this short traveling pulse
            never depolarizes all ten cells at once.
            <br /><br />At Mid-cycle, a depolarized patch has matching resting regions on either side.
            With the probes in their initial symmetric positions, their potentials are equal and
            nonzero, so ΔV is zero. Moving one probe can reveal a voltage difference at the same instant.
            This is cancellation in a particular measurement, not the absence of extracellular sources.
            <br /><br />The two boundaries of a centered patch make opposing dipole contributions.
            A single boundary between resting and depolarized regions makes a dipole contribution;
            an entire pattern of activity need not have a nonzero net dipole.
            This is a simplified cable source model, not a full cardiac ECG.
          </Callout>

          <ForwardLink onNext={() => setActive('2D')}>continue to 2D — Dot Product</ForwardLink>
        </Section>
      )}
      {/* ── 2D ──────────────────────────────────────────────────────────────── */}
      {active === '2D' && (
        <Section label="2D" title="Compare two vectors">
          <p className="text-xs text-gray-400 leading-snug mb-2">
            Vector <strong className="text-blue-400">A</strong> represents a dipole at one instant.
            Vector <strong className="text-amber-400">B</strong> is the lead axis (the direction from −
            electrode to + electrode, with a modeled sensitivity given by its length).
            Vector lengths use model units, with one unit per grid square.
            The dashed line shows the projection of A onto B; the thick blue segment on the B axis
            shows its signed length.
          </p>

          <p className="text-xs text-gray-400 mb-2">
            Equivalent lead voltage = dot product × 0.1 mV per model unit². This fixed conversion
            illustrates how the projection affects a lead recording.
          </p>
          <SimDotProduct />

          <Explanation className="my-2">
          <Equation label="θ = angle between dipole vector and lead axis">
            {'A · B = |A| |B| cos θ'}
          </Equation>
          <div className="grid grid-cols-3 gap-3 text-sm mb-3">
            {[
              { θ: '0°',   result: 'cos θ = 1',  desc: 'Lead parallel to cardiac vector → maximum positive deflection', color: '#3b82f6' },
              { θ: '90°',  result: 'cos θ = 0',  desc: 'Lead perpendicular → zero contribution at this instant',                  color: '#6b7280' },
              { θ: '180°', result: 'cos θ = −1', desc: 'Lead anti-parallel → maximum negative (inverted waveform)',     color: '#f59e0b' },
            ].map(({ θ, result, desc, color }) => (
              <div key={θ} className="rounded-xl bg-gray-900 border border-gray-800 p-3">
                <p className="font-mono text-lg font-bold mb-1" style={{ color }}>θ = {θ}</p>
                <p className="font-mono text-xs text-gray-400 mb-2">{result}</p>
                <p className="text-xs text-gray-500 leading-snug">{desc}</p>
              </div>
            ))}
          </div>

          <p>
            In this model, a lead has a fixed vector (B).
            As the dipole vector (A) changes through time, its dot product with B changes.
            Applying the fixed voltage scale and plotting the result through time produces a
            modeled lead waveform. At any instant, a vector perpendicular to B contributes zero
            to that lead, even when the cardiac vector is substantial.
          </p>
          </Explanation>

          <ForwardLink onNext={() => navigate('/play/leads')}>continue to Module 3 — place electrodes and compare leads</ForwardLink>
        </Section>
      )}


    </ModulePage>
  )
}
