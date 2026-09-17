import { GRID_MINOR, GRID_MAJOR, BASELINE } from '../../lib/diagramColors'
import { useEffect, useRef, useState } from 'react'
import ModulePage from '../../components/ModulePage'
import Explanation from '../../components/Explanation'
import HeartAnimation from '../../components/HeartAnimation'
import {
  LEADS, LEAD_ORDER,
  ECGVoltage,
  buildRhythmFromPhysiology,
  physiologyToRhythmId,
  PHYSIOLOGY_DEFAULTS,
  warpTime,
} from '../../lib/ECGEngine'

// ── Canvas config ─────────────────────────────────────────────────────────────
// CH taller than before (was 200) — the canvas is CSS-width:100% with no
// explicit height, so height follows the CW:CH aspect ratio; growing CH
// alone (not CW) makes the rendered strip taller without changing how much
// time is visible (PX_MS is a fixed px-per-ms rate, driven by width).
const CW = 820, CH = 260
const PX_MS = 0.20     // horizontal: px per ms of trace
const PX_MV = 60       // vertical:   px per mV of signal
const BL    = 0.58     // baseline y-fraction (0 mV position)

const EMERALD    = '#10b981'

// ── UI param defaults ─────────────────────────────────────────────────────────
// Purely physiological — students never set PR/QRS/QT/axis directly. Every
// EKG measurement is a computed OUTPUT of buildRhythmFromPhysiology(), read
// back from its `derived` facts object.
const DEFAULT = PHYSIOLOGY_DEFAULTS

// ── Parameter sections ────────────────────────────────────────────────────────
// One entry per anatomical structure (plus the two global modifiers). Only the
// selected section's controls render at a time — see the dropdown in the
// parameter panel below. `keys` lists every PHYSIOLOGY_DEFAULTS key that
// section owns, which is what drives the "changed from default" dot on its
// dropdown option; between them the seven `keys` arrays must cover every key
// in PHYSIOLOGY_DEFAULTS exactly once, or a parameter becomes unreachable.
const PARAM_SECTIONS = [
  {
    id: 'sa',
    label: 'SA Node',
    description: 'The SA node fires spontaneously due to the funny current (If) and ICa-L. Its rate sets the baseline heart rate when conduction is intact.',
    keys: ['saAutomaticity', 'firingRegularity'],
  },
  {
    id: 'atrial',
    label: 'Atrial Myocardium',
    description: 'Once the SA node fires, depolarization spreads through the atria. How fast it conducts and how quickly it recovers determines whether organized or chaotic atrial activity occurs.',
    keys: ['atrialConductionVelocityPct', 'atrialRefractoryMs'],
  },
  {
    id: 'av',
    label: 'AV Node',
    description: 'The AV node is the only normal electrical connection between atria and ventricles. Its slow conduction velocity (0.05 m/s — 40× slower than Purkinje) creates the PR delay that allows atrial contraction to fill the ventricles before they contract. Like the SA node, AV-junctional tissue has its own intrinsic automaticity — normally overdrive-suppressed by the faster SA node, it emerges as an escape rhythm whenever SA input is too slow or fails to arrive.',
    keys: ['avConductionVelocityPct', 'avRecoveryBehavior', 'avRefractoryMs', 'purkinjeAutomaticity'],
  },
  {
    id: 'his',
    label: 'His-Purkinje System',
    description: 'Conducts at 2-4 m/s — 40-80× faster than the AV node. Ensures both ventricles activate nearly simultaneously, producing a narrow QRS. When a bundle branch fails, the affected ventricle must be activated slowly through muscle — widening the QRS.',
    keys: ['leftBundleVelocityPct', 'rightBundleVelocityPct'],
  },
  {
    id: 'ventricle',
    label: 'Ventricular Myocardium',
    description: 'The working muscle of the heart. Its action potential duration determines the QT interval and the vulnerable period for re-entry. Ectopic automaticity here produces wide, bizarre beats originating outside the normal conduction system.',
    keys: ['ventricularApdMs', 'repolHeterogeneity', 'ventricularEctopicRate'],
  },
  {
    id: 'ans',
    label: 'Autonomic Nervous System',
    description: 'The autonomic nervous system modulates several of the parameters above at once, rather than one at a time: SA rate, AV conduction velocity, ventricular action potential duration, and (sympathetic tone only) Purkinje/ventricular ectopic focus automaticity.',
    keys: ['sympatheticTone', 'parasympatheticTone'],
  },
  {
    id: 'ions',
    label: 'Ion Concentrations',
    description: 'The resting membrane potential and action potential shape depend on the electrochemical gradients for Na+, K+, and Ca2+. Changing extracellular concentrations shifts these gradients and alters every electrical property above.',
    keys: ['potassiumMEqL', 'calciumMgDl'],
  },
]

