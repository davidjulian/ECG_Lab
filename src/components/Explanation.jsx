// Explanations are opt-in. Changing the experiment can reset an open disclosure
// without storing student activity or carrying a reveal into the next experiment.
export default function Explanation({ children, title = 'Explanation', resetKey, className = '' }) {
  return (
    <details key={resetKey} className={`rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-400 ${className}`}>
      <summary className="cursor-pointer text-teal-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400 rounded">
        {title} <span className="text-gray-500 font-normal">(optional)</span>
      </summary>
      <div className="mt-2 leading-relaxed">{children}</div>
    </details>
  )
}
