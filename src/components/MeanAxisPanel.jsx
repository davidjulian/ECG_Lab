import { classifyAxis } from '../lib/ECGEngine'

// ─── Shared "mean cardiac axis" UI ─────────────────────────────────────────────
// EinthovenAxisTriangle draws a standalone triangle + arrow (used wherever no
// existing triangle/wheel diagram exists to draw onto). AxisSummaryPanel is
// the parameter-agnostic chrome (classification bar + formula + annotation)
// reused everywhere the mean axis is shown, regardless of how the arrow
// itself gets drawn on that particular host.

const MEAN_AXIS_COLOR = '#facc15'   // bright yellow — deliberately distinct from
                                     // any instantaneous-vector color used elsewhere

// Decorative Einthoven triangle vertex angles (RA/LA/LL), degrees, SVG convention
// (0°=right, 90°=down) — chosen so the RA–LA edge lands on the 0° (Lead I) axis,
// matching real electrode geometry closely enough for a supplementary diagram.
const TRIANGLE_VERTICES = [
  { id: 'RA', angleDeg: 210 },
  { id: 'LA', angleDeg: -30 },
  { id: 'LL', angleDeg: 90 },
]
const AXIS_LINES = [
  { label: 'I',   angleDeg: 0,   color: '#60a5fa' },
  { label: 'II',  angleDeg: 60,  color: '#34d399' },
  { label: 'III', angleDeg: 120, color: '#f472b6' },
]

function pt(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

export function EinthovenAxisTriangle({ angleDeg, size = 200 }) {
  const cx = size / 2, cy = size / 2
  const r  = size * 0.42
  const verts = TRIANGLE_VERTICES.map(v => ({ ...v, ...pt(cx, cy, r, v.angleDeg) }))
  const tip   = pt(cx, cy, r * 0.85, angleDeg)
  const headLen = 11
  const rad = (angleDeg * Math.PI) / 180
  const ux = Math.cos(rad), uy = Math.sin(rad)
  const headA = { x: tip.x - headLen * (ux + 0.42 * uy), y: tip.y - headLen * (uy - 0.42 * ux) }
  const headB = { x: tip.x - headLen * (ux - 0.42 * uy), y: tip.y - headLen * (uy + 0.42 * ux) }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ overflow: 'visible' }}>
      <defs>
        <filter id="mean-axis-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Triangle outline */}
      <polygon
        points={verts.map(v => `${v.x},${v.y}`).join(' ')}
        fill="none" stroke="#94a3b8" strokeWidth={1.5}
      />
      {verts.map(v => (
        <g key={v.id}>
          <circle cx={v.x} cy={v.y} r={4} fill="#475569" />
          <text x={v.x} y={v.y - 8} fontSize={9} fill="#94a3b8" textAnchor="middle" fontFamily="monospace">{v.id}</text>
        </g>
      ))}

      {/* Lead axis lines through center */}
      {AXIS_LINES.map(({ label, angleDeg: a, color }) => {
        const p1 = pt(cx, cy, r, a), p2 = pt(cx, cy, r, a + 180)
        const lp = pt(cx, cy, r + 12, a)
        return (
          <g key={label}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeOpacity={1} strokeWidth={1.5} strokeDasharray="5,4" />
            <text x={lp.x} y={lp.y} fontSize={9} fontWeight="bold" fill={color} textAnchor="middle" fontFamily="monospace">{label}</text>
          </g>
        )
      })}

      {/* Mean QRS axis arrow — bold, bright, distinct from any instantaneous vector */}
      <circle cx={cx} cy={cy} r={3} fill={MEAN_AXIS_COLOR} />
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={MEAN_AXIS_COLOR} strokeWidth={4} strokeLinecap="round" filter="url(#mean-axis-glow)" />
      <polygon points={`${tip.x},${tip.y} ${headA.x},${headA.y} ${headB.x},${headB.y}`} fill={MEAN_AXIS_COLOR} filter="url(#mean-axis-glow)" />

      <text x={cx} y={size - 6} fontSize={11} fontWeight="bold" fill={MEAN_AXIS_COLOR} textAnchor="middle" fontFamily="monospace">
        Mean QRS Axis {angleDeg >= 0 ? '+' : ''}{angleDeg.toFixed(0)}°
      </text>
    </svg>
  )
}

