# CI CHECKS — pass 20 (final) — 2026-11-14 19:45 PST

Run yourself: `export PATH=/opt/homebrew/bin:$PATH && cd /Users/chasenagle/Code/NASAHackathon/Claude-test && node scripts/smoke.mjs`

All lead files exist. **Build, lint and smoke all PASS.**

| Check | Status |
|---|---|
| `npx vite build` | PASS (chunk-size >500 kB warning from three.js only — fine) |
| `npx oxlint src/game` | PASS (0 errors, 0 warnings) |
| `node scripts/smoke.mjs` | PASS — 11 pass, 0 fail, 0 warn, 0 pending |
| engine API direct test | PASS (now also covers v2: `world.remove`, `addVelocity`, `mass`, `ragdoll.mesh === group`) |
| station | PASS shape + 240-frame player sim (moved 9.5 m, grab OK), 0.36 ms/frame, 317 particles, clean dispose, reload OK |
| planet | PASS shape + sim (moved 14.4 m, grab OK), 0.30 ms/frame, 282 particles, clean dispose |
| spacewalk | PASS shape + zero-g sim (moved 24.3 m, thrust telemetry, grab OK), 0.26 ms/frame, 224 particles, clean dispose; create 170 ms in node (includes the 60-step tether pre-settle; fine behind the CRT transition) |
| hud.js / hud.css | PASS static API (12/12); player.js calls no hud methods |

## Items
- [FIXED] (owner: World) spacewalk.js:313 tether `TETHER_LEN = 34`, rope rest length ≈35 m — re-measured: every POI/portal is now reachable (farthest "Truss End: No Down" 32.5 m from the anchor, within 34 + 4 m targeting radius).
- No OPEN items (third consecutive clean pass; CI loop stopped).
- Note (no action): spacewalk.js now anchors the tether at z 6.45, outside the airlock collider; the rope is built from anchor to clip point with slack ≈ 35/|d| and pre-settled 60 steps inside `createSpacewalk` using contract calls only — no NaN, reach re-verified.

## Review notes (no action needed)
- spacewalk.js:320 now reads `player.yaw` (not in the Player contract; exists in player.js and is guarded with `Number.isFinite`) — OK, but Engine: keep `yaw` as a public field. New spawn (yaw 1.3) passes the spawn/box/sim checks.
- player.js arm rework: new `elbow` geometry is in `_geos`, so `dispose()` frees it; smoke shows no undisposed resources.
- main.js: switched `THREE.Clock` → `THREE.Timer` (+ `timer.connect(document)`); verified `THREE.Timer` exists in three r187 at runtime. Browser/visual findings live in `.agents/QA.md` (separate QA pass) — not duplicated here.
- player.js: passes capsule centre to `setPlayerCollider` (feet + HEIGHT/2) — matches physics. `dispose()` frees arm geos/mats, detaches camera, clears player collider. Grab uses `world.raycast`/`world.grab` per contract; RMB shove uses `applyImpulse` + small `explode`.
- player.js:617 `_history.push({ t, p: target.clone() })` allocates 2 small objects/frame while holding — negligible, optional to pool.
- spacewalk: `hud?.notify?.('TETHER TAUT')` throttled to 1 per 3 s — fine. Tether end follows a live Vector3 updated in `level.update` → lags the player by one frame (main.js order), invisible at 60 fps.
- hud.js own rAF loop only ticks typewriters/toasts; vitals stepped from `update()`. Original naming throughout (Lumen Orbital Medical / VL-7, Halcyon Ring, Cinder Reach).

## What smoke.mjs checks
- Engine: `new PhysicsWorld(scene)`, `createSoftBody` sphere/box/capsule with all contract options, `createRope` + `attachStart(Object3D)`/`attachEnd(mesh)`, `createRagdoll` stand/float/sit, bodies listed in `world.bodies`, `.kind` values, `center()/velocity()` → Vector3, `raycast` toward a soft body hits with `{body, point, distance}`, `grab(hit).setTarget/release(vel)`, `pinTo(obj)/pinTo(null)`, `explode`, zero-g; no NaN in `body.particles`.
- Levels: shape vs contract (Box3 boxes non-empty, environment numbers, POI category enum, `lines` 3–6 strings, portal targets are other real levels), spawn not inside any box/sphere (+0.1/+0.9/+1.6 m), walk levels: `ground(spawn)` finite and ≤ spawn.y.
- Directed grab: a soft body is translated 1.2 m in front of the eye, LMB held 40 frames with a mouse flick, released → must set `player.holding` + `telemetry().holding`, clear on release, no NaN.
- Sim: real Player + fake input, 240 frames @1/60 in main.js order; scripted W, Shift, Space, Ctrl (zero-g), A/D, mouse look, LMB hold 100–160 with a fast flick on release, RMB shove, F flop, wheel. No throws / NaN, walk levels never below `ground - 0.3`, player moves ≥ 0.5 m, telemetry fields/types/ranges.
- Physics passed to levels is a Proxy: **non-contract physics members or option keys FAIL**. Hud stub is a Proxy: **calling any hud method not in the contract FAILS**.
- Level switching station → planet → spacewalk → station with main.js dispose order; WARN on undisposed GPU resources.
- Static: hud.js API, no network asset loads, no copyrighted names.
