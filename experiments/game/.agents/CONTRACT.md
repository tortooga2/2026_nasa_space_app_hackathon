# VITAL-LINK — Build Contract (owned by Director; do not edit without Director)

A first-person, low-poly WebGL (three.js) game that demos a wearable **health monitor** styled like a
retro green-phosphor wrist computer. A space station is the hub; the player can travel to a **planet**
or go on a **spacewalk**. The physics is a **wobbly, soft-body sim**: jelly objects, floppy ragdoll
dummies, floppy first-person arms that grab and throw things. All original art and naming —
do NOT copy any existing game's names, characters, art or UI (no "Pip-Boy", "Vault", TABS/Peak assets).

## Run / check
- Node: use `/opt/homebrew/bin/node` (nvm default v18 is too old for Vite 8). Prefix commands with
  `export PATH=/opt/homebrew/bin:$PATH && cd /Users/chasenagle/Code/NASAHackathon/Claude-test && ...`
- `npx vite build` must pass. `npx oxlint src/game` must have no errors.
- `node scripts/smoke.mjs` (written by CI checker) headlessly creates each scene with the real
  PhysicsWorld and steps it ~120 frames. It must pass.
- three.js r187, import as `import * as THREE from 'three'`. Addons via `three/addons/...` allowed.
- No network assets. All geometry procedural. Low poly = `flatShading: true`, low segment counts.
- Units: meters, Y-up. Player eye height 1.6. Plain JS ES modules, JSDoc welcome, no TypeScript, no React.

## Coordination
- `.agents/CHECKS.md` — written continuously by the CI checker. Leads MUST read it before declaring done
  and fix every OPEN item in their files.
- Stay inside your own files. If you need a contract change, write it in `.agents/REQUESTS.md` and
  work around it; Director decides.

## File ownership
| File | Owner |
|---|---|
| index.html, src/game/main.js, src/game/core/input.js, this contract | Director |
| src/game/core/physics.js, src/game/core/player.js | Engine lead |
| src/game/scenes/lowpoly.js, station.js, planet.js, spacewalk.js | World lead |
| src/game/ui/hud.js, src/game/ui/hud.css | Interface lead |
| scripts/smoke.mjs, .agents/CHECKS.md | CI checker |

## Frame loop (main.js, already written — read it)
```
input → player.update(dt) → physics.step(dt) → level.update(dt, t, player) → interactions → hud.update(dt, telemetry) → render → input.endFrame()
```
dt is clamped to ≤ 1/30.

## Module APIs

### Input (core/input.js — done)
`input.down(code)` (KeyboardEvent.code e.g. 'KeyW','Space','ShiftLeft','ControlLeft'),
`input.pressed(code)` (this frame only), `input.mouseDown(btn)` (0 left, 2 right),
`input.mousePressed(btn)`, `input.mouseReleased(btn)`, `input.mouseDX/mouseDY` (pixels this frame),
`input.locked` (pointer lock active), `input.wheel` (deltaY this frame).

### PhysicsWorld (core/physics.js — Engine)
```js
new PhysicsWorld(scene)                 // meshes it creates are added to `scene` automatically
world.setGravity(g)                     // number, m/s^2 downward. 0 = zero-g (bodies drift, light damping)
world.setColliders(colliders)           // see Colliders below; also read by Player
world.colliders                         // the current colliders object
world.createSoftBody(opts) -> SoftBody  // pressurized jelly shell
   opts: { position:Vector3, radius=0.5, detail=1 (icosahedron detail), shape:'sphere'|'box'|'capsule',
           size?:Vector3 (box), color=0xffffff, stiffness=0.6 (0..1), pressure=1.0, mass=1,
           wobble=1 (visual jiggle multiplier), name?:string }
   SoftBody: { mesh, particles, center():Vector3, velocity():Vector3, applyImpulse(v:Vector3),
               translate(v), pinTo(obj3d|Vector3|null), userData:{} , kind:'soft' }
world.createRope(opts) -> Rope          // verlet rope rendered as low-poly tube/segments
   opts: { start:Vector3, end:Vector3, segments=20, color, thickness=0.03, slack=1.1 }
   Rope: { mesh, attachStart(obj3d|Vector3), attachEnd(obj3d|Vector3), particles, kind:'rope' }
         // attach targets are followed every step (Object3D world position or a live Vector3)
world.createRagdoll(opts) -> Ragdoll    // floppy crash-test-dummy astronaut (head, torso, arms, legs)
   opts: { position:Vector3, color=0xdddddd, scale=1, name?, pose?:'stand'|'sit'|'float' ,
           standStrength=0.6 (0 = fully limp, >0 tries to stay upright, wobbly), yaw=0 (radians) }
   Ragdoll: { group, particles, center(), applyImpulse(v), translate(v), kind:'ragdoll', userData:{} }
world.raycast(origin:Vector3, dir:Vector3, maxDist) -> { body, particle, point:Vector3, distance } | null
world.grab(hit) -> Grab { setTarget(Vector3), release(throwVelocity?:Vector3), body }
world.explode(point, radius, strength)  // radial impulse, for fun
world.bodies                            // array of all bodies
world.step(dt)                          // fixed sub-steps internally, collides with colliders & player
world.setPlayerCollider({ position:Vector3, radius }) // bodies get pushed by the player capsule
world.remove(body)                      // remove one body and free its mesh
body.addVelocity(v); body.mass          // extras (v2); ragdoll.mesh === ragdoll.group
world.dispose()
```

