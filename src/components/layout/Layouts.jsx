import { Outlet } from 'react-router-dom'
import { ModuleTabsProvider } from '../../context/ModuleTabsContext'
import Sidebar from './Sidebar'

export function FreePlayLayout() {
  return (
    <ModuleTabsProvider>
      <div className="flex min-h-screen" style={{ backgroundColor: '#0a0e1a' }}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </ModuleTabsProvider>
  )
}