// ── Physiological interpretation banner ──────────────────────────────────────
// A single {mechanismText, clinicalName, level} — mechanism always comes
// first, the clinical/rhythm name only appears after. Priority-ordered from
// most to least clinically dominant so co-occurring derangements collapse to
// one coherent story rather than a laundry list.
function physiologicalInterpretation(derived) {
  const withIonNote = (base) => {
    if (!derived.ionAlert || base.ionHandled) return base
    return { ...base, mechanismText: `${base.mechanismText} ${derived.ionAlert}` }
  }

  if (derived.ionAlert?.startsWith('Sine-wave')) {
    return { mechanismText: derived.ionAlert, clinicalName: 'Severe Hyperkalemia — Sine Wave Pattern', level: 'danger', ionHandled: true }
  }
  if (derived.hyperkalemiaAlert) {
    return withIonNote({
      mechanismText: 'Extracellular potassium is critically elevated — every phase of the cardiac action potential is affected.',
      clinicalName: 'Critical Hyperkalemia', level: 'danger', ionHandled: true,
    })
  }
  if (derived.atrialRegime === 'fibrillation') {
    return withIonNote({
      mechanismText: 'The combination of atrial conduction velocity and refractory period permits re-entry in this model — multiple simultaneous circuits sustain disorganized activity.',
      clinicalName: 'Atrial Fibrillation', level: 'danger',
    })
  }
  if (derived.atrialRegime === 'flutter') {
    return withIonNote({
      mechanismText: 'Re-entry established — a single circuit is sustaining itself. The atria are contracting roughly 4× faster than normal.',
      clinicalName: 'Atrial Flutter', level: 'warn',
    })
  }
  if (derived.ectopicCapture === 'captured') {
    return withIonNote({
      mechanismText: 'The ventricular ectopic focus is now firing faster than the SA node — it has captured control of the ventricles.',
      clinicalName: derived.ventricularRateBpm > 150 ? 'Sustained Ventricular Tachycardia' : 'Ventricular Tachycardia',
      level: 'danger',
    })
  }
  if (derived.ectopicCapture === 'fusion') {
    return withIonNote({
      mechanismText: 'Two pacemakers are firing at similar rates — fusion beats appear when the SA impulse and the ectopic impulse activate the ventricle simultaneously.',
      clinicalName: 'Fusion Beats', level: 'warn',
    })
  }
  // A Purkinje/junctional escape focus can override the SA node even when
  // AV conduction is fully intact (ECGEngine's ratio===1 "fastest pacemaker
  // wins" branch) — checked separately from the block cases below since
  // this isn't an AV block at all.
  if (derived.escapeSource === 'purkinje' && derived.avRatio === 1) {
    return withIonNote({
      mechanismText: 'The Purkinje/junctional escape focus is now firing faster than the (slowed) SA node. AV conduction is intact, but this faster pacemaker has taken over control of the ventricles.',
      clinicalName: 'Accelerated Junctional Rhythm', level: 'warn',
    })
  }
  // escapeSource is set whenever ECGEngine routed through
  // buildEscapeOrStandstill — covers both literal complete block
  // (avRatio===Infinity) and finite high-grade block (avRatio 4-8, routed
  // here since Mobitz I/II's wave structure doesn't apply at that severity).
  // Checked before the avRatio>1 Mobitz case below so high-grade block isn't
  // mislabeled as Wenckebach/Mobitz II.
  if (derived.escapeSource !== undefined) {
    const complete = derived.avRatio === Infinity
    const degree = complete ? 'Third-Degree' : 'High-Grade'
    const noImpulseText = complete ? 'No atrial impulse reaches the ventricles' : 'Only rare atrial impulses reach the ventricles'
    if (derived.escapeSource === 'purkinje') {
      return withIonNote({
        mechanismText: `${complete ? 'Complete' : 'High-grade'} AV block. ${noImpulseText} — the Purkinje system is acting as an escape pacemaker.`,
        clinicalName: `${degree} AV Block (Junctional Escape)`, level: 'danger',
      })
    }
    if (derived.escapeSource === 'ventricular') {
      return withIonNote({
        mechanismText: `${complete ? 'Complete' : 'High-grade'} AV block. ${noImpulseText} — ventricular muscle itself is now acting as the escape pacemaker.`,
        clinicalName: `${degree} AV Block (Ventricular Escape)`, level: 'danger',
      })
    }
    return withIonNote({
      mechanismText: `${complete ? 'Complete' : 'High-grade'} AV block with no escape pacemaker firing — the ventricles are not contracting at all.`,
      clinicalName: complete ? 'Ventricular Standstill' : 'High-Grade AV Block (Standstill)', level: 'danger',
    })
  }
  if (derived.avRatio > 1) {
    return withIonNote(
      derived.avRecoveryBehavior === 'fatigue'
        ? {
            mechanismText: 'The AV node takes progressively longer to recover after each impulse, until one beat is finally blocked — then the node resets.',
            clinicalName: 'Mobitz I (Wenckebach)', level: 'warn',
          }
        : {
            mechanismText: 'The AV node either conducts or it doesn’t — recovery time is constant, so a blocked beat gives no warning.',
            clinicalName: 'Mobitz II', level: 'warn',
          }
    )
  }
  if (derived.leftImpairment >= 0.5 && derived.leftImpairment >= derived.rightImpairment) {
    return withIonNote({
      mechanismText: 'Left bundle branch conduction has failed. The left ventricle is now activated late, through slow muscle-to-muscle spread rather than fast Purkinje conduction.',
      clinicalName: 'Left Bundle Branch Block', level: 'warn',
    })
  }
  if (derived.rightImpairment >= 0.5 && derived.rightImpairment > derived.leftImpairment) {
    return withIonNote({
      mechanismText: 'Right bundle branch conduction has failed. The right ventricle activates late, producing a characteristic late rightward deflection.',
      clinicalName: 'Right Bundle Branch Block', level: 'warn',
    })
  }
  if (derived.prIntervalMs > 200) {
    return withIonNote({
      mechanismText: 'AV node conduction velocity is reduced — each SA impulse takes longer to traverse the node, but every impulse still gets through.',
      clinicalName: 'First-Degree AV Block', level: 'warn',
    })
  }
  if (derived.atrialErraticness > 0.3) {
    return withIonNote({
      mechanismText: 'The atrial refractory period is approaching the re-entry threshold — a re-entrant circuit hasn’t formed yet, but the margin is narrowing.',
      clinicalName: null, level: 'info',
    })
  }
  if (derived.effectiveSaRate > 100) {
    return withIonNote({
      mechanismText: `The SA node is firing at ${Math.round(derived.effectiveSaRate)} bpm, above the 60–100 bpm reference range.`,
      clinicalName: 'Sinus Tachycardia', level: 'info',
    })
  }
  if (derived.effectiveSaRate < 60) {
    return withIonNote({
      mechanismText: `The SA node is firing at ${Math.round(derived.effectiveSaRate)} bpm, below the 60–100 bpm reference range.`,
      clinicalName: 'Sinus Bradycardia', level: 'info',
    })
  }
  return withIonNote({
    mechanismText: 'All physiological parameters are within their normal reference ranges.',
    clinicalName: 'Normal Sinus Rhythm', level: 'ok',
  })
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────
function drawGrid(ctx, w, h) {
  const byY  = h * BL
  const step = 40 * PX_MS
  ctx.lineWidth = 1
  let i = 0
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID_MINOR
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = GRID_MINOR
  for (let y = byY; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = byY; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = BASELINE
  ctx.beginPath(); ctx.moveTo(0, byY); ctx.lineTo(w, byY); ctx.stroke()
}

function drawTrace(ctx, w, h, elapsedMs, { waves, cycleMs, nativeCycleMs }, leadAxisDeg) {
  const byY = h * BL
  ctx.beginPath()
  for (let x = 0; x <= w; x++) {
    const v = ECGVoltage(elapsedMs - (w - x) / PX_MS, cycleMs, waves, leadAxisDeg, nativeCycleMs)
    const y = byY - v * PX_MV
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke()
}

// ── Small sub-components ──────────────────────────────────────────────────────
function ParamSlider({ label, value, min, max, step = 1, unit = '', color, disabled, onChange, hint }) {
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none select-none' : ''}>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-gray-400">{label}</label>
        <span className="text-xs font-bold tabular-nums" style={{ color: color ?? '#e2e8f0' }}>
          {value}{unit}
        </span>
      </div>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded accent-emerald-500" />
      {hint && <Explanation title="Control explanation" resetKey={`${label}:${value}:${hint}`} className="mt-2">{hint}</Explanation>}
    </div>
  )
}

function SegBtn({ options, value, disabled, onChange }) {
  return (
    <div className={`flex rounded-lg overflow-hidden border border-gray-700 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-1.5 text-xs transition-colors leading-tight ${
            value === o.value
              ? 'bg-emerald-600/35 text-emerald-300 font-medium'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NoteChip({ level }) {
  const map = {
    ok:     { color: '#10b981', label: 'Normal'   },
    info:   { color: '#60a5fa', label: 'Note'     },
    warn:   { color: '#f59e0b', label: 'Abnormal' },
    danger: { color: '#ef4444', label: 'Critical' },
  }
  const { color, label } = map[level] ?? map.info
  return (
    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: color + '1a', border: `1px solid ${color}40` }}>
      {label}
    </span>
  )
}

// SectionHeader and CollapsibleSection lived here to head up the seven
// always-rendered physiology panels. The dropdown replaced both: the
// structure name is the dropdown's own label and the one-line description
// sits beside it, so neither component has a caller any more.

// ── Main component ────────────────────────────────────────────────────────────
export default function ECGSimulator() {
  const [params, setParams]   = useState(DEFAULT)
  const [leadId, setLeadId]   = useState('II')
  const [physRhythm, setPhysRhythm] = useState(() => buildRhythmFromPhysiology(DEFAULT))
  // Which structure's controls the parameter panel is showing, and whether
  // its picker dropdown is open.
  const [openSection, setOpenSection] = useState('sa')
  const [menuOpen, setMenuOpen]       = useState(false)
  const explanationKey = JSON.stringify([params, openSection, leadId])
  const menuRef       = useRef(null)
  const canvasRef     = useRef(null)
  const heartClockRef = useRef({ elapsedMs: 0, cycleMs: 800, tInCycle: 0, nativeCycleMs: null })
  const activeRef      = useRef({ leadId: 'II', rhythm: buildRhythmFromPhysiology(DEFAULT) })
  // Tracks a "virtual cycle start" so tInCycle stays continuous when a
  // parameter change alters cycleMs — see the phase-anchor comment below.
  const cycleAnchorRef = useRef({ anchorMs: 0, cycleMs: null })

  // Keep rAF ref and animation rhythm in sync with latest state
  useEffect(() => {
    const r = buildRhythmFromPhysiology(params)
    setPhysRhythm(r)
    activeRef.current = { leadId, rhythm: r }
  }, [params, leadId])

  // Single rAF loop — reads rhythm from ref each frame
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let animId, t0 = null

    const render = (ts) => {
      if (t0 === null) t0 = ts
      const { rhythm, leadId: lid } = activeRef.current
      const { cycleMs, nativeCycleMs } = rhythm
      const elapsedMs = ts - t0
      // Same warpTime() jitter the trace applies (via ECGVoltage) before its
      // own modulo, so the heart animation's notion of "where in the cycle
      // we are" stays phase-locked with what's actually drawn, not just
      // approximately in sync on average.
      const warpedMs = warpTime(elapsedMs)

      // A parameter change can alter cycleMs mid-session. elapsedMs/warpedMs
      // grow monotonically and are never reset, so naively modulo-ing them
      // against a new cycleMs would jump tInCycle instantly. Instead, shift
      // a "virtual cycle start" anchor whenever cycleMs changes so the
      // already-elapsed phase carries over continuously into the new cycle
      // length rather than jumping.
      const anchor = cycleAnchorRef.current
      if (anchor.cycleMs !== cycleMs) {
        const prevTInCycle = anchor.cycleMs != null
          ? ((warpedMs - anchor.anchorMs) % anchor.cycleMs + anchor.cycleMs) % anchor.cycleMs
          : 0
        cycleAnchorRef.current = { anchorMs: warpedMs - prevTInCycle, cycleMs }
      }
      const tInCycle = ((warpedMs - cycleAnchorRef.current.anchorMs) % cycleMs + cycleMs) % cycleMs

      heartClockRef.current = {
        elapsedMs,
        cycleMs,
        tInCycle,
        nativeCycleMs,
      }
      ctx.clearRect(0, 0, CW, CH)
      drawGrid(ctx, CW, CH)
      drawTrace(ctx, CW, CH, elapsedMs, rhythm, LEADS[lid].axisDeg)
      animId = requestAnimationFrame(render)
    }
    animId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animId)
  }, [])

  // Dismiss the section dropdown on an outside click or Escape. Listeners are
  // only attached while it's actually open, so the closed state costs nothing.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const set = (key, val) => setParams(p => ({ ...p, [key]: val }))

  const activeSection  = PARAM_SECTIONS.find(s => s.id === openSection) ?? PARAM_SECTIONS[0]
  const sectionChanged = (section) => section.keys.some(k => params[k] !== DEFAULT[k])
  const anyChanged     = PARAM_SECTIONS.some(sectionChanged)

  const {
    saAutomaticity, firingRegularity,
    atrialConductionVelocityPct, atrialRefractoryMs,
    avConductionVelocityPct, avRecoveryBehavior, avRefractoryMs,
    leftBundleVelocityPct, rightBundleVelocityPct, purkinjeAutomaticity,
    ventricularApdMs, repolHeterogeneity, ventricularEctopicRate,
    sympatheticTone, parasympatheticTone,
    potassiumMEqL, calciumMgDl,
  } = params

  const derived = physRhythm.derived
  const rhythmId = physiologyToRhythmId(derived)
  const interp = physiologicalInterpretation(derived)

  const isBlock = avConductionVelocityPct === 0

  const qtcMs = (derived.qtIntervalMs && derived.ventricularRateBpm > 0)
    ? Math.round(derived.qtIntervalMs / Math.sqrt(60 / derived.ventricularRateBpm))
    : null
  const qtcColor = !qtcMs ? '#6b7280' : qtcMs > 500 ? '#ef4444' : qtcMs > 440 ? '#f59e0b' : '#10b981'
  const prColor  = !derived.prIntervalMs ? '#6b7280' : derived.prIntervalMs > 200 ? '#f59e0b' : '#10b981'
  const qrsColor = !derived.qrsDurationMs ? '#6b7280' : derived.qrsDurationMs > 140 ? '#ef4444' : derived.qrsDurationMs > 120 ? '#f59e0b' : '#10b981'

  const bannerColor = { ok: '#10b981', info: '#60a5fa', warn: '#f59e0b', danger: '#ef4444' }[interp.level]

  // AV Node's live "atrial rate → interval → ratio" calculation display
  const atrialIntervalForCalc = derived.atrialRegime === 'flutter' ? 200 : (derived.atrialIntervalMs ?? 60000 / saAutomaticity)
  const atrialRateForCalc     = derived.atrialRegime === 'flutter' ? 300 : Math.round(derived.effectiveSaRate ?? saAutomaticity)
  const effectiveRefractoryForCalc = derived.effectiveAvRefractoryMs ?? avRefractoryMs

  return (
    <ModulePage
      moduleId="ECG"
      number={4}
      title="ECG Simulator"
      description="Use the physiological parameter controls to explore how changes in each cardiac structure affect the ECG. Compare the traces and measurements before opening optional explanations."
      wide
    >
      <div className="space-y-3">

        {/* ══ ROW 1: waveform + heart animation ═══════ */}
        <div className="flex gap-3 items-stretch">

          {/* ── ECG strip + conduction animation ───────────────────────── */}
          <div className="flex-1 min-w-0 rounded-xl bg-gray-950 border border-gray-800 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 uppercase tracking-widest">Lead</span>
                <div className="flex gap-1">
                  {LEAD_ORDER.map(id => (
                    <button key={id} onClick={() => setLeadId(id)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        leadId === id
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-700/50'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}>
                      {id}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {derived.ventricularRateBpm > 0 ? (
                  <span className="text-gray-500">
                    Ventricular rate{' '}
                    <span className="text-white font-bold tabular-nums">{derived.ventricularRateBpm}</span> bpm
                  </span>
                ) : (
                  <span className="text-red-400 font-medium">Ventricular standstill</span>
                )}
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <HeartAnimation
                tissueWaves
                clockRef={heartClockRef}
                rhythmId={rhythmId}
                rhythm={physRhythm}
                className="shrink-0"
                width={240}
                height={280}
              />
              <div className="flex-1 min-w-0">
                <canvas ref={canvasRef} width={CW} height={CH} className="w-full rounded-lg"
                  style={{ backgroundColor: '#030712' }} />
                <p className="text-xs text-gray-700 mt-1 text-right">40 ms / small square · 0.5 mV / square</p>
              </div>
            </div>
          </div>


        </div>

        {/* ══ ROW 2: interpretation banner | current EKG measurements ═════ */}
        <div className="flex gap-3 items-stretch">

          <Explanation title="Interpretation" resetKey={explanationKey} className="flex-[2.2] min-w-0">
          <div
            key={interp.clinicalName ?? interp.mechanismText}
            className="flex-[2.2] min-w-0 rounded-xl p-3 border animate-[pulse_0.6s_ease-out_1]"
            style={{ backgroundColor: bannerColor + '14', borderColor: bannerColor + '40' }}
          >
            <div className="flex items-start gap-2">
              <NoteChip level={interp.level} />
              <div className="min-w-0">
                <p className="text-sm text-gray-200 leading-relaxed">{interp.mechanismText}</p>
                {interp.clinicalName && (
                  <p className="text-xs font-semibold mt-1" style={{ color: bannerColor }}>
                    → This produces: {interp.clinicalName}
                  </p>
                )}
              </div>
            </div>
          </div>

          </Explanation>

          {/* Current EKG measurements — a READOUT, not a control */}
          <div className="flex-1 min-w-0 rounded-xl bg-gray-900/70 border border-gray-800 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-600 mb-1.5">Current EKG Measurements</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-mono">
              <span className="text-gray-500">PR <span className="font-bold tabular-nums" style={{ color: prColor }}>{derived.prIntervalMs ? `${Math.round(derived.prIntervalMs)}ms` : '—'}</span></span>
              <span className="text-gray-500">QRS <span className="font-bold tabular-nums" style={{ color: qrsColor }}>{derived.qrsDurationMs ? `${Math.round(derived.qrsDurationMs)}ms` : '—'}</span></span>
              <span className="text-gray-500">QT <span className="font-bold tabular-nums text-gray-300">{derived.qtIntervalMs ? `${Math.round(derived.qtIntervalMs)}ms` : '—'}</span></span>
              <span className="text-gray-500">QTc <span className="font-bold tabular-nums" style={{ color: qtcColor }}>{qtcMs ? `${qtcMs}ms` : '—'}</span></span>
            </div>
          </div>

        </div>

        {/* ══ ROW 3: parameter panel — one structure at a time ════════════
             All seven sections used to render at once in a two-column masonry
             (~1000px tall no matter what was actually being adjusted). A
             dropdown now picks one, so the ECG strip and heart animation above
             stay on screen alongside whichever slider is being dragged. */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">

          <div className="flex items-start gap-3 mb-2">

            {/* Structure picker */}
            <div ref={menuRef} className="relative shrink-0">
              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 w-60 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm font-semibold text-white hover:bg-gray-700 hover:border-gray-600 transition-colors"
              >
                <span className="flex-1 text-left truncate">{activeSection.label}</span>
                <svg className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div role="listbox"
                  className="absolute left-0 top-full mt-1 z-30 w-60 rounded-lg bg-gray-900 border border-gray-700 shadow-xl shadow-black/50 py-1">
                  {PARAM_SECTIONS.map(s => {
                    const isActive = s.id === activeSection.id
                    return (
                      <button
                        key={s.id}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => { setOpenSection(s.id); setMenuOpen(false) }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                          isActive
                            ? 'bg-emerald-600/20 text-emerald-300 font-medium'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                        }`}
                      >
                        <span className="flex-1 truncate">{s.label}</span>
                        {sectionChanged(s) && (
                          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: EMERALD }}
                            title="Changed from default" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* One-line physiological description for the selected structure */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-2">Change one control at a time, then compare the ECG and its measurements. Reset all restores the starting settings.</p>
              <Explanation title="Structure explanation" resetKey={explanationKey}>{activeSection.description}</Explanation>
            </div>

            <button
              onClick={() => setParams(DEFAULT)}
              disabled={!anyChanged}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs border transition-colors ${
                anyChanged
                  ? 'text-gray-300 border-gray-700 bg-gray-800 hover:bg-gray-700'
                  : 'text-gray-700 border-gray-800 cursor-not-allowed'
              }`}
            >
              Reset all
            </button>
          </div>

          {/* Controls for the selected structure only — one column per control */}
          <div
            className="grid gap-x-4 gap-y-2"
            style={{ gridTemplateColumns: `repeat(${activeSection.keys.length}, minmax(0, 1fr))` }}
          >

            {openSection === 'sa' && (
              <>
                <ParamSlider
                  label="SA Node Automaticity (bpm)"
                  value={saAutomaticity} min={20} max={200} unit=" bpm"
                  onChange={v => set('saAutomaticity', v)}
                  hint="Controlled by the slope of phase 4 spontaneous depolarization. Sympathetic tone steepens the slope (faster). Vagal tone flattens it (slower)."
                />
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Firing Regularity</label>
                  <SegBtn value={firingRegularity} onChange={v => set('firingRegularity', v)} options={[
                    { label: 'Regular',     value: 'regular'     },
                    { label: 'Respiratory', value: 'respiratory' },
                    { label: 'Irregular',   value: 'irregular'   },
                  ]} />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    {firingRegularity === 'regular'     && 'Constant P-P interval.'}
                    {firingRegularity === 'respiratory' && 'Normal variant. Vagal tone increases on expiration, slowing the SA node. Common in young, healthy individuals and athletes — not a pathological finding.'}
                    {firingRegularity === 'irregular'   && 'SA node dysfunction — sick sinus syndrome. Rate becomes unpredictable.'}
                  </p></Explanation>
                </div>
              </>
            )}

            {openSection === 'atrial' && (
              <>
                <ParamSlider
                  label="Atrial Conduction Velocity"
                  value={atrialConductionVelocityPct} min={20} max={100} unit="%"
                  onChange={v => set('atrialConductionVelocityPct', v)}
                  hint="Normal: ~1 m/s across the atrial wall. Slowing widens the P wave. Bachmann's bundle carries the impulse from right to left atrium."
                />
                <ParamSlider
                  label="Atrial Refractory Period (ms)"
                  value={atrialRefractoryMs} min={150} max={350} unit=" ms"
                  color={atrialRefractoryMs < 200 ? '#ef4444' : atrialRefractoryMs < 250 ? '#f59e0b' : '#10b981'}
                  onChange={v => set('atrialRefractoryMs', v)}
                  hint={
                    atrialRefractoryMs < 180
                      ? 'Multiple re-entrant wavelets — organized atrial contraction is lost.'
                      : atrialRefractoryMs < 200
                      ? 'Re-entry established — a single circuit is sustaining itself. The atria are contracting 4× faster than normal.'
                      : atrialRefractoryMs < 250
                      ? 'Atrial conduction is becoming slightly erratic — P wave morphology varies.'
                      : 'How long atrial cells cannot be re-excited after firing. Together with conduction velocity, this sets how far an impulse travels while tissue remains refractory; a short re-entry wavelength can permit sustained circuits.'
                  }
                />
              </>
            )}

            {openSection === 'av' && (
              <>
                <ParamSlider
                  label="AV Node Conduction Velocity"
                  value={avConductionVelocityPct} min={0} max={100} unit="%"
                  onChange={v => set('avConductionVelocityPct', v)}
                  hint={
                    avConductionVelocityPct === 0
                      ? 'Complete AV block. No atrial impulse reaches the ventricles. The ventricles are now depending entirely on their own backup pacemakers.'
                      : avConductionVelocityPct <= 20
                      ? 'The AV node can no longer conduct every impulse. Some atrial beats are blocked — you will see P waves with no following QRS.'
                      : avConductionVelocityPct <= 40
                      ? 'AV node struggles with rapid impulses — some fail to conduct, especially when atrial rate is fast.'
                      : avConductionVelocityPct <= 70
                      ? 'Conduction is slowed but intact. Every atrial impulse still reaches the ventricles — just later.'
                      : 'Normal: ~0.05 m/s. The slowest conduction in the heart — this is why the PR interval exists.'
                  }
                />
                <div>
                  <label className="text-xs text-gray-400 block mb-1">AV Node Recovery Pattern</label>
                  <SegBtn value={avRecoveryBehavior} onChange={v => set('avRecoveryBehavior', v)} options={[
                    { label: 'Uniform', value: 'uniform' },
                    { label: 'Fatigue', value: 'fatigue' },
                  ]} />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    {avRecoveryBehavior === 'fatigue'
                      ? "With each impulse, the AV node takes slightly longer to recover. This produces progressively longer PR intervals until a beat is finally blocked — then the node resets. This is the mechanism of Wenckebach."
                      : "The AV node either conducts or it doesn't — recovery time is constant. When a beat is blocked, there is no warning. This is the mechanism of Mobitz II."}
                  </p></Explanation>
                </div>
                <div>
                  <ParamSlider
                    label="AV Node Refractory Period (ms)"
                    value={avRefractoryMs} min={200} max={500} unit=" ms"
                    disabled={isBlock}
                    onChange={v => set('avRefractoryMs', v)}
                    hint="Determines the maximum atrial rate the AV node will conduct. At flutter rates (~300 bpm), the refractory period determines how many impulses get through (2:1, 3:1, 4:1). You don't set the ratio directly — it emerges from the refractory period and the atrial rate."
                  />
                  {!isBlock && (
                    <Explanation title="Conduction calculation" resetKey={explanationKey}>
                    <div className="mt-2 rounded-lg bg-gray-900/70 border border-gray-800 px-2.5 py-1.5 text-xs font-mono text-gray-400 leading-relaxed">
                      Atrial rate: <span className="text-gray-200">{atrialRateForCalc} bpm</span> → interval: <span className="text-gray-200">{Math.round(atrialIntervalForCalc)}ms</span>
                      <br />AV refractory period: <span className="text-gray-200">{Math.round(effectiveRefractoryForCalc)}ms</span>
                      {' → '}<span className="font-bold" style={{ color: EMERALD }}>{derived.avRatio}:{Math.max(1, derived.avRatio - 1)} conduction</span>
                    </div>
                    </Explanation>
                  )}
                </div>
                <div>
                  <ParamSlider
                    label="AV Junctional Automaticity (bpm)"
                    value={purkinjeAutomaticity} min={0} max={50} unit=" bpm"
                    onChange={v => set('purkinjeAutomaticity', v)}
                    hint="AV-junctional tissue has intrinsic automaticity — normally at ~40-60 bpm — but is normally suppressed by the faster SA node (overdrive suppression). This slider controls what happens when SA node suppression is removed or AV conduction fails: a narrow-QRS junctional escape rhythm. A distal ventricular escape (wide QRS) is the separate Ventricular Ectopic Automaticity slider."
                  />
                  {purkinjeAutomaticity > 0 && (
                    <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs mt-1.5 leading-snug" style={{ color: derived.escapeSource === 'purkinje' ? '#f59e0b' : '#6b7280' }}>
                      {derived.escapeSource === 'purkinje' && derived.avRatio === 1
                        ? `AV conduction is intact, but this focus (${Math.round(derived.effectivePurkinjeRate)} bpm) is now firing faster than the SA node (${Math.round(derived.effectiveSaRate)} bpm) — it has taken over control before any sinus impulse arrives.`
                        : derived.escapeSource === 'purkinje'
                        ? "The SA node's impulses aren't reaching the ventricles. The AV junction is now acting as an escape pacemaker — without it, the ventricles would not contract at all."
                        : `SA rate (${Math.round(derived.effectiveSaRate)} bpm) > AV junctional rate (${Math.round(derived.effectivePurkinjeRate)} bpm) — SA node is suppressing this backup pacemaker through overdrive suppression. Try slowing the SA node below the junctional rate, or blocking AV conduction, to see the escape rhythm emerge.`}
                    </p></Explanation>
                  )}
                </div>
              </>
            )}

            {openSection === 'his' && (
              <>
                <ParamSlider
                  label="Left Bundle Branch Velocity"
                  value={leftBundleVelocityPct} min={0} max={100} unit="%"
                  onChange={v => set('leftBundleVelocityPct', v)}
                  hint={
                    leftBundleVelocityPct < 30
                      ? "Left bundle branch conduction has failed. The left ventricle is now activated late, through slow muscle-to-muscle spread rather than fast Purkinje conduction. Watch the QRS widen above 120ms."
                      : leftBundleVelocityPct < 60
                      ? 'Incomplete LBBB — QRS 100-120ms, subtle morphology change.'
                      : "Carries the impulse to the left ventricle and left side of the septum. Supplies the left anterior and posterior fascicles."
                  }
                />
                <ParamSlider
                  label="Right Bundle Branch Velocity"
                  value={rightBundleVelocityPct} min={0} max={100} unit="%"
                  onChange={v => set('rightBundleVelocityPct', v)}
                  hint={
                    rightBundleVelocityPct < 30
                      ? "Right bundle branch conduction has failed. The right ventricle activates late. QRS widens, with a characteristic late rightward deflection (the 'rabbit ear')."
                      : rightBundleVelocityPct < 60
                      ? 'Incomplete RBBB — QRS 100-120ms, subtle morphology change.'
                      : 'Carries depolarization to the right ventricular myocardium and interventricular septum.'
                  }
                />
              </>
            )}

            {openSection === 'ventricle' && (
              <>
                <div>
                  <ParamSlider
                    label="Ventricular Action Potential Duration (ms)"
                    value={ventricularApdMs} min={200} max={500} unit=" ms"
                    onChange={v => set('ventricularApdMs', v)}
                    hint="Determines QT interval. Normally shortens at faster heart rates. When prolonged, the vulnerable period for re-entry widens — increasing the risk of Torsades de Pointes."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs mt-0.5 leading-snug" style={{ color: qtcColor }}>
                    {!qtcMs ? '' : qtcMs > 500 ? 'High risk — Torsades threshold approached.' : qtcMs > 440 ? 'Borderline prolonged — vulnerable period widening.' : 'Within normal range.'}
                  </p></Explanation>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Repolarization Heterogeneity</label>
                  <SegBtn value={repolHeterogeneity} onChange={v => set('repolHeterogeneity', v)} options={[
                    { label: 'None',     value: 'none'     },
                    { label: 'Moderate', value: 'moderate' },
                    { label: 'High',     value: 'high'     },
                  ]} />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    {repolHeterogeneity === 'none'     && 'Uniform T wave, low arrhythmia risk.'}
                    {repolHeterogeneity === 'moderate'  && 'T wave changes, inverted or biphasic.'}
                    {repolHeterogeneity === 'high'      && 'Heterogeneous repolarization creates a re-entry substrate — some regions are excitable while adjacent regions are still refractory. Re-entrant beats begin appearing.'}
                  </p></Explanation>
                </div>
                <div>
                  <ParamSlider
                    label="Ventricular Ectopic Focus Automaticity (bpm)"
                    value={ventricularEctopicRate} min={0} max={120} unit=" bpm"
                    onChange={v => set('ventricularEctopicRate', v)}
                    hint="Ventricular muscle cells do not normally fire spontaneously — they wait for the Purkinje impulse. Ischemia, electrolyte abnormalities, and catecholamine excess can cause spontaneous depolarization in a small region of ventricular muscle, creating an ectopic focus."
                  />
                  {ventricularEctopicRate > 150 && derived.ectopicCapture === 'captured' && (
                    <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-red-400 mt-1.5 leading-snug">
                      Sustained ventricular tachycardia — haemodynamically dangerous. At these rates, ventricular filling is severely compromised.
                    </p></Explanation>
                  )}
                </div>
              </>
            )}

            {openSection === 'ans' && (
              <>
                <div>
                  <ParamSlider
                    label="Sympathetic (Adrenergic) Tone"
                    value={sympatheticTone} min={0} max={100} unit="%"
                    onChange={v => set('sympatheticTone', v)}
                    hint="Noradrenaline/adrenaline acts on β1 receptors. Increases If (steeper phase 4 slope in SA node), enhances ICa-L (faster AV conduction), shortens action potential duration (shorter QT)."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-1">↑ SA automaticity | ↓ AV conduction delay | ↓ AP duration</p></Explanation>
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-700 mt-0.5">Exercise, fear, pain, epinephrine, dopamine, dobutamine</p></Explanation>
                </div>
                <div>
                  <ParamSlider
                    label="Parasympathetic (Cholinergic) Tone"
                    value={parasympatheticTone} min={0} max={100} unit="%"
                    onChange={v => set('parasympatheticTone', v)}
                    hint="Acetylcholine acts on M2 receptors. Opens IKAch channels — hyperpolarizes SA node (slower automaticity) and slows AV node conduction (longer PR)."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-1">↓ SA automaticity | ↑ AV conduction delay | variable AP duration</p></Explanation>
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-700 mt-0.5">Sleep, vasovagal syncope, digoxin, athletic training, carotid sinus massage</p></Explanation>
                </div>
              </>
            )}

            {openSection === 'ions' && (
              <>
                <div>
                  <ParamSlider
                    label="Extracellular [K+] (mEq/L)"
                    value={potassiumMEqL} min={2.0} max={9.0} step={0.1} unit=" mEq/L"
                    color={potassiumMEqL > 7 || potassiumMEqL < 2.5 ? '#ef4444' : (potassiumMEqL > 5.5 || potassiumMEqL < 3.5) ? '#f59e0b' : '#10b981'}
                    onChange={v => set('potassiumMEqL', v)}
                    hint="K+ gradient determines resting membrane potential (Nernst equation). Low K+ hyperpolarizes cells and prolongs action potentials. High K+ depolarizes cells and slows conduction globally."
                  />
                  {derived.ionAlert && (
                    <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs mt-1.5 leading-snug" style={{ color: derived.hyperkalemiaAlert ? '#ef4444' : '#f59e0b' }}>
                      {derived.hyperkalemiaAlert && '⚠ Critical hyperkalemia. '}{derived.ionAlert}
                    </p></Explanation>
                  )}
                </div>
                <div>
                  <ParamSlider
                    label="Extracellular [Ca2+] (mg/dL)"
                    value={calciumMgDl} min={5.0} max={15.0} step={0.1} unit=" mg/dL"
                    color={calciumMgDl > 13 || calciumMgDl < 7 ? '#ef4444' : (calciumMgDl > 10.5 || calciumMgDl < 8.5) ? '#f59e0b' : '#10b981'}
                    onChange={v => set('calciumMgDl', v)}
                    hint="Ca2+ affects the threshold for action potential firing and the plateau phase duration via ICa-L. It does NOT change resting membrane potential significantly."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-600 mt-1.5 leading-snug">
                    {calciumMgDl > 13
                      ? 'Severe hypercalcemia — abnormal notch at the J point (Osborn wave), also seen in hypothermia.'
                      : calciumMgDl > 10.5
                      ? 'Enhanced ICa-L terminates the plateau more quickly — QT shortens.'
                      : calciumMgDl < 8.5
                      ? 'ST segment lengthens because ICa-L is reduced — the plateau phase takes longer to terminate. Predisposes to Torsades.'
                      : 'Normal range: 8.5-10.5 mg/dL.'}
                  </p></Explanation>
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </ModulePage>
  )
}
