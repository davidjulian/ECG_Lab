import { useLocation, useNavigate, NavLink } from 'react-router-dom'
import { useMode, MODULE_ORDER, MODULE_INFO, MODE_ACCENT } from '../../context/ModeContext'
import AboutModal from '../AboutModal'
import { useModuleTabsContext } from '../../context/ModuleTabsContext'

// Small SVG icons defined inline so we don't need an icon library yet
function CheckIcon()  { return <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> }
function LockIcon()   { return <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> }
function SwitchIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg> }

export default function Sidebar({ isLabMode }) {
  const { progress, isUnlocked, storageAvailable } = useMode()
  const location    = useLocation()
  const navigate    = useNavigate()
  const { tabInfo } = useModuleTabsContext()

  const accent    = MODE_ACCENT[isLabMode ? 'lab' : 'free']   // purple for Lab, teal for Free Play
  const basePath  = isLabMode ? '/lab' : '/play'
  const modeLabel = isLabMode ? 'Lab mode' : 'Free play'

  return (
    <aside className="w-60 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0">

      {/* App brand + current mode indicator */}
      <div className="px-4 py-4 border-b border-gray-800">
        {/* Mini ECG blip logo */}
        <div className="flex items-center gap-2 mb-3">
          <svg viewBox="0 0 48 24" className="w-8 h-4" fill="none">
            <polyline points="0,12 8,12 12,4 16,20 20,2 24,22 28,12 48,12"
              stroke="#10b981" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span className="text-gray-300 text-xs font-medium tracking-tight">ECG Lab</span>
        </div>

        {/* Mode pill */}
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accent }}/>
          <span className="text-xs font-medium" style={{ color: accent }}>{modeLabel}</span>
        </div>
      </div>

      {/* Module list */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {MODULE_ORDER.map((moduleId) => {
          const info      = MODULE_INFO[moduleId]
          const completed = progress.has(moduleId)
          const unlocked  = isLabMode ? isUnlocked(moduleId) : true
          const path      = `${basePath}/${moduleId}`
          const isActive  = location.pathname === path

          // Locked item (Lab Mode only)
          if (!unlocked) {
            return (
              <div
                key={moduleId}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-not-allowed select-none opacity-40"
              >
                <span className="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs text-gray-500 shrink-0 font-mono">
                  {info.number}
                </span>
                <span className="text-sm text-gray-500 flex-1 leading-tight">{info.label}</span>
                <span className="text-gray-600"><LockIcon /></span>
              </div>
            )
          }

          // Accessible item. When this is the currently-open module AND it's
          // published a tab list (see usePublishTabs in ModuleTabs.jsx —
          // only Module 1/2 do this), show its tabs as a nested sub-menu
          // right under it, instead of the old in-page pill bar.
          const showTabs = isActive && tabInfo && tabInfo.moduleId === moduleId

          return (
            <div key={moduleId}>
              <NavLink
                to={path}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors text-sm ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                }`}
              >
                {/* Number badge — turns into a checkmark when completed */}
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 font-mono transition-colors"
                  style={{
                    backgroundColor: completed ? accent + '20' : isActive ? '#1f2937' : 'transparent',
                    color:           completed ? accent : isActive ? '#e5e7eb' : '#6b7280',
                    border:          `1px solid ${completed ? accent + '50' : '#374151'}`,
                  }}
                >
                  {completed ? <CheckIcon /> : info.number}
                </span>

                <span className="flex-1 leading-tight">{info.label}</span>

                {completed && !isActive && (
                  <span style={{ color: accent + '80' }}><CheckIcon /></span>
                )}
              </NavLink>

              {showTabs && (
                <div className="mt-0.5 ml-4 pl-2.5 border-l border-gray-800 space-y-0.5">
                  {tabInfo.tabs.map(tab => {
                    const tabActive = tab.id === tabInfo.active
                    const tabVisited = tabInfo.visited?.has(tab.id)
                    return (
                      <button
                        key={tab.id}
                        onClick={() => tabInfo.setActive(tab.id)}
                        className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                          tabActive ? '' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'
                        }`}
                        style={tabActive ? { backgroundColor: accent + '18', color: accent } : undefined}
                      >
                        <span className="flex-1 leading-tight">{tab.label}</span>
                        {tab.badge && (
                          <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
                            {tab.badge}
                          </span>
                        )}
                        {!tabActive && tabVisited && (
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: accent }}
                            title="Visited"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer actions */}
      <div className="px-2 py-3 border-t border-gray-800 space-y-0.5">
        {!storageAvailable && <p role="status" className="px-3 py-2 text-xs text-amber-400">Browser storage is unavailable. Progress lasts for this session only.</p>}
        <AboutModal />
        <button
          onClick={() => navigate('/mode')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 transition-colors text-xs text-left"
        >
          <SwitchIcon />
          Switch mode
        </button>

      </div>
    </aside>
  )
}
