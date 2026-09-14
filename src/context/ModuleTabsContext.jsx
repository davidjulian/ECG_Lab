import { createContext, useContext, useState } from 'react'

// Lets a tabbed module page (PhysicsFoundations, CardiacBridge) publish its
// tab list + active state so Sidebar can render it as a nested
// sub-menu under that module's row, instead of (or in addition to) the
// in-page pill bar. Sidebar and the module page are siblings under
// LabLayout/FreePlayLayout — this context is what lets them share state
// without prop-drilling through the router's <Outlet/>.
const ModuleTabsContext = createContext(null)

export function ModuleTabsProvider({ children }) {
  // { moduleId, tabs: [{id,label}], active, setActive } | null
  const [tabInfo, setTabInfo] = useState(null)
  return (
    <ModuleTabsContext.Provider value={{ tabInfo, setTabInfo }}>
      {children}
    </ModuleTabsContext.Provider>
  )
}

export function useModuleTabsContext() {
  const ctx = useContext(ModuleTabsContext)
  if (!ctx) throw new Error('useModuleTabsContext must be used inside <ModuleTabsProvider>')
  return ctx
}
