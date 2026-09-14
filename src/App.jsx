import { Routes, Route, Navigate } from 'react-router-dom'
import { useMode }  from './context/ModeContext'

import LabGuard                      from './components/layout/LabGuard'
import { LabLayout, FreePlayLayout } from './components/layout/Layouts'

import ModeSelect         from './pages/ModeSelect'
import PhysicsFoundations from './pages/modules/PhysicsFoundations'
import ECGSimulator       from './pages/modules/ECGSimulator'
import PatientScenarios   from './pages/modules/PatientScenarios'

// Smart redirect from "/" based on auth state + saved mode preference
function RootRedirect() {
  const { mode, loadingMode } = useMode()
  if (loadingMode) return null
  if (mode === 'lab')  return <Navigate to="/lab/physics"  replace />
  if (mode === 'free') return <Navigate to="/play/physics" replace />
  return                      <Navigate to="/mode"         replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/"     element={<RootRedirect />} />
      <Route path="/login" element={<Navigate to="/mode" replace />} />

      <Route path="/mode"  element={<ModeSelect />} />

      {/* Lab Mode — linear, gated */}
      <Route path="/lab" element={<LabLayout />}>
        <Route index        element={<Navigate to="physics" replace />} />
        <Route path="physics"   element={<PhysicsFoundations />} />
        <Route path="ECG"       element={<LabGuard moduleId="ECG">      <ECGSimulator   /></LabGuard>} />
        <Route path="scenarios" element={<LabGuard moduleId="scenarios"><PatientScenarios /></LabGuard>} />
      </Route>

      {/* Free Play — open access */}
      <Route path="/play" element={<FreePlayLayout />}>
        <Route index        element={<Navigate to="physics" replace />} />
        <Route path="physics"   element={<PhysicsFoundations />} />
        <Route path="ECG"       element={<ECGSimulator />} />
        <Route path="scenarios" element={<PatientScenarios />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
