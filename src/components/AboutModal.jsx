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
          <p><strong className="text-white">Original creator: Jacob Walker.</strong> ECG Lab is adapted from Jacob’s cardiac electrophysiology learning app.</p>
          <p>This edition brings together his original modules 1, 3, and 4: physics foundations, ECG simulation and rhythms, and patient scenarios.</p>
          <p>Adapted by David Julian for PCB3713C at the University of Florida. Development assistance from <strong className="text-white">Claude Code</strong> and <strong className="text-white">OpenAI Codex</strong> is gratefully acknowledged.</p>
          <p>Progress and scenario scores are stored in this browser when storage is available. They do not sync between devices.</p>
          <div className="flex flex-wrap gap-4 text-teal-300 underline underline-offset-4">
            <a href="https://github.com/jwalker2124/pcb3713C-ECG-Lab" target="_blank" rel="noreferrer">Jacob’s original app</a>
            <a href="https://github.com/davidjulian/ECG_lab" target="_blank" rel="noreferrer">ECG Lab on GitHub</a>
          </div>
        </div>
      </dialog>
    </>
  )
}
