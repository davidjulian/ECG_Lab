import { useEffect, useState } from 'react'
import ModulePage from '../../components/ModulePage'
import Explanation from '../../components/Explanation'
import { QRS_MS, FRONTAL_LEADS, vectorAt, project, averageVector } from '../../lib/meanAxisModel'
import { GRID_MINOR } from '../../lib/diagramColors'

const angleText = a => `${a > 0 ? '+' : ''}${Math.round(a)}°`
const button = 'rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700'
function Arrow({ vector, color, dashed = false }) {
  const x = 200 + vector.x * 100, y = 190 + vector.y * 100
  const angle = Math.atan2(vector.y, vector.x)
  if (Math.hypot(vector.x, vector.y) < 0.002) return null
  return <g stroke={color} fill={color}>
    <line x1="200" y1="190" x2={x} y2={y} strokeWidth="3" strokeDasharray={dashed ? '6 4' : undefined} />
    <polygon points={`${x},${y} ${x - 10 * Math.cos(angle - 0.4)},${y - 10 * Math.sin(angle - 0.4)} ${x - 10 * Math.cos(angle + 0.4)},${y - 10 * Math.sin(angle + 0.4)}`} />
  </g>
}
export default function MeanAxisPage() {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.1)
  const [rotation, setRotation] = useState(0)
  const [reveal, setReveal] = useState(false)
  const [trail, setTrail] = useState(true)
  useEffect(() => {
    if (!playing) return undefined
    let frame, last
    const tick = now => {
      if (last !== undefined) setTime(t => (t + (now - last) * speed) % (QRS_MS + 20))
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed])
  const shownTime = Math.min(time, QRS_MS)
  const instant = vectorAt(shownTime, rotation)
  const mean = averageVector(rotation)
  const accumulated = averageVector(rotation, shownTime)
  const samples = Array.from({ length: 201 }, (_, i) => ({ t: i / 2, v: vectorAt(i / 2, rotation) }))
  const trailPoints = samples.filter(s => s.t <= shownTime).map(s => `${200 + s.v.x * 100},${190 + s.v.y * 100}`).join(' ')
  return <ModulePage category="Advanced" title="Mean Axis" wide
    description="Play or scrub through ventricular depolarization. Compare the six lead traces, predict the average direction, then reveal the mean vector to check.">
    <div className="rounded-xl border border-gray-700 bg-gray-950 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        {[0.025, 0.05, 0.1].map(s => <button key={s} className={button} aria-pressed={speed === s} style={speed === s ? { background: '#115e59' } : undefined} onClick={() => setSpeed(s)}>{s}×</button>)}
        <span className="text-xs text-gray-400 ml-2">Playback relative to real time · 0.1× shows 100 ms in 1 second.</span>
      </div>
      <label className="flex items-center gap-3 text-sm text-gray-300">QRS time
        <input className="flex-1 accent-teal-400" type="range" min="0" max={QRS_MS} step="0.5" value={shownTime} onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }} />
        <span className="w-16 text-right font-mono">{shownTime.toFixed(0)} ms</span>
      </label>
      <div className="grid lg:grid-cols-[minmax(280px,0.85fr)_minmax(320px,1.15fr)] gap-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Frontal electrical vectors</h2>
          <svg viewBox="0 0 400 380" className="w-full max-w-[460px] mx-auto" role="img" aria-label="Conventional lead axes with the instantaneous cardiac vector and optional mean vector">
            <circle cx="200" cy="190" r="135" fill="none" stroke={GRID_MINOR} />
            {FRONTAL_LEADS.map(lead => {
              const a = lead.angle * Math.PI / 180
              return <g key={lead.name}>
                <line x1={200 - 135 * Math.cos(a)} y1={190 - 135 * Math.sin(a)} x2={200 + 135 * Math.cos(a)} y2={190 + 135 * Math.sin(a)} stroke="#8193a6" strokeDasharray="4 5" />
                <circle cx={200 + 135 * Math.cos(a)} cy={190 + 135 * Math.sin(a)} r="3" fill="#e2e8f0" />
                <text x={200 + 161 * Math.cos(a)} y={194 + 161 * Math.sin(a)} fill="#e2e8f0" textAnchor="middle" fontSize="12">{lead.name}{` ${angleText(lead.angle)}`}</text>
              </g>
            })}
            {trail && <polyline points={trailPoints} fill="none" stroke="#a5b4fc" strokeWidth="2" />}
            {trail && samples.filter((s, i) => i % 20 === 0 && s.t <= shownTime).map(s => <line key={s.t} x1="200" y1="190" x2={200 + s.v.x * 100} y2={190 + s.v.y * 100} stroke="#818cf8" strokeWidth="1.5" />)}
            {reveal && <Arrow vector={accumulated} color="#fbbf24" dashed />}
            {reveal && <Arrow vector={mean} color="#facc15" />}
            <Arrow vector={instant} color="#38bdf8" />
            <circle cx="200" cy="190" r="3" fill="white" />
            <text x="200" y="17" fill="#94a3b8" textAnchor="middle" fontSize="11">Superior</text>
            <text x="200" y="375" fill="#94a3b8" textAnchor="middle" fontSize="11">Inferior · patient’s left is screen right</text>
          </svg>
          <div className="flex flex-wrap gap-4 text-xs text-gray-300">
            <label><input type="checkbox" checked={trail} onChange={e => setTrail(e.target.checked)} /> Vector trail</label>
          </div>
          <p className="mt-3 text-xs text-sky-300">Blue: instantaneous vector{Math.hypot(instant.x, instant.y) > 0.01 ? ` · ${angleText(Math.atan2(instant.y, instant.x) * 180 / Math.PI)}` : ''}</p>
          {reveal && <p className="mt-2 text-xs text-yellow-300">Yellow: full QRS mean · {angleText(mean.angle)}<br />Dashed amber: contributions accumulated so far.</p>}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Six views of the same QRS complex</h2>
          <p className="text-xs text-gray-400 mt-1">All panels: −1.5 to +1.5 mV · 0–100 ms</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {FRONTAL_LEADS.map(lead => <div key={lead.name} className="rounded-lg border border-gray-700 p-2">
              <p className="text-xs text-gray-200">Lead {lead.name}{` (${angleText(lead.angle)})`}</p>
              <svg viewBox="0 0 260 130" className="w-full" role="img" aria-label={`Lead ${lead.name} QRS waveform with synchronized time cursor`}>
                {[20, 35, 50, 65, 80, 95, 110].map(y => <line key={y} x1="28" x2="248" y1={y} y2={y} stroke={GRID_MINOR} />)}
                {[28, 72, 116, 160, 204, 248].map(x => <line key={x} x1={x} x2={x} y1="20" y2="110" stroke={GRID_MINOR} />)}
                <text x="22" y="24" textAnchor="end" fill="#cbd5e1" fontSize="9">+1.5</text>
                <text x="22" y="69" textAnchor="end" fill="#cbd5e1" fontSize="9">0</text>
                <text x="22" y="113" textAnchor="end" fill="#cbd5e1" fontSize="9">−1.5</text>
                <text x="28" y="126" fill="#cbd5e1" fontSize="9">0</text><text x="248" y="126" textAnchor="end" fill="#cbd5e1" fontSize="9">100 ms</text>
                <polyline fill="none" stroke="#6ee7b7" strokeWidth="2.5" points={samples.map(s => `${28 + s.t * 2.2},${65 - project(s.v, lead.angle) * 30}`).join(' ')} />
                <line x1={28 + shownTime * 2.2} x2={28 + shownTime * 2.2} y1="20" y2="110" stroke="white" strokeWidth="1.5" strokeDasharray="4 3" />
                <circle cx={28 + shownTime * 2.2} cy={65 - project(instant, lead.angle) * 30} r="3.5" fill="#38bdf8" />
              </svg>
              {reveal && <p className="text-xs text-yellow-300 font-mono">Net area: {(project(mean, lead.angle) * QRS_MS).toFixed(1)} mV·ms</p>}
            </div>)}
          </div>
        </div>
      </div>
      <div className="border-t border-gray-700 pt-3 space-y-3">
        <label className="flex gap-3 items-center text-sm text-gray-300">Source rotation
          <input className="flex-1 accent-teal-400" aria-label="Source rotation" type="range" min="-180" max="180" step="5" value={rotation} onChange={e => { setRotation(Number(e.target.value)); setReveal(false) }} />
          <span className="w-14 font-mono text-right">{angleText(rotation)}</span>
        </label>
        <div className="flex flex-wrap gap-3 items-center">
          <button className={button} onClick={() => setReveal(!reveal)}>{reveal ? 'Hide mean vector' : 'Reveal mean vector'}</button>
          <button className={button} onClick={() => { setPlaying(false); setTime(0); setRotation(0); setReveal(false) }}>Reset</button>
          <p className="text-xs text-gray-400">Rotate the source, then predict again using the lead traces.</p>
        </div>
      </div>
    </div>
    <Explanation title="How the mean is constructed" className="mt-3">
      <p>The blue vector describes one instant. The thin spokes sample equal time intervals. To find the mean QRS vector, add the horizontal and vertical components throughout the QRS complex and divide by its duration. Larger vectors and longer lasting contributions carry more weight. The dashed amber vector shows that sum building toward the yellow mean.</p>
      <p className="mt-2">The signed area of each lead’s QRS is the projection of the integrated vector onto that lead. Positive and negative areas can cancel. The mean direction is not necessarily the direction at the R peak, and it does not describe every cell’s activation direction.</p>
      <p className="mt-2">Angles start at Lead I (0°, toward the patient’s left); +90° points inferiorly. These are conventional electrical axes sharing an origin, not anatomical lines between electrodes.</p>
    </Explanation>
    <p className="mt-3 text-xs text-gray-400">Illustrative model of ventricular depolarization only. Source rotation changes the orientation of the entire sequence; it does not simulate a specific disease. Waveform amplitudes use a common simplified projection scale.</p>
  </ModulePage>
}
