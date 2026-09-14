import { useEffect, useState } from 'react'
import { ACCENT } from '../lib/modules'
import { useModuleTabsContext } from '../context/ModuleTabsContext'

export function useTabState(tabIds) {
  const [active, setActive] = useState(tabIds[0])
  return { active, setActive }
}

export function usePublishTabs(moduleId, tabs, { active, setActive }) {
  const { setTabInfo } = useModuleTabsContext()
  useEffect(() => {
    setTabInfo({ moduleId, tabs, active, setActive })
    return () => setTabInfo(prev => prev?.moduleId === moduleId ? null : prev)
  }, [moduleId, tabs, active, setActive, setTabInfo])
}

export default function ModuleTabs({ tabs, active, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2.5" role="tablist">
      {tabs.map(({ id, label }) => (
        <button key={id} role="tab" aria-selected={id === active} onClick={() => onSelect(id)}
          className="px-3 py-1 rounded-full text-xs font-medium"
          style={id === active ? { backgroundColor: ACCENT + '22', color: ACCENT, border: `1px solid ${ACCENT}55` } : { color: '#9ca3af', border: '1px solid #374151' }}>
          {label}
        </button>
      ))}
    </div>
  )
}
