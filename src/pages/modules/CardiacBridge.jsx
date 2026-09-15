import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import p5 from 'p5'
import ModulePage from '../../components/ModulePage'
import HeartAnimation, { buildConductionMap } from '../../components/HeartAnimation'
import { ECGVoltage, cycleVoltage, buildRhythmFromParams, meanQRSAxis } from '../../lib/ECGEngine'
import { AxisSummaryPanel } from '../../components/MeanAxisPanel'
import { useTabState, usePublishTabs } from '../../components/ModuleTabs'

// ── Constants ──────────────────────────────────────────────────────────────
const CYCLE_MS = 800
const DEFAULT_RHYTHM_PARAMS = {
  saNodeRate: 75, avConductionRatio: 'all', prInterval: 160,
  qrsDuration: 80, qtInterval: 380, pWaveMode: 'present', escapeRhythm: 'none',
}

// ── Anatomy data ───────────────────────────────────────────────────────────
const ANATOMY = {
  sa: {
    name: 'SA Node (Sinoatrial Node)',
    apType: 'sa',
    fn: 'Primary pacemaker — spontaneously depolarizes 60–100 times per minute without external stimulus. Located at the junction of the superior vena cava and the right atrium.',
    electrical: 'Fires via If (HCN "funny" channels) + ICa-T during Phase 4 pacemaker potential. No stable resting potential. Upstroke driven by ICa-L (not fast INa), producing a slow, rounded action potential. Slope of Phase 4 determines heart rate.',
    ECG: 'Not directly visible on surface ECG. Its firing initiates the P wave, but the SA node signal is too small. Dysfunction manifests as sinus bradycardia, sick sinus syndrome, or sinus arrest.',
  },
  ra: {
    name: 'Right Atrium',
    apType: 'myocyte',
    fn: 'Receives deoxygenated blood from the superior and inferior vena cava and coronary sinus. Contracts to complete ventricular filling (atrial kick).',
    electrical: 'Fast-response myocyte with prominent Phase 0 INa upstroke. Conduction from SA node spreads at ~1 m/s. Refractory period shorter than ventricles, enabling rapid atrial rhythms.',
    ECG: 'Initial (first half) of the P wave. Right atrial enlargement prolongs or widens the early P wave. Depolarizes slightly before left atrium.',
  },
  la: {
    name: 'Left Atrium',
    apType: 'myocyte',
    fn: 'Receives oxygenated blood from four pulmonary veins. Contracts to complete left ventricular filling. Forms the posterior heart border on chest X-ray.',
    electrical: "Connected to RA via Bachmann's bundle (interatrial conduction pathway). Conduction velocity ~1 m/s. Activates slightly later than RA due to path length.",
    ECG: "Terminal (second half) of the P wave. Left atrial enlargement produces a bifid P wave (P mitrale) in lead II or negative terminal deflection in V1.",
  },
  av: {
    name: 'AV Node (Atrioventricular Node)',
    apType: 'sa',
    fn: 'The only normal electrical bridge between atria and ventricles (AV annulus is otherwise electrically insulating). Imposes a 120–200 ms delay — critical for allowing ventricular filling before systole.',
    electrical: 'Slow-response cells like SA node: upstroke via ICa-L, no fast INa. Conduction velocity only 0.05 m/s — the slowest in the heart. Heavily innervated by both vagal (slows) and sympathetic (accelerates) fibers. Site of most Wenckebach and complete heart block.',
    ECG: 'Responsible for the PR interval. AV nodal delay = isoelectric PR segment. First-degree block = PR > 200 ms. Third-degree block = complete dissociation of P waves and QRS complexes.',
  },
  his: {
    name: 'Bundle of His',
    apType: 'purkinje',
    fn: 'Exits the AV node and penetrates the fibrous skeleton of the heart, dividing into left and right bundle branches. Rapid conduction ensures synchronous ventricular activation.',
    electrical: 'Purkinje-type: fast INa upstroke, very rapid conduction (1–2 m/s), long plateau phase. His bundle recording (catheter lab) confirms whether block is above or below the bundle.',
    ECG: 'Not directly visible. Conduction through His-Purkinje system forms the early part of the QRS complex. His-Purkinje disease → wide QRS, bundle branch blocks.',
  },
  rbundle: {
    name: 'Right Bundle Branch',
    apType: 'purkinje',
    fn: 'Carries depolarization to the right ventricular myocardium and interventricular septum (right side). Travels subendocardially along the right side of the septum.',
    electrical: 'Purkinje fiber type. Conduction 2–4 m/s. Terminates in Purkinje network. Right bundle branch is thinner and more susceptible to block than left.',
    ECG: 'Block → RBBB pattern: wide QRS (≥120 ms), rSR′ in V1 (right-ear rabbit pattern), wide S in lateral leads (I, V5, V6). Incomplete RBBB = 100–119 ms.',
  },
  lbundle: {
    name: 'Left Bundle Branch',
    apType: 'purkinje',
    fn: 'Carries depolarization to the left ventricular myocardium and septum (left side). Fans into anterior and posterior fascicles.',
    electrical: 'Purkinje fiber type. Conduction 2–4 m/s. Left bundle has two fascicles — anterior (LAD artery supply) and posterior (dual supply, more resistant to block).',
    ECG: 'Block → LBBB: wide QRS, broad notched R in lateral leads, QS in V1. Left anterior fascicular block → left axis deviation. Left posterior fascicular block → right axis deviation.',
  },
  purkinje: {
    name: 'Purkinje Fibers',
    apType: 'purkinje',
    fn: 'Terminal conduction network fanning from bundle branches into ventricular myocardium. Ensures nearly simultaneous endocardial activation across both ventricles.',
    electrical: 'Fastest conduction in heart (2–4 m/s). Longest action potential duration. Longest Phase 2 plateau. Tertiary pacemaker (20–40 bpm) if SA and AV nodes fail — escape rhythm. Susceptible to triggered activity (EADs, DADs).',
    ECG: 'No discrete surface ECG representation. Their rapid activation underlies the narrow normal QRS (< 100 ms). Block in Purkinje fan → slow myocardial spread → wide, aberrant QRS.',
  },
  rv: {
    name: 'Right Ventricle',
    apType: 'myocyte',
    fn: 'Pumps deoxygenated blood into the pulmonary circulation via the pulmonary artery at low pressure (~25 mmHg systolic). Thin-walled, crescent-shaped in cross-section.',
    electrical: 'Activated by right bundle branch via Purkinje network, endocardium to epicardium. Myocyte action potential (Phases 0–4). Thinner wall means smaller contribution to QRS than LV.',
    ECG: 'Right ventricular hypertrophy → right axis deviation, dominant R in V1 (R > S). RV infarction (often with inferior STEMI) → ST elevation in V3R–V4R.',
  },
  lv: {
    name: 'Left Ventricle',
    apType: 'myocyte',
    fn: 'Pumps oxygenated blood into the systemic circulation at high pressure (~120 mmHg systolic). Thick-walled (~1 cm), ellipsoid. Generates the largest electrical forces in the heart.',
    electrical: 'Activated by left bundle branch, endocardium to epicardium. Myocyte action potential. LV mass dominates QRS vector — explains why normal axis points leftward and inferiorly (toward LV).',
    ECG: 'LV hypertrophy → increased R in V5/V6 + deep S in V1/V2 (Sokolow-Lyon). Dominant contributor to QRS amplitude. Lateral STEMI = LV territory (LAD / circumflex).',
  },
  septum: {
    name: 'Interventricular Septum',
    apType: 'myocyte',
    fn: 'Muscular wall separating right and left ventricles. Depolarizes from left-to-right first, creating the initial septal q waves in lateral leads. Shares mechanical load with both ventricles.',
    electrical: 'Left-to-right initial depolarization (LBB activates septum first). This produces small q waves in I, aVL, V5, V6 — normal narrow septal q waves. In LBBB, septum depolarizes right-to-left, eliminating normal septal q.',
    ECG: 'Septal q waves (narrow < 40 ms) in lateral leads are normal. Loss of septal q in lateral leads suggests LBBB. Septal hypertrophy in HCM → dynamic LVOT obstruction, asymmetric septal thickening.',
  },
}

// ── AP waveform arrays ─────────────────────────────────────────────────────
const SA_AP = [
  [0.00,-62],[0.08,-61],[0.16,-60],[0.24,-58],[0.32,-56],
  [0.40,-53],[0.48,-50],[0.56,-47],[0.63,-44],[0.68,-40],
  [0.72,-22],[0.74,-4],[0.76,10],[0.77,16],
  [0.79,13],[0.82,5],[0.86,-12],[0.90,-36],[0.94,-55],[0.97,-61],[1.00,-62],
]
const MYO_AP = [
  [0.00,-90],[0.05,-90],[0.10,-90],[0.15,-90],[0.18,-90],
  [0.182,-88],[0.187,-55],[0.192,5],[0.197,28],[0.202,30],
  [0.207,24],[0.216,12],
  [0.225,9],[0.280,7],[0.340,5],[0.400,3],[0.460,1],[0.475,0],
  [0.490,-8],[0.508,-25],[0.525,-55],[0.542,-80],[0.558,-89],[0.575,-90],
  [0.62,-90],[0.72,-90],[0.82,-90],[0.92,-90],[1.00,-90],
]
const PK_AP = [
  [0.00,-92],[0.05,-92],[0.10,-91],[0.16,-91],[0.18,-90],
  [0.182,-88],[0.185,-48],[0.188,12],[0.192,34],[0.198,38],
  [0.203,30],[0.215,15],
  [0.225,12],[0.280,10],[0.340,8],[0.400,5],[0.460,3],[0.520,1],[0.540,0],
  [0.558,-8],[0.578,-26],[0.605,-60],[0.635,-82],[0.665,-91],[0.690,-92],
  [0.73,-92],[0.80,-92],[0.87,-91],[0.94,-91],[1.00,-92],
]

// ── Phase ion-channel data ─────────────────────────────────────────────────
const SA_PHASES = [
  {
    id: 'p4', label: 'Phase 4 — Pacemaker Potential', tRange: [0, 0.68],
    channels: 'If (HCN channels) + ICa-T',
    ions: 'Na⁺ and K⁺ slowly IN via If ("funny" current); Ca²⁺ via T-type channels → gradual depolarization −62→−40 mV. No stable resting potential. Slope of this ramp sets heart rate. Sympathetic ↑ slope (faster); vagal ↓ slope (slower).',
  },
  {
    id: 'p0', label: 'Upstroke (ICa-L driven)', tRange: [0.68, 0.78],
    channels: 'ICa-L — NO fast INa',
    ions: 'Ca²⁺ in via L-type channels → slow, rounded upstroke to ~+16 mV. Much slower than ventricular upstroke (no INa). This makes SA node conduction inherently slow.',
  },
  {
    id: 'repol', label: 'Repolarization', tRange: [0.78, 1.0],
    channels: 'IK (delayed rectifier) + IK-ACh',
    ions: 'K⁺ exits via delayed rectifiers and acetylcholine-gated channels. Membrane returns to −62 mV to begin next pacemaker cycle. IK-ACh allows vagal nerve to hyperpolarize and slow pacemaking.',
  },
]
const MYO_PHASES = [
  {
    id: 'p4r', label: 'Phase 4 — Resting Potential', tRange: [0, 0.182],
    channels: 'IK1 (inward rectifier)',
    ions: 'K⁺ outward via IK1 → stable resting potential of −90 mV. Stable until external depolarization (from Purkinje fibers or adjacent myocytes).',
  },
  {
    id: 'p0', label: 'Phase 0 — Fast Upstroke', tRange: [0.182, 0.207],
    channels: 'INa (fast voltage-gated Na⁺)',
    ions: 'Na⁺ rushes in through fast channels → −90→+30 mV in ~1–2 ms. Largest and fastest current. Threshold ~−65 mV. Rate of rise (dV/dt max) determines conduction velocity.',
  },
  {
    id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [0.207, 0.225],
    channels: 'Ito (transient outward K⁺)',
    ions: 'K⁺ briefly exits via Ito → creates "notch" between upstroke and plateau. More prominent in epicardium than endocardium → transmural voltage gradient contributes to T wave polarity.',
  },
  {
    id: 'p2', label: 'Phase 2 — Plateau', tRange: [0.225, 0.480],
    channels: 'ICa-L (in) balanced vs IKr + IKs (out)',
    ions: 'Ca²⁺ in BALANCED by K⁺ out → plateau ~0–10 mV for ~200 ms. Ca²⁺ influx triggers Ca²⁺-induced Ca²⁺ release (CICR) from SR → contraction. Plateau prevents re-excitation (refractory period = mechanical protection).',
  },
  {
    id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [0.480, 0.580],
    channels: 'IKr + IKs (rapid + slow delayed rectifiers)',
    ions: 'ICa-L inactivates; IKr/IKs dominate → K⁺ exits rapidly → rapid return to −90 mV. IKr is the hERG channel — target of many drugs causing QT prolongation (torsades risk).',
  },
  {
    id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [0.580, 1.0],
    channels: 'IK1 (inward rectifier)',
    ions: 'IK1 maintains stable −90 mV. No spontaneous depolarization (unlike SA node) — requires external stimulus to fire again.',
  },
]
const PK_PHASES = [
  {
    id: 'p4r', label: 'Phase 4 — Resting / Pacemaker', tRange: [0, 0.182],
    channels: 'IK1 + slow If',
    ions: 'Normally IK1 holds −92 mV. If SA/AV fail, slow If activates → spontaneous depolarization at 20–40 bpm (escape rhythm). Most negative resting potential in heart.',
  },
  {
    id: 'p0', label: 'Phase 0 — Fastest Upstroke', tRange: [0.182, 0.203],
    channels: 'INa (fast) — highest dV/dt in heart',
    ions: 'Na⁺ rushes in → fastest dV/dt of any cardiac cell (~900 V/s). −92→+38 mV. Enables extremely fast conduction (2–4 m/s) to activate ventricles nearly simultaneously.',
  },
  {
    id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [0.203, 0.225],
    channels: 'Ito',
    ions: 'K⁺ briefly exits via transient outward → notch. Similar to myocyte but slightly more pronounced.',
  },
  {
    id: 'p2', label: 'Phase 2 — Longest Plateau', tRange: [0.225, 0.540],
    channels: 'ICa-L vs IKr + IKs',
    ions: 'Longest plateau of any cardiac cell (~300 ms). ICa-L in balanced by K⁺ out. Extended refractory period → protects against rapid ventricular rates. EADs and DADs most common here.',
  },
  {
    id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [0.540, 0.690],
    channels: 'IKr + IKs dominant',
    ions: 'Rapid return to −92 mV as IKr/IKs dominate. Longest AP duration → last to repolarize → determines QT interval in part.',
  },
  {
    id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [0.690, 1.0],
    channels: 'IK1 (± slow If)',
    ions: 'IK1 stabilizes at −92 mV. Latent automaticity: slow If may gradually depolarize if dominant pacemakers fail. Site of DAD-triggered arrhythmias (digitalis toxicity, Ca²⁺ overload).',
  },
]

