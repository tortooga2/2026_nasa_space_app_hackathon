# Vital-Link — Browser Integration QA

## RE-VERIFY (2nd pass, GPU/Metal headless Chrome, 1600x900 + 1280x720)
Console: clean, with 0 errors, 0 warnings and 0 pageerrors across station, planet and spacewalk at both sizes. Frame rate is about 60 fps (vsync) in every scene.
All 11 first-pass findings are verified fixed:
- No tether bar on spacewalk arrival, and the rope reads well once you thrust out.
- The station walkway is not pink.
- The polyline error is gone and the torso lines are drawn.
- The MAP labels no longer clip or overlap.
- The STAT charts are pre-filled.
- The reticle is clean while a readout is open.
- The LOC title splits cleanly.
- `THREE.Timer` is in use.
- The spawn faces the truss.
- F flop works: mid-flop shots show the camera tumbling.

Shots: /private/tmp/claude-501/-Users-chasenagle-Code-NASAHackathon-Claude-test/ac079012-a197-4a17-94c4-b08596172bde/scratchpad/qa/shots2/ (prefixes 1600- and 1280-)

New issues:
- [FIXED] (owner: Engine; shoulders anchored below the frame, elbows bent out at the lower corners, forearms diagonal inward to chunky mitten gloves ~35% up, thicker tapered segments, more lag/overshoot; reaching keeps the elbow kink and stretches the forearm — docs/screenshots/station.png) src/game/core/player.js (arm rest pose) — the new elbow bend and droop is not visible in a still frame. Only the forearms are in view, and they read as two thin straight rods angled up from the bottom edge, smaller in frame than in pass 1. — evidence: shots2/1600-03-station.png, 1600-17-planet-walk.png, 1600-25c-flop-eva.png — fix: bring the elbow into view by lowering the shoulder anchor or moving it out a little, add ~25–35° of rest flexion so the upper arm shows a visible angle, and/or raise the hands a little so the bend sits in the bottom third of the frame.
- [FIXED] (owner: Engine; flop camera kept ≥0.35 m above ground(x,z), pitch clamped to -0.3..+0.55 rad and roll to ±0.7 so horizon/sky stay in frame; verified 5 planet flops at 0.5 s — docs/screenshots/flop.png) src/game/core/player.js (flop) — about 0.5 s into a flop on the planet, the camera points at flat sky or terrain with nothing recognisable and the arms out of frame. Viewers see a blank orange screen. — evidence: shots2/1600-17b-flop-planet.png (the station flop, 1600-09d, reads well) — fix: clamp the flop pitch to about ±60° so the horizon or arms stay in view.

---
## First pass (all items below fixed)

Run: 2026-11-14, `npx vite --port 5199`, headless Chrome (puppeteer-core), 1600x900.
Driver: key events plus a test-harness pointer-lock shim injected with `evaluateOnNewDocument`, so mouse-look works headless. No game files were edited.
Route: title → click → station → Tab (STAT/CODEX/MAP) → walk W to the Radiation Dosimeter → E scan → turn and walk to the drop pod → E → planet. A second run took the airlock → E → spacewalk. Both portals work in the real browser.

## Console (whole session, all three scenes)
- `[error] Error: <polyline> attribute points: Expected number, "…,42 50,60 70,42 M26,70 50,60 74,…"` (once, at load)
- `[warn] THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` (once)
- `GL Driver Message … GPU stall due to ReadPixels` came from the screenshot capture, not the game. Ignore it.
- No pageerrors and no failed requests.

## Frame rate (rAF over 3 s)
- Headless Chrome on GPU (ANGLE Metal, Apple M1 Pro): **58.5 fps** in the station, which is the vsync cap. Plausible.
- SwiftShader (software): 11.7 fps in the station, 15.9 on the planet, 15.6 on the spacewalk. This is CPU rasterisation only and does not reflect real hardware.