// ── Classification bar segments, ordered as a continuous number line ──────────
const SEGMENTS = [
  { key: 'extreme', label: 'Extreme Axis',          range: '±180°',        min: -180, max: -90, color: '#a855f7' },
  { key: 'left',    label: 'Left Axis Deviation',    range: '< -30°',       min: -90,  max: -30, color: '#f59e0b' },
  { key: 'normal',  label: 'Normal Axis',            range: '-30° to +90°', min: -30,  max: 90,  color: '#10b981' },
  { key: 'right',   label: 'Right Axis Deviation',   range: '+90° to +180°',min: 90,   max: 180, color: '#f97316' },
]

const ANNOTATIONS = {
  normal:  'Normal axis. Dominant ventricular depolarization points down and left.',
  left:    'Left axis deviation. Consider: LBBB, left anterior fascicular block, inferior MI, Wolff-Parkinson-White.',
  right:   'Right axis deviation. Consider: RBBB, RVH, left posterior fascicular block, lateral MI.',
  extreme: "Extreme axis deviation ('northwest axis'). Consider: VTach, hyperkalemia, lead reversal.",
}

export function AxisSummaryPanel({ angleDeg, leadIMm, leadAVFMm }) {
  const cls = classifyAxis(angleDeg)
  const markerPct = ((angleDeg + 180) / 360) * 100
  const sign = v => (v >= 0 ? '+' : '')

  return (
    <div className="space-y-2">
      {/* Classification bar */}
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-600 mb-1">Axis Classification</p>
        <div className="relative h-6 rounded-md overflow-hidden flex border border-gray-800">
          {SEGMENTS.map(seg => (
            <div
              key={seg.key}
              className="h-full flex items-center justify-center text-[9px] font-medium leading-none"
              style={{
                width: `${((seg.max - seg.min) / 360) * 100}%`,
                backgroundColor: cls === seg.key ? seg.color + '55' : seg.color + '1a',
                color: cls === seg.key ? '#fff' : '#6b7280',
              }}
              title={`${seg.label} (${seg.range})`}
            >
              {seg.label}
            </div>
          ))}
          <div
            className="absolute top-0 bottom-0 w-0.5"
            style={{ left: `${markerPct}%`, backgroundColor: MEAN_AXIS_COLOR, boxShadow: `0 0 6px ${MEAN_AXIS_COLOR}` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-700 font-mono mt-0.5">
          <span>-180°</span><span>-90°</span><span>0°</span><span>+90°</span><span>+180°</span>
        </div>
      </div>

      {/* Computation */}
      <div className="rounded-lg bg-gray-900/70 border border-gray-800 px-2.5 py-1.5">
        <p className="text-xs text-gray-500 mb-1">Computation (Lead I / aVF method)</p>
        <p className="text-xs font-mono text-gray-300 leading-relaxed">
          Lead I net: <span className="text-blue-300">{sign(leadIMm)}{leadIMm.toFixed(0)}mm</span>,{' '}
          aVF net: <span className="text-emerald-300">{sign(leadAVFMm)}{leadAVFMm.toFixed(0)}mm</span>
          {' → '}Axis = arctan({leadAVFMm.toFixed(0)}/{leadIMm.toFixed(0)}) ={' '}
          <span style={{ color: MEAN_AXIS_COLOR }}>{sign(angleDeg)}{angleDeg.toFixed(0)}°</span>
        </p>
      </div>

      {/* Annotation */}
      <div
        className="rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
        style={{
          backgroundColor: SEGMENTS.find(s => s.key === cls).color + '14',
          border: `1px solid ${SEGMENTS.find(s => s.key === cls).color}40`,
          color: SEGMENTS.find(s => s.key === cls).color,
        }}
      >
        {ANNOTATIONS[cls]}
      </div>
    </div>
  )
}
