import { ACCENT } from '../lib/modules'

export default function ModulePage({ number, category = 'Advanced', title, objective, description, wide = false, children }) {
  const accent = ACCENT
  return (
    <div className={`min-h-screen mx-auto ${wide ? 'p-4 max-w-[1500px]' : 'p-5 max-w-4xl'}`}>

      {/* ── Module header — kept compact since it repeats above every tab ── */}
      <div className="mb-3">
        <div className="flex items-center gap-3">
          {/* Module number pill */}
          <span
            className="text-xs font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full"
            style={{
              color:           accent,
              backgroundColor: accent + '18',
              border:          `1px solid ${accent}35`,
            }}
          >
            {number ? `Module ${number}` : category}
          </span>

          <h1 className="text-lg font-bold text-white">{title}</h1>
        </div>

        {/* Learning objective box — the "aha moment" — optional */}
        {objective && (
          <div
            className="mt-1.5 rounded-lg px-3 py-1.5 border flex items-baseline gap-2"
            style={{ backgroundColor: accent + '0c', borderColor: accent + '30' }}
          >
            <p
              className="text-[10px] uppercase tracking-widest font-semibold shrink-0"
              style={{ color: accent + 'aa' }}
            >
              Objective
            </p>
            <p className="text-xs text-gray-300 leading-snug">{objective}</p>
          </div>
        )}

        {/* Module description — optional */}
        {description && (
          <p className="text-gray-500 text-xs leading-snug mt-1.5">{description}</p>
        )}
      </div>

      {/* ── Interactive content ── */}
      <div className="mb-3">
        {children ?? (
          <div className="rounded-2xl bg-gray-900 border border-gray-800 border-dashed p-16 text-center">
            <div
              className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ backgroundColor: accent + '15' }}
            >
              <svg className="w-7 h-7" style={{ color: accent + 'aa' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <p className="text-gray-500 text-sm font-medium">Interactive content coming in Step 2+</p>
            <p className="text-gray-600 text-xs mt-1">
              The physics simulations, ECG engine, and patient cases will live here
            </p>
          </div>
        )}
      </div>

    </div>
  )
}
