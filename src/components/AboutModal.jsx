import { useRef } from 'react'

export default function AboutModal() {
  const dialog = useRef(null)
  return (
    <>
      <button type="button" onClick={() => dialog.current.showModal()}
        className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
        About ECG Lab
      </button>
      <dialog ref={dialog} aria-labelledby="about-title"
        className="w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 text-gray-300 shadow-xl backdrop:bg-black/70"
        onClick={event => { if (event.target === event.currentTarget) dialog.current.close() }}>
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 id="about-title" className="text-xl font-semibold text-white">About ECG Lab</h2>
          <button type="button" autoFocus onClick={() => dialog.current.close()}
            className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Close</button>
        </div>
        <div className="space-y-4 text-sm leading-relaxed">
          <p><strong className="text-white">Original creator: Jacob Walker, UF BME class of 2027</strong></p>
          <p>Development assistance from <strong className="text-white">Claude Code</strong> and <strong className="text-white">OpenAI Codex</strong></p>
        </div>
      </dialog>
    </>
  )
}
