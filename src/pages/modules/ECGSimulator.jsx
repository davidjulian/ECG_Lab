import { GRID_MINOR, GRID_MAJOR, BASELINE } from '../../lib/diagramColors'
import { useEffect, useMemo, useRef, useState } from 'react'
import ModulePage from '../../components/ModulePage'
import Explanation from '../../components/Explanation'
import HeartAnimation from '../../components/HeartAnimation'
import {
  LEADS, LEAD_ORDER,
  ECGVoltage,
  buildRhythmFromPhysiology,
  physiologyToRhythmId,
  PHYSIOLOGY_DEFAULTS,
  ECGCycleTime,
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
    description: 'The SA node normally initiates each cardiac cycle. Change its baseline firing rate or the regularity of its impulses.',
    keys: ['saAutomaticity', 'firingRegularity'],
  },
  {
    id: 'atrial',
    label: 'Atrial Myocardium',
    description: 'Change propagation and recovery in atrial tissue, or introduce impulses from an atrial focus outside the SA node. Short conduction wavelengths select representative reentrant rhythms in this teaching model.',
    keys: ['atrialConductionVelocityPct', 'atrialRefractoryMs', 'atrialPrematureActivity', 'atrialPrematurityPct', 'atrialPrematureFoci'],
  },
  {
    id: 'av',
    label: 'AV Node and Junction',
    description: 'AV nodal conduction and recovery determine which atrial impulses reach the ventricles and when. Junctional tissue also provides a backup pacemaker.',
    keys: ['avDelayMs', 'avRefractoryMs', 'avRecoveryMs', 'avConduction', 'purkinjeAutomaticity'],
  },
  {
    id: 'his',
    label: 'His-Purkinje System',
    description: 'The His–Purkinje network distributes impulses through the ventricles. Change a branch’s conduction, introduce intermittent distal failure, or adjust distal backup automaticity.',
    keys: ['leftBundleVelocityPct', 'rightBundleVelocityPct', 'distalConductionFailure', 'ventricularEscapeRate'],
  },
  {
    id: 'ventricle',
    label: 'Ventricular Myocardium',
    description: 'Change the duration and regional variation of ventricular recovery, or introduce premature impulses that begin within ventricular tissue.',
    keys: ['ventricularApdMs', 'ventricularConductionVelocityPct', 'ventricularPrematureActivity', 'ventricularPrematurityPct', 'ventricularPrematureFoci', 'repolHeterogeneity'],
  },
  {
    id: 'ans',
    label: 'Autonomic Nervous System',
    description: 'Change autonomic activity to modify SA firing, AV conduction and recovery, action potential duration, and backup pacemaker activity together.',
    keys: ['sympatheticTone', 'parasympatheticTone'],
  },
  {
    id: 'ions',
    label: 'Ion Concentrations',
    description: 'Explore representative effects of potassium and calcium on excitability, conduction, and recovery. Concentrations and transitions are illustrative, not diagnostic thresholds.',
    keys: ['potassiumMEqL', 'calciumMgDl'],
  },
]

// Labels and units for the compact summary of changes from defaults.
const PARAM_SUMMARY = {
  saAutomaticity: ['Automaticity', ' bpm'],
  firingRegularity: ['Firing regularity', ''],
  atrialConductionVelocityPct: ['Conduction velocity', '%'],
  atrialRefractoryMs: ['Refractory period', ' ms'],
  avDelayMs: ['Baseline conduction delay', ' ms'],
  avRecoveryMs: ['Baseline recovery time', ' ms'],
  avConduction: ['Conduction', ''],
  avRefractoryMs: ['Refractory period', ' ms'],
  purkinjeAutomaticity: ['Junctional automaticity', ' bpm'],
  leftBundleVelocityPct: ['Left bundle velocity', '%'],
  rightBundleVelocityPct: ['Right bundle velocity', '%'],
  ventricularApdMs: ['Action potential duration', ' ms'],
  ventricularConductionVelocityPct: ['Myocardial conduction', '%'],
  repolHeterogeneity: ['Repolarization heterogeneity', ''],
  ventricularEscapeRate: ['Backup automaticity', ' bpm'],
  distalConductionFailure: ['Intermittent conduction failure', ''],
  atrialPrematureActivity: ['Premature activity', ''],
  atrialPrematurityPct: ['Premature impulse timing', '% of cycle'],
  atrialPrematureFoci: ['Premature foci', ''],
  ventricularPrematureActivity: ['Premature activity', ''],
  ventricularPrematurityPct: ['Premature impulse timing', '% of cycle'],
  ventricularPrematureFoci: ['Premature foci', ''],
  sympatheticTone: ['Sympathetic tone', '%'],
  parasympatheticTone: ['Parasympathetic tone', '%'],
  potassiumMEqL: ['Extracellular K⁺', ' mEq/L'],
  calciumMgDl: ['Total serum calcium', ' mg/dL'],
}
const summaryValue = (key, value) => {
  if (key === 'repolHeterogeneity' && value === 'none') return 'Low'
  const text = typeof value === 'string' ? value.charAt(0).toUpperCase() + value.slice(1) : value
  return `${text}${PARAM_SUMMARY[key][1]}`
}

