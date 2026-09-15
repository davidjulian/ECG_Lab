import { useLocation, NavLink } from 'react-router-dom'
import { MODULES, ACCENT } from '../../lib/modules'
import AboutModal from '../AboutModal'
import { useModuleTabsContext } from '../../context/ModuleTabsContext'

export default function Sidebar() {
  const location = useLocation()
  const { tabInfo } = useModuleTabsContext()
  return (
    <aside className="w-60 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 48 24" className="w-8 h-4" fill="none"><polyline points="0,12 8,12 12,4 16,20 20,2 24,22 28,12 48,12" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="text-gray-300 text-xs font-medium">ECG Lab</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {MODULES.map(info => {
          const path = `/play/${info.id}`
          const active = location.pathname === path
          return (
            <div key={info.id}>
              {info.advanced && <p className="px-3 pt-6 pb-2 text-xs uppercase tracking-widest text-gray-500">Advanced</p>}
              <NavLink to={path} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'}`}>
                <span className="w-5 h-5 rounded-full border border-gray-700 flex items-center justify-center text-xs shrink-0 font-mono">{info.advanced ? "+" : info.number}</span>
                <span>{info.label}</span>
              </NavLink>
              {active && tabInfo?.moduleId === info.id && (
                <div className="mt-0.5 ml-4 pl-2.5 border-l border-gray-800 space-y-0.5">
                  {tabInfo.tabs.map(tab => (
                    <button key={tab.id} onClick={() => tabInfo.setActive(tab.id)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-left text-xs text-gray-400 hover:bg-gray-800/60"
                      style={tab.id === tabInfo.active ? { backgroundColor: ACCENT + '18', color: ACCENT } : undefined}>
                      <span className="flex-1">{tab.label}</span>
                      {tab.badge && <span className="text-[9px] uppercase rounded-full bg-gray-800 px-1.5 py-0.5">{tab.badge}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="px-2 py-3 border-t border-gray-800"><AboutModal /></div>
    </aside>
  )
}
