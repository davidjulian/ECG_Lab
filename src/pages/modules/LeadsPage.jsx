import ModulePage from '../../components/ModulePage'
import LeadPlacementLab from '../../components/LeadPlacementLab'

export default function LeadsPage() {
  return (
    <ModulePage number={3} title="One heart, different leads"
      description="Place two electrodes, reverse their polarity, and change their viewing direction. Compare the resulting signals before exploring the standard limb leads.">
      <LeadPlacementLab />
      <p className="mt-3 text-xs text-gray-400">Each lead measures a voltage difference. In this simplified model, that voltage depends on the projection of the instantaneous cardiac vector onto the lead axis. A zero projection at one instant does not mean the heart is electrically inactive or that the entire tracing will be flat.</p>
    </ModulePage>
  )
}
