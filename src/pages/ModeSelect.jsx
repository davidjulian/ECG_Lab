import AboutModal from '../components/AboutModal'
import { useNavigate } from 'react-router-dom'
import { useMode } from '../context/ModeContext'

function ModeCard({ title, subtitle, description, features, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-6 transition-all group"
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accent }}/>
        <span className="text-white font-semibold text-base">{title}</span>
      </div>

      <p className="text-xs font-medium mb-3" style={{ color: accent }}>{subtitle}</p>
      <p className="text-gray-400 text-sm leading-relaxed mb-5">{description}</p>

      <ul className="space-y-2 mb-6">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-gray-500">
            <span className="mt-px" style={{ color: accent + '90' }}>→</span>
            {f}
          </li>
        ))}
      </ul>

      {/* CTA button inside the card */}
      <div
        className="w-full text-center text-sm font-medium py-2.5 rounded-xl transition-opacity group-hover:opacity-90"
        style={{
          backgroundColor: accent + '1a',
          color:           accent,
          border:          `1px solid ${accent}35`,
        }}
      >
        Enter {title}
      </div>
    </button>
  )
}

export default function ModeSelect() {
  const { setMode } = useMode()
  const navigate    = useNavigate()

  const select = async (mode) => {
    await setMode(mode)
    navigate(mode === 'lab' ? '/lab/physics' : '/play/physics')
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16"
      style={{ backgroundColor: '#0a0e1a' }}
    >
      <div className="w-full max-w-xl">
        <div className="text-center mb-10">
          {/* Mini ECG blip */}
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <svg viewBox="0 0 64 24" className="w-10 h-5" fill="none">
              <polyline points="0,12 10,12 14,3 18,21 22,1 26,23 30,12 64,12"
                stroke="#10b981" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="text-white font-semibold text-lg">ECG Lab</span>
          </div>
          <p className="text-gray-500 text-sm">Choose how you'd like to explore today</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ModeCard
            title="Lab mode"
            subtitle="Guided — complete in order"
            description="Work through all three modules sequentially. Each section unlocks the next, building from physics fundamentals to live ECG interpretation to patient diagnosis."
            features={[
              'Modules unlock as you progress',
              'Progress is saved in this browser when available',
              'Designed for first-time use in class',
              '"Mark complete" advances you forward',
            ]}
            accent="#818cf8"
            onClick={() => select('lab')}
          />
          <ModeCard
            title="Free play"
            subtitle="Open — explore anything"
            description="Jump to any module at any time. Revisit a specific rhythm, replay a patient scenario, or brush up on the dipole model — no restrictions."
            features={[
              'All modules always accessible',
              'Jump between sections freely',
              'Great for review and reference',
              'No required order or gating',
            ]}
            accent="#2dd4bf"
            onClick={() => select('free')}
          />
        </div>

        <div className="text-center mt-6"><AboutModal /></div>
        <p className="text-center text-gray-600 text-xs mt-6">
          You can switch modes at any time from the sidebar
        </p>
      </div>
    </div>
  )
}
