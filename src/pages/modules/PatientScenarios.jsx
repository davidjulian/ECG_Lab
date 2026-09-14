import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { readProgress, writeProgress } from '../../lib/localProgress'
import ModulePage from '../../components/ModulePage'
import {
  RHYTHMS, RHYTHM_PRESETS, complexWaves,
  ECGVoltage, LEADS,
} from '../../lib/ECGEngine'

// ── Strip canvas config ───────────────────────────────────────────────────────
// Shortened from the original 820×150 — all grid/trace drawing below is a
// pure function of the w/h passed in, so this needed no other changes.
const SW = 760, SH = 115
const PX_MS = 0.20
const PX_MV = 60
const BL = 0.58
const EMERALD     = '#10b981'
const GRID_MINOR  = 'rgba(16,185,129,0.07)'
const GRID_MAJOR  = 'rgba(16,185,129,0.18)'
const LEAD_AXIS   = LEADS.II.axisDeg

// ── Custom rhythm builders ────────────────────────────────────────────────────

// Sinus arrhythmia: normal P-QRS-T morphology, varying RR driven by respiration
function buildSinusArrhythmia() {
  const template = complexWaves(RHYTHM_PRESETS.normalSinus)
  const rrSeq = [780, 920, 1050, 970, 830, 760, 900, 1040, 880]
  const waves = []
  let t = 0
  for (const rr of rrSeq) {
    waves.push(...template.map(w => ({ ...w, center: w.center + t })))
    t += rr
  }
  return { waves, cycleMs: t, heartRateBpm: 67 }
}

// Atrial flutter with variable (2:1 and 3:1) block → irregular ventricular rate ~109bpm
// Gaussian params manually derived from layoutComplex(qrsDuration=75, qtInterval=310)
function buildVariableFlutter() {
  const cycleMs = 2200
  const waves = []

  // Sawtooth flutter waves every 200 ms (300 bpm)
  for (let t = 0; t < cycleMs; t += 200) {
    waves.push({ name: 'F', amplitude:  0.15, center: t + 20, sigma: 12, axisDeg: -15 })
    waves.push({ name: 'F', amplitude: -0.13, center: t + 55, sigma: 14, axisDeg: -15 })
  }

  // QRS-T at 2:1, 2:1, 2:1, 3:1 → onsets 400, 800, 1200, 1800 ms
  // RR intervals: 400, 400, 600 → avg HR ≈ 109 bpm, irregular
  for (const onset of [400, 800, 1200, 1800]) {
    waves.push(
      { name: 'Q', amplitude: -0.10, center: onset + 16, sigma:  7, axisDeg: 60 },
      { name: 'R', amplitude:  1.10, center: onset + 36, sigma: 12, axisDeg: 60 },
      { name: 'S', amplitude: -0.20, center: onset + 60, sigma:  9, axisDeg: 60 },
      { name: 'T', amplitude:  0.25, center: onset + 245, sigma: 33, axisDeg: 45 },
    )
  }
  return { waves, cycleMs, heartRateBpm: 109 }
}

