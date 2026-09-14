import { createContext, useContext, useEffect, useState } from 'react'
import { readProgress, writeProgress } from '../lib/localProgress'

const ModeContext = createContext(null)

// The two mode accent colors — single source of truth, used by ModulePage
// and ModuleTabs so an active tab and the module header agree on the color.
export const MODE_ACCENT = { lab: '#818cf8', free: '#2dd4bf' }

// The three modules in the order they appear in Lab Mode
export const MODULE_ORDER = ['physics', 'ECG', 'scenarios']

// Metadata for each module (used by Sidebar and ModulePage)
export const MODULE_INFO = {
  physics: {
    id: 'physics',
    label: 'Physics foundations',
    number: 1,
    labPath:  '/lab/physics',
    playPath: '/play/physics',
  },
  ECG: {
    id: 'ECG',
    label: 'ECG simulator & rhythms',
    number: 2,
    labPath:  '/lab/ECG',
    playPath: '/play/ECG',
  },
  scenarios: {
    id: 'scenarios',
    label: 'Patient scenarios',
    number: 3,
    labPath:  '/lab/scenarios',
    playPath: '/play/scenarios',
  },
}

export function ModeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    const saved = readProgress('mode', null)
    return ['lab', 'free'].includes(saved) ? saved : null
  })
  const [progress, setProgress] = useState(() => {
    const saved = readProgress('completed', [])
    return new Set(Array.isArray(saved) ? saved.filter(id => MODULE_ORDER.includes(id)) : [])
  })
  const [storageAvailable, setStorageAvailable] = useState(true)

  useEffect(() => {
    const modeSaved = writeProgress('mode', mode)
    const progressSaved = writeProgress('completed', [...progress])
    if (!modeSaved || !progressSaved) console.warn("Browser progress storage is unavailable.")
  }, [mode, progress])

  const setMode = (nextMode) => {
    if (['lab', 'free'].includes(nextMode)) {
      setStorageAvailable(writeProgress('mode', nextMode))
      setModeState(nextMode)
    }
  }
  const markComplete = (moduleId) => {
    if (MODULE_ORDER.includes(moduleId)) {
      const updated = new Set([...progress, moduleId])
      setStorageAvailable(writeProgress('completed', [...updated]))
      setProgress(updated)
    }
  }
  const isUnlocked = (moduleId) => {
    const index = MODULE_ORDER.indexOf(moduleId)
    return index >= 0 && MODULE_ORDER.slice(0, index).every(id => progress.has(id))
  }
  return (
    <ModeContext.Provider value={{ mode, setMode, progress, markComplete, isUnlocked, loadingMode: false, storageAvailable }}>
      {children}
    </ModeContext.Provider>
  )
}

// useMode hook — call this in any component to access mode state
export const useMode = () => {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside <ModeProvider>')
  return ctx
}
