import { Routes, Route, Navigate } from 'react-router-dom'
import { FreePlayLayout } from './components/layout/Layouts'
import PhysicsFoundations from './pages/modules/PhysicsFoundations'
import ECGSimulator from './pages/modules/ECGSimulator'
import PatientScenarios from './pages/modules/PatientScenarios'
import { RecordingsPage, VectorCyclePage } from './pages/modules/CardiacBridge'
import LeadsPage from './pages/modules/LeadsPage'

import MeanAxisPage from './pages/modules/MeanAxisPage'

export default function App() {
  return (
    <Routes>
      <Route path="/play" element={<FreePlayLayout />}>
        <Route index element={<Navigate to="recordings" replace />} />
        <Route path="recordings" element={<RecordingsPage />} />
        <Route path="mean-axis" element={<MeanAxisPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="vector-cycle" element={<VectorCyclePage />} />
        <Route path="physics" element={<PhysicsFoundations />} />
        <Route path="ECG" element={<ECGSimulator />} />
        <Route path="scenarios" element={<PatientScenarios />} />
      </Route>
      {/* Preserve old module bookmarks while removing gated access. */}
      <Route path="/lab/ECG" element={<Navigate to="/play/ECG" replace />} />
      <Route path="/lab/scenarios" element={<Navigate to="/play/scenarios" replace />} />
      <Route path="*" element={<Navigate to="/play/recordings" replace />} />
    </Routes>
  )
}