## Findings (most severe first)
- [FIXED] (owner: World; tether now clips on at hip +0.9 m and 0.35 m behind the view yaw, thickness 0.03→0.016) src/game/scenes/spacewalk.js:174-177,315 — the yellow tether is attached at `player.position + (0,1,0)` and the spawn faces the anchor, so the rope runs as a thick vertical yellow bar straight up through the reticle when you arrive on the spacewalk. It is the first thing a viewer sees there. — evidence: shots/22-spacewalk-arrive.png — fix: attach the tether end behind and below the camera, e.g. `player.position + (0,0.9,0) - forward*0.35` using the player yaw, or skip rendering the last 2–3 segments nearest the player.
- [FIXED] (owner: World; replaced with one short-range light per planter: x=±5.5, y 1.45, intensity 1.5, distance 1.6) src/game/scenes/station.js:163 — `kit.pointLight(0xff4fd8, 3, 4, [0, 1.6, 2])`, the magenta grow-light, sits in the centre walkway one step ahead of spawn. It tints the first-person arms hot pink/purple whenever the player walks toward the central dosimeter, which is the first POI. The arms look like a different model. — evidence: shots/07-poi-targeted.png, shots/08-poi-readout.png, shots/11-arms-grab.png versus the normal arms in shots/03-station.png — fix: move the light over the planters (the planters' x position, y≈1.7), or drop its distance to about 1.5 so it only lights the beds.
- [FIXED] (owner: Interface) src/game/ui/hud.js:559 — `<polyline points="… M26,70 …">` is invalid because polyline does not accept path commands. It throws a console error on every load, and the torso edge lines of the BODY SYSTEMS figure are not drawn. — evidence: the console error above and shots/04-device-stat.png — fix: use `svg('path', { class: 'vl-edge', d: 'M30,42 50,60 70,42 M26,70 50,60 74,70 M50,60 50,100' })`, or use three polylines. — FIXED (Interface): path d= instead of polyline.
- [FIXED] (owner: Interface) src/game/ui/hud.js (MAP tab) / hud.css — orbit-diagram labels collide with other elements. "EXTRAVEHICUL…" is clipped by the location list on the right, and the "PLANETARY SURFACE" marker and label sit on top of the planet disc. — evidence: shots/06-device-map.png, shots/19-device-planet-map.png — fix: give the diagram a fixed width with `overflow:visible` and right-align or shorten the labels ("EVA SITE"). Place the planet node outside the disc radius, or put the label on the left. — FIXED (Interface): re-laid-out diagram: short labels (EVA SITE / SURFACE SITE) clear of the disc, overflow visible.
- [FIXED] (owner: Interface) src/game/ui/hud.js (STAT tab) — the HR, OXYGEN and DOSE history charts are almost empty in the first minutes: one short tick at the far right edge. Opened early in a demo, the device looks broken. — evidence: shots/04-device-stat.png — fix: pre-fill the history buffer with baseline samples (HR ~70, SpO2 98, tank 100) at construction, or stretch the x-axis to the available samples until 3 min have elapsed. — FIXED (Interface): history pre-filled with resting baseline + noise.
- [FIXED] (owner: Interface) src/game/ui/hud.css (biomonitor panel) — the bottom-left biomonitor panel covers the left forearm and its green wrist screen, so the "wrist device" prop is never visible. At 1280x720 it covers more of the arm. — evidence: shots/03-station.png, shots/27-station-1280x720.png — fix: make the panel narrower or more translucent, or move the arm and wrist screen slightly right (Engine: player.js arm rest pose). — FIXED (Interface): panel 20.5em @0.82 font, anchored further into corner, 50% bg; wrist slab now visible.
- [FIXED] (owner: Interface) src/game/ui/hud.css (LOC panel) — the location name wraps at an awkward point ("HALCYON RING — SPIN / DECK", "CINDER REACH — / SURFACE"), leaving a dangling dash. — evidence: shots/03-station.png, shots/15-planet-arrive.png — fix: widen the panel slightly, or render the part after "—" as the sub-line. — FIXED (Interface): name split at "—": main name nowrap+ellipsis, area on its own line.
- [FIXED] (owner: Interface) src/game/ui/hud.js (POI readout) — while a readout is open, the reticle's "SCAN" caption and the in-world POI category label overlap the hologram at screen centre ("ENVIRONMENT" text drawn over the wireframe). — evidence: shots/08-poi-readout.png, shots/07-poi-targeted.png — fix: hide the reticle caption while an entry is open, or offset the caption below the reticle. — FIXED (Interface): reticle caption hidden while an entry is open.
- [FIXED] (owner: World; spawn moved to (7,2.6,11.5), yaw 1.3, facing the crewmate and hab with the truss beyond; the airlock portal is behind-right, 6.6 m from the eye, out of the prompt cone and reachable) src/game/scenes/spacewalk.js:359 — the spawn faces the airlock hatch at about 5 m, so the first W/thrust drifts the player back into the return portal and its huge sign fills the lower screen. — evidence: shots/25-spacewalk-thrust.png — fix: spawn with yaw ≈ π so the player faces the truss and the ragdoll astronaut (the good view in shots/24-spacewalk-look2.png).
- [FIXED] (owner: Director) src/game/main.js:89 — `THREE.Clock` is deprecated in r187 and logs a console warning. — evidence: the console warning above — fix: `const timer = new THREE.Timer()`, then `timer.update(); const dt = Math.min(timer.getDelta(), 1/30)` each frame.
- [FIXED] (owner: Interface) src/game/ui/hud.css (.vl-toasts) — the "ARRIVED: CINDER REAC" toast was clipped at the right edge in one capture. This may only be the slide-in animation frame, since the longer EVA toast rendered fully. — evidence: shots/14-transition.png versus shots/22-spacewalk-arrive.png — fix: check that the toast's max-width and right padding hold during `vl-toast-in`. — FIXED (Interface): mid-typewriter capture, not clipping; slide-in is now vertical and toasts wrap within max-width.

## Verified OK
- The scenes are lit and readable: the station is bright with Earth visible in the window, the planet has a warm sky and terrain, and the spacewalk has its starfield, hull and ragdoll astronaut. Nothing renders black.
- The title boot screen and controls card are legible. Clicking starts the game.
- The POI prompt, the typewriter readout, the codex logging ("1 of 8 discovered") and the codex detail view all work.
- Portal prompts plus E work for the station→planet and station→spacewalk routes, and the transition runs.
- The device opens and closes with Tab, and keys 1/2/3 switch tabs.
- The arms in their normal state look reasonable: chunky suited forearms with orange cuffs, in a sensible place in the frame.

## Screenshots
Directory: /private/tmp/claude-501/-Users-chasenagle-Code-NASAHackathon-Claude-test/ac079012-a197-4a17-94c4-b08596172bde/scratchpad/qa/shots/
01-title, 01b-title-complete, 02-after-start, 03-station, 04-device-stat, 05-device-codex, 06-device-map, 07-poi-targeted, 08-poi-readout, 09-device-codex-after-scan, 10-arms-look-down, 11-arms-grab, 12-facing-pod, 13-pod-prompt, 14-transition, 15-planet-arrive, 16-planet-look, 17-planet-walk, 18-device-planet-stat, 19-device-planet-map, 20-facing-airlock, 21-airlock-prompt, 22-spacewalk-arrive, 23-spacewalk-look, 24-spacewalk-look2, 25-spacewalk-thrust, 26-device-eva-stat (CODEX tab), 27-station-1280x720 (.png)

README copies: docs/screenshots/station.png (03), planet.png (17), spacewalk.png (24), device.png (26).