### Colliders (provided by each level)
```js
{
  ground: (x, z) => number,         // floor height under (x,z); return -Infinity for none (space)
  boxes: [THREE.Box3, ...],         // static solid AABBs (walls, consoles, truss)
  spheres: [{ center:Vector3, radius }],   // static solid spheres (rocks, asteroids)
  bounds?: THREE.Box3               // optional soft world limit; player/bodies gently pushed back
}
```

### Player (core/player.js — Engine)
```js
new Player({ camera, input, physics, scene, hud })
player.setEnvironment({ gravity:number, movement:'walk'|'zerog' })
player.teleport(position:Vector3, yaw=0)    // position = feet position
player.update(dt)                           // movement, collision vs physics.colliders, floppy arms, grab
player.position     // Vector3 feet position (read-only use)
player.head         // Object3D at eye (camera is a child of it or follows it)
player.velocity     // Vector3
player.holding      // body | null
player.telemetry()  // { exertion:0..1, speed, impact:0..1 (this frame, hard landings/bumps),
                    //   airborne:bool, holding:bool, thrusting:bool }
player.dispose()
```
Controls: WASD move, mouse look (pointer lock), Shift sprint, Space jump (walk) / ascend (zerog),
Ctrl/C descend (zerog), Left mouse = grab with floppy physics arms (hold to carry, release to drop;
moving the mouse fast while releasing throws), Right mouse = shove/slap impulse, E = interact (main.js),
Tab = toggle wrist device (main.js → hud).

### Level modules (scenes/*.js — World)
```js
export function createStation(ctx) / createPlanet(ctx) / createSpacewalk(ctx)
ctx = { THREE, scene, physics, camera, renderer, hud }   // scene is already created; populate it
returns {
  id: 'station'|'planet'|'spacewalk',
  name: 'string shown on HUD',
  gravity: number, movement: 'walk'|'zerog',
  spawn: { position: Vector3, yaw: number },
  colliders,                      // see above
  environment: { o2Drain:0..1, radiation:mSv/day, tempC:number, pressureKPa:number, vacuum:bool },
  pois: [Poi], portals: [Portal],
  update(dt, t, player),
  dispose()
}
Poi = { id, title, category: 'VITALS'|'PHYSIOLOGY'|'ENVIRONMENT'|'SYSTEMS'|'LOG',
        position: Vector3, radius: 2.5, lines: [string,...]  // 3–6 short lines, real space-health facts
        readout?: { label, value }                           // e.g. { label:'BONE LOSS', value:'1.5%/mo' }
        object?: Object3D }                                  // optional, highlighted when targeted
Portal = { id, label: 'Board drop pod → Kepler Ridge', target: 'station'|'planet'|'spacewalk',
           position: Vector3, radius: 2.5 }
```

### Hud (ui/hud.js + hud.css — Interface)
```js
new Hud(rootElement)          // #hud div overlaying the canvas; build all DOM inside it
hud.setLocation(level)        // level object above (name, environment, pois for codex count)
hud.update(dt, telemetry)     // telemetry = player.telemetry() + { scene:id, gravity, depth?:number }
hud.showPrompt(text | null)   // centre-bottom "[E] Scan: Med Bay Scanner"
hud.setTarget(poi | null)     // reticle state: aiming at a POI
hud.openEntry(poi)            // big readout panel with typewriter text; logs to codex
hud.closeEntry(); hud.isEntryOpen()
hud.toggleDevice()            // full wrist-device screen: vitals graphs, codex of discovered entries, map
hud.isDeviceOpen()
hud.notify(text)              // small toast
hud.transition(callback)      // CRT power-down → callback() → power-up
hud.showTitle(onStart)        // boot screen; onStart() called on click (main requests pointer lock)
```
Vitals simulated by the HUD from telemetry + environment: heart rate (ECG trace), SpO2, suit O2 %,
core temp, radiation dose accumulated, hydration, stress. Exertion raises HR; impacts spike HR & stress;
vacuum drains suit O2 slowly and refills in station.
