import { PHYSIOLOGY_DEFAULTS } from './ECGEngine.js'

// Examples change the same tissue properties as the manual controls.
export const PHYSIOLOGY_EXAMPLES = [
  { id: 'default', label: 'Default sinus rhythm', group: 'Sinus rhythms', settings: {} },
  { id: 'bradycardia', label: 'Sinus bradycardia', group: 'Sinus rhythms', settings: { saAutomaticity: 45 } },
  { id: 'tachycardia', label: 'Sinus tachycardia', group: 'Sinus rhythms', settings: { saAutomaticity: 120 } },
  { id: 'respiratory', label: 'Respiratory sinus arrhythmia', group: 'Sinus rhythms', settings: { firingRegularity: 'respiratory' } },
  { id: 'pac', label: 'Premature atrial impulses', group: 'Atrial rhythms', settings: { atrialPrematureActivity: 'frequent' } },
  { id: 'flutter', label: 'Atrial flutter', group: 'Atrial rhythms', settings: { atrialRefractoryMs: 190 } },
  { id: 'af', label: 'Atrial fibrillation', group: 'Atrial rhythms', settings: { atrialRefractoryMs: 150 } },
  { id: 'first-degree', label: 'First-degree AV block', group: 'Conduction disturbances', settings: { avDelayMs: 250 } },
  { id: 'mobitz-i', label: 'Mobitz I AV block', group: 'Conduction disturbances', settings: { avRecoveryMs: 1600 } },
  { id: 'mobitz-ii', label: 'Mobitz II AV block', group: 'Conduction disturbances', settings: { distalConductionFailure: 'occasional' } },
  { id: 'complete-block', label: 'Complete AV block', group: 'Conduction disturbances', settings: { avConduction: 'interrupted' } },
  { id: 'lbbb', label: 'Left bundle branch block', group: 'Conduction disturbances', settings: { leftBundleVelocityPct: 30 } },
  { id: 'rbbb', label: 'Right bundle branch block', group: 'Conduction disturbances', settings: { rightBundleVelocityPct: 30 } },
  { id: 'pvc', label: 'Premature ventricular impulses', group: 'Ventricular rhythms', settings: { ventricularPrematureActivity: 'frequent' } },
  { id: 'multifocal-pvc', label: 'Multifocal premature ventricular impulses', group: 'Ventricular rhythms', settings: { ventricularPrematureActivity: 'frequent', ventricularPrematureFoci: 'multifocal' } },
  { id: 'vt', label: 'Ventricular tachycardia', group: 'Ventricular rhythms', settings: { ventricularConductionVelocityPct: 30, ventricularPrematureActivity: 'frequent', repolHeterogeneity: 'moderate' } },
  { id: 'vf', label: 'Ventricular fibrillation', group: 'Ventricular rhythms', settings: { ventricularConductionVelocityPct: 30, ventricularPrematureActivity: 'frequent', repolHeterogeneity: 'high' } },
]

export function exampleSettings(id) {
  const example = PHYSIOLOGY_EXAMPLES.find(item => item.id === id)
  if (!example) throw new Error(`Unknown rhythm example: ${id}`)
  return { ...PHYSIOLOGY_DEFAULTS, ...example.settings }
}

export const RESULTING_PROPERTIES = [
  { key: 'saAutomaticity', effective: 'effectiveSaRate', label: 'SA firing', unit: 'bpm', section: 'sa' },
  { key: 'avDelayMs', effective: 'effectiveAvDelayMs', label: 'AV conduction delay', unit: 'ms', section: 'av' },
  { key: 'ventricularApdMs', effective: 'effectiveApdMs', label: 'Ventricular AP duration', unit: 'ms', section: 'ventricle' },
  { key: 'avRefractoryMs', effective: 'effectiveAvRefractoryMs', label: 'AV refractory period', unit: 'ms', section: 'av' },
  { key: 'avRecoveryMs', effective: 'effectiveAvRecoveryMs', label: 'AV recovery time', unit: 'ms', section: 'av' },
  { key: 'purkinjeAutomaticity', effective: 'effectivePurkinjeRate', label: 'Junctional backup rate', unit: 'bpm', section: 'av' },
  { key: 'ventricularEscapeRate', effective: 'effectiveEctopicRate', label: 'Ventricular backup rate', unit: 'bpm', section: 'his' },
]