// ── Case data ─────────────────────────────────────────────────────────────────
const CASES = [
  {
    id: 'case1',
    title: 'Case 1',
    priority: 'required',
    category: 'Atrial Fibrillation',
    rhythmId: 'atrialFibrillation',
    scaffolded: true,
    hints: [
      'Start by identifying P waves — are they present? Are they regular?',
      'Look at the baseline between QRS complexes. Do you see organized waves, or a chaotic low-amplitude tremor?',
      'Now measure the RR intervals — are they regular or irregular?',
      'A rhythm with no P waves, irregularly irregular RR intervals, and a chaotic fibrillatory baseline — what does that point to?',
    ],
    hpi: {
      age: 68, sex: 'F',
      complaint: 'Palpitations and fatigue × 3 months',
      pmh: 'Hypertension, type 2 diabetes',
      meds: 'Lisinopril 10 mg daily, metformin 500 mg BID',
      vitals: 'BP 128/82 · HR irregular ~90 bpm · RR 16 · SpO₂ 98%',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'Which physiological change in the conduction system best explains this pattern?',
        options: ['Normal sinus rhythm', 'Atrial fibrillation', 'Atrial flutter (2:1)', 'Multifocal atrial tachycardia'],
        correct: 1,
      },
      {
        id: 'q2', type: 'mcq',
        stem: 'Which best describes the atrial activity visible on this strip?',
        options: [
          'Regular P waves at 300 bpm with a sawtooth pattern',
          'No identifiable P waves — chaotic low-amplitude fibrillatory baseline',
          'Absent P waves with a flat isoelectric baseline',
          'Inverted P waves following each QRS complex',
        ],
        correct: 1,
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'Which structure produces the irregular ventricular response in this rhythm?',
        options: [
          'SA node — firing irregularly under vagal influence',
          'AV node — randomly filtering chaotic atrial impulses based on its refractory state',
          'Bundle of His — intermittent infranodal block',
          'Purkinje fibers — random re-entry at the fascicular level',
        ],
        correct: 1,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'What is the underlying electrophysiological mechanism of this arrhythmia?',
        options: [
          'Enhanced automaticity of a single ectopic atrial focus firing at 350–600 bpm',
          'Delayed afterdepolarizations triggering triggered activity in the atria',
          'Multiple simultaneous reentrant wavelets circulating through the atrial myocardium',
          'Increased vagal tone suppressing the SA node and creating a junctional escape',
        ],
        correct: 2,
      },
      {
        id: 'q5', type: 'mcq',
        stem: "This patient's cardiologist is concerned about stroke risk. What is the primary mechanism linking this rhythm to thromboembolism?",
        options: [
          'Increased blood pressure causing arterial endothelial injury',
          'Blood stasis in the left atrial appendage due to absent coordinated atrial contraction',
          'Hypercoagulable state from systemic inflammation',
          'Direct thrombus formation on the surface of the AV node',
        ],
        correct: 1,
      },
    ],
    explanation: `Atrial fibrillation arises from chaotic electrical activity — multiple simultaneous reentrant wavelets circling through the atrial myocardium at 350–600 per minute. No single wavefront propagates coherently, so no organized P wave forms; instead, the baseline shows low-amplitude fibrillatory undulations.\n\nThe AV node acts as a gatekeeper, randomly filtering these chaotic impulses. Because conduction depends on which impulses arrive when the AV node is not refractory, the ventricular response is irregularly irregular — the hallmark of AF.\n\nRecall that normal atrial contraction squeezes blood from the atria into the ventricles just before the QRS (the "atrial kick"). In AF, this coordinated contraction is lost. Blood pools in the left atrial appendage — a small muscular pouch off the left atrium — and can form clots. If a clot embolizes to the cerebral circulation, stroke results. This is why anticoagulation is the cornerstone of AF management.`,
  },

  {
    id: 'case2',
    title: 'Case 2',
    priority: 'required',
    category: '3rd-Degree AV Block',
    rhythmId: 'thirdDegreeBlock',
    scaffolded: false,
    hints: [],
    hpi: {
      age: 45, sex: 'M',
      complaint: 'Found unresponsive by coworkers',
      pmh: 'None known; no prior cardiac history',
      meds: 'None',
      vitals: 'BP 88/60 · HR 32 bpm on monitor · RR 6 (agonal) · SpO₂ 82% on room air',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'Which physiological change in the conduction system best explains this pattern?',
        options: [
          'Sinus bradycardia with first-degree AV block',
          'Second-degree AV block, Mobitz Type II',
          'Third-degree (complete) AV block with ventricular escape',
          'Accelerated junctional rhythm',
        ],
        correct: 2,
      },
      {
        id: 'q2', type: 'numeric',
        stem: 'What is the ventricular rate? (bpm)',
        correct: 32,
        tolerance: 5,
        unit: 'bpm',
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'The QRS complexes are wide and bizarre. What is the correct explanation?',
        options: [
          'The AV node is conducting with a severely prolonged delay',
          'The escape impulse originates in ventricular muscle below the Bundle of His, spreading cell-to-cell and bypassing the His-Purkinje system',
          'Left bundle branch block has developed simultaneously',
          'The patient is receiving antiarrhythmic drugs that widen the QRS',
        ],
        correct: 1,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'What is the relationship between P waves and QRS complexes in this tracing?',
        options: [
          'Each P wave is followed by a QRS after a constant PR interval',
          'P waves march on independently at ~75 bpm; QRS complexes march independently at ~32 bpm — no fixed relationship (AV dissociation)',
          'Every other P wave conducts; the PR interval on conducted beats is constant',
          'PR interval progressively lengthens until a QRS is dropped, then resets',
        ],
        correct: 1,
      },
      {
        id: 'q5', type: 'mcq',
        stem: 'If this patient received IV atropine (a vagolytic), what would most likely happen?',
        options: [
          'Ventricular rate would increase to 70–80 bpm — atropine restores AV conduction',
          'P wave rate (sinus rate) would increase, but the ventricular escape rate would not change significantly',
          'Both atrial and ventricular rates would increase equally',
          'No effect whatsoever — atropine only works in sinus rhythm',
        ],
        correct: 1,
      },
    ],
    explanation: `Third-degree (complete) AV block means no atrial impulse can cross the AV node. The atria and ventricles beat completely independently — AV dissociation in its most extreme form.\n\nThe SA node continues firing at its intrinsic rate (~75 bpm), generating normal P waves that march through the tracing on their own schedule. Below the block, a subsidiary pacemaker takes over. When this escape rhythm originates in the ventricular myocardium (idioventricular escape, 20–40 bpm), it is far slower than junctional (~50 bpm) or fascicular (~40 bpm) escapes.\n\nRecall that the normal conduction sequence routes impulses through the Bundle of His → bundle branches → Purkinje fibers, activating ventricular muscle nearly simultaneously. When the escape pacemaker fires from ventricular muscle directly, it spreads impulse cell-to-cell — much slower, and in an abnormal direction. The result is a wide (here >160 ms), bizarrely shaped QRS with a discordant T wave.\n\nAtropine blocks vagal tone at the SA and AV nodes, accelerating sinus rate. But the ventricular escape pacemaker has no significant vagal innervation — atropine does not reliably speed it up. Definitive treatment is transvenous pacing followed by permanent pacemaker implantation.`,
  },

  {
    id: 'case3',
    title: 'Case 3',
    priority: 'extension',
    category: 'Mobitz II (2:1 Block)',
    rhythmId: 'mobitzII',
    scaffolded: false,
    hints: [],
    hpi: {
      age: 72, sex: 'F',
      complaint: 'Lightheadedness and one syncopal episode at home this morning',
      pmh: 'Hypertension, prior anterior MI 8 years ago',
      meds: 'Aspirin 81 mg daily, atorvastatin 40 mg, metoprolol succinate 25 mg BID',
      vitals: 'BP 102/68 · HR 48 bpm · RR 14 · SpO₂ 97%',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'What is the rhythm?',
        options: [
          'Sinus bradycardia with a prolonged PR interval',
          'First-degree AV block',
          'Second-degree AV block, Mobitz Type II (2:1)',
          'Second-degree AV block, Mobitz Type I (Wenckebach)',
        ],
        correct: 2,
      },
      {
        id: 'q2', type: 'mcq',
        stem: 'Describe the PR interval on this strip.',
        options: [
          'Fixed and constant on all conducted beats — no lengthening before the dropped QRS',
          'Progressively lengthens until a QRS is dropped, then resets',
          'Short (< 120 ms) — suggesting an accessory pathway',
          'There is no measurable PR interval because P waves are absent',
        ],
        correct: 0,
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'At which anatomical level does the block in Mobitz II typically occur?',
        options: [
          'Sinus node',
          'AV node (suprahisian)',
          'Bundle of His or bundle branches (infranodal)',
          'Distal Purkinje fiber network',
        ],
        correct: 2,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'How does Mobitz II differ from Mobitz I (Wenckebach)?',
        options: [
          'Mobitz I has a fixed PR; Mobitz II shows progressive PR lengthening',
          'Mobitz II has a fixed PR with sudden dropped QRS; Mobitz I has progressive PR lengthening before the dropped beat',
          'They are identical patterns — the distinction is clinical, not electrocardiographic',
          'Mobitz I always has a wide QRS; Mobitz II always has a narrow QRS',
        ],
        correct: 1,
      },
      {
        id: 'q5', type: 'mcq',
        stem: 'Why is Mobitz II considered more dangerous than Mobitz I?',
        options: [
          'It produces a faster ventricular rate, increasing myocardial oxygen demand',
          'It can progress suddenly to complete heart block without warning, and the infranodal escape is slower and less reliable than a junctional escape',
          'It is more common in young patients who have higher metabolic demands',
          'It always causes immediate hemodynamic collapse requiring CPR',
        ],
        correct: 1,
      },
    ],
    explanation: `Mobitz II second-degree AV block is defined by a fixed PR interval on all conducted beats, with sudden — unpredictable — failure of a P wave to conduct. In 2:1 block, every other P wave is blocked.\n\nThe critical distinction from Wenckebach (Mobitz I): in Wenckebach, the AV node progressively fatigues with each beat (PR lengthens) until one P wave fails, then the cycle resets. This reflects AV nodal disease and is relatively benign. In Mobitz II, conduction is all-or-nothing — conducted beats traverse a functioning AV node, but the block occurs lower, at the Bundle of His or bundle branches. This is why the QRS is often slightly wide (bundle branch level involvement).\n\nRecall that the infranodal conduction system — His bundle, fascicles, Purkinje network — has a much less reliable intrinsic rate (<30–40 bpm) than the AV node (~50 bpm). If Mobitz II deteriorates to complete block, the resulting escape is dangerously slow. This patient's prior anterior MI is relevant: the LAD supplies the bundle branches, and fibrotic degeneration years after infarction is a classic cause of late infranodal block. Pacemaker implantation is the definitive treatment.`,
  },

  {
    id: 'case4',
    title: 'Case 4',
    priority: 'extension',
    category: 'Sinus Arrhythmia',
    rhythmBuilder: buildSinusArrhythmia,
    scaffolded: false,
    hints: [],
    hpi: {
      age: 19, sex: 'M',
      complaint: 'Incidental finding on pre-participation sports physical — completely asymptomatic',
      pmh: 'None; competitive swimmer for 7 years',
      meds: 'None',
      vitals: 'BP 112/68 · HR varies 52–68 bpm with breathing · RR 14 · SpO₂ 99%',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'What is the rhythm?',
        options: [
          'Atrial fibrillation',
          'Multifocal atrial tachycardia',
          'Sinus arrhythmia — normal physiological variant',
          'Sick sinus syndrome',
        ],
        correct: 2,
      },
      {
        id: 'q2', type: 'mcq',
        stem: 'Which feature of the P waves distinguishes this rhythm from atrial fibrillation?',
        options: [
          'P waves are absent in sinus arrhythmia',
          'P waves are present, uniform in morphology, and each precedes a QRS with a fixed PR interval',
          'P waves are present but inverted (retrograde) in all leads',
          'P waves vary in morphology with each beat, indicating multiple competing foci',
        ],
        correct: 1,
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'What physiological mechanism causes the RR interval variation?',
        options: [
          'Intermittent AV nodal block blocking some P waves',
          'Ectopic atrial foci competing with the SA node on alternate beats',
          'Respiratory modulation of vagal tone — heart rate increases with inspiration, decreases with expiration',
          'Variations in stroke volume causing reflex baroreceptor-mediated SA node rate changes',
        ],
        correct: 2,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'Which structure is the primary pacemaker in this rhythm?',
        options: [
          'AV node — the SA node is intermittently suppressed',
          'SA node — the rate variation reflects normal autonomic modulation, not SA node dysfunction',
          'An ectopic atrial focus with rate-dependent firing',
          'Bundle of His — junctional escape with variable exit block',
        ],
        correct: 1,
      },
      {
        id: 'q5', type: 'mcq',
        stem: 'What is the most appropriate management for this asymptomatic 19-year-old athlete?',
        options: [
          'Refer to electrophysiology for mapping and ablation',
          'Start a beta-blocker to regularize the heart rate before he competes',
          'Admit for telemetry monitoring and a 24-hour Holter study',
          'Reassurance — sinus arrhythmia is a normal physiological variant, especially in young athletes with high vagal tone',
        ],
        correct: 3,
      },
    ],
    explanation: `Sinus arrhythmia is a physiological variation in heart rate driven by respiration. During inspiration, intrathoracic pressure falls, venous return increases, and — through the Bainbridge reflex and reduced vagal tone — the SA node speeds up slightly. During expiration, vagal tone increases and the rate slows.\n\nThe diagnostic key: P waves are present, morphologically uniform, and each is followed by a QRS with a constant PR interval. The SA node is the pacemaker throughout — only its rate varies. This is fundamentally different from atrial fibrillation (no organized P waves, randomly irregular RR) or sick sinus syndrome (true pauses or arrest).\n\nSinus arrhythmia is especially prominent in young, well-conditioned athletes because chronic aerobic training increases resting vagal tone. High vagal tone slows the basal sinus rate; when inspiration transiently withdraws that tone, the rate acceleration is more dramatic on this high-vagal baseline — producing more obvious RR variation.\n\nRecall that the SA node's intrinsic rate is continuously sculpted by autonomic input. Sinus arrhythmia is the normal result of that sculpting. No treatment is indicated; clearing this athlete to compete is appropriate.`,
  },

  {
    id: 'case5',
    title: 'Case 5',
    priority: 'extension',
    category: 'NSR with PVCs / R-on-T',
    rhythmId: 'pvcs',
    scaffolded: false,
    hints: [],
    hpi: {
      age: 55, sex: 'M',
      complaint: 'Acute chest pain radiating to jaw, diaphoresis, "skipped beats" felt; patient is anxious',
      pmh: 'Hypertension, hyperlipidemia; 40 pack-year smoking history',
      meds: 'Amlodipine 5 mg daily',
      vitals: 'BP 158/94 · HR ~78 bpm with irregular beats · RR 20 · SpO₂ 96% · diaphoretic',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'What are the abnormal complexes interspersed in the sinus rhythm?',
        options: [
          'Premature atrial contractions (PACs) — different P wave, normal QRS',
          'Aberrantly conducted sinus beats — normal P wave, wide QRS',
          'Premature ventricular contractions (PVCs) — no preceding P wave, wide bizarre QRS',
          'Junctional escape beats — retrograde P wave, narrow QRS',
        ],
        correct: 2,
      },
      {
        id: 'q2', type: 'mcq',
        stem: 'One PVC fires during the T wave of the preceding sinus beat. Why is this particularly dangerous?',
        options: [
          'It causes immediate complete heart block by depolarizing the AV node during its refractory period',
          'R-on-T phenomenon — the PVC occurs during the vulnerable period of ventricular repolarization, potentially triggering ventricular fibrillation',
          'It causes the SA node to reset and fire at a dramatically faster rate',
          'It permanently prolongs the QT interval, increasing future arrhythmia risk',
        ],
        correct: 1,
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'Why are the PVC QRS complexes wide (> 120 ms) with an abnormal morphology?',
        options: [
          'AV nodal conduction is delayed during PVCs due to decremental conduction',
          'The ectopic impulse originates in ventricular muscle and spreads cell-to-cell, bypassing the fast His-Purkinje conduction system',
          'Bundle branch block develops transiently during each PVC due to rate-dependent aberrancy',
          'The PVC fires during the refractory period of both bundle branches simultaneously',
        ],
        correct: 1,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'What is the pause following each PVC, and why does it occur?',
        options: [
          'Non-compensatory pause — retrograde conduction resets the SA node, which must then re-fire',
          'Fully compensatory pause — the SA node fires on schedule, but the ventricle is still refractory from the PVC; the next sinus beat arrives exactly 2 × the normal RR interval after the beat before the PVC',
          'Sinus arrest — the SA node stops briefly after sensing the PVC via mechano-electrical feedback',
          'Post-extrasystolic pause — caused by reflex vagal activation from the premature beat',
        ],
        correct: 1,
      },
      {
        id: 'q5', type: 'mcq',
        stem: "In the context of this patient's acute chest pain, what is the primary clinical concern regarding these PVCs?",
        options: [
          'PVCs confirm the chest pain is non-cardiac in origin',
          'PVCs in the setting of acute MI — especially R-on-T — carry elevated risk of degenerating to ventricular fibrillation',
          'PVCs will self-terminate once the pain is controlled with nitrates',
          'All patients with acute chest pain and PVCs require immediate lidocaine infusion',
        ],
        correct: 1,
      },
    ],
    explanation: `Premature ventricular contractions (PVCs) arise from an ectopic focus in the ventricular myocardium, firing before the next expected sinus beat. Because the impulse originates in muscle — not the specialized conduction system — it spreads slowly cell-to-cell, producing a wide (> 120 ms), bizarrely shaped QRS with a discordant T wave. Recall that the normal sequence (His → bundle branches → Purkinje → muscle) produces a narrow QRS because all ventricular regions are activated nearly simultaneously; an ectopic ventricular focus produces the opposite.\n\nAfter the PVC, the ventricle is refractory. The next SA node impulse arrives on its normal schedule but cannot conduct — the myocardium is still depolarized from the PVC. The next-after-that sinus beat arrives normally, creating a pause equal to exactly 2 × the normal RR interval: the fully compensatory pause. (If there were retrograde conduction resetting the sinus node, the pause would be non-compensatory and shorter.)\n\nThe R-on-T phenomenon occurs when a PVC fires during the T wave — specifically the ascending limb (the relative refractory period, corresponding to phase 3 of the action potential). During this window, some cells have repolarized enough to accept a new impulse while adjacent cells haven't, creating the conditions for reentry and ventricular fibrillation. In a structurally normal heart, R-on-T rarely causes VF. In the setting of acute MI — as with this patient — ischemic myocardium has heterogeneous action potential durations, dramatically widening this vulnerable window and increasing R-on-T risk of triggering VF. Continuous monitoring, IV access, and rapid revascularization are the priorities.`,
  },

  {
    id: 'case6',
    title: 'Case 6',
    priority: 'extension',
    category: 'Atrial Flutter (Variable Block)',
    rhythmBuilder: buildVariableFlutter,
    scaffolded: false,
    hints: [],
    hpi: {
      age: 80, sex: 'F',
      complaint: 'Progressive exertional dyspnea over 2 weeks, now present at rest; mild palpitations',
      pmh: "Graves disease (treated with radioiodine 12 years ago), hypertension, prior PE",
      meds: 'Warfarin 5 mg daily, lisinopril 5 mg daily',
      vitals: 'BP 118/74 · HR ~110 bpm and irregular · RR 22 · SpO₂ 94% · mild bilateral crackles on auscultation',
    },
    questions: [
      {
        id: 'q1', type: 'mcq',
        stem: 'What is the rhythm?',
        options: [
          'Atrial fibrillation with rapid ventricular response',
          'Atrial flutter with variable AV block',
          'Multifocal atrial tachycardia',
          'Sinus tachycardia with frequent PACs causing irregular baseline',
        ],
        correct: 1,
      },
      {
        id: 'q2', type: 'numeric',
        stem: 'What is the atrial (flutter wave) rate? (bpm)',
        correct: 300,
        tolerance: 25,
        unit: 'bpm',
      },
      {
        id: 'q3', type: 'mcq',
        stem: 'What is the anatomical basis of the sawtooth flutter wave pattern?',
        options: [
          'Rapid synchronized firing of multiple ectopic atrial foci at the same rate',
          'A macroreentrant circuit rotating around the tricuspid annulus in the right atrium (cavotricuspid isthmus-dependent flutter)',
          'Retrograde conduction from the AV node back into the atria at high frequency',
          'Simultaneous P wave and T wave fusion at fast rates',
        ],
        correct: 1,
      },
      {
        id: 'q4', type: 'mcq',
        stem: 'This patient has a history of Graves disease. How does hyperthyroidism predispose to atrial arrhythmias?',
        options: [
          'Hypothyroidism lengthens atrial refractory periods, preventing reentry from terminating',
          'Hyperthyroidism increases sympathetic tone and shortens atrial refractory periods, making reentrant circuits easier to initiate and sustain',
          'Thyroid hormone directly suppresses the AV node, causing flutter by default',
          'Hyperthyroidism causes hypokalemia, which prolongs the QT interval and triggers flutter',
        ],
        correct: 1,
      },
      {
        id: 'q5', type: 'mcq',
        stem: 'The ventricular rate is ~110 bpm and irregular despite a perfectly regular atrial flutter rate of 300 bpm. What explains the irregular ventricular response?',
        options: [
          'The SA node fires irregularly in atrial flutter, producing an irregular atrial rhythm',
          'Variable AV block — the AV node conducts some flutter waves at 2:1 and others at 3:1, depending on its refractory state when each flutter wave arrives',
          'Frequent PVCs interrupt what is otherwise a regular 2:1 response',
          'The flutter waves themselves have varying amplitude, causing irregular QRS morphology',
        ],
        correct: 1,
      },
    ],
    explanation: `Atrial flutter is a macroreentrant arrhythmia — a single large reentrant circuit rotating around an anatomical obstacle, classically the tricuspid annulus in the right atrium (the cavotricuspid isthmus). The atria depolarize at a regular 250–350 bpm (typically ~300 bpm), producing the sawtooth or flutter wave pattern.\n\nThe AV node cannot safely conduct 300 impulses per minute to the ventricles. It acts as a physiological filter: most commonly conducting every other flutter wave (2:1 block → ventricular rate ~150 bpm). When conduction alternates between 2:1 and 3:1 — as in this patient — the ventricular response becomes irregular, superficially resembling atrial fibrillation. The diagnostic key is the organized sawtooth baseline at exactly 300 bpm, visible between QRS complexes.\n\nHyperthyroidism increases catecholamine sensitivity and shortens atrial refractory periods (thyroid hormone enhances If channels and adrenergic receptor expression in atrial myocytes). Shorter refractory periods allow reentrant circuits to complete a loop before the tissue ahead has recovered, sustaining flutter. Even treated Graves disease carries residual risk of atrial arrhythmias.\n\nRecall that the tricuspid annulus is a fixed anatomical structure in the right atrium — a natural obstacle around which a reentrant circuit can organize. The progressive dyspnea and crackles suggest this patient has developed rate-related diastolic dysfunction; restoring a normal ventricular rate through rate control or cardioversion is a clinical priority alongside anticoagulation given her prior PE.`,
  },
]