// ── Physiological interpretation banner ──────────────────────────────────────
// A single {mechanismText, clinicalName, level} — mechanism always comes
// first, the clinical/rhythm name only appears after. Priority-ordered from
// most to least clinically dominant so co-occurring derangements collapse to
// one coherent story rather than a laundry list.
function physiologicalInterpretation(derived) {
  if (derived.ventricularRegime === 'fibrillation') return {
    mechanismText: 'A premature impulse in tissue with slow conduction and large recovery differences selects sustained, fragmented ventricular activation in this model. There is no coordinated ventricular beat or effective pumping. The colored fronts illustrate disorganization, not measured reentry circuits.',
    clinicalName: 'Ventricular Fibrillation', level: 'danger',
  }
  if (derived.ventricularRegime === 'tachycardia') return {
    mechanismText: 'A premature impulse in tissue with slow conduction and uneven recovery selects a repeating ventricular activation sequence in this model. Broad complexes recur rapidly, independently of SA timing. Greater recovery differences select a disorganized pattern. These settings illustrate possible mechanisms, not clinical thresholds.',
    clinicalName: 'Ventricular Tachycardia', level: 'danger',
  }
  const withIonNote = (base) => {
    if (derived.escapeSource !== undefined && derived.atrialRegime !== 'organized') base = { ...base, mechanismText: `${base.mechanismText} AV conduction is interrupted; ventricular activity depends on a backup pacemaker.` }
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
      mechanismText: 'Shorter refractoriness or slower conduction can favor reentry. This model selects representative atrial fibrillation at these settings; it does not simulate its initiating trigger or predict when AF will occur. Local atrial regions activate out of step, while the AV node filters impulses reaching the ventricles.',
      clinicalName: 'Atrial Fibrillation', level: 'warn',
    })
  }
  if (derived.atrialRegime === 'flutter') {
    return withIonNote({
      mechanismText: 'These settings select representative atrial flutter: rapid, organized atrial activation sustained by a repeating circuit. The model illustrates the resulting activity rather than calculating formation of that circuit.',
      clinicalName: 'Atrial Flutter', level: 'warn',
    })
  }
  if (derived.escapeSource !== undefined) {
    const source = derived.escapeSource === 'purkinje' ? 'junctional' : 'ventricular'
    if (derived.escapeSource === 'none') return withIonNote({
      mechanismText: 'No impulse is activating the ventricles in this model.', clinicalName: 'Ventricular Standstill', level: 'danger',
    })
    const complete = derived.avRatio === Infinity
    return withIonNote({
      mechanismText: complete
        ? `Atrial impulses do not reach the ventricles. A ${source} backup pacemaker supplies ventricular impulses.`
        : `The ${source} pacemaker supplies ventricular impulses while SA firing is absent or slower.`,
      clinicalName: complete ? `Complete AV Block (${source} escape)`
        : source === 'ventricular' && derived.ventricularRateBpm > 100 ? 'Ventricular Tachycardia'
        : `${source === 'junctional' ? 'Junctional' : 'Ventricular'} Rhythm`,
      level: complete ? 'warn' : 'info',
    })
  }
  if (derived.avBlockPattern) {
    const patterns = {
      wenckebach: ['PR lengthens during a group of conducted impulses. Incomplete AV nodal recovery eventually prevents conduction; the pause permits recovery.', 'Mobitz I (Wenckebach)'],
      nodal: ['Some atrial impulses arrive before the AV node can conduct again. A 2:1 pattern alone does not distinguish Mobitz I from Mobitz II.', 'Second-Degree AV Block'],
      distal: ['Some impulses fail in the His–Purkinje system. With stable AV nodal conduction, PR stays similar before and after the blocked impulse.', 'Intermittent Distal Block'],
    }
    const [mechanismText, clinicalName] = patterns[derived.avBlockPattern]
    return withIonNote({ mechanismText, clinicalName, level: 'warn' })
  }
  if (derived.atrialPrematureBeats || derived.ventricularPrematureBeats) {
    const sites = []
    if (derived.atrialPrematureBeats) sites.push(`${derived.multifocalAtrial ? 'Different atrial foci produce different P shapes' : 'An atrial focus produces an early P wave'}`)
    if (derived.ventricularPrematureBeats) sites.push(`${derived.multifocalVentricular ? 'Different ventricular foci produce different QRS shapes' : 'A ventricular focus produces an early, broad QRS complex'}`)
    return withIonNote({ mechanismText: `${sites.join('. ')}. Impulse origin changes the activation path and the waveform seen in the same lead.`,
      clinicalName: 'Premature Activity', level: 'info' })
  }
  if (derived.ventricularRefractoryBlocks) return withIonNote({
    mechanismText: 'Some incoming impulses arrive before ventricular tissue has recovered. Compare the atrial rate with the duration of ventricular recovery.',
    clinicalName: 'Incomplete Ventricular Capture', level: 'warn',
  })
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
  if (derived.myocardialSlowing > .1) return withIonNote({
    mechanismText: 'Slower cell-to-cell conduction prolongs the spread of ventricular activation and broadens QRS. This differs from slowing conduction through a specific bundle branch.',
    clinicalName: 'Slowed Ventricular Myocardial Conduction', level: 'warn',
  })
  if (derived.prIntervalMs > 200) {
    return withIonNote({
      mechanismText: 'AV nodal conduction is delayed. Each atrial impulse reaches the ventricles, but PR is prolonged.',
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
    mechanismText: 'Atrial impulses conduct regularly to the ventricles. This ECG has a sinus pattern with intervals within the displayed reference ranges.',
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
      <input aria-label={label} type="range" disabled={disabled} min={min} max={max} step={step} value={value}
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
        <button key={o.value} disabled={disabled} aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-1.5 text-xs transition-colors leading-tight ${
            value === o.value
              ? 'bg-emerald-600/35 text-emerald-300 font-medium'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PrematureControls({ site, params, set, disabled }) {
  const activity = `${site}PrematureActivity`, timing = `${site}PrematurityPct`, foci = `${site}PrematureFoci`
  const label = site === 'atrial' ? 'Atrial' : 'Ventricular'
  return <div className="space-y-2">
    <p className="text-xs text-gray-300">{label} premature activity</p>
    <SegBtn disabled={disabled} value={params[activity]} onChange={v => set(activity, v)} options={[
      { label: 'Off', value: 'off' }, { label: 'Occasional', value: 'occasional' }, { label: 'Frequent', value: 'frequent' },
    ]} />
    {params[activity] !== 'off' && <>
      <div role="group" aria-label={`${label} premature foci`}>
        <SegBtn disabled={disabled} value={params[foci]} onChange={v => set(foci, v)} options={[
          { label: 'Single focus', value: 'single' }, { label: 'Multifocal', value: 'multifocal' },
        ]} />
      </div>
      <Explanation title="Impulse timing">
        <ParamSlider disabled={disabled} label={`${label} premature impulse timing`} value={params[timing]} min={40} max={85} unit="% of cycle"
          onChange={v => set(timing, v)} hint="The fraction of the usual cycle before the premature impulse occurs. Smaller values introduce it earlier. Very early impulses may fail to activate tissue that has not recovered." />
      </Explanation>
    </>}
    <Explanation title="Control explanation">Premature impulses arise outside the SA node. Choose one focus or several foci, then compare successive waveforms in the same lead. This control illustrates premature activity without specifying its cellular cause.</Explanation>
  </div>
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
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const playbackRef = useRef({ playing: true, speed: 1 })
  useEffect(() => { playbackRef.current = { playing, speed } }, [playing, speed])
  const [params, setParams]   = useState(DEFAULT)
  const [leadId, setLeadId]   = useState('II')
  const physRhythm = useMemo(() => buildRhythmFromPhysiology(params), [params])
  // Which structure's controls the parameter panel is showing, and whether
  // its picker dropdown is open.
  const [openSection, setOpenSection] = useState('sa')
  const [menuOpen, setMenuOpen]       = useState(false)
  const explanationKey = JSON.stringify([params, openSection, leadId])
  const menuRef       = useRef(null)
  const canvasRef     = useRef(null)
  const controlsRef = useRef(null)
  const heartClockRef = useRef({ elapsedMs: 0, cycleMs: 800, tInCycle: 0, nativeCycleMs: null })
  const activeRef      = useRef({ leadId: 'II', rhythm: physRhythm })


  // Keep rAF ref and animation rhythm in sync with latest state
  useEffect(() => {
    activeRef.current = { leadId, rhythm: physRhythm }
  }, [physRhythm, leadId])

  // Single rAF loop — reads rhythm from ref each frame
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let animId, lastTs = null, elapsedMs = 0

    const render = (ts) => {
      if (lastTs !== null && playbackRef.current.playing) elapsedMs += (ts - lastTs) * playbackRef.current.speed
      lastTs = ts
      const { rhythm, leadId: lid } = activeRef.current
      const { cycleMs, nativeCycleMs } = rhythm
      // Both displays use the current rhythm and exactly the same phase.
      const tInCycle = ECGCycleTime(elapsedMs, cycleMs)

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
  const changedSettings = PARAM_SECTIONS.flatMap(section =>
    section.keys.filter(key => params[key] !== DEFAULT[key]).map(key => ({ section, key }))
  )
  const showControls = sectionId => {
    setOpenSection(sectionId)
    setMenuOpen(false)
    requestAnimationFrame(() => {
      controlsRef.current?.focus({ preventScroll: true })
      controlsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
  const sectionChanged = (section) => section.keys.some(k => params[k] !== DEFAULT[k])
  const anyChanged     = PARAM_SECTIONS.some(sectionChanged)

  const {
    saAutomaticity, firingRegularity,
    atrialConductionVelocityPct, atrialRefractoryMs,
    avDelayMs, avRecoveryMs, avConduction, avRefractoryMs,
    leftBundleVelocityPct, rightBundleVelocityPct, purkinjeAutomaticity,
    ventricularApdMs, ventricularConductionVelocityPct, repolHeterogeneity, ventricularEscapeRate, distalConductionFailure,
    sympatheticTone, parasympatheticTone,
    potassiumMEqL, calciumMgDl,
  } = params

  const derived = physRhythm.derived
  const rhythmId = physiologyToRhythmId(derived)
  const interp = physiologicalInterpretation(derived)

  const isBlock = avConduction === 'interrupted'

  const qtcMs = (physRhythm.measurable && derived.qtIntervalMs && derived.ventricularRateBpm > 0)
    ? Math.round(derived.qtIntervalMs / Math.sqrt(60 / derived.ventricularRateBpm))
    : null
  const qtcColor = !qtcMs ? '#6b7280' : qtcMs > 500 ? '#ef4444' : qtcMs > 440 ? '#f59e0b' : '#10b981'
  const prColor  = !derived.prIntervalMs ? '#6b7280' : derived.prIntervalMs > 200 ? '#f59e0b' : '#10b981'
  const qrsColor = !derived.qrsDurationMs ? '#6b7280' : derived.qrsDurationMs > 140 ? '#ef4444' : derived.qrsDurationMs > 120 ? '#f59e0b' : '#10b981'

  const bannerColor = { ok: '#10b981', info: '#60a5fa', warn: '#f59e0b', danger: '#ef4444' }[interp.level]

  const prRange = derived.prRangeMs
  const prText = prRange && Math.round(prRange[1]) > Math.round(prRange[0])
    ? `${Math.round(prRange[0])}–${Math.round(prRange[1])} ms`
    : derived.prIntervalMs ? `${Math.round(derived.prIntervalMs)} ms` : '—'
  const resetSection = () => setParams(p => ({ ...p, ...Object.fromEntries(activeSection.keys.map(k => [k, DEFAULT[k]])) }))
  const influences = ['ans', 'ions'].includes(openSection)
  const atrialReentry = derived.atrialRegime !== 'organized'

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
        <div className="flex flex-col md:flex-row gap-3 items-stretch">

          {/* ── ECG strip + conduction animation ───────────────────────── */}
          <div className="flex-1 min-w-0 rounded-xl bg-gray-950 border border-gray-800 p-3">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <button onClick={() => setPlaying(v => !v)} className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 bg-gray-800 text-white">{playing ? 'Pause' : 'Play'}</button>
              <div className="flex items-center gap-1.5" role="group" aria-label="Playback speed">
                <span className="text-xs text-gray-400">Speed</span>
                {[0.25, 0.5, 1].map(value => <button key={value} onClick={() => setSpeed(value)} aria-pressed={speed === value}
                  className={`px-2 py-1 rounded-md text-xs border ${speed === value ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50' : 'text-gray-400 border-gray-700'}`}>{value}×</button>)}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-widest">Lead</span>
                <div className="flex flex-wrap gap-1">
                  {LEAD_ORDER.map(id => (
                    <button key={id} onClick={() => setLeadId(id)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        leadId === id
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-700/50'
                          : 'text-gray-400 hover:text-gray-300'
                      }`}>
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-col md:flex-row gap-3 items-center">
              <HeartAnimation
                tissueWaves
                clockRef={heartClockRef}
                rhythmId={rhythmId}
                rhythm={physRhythm}
                className="shrink-0"
                width={240}
                height={280}
              />
              <div className="w-full flex-1 min-w-0">
                <canvas ref={canvasRef} width={CW} height={CH} className="w-full rounded-lg"
                  style={{ backgroundColor: '#030712' }} />
                <p className="text-xs text-gray-400 mt-1 text-right">Trace reflects current settings.</p>
                <p className="text-xs text-gray-400 mt-1 text-right">Vertical grid lines: 40 ms apart · Horizontal grid lines: 0.5 mV apart</p>
              </div>
            </div>
          </div>


        </div>

        <section aria-label="Changed settings" className="rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2">
          {changedSettings.length === 0 ? (
            <p className="text-xs text-gray-300">Default settings</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-300">Changed settings · {changedSettings.length}</span>
              {changedSettings.map(({ section, key }) => (
                <div key={key} className="relative group">
                  <button type="button" onClick={() => showControls(section.id)}
                    aria-describedby={`default-${key}`}
                    className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-2 py-1 text-left text-xs text-emerald-100 hover:bg-emerald-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
                    {section.label}: {PARAM_SUMMARY[key][0]} <strong className="tabular-nums">{summaryValue(key, params[key])}</strong>
                  </button>
                  <span id={`default-${key}`} role="tooltip"
                    className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden whitespace-nowrap rounded border border-gray-600 bg-gray-950 px-2 py-1 text-xs text-white shadow-lg group-hover:block group-focus-within:block">
                    Default: {summaryValue(key, DEFAULT[key])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ══ ROW 2: interpretation banner | current EKG measurements ═════ */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-start">

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
          <Explanation title="Measurements" resetKey={explanationKey} className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-2">PR describes conducted atrial impulses. QRS and QT include ventricular complexes. Ranges show variation; QTc is omitted for irregular or mixed rhythms.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-mono">
              <span className="text-gray-400">PR <span className="font-bold tabular-nums" style={{ color: prColor }}>{prText}</span></span>
              <span className="text-gray-400">Atrial rate <span className="text-gray-200">{derived.atrialRateBpm === null ? 'Disorganized' : `${Math.round(derived.atrialRateBpm)} bpm`}</span></span>
              <span className="text-gray-400">Ventricular rate <span className="text-gray-200">{derived.ventricularRateBpm === null ? 'Disorganized' : `${derived.ventricularRateBpm} bpm`}</span></span>
              <span className="text-gray-400">QRS <span className="font-bold tabular-nums" style={{ color: qrsColor }}>{derived.qrsRangeMs ? `${Math.round(derived.qrsRangeMs[0])}–${Math.round(derived.qrsRangeMs[1])} ms` : derived.qrsDurationMs ? `${Math.round(derived.qrsDurationMs)} ms` : '—'}</span></span>
              <span className="text-gray-400">QT <span className="font-bold tabular-nums text-gray-300">{derived.qtRangeMs ? `${Math.round(derived.qtRangeMs[0])}–${Math.round(derived.qtRangeMs[1])} ms` : derived.qtIntervalMs ? `${Math.round(derived.qtIntervalMs)} ms` : '—'}</span></span>
              <span className="text-gray-400">QTc <span className="font-bold tabular-nums" style={{ color: qtcColor }}>{qtcMs ? `${qtcMs}ms` : '—'}</span></span>
            </div>
          </Explanation>

        </div>

        {/* ══ ROW 3: parameter panel — one structure at a time ════════════
             All seven sections used to render at once in a two-column masonry
             (~1000px tall no matter what was actually being adjusted). A
             dropdown now picks one, so the ECG strip and heart animation above
             stay on screen alongside whichever slider is being dragged. */}
        <div ref={controlsRef} tabIndex={-1} aria-label="Structure controls" className="rounded-xl bg-gray-900 border border-gray-800 p-3 focus:outline-none">

          <div className="flex flex-wrap items-start gap-3 mb-2">

            {/* Structure picker */}
            <div ref={menuRef} className="relative shrink-0">
              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 w-60 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm font-semibold text-white hover:bg-gray-700 hover:border-gray-600 transition-colors"
              >
                <span className="flex-1 text-left truncate">{activeSection.label}</span>
                <svg className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
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
            <div className="flex-1 min-w-[180px]">
              <p className="text-xs text-gray-400 mb-2">Change a tissue property to isolate its effect, or change autonomic activity for a coordinated response. Inspect the ECG before opening Measurements or Interpretation.</p>
              <Explanation title="Structure explanation" resetKey={explanationKey}>{activeSection.description}</Explanation>
            </div>

            <button onClick={resetSection} disabled={!sectionChanged(activeSection)} className="shrink-0 px-3 py-2 rounded-lg text-xs border border-gray-700 text-gray-300 disabled:opacity-40">Reset this structure</button>
            <button
              onClick={() => setParams(DEFAULT)}
              disabled={!anyChanged}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs border transition-colors ${
                anyChanged
                  ? 'text-gray-300 border-gray-700 bg-gray-800 hover:bg-gray-700'
                  : 'text-gray-400 border-gray-800 cursor-not-allowed'
              }`}
            >
              Reset all
            </button>
          </div>

          <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">{influences ? 'Physiological influences' : 'Tissue properties'}</p>
          {/* Controls for the selected structure only — one column per control */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          >

            {openSection === 'sa' && <>
              <div>
                <ParamSlider label="Baseline SA firing rate" value={saAutomaticity} min={0} max={200} unit=" bpm" onChange={v => set('saAutomaticity', v)}
                  hint="Change SA automaticity directly while keeping autonomic activity fixed. At 0, SA firing is suppressed. Autonomic controls provide a separate way to change several tissue properties together." />
                <p className="text-xs text-gray-400 mt-2">Resulting SA rate: {Math.round(derived.effectiveSaRate)} bpm</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Firing regularity</p>
                <SegBtn value={firingRegularity} onChange={v => set('firingRegularity', v)} options={[
                  { label: 'Regular', value: 'regular' }, { label: 'Respiratory', value: 'respiratory' }, { label: 'Irregular', value: 'irregular' },
                ]} />
                <Explanation title="Control explanation">Respiratory variation illustrates cyclic vagal modulation. Irregular introduces variable sinus timing; this pattern alone does not identify a particular disease.</Explanation>
              </div>
            </>}

            {openSection === 'atrial' && <>
              <ParamSlider label="Atrial conduction velocity" value={atrialConductionVelocityPct} min={20} max={100} unit="%" onChange={v => set('atrialConductionVelocityPct', v)}
                hint="Change how quickly activation spreads through atrial tissue. Together with refractory period, conduction speed affects the conditions favoring reentry." />
              <ParamSlider label="Atrial refractory period" value={atrialRefractoryMs} min={150} max={350} unit=" ms" onChange={v => set('atrialRefractoryMs', v)}
                hint="Time during which atrial tissue cannot be re-excited. Shortening it can favor reentry, but does not inevitably cause AF. The model selects representative flutter or fibrillation without simulating the initiating trigger; its thresholds are not clinical cutoffs." />
              <Explanation title="Explore sustained atrial activity">
                From default settings, lower the atrial refractory period to 190 ms, then 150 ms. Watch the atria and compare successive ventricular beats. Try 0.25× speed. These settings select illustrative flutter and fibrillation; they are not clinical thresholds.
              </Explanation>
              <div>
                <PrematureControls site="atrial" params={params} set={set} disabled={atrialReentry || saAutomaticity === 0} />
                {(atrialReentry || saAutomaticity === 0) && <p className="text-xs text-gray-400 mt-2">Premature activity is available with organized SA firing. These settings are retained while another atrial rhythm is active.</p>}
              </div>
            </>}

            {openSection === 'av' && <>
              <div>
                <ParamSlider label="Baseline AV conduction delay" value={avDelayMs} min={60} max={350} unit=" ms" disabled={isBlock} onChange={v => set('avDelayMs', v)}
                  hint="Time for a recovered AV node to conduct an impulse. PR also includes conduction outside the AV node, so this setting is not the PR interval itself." />
                <p className="text-xs text-gray-400 mt-2">With current influences: {Math.round(derived.effectiveAvDelayMs)} ms</p>
              </div>
              <div>
                <ParamSlider label="Baseline AV refractory period" value={avRefractoryMs} min={200} max={600} unit=" ms" disabled={isBlock} onChange={v => set('avRefractoryMs', v)}
                  hint="The minimum recovery interval after AV nodal activation. Compare this with the time between arriving atrial impulses." />
                <p className="text-xs text-gray-400 mt-2">With current influences: {Math.round(derived.effectiveAvRefractoryMs)} ms</p>
              </div>
              <div>
                <ParamSlider label="Baseline AV recovery time" value={avRecoveryMs} min={100} max={1800} step={50} unit=" ms" disabled={isBlock} onChange={v => set('avRecoveryMs', v)}
                  hint="A longer recovery time leaves more residual effects from preceding impulses. Increasing it may first prolong PR while every impulse still conducts. At longer recovery times, impulses may be blocked. The transition depends on atrial rate, refractoriness, and autonomic activity; it is not a fixed physiological threshold." />
                <p className="text-xs text-gray-400 mt-2">With current influences: {Math.round(derived.effectiveAvRecoveryMs)} ms</p>
                <p className="text-xs text-gray-400 mt-2">Explore the full range and watch several consecutive beats; a repeating pattern may extend beyond the visible strip.</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">AV nodal conduction</p>
                <SegBtn value={avConduction} onChange={v => set('avConduction', v)} options={[{ label: 'Intact', value: 'intact' }, { label: 'Interrupted', value: 'interrupted' }]} />
                <Explanation title="Control explanation">Interrupt the connection through the AV node while retaining the automaticity of pacemakers below it.</Explanation>
              </div>
              <div>
                <ParamSlider label="Baseline junctional backup rate" value={purkinjeAutomaticity} min={0} max={80} unit=" bpm" onChange={v => set('purkinjeAutomaticity', v)}
                  hint="A junctional pacemaker is normally suppressed by incoming impulses. Compare its activity when SA firing slows or AV nodal conduction is interrupted. This controls backup automaticity, not premature beats." />
                <p className="text-xs text-gray-400 mt-2">With current influences: {Math.round(derived.effectivePurkinjeRate)} bpm</p>
              </div>
            </>}

            {openSection === 'his' && <>
              <ParamSlider label="Left bundle conduction" value={leftBundleVelocityPct} min={0} max={100} unit="%" onChange={v => set('leftBundleVelocityPct', v)}
                hint="Reduce conduction through the left bundle and compare ventricular activation. At zero, the branch cannot transmit impulses." />
              <ParamSlider label="Right bundle conduction" value={rightBundleVelocityPct} min={0} max={100} unit="%" onChange={v => set('rightBundleVelocityPct', v)}
                hint="Reduce conduction through the right bundle. Interrupting both bundles prevents atrial and junctional impulses from reaching the ventricles." />
              <div>
                <ParamSlider label="Baseline ventricular backup rate" value={ventricularEscapeRate} min={0} max={120} unit=" bpm" onChange={v => set('ventricularEscapeRate', v)}
                  hint="Automaticity of a distal ventricular pacemaker. It is normally suppressed by faster incoming impulses; it can supply escape beats or take over if its rate becomes faster. This is separate from premature activity." />
                <p className="text-xs text-gray-400 mt-2">With current influences: {Math.round(derived.effectiveEctopicRate)} bpm</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Intermittent distal conduction failure</p>
                <SegBtn value={distalConductionFailure} onChange={v => set('distalConductionFailure', v)} options={[
                  { label: 'None', value: 'none' }, { label: 'Occasional', value: 'occasional' }, { label: 'Frequent', value: 'frequent' },
                ]} />
                <Explanation title="Control explanation">Some impulses fail below the AV node. Begin with default AV settings to isolate this effect.</Explanation>
              </div>
            </>}

            {openSection === 'ventricle' && <>
              <ParamSlider label="Ventricular myocardial conduction" value={ventricularConductionVelocityPct} min={20} max={100} unit="%" onChange={v => set('ventricularConductionVelocityPct', v)}
                hint="Change cell-to-cell spread within ventricular muscle, separately from the bundle branches. Slower spread broadens QRS. With uneven recovery and a premature impulse, slow conduction can favor sustained reentry in a suitable pathway." />
              <div>
                <ParamSlider label="Baseline ventricular action potential duration" value={ventricularApdMs} min={200} max={500} unit=" ms" onChange={v => set('ventricularApdMs', v)}
                  hint="Change the duration of ventricular electrical recovery independently of SA firing. Autonomic activity can modify both. QT reflects activation and recovery across the ventricles, not an exact measurement of one cell’s action potential." />
                <p className="text-xs text-gray-400 mt-2">With current autonomic influences: {Math.round(derived.effectiveApdMs)} ms</p>
              </div>
              <div>
                <PrematureControls site="ventricular" params={params} set={set} disabled={atrialReentry || derived.escapeSource !== undefined} />
                {(atrialReentry || derived.escapeSource !== undefined) && <p className="text-xs text-gray-400 mt-2">Premature activity is available during organized atrial conduction. These settings are retained while another rhythm is active.</p>}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Repolarization heterogeneity</p>
                <SegBtn value={repolHeterogeneity} onChange={v => set('repolHeterogeneity', v)} options={[
                  { label: 'Low', value: 'none' }, { label: 'Moderate', value: 'moderate' }, { label: 'High', value: 'high' },
                ]} />
                <p className="text-xs text-gray-400 mt-2">Regional differences in recovery. This setting alone does not initiate premature beats.</p>
              </div>
              <Explanation title="Explore sustained ventricular activity">
                From default settings, set ventricular premature activity to Frequent, myocardial conduction to 30%, and repolarization heterogeneity to Moderate. Compare this with High heterogeneity. Use 0.25× speed to inspect the waves. This model selects representative VT and VF patterns; the settings are not clinical thresholds. Reset this structure to return to its baseline properties.
              </Explanation>
            </>}

            {openSection === 'ans' && (
              <>
                <div>
                  <ParamSlider
                    label="Sympathetic (Adrenergic) Tone"
                    value={sympatheticTone} min={0} max={100} unit="%"
                    onChange={v => set('sympatheticTone', v)}
                    hint="Noradrenaline/adrenaline acts on β1 receptors. Increases If (steeper phase 4 slope in SA node), enhances ICa-L (faster AV conduction), changes ventricular repolarization (represented here by a shorter action potential)."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-400 mt-1">↑ SA automaticity | ↓ AV conduction delay | ↓ AP duration</p></Explanation>
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-400 mt-0.5">Exercise, fear, pain, epinephrine, dopamine, dobutamine</p></Explanation>
                </div>
                <div>
                  <ParamSlider
                    label="Parasympathetic (Cholinergic) Tone"
                    value={parasympatheticTone} min={0} max={100} unit="%"
                    onChange={v => set('parasympatheticTone', v)}
                    hint="Acetylcholine acts on M2 receptors. Opens IKAch channels — hyperpolarizes SA node (slower automaticity) and slows AV node conduction (longer PR)."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-400 mt-1">↓ SA automaticity | ↑ AV conduction delay | variable AP duration</p></Explanation>
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-400 mt-0.5">Sleep, vasovagal syncope, digoxin, athletic training, carotid sinus massage</p></Explanation>
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
                    label="Total serum calcium (mg/dL)"
                    value={calciumMgDl} min={5.0} max={15.0} step={0.1} unit=" mg/dL"
                    color={calciumMgDl > 13 || calciumMgDl < 7 ? '#ef4444' : (calciumMgDl > 10.5 || calciumMgDl < 8.5) ? '#f59e0b' : '#10b981'}
                    onChange={v => set('calciumMgDl', v)}
                    hint="Ca2+ affects the threshold for action potential firing and the plateau phase duration via ICa-L. It does NOT change resting membrane potential significantly."
                  />
                  <Explanation resetKey={explanationKey} className="mt-2"><p className="text-xs text-gray-400 mt-1.5 leading-snug">
                    {calciumMgDl > 13
                      ? 'Severe hypercalcemia — abnormal notch at the J point (Osborn wave), also seen in hypothermia.'
                      : calciumMgDl > 10.5
                      ? 'In this model, increased calcium shortens the ST segment and QT.'
                      : calciumMgDl < 8.5
                      ? 'In this model, reduced calcium lengthens the ST segment and QT.'
                      : 'Normal range: 8.5-10.5 mg/dL.'}
                  </p></Explanation>
                </div>
              </>
            )}

          </div>
        </div>
        <Explanation title="Model explanation" className="mt-3">
          This model uses representative waveforms and simplified physiological relationships. Timing depends on preceding impulses; parameter thresholds are teaching settings rather than clinical cutoffs. Sustained rhythms illustrate possible outcomes, not a calculated reentry circuit or the likelihood of developing that rhythm. Fibrillation colors show local activation and recovery rather than a measured tissue map. Multifocal activity uses several illustrative activation paths. Changing a control redraws the entire trace for the current settings, rather than recording the transition between conditions.
        </Explanation>
      </div>
    </ModulePage>
  )
}
