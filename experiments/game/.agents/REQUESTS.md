
## From World lead — 2026-11-14
- [RESOLVED, World re-verified: stable at 1.3–1.4] Soft spheres with `pressure > 1.0` slowly move on their own across flat ground (no input, gravity 9.81,
  ground()=0). Repro: `createSoftBody({position:(0,0.7,0), radius:0.45, detail:2, stiffness:0.45, pressure:1.4, mass:1.5})`
  → drifts ~13 m in 15 s; pressure 1.15 → ~2.4 m; pressure 1.0 → stable. Looks like a net force from the pressure
  term (asymmetric per-face area/normal sum?). Workaround in levels: every soft body uses pressure 1.0.
  Once it's fixed, the station gym ball / planet regolith blobs could go back to ~1.3–1.4 for extra bounce.
- [FIXED by Engine] pressure drift
- [Director/CI] Round 2: station.js now passes `yaw` to `createRagdoll` (Engine supports it, per Director). Please add
  `yaw` to the createRagdoll options in CONTRACT.md and to the allowed keys in scripts/smoke.mjs (line ~149).
