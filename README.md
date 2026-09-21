# ECG Lab

An ECG teaching app for PCB3713C at the University of Florida, adapted by David Julian from Jacob Walker’s cardiac electrophysiology learning app.

## Modules

1. Introduction — Jacob’s original 2C, AP versus ECG, using the repaired tissue wave animation.
2. Electrical Fields — charges, dipoles, projection, and propagating cellular activity (original 1A–1D).
3. ECG Leads — electrode placement and lead projections (original 1E).
4. ECG Simulator — physiological simulator (original module 3).
5. Patient Cases — symptom-based cases (original module 4).

Advanced: Vector Cycle — original 2E, preserved for later activities outside the core tutorial sequence.

The app opens directly to Module 1. All modules are freely accessible without accounts or progress tracking. Older physics, ECG, and scenario bookmarks retain their destinations. Quiz feedback applies only to the open case.

## Development

Use Node.js 22.13 or later, then run:

```sh
npm ci
npm run dev
```

Production build: `npm run build`. Local build preview: `npm run preview`.

## GitHub Pages

The app uses hash routing and the `/ECG_Lab/` base path. The included workflow builds and deploys pushes to `main` after GitHub Pages is configured to use GitHub Actions in the repository settings.

## Credits and provenance

Original creator: **Jacob Walker**. Development assistance from **Claude Code** and **OpenAI Codex** is acknowledged in the app’s About modal.

Original repository: https://github.com/jwalker2124/pcb3713C-ECG-Lab

Source revision: `22a2932c9e87e8dfa80c8a342fcf805b6427ebb8` (Module 1E UI changes).

ECG Lab repository: https://github.com/davidjulian/ECG_Lab

The original Git history is retained. Original sections 2C and 2E are integrated into the new sequence. Remaining original module 2 and development components stay outside the app navigation. Simulation and case content are inherited from the source app; this initial adaptation does not constitute a scientific review of that content.

## Schematic myocardial waves

Modules 1 and 4 preserve Jacob’s heart artwork and draws a masked tissue state layer within its existing chamber shapes. A yellow activation front leaves coral depolarized tissue behind; a cyan recovery front returns the region to its original resting color. Conduction pathways retain the original animation. Violet fronts identify ectopic or fusion activation.

Atrial activation spreads from approximate SA and interatrial entry regions. Ventricular activation uses a curved apical-to-basal timing field, and recovery uses a separate basal-to-apical field, following the regional teaching approximation used in the Cardiac Action Potentials app. These filled chamber regions are schematic, not resolved myocardial walls, and do not model septal or transmural propagation. The spatial recovery pattern is not a universal human recovery map or a reconstruction from the ECG. It does not calculate the displayed lead voltage.

Activation events follow the simulator’s conduction map, including delayed and absent beats. Ventricular recovery uses each beat’s T-wave window. Atrial recovery timing is illustrative because it is not separately resolved by this simulator. Fibrillating regions remain disorganized; ectopic and fusion rhythms retain their event timing and color but do not model their exact spatial origin.

Physiology background: [normal human activation and repolarization](https://pmc.ncbi.nlm.nih.gov/articles/PMC1458874/) and [regional and transmural contributions to recovery](https://pmc.ncbi.nlm.nih.gov/articles/PMC2662714/). These sources describe why the spatial display must be treated as an approximation.

Wave timing checks: `node --test tests/myocardialWaves.test.js`.

## Exploring AF, VT, and VF in Module 4

Start each comparison with **Reset all** and use **0.25×** playback to inspect the heart animation.

- **AF:** Under Atrial Myocardium, reduce Atrial refractory period to 150 ms. Local atrial regions activate and recover asynchronously; distinct ventricular activations follow the irregular QRS complexes. Short refractoriness and slow conduction favor reentry, but the model's automatic pattern selection does not simulate the initiating trigger or predict an AF threshold.
- **VT:** Under Ventricular Myocardium, select Frequent premature activity, set Ventricular myocardial conduction to 30%, and set Repolarization heterogeneity to Moderate. Broad complexes and repeated ventricular activation occur independently of SA timing.
- **VF:** Change heterogeneity to High in that ventricular setup. Ventricular activation becomes fragmented, and the ECG has no discrete QRS/T complexes or measurable ventricular beat rate. Atrial activation does not automatically become fibrillatory.

The ventricular selections require both a premature impulse and a vulnerable substrate. These combinations select schematic sustained rhythms, not clinical cutoffs or a simulated propagation circuit. Reset this structure restores its baseline properties; Reset all also clears other structures. Fibrillation uses deterministic local wavelets, sharing the playback clock so Pause freezes both displays. A hyperkalemic sine-wave pattern remains distinct from VF.

Physiology context: [reentry and tissue recovery](https://cvphysiology.com/arrhythmias/a008c) and [mechanisms of atrial fibrillation](https://journals.physiology.org/doi/10.1152/physrev.00031.2009).
