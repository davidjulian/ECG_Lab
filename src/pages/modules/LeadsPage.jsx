import ModulePage from '../../components/ModulePage'
import LeadPlacementLab from '../../components/LeadPlacementLab'
import Explanation from '../../components/Explanation'

export default function LeadsPage() {
  return (
    <ModulePage number={3} title="ECG Leads"
      description="Place two electrodes, reverse their polarity, and change their viewing direction. Compare the resulting signals before exploring the standard limb leads.">
      <LeadPlacementLab />
      <Explanation title="Model explanation" className="mt-3">Each lead measures a voltage difference. In this simplified model, that voltage depends on the projection of the instantaneous cardiac vector onto the lead axis. A zero projection at one instant does not mean the heart is electrically inactive or that the entire tracing will be flat.</Explanation>
    </ModulePage>
  )
}
