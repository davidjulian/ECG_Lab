# ECG Lab

An ECG teaching app for PCB3713C at the University of Florida, adapted by David Julian from Jacob Walker’s cardiac electrophysiology learning app.

## Modules

1. Physics foundations (original module 1)
2. ECG simulator and rhythms (original module 3)
3. Patient scenarios (original module 4)

Lab mode advances through these three modules in order. Free play allows access to any module. Mode, progress, tab selections, and scenario scores are saved in this browser when local storage is available. No account or backend setup is required. Stored data does not sync between browsers or devices.

## Development

Use Node.js 22.13 or later, then run:

```sh
npm ci
npm run dev
```

Production build: `npm run build`. Local build preview: `npm run preview`.

## GitHub Pages

The app uses hash routing and the `/ECG_lab/` base path. The included workflow builds and deploys pushes to `main` after GitHub Pages is configured to use GitHub Actions in the repository settings.

## Credits and provenance

Original creator: **Jacob Walker**. Development assistance from **Claude Code** and **OpenAI Codex** is acknowledged in the app’s About modal.

Original repository: https://github.com/jwalker2124/pcb3713C-ECG-Lab

Source revision: `22a2932c9e87e8dfa80c8a342fcf805b6427ebb8` (Module 1E UI changes).

ECG Lab repository: https://github.com/davidjulian/ECG_lab

The original Git history is retained. Original module 2 and development components remain in source for provenance, but are excluded from this app’s routes and navigation. Simulation and case content are inherited from the source app; this initial adaptation does not constitute a scientific review of that content.
