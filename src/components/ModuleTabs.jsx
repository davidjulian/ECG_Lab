import { useCallback, useEffect, useState } from 'react'
import { useMode, MODE_ACCENT } from '../context/ModeContext'
import { useModuleTabsContext } from '../context/ModuleTabsContext'

// Reads/writes { active, visited } to localStorage, keyed per module — this
// is a UI-only convenience (which tab you were last on, which you've opened
// at least once), not learning progress, so it deliberately doesn't touch
// Supabase/ModeContext's progress tracking. Falls back gracefully (first
// tab, empty visited set) if localStorage is unavailable (private browsing)
// or nothing's been stored yet.
function readStored(moduleId) {
  try {
    const raw = localStorage.getItem(`ecg-lab:v1:tabs:${moduleId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { active: parsed.active ?? null, visited: new Set(parsed.visited ?? []) }
  } catch {
    return null
  }
}

function writeStored(moduleId, active, visited) {
  try {
    localStorage.setItem(`ecg-lab:v1:tabs:${moduleId}`, JSON.stringify({ active, visited: [...visited] }))
  } catch {
    // ignore — private browsing / storage disabled
  }
}

export function useTabState(moduleId, tabIds) {
  const [state, setState] = useState(() => {
    const stored = readStored(moduleId)
    const initialActive = stored?.active && tabIds.includes(stored.active) ? stored.active : tabIds[0]
    const initialVisited = new Set(stored?.visited ?? [])
    initialVisited.add(initialActive)
    return { active: initialActive, visited: initialVisited }
  })

  useEffect(() => {
    writeStored(moduleId, state.active, state.visited)
  }, [moduleId, state])

  const setActive = useCallback((id) => {
    setState(prev => {
      if (prev.active === id) return prev
      const visited = new Set(prev.visited)
      visited.add(id)
      return { active: id, visited }
    })
  }, [])

  return { active: state.active, visited: state.visited, setActive }
}

// Publishes this module's tab list + state into ModuleTabsContext so
// Sidebar can render it as a nested sub-menu under the module's own row —
// this is what "the tabs live in the left sidebar" actually runs on.
// Clears itself on unmount (leaving the tabbed page) so Sidebar doesn't
// keep showing a stale sub-menu under a module you've navigated away from.
export function usePublishTabs(moduleId, tabs, { active, visited, setActive }) {
  const { setTabInfo } = useModuleTabsContext()

  useEffect(() => {
    setTabInfo({ moduleId, tabs, active, visited, setActive })
    return () => setTabInfo(prev => (prev?.moduleId === moduleId ? null : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, tabs, active, visited, setActive])
}

/**
 * ModuleTabs — horizontal pill tab bar. Currently unused directly by
 * Module 1/2 (their tabs now live in Sidebar via usePublishTabs above) but
 * kept as a reusable, self-contained fallback for any page that wants an
 * in-page tab bar without wiring up the sidebar context.
 *
 * Props:
 *   tabs     — [{ id, label }]
 *   active   — currently selected tab id
 *   visited  — Set of tab ids the student has opened at least once
 *   onSelect — (id) => void
 */
export default function ModuleTabs({ tabs, active, visited, onSelect }) {
  const { mode } = useMode()
  const accent = MODE_ACCENT[mode === 'lab' ? 'lab' : 'free']

  return (
    <div className="flex flex-wrap gap-1.5 mb-2.5" role="tablist">
      {tabs.map(({ id, label }) => {
        const isActive = id === active
        const isVisited = visited?.has(id)
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(id)}
            className="relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={isActive
              ? { backgroundColor: accent + '22', color: accent, border: `1px solid ${accent}55` }
              : { backgroundColor: 'transparent', color: '#9ca3af', border: '1px solid #374151' }
            }
          >
            {label}
            {!isActive && isVisited && (
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
  )
}