// Priority signal only — does not hide or lock the extension cases.
const PRIORITY_LABEL = {
  required:  'Required',
  extension: 'Extension — complete if time allows',
}
function PriorityBadge({ priority }) {
  const label = PRIORITY_LABEL[priority]
  if (!label) return null
  const isRequired = priority === 'required'
  return (
    <span
      className="inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0"
      style={isRequired
        ? { color: '#10b981', backgroundColor: '#10b98118', borderColor: '#10b98150' }
        : { color: '#9ca3af', backgroundColor: '#37415130', borderColor: '#4b556380' }}
    >
      {label}
    </span>
  )
}

// ── ECG Strip renderer ────────────────────────────────────────────────────────
function drawGrid(ctx, w, h) {
  const byY = h * BL
  const step = 40 * PX_MS
  ctx.lineWidth = 1
  let i = 0
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID_MINOR
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = GRID_MINOR
  for (let y = byY; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = byY; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.moveTo(0, byY); ctx.lineTo(w, byY); ctx.stroke()
}

function drawTrace(ctx, w, h, elapsedMs, rhythm) {
  const { waves, cycleMs } = rhythm
  const nativeCycleMs = rhythm.nativeCycleMs ?? null
  const byY = h * BL
  ctx.beginPath()
  for (let x = 0; x <= w; x++) {
    const tMs = elapsedMs - (w - x) / PX_MS
    const v = ECGVoltage(tMs, cycleMs, waves, LEAD_AXIS, nativeCycleMs)
    const y = byY - v * PX_MV
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = EMERALD; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
}

function ECGStrip({ rhythm }) {
  const canvasRef  = useRef(null)
  const elapsedRef = useRef(0)
  const lastRef    = useRef(null)
  const rafRef     = useRef(null)

  const [playing, setPlaying] = useState(true)
  const playingRef = useRef(playing)
  useEffect(() => { playingRef.current = playing }, [playing])

  // Scrubber plumbing — uncontrolled DOM node + refs (matching
  // LeadPlacementLab's pattern) so dragging never fights the rAF loop with
  // React re-renders. The strip repeats every `cycleMs`, so scrubbing within
  // one cycle covers every distinct frame the trace can show.
  const scrubbingRef  = useRef(false)
  const scrubRef       = useRef(null)
  const scrubLabelRef  = useRef(null)
  const cycleMs = Math.round(rhythm?.cycleMs || 1000)

  useEffect(() => {
    if (!rhythm) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    elapsedRef.current = 0
    lastRef.current = null
    if (scrubRef.current) scrubRef.current.value = '0'
    if (scrubLabelRef.current) scrubLabelRef.current.textContent = `0 / ${cycleMs} ms`

    function frame(now) {
      if (lastRef.current !== null && playingRef.current && !scrubbingRef.current) {
        elapsedRef.current += (now - lastRef.current)
      }
      lastRef.current = now
      const tMs = ((elapsedRef.current % cycleMs) + cycleMs) % cycleMs
      if (!scrubbingRef.current && scrubRef.current) scrubRef.current.value = String(Math.round(tMs))
      if (scrubLabelRef.current) scrubLabelRef.current.textContent = `${Math.round(tMs)} / ${cycleMs} ms`
      ctx.fillStyle = '#111827'
      ctx.fillRect(0, 0, SW, SH)
      drawGrid(ctx, SW, SH)
      drawTrace(ctx, SW, SH, elapsedRef.current, rhythm)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafRef.current)
      lastRef.current = null
    }
  }, [rhythm, cycleMs])

  return (
    <div>
      <canvas ref={canvasRef} width={SW} height={SH}
        className="w-full rounded-lg block"
        style={{ maxWidth: SW, background: '#111827' }}
      />
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <button
          onClick={() => setPlaying(v => !v)}
          className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
            playing ? 'bg-gray-800 text-gray-300 border-gray-700' : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
          }`}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={cycleMs}
          defaultValue={0}
          step={1}
          onMouseDown={() => { scrubbingRef.current = true; setPlaying(false) }}
          onTouchStart={() => { scrubbingRef.current = true; setPlaying(false) }}
          onMouseUp={() => { scrubbingRef.current = false }}
          onTouchEnd={() => { scrubbingRef.current = false }}
          onChange={e => { elapsedRef.current = Number(e.target.value) }}
          className="flex-1 min-w-[100px] accent-emerald-500"
        />
        <span ref={scrubLabelRef} className="text-xs font-mono text-gray-500 tabular-nums w-24 text-right shrink-0">
          0 / {cycleMs} ms
        </span>
      </div>
    </div>
  )
}

// ── HPICard ───────────────────────────────────────────────────────────────────
function HPICard({ hpi }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/40">
        <p className="text-sm font-semibold text-white">
          {hpi.age}{hpi.sex} &mdash; <span className="font-normal text-gray-300">{hpi.complaint}</span>
        </p>
      </div>
      {[
        ['Past medical history', hpi.pmh],
        ['Medications',          hpi.meds],
        ['Vital signs',          hpi.vitals],
      ].map(([label, val]) => (
        <div key={label} className="px-3 py-1.5 grid gap-4 border-b border-gray-800/80 last:border-0"
          style={{ gridTemplateColumns: '150px 1fr' }}>
          <span className="text-xs text-gray-500 uppercase tracking-wide leading-5">{label}</span>
          <span className="text-sm text-gray-300 leading-relaxed">{val}</span>
        </div>
      ))}
    </div>
  )
}

// ── HintSequence (Case 1 scaffolding) ────────────────────────────────────────
function HintSequence({ hints }) {
  const [step, setStep] = useState(0)
  return (
    <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3">
      <p className="text-xs text-amber-500/80 uppercase tracking-widest font-semibold mb-2">
        Guided prompts — Case 1 only
      </p>
      <div className="space-y-1.5">
        {hints.slice(0, step + 1).map((hint, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-amber-500 text-xs mt-0.5 shrink-0">→</span>
            <p className="text-sm text-amber-200/80 leading-relaxed">{hint}</p>
          </div>
        ))}
      </div>
      {step < hints.length - 1 && (
        <button onClick={() => setStep(s => s + 1)}
          className="mt-3 text-xs text-amber-400 border border-amber-700/50 px-3 py-1.5 rounded-lg hover:bg-amber-900/30 transition-colors">
          Next hint →
        </button>
      )}
    </div>
  )
}

// ── QuestionBlock ─────────────────────────────────────────────────────────────
function checkAnswer(question, value) {
  if (value === undefined || value === null || value === '') return false
  if (question.type === 'numeric') {
    return Math.abs(Number(value) - question.correct) <= (question.tolerance ?? 5)
  }
  return value === question.correct
}

function QuestionBlock({ question, value, onChange, submitted }) {
  const correct = submitted && checkAnswer(question, value)

  const borderBase = submitted
    ? (correct ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-red-700/60 bg-red-950/20')
    : 'border-gray-700 bg-gray-900/40'

  if (question.type === 'numeric') {
    return (
      <div className={`rounded-xl border p-3 ${borderBase}`}>
        <p className="text-sm text-gray-200 mb-2 font-medium">{question.stem}</p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={submitted}
            placeholder="Enter number"
            className="w-28 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm disabled:opacity-60 focus:outline-none focus:border-emerald-600"
          />
          <span className="text-sm text-gray-500">{question.unit}</span>
          {submitted && (
            <span className={`text-sm font-medium ${correct ? 'text-emerald-400' : 'text-red-400'}`}>
              {correct ? '✓ Correct' : `✗ Answer: ${question.correct} ${question.unit}`}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-3 ${borderBase}`}>
      <p className="text-sm text-gray-200 mb-2 font-medium">{question.stem}</p>
      <div className="space-y-1.5">
        {question.options.map((opt, i) => {
          const selected = value === i
          const isCorrectOption = i === question.correct
          let cls = 'border-gray-700 text-gray-400'
          if (submitted && isCorrectOption)            cls = 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
          else if (submitted && selected)              cls = 'border-red-600 bg-red-900/30 text-red-300'
          else if (!submitted && selected)             cls = 'border-indigo-500 bg-indigo-900/30 text-indigo-200'
          return (
            <button key={i} onClick={() => !submitted && onChange(i)}
              className={`w-full text-left px-3 py-1.5 rounded-lg border text-sm transition-colors ${cls} ${!submitted ? 'hover:border-gray-500 hover:text-gray-200 cursor-pointer' : 'cursor-default'}`}>
              <span className="text-gray-500 mr-2 text-xs font-medium">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── ScenarioResult ────────────────────────────────────────────────────────────
function ScenarioResult({ caseData, score }) {
  const max = caseData.questions.length
  const pct = Math.round((score / max) * 100)
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 flex items-center gap-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center border-4 shrink-0"
          style={{ borderColor: color + '60' }}>
          <span className="text-lg font-bold" style={{ color }}>{pct}%</span>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{score}/{max}</p>
          <p className="text-sm text-gray-400">
            {pct >= 80 ? 'Excellent — strong diagnostic reasoning.' : pct >= 60 ? 'Good — review the explanations below.' : 'Review the explanation and revisit Module 2 before retrying.'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-blue-800/40 bg-blue-950/20 p-5">
        <p className="text-xs text-blue-400/80 uppercase tracking-widest font-semibold mb-4">
          Physiological explanation
        </p>
        <div className="space-y-3">
          {caseData.explanation.split('\n\n').map((para, i) => (
            <p key={i} className="text-sm text-gray-300 leading-relaxed">{para}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ScenarioCard ──────────────────────────────────────────────────────────────
function ScenarioCard({ caseData, onSubmit }) {
  const rhythm = useMemo(
    () => caseData.rhythmId ? RHYTHMS[caseData.rhythmId] : caseData.rhythmBuilder?.(),
    [caseData]
  )
  const [answers, setAnswers]     = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore]         = useState(null)

  const allAnswered = caseData.questions.every(q => {
    const v = answers[q.id]
    return v !== undefined && v !== null && v !== ''
  })

  function handleSubmit() {
    const s = caseData.questions.reduce((sum, q) => sum + (checkAnswer(q, answers[q.id]) ? 1 : 0), 0)
    setScore(s)
    setSubmitted(true)
    onSubmit(answers, s)
  }

  return (
    <div className="space-y-3">
      <HPICard hpi={caseData.hpi} />

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1 font-medium">Lead II — ECG Strip</p>
        <ECGStrip rhythm={rhythm} />
        <p className="text-xs text-gray-600 mt-1">25 mm/s · 1 cm/mV standard calibration</p>
      </div>

      {caseData.scaffolded && !submitted && (
        <HintSequence hints={caseData.hints} />
      )}

      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">
          Questions {submitted ? `· ${score}/${caseData.questions.length} correct` : ''}
        </p>
        {caseData.questions.map((q, i) => (
          <div key={q.id}>
            <p className="text-xs text-gray-600 mb-1 font-medium">Question {i + 1}</p>
            <QuestionBlock
              question={q}
              value={answers[q.id]}
              onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))}
              submitted={submitted}
            />
          </div>
        ))}
      </div>

      {!submitted ? (
        <button onClick={handleSubmit} disabled={!allAnswered}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
          style={{
            background:  allAnswered ? '#10b981' : '#1f2937',
            color:       allAnswered ? '#fff'    : '#6b7280',
            cursor:      allAnswered ? 'pointer' : 'not-allowed',
            opacity:     allAnswered ? 1         : 0.7,
          }}>
          Submit answers
        </button>
      ) : (
        <ScenarioResult caseData={caseData} score={score} />
      )}
    </div>
  )
}

// ── ProgressDashboard ─────────────────────────────────────────────────────────
function ProgressDashboard({ scores, onSelectCase, activeId }) {
  const completedCount = CASES.filter(c => scores[c.id] !== undefined).length
  const reviewNeeded = CASES.filter(c => {
    const s = scores[c.id]
    return s !== undefined && s.score < s.max
  }).map(c => c.category)

  return (
    <div className="mb-3 p-3 rounded-xl border border-gray-800 bg-gray-900/40">
      <div className="flex items-start gap-8 mb-2.5">
        <div>
          <p className="text-2xl font-bold text-white">{completedCount}/{CASES.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Cases completed</p>
        </div>
        {reviewNeeded.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Review needed</p>
            <div className="flex flex-wrap gap-1.5">
              {reviewNeeded.map(cat => (
                <span key={cat}
                  className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-700/40 text-amber-300">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {CASES.map(c => {
          const s = scores[c.id]
          const isActive = c.id === activeId
          const pct = s !== undefined ? Math.round((s.score / s.max) * 100) : null
          const col = pct === null ? '#374151' : pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'
          return (
            <button key={c.id} onClick={() => onSelectCase(c.id)}
              className="rounded-xl border p-3 text-left transition-all"
              style={{
                borderColor: isActive ? col : col + '50',
                background:  isActive ? col + '18' : 'transparent',
              }}>
              <div className="flex items-start justify-between gap-1 mb-0.5">
                <p className="text-xs font-semibold text-white">{c.title}</p>
                <PriorityBadge priority={c.priority} />
              </div>
              <p className="text-xs text-gray-500 leading-snug mb-2" style={{ fontSize: '0.65rem' }}>
                {c.category}
              </p>
              <p className="text-sm font-bold" style={{ color: col }}>
                {s !== undefined ? `${s.score}/${s.max}` : '—'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PatientScenarios() {
  const [activeId, setActiveId] = useState('case1')
  const [scores, setScores] = useState(() => {
    const saved = readProgress('scores', {})
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  })
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    writeProgress('scores', scores)
  }, [scores])

  const handleSubmit = useCallback((caseId, answers, score) => {
    const caseData = CASES.find(c => c.id === caseId)
    const max = caseData?.questions.length ?? 5
    const updated = { ...scores, [caseId]: { score, max, answers } }
    setSaveFailed(!writeProgress('scores', updated))
    setScores(updated)
  }, [scores])

  const activeCase = CASES.find(c => c.id === activeId)

  return (
    <ModulePage
      moduleId="scenarios"
      number={3}
      title="Patient Scenarios"
      description="Each case below presents a patient whose ECG reveals a change in their conduction system physiology. Your goal is not diagnosis — it is mechanism. For each case, identify which physiological property changed and explain why it produces the pattern you see."
    >
      <ProgressDashboard
        scores={scores}
        onSelectCase={setActiveId}
        activeId={activeId}
      />

      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            {activeCase.title}: {activeCase.category}
            <PriorityBadge priority={activeCase.priority} />
          </h2>
          {activeCase.scaffolded && (
            <p className="text-xs text-amber-400/70 mt-0.5">
              Scaffolded — guided prompts available below the strip
            </p>
          )}
        </div>
        {saveFailed && <span role="status" className="text-xs text-amber-400">Browser storage is unavailable. Scores last for this session only.</span>}
      </div>

      <ScenarioCard
        key={activeId}
        caseData={activeCase}
        onSubmit={(answers, score) => handleSubmit(activeId, answers, score)}
      />
    </ModulePage>
  )
}