// ── AP data for 2C (Intracellular vs ECG) ──────────────────────────────────
// Atrial myocyte: fast INa upstroke like MYO_AP, but a much briefer plateau
// and faster repolarization (real atrial APD ≈ 150-200 ms vs ventricular
// ≈ 300 ms) — the key shape difference the spec asks students to notice.
const ATRIAL_AP = [
  [0.00,-80],[0.05,-80],[0.10,-80],[0.15,-80],[0.18,-80],
  [0.182,-78],[0.187,-45],[0.192,10],[0.197,22],[0.202,20],
  [0.207,14],[0.216,6],
  [0.225,2],[0.26,-2],[0.30,-12],[0.34,-32],[0.38,-58],[0.42,-76],[0.45,-80],
  [0.50,-80],[0.60,-80],[0.75,-80],[0.90,-80],[1.00,-80],
]
const ATRIAL_PHASES = [
  { id: 'p4r', label: 'Phase 4 — Resting Potential', tRange: [0, 0.182],
    channels: 'IK1', ions: 'Stable resting potential ≈ −80 mV — slightly less negative than ventricular myocardium.' },
  { id: 'p0', label: 'Phase 0 — Fast Upstroke', tRange: [0.182, 0.207],
    channels: 'INa (fast voltage-gated Na⁺)', ions: 'Fast Na⁺-driven upstroke, same mechanism as ventricle, smaller amplitude.' },
  { id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [0.207, 0.225],
    channels: 'Ito', ions: 'Brief transient outward K⁺ notch.' },
  { id: 'p2', label: 'Phase 2 — Brief Plateau', tRange: [0.225, 0.34],
    channels: 'ICa-L vs IKr + IKs', ions: 'Much shorter plateau than ventricular myocardium → shorter refractory period → atria can be driven at much faster rates (flutter, fibrillation).' },
  { id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [0.34, 0.45],
    channels: 'IKr + IKs', ions: 'Rapid return to resting potential.' },
  { id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [0.45, 1.0],
    channels: 'IK1', ions: 'Stable at rest until the next wavefront arrives.' },
]

// Where each region's own upstroke lands on the SHARED real-time axis this
// beat uses (t=0 → P wave onset). QRS_ONSET_MS ties the ventricle/Purkinje
// anchors to the same PR interval the module's fixed default rhythm uses,
// so "R-wave peak lands in the ventricular plateau" is true by construction,
// not by coincidence — see ECGVsAPSection's "Zoom to QRS" feature below.
const QRS_ONSET_MS = DEFAULT_RHYTHM_PARAMS.prInterval

// The repaired tissue renderer uses the ECG timeline without a cosmetic delay.
const VENTRICULAR_ANIM_DELAY_MS = 0

const AP_REGIONS = [
  { key: 'sa', label: 'SA Node', data: SA_AP, phases: SA_PHASES, anchorFraction: 0.68, targetMs: 0,
    desc: 'Slow spontaneous pacemaker potential (If + ICa-L). Threshold ≈ −40 mV. No fast upstroke — this cell drives its own rate.' },
  { key: 'atrium', label: 'Atrium', data: ATRIAL_AP, phases: ATRIAL_PHASES, anchorFraction: 0.182, targetMs: 10,
    desc: 'Fast upstroke (INa), brief plateau, rapid repolarization.' },
  { key: 'av', label: 'AV Node', data: SA_AP, phases: SA_PHASES, anchorFraction: 0.68, targetMs: Math.round(QRS_ONSET_MS * 0.72),
    desc: 'Slow-response cell like the SA node — ICa-L upstroke, no fast INa — but fires mid-way through the PR segment, imposing the AV delay.' },
  { key: 'ventricle', label: 'Ventricle', data: MYO_AP, phases: MYO_PHASES, anchorFraction: 0.182, targetMs: QRS_ONSET_MS + VENTRICULAR_ANIM_DELAY_MS,
    desc: 'Fast upstroke (Phase 0), long plateau (Phase 2, ICa-L), Phases 0–4 labeled below.' },
  { key: 'purkinje', label: 'Purkinje', data: PK_AP, phases: PK_PHASES, anchorFraction: 0.182, targetMs: QRS_ONSET_MS + VENTRICULAR_ANIM_DELAY_MS - 15,
    desc: 'Fastest upstroke and longest plateau of any cardiac cell — fires just ahead of ventricular myocardium.' },
]

// Piecewise-linear lookup into an AP data array at a cyclic fraction (data
// arrays already close the loop: value at fraction 1.00 matches fraction 0.00).
function interpAP(data, fraction) {
  const f = ((fraction % 1) + 1) % 1
  for (let i = 0; i < data.length - 1; i++) {
    const [t0, v0] = data[i]
    const [t1, v1] = data[i + 1]
    if (f >= t0 && f <= t1) {
      const frac = t1 === t0 ? 0 : (f - t0) / (t1 - t0)
      return v0 + (v1 - v0) * frac
    }
  }
  return data[data.length - 1][1]
}

// Converts a region's fraction-domain phase table into real-ms shaded bands
// for TraceCanvas, using the same anchor/target mapping apValueAt() uses.
function phasesToMarkers(phases, anchorFraction, targetMs, cycleMs) {
  const toMs = (f) => targetMs + (f - anchorFraction) * cycleMs
  return phases.map(ph => {
    const [f0, f1] = ph.tRange
    const col = AP_PHASE_COLORS[ph.id] || [100, 100, 100, 25]
    return { x0: toMs(f0), x1: toMs(f1), color: `rgba(${col[0]},${col[1]},${col[2]},${(col[3] / 255).toFixed(2)})` }
  })
}

// ── Structure lookup tables (for 2C) ──────────────────────────────────────
const STRUCT_NAMES = {
  sa: 'SA Node', ra: 'Right Atrium', la: 'Left Atrium',
  bachmann: "Bachmann's Bundle", av: 'AV Node',
  his: 'Bundle of His', rbundle: 'Right Bundle Branch', lbundle: 'Left Bundle Branch',
  rv: 'Right Ventricle', lv: 'Left Ventricle', apex: 'Apex / Purkinje Fan',
  repolLV: 'LV Repolarization', repolRV: 'RV Repolarization',
}
const STRUCT_CV = {
  sa: '—', bachmann: '1.0 m/s', ra: '1.0 m/s', la: '1.0 m/s',
  av: '0.05 m/s', his: '1.0 m/s', rbundle: '2–4 m/s', lbundle: '2–4 m/s',
  rv: '0.3–0.5 m/s', lv: '0.3–0.5 m/s', apex: '0.3–0.5 m/s',
  repolLV: '—', repolRV: '—',
}
const STRUCT_NOTE = {
  sa: 'SA node fires spontaneously via If (HCN channels). Rate governed by slope of Phase 4 pacemaker potential. Not visible on surface ECG directly.',
  ra: 'Atrial myocardium conducting at ~1 m/s. Right atrium activates first → initial P wave.',
  la: "Left atrium activates via Bachmann's bundle. Terminal P wave. Enlargement → P mitrale.",
  bachmann: "Interatrial conduction pathway connecting RA to LA at ~1 m/s. Failure → ectopic atrial rhythms.",
  av: 'AV node delay (0.05 m/s) = PR segment on ECG. Critical for ventricular filling before systole.',
  his: 'Bundle of His conducts at ~1 m/s — transitional speed before Purkinje acceleration.',
  rbundle: 'Rapid Purkinje conduction to RV endocardium (2–4 m/s). Block → RBBB pattern.',
  lbundle: 'Rapid Purkinje conduction to LV endocardium and septum (2–4 m/s). Block → LBBB pattern.',
  rv: 'RV myocardium activates endocardium → epicardium at 0.3–0.5 m/s. Thin wall, lower contribution to QRS.',
  lv: 'LV myocardium dominates QRS. Thick wall activation endocardium → epicardium. Lateral + inferior forces.',
  apex: 'Purkinje fan delivers nearly simultaneous endocardial activation across ventricular apex.',
  repolLV: 'Ventricular repolarization (T wave). Travels epicardium → endocardium (opposite to depolarization) → same T wave polarity as QRS in most leads.',
  repolRV: 'RV repolarization contributes to early T wave. Smaller contribution than LV.',
}

// ── Layout helpers ─────────────────────────────────────────────────────────
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
function Section({ label, title, subtitle, children }) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-xs font-mono text-cyan-500 uppercase tracking-widest">{label}</span>
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-gray-400 mb-1.5 leading-snug">{subtitle}</p>}
      {children}
    </div>
  )
}
function Callout({ children }) {
  return (
    <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-800/30 text-xs text-cyan-300 leading-snug">
      {children}
    </div>
  )
}
function InfoRow({ label, value }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed mb-1.5">
      <span className="text-gray-500 shrink-0 w-28">{label}</span>
      <span className="text-gray-200">{value}</span>
    </div>
  )
}

// ── 2A: Heart Anatomy Overview ─────────────────────────────────────────────
function AnatomyDiagram({ selected, onSelect }) {
  const [hovered, setHovered] = useState(null)
  const active = hovered || selected

  const ev = (key) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered(null),
    onClick: () => onSelect(prev => prev === key ? null : key),
    style: { cursor: 'pointer' },
  })

  const fill = (key, base, highlight) => {
    if (active === key) return highlight
    return base
  }

  const info = active ? ANATOMY[active] : null

  return (
    <div className="flex gap-4 items-start">
      {/* SVG Heart */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 shrink-0">
        <svg viewBox="0 0 200 262" width="210" height="262" className="block">
          {/* ── Non-interactive structure labels ── */}
          <text x="100" y="8" textAnchor="middle" fill="#6b7280" fontSize="5">Patient's Right ← → Patient's Left</text>

          {/* Bachmann's bundle (non-interactive, dashed) */}
          <path d="M 76 22 Q 100 20 124 28" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="2,2" />
          <text x="100" y="18" textAnchor="middle" fill="#6b7280" fontSize="4.5">Bachmann's bundle</text>

          {/* ── Right Atrium (viewer left = patient right) ── */}
          <path
            d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
            fill={fill('ra', '#1e3a2e', '#166534')}
            stroke={active === 'ra' ? '#4ade80' : '#374151'}
            strokeWidth="1.5"
            {...ev('ra')}
          />
          <text x="76" y="60" textAnchor="middle" fill="#d1fae5" fontSize="6" pointerEvents="none">RA</text>

          {/* ── Left Atrium (viewer right = patient left) ── */}
          <path
            d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
            fill={fill('la', '#1e3a2e', '#166534')}
            stroke={active === 'la' ? '#4ade80' : '#374151'}
            strokeWidth="1.5"
            {...ev('la')}
          />
          <text x="120" y="60" textAnchor="middle" fill="#d1fae5" fontSize="6" pointerEvents="none">LA</text>

          {/* ── SA Node (viewer left, patient right) ── */}
          <circle
            cx="70" cy="18" r="7"
            fill={fill('sa', '#1e2a4e', '#1d4ed8')}
            stroke={active === 'sa' ? '#60a5fa' : '#374151'}
            strokeWidth="1.5"
            {...ev('sa')}
          />
          <text x="70" y="20" textAnchor="middle" fill="#bfdbfe" fontSize="5" pointerEvents="none">SA</text>

          {/* ── AV Node ── */}
          <circle
            cx="100" cy="97" r="7"
            fill={fill('av', '#2d1a4e', '#6d28d9')}
            stroke={active === 'av' ? '#a78bfa' : '#374151'}
            strokeWidth="1.5"
            {...ev('av')}
          />
          <text x="100" y="99" textAnchor="middle" fill="#ede9fe" fontSize="5" pointerEvents="none">AV</text>

          {/* ── Bundle of His ── */}
          <line x1="100" y1="104" x2="100" y2="117"
            stroke={active === 'his' ? '#c084fc' : '#6b7280'} strokeWidth="2.5"
            {...ev('his')} style={{ cursor: 'pointer' }}
          />
          <rect x="88" y="104" width="24" height="13" fill="transparent" {...ev('his')} />
          <text x="113" y="113" fill="#9ca3af" fontSize="4.5" pointerEvents="none">His</text>

          {/* ── Right Bundle Branch (viewer left) ── */}
          <path
            d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
            fill="none"
            stroke={fill('rbundle', '#4b5563', '#db2777')}
            strokeWidth="2"
            {...ev('rbundle')} style={{ cursor: 'pointer' }}
          />
          <text x="58" y="138" fill="#9ca3af" fontSize="4.5" pointerEvents="none">RBB</text>

          {/* ── Left Bundle Branch (viewer right) ── */}
          <path
            d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
            fill="none"
            stroke={fill('lbundle', '#4b5563', '#db2777')}
            strokeWidth="2"
            {...ev('lbundle')} style={{ cursor: 'pointer' }}
          />
          <text x="136" y="138" fill="#9ca3af" fontSize="4.5" pointerEvents="none">LBB</text>

          {/* ── Purkinje fan hints (apex region) ── */}
          <path d="M 62 170 Q 70 195 85 210 Q 95 222 100 228"
            fill="none" stroke="#4b5563" strokeWidth="1" strokeDasharray="1.5,1.5"
            {...ev('purkinje')} style={{ cursor: 'pointer' }}
          />
          <path d="M 138 170 Q 130 195 115 210 Q 105 222 100 228"
            fill="none" stroke="#4b5563" strokeWidth="1" strokeDasharray="1.5,1.5"
            {...ev('purkinje')} style={{ cursor: 'pointer' }}
          />
          <text x="100" y="240" textAnchor="middle" fill="#6b7280" fontSize="4.5" pointerEvents="none">Purkinje</text>

          {/* ── Right Ventricle (viewer left) ── */}
          <path
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228 Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={fill('rv', '#1f2937', '#7c2d12')}
            stroke={active === 'rv' ? '#fb923c' : '#374151'}
            strokeWidth="1.5"
            {...ev('rv')}
          />
          <text x="64" y="168" textAnchor="middle" fill="#fed7aa" fontSize="6" pointerEvents="none">RV</text>

          {/* ── Left Ventricle (viewer right) ── */}
          <path
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228 Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={fill('lv', '#1f2937', '#7c2d12')}
            stroke={active === 'lv' ? '#fb923c' : '#374151'}
            strokeWidth="1.5"
            {...ev('lv')}
          />
          <text x="136" y="168" textAnchor="middle" fill="#fed7aa" fontSize="6" pointerEvents="none">LV</text>

          {/* ── Interventricular Septum ── */}
          <path
            d="M 88 125 Q 92 148 95 175 Q 97 200 100 228 Q 103 200 105 175 Q 108 148 112 125 Q 105 110 100 107 Q 95 110 88 125 Z"
            fill={fill('septum', '#111827', '#1e3a5f')}
            stroke={active === 'septum' ? '#38bdf8' : '#374151'}
            strokeWidth="1"
            {...ev('septum')}
          />
          <text x="100" y="165" textAnchor="middle" fill="#7dd3fc" fontSize="4" pointerEvents="none">IVS</text>
        </svg>
      </div>

      {/* Info panel */}
      <div className="flex-1 min-h-[262px] flex flex-col justify-start">
        {info ? (
          <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 h-full">
            <h3 className="text-sm font-semibold text-white mb-3">{info.name}</h3>
            <InfoRow label="Primary function" value={info.fn} />
            <InfoRow label="Electrical role" value={info.electrical} />
            <InfoRow label="ECG correlation" value={info.ECG} />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 h-full flex flex-col justify-center text-center">
            <p className="text-gray-500 text-sm">Hover or click a structure</p>
            <p className="text-gray-600 text-xs mt-2">SA Node · RA · LA · AV Node · Bundle of His · Bundle Branches · Purkinje · RV · LV · Septum</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 2B: Action Potentials by Cell Type ────────────────────────────────────
const AP_VMIN = -100, AP_VMAX = 45

// Stable array references for TraceCanvas's yDomain prop — ECGVsAPSection
// re-renders every animation frame (its clock's tMs state ticks ~60/s), so
// an inline array literal here would give TraceCanvas a new reference each
// frame and force its draw-loop effect to tear down and restart constantly,
// which is what caused the visible flashing.
const AP_Y_DOMAIN = [AP_VMIN, AP_VMAX]
const ECG_Y_DOMAIN = [0, 1.5]
const AP_PHASE_COLORS = {
  p4:    [59,  130, 246, 40],
  p0:    [239, 68,  68,  50],
  p1:    [234, 179, 8,   45],
  p2:    [16,  185, 129, 40],
  p3:    [168, 85,  247, 40],
  p4r:   [59,  130, 246, 40],
  p4d:   [59,  130, 246, 40],
  repol: [168, 85,  247, 40],
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function smooth01(t) { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c) }

// ── Physiology model ────────────────────────────────────────────────────
// Deliberately simple, monotonic formulas anchored to the exact before/after
// numbers called out in the teaching spec (e.g. SA max diastolic potential
// −60→−55 mV at 100% sympathetic tone) rather than a full ionic model — this
// drives a teaching visualization, not a research simulation.
const BASE_SA_RATE = 75 // bpm, at the 20%/20% ANS default

// Sympathetic tone → β2-adrenergic stimulation of the Na⁺/K⁺-ATPase → K⁺
// shifts INTO cells → extracellular [K⁺] drops. This is the same mechanism
// (and roughly the same clinical magnitude, ~1 mEq/L at high catecholamine
// levels) behind using nebulized albuterol or IV epinephrine to treat
// hyperkalemia. Parasympathetic tone has no comparably established acute
// effect on extracellular [K⁺] or [Ca²⁺], so neither ion is linked to it.
// The K⁺ slider always stays exactly where the student sets it — this only
// computes the EFFECTIVE value the AP model (and the UI's color bar/alerts)
// actually uses, so sympathetic tone visibly "borrows against" whatever
// baseline the student dialed in rather than moving the slider itself.
const SYMPATHETIC_K_SHIFT_MEQL = 1.0

function computeAPPhysiology({ sympathetic, parasympathetic, kMEqL, caMgDl }) {
  const symp = sympathetic / 100
  const para = parasympathetic / 100
  const effectiveKMEqL = clamp(kMEqL - SYMPATHETIC_K_SHIFT_MEQL * symp, 1.5, 9.0)
  const kDev  = effectiveKMEqL - 4.0 // deviation from normal extracellular K+
  const caDev = caMgDl - 9.5         // deviation from normal extracellular Ca2+

  // ── Shared cycle length — the SA node's own rate paces every panel ──
  let saRate = BASE_SA_RATE * (1 + 0.9 * symp - 0.75 * para)
  if (effectiveKMEqL < 3.5) saRate *= 1 + 0.08 * (3.5 - effectiveKMEqL) // paradoxical low-K+ automaticity increase
  saRate = clamp(saRate, 25, 220)
  const cycleMs = 60000 / saRate

  // ── SA node shape ──
  const sa = {
    mdp: clamp(-60 + 5 * symp - 10 * para, -78, -50),
    phase4Frac: clamp(0.68 - 0.24 * symp + 0.14 * para, 0.34, 0.86),
    threshold: -40,
  }

  // ── AV node shape — same slow-response family as SA (ICa-L upstroke, no
  // fast INa), but under normal SA-driven rhythm it's a triggered relay, not
  // a real pacemaker: its own automaticity is latent, only surfacing as a
  // junctional escape rhythm if higher pacemakers fail. A much larger,
  // mostly-fixed phase4Frac gives it a visibly flatter/slower drift than SA
  // (weak latent automaticity) rather than tying its slope to ANS tone the
  // same direct way SA's is.
  const av = {
    mdp: clamp(-65 + 2 * symp - 4 * para, -75, -58),
    phase4Frac: 0.85,
    threshold: -40,
  }

  // ── Ventricular / Purkinje shared K+ / Ca2+ / sympathetic effects ──
  const restingMv = kDev >= 0
    ? clamp(-90 + 7 * kDev, -90, -45)
    : clamp(-90 + 3 * kDev, -100, -90)
  const upstrokePeak = clamp(30 - 3 * Math.max(0, kDev), 5, 30)
  const upstrokeSlowFactor = 1 + 0.7 * Math.max(0, kDev) / 5
  const plateauScale = clamp(1 - 0.021 * caDev, 0.42, 1.9) * (1 - 0.15 * symp)
  const repolSlowFactor = effectiveKMEqL < 3.5 ? 1 + 0.6 * (3.5 - effectiveKMEqL) : 1
  const uWaveMv = effectiveKMEqL < 3.5 ? clamp((3.5 - effectiveKMEqL) * 4, 0, 15) : 0
  const cellShared = { restingMv, upstrokePeak, upstrokeSlowFactor, plateauScale, repolSlowFactor, uWaveMv }

  // ── AV conduction delay indicator (parasympathetic lengthens, no trace) ──
  const avDelayMs = Math.round(clamp(140 * (1 + 0.9 * para - 0.25 * symp), 80, 500))

  return {
    symp, para, kMEqL, effectiveKMEqL, caMgDl, cycleMs, saRate, avDelayMs,
    sa,
    av,
    atrium: cellShared,
    ventricle: cellShared,
    purkinje: cellShared,
    bothElevated: symp >= 0.5 && para >= 0.5,
  }
}

// ── Parametric AP shape generators — sampled fresh whenever physiology
// changes, reusing interpAP()'s fraction-space lookup convention so these
// plug straight into TraceCanvas the same way the static 2C arrays do. ──
//
// Shared shape for both slow-response cell types (SA and AV — ICa-L
// upstroke, no fast INa). SA fires FIRST in the shared cycle (fireAtFrac=0,
// the default); AV fires later, once triggered by the arriving atrial
// impulse (fireAtFrac ≈ where the AV delay places it, between atrium and
// ventricle). Rather than shifting every OTHER panel to make room, this
// wave is rotated so its own upstroke (which naturally sits at fraction
// phase4Frac in its own [0,1] window) lands at the given fireAtFrac in the
// shared timeline, with the long Phase 4 pacemaker ramp occupying
// whatever's left — wrapping around the array boundary (split into two
// pieces below) whenever fireAtFrac > 0.
function splitWindow(lo, hi) {
  const loM = ((lo % 1) + 1) % 1
  const hiM = loM + (hi - lo)
  return hiM <= 1 ? [[loM, hiM]] : [[loM, 1], [0, hiM - 1]]
}
function buildSlowResponseWave({ mdp, phase4Frac, threshold }, { n = 60, fireAtFrac = 0 } = {}) {
  const peak = 15
  const upDur = clamp(0.10, 0.04, 0.94 - phase4Frac) // upstroke+repol duration, unrotated
  const p0End = phase4Frac + upDur
  // Rotated-space breakpoints (before the fireAtFrac shift): upstroke
  // [0, upEndR], repol [upEndR, repolEndR], phase4 [repolEndR, 1].
  const upEndR    = p0End - phase4Frac
  const repolEndR = 1 - phase4Frac

  const data = []
  for (let i = 0; i <= n; i++) {
    const tR = i / n                                              // shared-timeline fraction
    const t  = ((tR - fireAtFrac + phase4Frac) % 1 + 1) % 1        // original fraction, for the same formulas as before
    let v
    if (t <= phase4Frac) {
      const f = phase4Frac === 0 ? 1 : t / phase4Frac
      // Blended linear+quadratic ramp (not a pure power curve): a pure f^1.6
      // has ZERO slope at f=0, which drew the pacemaker potential as briefly
      // flat right after repolarization — misleadingly suggesting the
      // membrane "holds" at its most negative point for a moment before If
      // kicks in. If activates on hyperpolarization, so the drift back
      // toward threshold should start immediately. This still accelerates
      // toward the end (ICa-T joining in near threshold), just without the
      // false-flat start.
      v = mdp + (threshold - mdp) * (0.4 * f + 0.6 * f * f)
    } else if (t <= p0End) {
      v = threshold + (peak - threshold) * smooth01((t - phase4Frac) / (p0End - phase4Frac))
    } else {
      v = peak + (mdp - peak) * smooth01((t - p0End) / (1 - p0End))
    }
    data.push([tR, Math.round(v * 10) / 10])
  }

  const phaseDefs = [
    { id: 'p0', label: 'Upstroke — ICa-L driven', bounds: [0, upEndR],
      channels: 'ICa-L — NO fast INa', short: 'ICa-L opens. No fast INa — explains slow conduction velocity (~0.05 m/s)',
      ions: 'Ca²⁺ in via L-type channels → slow, rounded upstroke. Much slower than a fast-response upstroke since there is no INa here.' },
    { id: 'repol', label: 'Repolarization', bounds: [upEndR, repolEndR],
      channels: 'IK (delayed rectifier) + IK-ACh', short: 'Repolarization — IK + IK-ACh',
      ions: 'K⁺ exits via delayed rectifiers and ACh-gated channels, returning toward the pacemaker potential.' },
    { id: 'p4', label: 'Phase 4 — Pacemaker Potential', bounds: [repolEndR, 1],
      channels: 'If (HCN channels) + ICa-T', short: 'Phase 4 — pacemaker potential (If — the pacemaker current) building toward the next beat',
      ions: 'Na⁺/K⁺ slowly IN via If ("funny current"); Ca²⁺ via T-type channels → gradual depolarization toward threshold. Slope of this ramp sets rate.' },
  ]
  // Shift each phase's window into the shared timeline, splitting it into
  // two entries (same id) if the shift makes it wrap past t=1 back to t=0 —
  // the phase lookups elsewhere (IonChannelRow, PhaseLabel) just take
  // whichever entry's range contains the current fraction, so duplicate ids
  // work fine without any other changes.
  const phases = phaseDefs.flatMap(({ bounds: [lo, hi], ...rest }) =>
    splitWindow(lo + fireAtFrac, hi + fireAtFrac).map(tRange => ({ ...rest, tRange }))
  )
  return { data, phases }
}

// kind: 'ventricle' | 'purkinje' | 'atrium'. p0Start is deliberately earlier
// for the atrium than for ventricle/Purkinje — real conduction reaches the
// atrial myocardium almost immediately after SA firing, while ventricle/
// Purkinje only fire after the AV delay, later in the shared cycle. That
// ordering (SA → atrium → [AV delay] → ventricle/Purkinje) is what makes
// "SA fires first" actually legible across all four panels at once.
function buildWorkingCellWave({ restingMv, upstrokePeak, upstrokeSlowFactor, plateauScale, repolSlowFactor, uWaveMv }, kind, n = 100) {
  const isPurkinje = kind === 'purkinje'
  const isAtrium   = kind === 'atrium'
  const cellRestingMv = isAtrium ? clamp(restingMv + 10, -100, -45) : restingMv // atrium's baseline is less negative (~ -80 vs -90)
  const notchMv = cellRestingMv + (upstrokePeak - cellRestingMv) * 0.55
  const plateauMv = isPurkinje ? 4 : isAtrium ? 0 : 2
  const p0Start = isAtrium ? 0.05 : 0.182
  const p0End = p0Start + (isPurkinje ? 0.021 : isAtrium ? 0.020 : 0.025) * upstrokeSlowFactor
  const p1End = p0End + 0.020
  const basePlateauDur = isPurkinje ? 0.315 : isAtrium ? 0.13 : 0.255
  const p2End = p1End + basePlateauDur * plateauScale
  const p3Dur = (isPurkinje ? 0.15 : isAtrium ? 0.09 : 0.10) * repolSlowFactor
  const p3End = clamp(p2End + p3Dur, p2End + 0.02, 0.985)

  const data = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    let v
    if (t < p0Start) {
      v = cellRestingMv
    } else if (t < p0End) {
      v = cellRestingMv + (upstrokePeak - cellRestingMv) * smooth01((t - p0Start) / (p0End - p0Start))
    } else if (t < p1End) {
      v = upstrokePeak + (notchMv - upstrokePeak) * smooth01((t - p0End) / (p1End - p0End))
    } else if (t < p2End) {
      v = notchMv + (plateauMv - notchMv) * smooth01(Math.min(1, ((t - p1End) / (p2End - p1End)) * 3))
    } else if (t < p3End) {
      v = plateauMv + (cellRestingMv - plateauMv) * smooth01((t - p2End) / (p3End - p2End))
    } else {
      v = cellRestingMv
      if (isPurkinje) v += 4 * smooth01((t - p3End) / (1 - p3End)) // slight Phase 4 automaticity (slow If)
      if (uWaveMv > 0) {
        const uCenter = p3End + (1 - p3End) * 0.35
        const uWidth  = Math.max(0.01, (1 - p3End) * 0.28)
        const d = (t - uCenter) / uWidth
        v += uWaveMv * Math.exp(-d * d * 4)
      }
    }
    data.push([t, Math.round(v * 10) / 10])
  }

  const label0 = isPurkinje ? 'Phase 0 — Fastest Upstroke' : 'Phase 0 — Fast Upstroke'
  const phases = [
    { id: 'p4r', label: 'Phase 4 — Resting Potential', tRange: [0, p0Start],
      channels: isPurkinje ? 'IK1 + slow If' : 'IK1 (inward rectifier)',
      short: isAtrium ? 'Phase 4 — resting potential (IK1). Fires almost immediately after SA.' : 'Phase 4 — resting potential (IK1)',
      ions: 'K⁺ outward via IK1 holds a stable resting potential until an external stimulus arrives.' },
    { id: 'p0', label: label0, tRange: [p0Start, p0End],
      channels: isPurkinje ? 'INa (fast) — highest dV/dt in heart' : 'INa (fast voltage-gated Na⁺)',
      short: 'Phase 0 — Rapid depolarization (INa opens)',
      ions: 'Na⁺ rushes in through fast channels → rapid upstroke. IK1 closes as INa snaps open.' },
    { id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [p0End, p1End],
      channels: 'Ito (transient outward K⁺)', short: 'Phase 1 — transient notch (Ito)',
      ions: 'K⁺ briefly exits via Ito, creating the notch between the upstroke and the plateau.' },
    { id: 'p2', label: isAtrium ? 'Phase 2 — Brief Plateau' : 'Phase 2 — Plateau', tRange: [p1End, p2End],
      channels: 'ICa-L (in) balanced vs IKr + IKs (out)', short: 'Phase 2 — plateau (ICa-L opens, IKr begins activating)',
      ions: isAtrium
        ? 'Ca²⁺ in via ICa-L balanced by K⁺ out — much briefer than the ventricular plateau, giving atrial cells a shorter refractory period.'
        : 'Ca²⁺ in via ICa-L is balanced by K⁺ starting to exit via IKr/IKs, holding the plateau near 0 mV.' },
    { id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [p2End, p3End],
      channels: 'IKr + IKs (rapid + slow delayed rectifiers)', short: 'Phase 3 — ICa-L closes, IKr/IKs drive repolarization',
      ions: 'ICa-L inactivates; IKr and IKs dominate → rapid return toward resting potential.' },
    { id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [p3End, 1],
      channels: isPurkinje ? 'IK1 (± slow If)' : 'IK1 (inward rectifier)',
      short: 'Phase 4 — IK1 maintains resting potential',
      ions: isPurkinje
        ? 'IK1 stabilizes the resting potential; a slow If gives Purkinje fibers slight backup automaticity if SA/AV both fail.'
        : 'IK1 maintains a stable resting potential — no spontaneous depolarization, unlike the SA node.' },
  ]
  return { data, phases }
}

const PHASE_NUMBER = { p4r: '4', p0: '0', p1: '1', p2: '2', p3: '3', p4d: '4' }

// ── Ion channel gating tables — per-phase openness (0–1), looked up by the
// CURRENT phase id each frame. No hover required: IonChannelRow below reads
// the shared clock directly and updates automatically as the cursor moves. ──
const SA_ION_CHANNELS = [
  { id: 'If',   label: 'If',       note: 'If — the pacemaker current', levels: { p4: 1,    p0: 0.15, repol: 0.10 } },
  { id: 'ICaT', label: 'ICa-T',    note: 'T-type Ca²⁺ — activates near threshold', levels: { p4: 0.65, p0: 0.20, repol: 0 } },
  { id: 'ICaL', label: 'ICa-L',    note: 'L-type Ca²⁺ — drives the SA upstroke (NOT INa)', levels: { p4: 0.05, p0: 1,    repol: 0.10 } },
  { id: 'IK',   label: 'IK/IKAch', note: 'Delayed rectifier + ACh-gated K⁺', levels: { p4: 0.10, p0: 0,    repol: 1 } },
]
// Same channel set as SA — the AV node is the same slow-response cell
// type — but If/ICa-T sit at lower levels: under normal SA-driven rhythm
// this automaticity is latent (weak), only becoming the dominant pacemaker
// if it ever gets the chance to reach threshold on its own (junctional
// escape).
const AV_ION_CHANNELS = [
  { id: 'If',   label: 'If (latent)', note: 'Weak, latent pacemaker current — normally overridden by the arriving SA impulse', levels: { p4: 0.4,  p0: 0.10, repol: 0.05 } },
  { id: 'ICaT', label: 'ICa-T',    note: 'T-type Ca²⁺ — activates near threshold', levels: { p4: 0.35, p0: 0.15, repol: 0 } },
  { id: 'ICaL', label: 'ICa-L',    note: 'L-type Ca²⁺ — drives the AV upstroke (NOT INa)', levels: { p4: 0.05, p0: 1,    repol: 0.10 } },
  { id: 'IK',   label: 'IK/IKAch', note: 'Delayed rectifier + ACh-gated K⁺ — vagal tone lengthens the AV delay', levels: { p4: 0.10, p0: 0,    repol: 1 } },
]
const MYO_ION_CHANNELS = [
  { id: 'INa',  label: 'INa',  note: 'Fast Na⁺ — snaps open at Phase 0', levels: { p4r: 0,    p0: 1,    p1: 0.05, p2: 0,    p3: 0,    p4d: 0 } },
  { id: 'IK1',  label: 'IK1',  note: 'Inward rectifier — holds resting potential, closes on upstroke', levels: { p4r: 1, p0: 0.05, p1: 0.10, p2: 0.10, p3: 0.20, p4d: 1 } },
  { id: 'Ito',  label: 'Ito',  note: 'Transient outward — brief Phase 1 notch', levels: { p4r: 0, p0: 0.10, p1: 1,    p2: 0.15, p3: 0,    p4d: 0 } },
  { id: 'ICaL', label: 'ICa-L', note: 'L-type Ca²⁺ — the plateau current', levels: { p4r: 0,   p0: 0.20, p1: 0.40, p2: 1,    p3: 0.25, p4d: 0 } },
  { id: 'IKr',  label: 'IKr',  note: 'Rapid delayed rectifier — begins in Phase 2, dominant in Phase 3', levels: { p4r: 0, p0: 0,    p1: 0.10, p2: 0.45, p3: 1,    p4d: 0.10 } },
  { id: 'IKs',  label: 'IKs',  note: 'Slow delayed rectifier — joins IKr for repolarization', levels: { p4r: 0, p0: 0,    p1: 0.05, p2: 0.35, p3: 0.90, p4d: 0.10 } },
]
const PK_ION_CHANNELS = [
  { id: 'INa',  label: 'INa',  note: 'Fastest Na⁺ upstroke in the heart (highest dV/dt)', levels: { p4r: 0,   p0: 1,    p1: 0.05, p2: 0,    p3: 0,    p4d: 0 } },
  { id: 'IK1',  label: 'IK1',  note: 'Inward rectifier — dominant at rest', levels: { p4r: 1, p0: 0.05, p1: 0.10, p2: 0.10, p3: 0.20, p4d: 0.80 } },
  { id: 'Ito',  label: 'Ito',  note: 'Transient outward — brief Phase 1 notch', levels: { p4r: 0, p0: 0.10, p1: 1,    p2: 0.15, p3: 0,    p4d: 0 } },
  { id: 'ICaL', label: 'ICa-L', note: 'L-type Ca²⁺ — the longest plateau of any cardiac cell', levels: { p4r: 0, p0: 0.20, p1: 0.40, p2: 1,  p3: 0.25, p4d: 0 } },
  { id: 'IKr',  label: 'IKr',  note: 'Rapid delayed rectifier', levels: { p4r: 0, p0: 0, p1: 0.10, p2: 0.45, p3: 1,    p4d: 0.10 } },
  { id: 'IKs',  label: 'IKs',  note: 'Slow delayed rectifier', levels: { p4r: 0, p0: 0, p1: 0.05, p2: 0.35, p3: 0.90, p4d: 0.10 } },
  { id: 'If',   label: 'If (slow)', note: 'Slight automaticity — backup pacemaker if SA/AV both fail', levels: { p4r: 0.05, p0: 0, p1: 0, p2: 0, p3: 0, p4d: 0.35 } },
]
const ATRIAL_ION_CHANNELS = [
  { id: 'INa',  label: 'INa',  note: 'Fast Na⁺ — snaps open at Phase 0', levels: { p4r: 0,    p0: 1,    p1: 0.05, p2: 0,    p3: 0,    p4d: 0 } },
  { id: 'IK1',  label: 'IK1',  note: 'Inward rectifier — holds resting potential, closes on upstroke', levels: { p4r: 1, p0: 0.05, p1: 0.10, p2: 0.10, p3: 0.20, p4d: 1 } },
  { id: 'Ito',  label: 'Ito',  note: 'Transient outward — brief Phase 1 notch', levels: { p4r: 0, p0: 0.10, p1: 1,    p2: 0.15, p3: 0,    p4d: 0 } },
  { id: 'ICaL', label: 'ICa-L', note: 'L-type Ca²⁺ — a much briefer plateau than ventricle', levels: { p4r: 0,  p0: 0.20, p1: 0.40, p2: 1,    p3: 0.25, p4d: 0 } },
  { id: 'IKr',  label: 'IKr',  note: 'Rapid delayed rectifier — begins in Phase 2, dominant in Phase 3', levels: { p4r: 0, p0: 0,    p1: 0.10, p2: 0.45, p3: 1,    p4d: 0.10 } },
  { id: 'IKs',  label: 'IKs',  note: 'Slow delayed rectifier — joins IKr for repolarization', levels: { p4r: 0, p0: 0,    p1: 0.05, p2: 0.35, p3: 0.90, p4d: 0.10 } },
]

// Always-visible glossary of every channel abbreviation used across the four
// panels — the badges themselves stay compact (INa, IKr, …) so the row can't
// grow past this small strip, but nobody should have to hover to learn what
// an abbreviation stands for.
const ION_CHANNEL_GLOSSARY = [
  { id: 'If',    name: 'Funny current',              detail: 'HCN channels — the SA node’s pacemaker current' },
  { id: 'ICa-T', name: 'T-type calcium current',      detail: 'activates near threshold, helps trigger SA upstroke' },
  { id: 'ICa-L', name: 'L-type calcium current',      detail: 'SA node upstroke; the plateau current everywhere else' },
  { id: 'IK / IK-ACh', name: 'Delayed rectifier / ACh-gated K⁺', detail: 'repolarizes the SA node; ACh (vagal) opens IK-ACh' },
  { id: 'INa',   name: 'Fast sodium current',         detail: 'the rapid Phase 0 upstroke in atrium, ventricle, Purkinje' },
  { id: 'IK1',   name: 'Inward rectifier K⁺',         detail: 'holds the resting potential; closes during the upstroke' },
  { id: 'Ito',   name: 'Transient outward K⁺',        detail: 'brief Phase 1 notch right after the upstroke' },
  { id: 'IKr',   name: 'Rapid delayed rectifier K⁺',  detail: 'drives Phase 3 repolarization (the hERG channel)' },
  { id: 'IKs',   name: 'Slow delayed rectifier K⁺',   detail: 'joins IKr for Phase 3 repolarization' },
]
function IonChannelGlossary() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/60 p-2.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-300 hover:text-gray-100 transition-colors"
      >
        Ion channel key
        <svg className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1.5">
          {ION_CHANNEL_GLOSSARY.map(ch => (
            <div key={ch.id} className="flex items-baseline gap-2 text-xs">
              <span className="font-mono text-amber-300 shrink-0 w-24">{ch.id}</span>
              <span className="text-gray-400 leading-snug">
                <span className="text-gray-200">{ch.name}</span> — {ch.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Ion channel badge row — reads clockRef directly and mutates DOM opacity
// via refs (same technique HeartAnimation.jsx uses) so 3 panels animating
// at once don't force a React re-render 60x/second.
function IonChannelRow({ clockRef, cycleMs, phases, channels }) {
  const phasesRef = useRef(phases)
  useEffect(() => { phasesRef.current = phases }, [phases])
  const elRefs = useRef({})

  useEffect(() => {
    let rafId
    const frame = () => {
      const frac = ((clockRef.current.tInCycle / cycleMs) % 1 + 1) % 1
      const list = phasesRef.current
      const phase = list.find(ph => frac >= ph.tRange[0] && frac < ph.tRange[1]) || list[list.length - 1]
      channels.forEach(ch => {
        const el = elRefs.current[ch.id]
        if (!el) return
        const level = phase ? (ch.levels[phase.id] ?? 0) : 0
        el.style.opacity = String(0.18 + 0.82 * level)
        el.style.transform = `scale(${(1 + 0.35 * level).toFixed(2)})`
        el.style.boxShadow = level > 0.5 ? `0 0 ${Math.round(6 * level)}px #fbbf24` : 'none'
      })
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [clockRef, cycleMs, channels])

  return (
    <div className="flex flex-wrap gap-1 px-3 py-1.5 border-t border-gray-800/70 bg-gray-950/40">
      {channels.map(ch => (
        <div key={ch.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-gray-700/60" title={ch.note}>
          <span
            ref={el => { elRefs.current[ch.id] = el }}
            className="w-2 h-2 rounded-full bg-amber-400 transition-transform duration-150"
          />
          <span className="text-[10px] font-mono text-gray-300">{ch.label}</span>
        </div>
      ))}
    </div>
  )
}

// Live phase-description line — same DOM-ref-mutation technique, no hover
// required. Text snaps to whichever phase the cursor currently sits in.
function PhaseLabel({ clockRef, cycleMs, phases }) {
  const ref = useRef(null)
  const phasesRef = useRef(phases)
  useEffect(() => { phasesRef.current = phases }, [phases])
  useEffect(() => {
    let rafId
    const frame = () => {
      const frac = ((clockRef.current.tInCycle / cycleMs) % 1 + 1) % 1
      const list = phasesRef.current
      const phase = list.find(ph => frac >= ph.tRange[0] && frac < ph.tRange[1])
      if (ref.current) ref.current.textContent = phase ? phase.short : ''
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [clockRef, cycleMs])
  return <p ref={ref} className="text-[11px] text-cyan-300 font-mono px-3 pt-1 min-h-[14px] leading-snug" />
}

// One live panel = trace (TraceCanvas) + optional phase-number bands +
// live phase description + the ion channel row underneath.
function APLivePanel({ clockRef, cycleMs, title, sub, data, phases, channels, color, showPhaseNumbers, height = 160 }) {
  const xDomain = useMemo(() => [0, cycleMs], [cycleMs])
  const phaseMarkers = useMemo(
    () => phases.map(ph => {
      const col = AP_PHASE_COLORS[ph.id] || [100, 100, 100, 25]
      return { x0: ph.tRange[0] * cycleMs, x1: ph.tRange[1] * cycleMs, color: `rgba(${col[0]},${col[1]},${col[2]},${(col[3] / 255).toFixed(2)})` }
    }),
    [phases, cycleMs]
  )
  const bandLabels = useMemo(
    () => (showPhaseNumbers
      ? phases.map(ph => ({ x: (ph.tRange[0] + ph.tRange[1]) / 2 * cycleMs, text: PHASE_NUMBER[ph.id] || '' }))
      : null),
    [phases, cycleMs, showPhaseNumbers]
  )
  const valueAt = useCallback((t) => interpAP(data, t / cycleMs), [data, cycleMs])

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden flex-1 min-w-0">
      <div className="px-3 pt-1.5 pb-0.5">
        <div className="text-xs font-semibold text-gray-100 leading-snug">{title}</div>
        <div className="text-[10px] text-gray-500 leading-snug">{sub}</div>
      </div>
      <div className="flex items-baseline justify-between px-3 pb-0.5">
        <span className="text-[10px] font-semibold" style={{ color }}>Membrane Potential (mV)</span>
        <span className="text-[9px] text-gray-600">−100 to +50 mV — NOT what an ECG records</span>
      </div>
      <TraceCanvas
        clockRef={clockRef}
        valueAt={valueAt}
        xDomain={xDomain}
        yDomain={AP_Y_DOMAIN}
        color={color}
        phaseMarkers={phaseMarkers}
        bandLabels={bandLabels}
        height={height}
      />
      <PhaseLabel clockRef={clockRef} cycleMs={cycleMs} phases={phases} />
      <IonChannelRow clockRef={clockRef} cycleMs={cycleMs} phases={phases} channels={channels} />
    </div>
  )
}

function LabeledSlider({ label, value, onChange, min, max, step = 1, unit = '', accent = 'accent-cyan-500', formatValue }) {
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-300">{label}</span>
        <span className="text-xs font-mono text-gray-400">{formatValue ? formatValue(value) : `${value}${unit}`}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full ${accent}`}
      />
    </div>
  )
}

function kBarColor(k) {
  if (k < 3.5 || k > 5.5) return k < 3.0 || k > 7.0 ? '#ef4444' : '#f59e0b'
  return '#10b981'
}

const SPEEDS = [0.25, 0.5, 1]

// Data-driven tissue list — drives both the Focus-mode dropdown and the
// Compare-mode checkboxes (same pattern Module 3 uses for its structure
// picker: one array, one dropdown, instead of hand-writing each panel).
const TISSUE_CATALOG = [
  { id: 'sa',        label: 'SA Node',              sub: '(no external stimulus needed) — fires first',                 color: '#34d399', channels: SA_ION_CHANNELS,     showPhaseNumbers: false },
  { id: 'atrium',    label: 'Atrial Myocyte',       sub: 'Fires just after SA — brief plateau',                          color: '#fbbf24', channels: ATRIAL_ION_CHANNELS, showPhaseNumbers: false },
  { id: 'av',        label: 'AV Node',              sub: 'Triggered by the atrial impulse — imposes the AV delay',       color: '#f472b6', channels: AV_ION_CHANNELS,     showPhaseNumbers: false },
  { id: 'ventricle', label: 'Ventricular Myocyte',  sub: 'Working myocardium (Phases 0–4) — fires after the AV delay',   color: '#60a5fa', channels: MYO_ION_CHANNELS,    showPhaseNumbers: true },
  { id: 'purkinje',  label: 'Purkinje Fiber',       sub: 'Fastest conduction, longest plateau',                          color: '#a78bfa', channels: PK_ION_CHANNELS,     showPhaseNumbers: false },
]
const COMPARE_MIN = 2, COMPARE_MAX = 4

function LiveActionPotentials() {
  const [sympathetic, setSympathetic] = useState(20)
  const [parasympathetic, setParasympathetic] = useState(20)
  const [kMEqL, setKMEqL] = useState(4.0)
  const [caMgDl, setCaMgDl] = useState(9.5)
  const [speed, setSpeed] = useState(1)

  // Focus mode shows one tissue large; Compare mode shows a student-picked
  // subset side by side — five tissues at once, even at 2B's wide layout,
  // would be right back to the cramped panels this replaced.
  const [viewMode, setViewMode] = useState('focus')
  const [focusedTissue, setFocusedTissue] = useState('sa')
  const [focusMenuOpen, setFocusMenuOpen] = useState(false)
  const focusMenuRef = useRef(null)
  const [compareSelection, setCompareSelection] = useState(['sa', 'atrium', 'ventricle', 'purkinje'])

  useEffect(() => {
    if (!focusMenuOpen) return
    const onPointerDown = (e) => {
      if (focusMenuRef.current && !focusMenuRef.current.contains(e.target)) setFocusMenuOpen(false)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') setFocusMenuOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [focusMenuOpen])

  const toggleCompare = (id) => {
    setCompareSelection(sel => {
      if (sel.includes(id)) return sel.length <= COMPARE_MIN ? sel : sel.filter(x => x !== id)
      return sel.length >= COMPARE_MAX ? sel : [...sel, id]
    })
  }

  const phys = useMemo(
    () => computeAPPhysiology({ sympathetic, parasympathetic, kMEqL, caMgDl }),
    [sympathetic, parasympathetic, kMEqL, caMgDl]
  )
  // AV fires once triggered by the atrial impulse, positioned between the
  // atrium's own firing point (~0.05) and the ventricle's (~0.182) — kept in
  // that window even as avDelayMs itself changes with ANS tone.
  const avFireFrac = clamp(phys.avDelayMs / phys.cycleMs, 0.08, 0.16)

  const sa  = useMemo(() => buildSlowResponseWave(phys.sa), [phys.sa])
  const av  = useMemo(() => buildSlowResponseWave(phys.av, { fireAtFrac: avFireFrac }), [phys.av, avFireFrac])
  const atr = useMemo(() => buildWorkingCellWave(phys.atrium, 'atrium'), [phys.atrium])
  const myo = useMemo(() => buildWorkingCellWave(phys.ventricle, 'ventricle'), [phys.ventricle])
  const pk  = useMemo(() => buildWorkingCellWave(phys.purkinje, 'purkinje'), [phys.purkinje])
  const waveById = { sa, atrium: atr, av, ventricle: myo, purkinje: pk }

  const { clockRef, tMs, isPlaying, toggle, scrub } = useLocalClock(phys.cycleMs, null, speed)

  const kPct = clamp((phys.effectiveKMEqL - 2) / (9 - 2) * 100, 0, 100)
  const focusedMeta = TISSUE_CATALOG.find(t => t.id === focusedTissue) ?? TISSUE_CATALOG[0]

  return (
    <div>
      {/* View mode + (Focus mode) tissue picker — same dropdown pattern
          Module 3 uses for its structure picker. */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs shrink-0">
          <button
            onClick={() => setViewMode('focus')}
            className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'focus' ? 'bg-emerald-600/20 text-emerald-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
          >
            Focus
          </button>
          <button
            onClick={() => setViewMode('compare')}
            className={`px-3 py-1.5 font-medium border-l border-gray-700 transition-colors ${viewMode === 'compare' ? 'bg-emerald-600/20 text-emerald-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
          >
            Compare
          </button>
        </div>

        {viewMode === 'focus' && (
          <div ref={focusMenuRef} className="relative shrink-0">
            <button
              onClick={() => setFocusMenuOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={focusMenuOpen}
              className="flex items-center gap-2 w-56 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs font-semibold text-white hover:bg-gray-700 hover:border-gray-600 transition-colors"
            >
              <span className="flex-1 text-left truncate">{focusedMeta.label}</span>
              <svg className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${focusMenuOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {focusMenuOpen && (
              <div role="listbox"
                className="absolute left-0 top-full mt-1 z-30 w-56 rounded-lg bg-gray-900 border border-gray-700 shadow-xl shadow-black/50 py-1">
                {TISSUE_CATALOG.map(t => {
                  const isActive = t.id === focusedTissue
                  return (
                    <button
                      key={t.id}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => { setFocusedTissue(t.id); setFocusMenuOpen(false) }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isActive ? 'bg-emerald-600/20 text-emerald-300 font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="flex-1 truncate">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === 'compare' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {TISSUE_CATALOG.map(t => {
              const checked = compareSelection.includes(t.id)
              const disabled = (!checked && compareSelection.length >= COMPARE_MAX) || (checked && compareSelection.length <= COMPARE_MIN)
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors ${
                    checked ? 'border-gray-600 bg-gray-800 text-gray-200' : 'border-gray-800 text-gray-500'
                  } ${disabled && !checked ? 'opacity-40' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox" checked={checked} disabled={disabled}
                    onChange={() => toggleCompare(t.id)} className="accent-emerald-500"
                  />
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  {t.label}
                </label>
              )
            })}
            <span className="text-[10px] text-gray-600">Pick {COMPARE_MIN}–{COMPARE_MAX}</span>
          </div>
        )}
      </div>

      {/* Panels, in conduction order: SA fires first, then the atrium
          (almost immediately), then — after the AV delay — the AV node
          itself, then ventricle and Purkinje fire together. */}
      <p className="text-[11px] text-gray-500 mb-1">
        The cursor loops once per cardiac cycle. Watch the order: SA node fires first, the atrium follows almost
        immediately, then the AV node fires (imposing the delay) just before ventricle and Purkinje fire together.
      </p>

      {viewMode === 'focus' ? (
        <APLivePanel
          key={focusedTissue}
          clockRef={clockRef} cycleMs={phys.cycleMs}
          title={focusedMeta.label} sub={focusedMeta.sub}
          data={waveById[focusedTissue].data} phases={waveById[focusedTissue].phases}
          channels={focusedMeta.channels} color={focusedMeta.color}
          showPhaseNumbers={focusedMeta.showPhaseNumbers} height={300}
        />
      ) : (
        <div className="flex flex-col lg:flex-row gap-2 items-stretch">
          {compareSelection.map(id => {
            const meta = TISSUE_CATALOG.find(t => t.id === id)
            const w = waveById[id]
            return (
              <APLivePanel
                key={id}
                clockRef={clockRef} cycleMs={phys.cycleMs}
                title={meta.label} sub={meta.sub}
                data={w.data} phases={w.phases}
                channels={meta.channels} color={meta.color}
                showPhaseNumbers={meta.showPhaseNumbers}
              />
            )
          })}
        </div>
      )}
      <IonChannelGlossary />

      {/* Playback controls — one clock drives all three panels */}
      <div className="flex items-center gap-3 flex-wrap mt-2 rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-2">
        <button
          onClick={toggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0} max={phys.cycleMs}
          value={Math.min(Math.max(tMs, 0), phys.cycleMs)}
          onChange={e => scrub(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-emerald-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-28">{Math.round(tMs)} / {Math.round(phys.cycleMs)} ms</span>
        <div className="flex items-center gap-1">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                speed === s
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                  : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* ── ANS controls ── */}
      <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
        <h3 className="text-sm font-semibold text-white mb-1.5">Autonomic Nervous System</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <LabeledSlider
            label="Sympathetic Tone" value={sympathetic} min={0} max={100}
            onChange={setSympathetic} unit="%" accent="accent-red-500"
          />
          <LabeledSlider
            label="Parasympathetic Tone" value={parasympathetic} min={0} max={100}
            onChange={setParasympathetic} unit="%" accent="accent-blue-500"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          <Callout>
            <strong>Sympathetic (β1 adrenergic):</strong> Noradrenaline / adrenaline → β1 receptor → ↑ If, ↑ ICa-L.
            SA node Phase 4 slope steepens (faster automaticity) and cycle shortens; max diastolic potential becomes
            slightly less negative. Ventricular/Purkinje AP duration slightly shortens (upstroke unchanged).
          </Callout>
          <Callout>
            <strong>Parasympathetic (M2 cholinergic):</strong> ACh → M2 receptor → IKAch opens → hyperpolarization.
            SA node Phase 4 slope flattens, max diastolic potential hyperpolarizes, and the cycle lengthens
            dramatically at high tone. Parasympathetic has minimal direct effect on ventricular myocytes — they
            have few M2 receptors.
          </Callout>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2 px-3 py-1.5 rounded-lg bg-gray-950/50 border border-gray-800">
          <span className="text-xs text-gray-400">AV node conduction delay</span>
          <span className="text-sm font-mono text-amber-300">Δt ≈ {phys.avDelayMs} ms</span>
          <span className="text-[11px] text-gray-600">Bridges to the PR interval in Module 2, Lab 2 — no ECG shown here.</span>
        </div>
        {phys.bothElevated && (
          <div className="mt-1.5 px-3 py-1 rounded-lg bg-purple-950/40 border border-purple-700/40 text-xs text-purple-300">
            Competing inputs — autonomic balance determines net heart rate.
          </div>
        )}
      </div>

      {/* ── Ion concentration controls ── */}
      <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
        <h3 className="text-sm font-semibold text-white mb-1.5">Extracellular Ion Concentrations</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-[220px]">
            <LabeledSlider
              label="Extracellular [K⁺] (baseline)" value={kMEqL} min={2.0} max={9.0} step={0.1}
              onChange={setKMEqL} unit=" mEq/L" accent="accent-orange-500"
              formatValue={v => `${v.toFixed(1)} mEq/L`}
            />
            <div className="h-1.5 rounded-full bg-gray-800 mt-1 overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${kPct}%`, backgroundColor: kBarColor(phys.effectiveKMEqL) }} />
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <p className="text-[10px] text-gray-600">Normal range 3.5–5.0 mEq/L</p>
              {sympathetic > 0 && (
                <p className="text-[10px] font-mono text-amber-300">
                  Effective [K⁺]: {phys.effectiveKMEqL.toFixed(1)} mEq/L
                </p>
              )}
            </div>
          </div>
          <LabeledSlider
            label="Extracellular [Ca²⁺]" value={caMgDl} min={5.0} max={15.0} step={0.1}
            onChange={setCaMgDl} unit=" mg/dL" accent="accent-teal-500"
            formatValue={v => `${v.toFixed(1)} mg/dL`}
          />
        </div>

        {sympathetic > 0 && (
          <Callout>
            <strong>Sympathetic → [K⁺]:</strong> β2-adrenergic stimulation activates the Na⁺/K⁺-ATPase, driving K⁺
            into cells and lowering extracellular [K⁺] — the same mechanism (and roughly the same magnitude) used
            clinically when albuterol or epinephrine treat hyperkalemia. The baseline slider above is what you set;
            the effective value below it is what the AP model actually uses.
          </Callout>
        )}

        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          {phys.effectiveKMEqL > 5.5 ? (
            <Callout>
              ↑ [K⁺]out reduces the K⁺ driving force → EK shifts toward 0 → resting Vm follows EK (Nernst equation).
              AP amplitude decreases, and Phase 0 upstroke slows as Na⁺ channels are partially inactivated.
            </Callout>
          ) : phys.effectiveKMEqL < 3.5 ? (
            <Callout>
              ↓ [K⁺]out makes resting membrane potential more negative. Phase 3 repolarization slows (reduced IK
              driving force), SA node automaticity paradoxically increases slightly, and a small U-wave analog
              appears on the ventricular trace after Phase 3.
            </Callout>
          ) : (
            <Callout>Extracellular [K⁺] is within the normal 3.5–5.0 mEq/L range — resting potential and repolarization are unaffected.</Callout>
          )}
          {caMgDl < 8.5 ? (
            <Callout>↓ [Ca²⁺]out → reduced ICa-L → prolonged plateau. Phase 2 lengthens and AP duration increases.</Callout>
          ) : caMgDl > 10.5 ? (
            <Callout>↑ [Ca²⁺]out → enhanced ICa-L → shortened plateau. Phase 2 shortens and AP duration decreases.</Callout>
          ) : (
            <Callout>Extracellular [Ca²⁺] is within the normal 8.5–10.5 mg/dL range — the plateau duration is unaffected.</Callout>
          )}
        </div>

        {phys.effectiveKMEqL >= 7.0 && (
          <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-700/40 text-xs text-red-300 font-medium">
            ⚠ Critical hyperkalemia — conduction severely impaired.
          </div>
        )}
      </div>

      {/* No ECG in this section — intracellular recordings only */}
      <p className="mt-2 text-[11px] text-gray-600 text-center leading-relaxed">
        The traces above require an intracellular microelectrode. An ECG cannot measure membrane potential — see section 2C.
      </p>
    </div>
  )
}

// ── 2C: What Does the ECG Actually Record? ─────────────────────────────────

// HeartAnimation reads clockRef.current.{tInCycle,cycleMs,nativeCycleMs} —
// nativeCycleMs/cycleMs are kept on the ref (not just closed over) so the
// SAME clock instance driving the AP/ECG canvases below can also drive the
// real conduction animation in sync.
function useLocalClock(cycleMs, nativeCycleMs = null, speed = 1) {
  const clockRef = useRef({ tInCycle: 0, cycleMs, nativeCycleMs })
  const [tMs, setTMs] = useState(0)
  const isPlayingRef = useRef(true)
  const [isPlaying, setIsPlaying] = useState(true)

  useEffect(() => {
    clockRef.current.cycleMs = cycleMs
    clockRef.current.nativeCycleMs = nativeCycleMs
  }, [cycleMs, nativeCycleMs])

  useEffect(() => {
    let lastTs = null, raf
    const tick = (ts) => {
      if (isPlayingRef.current && lastTs !== null) {
        const dt = Math.min(ts - lastTs, 50) * speed
        const newT = (clockRef.current.tInCycle + dt) % cycleMs
        clockRef.current.tInCycle = newT
        setTMs(Math.round(newT))
      }
      lastTs = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cycleMs, speed])

  const setPlaying = useCallback((v) => { isPlayingRef.current = v; setIsPlaying(v) }, [])
  const toggle = useCallback(() => setPlaying(!isPlayingRef.current), [setPlaying])
  const scrub = useCallback((ms) => { clockRef.current.tInCycle = ms; setTMs(ms) }, [])

  return { clockRef, tMs, isPlaying, toggle, setPlaying, scrub }
}

// Generic time-series canvas: draws valueAt(t) over xDomain, with an optional
// set of shaded phase bands and a cursor synced to clockRef's live position.
function TraceCanvas({ clockRef, valueAt, xDomain, yDomain, color, phaseMarkers, bandLabels, height = 130 }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const PAD = { l: 44, r: 10, t: 10, b: 18 }
    let W = 0

    const resize = () => {
      W = container.clientWidth || 300
      canvas.width = W * dpr
      canvas.height = height * dpr
      canvas.style.width = '100%'
      canvas.style.height = height + 'px'
    }
    resize()
    const ctx = canvas.getContext('2d')

    let rafId
    const frame = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const dW = W - PAD.l - PAD.r
      const dH = height - PAD.t - PAD.b
      const [x0, x1] = xDomain
      const [yMin, yMax] = yDomain
      const toX = (t) => PAD.l + ((t - x0) / (x1 - x0)) * dW
      const toY = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * dH

      ctx.clearRect(0, 0, W, height)
      ctx.fillStyle = '#111827'
      ctx.fillRect(0, 0, W, height)

      if (phaseMarkers) {
        phaseMarkers.forEach(({ x0: px0, x1: px1, color: pc }) => {
          if (px1 < x0 || px0 > x1) return
          const rx = toX(Math.max(px0, x0)), rx2 = toX(Math.min(px1, x1))
          ctx.fillStyle = pc
          ctx.fillRect(rx, PAD.t, rx2 - rx, dH)
        })
      }

      // Small numeral drawn at the top of each phase band — e.g. the
      // ventricular panel's 0/1/2/3/4 phase numbers called out in the spec.
      if (bandLabels) {
        ctx.font = 'bold 10px monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(226,232,240,0.65)'
        bandLabels.forEach(({ x, text }) => {
          if (x < x0 || x > x1) return
          ctx.fillText(text, toX(x), PAD.t + 11)
        })
      }

      ctx.strokeStyle = '#374151'
      ctx.lineWidth = 0.5
      ctx.fillStyle = '#6b7280'
      ctx.font = '9px monospace'
      const ySteps = 4
      for (let i = 0; i <= ySteps; i++) {
        const v = yMin + (i / ySteps) * (yMax - yMin)
        const y = toY(v)
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
        ctx.fillText(v.toFixed(Number.isInteger(v) ? 0 : 1), 2, y + 3)
      }

      ctx.strokeStyle = color
      ctx.lineWidth = 1.8
      ctx.beginPath()
      const N = 220
      for (let i = 0; i <= N; i++) {
        const t = x0 + (i / N) * (x1 - x0)
        const v = Math.max(yMin, Math.min(yMax, valueAt(t)))
        const x = toX(t), y = toY(v)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()

      const tNow = clockRef.current.tInCycle
      if (tNow >= x0 && tNow <= x1) {
        const cx = toX(tNow)
        ctx.strokeStyle = '#f8fafc'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, height - PAD.b); ctx.stroke()
        ctx.setLineDash([])
      }

      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => { cancelAnimationFrame(rafId); ro.disconnect() }
  }, [valueAt, xDomain, yDomain, phaseMarkers, bandLabels, color, height, clockRef])

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} />
    </div>
  )
}

function ElectrodeIcon() {
  return (
    <svg width="39" height="63" viewBox="0 0 26 42" style={{ display: 'block' }}>
      <rect x="15" y="0" width="9" height="9" rx="1.5" fill="#374151" stroke="#6b7280" />
      <line x1="20" y1="2" x2="4" y2="34" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
      <circle cx="4" cy="34" r="2.5" fill="#facc15" />
    </svg>
  )
}

// Draggable micropipette dropped directly onto the SAME heart illustration
// used by 2D's Conduction Animation (HeartAnimation), driven by the exact
// clock powering the AP/ECG graphs below — so the conduction sweep animates
// in sync with both traces rather than running on its own separate timer.
//
// Hit-testing and highlighting are deliberately decoupled for Purkinje.
//
// Highlighting still uses the REAL traced path: there's no shape drawn
// specifically labeled "Purkinje" in this illustration, but the conduction-
// bundle path (rbundle/lbundle — right/left halves of one shared shape
// reaching from the AV node area down through the fanning terminal branches
// at the apex) IS the His-Purkinje system, so it's tagged
// data-region="purkinje" in HeartAnimation.jsx and gets the same
// drop-shadow-on-real-geometry glow atrium/ventricle get.
//
// Hit-testing does NOT use that same real fill for Purkinje, though: once
// unclipped, that path's silhouette fans out across a large part of BOTH
// ventricle chambers (not just the septum), so testing against it kept
// registering "Purkinje" over a wide swath of what should read as
// "ventricle." Instead, Purkinje gets a small dedicated circular hit-zone
// positioned at the actual gap between the two measured ventricle boxes,
// biased toward their lower/apex side — and that circle is checked WITH
// PRIORITY, before ventricle's own exact-shape test, so landing in that gap
// always reads as Purkinje regardless of whether the ventricle's real shape
// also happens to cover the same point. SA/AV get the same small-circle,
// checked-with-priority treatment — both nodes sit physically inside the
// atrium's own illustrated area, and their real shapes are only a few px
// across anyway (too small to reliably drop onto), so a small dedicated
// circle checked before atrium's exact-shape test is both more forgiving
// and correctly wins there. Atrium (ra+la) and ventricle (rv+lv) themselves
// are tested against their real fill via isPointInFill() (each element's own
// getScreenCTM() inverse correctly maps the client point into that path's
// local space, including the extra scale(0.26458333) transform some of
// these paths carry).
// Scaled 1.6× along with the heart's own render size (200→320) so these
// hit-zones keep the same feel relative to the artwork instead of shrinking
// in proportion to it.
const NODE_RADIUS = 16        // sa / av circular targets — small and given priority
                               // over atrium below since both sit inside its area
const PURKINJE_RADIUS = 24    // smaller — its zone sits right at the ventricle
                               // boxes' edge, so a big circle bled into them
const REGION_PAD = 6          // outline padding beyond each measured atrium bbox
const VENTRICLE_SHRINK = 16   // ventricle's fallback box is inset by this much so it
                               // doesn't claim the septal gap / apex where Purkinje is
const HIT_TOLERANCE = 29      // how far outside any shape's edge still counts as a hit

function HeartDropTarget({ clockRef, rhythm, selectedRegion, onSelect }) {
  // The electrode is absolutely positioned relative to `stageRef` (the inner
  // W×H box), NOT the outer padded/centered container — so drag math must
  // use stageRef's own bounding rect too, or the electrode ends up offset
  // by however much the outer container is wider/centered than the stage.
  const stageRef = useRef(null)
  const [dragPos, setDragPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [hoverRegion, setHoverRegion] = useState(null)
  const [regionShapes, setRegionShapes] = useState(null)
  // Real DOM elements for atrium (ra+la) / ventricle (rv+lv) / purkinje
  // (rbundle+lbundle) — used both to hit-test against their TRUE traced
  // outline (not a bounding box) and to highlight that exact outline, so
  // "the boundary" is the real illustrated shape, not an approximation.
  const shapeElsRef = useRef({ atrium: [], ventricle: [], purkinje: [] })

  // Sized larger than the original 200×236 now that this component has a
  // full-width row to itself (see ECGVsAPSection) instead of sharing space
  // with the AP panel — same 200:236 aspect ratio, just scaled up 1.6×.
  const W = 320, H = 378
  const highlighted = hoverRegion || selectedRegion

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const stage = stageRef.current
      if (!stage) return
      shapeElsRef.current = {
        atrium: Array.from(stage.querySelectorAll('[data-region="atrium"]')),
        ventricle: Array.from(stage.querySelectorAll('[data-region="ventricle"]')),
        purkinje: Array.from(stage.querySelectorAll('[data-region="purkinje"]')),
      }

      const stageRect = stage.getBoundingClientRect()
      const groups = { sa: [], av: [], atrium: [], ventricle: [], purkinje: [] }
      stage.querySelectorAll('[data-region]').forEach(el => {
        const list = groups[el.dataset.region]
        if (!list) return
        const r = el.getBoundingClientRect()
        list.push({
          left: r.left - stageRect.left, right: r.right - stageRect.left,
          top: r.top - stageRect.top, bottom: r.bottom - stageRect.top,
        })
      })

      // sa/av: a single small element each — union their (one) box into a circle.
      const circleFrom = (boxes) => {
        if (!boxes.length) return null
        const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right))
        const top = Math.min(...boxes.map(b => b.top)), bottom = Math.max(...boxes.map(b => b.bottom))
        return { kind: 'circle', x: (left + right) / 2, y: (top + bottom) / 2, r: NODE_RADIUS }
      }
      // atrium/ventricle/purkinje boxes are kept ONLY as a forgiving near-miss
      // fallback for regionAt() below — not rendered — since the real shapes
      // (traced exactly via isPointInFill + a drop-shadow outline) do that job.
      const rectsFrom = (boxes, pad) => boxes.map(b => ({
        kind: 'rect',
        left: b.left - pad, right: b.right + pad,
        top: b.top - pad, bottom: b.bottom + pad,
      }))

      const sa = groups.sa.length ? [circleFrom(groups.sa)] : []
      const av = groups.av.length ? [circleFrom(groups.av)] : []
      const atrium = rectsFrom(groups.atrium, REGION_PAD)
      // Ventricle shrinks inward (rather than padding out) so its fallback
      // box doesn't reach into the septal gap between the two chambers or
      // down toward the apex — both of which should read as Purkinje.
      const ventricle = rectsFrom(groups.ventricle, -VENTRICLE_SHRINK)
      // Purkinje's real traced shape (rbundle/lbundle unclipped) turned out
      // to fan out across a large chunk of BOTH ventricles, not just the
      // septum — using its exact fill for hit-testing kept overlapping
      // ventricle over a wide area. So instead of testing that fill, its
      // hitbox is a small dedicated circle placed at the actual gap between
      // the two measured ventricle boxes, biased toward their lower/apex
      // side. The glow highlight still uses the real shape (unchanged) —
      // only what counts as "inside Purkinje" changed.
      let purkinje = []
      if (groups.ventricle.length) {
        const xs = groups.ventricle.map(b => (b.left + b.right) / 2)
        const x = xs.reduce((a, b) => a + b, 0) / xs.length
        const top = Math.min(...groups.ventricle.map(b => b.top))
        const bottom = Math.max(...groups.ventricle.map(b => b.bottom))
        const y = top + (bottom - top) * 0.72
        purkinje = [{ kind: 'circle', x, y, r: PURKINJE_RADIUS }]
      }

      setRegionShapes({ sa, av, atrium, ventricle, purkinje })
      // Start the probe on the chamber supplying the default recording.
      // Measure the artwork so the position includes its SVG transforms.
      const chamber = groups.ventricle[0]
      if (chamber) {
        setDragPos(current => current ?? {
          x: (chamber.left + chamber.right) / 2,
          y: (chamber.top + chamber.bottom) / 2,
        })
      }
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Distance from (x,y) to a shape's edge — 0 when the point is inside/on it.
  const distToShape = (x, y, shape) => {
    if (shape.kind === 'circle') return Math.max(0, Math.hypot(x - shape.x, y - shape.y) - shape.r)
    const dx = Math.max(shape.left - x, 0, x - shape.right)
    const dy = Math.max(shape.top - y, 0, y - shape.bottom)
    return Math.hypot(dx, dy)
  }

  // Exact test against the real artwork's own filled silhouette — each
  // element's getScreenCTM() already folds in its own transform (some of
  // these paths carry an extra scale(0.26458333)) plus every ancestor's, so
  // converting the client point through its inverse lands correctly in that
  // element's local path-data space regardless of how it's nested.
  const pathHit = (clientX, clientY, els) => {
    for (const el of els) {
      if (typeof el.isPointInFill !== 'function' || typeof el.getScreenCTM !== 'function') continue
      const ctm = el.getScreenCTM()
      const svg = el.ownerSVGElement
      if (!ctm || !svg) continue
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const local = pt.matrixTransform(ctm.inverse())
      if (el.isPointInFill(local)) return true
    }
    return false
  }

  const regionAt = useCallback((clientX, clientY) => {
    if (!regionShapes || !stageRef.current) return null
    const rect0 = stageRef.current.getBoundingClientRect()
    const lx = clientX - rect0.left, ly = clientY - rect0.top

    // SA/AV and Purkinje's dedicated hit-zones (small circles) are checked
    // FIRST, unconditionally, all ahead of atrium/ventricle's real-shape
    // tests. SA and AV physically sit inside the atrium's own illustrated
    // area, so without this an atrium drop would always win there before
    // the tiny node circles ever got a chance (same reasoning as Purkinje
    // vs. ventricle below). Being inside one of these small zones always
    // wins, regardless of whether atrium/ventricle's real shape also covers it.
    const saCircle = (regionShapes.sa || [])[0]
    if (saCircle && distToShape(lx, ly, saCircle) === 0) return 'sa'
    const avCircle = (regionShapes.av || [])[0]
    if (avCircle && distToShape(lx, ly, avCircle) === 0) return 'av'
    const purkCircle = (regionShapes.purkinje || [])[0]
    if (purkCircle && distToShape(lx, ly, purkCircle) === 0) return 'purkinje'

    // True-boundary hit against the real artwork takes priority over the
    // approximating shapes below (falls back gracefully if isPointInFill
    // isn't supported in this browser — shapeElsRef stays empty-checked).
    if (pathHit(clientX, clientY, shapeElsRef.current.atrium)) return 'atrium'
    if (pathHit(clientX, clientY, shapeElsRef.current.ventricle)) return 'ventricle'

    let best = null, bestDist = Infinity
    for (const key of ['sa', 'av', 'atrium', 'ventricle', 'purkinje']) {
      for (const shape of regionShapes[key] || []) {
        const d = distToShape(lx, ly, shape)
        if (d < bestDist) { bestDist = d; best = key }
      }
    }
    return bestDist <= HIT_TOLERANCE ? best : null
  }, [regionShapes])

  // Imperatively glow the REAL path(s) matching whichever region is
  // currently hovered/selected — a CSS drop-shadow filter follows the
  // element's actual alpha silhouette, so the highlight traces the true
  // organic boundary instead of any rectangle/circle approximation.
  useEffect(() => {
    const { atrium, ventricle, purkinje } = shapeElsRef.current
    const glow = 'drop-shadow(0 0 3px #22d3ee) drop-shadow(0 0 3px #22d3ee)'
    atrium.forEach(el => { el.style.filter = highlighted === 'atrium' ? glow : '' })
    ventricle.forEach(el => { el.style.filter = highlighted === 'ventricle' ? glow : '' })
    purkinje.forEach(el => { el.style.filter = highlighted === 'purkinje' ? glow : '' })
  })

  const handlePointerDown = (e) => {
    e.preventDefault()
    const rect = stageRef.current.getBoundingClientRect()
    setDragging(true)
    setDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e) => {
      const rect = stageRef.current.getBoundingClientRect()
      setDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      const hit = regionAt(e.clientX, e.clientY)
      setHoverRegion(hit)
      // Live-update the AP trace while dragging, not just on drop — onSelect
      // sets selectedRegion, which the AP panel reads directly.
      onSelect(hit)
    }
    const up = (e) => {
      setDragging(false)
      // Leave dragPos as-is — the electrode stays wherever it was dropped
      // instead of snapping back to its home corner.
      // Always call onSelect, even with null — dropping off every region
      // should clear the reading, not leave the previous one showing.
      onSelect(regionAt(e.clientX, e.clientY))
      setHoverRegion(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, onSelect, regionAt])

  return (
    <div className="relative rounded-xl border border-gray-800 bg-gray-900/60 p-3 flex flex-col items-center w-full max-w-xl">
      <div ref={stageRef} className="relative" style={{ width: '100%', maxWidth: 520, minHeight: H + 125 }}>
        <div className="mx-auto" style={{ width: W }}>
          <HeartAnimation tissueWaves clockRef={clockRef} rhythmId="normalSinus" rhythm={rhythm} width={W} height={H} />
        </div>
        {[
          { side: 'left', top: 110, label: 'Right arm', polarity: '−' },
          { side: 'right', top: 345, label: 'Left leg', polarity: '+' },
        ].map(({ side, top, label, polarity }) => (
          <div key={side} className="absolute flex flex-col items-center text-blue-300 text-[11px] leading-snug pointer-events-none"
            style={{ [side]: 0, top }} aria-label={`Fixed Lead II skin electrode: ${label}, ${polarity === '+' ? 'positive' : 'negative'}`}>
            <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
              <circle cx="19" cy="19" r="17" fill="#172554" stroke="#60a5fa" strokeWidth="2" />
              <circle cx="19" cy="19" r="11" fill="#1e40af" />
              <text x="19" y="25" textAnchor="middle" fill="white" fontSize="21">{polarity}</text>
            </svg>
            <span className="font-semibold">{label} ({polarity})</span>
            <span>Fixed skin electrode</span>
          </div>
        ))}

        {/* SA/AV: a small circular hit-zone, drawn since there's no other
            visible affordance for these tiny shapes. Atrium/Ventricle/
            Purkinje get NO drawn overlay here — their highlight is the
            drop-shadow glow applied directly to the real paths above (see
            the effect that sets el.style.filter), so what lights up is the
            actual traced boundary, not an approximating shape. */}
        {regionShapes && ['sa', 'av'].flatMap((key) => {
          const active = highlighted === key
          return (regionShapes[key] || []).map((shape, i) => (
            <div
              key={`${key}-${i}`}
              className="absolute rounded-full pointer-events-none transition-colors"
              style={{
                left: shape.x - shape.r,
                top: shape.y - shape.r,
                width: shape.r * 2,
                height: shape.r * 2,
                background: active ? 'rgba(6,182,212,0.18)' : 'transparent',
                border: active ? '1.5px solid #22d3ee' : '1px dashed rgba(148,163,184,0.3)',
              }}
            />
          ))
        })}

        <div
          onPointerDown={handlePointerDown}
          className="absolute cursor-grab active:cursor-grabbing select-none"
          style={{
            // Anchor the yellow recording tip (4, 34 in the SVG), not its box.
            left: dragPos ? dragPos.x - 6 : 0,
            top: dragPos ? dragPos.y - 51 : 0,
            visibility: dragPos ? 'visible' : 'hidden',
            touchAction: 'none',
            zIndex: 20,
            pointerEvents: dragging ? 'none' : 'auto',
          }}
          title="Intracellular microelectrode — drag to choose a cell recording site"
        >
          <ElectrodeIcon />
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        {selectedRegion ? <>Intracellular recording site: <span className="text-cyan-300">{AP_REGIONS.find(r => r.key === selectedRegion)?.label}</span></> : 'Drag the intracellular microelectrode onto the heart'}
      </p>
      <p className="text-[11px] text-blue-300 mt-2 text-center">Blue pads: Lead II surface electrodes. Positions are schematic.</p>
    </div>
  )
}

function ECGVsAPSection({ rhythm }) {
  const cycleMs = rhythm.cycleMs || CYCLE_MS
  const { clockRef, tMs, isPlaying, toggle, setPlaying, scrub } = useLocalClock(cycleMs, rhythm.nativeCycleMs ?? null)
  const [selectedRegion, setSelectedRegion] = useState('ventricle')
  const [zoomed, setZoomed] = useState(false)

  const region = useMemo(() => AP_REGIONS.find(r => r.key === selectedRegion) || null, [selectedRegion])

  const apValueAt = useCallback((t) => {
    if (!region) return -80
    const f = region.anchorFraction + ((t - region.targetMs + cycleMs) % cycleMs) / cycleMs
    return interpAP(region.data, f)
  }, [region, cycleMs])

  // Deliberately uses cycleVoltage (a raw, unwarped sum of the wave
  // Gaussians at time t) instead of ECGVoltage — ECGVoltage runs its input
  // through warpTime() first, shifting the visible R-wave peak by up to
  // ~40ms in a way that drifts continuously against the clock, which would
  // be a second, independent source of desync against the animation on top
  // of the one below.
  //
  const shiftedWaves = rhythm.waves || []

  const ecgValueAt = useCallback((t) => {
    if (shiftedWaves.length === 0) return 0
    return cycleVoltage(t, shiftedWaves, 60)
  }, [shiftedWaves])

  // Zoom uses the same ECG timing as the shared animation clock.
  const rWave = useMemo(() => shiftedWaves.find(w => w.name === 'R'), [shiftedWaves])
  const rWaveCenter = rWave ? rWave.center : QRS_ONSET_MS + VENTRICULAR_ANIM_DELAY_MS + 38

  const xDomain = useMemo(
    () => (zoomed
      ? [Math.max(0, QRS_ONSET_MS + VENTRICULAR_ANIM_DELAY_MS - 60), QRS_ONSET_MS + VENTRICULAR_ANIM_DELAY_MS + 160]
      : [0, cycleMs]),
    [zoomed, cycleMs]
  )
  const apMarkers = useMemo(
    () => (region ? phasesToMarkers(region.phases, region.anchorFraction, region.targetMs, cycleMs) : []),
    [region, cycleMs]
  )

  const handleZoom = useCallback(() => {
    if (zoomed) { setZoomed(false); return }
    setSelectedRegion('ventricle')
    setPlaying(false)
    scrub(rWaveCenter)
    setZoomed(true)
  }, [zoomed, setPlaying, scrub, rWaveCenter])

  return (
    <div>
      {/* TOP — the heart itself: drag the electrode here */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col items-center">
        <p className="text-xs text-gray-500 mb-3 text-center max-w-md">
          Drag the yellow intracellular microelectrode to choose a cell recording site. Its extracellular reference electrode is not shown. The blue skin electrodes stay fixed and record Lead II: left leg (+) minus right arm (−). Moving the yellow tip changes the intracellular recording, while the ECG continues to show the same heartbeat.
        </p>
        <HeartDropTarget
          clockRef={clockRef}
          rhythm={rhythm}
          selectedRegion={selectedRegion}
          onSelect={(key) => { setSelectedRegion(key); setZoomed(false) }}
        />
      </div>

      {/* BELOW — the two traces, side by side */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch mt-3">
        {/* LEFT — Intracellular (AP) trace */}
        <div className="flex-1 min-w-0 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <h3 className="text-sm font-semibold text-white mb-1">Intracellular Recording</h3>
          <p className="text-xs text-gray-500 mb-3">Membrane potential = voltage inside the cell − voltage at the extracellular reference electrode (not shown).</p>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs font-semibold text-emerald-300">
              {region ? `${region.label} action potential` : 'No electrode placed'}
            </span>
            <span className="text-[10px] text-gray-500">Membrane Potential (mV)</span>
          </div>
          <TraceCanvas
            clockRef={clockRef}
            valueAt={apValueAt}
            xDomain={xDomain}
            yDomain={AP_Y_DOMAIN}
            color="#34d399"
            phaseMarkers={apMarkers}
          />
          {region && <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{region.desc}</p>}
        </div>

        {/* SEPARATOR */}
        <div className="flex lg:flex-col items-center justify-center gap-2 lg:w-10 shrink-0 py-1">
          <span className="text-2xl text-gray-600 font-bold">≠</span>
          <span className="text-[10px] text-gray-600 text-center leading-tight max-w-[90px]">
            These are not the same signal
          </span>
        </div>

        {/* RIGHT — ECG trace */}
        <div className="flex-1 min-w-0 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <h3 className="text-sm font-semibold text-white mb-1">ECG Recording (Fixed Lead II)</h3>
          <p className="text-xs text-gray-500 mb-3">Voltage at the blue left leg (+) electrode minus voltage at the blue right arm (−) electrode. Both are on the skin, separate from the intracellular recording electrodes.</p>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs font-semibold text-blue-300">Lead II — fixed surface electrodes</span>
            <span className="text-[10px] text-gray-500">Body Surface Voltage Difference (mV)</span>
          </div>
          <TraceCanvas
            clockRef={clockRef}
            valueAt={ecgValueAt}
            xDomain={xDomain}
            yDomain={ECG_Y_DOMAIN}
            color="#60a5fa"
          />
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            Left: voltage across one cell membrane (intracellular electrode required). Right: voltage difference between body surface electrodes. An equivalent cardiac dipole helps explain this measurement.
          </p>
        </div>
      </div>

      {/* Controls — shared clock drives both traces */}
      <div className="flex items-center gap-3 flex-wrap mt-3">
        <button
          onClick={toggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={xDomain[0]}
          max={xDomain[1]}
          value={Math.min(Math.max(tMs, xDomain[0]), xDomain[1])}
          onChange={e => scrub(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-emerald-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-24">{Math.round(tMs)} / {cycleMs} ms</span>
        <button
          onClick={handleZoom}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            zoomed
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
          }`}
        >
          {zoomed ? 'Exit Zoom' : 'Zoom to QRS'}
        </button>
      </div>

      {zoomed && (
        <div className="mt-2 rounded-lg bg-emerald-950/40 border border-emerald-700/40 px-3 py-2 text-xs text-emerald-300 leading-relaxed">
          At the peak of the R wave (t ≈ {Math.round(rWaveCenter)} ms), the ventricular myocyte is in <strong>Phase 2 — the plateau</strong>, not at the peak of its own upstroke. The AP upstroke happens well before the R wave peaks.
        </div>
      )}

      {/* Misconception callout */}
      <div className="mt-4 rounded-lg bg-amber-950/30 border border-amber-700/40 px-4 py-3 text-xs text-amber-200 leading-relaxed">
        <strong>⚠ Common Misconception:</strong> The ECG does not show membrane potential. The upstroke of the R wave
        is not a recording of a single cell’s action potential upstroke. The ECG measures a difference in extracellular potential between electrode locations. No single cell's membrane
        potential can be read from an ECG. An intracellular microelectrode is required for that measurement.
      </div>
    </div>
  )
}

// ── 2D: Conduction Animation ────────────────────────────────────────────────
// Owns its own clock now that 2D is a standalone tab, never mounted
// alongside 2E — they used to share one master clock via props from the
// top-level CardiacBridge component; now each tab gets its own via the
// same useLocalClock hook 2C already uses.
function ConductionSection({ rhythm }) {
  const cycleMs = rhythm.cycleMs || CYCLE_MS
  const { clockRef, tMs, isPlaying, toggle, scrub } = useLocalClock(cycleMs, rhythm.nativeCycleMs ?? null)
  const conductionMap = useMemo(() => buildConductionMap('normalSinus', rhythm.waves), [rhythm.waves])
  const [showVector, setShowVector] = useState(false)

  const { structName, cv, note } = useMemo(() => {
    if (!conductionMap || conductionMap.length === 0)
      return { structName: 'Diastole', cv: '—', note: '' }
    for (const e of conductionMap) {
      if (tMs >= e.onsetMs && tMs < e.offsetMs && e.state !== 'meta') {
        const id = e.id
        return {
          structName: STRUCT_NAMES[id] || id,
          cv: STRUCT_CV[id] || '—',
          note: STRUCT_NOTE[id] || '',
        }
      }
    }
    return { structName: 'Diastole (rest)', cv: '—', note: 'Heart muscle at rest. SA node building toward next pacemaker potential.' }
  }, [conductionMap, tMs])

  const velTable = [
    { struct: 'SA Node',             cv: '—' },
    { struct: 'Atrial myocardium',   cv: '1.0 m/s' },
    { struct: 'AV Node',             cv: '0.05 m/s' },
    { struct: 'Bundle of His',       cv: '1.0 m/s' },
    { struct: 'Bundle Branches',     cv: '2–4 m/s' },
    { struct: 'Purkinje Fibers',     cv: '2–4 m/s' },
    { struct: 'Ventricular muscle',  cv: '0.3–0.5 m/s' },
  ]

  return (
    <div>
      <div className="flex gap-4 items-start mb-4">
        {/* Heart animation */}
        <div className="relative rounded-xl border border-gray-800 overflow-hidden shrink-0">
          <HeartAnimation
            clockRef={clockRef}
            rhythmId="normalSinusVoltage"
            rhythm={rhythm}
          />
          {showVector && (
            <CardiacVectorOverlay
              clockRef={clockRef}
              waves={rhythm.waves}
              cycleMs={cycleMs}
              width={280}
              height={330}
            />
          )}
        </div>

        {/* Side panel */}
        <div className="flex-1 space-y-3">
          <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 min-h-[120px]">
            <div className="text-xs text-cyan-400 mb-2">Active Structure</div>
            <div className="text-sm font-semibold text-white mb-2 min-h-[20px]">{structName}</div>
            <InfoRow label="Conduction vel." value={cv} />
            <div className="mt-2 min-h-[48px]">
              <p className="text-xs text-gray-400 leading-relaxed">{note || ' '}</p>
            </div>
          </div>

          {/* Velocity table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
            <div className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-wider">Conduction Velocity Reference</div>
            <table className="w-full text-xs">
              <tbody>
                {velTable.map(row => (
                  <tr key={row.struct} className={structName === row.struct ? 'text-cyan-300' : 'text-gray-400'}>
                    <td className="py-0.5 pr-3">{row.struct}</td>
                    <td className="py-0.5 font-mono text-right">{row.cv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={toggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => scrub((clockRef.current.tInCycle + 10) % cycleMs)}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          +10 ms
        </button>
        <button
          onClick={() => scrub(0)}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Reset
        </button>
        <button
          onClick={() => setShowVector(v => !v)}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            showVector
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
          }`}
        >
          Cardiac vector {showVector ? 'ON' : 'OFF'}
        </button>
        <input
          type="range"
          min={0}
          max={cycleMs}
          value={Math.round(tMs)}
          onChange={e => scrub(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-cyan-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-20">{tMs} / {cycleMs} ms</span>
      </div>
    </div>
  )
}

function gaussianV(t, amplitude, center, sigma) {
  return amplitude * Math.exp(-((t - center) ** 2) / (2 * sigma ** 2))
}
function projFactor(sourceAxisDeg, leadAxisDeg) {
  return Math.cos(((sourceAxisDeg - leadAxisDeg) * Math.PI) / 180)
}
// Same delay applied to the ventricular animation (HeartAnimation's
// normalSinusVoltage continuousDelay) so the vector's QRS-driven spike stays
// in sync with the now-delayed ventricular sweep instead of leading it —
// only Q/R/S are shifted; P and T keep their own natural timing.
const VENTRICLE_VECTOR_DELAY_MS = 40
function delayedVoltage(t, waves, leadAxisDeg) {
  return waves.reduce((sum, wave) => {
    const delay = (wave.name === 'Q' || wave.name === 'R' || wave.name === 'S') ? VENTRICLE_VECTOR_DELAY_MS : 0
    const axis = wave.axisDeg ?? 0
    return sum + gaussianV(t - delay, wave.amplitude, wave.center, wave.sigma) * projFactor(axis, leadAxisDeg)
  }, 0)
}

// ── Cardiac vector overlay — toggleable, drawn on top of the real heart SVG ──
// Anchor point and SCALE are first-draft estimates for where the ventricular
// mass sits within HeartAnimation's rendered box — nudge these after seeing
// it rendered if the arrow doesn't sit where expected.
function CardiacVectorOverlay({ clockRef, waves, cycleMs, width = 280, height = 330 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const anchorX = width * 0.52
    const anchorY = height * 0.62
    const SCALE = 34

    let rafId
    const frame = () => {
      const { tInCycle } = clockRef.current
      ctx.clearRect(0, 0, width, height)

      if (waves && waves.length > 0) {
        const Vx = delayedVoltage(tInCycle, waves, 0)
        const Vy = delayedVoltage(tInCycle, waves, 90)
        const mag = Math.hypot(Vx, Vy)

        if (mag > 0.02) {
          const tipX = anchorX + Vx * SCALE
          const tipY = anchorY + Vy * SCALE
          ctx.strokeStyle = '#34d399'
          ctx.fillStyle = '#34d399'
          ctx.lineWidth = 2.5
          ctx.lineCap = 'round'
          ctx.shadowColor = '#34d399'
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.moveTo(anchorX, anchorY)
          ctx.lineTo(tipX, tipY)
          ctx.stroke()
          ctx.shadowBlur = 0

          const angle = Math.atan2(tipY - anchorY, tipX - anchorX)
          const hLen = 9
          ctx.beginPath()
          ctx.moveTo(tipX, tipY)
          ctx.lineTo(tipX - hLen * Math.cos(angle - 0.4), tipY - hLen * Math.sin(angle - 0.4))
          ctx.lineTo(tipX - hLen * Math.cos(angle + 0.4), tipY - hLen * Math.sin(angle + 0.4))
          ctx.closePath()
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(anchorX, anchorY, 3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(52,211,153,0.6)'
        ctx.fill()
      }

      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [clockRef, waves, cycleMs, width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none' }}
    />
  )
}

// ── 2E: Cardiac Vector Cycle ───────────────────────────────────────────────
// Owns its own clock + controls now that 2E is a standalone tab — it used
// to be silently driven by 2D's master clock (no controls of its own at
// all). Same useLocalClock hook 2C/2D use; this component was never
// internally rAF-driven anyway (it repaints via p5's redraw() whenever
// dataRef's effect fires), so swapping the time source in is a clean drop-in.
function VectorCycle({ rhythm }) {
  const cycleMs = rhythm.cycleMs || CYCLE_MS
  const waves = rhythm.waves
  const { tMs: currentTimeMs, isPlaying, toggle, scrub } = useLocalClock(cycleMs, rhythm.nativeCycleMs ?? null)
  const containerRef = useRef()
  const p5InstRef = useRef(null)
  const dataRef = useRef({ waves, cycleMs, currentTimeMs })

  // Update data then immediately trigger one draw — avoids rAF timing race
  useEffect(() => {
    dataRef.current = { waves, cycleMs, currentTimeMs }
    p5InstRef.current?.redraw()
  }, [waves, cycleMs, currentTimeMs])

  useEffect(() => {
    // RENDER_SCALE shrinks the actual rendered canvas without touching any
    // of the hand-placed layout constants below (VCX/VCY/VR/EX/EY/etc, W,
    // H — all stay the original 520×300 logical values every existing draw
    // call already uses). Only the real <canvas> pixel size (CW/CH) is
    // smaller; p.draw() wraps its body in p.scale(RENDER_SCALE) so the
    // logical-space drawing lands correctly on the smaller physical canvas
    // — same technique used in LeadPlacementLab for the same reason.
    const RENDER_SCALE = 0.8
    const W = 520, H = 300
    const CW = Math.round(W * RENDER_SCALE), CH = Math.round(H * RENDER_SCALE)
    const VCX = 115, VCY = 155, VR = 85
    const EX = 248, EW = 255, EY = 80, EH = 160

    const sketch = (p) => {
      let ECGCache = null
      let waveRegions = null

      const buildCache = (w, cm) => {
        if (!w || !cm) return []
        const N = 400
        return Array.from({ length: N }, (_, i) => ECGVoltage((i / N) * cm, cm, w, 60))
      }

      const buildRegions = (w, cm) => {
        if (!w) return []
        const regions = []
        const pWave = w.find(wv => wv.name === 'P')
        const qrsR = w.find(wv => wv.name === 'R')
        const tWave = w.find(wv => wv.name === 'T')
        if (pWave) {
          const s = pWave.center - pWave.sigma * 2.5
          const e = pWave.center + pWave.sigma * 2.5
          regions.push({ label: 'P', color: [59, 130, 246], start: Math.max(0, s), end: Math.min(cm, e) })
        }
        if (qrsR) {
          const s = qrsR.center - 60
          const e = qrsR.center + 60
          regions.push({ label: 'QRS', color: [139, 92, 246], start: Math.max(0, s), end: Math.min(cm || 800, e) })
        }
        if (tWave) {
          const s = tWave.center - tWave.sigma * 2.5
          const e = tWave.center + tWave.sigma * 2.5
          regions.push({ label: 'T', color: [245, 158, 11], start: Math.max(0, s), end: Math.min(cm || 800, e) })
        }
        return regions
      }

      p.setup = () => {
        const cnv = p.createCanvas(CW, CH)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        // Backing buffer must have enough real pixels for the CSS-stretched
        // display size (plus device pixel ratio) or the upscale looks blurry.
        const rectW = cnv.elt.getBoundingClientRect().width || CW
        const density = Math.min(3, Math.max(1, rectW / CW) * (window.devicePixelRatio || 1))
        p.pixelDensity(density)
        cnv.elt.style.width = '100%'
        cnv.elt.style.height = 'auto'
        cnv.elt.style.display = 'block'
        p.noLoop()  // driven by redraw() calls, not the internal 60fps loop
      }

      p.draw = () => {
        p.background(17, 24, 39)
        p.push()
        p.scale(RENDER_SCALE)
        const { waves: w, cycleMs: cm, currentTimeMs: tMs } = dataRef.current

        if (!ECGCache || ECGCache.length === 0) ECGCache = buildCache(w, cm)
        if (!waveRegions) waveRegions = buildRegions(w, cm)

        const Vx = (w && cm) ? ECGVoltage(tMs, cm, w, 0) : 0
        const Vy = (w && cm) ? ECGVoltage(tMs, cm, w, 90) : 0
        const mag = Math.sqrt(Vx * Vx + Vy * Vy)
        const angle = Math.atan2(Vy, Vx)

        // ── Left panel: Vector wheel ──
        p.noStroke()
        p.fill(22, 30, 46)
        p.rect(0, 0, 230, H)

        p.noStroke()
        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Cardiac Vector (frontal plane)', VCX, 20)

        // Limb lead axes (dashed)
        const leads = [
          { label: 'I',    angle: 0 },
          { label: 'II',   angle: Math.PI / 3 },
          { label: 'III',  angle: 2 * Math.PI / 3 },
          { label: 'aVR',  angle: -2 * Math.PI / 3 },
          { label: 'aVL',  angle: -Math.PI / 3 },
          { label: 'aVF',  angle: Math.PI / 2 },
        ]
        leads.forEach(({ label, angle: la }) => {
          p.stroke(45, 55, 72)
          p.strokeWeight(0.8)
          p.drawingContext.setLineDash([3, 3])
          const ex = VCX + Math.cos(la) * VR, ey = VCY + Math.sin(la) * VR
          const sx = VCX - Math.cos(la) * VR, sy = VCY - Math.sin(la) * VR
          p.line(sx, sy, ex, ey)
          p.drawingContext.setLineDash([])
          p.noStroke()
          p.fill(75, 85, 99)
          p.textSize(7)
          p.textAlign(p.CENTER)
          const lx = VCX + Math.cos(la) * (VR + 12), ly = VCY + Math.sin(la) * (VR + 12)
          p.text(label, lx, ly + 2)
        })

        // Wheel circle
        p.noFill()
        p.stroke(40, 50, 65)
        p.strokeWeight(0.8)
        p.circle(VCX, VCY, VR * 2)

        // Lead I projection (blue dashed on x-axis)
        const projLen = Vx * VR  // dot with unit [1,0]
        p.stroke(59, 130, 246, 120)
        p.strokeWeight(1)
        p.drawingContext.setLineDash([2, 2])
        p.line(VCX + projLen, VCY - 6, VCX + projLen, VCY + 6)
        p.line(VCX, VCY, VCX + projLen, VCY)
        p.drawingContext.setLineDash([])

        // Cardiac vector arrow
        if (mag > 0.005) {
          const VSCALE = VR * 1.0
          const ax = Math.cos(angle) * mag * VSCALE
          const ay = Math.sin(angle) * mag * VSCALE
          p.stroke(52, 211, 153)
          p.strokeWeight(2.2)
          p.line(VCX, VCY, VCX + ax, VCY + ay)
          const hLen = 8
          p.fill(52, 211, 153)
          p.noStroke()
          p.triangle(
            VCX + ax, VCY + ay,
            VCX + ax - hLen * Math.cos(angle - 0.4), VCY + ay - hLen * Math.sin(angle - 0.4),
            VCX + ax - hLen * Math.cos(angle + 0.4), VCY + ay - hLen * Math.sin(angle + 0.4)
          )
        }
        // Mean QRS axis arrow — bold, bright yellow, distinct from the
        // rotating emerald instantaneous vector above.
        if (w && w.length > 0) {
          const { angleDeg: meanAngle, leadINet, leadAVFNet } = meanQRSAxis(w)
          const meanMag = Math.min(1, Math.hypot(leadINet, leadAVFNet))
          const meanRad = (meanAngle * Math.PI) / 180
          const max = Math.cos(meanRad) * meanMag * VR
          const may = Math.sin(meanRad) * meanMag * VR
          p.stroke(250, 204, 21)
          p.strokeWeight(3.5)
          p.line(VCX, VCY, VCX + max, VCY + may)
          const mhLen = 9
          p.fill(250, 204, 21)
          p.noStroke()
          p.triangle(
            VCX + max, VCY + may,
            VCX + max - mhLen * Math.cos(meanRad - 0.4), VCY + may - mhLen * Math.sin(meanRad - 0.4),
            VCX + max - mhLen * Math.cos(meanRad + 0.4), VCY + may - mhLen * Math.sin(meanRad + 0.4)
          )
          p.fill(250, 204, 21)
          p.textSize(7)
          p.textAlign(p.CENTER)
          p.text(`Mean QRS Axis ${meanAngle >= 0 ? '+' : ''}${meanAngle.toFixed(0)}°`, VCX, VCY + VR + 16)
        }

        p.fill(200, 200, 200)
        p.noStroke()
        p.circle(VCX, VCY, 5)

        // ── Right panel: ECG strip (Lead II) ──
        p.noStroke()
        p.fill(22, 30, 46)
        p.rect(235, 0, W - 235, H)

        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Lead II ECG', EX + EW / 2, 20)

        // Wave region shading
        if (waveRegions) {
          waveRegions.forEach(({ label, color, start, end }) => {
            const rx = EX + (start / (cm || CYCLE_MS)) * EW
            const rw = ((end - start) / (cm || CYCLE_MS)) * EW
            p.fill(color[0], color[1], color[2], 30)
            p.noStroke()
            p.rect(rx, EY, rw, EH)
            p.fill(color[0], color[1], color[2], 150)
            p.textSize(7)
            p.textAlign(p.CENTER)
            p.text(label, rx + rw / 2, EY + 10)
          })
        }

        // ECG grid
        p.stroke(40, 50, 65)
        p.strokeWeight(0.5)
        p.line(EX, EY, EX + EW, EY)
        p.line(EX, EY + EH, EX + EW, EY + EH)
        p.line(EX, EY + EH / 2, EX + EW, EY + EH / 2)
        p.strokeWeight(0.4)
        for (let xi = 0; xi <= 4; xi++) {
          p.line(EX + xi * EW / 4, EY, EX + xi * EW / 4, EY + EH)
        }

        // ECG curve
        if (ECGCache && ECGCache.length > 0) {
          const maxV = Math.max(...ECGCache.map(Math.abs)) || 1
          p.stroke(52, 211, 153)
          p.strokeWeight(1.8)
          p.noFill()
          p.beginShape()
          const f0 = ECGCache[0]
          p.vertex(EX, EY + EH / 2 - (f0 / maxV) * (EH / 2 - 8))
          ECGCache.forEach((v, i) => {
            const px = EX + (i / ECGCache.length) * EW
            const py = EY + EH / 2 - (v / maxV) * (EH / 2 - 8)
            p.vertex(px, py)
          })
          const fn = ECGCache[ECGCache.length - 1]
          p.vertex(EX + EW, EY + EH / 2 - (fn / maxV) * (EH / 2 - 8))
          p.endShape()
        }

        // Current time marker
        const markerX = EX + ((tMs % (cm || CYCLE_MS)) / (cm || CYCLE_MS)) * EW
        p.stroke(250, 250, 250, 130)
        p.strokeWeight(1)
        p.drawingContext.setLineDash([3, 3])
        p.line(markerX, EY, markerX, EY + EH)
        p.drawingContext.setLineDash([])

        // T-wave annotation
        p.noStroke()
        p.fill(103, 232, 249)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('T wave: repol travels epi→endo', EX + EW / 2, EY + EH + 18)
        p.text('→ same polarity as QRS in Lead I/II', EX + EW / 2, EY + EH + 28)

        // Time readout
        p.fill(75, 85, 99)
        p.textSize(7)
        p.textAlign(p.LEFT)
        p.text(`t = ${Math.round(tMs)} ms`, EX, H - 8)
        p.pop()
      }
    }

    const container = containerRef.current
    if (!container) return
    let inst
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return
      while (container.firstChild) container.removeChild(container.firstChild)
      inst = new p5(sketch, container)
      p5InstRef.current = inst
    })
    return () => {
      cancelAnimationFrame(rafId)
      p5InstRef.current = null
      if (inst) { try { inst.remove() } catch (_) {} }
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])  // mount once — data comes in via dataRef + redraw()

  return (
    <div>
      <CanvasWrap containerRef={containerRef}>
        <SimBar>
          <span>Left: cardiac vector rotating through P-QRS-T · Right: Lead II strip with current position marker</span>
        </SimBar>
      </CanvasWrap>
      <div className="flex items-center gap-3 flex-wrap mt-3">
        <button
          onClick={toggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => scrub(0)}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Reset
        </button>
        <input
          type="range"
          min={0}
          max={cycleMs}
          value={Math.round(currentTimeMs)}
          onChange={e => scrub(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-cyan-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-20">{Math.round(currentTimeMs)} / {cycleMs} ms</span>
      </div>
    </div>
  )
}

const MODULE2_TABS = [
  { id: '2A', label: '2A · Anatomy' },
  { id: '2B', label: '2B · AP by Cell Type' },
  { id: '2C', label: '2C · AP vs ECG' },
  { id: '2D', label: '2D · Conduction Animation' },
  { id: '2E', label: '2E · Vector Cycle' },
]

// ── Main export ────────────────────────────────────────────────────────────
export default function CardiacBridge() {
  const rhythm = useMemo(() => {
    try {
      return buildRhythmFromParams(DEFAULT_RHYTHM_PARAMS)
    } catch {
      return { waves: [], cycleMs: CYCLE_MS, nativeCycleMs: null }
    }
  }, [])

  const axis = useMemo(() => meanQRSAxis(rhythm.waves), [rhythm.waves])

  const [selected2A, setSelected2A] = useState(null)

  const { active, setActive } = useTabState(MODULE2_TABS.map(t => t.id))
  // Tabs now render as a sub-menu in the sidebar (see Sidebar.jsx) instead
  // of an in-page pill bar — this just publishes the same state there.
  usePublishTabs('cardiac', MODULE2_TABS, { active, setActive })

  return (
    <ModulePage
      moduleId="cardiac"
      number={2}
      title="Cardiac electrophysiology"
      wide={active === '2B'}
    >
      {active === '2A' && (
        <Section
          label="2A"
          title="Heart Anatomy Overview"
          subtitle="Hover or click any structure to see its primary function, electrical behavior, and ECG correlation."
        >
          <AnatomyDiagram selected={selected2A} onSelect={setSelected2A} />
          <Callout>
            The SA node is the heart's primary pacemaker — it fires spontaneously without any external trigger.
            The AV node imposes a deliberate 120–200 ms delay (the PR segment) that allows ventricular filling
            before systole. The His-Purkinje system then accelerates conduction to near-simultaneous ventricular
            activation, producing the narrow (&lt;100 ms) QRS complex.
          </Callout>
        </Section>
      )}

      {active === '2B' && (
        <Section
          label="2B"
          title="Action Potentials by Cell Type"
          subtitle="Three fundamentally different action potential shapes — each explained by different ion channel composition. Hover any phase region to see which channels are open and what they do."
        >
          <LiveActionPotentials />
          <Callout>
            SA node and AV node use <strong>slow-response</strong> action potentials (ICa-L upstroke, ~0.05 m/s).
            Atrial and ventricular myocytes use <strong>fast-response</strong> (INa upstroke, 1 m/s).
            Purkinje fibers have the fastest upstroke (highest dV/dt), longest plateau, and act as tertiary
            pacemakers (20–40 bpm) if SA and AV nodes both fail.
          </Callout>
        </Section>
      )}

      {active === '2C' && (
        <Section
          label="2C"
          title="What Does the ECG Actually Record?"
          subtitle="An intracellular electrode measures voltage across one cell's membrane. The ECG measures voltage differences between body surface electrodes. Drag the electrode into a region to compare its action potential with the simultaneous ECG trace."
        >
          <ECGVsAPSection rhythm={rhythm} />
        </Section>
      )}

      {active === '2D' && (
        <Section
          label="2D"
          title="Conduction Animation"
          subtitle="Watch depolarization propagate through the conduction system in real time. Use the scrubber to move to any point in the cardiac cycle, and toggle the cardiac vector to see the net dipole this wavefront produces at each instant."
        >
          <ConductionSection rhythm={rhythm} />
          <Callout>
            The AV node is the rate-limiting step at 0.05 m/s — 20× slower than atrial muscle.
            Once past the AV node, the His-Purkinje system accelerates conduction 40–80× faster than myocardium,
            delivering simultaneous endocardial activation across both ventricles.
          </Callout>
          <Callout>
            The boundary between depolarized and resting tissue creates a dipole vector — identical to the
            dipole model from Module 1. During QRS, the depolarization wavefront sweeps left and inferiorly
            (toward the dominant LV mass), which is why the normal axis is +60°. During repolarization (T wave),
            the wave travels epicardium→endocardium (opposite to depolarization), but still produces the same
            polarity deflection in most leads because the gradient is reversed.
          </Callout>
        </Section>
      )}

      {active === '2E' && (
        <Section
          label="2E"
          title="Cardiac Vector Cycle"
          subtitle="The cardiac vector rotates through different angles during P, QRS, and T. The projection onto each lead axis determines that lead's deflection — positive projection → upward deflection."
        >
          <VectorCycle rhythm={rhythm} />
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 mb-3 mt-3">
            <AxisSummaryPanel angleDeg={axis.angleDeg} leadIMm={axis.leadIMm} leadAVFMm={axis.leadAVFMm} />
          </div>
          <Callout>
            Lead II (60°) is aligned with the normal axis and shows the tallest P wave and R wave.
            Lead I (0°) projects the leftward component. aVR (−150°) is always negative in a normal heart
            because the main QRS vector points away from it. The T wave in most leads has the same polarity
            as the QRS because repolarization proceeds epicardium→endocardium (the same net direction).
          </Callout>
        </Section>
      )}
    </ModulePage>
  )
}


// Adapted from Jacob Walker’s original sections 2C and 2E.
export function RecordingsPage() {
  const rhythm = useMemo(() => buildRhythmFromParams(DEFAULT_RHYTHM_PARAMS), [])
  return (
    <ModulePage number={1} title="Introduction"
      description="Compare a recording across one cell’s membrane with a simultaneous body surface voltage difference. Pause or scrub through the cycle to investigate why the recordings look different.">
      <ECGVsAPSection rhythm={rhythm} />
    </ModulePage>
  )
}

export function VectorCyclePage() {
  const rhythm = useMemo(() => buildRhythmFromParams(DEFAULT_RHYTHM_PARAMS), [])
  const axis = useMemo(() => meanQRSAxis(rhythm.waves), [rhythm])
  return (
    <ModulePage title="Vector Cycle"
      description="Advanced exploration for a later activity. Follow the changing cardiac vector and its projections throughout P, QRS, and T.">
      <VectorCycle rhythm={rhythm} />
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 mt-3">
        <AxisSummaryPanel angleDeg={axis.angleDeg} leadIMm={axis.leadIMm} leadAVFMm={axis.leadAVFMm} />
      </div>
    </ModulePage>
  )
}
