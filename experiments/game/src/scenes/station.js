// Vital-Link — Station hub: "HALCYON RING" spin-gravity station.
// Enclosed ~30×30 m deck: atrium + observation window (Earth), med bay, exercise deck, galley,
// crew quarters, life-support wall, drop-pod bay (→ planet) and airlock (→ spacewalk).

import * as THREE from 'three'
import { LowPolyKit, PALETTES, PHOSPHOR, rng } from './lowpoly.js'

const P = PALETTES.station
const HALF = 15 // interior half-extent (m)
const H = 5 // ceiling height

export function createStation(ctx) {
  const { scene, physics } = ctx
  const kit = new LowPolyKit(scene)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  scene.background = new THREE.Color(0x020406)
  scene.fog = new THREE.Fog(0x0b1416, 28, 160)

  // ---------------------------------------------------------------- lighting
  kit.lights({
    sky: 0xe4f0ff,
    ground: 0x7d8580,
    hemiIntensity: 1.2,
    sunColor: 0xfff3e0,
    sunIntensity: 1.5,
    direction: [0.35, 1, 0.45],
    distance: 30,
    area: 34,
    mapSize: 2048,
  })
  const earthLight = kit.pointLight(0x7fb6ff, 18, 22, [0, 3.5, -11])
  kit.pointLight(P.med, 10, 12, [-11.5, 4, 0])
  kit.pointLight(P.warm, 10, 12, [11, 4, 7])
  kit.pointLight(0xdfe8ff, 8, 12, [11, 4, -8])
  const alarm = kit.pointLight(P.red, 4, 6, [-11.5, 3.6, -13.6])
  const podGlow = kit.pointLight(PHOSPHOR, 4, 7, [5, 2.5, 12.5])

  // ---------------------------------------------------------------- shell
  // floor: base slab + tiles
  kit.box(HALF * 2 + 1, 0.2, HALF * 2 + 1, P.floor, { position: [0, -0.1, 0], cast: false })
  for (let i = -HALF + 3; i < HALF; i += 3) {
    kit.box(0.06, 0.01, HALF * 2, P.floorLine, { position: [i, 0.005, 0], cast: false })
    kit.box(HALF * 2, 0.01, 0.06, P.floorLine, { position: [0, 0.005, i], cast: false })
  }
  // zone floor decals
  kit.box(7, 0.012, 9, 0x3f5c58, { position: [-11.5, 0.008, 0], cast: false }) // med
  kit.box(7, 0.012, 9, 0x4a4b45, { position: [11.5, 0.008, -8.5], cast: false }) // gym
  kit.box(7, 0.012, 9, 0x56493c, { position: [11.5, 0.008, 7], cast: false }) // galley
  kit.cylinder(3.2, 3.2, 0.012, 8, 0x2f4140, { position: [0, 0.01, -3], cast: false }) // atrium ring

  // ceiling + light panels
  kit.box(HALF * 2 + 1, 0.3, HALF * 2 + 1, P.panel, { position: [0, H + 0.15, 0], cast: false, receive: false })
  for (let x = -10; x <= 10; x += 5) {
    for (let z = -10; z <= 10; z += 5) {
      kit.box(2.2, 0.06, 0.5, 0xffffff, { position: [x, H - 0.03, z], mat: kit.glow(0xf2f6ff, 1.1), cast: false, receive: false })
    }
  }
  // ceiling ribs
  for (let z = -12; z <= 12; z += 6) kit.box(HALF * 2, 0.35, 0.3, P.trim, { position: [0, H - 0.18, z], cast: false })

  // walls (visual, built around openings) — one solid collider per wall
  const wallT = 0.4
  const wallMat = kit.mat(P.hull)
  const wallBox = (w, h, d, x, y, z) => kit.box(w, h, d, P.hull, { position: [x, y, z], mat: wallMat, cast: false })
  // north wall (z = -15) with big observation window from x -8..8, y 1..4.4
  const WX = 8
  const WY0 = 1.0
  const WY1 = 4.4
  wallBox(HALF * 2, WY0, wallT, 0, WY0 / 2, -HALF - wallT / 2)
  wallBox(HALF * 2, H - WY1, wallT, 0, (H + WY1) / 2, -HALF - wallT / 2)
  wallBox(HALF - WX, WY1 - WY0, wallT, -(HALF + WX) / 2, (WY0 + WY1) / 2, -HALF - wallT / 2)
  wallBox(HALF - WX, WY1 - WY0, wallT, (HALF + WX) / 2, (WY0 + WY1) / 2, -HALF - wallT / 2)
  kit.windowFrame(WX * 2, WY1 - WY0, { position: [0, (WY0 + WY1) / 2, -HALF - 0.05], bars: 4, frame: P.trim })
  kit.boxCollider([-HALF - 1, -1, -HALF - wallT - 0.6], [HALF + 1, H + 1, -HALF])
  // south, east, west
  wallBox(HALF * 2, H, wallT, 0, H / 2, HALF + wallT / 2)
  kit.boxCollider([-HALF - 1, -1, HALF], [HALF + 1, H + 1, HALF + wallT + 0.6])
  wallBox(wallT, H, HALF * 2, HALF + wallT / 2, H / 2, 0)
  kit.boxCollider([HALF, -1, -HALF - 1], [HALF + wallT + 0.6, H + 1, HALF + 1])
  wallBox(wallT, H, HALF * 2, -HALF - wallT / 2, H / 2, 0)
  kit.boxCollider([-HALF - wallT - 0.6, -1, -HALF - 1], [-HALF, H + 1, HALF + 1])
  // ceiling collider (bodies can't escape upward)
  kit.boxCollider([-HALF - 1, H, -HALF - 1], [HALF + 1, H + 1, HALF + 1])

  // wall paneling and skirting (pure decoration, flush with walls)
  const r = rng(77)
  const panelAlong = (axis, fixed, from, to, rotY, skip) => {
    for (let s = from + 1.5; s < to; s += 3) {
      if (skip && skip(s)) continue
      const pos = axis === 'x' ? [s, 2.6, fixed] : [fixed, 2.6, s]
      kit.panel(2.7, 2.6, P.panel, r() < 0.3 ? P.panelDark : 0xb6bdb5, {
        position: pos,
        rotation: [0, rotY, 0],
        strip: r() < 0.35 ? PHOSPHOR : undefined,
      })
    }
  }
  panelAlong('x', HALF - 0.07, -HALF, HALF, Math.PI, (s) => s > 2 && s < 7) // south wall (skip pod bay)
  panelAlong('z', HALF - 0.07, -HALF, HALF, -Math.PI / 2, (s) => s > -14 && s < -4) // east (skip gym rig)
  panelAlong('z', -HALF + 0.07, -HALF, HALF, Math.PI / 2, (s) => s > 5) // west (skip life support)
  for (const [x, z, w, d] of [
    [0, HALF - 0.1, HALF * 2, 0.2],
    [0, -HALF + 0.1, HALF * 2, 0.2],
    [HALF - 0.1, 0, 0.2, HALF * 2],
    [-HALF + 0.1, 0, 0.2, HALF * 2],
  ]) {
    kit.box(w, 0.25, d, P.trim, { position: [x, 0.125, z], cast: false })
  }
  // spin-gravity sign + hull stripe
  kit.labelSprite('HALCYON RING  //  SPIN DECK 1  //  1.00 g', { position: [0, 4.75, -HALF + 0.3], height: 0.32 })
  kit.box(HALF * 2, 0.12, 0.05, P.accent, { position: [0, 0.6, -HALF + 0.02], mat: kit.glow(P.accent, 0.8), cast: false })

  // ---------------------------------------------------------------- outside the window
  const earth = kit.planetSphere(62, 'earth', { position: [-30, -40, -220], detail: 12, seed: 3 })
  earth.rotation.z = 0.41
  kit.stars(1400, 900, 11, 2)
  kit.sun([-320, 140, -700], 0xfff2d0, 60)
  // station truss glimpse outside window
  kit.box(40, 0.6, 0.6, 0x8d938f, { position: [0, 6.5, -40], cast: false })
  kit.box(3, 9, 0.1, 0x1f3a78, { position: [-14, 6.5, -40], matOpts: { metalness: 0.4, roughness: 0.35 }, cast: false })
  kit.box(3, 9, 0.1, 0x1f3a78, { position: [14, 6.5, -40], matOpts: { metalness: 0.4, roughness: 0.35 }, cast: false })

  // ---------------------------------------------------------------- atrium: holo table
  const holo = new THREE.Group()
  holo.position.set(0, 0, -3)
  kit.root.add(holo)
  kit.cylinder(1.1, 1.3, 0.9, 8, P.trim, { parent: holo, position: [0, 0.45, 0] })
  kit.cylinder(1.25, 1.25, 0.08, 8, P.panel, { parent: holo, position: [0, 0.94, 0] })
  kit.cylinder(0.9, 0.9, 0.02, 16, PHOSPHOR, { parent: holo, position: [0, 0.99, 0], mat: kit.glow(PHOSPHOR, 0.8), cast: false })
  kit.boxCollider([-1.25, 0, -4.25], [1.25, 1.0, -1.75])
  const miniEarth = kit.ball(0.45, PHOSPHOR, {
    parent: holo,
    position: [0, 1.75, 0],
    detail: 1,
    mat: kit.basic(PHOSPHOR, { wireframe: true, transparent: true, opacity: 0.7 }),
    cast: false,
  })
  const orbitRing = kit.mesh(new THREE.TorusGeometry(0.75, 0.012, 3, 24), kit.basic(PHOSPHOR, { transparent: true, opacity: 0.6 }), {
    parent: holo,
    position: [0, 1.75, 0],
    cast: false,
  })
  orbitRing.rotation.x = Math.PI / 2 - 0.9
  const orbiter = kit.box(0.08, 0.04, 0.04, PHOSPHOR, { parent: holo, mat: kit.glow(PHOSPHOR, 2), cast: false })
  // benches facing the window
  for (const x of [-4.5, 4.5]) {
    kit.box(2.6, 0.45, 0.7, P.panelDark, { position: [x, 0.225, -9], collider: true })
    kit.box(2.6, 0.06, 0.75, P.pad, { position: [x, 0.48, -9] })
  }

  // hydroponic planters (fresh greens: crew morale + vitamins)
  for (const x of [-5.5, 5.5]) {
    kit.box(2.4, 0.7, 0.9, P.panelDark, { position: [x, 0.35, 2], collider: true })
    kit.box(2.3, 0.08, 0.8, 0x4a3426, { position: [x, 0.72, 2], cast: false })
    for (let k = 0; k < 5; k++) {
      kit.ball(0.2 + (k % 2) * 0.06, k % 3 ? 0x5fb84a : 0x8bd16a, { position: [x - 0.9 + k * 0.45, 0.85, 2 + (k % 2 ? 0.15 : -0.15)], detail: 0, jitter: 0.05, seed: k + 40 })
    }
    for (const dz of [-0.45, 0.45]) kit.box(0.08, 1.4, 0.08, P.trim, { position: [x - 1.1, 1.1, 2 + dz] })
    kit.box(2.4, 0.08, 0.9, P.trim, { position: [x, 1.8, 2] })
    kit.box(2.2, 0.03, 0.6, 0xff4fd8, { position: [x, 1.75, 2], mat: kit.glow(0xff4fd8, 1.6), cast: false })
    kit.pointLight(0xff4fd8, 1.5, 1.6, [x, 1.45, 2]) // short range: lights the bed only, not the walkway
  }

  // ---------------------------------------------------------------- med bay (west)
  const bed = new THREE.Group()
  bed.position.set(-11.5, 0, 0)
  kit.root.add(bed)
  kit.box(2.3, 0.6, 0.95, P.panelDark, { parent: bed, position: [0, 0.3, 0] })
  kit.box(2.2, 0.16, 0.9, P.pad, { parent: bed, position: [0, 0.68, 0], jitter: 0.01 })
  kit.box(0.5, 0.12, 0.6, 0xffffff, { parent: bed, position: [-0.8, 0.8, 0] }) // pillow
  kit.boxCollider([-12.65, 0, -0.5], [-10.35, 0.76, 0.5])
  // scanner arch
  for (const z of [-0.8, 0.8]) {
    kit.box(0.2, 2.1, 0.2, P.trim, { parent: bed, position: [0.2, 1.05, z] })
    kit.boxCollider([-11.4, 0, z - 0.1], [-11.2, 2.1, z + 0.1])
  }
  kit.box(0.4, 0.2, 1.8, P.trim, { parent: bed, position: [0.2, 2.1, 0] })
  const scanBar = kit.box(0.1, 0.05, 1.5, P.med, { parent: bed, position: [0.2, 1.9, 0], mat: kit.glow(P.med, 2.5), cast: false })
  // med console + vitals screen on wall
  kit.console({ position: [-13.9, 0, -3.2], rotationY: Math.PI / 2, body: P.panelDark, screen: P.med, seed: 3 })
  const ecgScreen = kit.box(2.4, 1.3, 0.06, 0x07140f, { position: [-14.75, 2.6, -3.2], rotation: [0, Math.PI / 2, 0], cast: false })
  ecgScreen.material = kit.mat(0x07140f, { emissive: 0x0a2a1a, emissiveIntensity: 1 })
  const ecgPts = []
  for (let i = 0; i <= 24; i++) ecgPts.push(new THREE.Vector3(0, 0, 0))
  const ecgGeo = kit.track(new THREE.BufferGeometry().setFromPoints(ecgPts))
  const ecgLine = new THREE.Line(ecgGeo, kit.basic(PHOSPHOR))
  ecgLine.position.set(-14.69, 2.6, -3.2)
  kit.root.add(ecgLine)
  // med cabinet + red cross
  kit.box(0.6, 2.0, 1.6, 0xe6e9e3, { position: [-14.6, 1.0, 3.2], collider: true })
  kit.box(0.05, 0.5, 0.15, P.red, { position: [-14.28, 1.5, 3.2], mat: kit.glow(P.red, 0.8), cast: false })
  kit.box(0.05, 0.15, 0.5, P.red, { position: [-14.28, 1.5, 3.2], mat: kit.glow(P.red, 0.8), cast: false })
  kit.labelSprite('MED BAY', { position: [-11.5, 3.6, 0], height: 0.36 })

  // ---------------------------------------------------------------- exercise deck (east-north)
  const tread = new THREE.Group()
  tread.position.set(11.2, 0, -8.5)
  kit.root.add(tread)
  kit.box(1.0, 0.25, 2.4, P.trim, { parent: tread, position: [0, 0.125, 0] })
  kit.box(0.8, 0.03, 2.2, P.dark, { parent: tread, position: [0, 0.26, 0] })
  for (const x of [-0.5, 0.5]) {
    kit.box(0.06, 1.1, 0.06, P.panel, { parent: tread, position: [x, 0.8, -1.0] })
    kit.box(0.06, 0.06, 1.0, P.panel, { parent: tread, position: [x, 1.1, -0.5] })
  }
  kit.box(1.06, 0.4, 0.15, P.panelDark, { parent: tread, position: [0, 1.4, -1.05] })
  kit.box(0.6, 0.18, 0.02, PHOSPHOR, { parent: tread, position: [0, 1.45, -0.97], mat: kit.glow(PHOSPHOR, 1.2), cast: false })
  // bungee harness cords (decor) from floor anchors to a waist belt ring
  const belt = kit.mesh(new THREE.TorusGeometry(0.28, 0.03, 3, 10), kit.mat(P.warm), { parent: tread, position: [0, 1.05, 0.1] })
  belt.rotation.x = Math.PI / 2
  for (const x of [-0.45, 0.45]) kit.pipe([x + 11.2, 0.26, -8.4], [x * 0.6 + 11.2, 1.05, -8.4], 0.015, P.warm, { cast: false })
  kit.boxCollider([10.7, 0, -9.7], [11.7, 0.3, -7.3])
  kit.boxCollider([10.65, 0, -9.65], [11.75, 1.6, -9.4])
  // resistance rig against the east wall
  const rig2 = new THREE.Group()
  rig2.position.set(14.1, 0, -12)
  kit.root.add(rig2)
  kit.box(1.4, 0.15, 2.0, P.trim, { parent: rig2, position: [0, 0.075, 0] })
  for (const z of [-0.85, 0.85]) kit.box(0.15, 2.6, 0.15, P.panel, { parent: rig2, position: [0, 1.3, z] })
  kit.box(0.2, 0.2, 2.0, P.panelDark, { parent: rig2, position: [0, 2.6, 0] })
  const liftBar = kit.box(0.08, 0.08, 1.9, P.warm, { parent: rig2, position: [-0.25, 1.3, 0] })
  for (const z of [-0.6, 0.6]) kit.cylinder(0.14, 0.14, 0.9, 6, 0xb8bec0, { parent: rig2, position: [0.2, 0.7, z], matOpts: { metalness: 0.6, roughness: 0.3 } })
  kit.boxCollider([13.4, 0, -13.05], [15, 2.7, -10.95])
  // weights rack
  kit.box(0.8, 0.6, 1.4, P.panelDark, { position: [14.4, 0.3, -5.6], collider: true })
  kit.labelSprite('EXERCISE DECK', { position: [11.5, 3.6, -8.5], height: 0.36 })

  // ---------------------------------------------------------------- galley (east-south)
  kit.box(0.9, 1.0, 8, P.panelDark, { position: [14.55, 0.5, 7], collider: true })
  kit.box(1.0, 0.08, 8.1, P.pad, { position: [14.5, 1.04, 7] })
  kit.box(0.6, 1.6, 2.2, 0xdfe3dd, { position: [14.65, 2.4, 7], cast: false }) // overhead locker
  // water dispenser
  kit.box(0.5, 0.7, 0.5, P.panel, { position: [14.4, 1.43, 4.4], collider: true })
  const waterGlow = kit.box(0.04, 0.3, 0.3, P.blue, { position: [14.13, 1.5, 4.4], mat: kit.glow(P.blue, 1.5), cast: false })
  // table + stools
  kit.box(2.6, 0.08, 1.3, P.pad, { position: [10.5, 0.86, 7.5] })
  kit.box(0.25, 0.82, 0.25, P.trim, { position: [10.5, 0.41, 7.5] })
  kit.boxCollider([9.2, 0, 6.85], [11.8, 0.9, 8.15])
  for (const [x, z] of [[9.6, 6.3], [11.4, 6.3], [9.6, 8.7], [11.4, 8.7]]) {
    kit.cylinder(0.25, 0.22, 0.5, 6, P.warm, { position: [x, 0.25, z], collider: true })
  }
  kit.labelSprite('GALLEY', { position: [11.5, 3.6, 7], height: 0.36 })

  // ---------------------------------------------------------------- crew quarters (south-west)
  for (let i = 0; i < 3; i++) {
    const x = -12 + i * 2.8
    const pod = new THREE.Group()
    pod.position.set(x, 0, HALF - 0.75)
    kit.root.add(pod)
    kit.box(2.5, 2.6, 1.4, P.panel, { parent: pod, position: [0, 1.3, 0] })
    kit.box(2.0, 1.9, 0.1, P.dark, { parent: pod, position: [0, 1.35, -0.66] })
    kit.box(1.8, 0.4, 0.3, 0x4d6aa0, { parent: pod, position: [0, 0.65, -0.55] }) // sleeping bag
    kit.box(1.9, 0.05, 0.04, i === 1 ? P.warm : 0x2c5d9a, {
      parent: pod,
      position: [0, 2.2, -0.72],
      mat: kit.glow(i === 1 ? P.warm : 0x4f7fd0, 1.2),
      cast: false,
    })
    kit.labelSprite(`BERTH 0${i + 1}`, { parent: pod, position: [0, 2.85, -0.8], height: 0.22 })
  }
  kit.boxCollider([-13.4, 0, HALF - 1.5], [-5.0, 2.7, HALF])

  // ---------------------------------------------------------------- life-support wall (west-south)
  const ls = new THREE.Group()
  kit.root.add(ls)
  for (let i = 0; i < 3; i++) {
    kit.cylinder(0.45, 0.45, 2.6, 8, i === 1 ? 0x5d8fc2 : 0xdfe3dd, { parent: ls, position: [-14.4, 1.3, 6.4 + i * 1.1] })
    kit.cylinder(0.47, 0.47, 0.12, 8, P.trim, { parent: ls, position: [-14.4, 2.2, 6.4 + i * 1.1] })
  }
  kit.box(0.9, 2.4, 1.8, P.panelDark, { parent: ls, position: [-14.5, 1.2, 10.8] }) // scrubber
  const fanBlades = new THREE.Group()
  fanBlades.position.set(-14.03, 1.6, 10.8)
  ls.add(fanBlades)
  for (let k = 0; k < 4; k++) {
    const b = kit.box(0.04, 0.6, 0.12, P.panel, { parent: fanBlades, cast: false })
    b.rotation.x = (k * Math.PI) / 4
  }
  kit.cylinder(0.4, 0.4, 0.05, 8, P.trim, { parent: ls, position: [-14.06, 1.6, 10.8], rotation: [0, 0, Math.PI / 2] })
  const co2Lamp = kit.box(0.04, 0.2, 0.6, PHOSPHOR, { parent: ls, position: [-14.03, 2.6, 10.8], mat: kit.glow(PHOSPHOR, 1.4), cast: false })
  kit.boxCollider([-15, 0, 5.85], [-13.9, 2.7, 11.75])
  // pipes along the wall and ceiling
  for (let k = 0; k < 3; k++) {
    const y = 3.2 + k * 0.35
    kit.pipe([-14.7, y, 5.5], [-14.7, y, 12.5], 0.08, [0xb8bec0, P.blue, P.warm][k], { cast: false })
  }
  kit.pipe([-14.7, 3.2, 5.5], [-14.7, 3.2, -5], 0.08, 0xb8bec0, { cast: false })
  kit.pipe([-14.7, 4.6, 12.5], [8, 4.6, 12.5], 0.1, 0xb8bec0, { cast: false })
  kit.labelSprite('LIFE SUPPORT', { position: [-13.5, 3.9, 9], height: 0.3 })

  // ---------------------------------------------------------------- drop-pod bay (south)
  const podBay = new THREE.Group()
  podBay.position.set(5, 0, HALF - 1.2)
  kit.root.add(podBay)
  kit.cylinder(1.4, 1.4, 0.2, 8, P.trim, { parent: podBay, position: [0, 0.1, 0] })
  kit.cylinder(1.4, 1.4, 4.6, 8, P.glass, {
    parent: podBay,
    position: [0, 2.4, 0],
    open: true,
    mat: kit.track(new THREE.MeshStandardMaterial({ color: P.glass, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })),
    cast: false,
  })
  kit.cylinder(0.7, 1.05, 1.6, 8, 0xe9e4d6, { parent: podBay, position: [0, 1.0, 0], jitter: 0.02 })
  kit.cylinder(0.25, 0.7, 0.7, 8, 0xe9e4d6, { parent: podBay, position: [0, 2.15, 0] })
  kit.cylinder(1.07, 1.07, 0.2, 8, 0x8a3b2a, { parent: podBay, position: [0, 0.3, 0] }) // heat shield
  kit.box(0.5, 0.3, 0.05, PHOSPHOR, { parent: podBay, position: [0, 1.2, -0.9], mat: kit.glow(PHOSPHOR, 1.5), cast: false })
  kit.boxCollider([3.5, 0, HALF - 2.6], [6.5, H, HALF])
  const podPortalPos = V(5, 0, HALF - 4.2)
  kit.portalMarker(podPortalPos, 'DROP POD  >  CINDER REACH', { labelY: 2.7 })

  // ---------------------------------------------------------------- airlock (north-west)
  const lock = new THREE.Group()
  lock.position.set(-11.5, 0, -HALF + 0.05)
  kit.root.add(lock)
  kit.box(3.0, 3.4, 0.3, P.trim, { parent: lock, position: [0, 1.7, 0.1] })
  kit.cylinder(1.1, 1.1, 0.2, 8, 0xbfc5bd, { parent: lock, position: [0, 1.4, 0.3], rotation: [Math.PI / 2, 0, 0] })
  kit.cylinder(0.25, 0.25, 0.25, 6, P.trim, { parent: lock, position: [0, 1.4, 0.45], rotation: [Math.PI / 2, 0, 0] })
  for (let k = 0; k < 6; k++) {
    // hazard chevrons
    kit.box(0.35, 0.12, 0.05, k % 2 ? 0x1a1a1a : P.warm, { parent: lock, position: [-1.0 + k * 0.4, 3.1, 0.28], cast: false })
  }
  const alarmLamp = kit.box(0.3, 0.15, 0.15, P.red, { parent: lock, position: [0, 3.55, 0.3], mat: kit.glow(P.red, 2), cast: false })
  kit.boxCollider([-13.0, 0, -HALF], [-10.0, 3.4, -HALF + 0.45])
  // EVA suit rack beside the airlock
  const suit = new THREE.Group()
  suit.position.set(-14.4, 0, -11)
  kit.root.add(suit)
  kit.box(0.6, 0.8, 0.5, 0xf1f0ea, { parent: suit, position: [0, 1.5, 0] })
  kit.ball(0.22, 0xf1f0ea, { parent: suit, position: [0, 2.1, 0], detail: 1 })
  kit.box(0.02, 0.18, 0.3, 0xd4a640, { parent: suit, position: [0.22, 2.12, 0], mat: kit.mat(0xd4a640, { metalness: 0.8, roughness: 0.2 }) })
  for (const z of [-0.18, 0.18]) kit.box(0.2, 0.9, 0.2, 0xf1f0ea, { parent: suit, position: [0, 0.65, z] })
  kit.box(0.35, 0.7, 0.55, 0xd8d8d0, { parent: suit, position: [-0.4, 1.5, 0] }) // backpack
  kit.boxCollider([-15, 0, -11.4], [-14.0, 2.4, -10.6])
  const lockPortalPos = V(-11.5, 0, -HALF + 1.9)
  kit.portalMarker(lockPortalPos, 'AIRLOCK  >  EVA', { labelY: 2.5, uprightY: 1.3 })

  // ---------------------------------------------------------------- crates & clutter
  kit.crate(0.8, 0xc7a35a, P.trim, { position: [7.6, 0.4, 13.6], collider: true })
  kit.crate(0.6, 0xc7a35a, P.trim, { position: [7.6, 1.1, 13.6], rotation: [0, 0.4, 0], collider: true })
  kit.crate(0.7, 0x8aa2a0, P.trim, { position: [-6.2, 0.35, -13.8], collider: true })
  kit.crate(0.7, 0x8aa2a0, P.trim, { position: [13.8, 0.35, 13.8], rotation: [0, 0.3, 0], collider: true })

  // ---------------------------------------------------------------- physics toys
  const medDummy = physics.createRagdoll({ position: V(-12.1, 0.78, 0), yaw: Math.PI / 2, color: 0xe8c86a, scale: 1, pose: 'sit', standStrength: 0, name: 'MED-DUMMY' }) // yaw π/2: legs point +x along the bed, back to the pillow
  const gymBall = physics.createSoftBody({ position: V(9.6, 0.7, -6.2), radius: 0.45, detail: 2, color: 0xff6a3d, stiffness: 0.45, pressure: 1.3, mass: 1.5, wobble: 1.4, name: 'Gym jelly ball' })
  const foodColors = [0xff8c42, 0x7ed957, 0xffd23f, 0xd65db1]
  const food = foodColors.map((c, i) =>
    physics.createSoftBody({
      position: V(9.7 + i * 0.55, 1.12, 7.5 + (i % 2 ? 0.25 : -0.25)),
      shape: 'box',
      size: V(0.34, 0.14, 0.26),
      color: c,
      stiffness: 0.55,
      pressure: 1.1,
      mass: 0.4,
      wobble: 1.6,
      name: `Ration pack ${i + 1}`,
    }),
  )
  const stressBall = physics.createSoftBody({ position: V(-4.5, 0.85, -9), radius: 0.22, detail: 1, color: PHOSPHOR, stiffness: 0.4, pressure: 1.0, mass: 0.3, wobble: 2, name: 'Stress jelly' })
  const toys = [medDummy, gymBall, stressBall, ...food]

  // ---------------------------------------------------------------- POIs
  const pois = [
    {
      id: 'st-window',
      title: 'Observation Window',
      category: 'PHYSIOLOGY',
      position: V(0, 1.4, -13.4),
      radius: 3,
      lines: [
        'Orbital velocity: ~7.7 km/s. You lap the planet every ~90 min.',
        'Seeing the whole planet at once can trigger the "overview effect":',
        'a lasting shift toward awe and connectedness reported by many crew.',
        'Long missions still mean isolation, so crews get private family calls',
        'and scheduled check-ins with psych support. Stress counts as a vital.',
      ],
      readout: { label: 'ORBIT PERIOD', value: '~92 min' },
    },
    {
      id: 'st-holo',
      title: 'Radiation Dosimeter',
      category: 'ENVIRONMENT',
      position: V(0, 1.5, -1.6),
      lines: [
        'In low Earth orbit crews absorb ~0.5–1 mSv per DAY.',
        'Background dose on Earth: ~3 mSv per YEAR. Do the maths.',
        'Earth’s magnetic field still deflects most charged particles up here.',
        'Every crew member wears a personal dosimeter; this unit logs yours.',
        'NASA career limit: 600 mSv. Pace yourself.',
      ],
      readout: { label: 'CABIN DOSE', value: '0.5 mSv/day' },
    },
    {
      id: 'st-scanner',
      title: 'Med Bay Scanner',
      category: 'PHYSIOLOGY',
      position: V(-10.4, 1.3, 1.25),
      radius: 2.8,
      lines: [
        'Without gravity ~2 L of body fluid shifts toward the head.',
        'Result: puffy face, "bird legs", stuffy sinuses.',
        'Pressure on the eyes can flatten the eyeball and swell the optic nerve:',
        'Spaceflight-Associated Neuro-ocular Syndrome (SANS).',
        'Crew vision is checked in flight. The dummy declined comment.',
      ],
      readout: { label: 'FLUID SHIFT', value: '~2 L headward' },
    },
    {
      id: 'st-cardio',
      title: 'Cardio Monitor',
      category: 'VITALS',
      position: V(-13.0, 1.5, -3.2),
      lines: [
        'In microgravity the heart works less and blood plasma drops ~10–20%.',
        'Back under gravity, blood pools in the legs: dizziness on standing,',
        'known as orthostatic intolerance.',
        'Countermeasures: cardio, fluid + salt loading before re-entry,',
        'and compression garments. Your HR trace is on the wrist unit.',
      ],
      readout: { label: 'PLASMA VOL', value: '-10–20%' },
    },
    {
      id: 'st-gym',
      title: 'Exercise Deck',
      category: 'PHYSIOLOGY',
      position: V(11.4, 1.3, -6.4),
      radius: 3,
      lines: [
        'Unloaded bones lose ~1–1.5% mineral density per month,',
        'mostly hips and spine. Muscles waste fast too.',
        'Counter-measure: ~2.5 h of exercise per day, every day.',
        'Treadmill with a bungee harness + a vacuum-cylinder resistance rig.',
        'Your exertion log feeds the wrist unit. Skip leg day at your peril.',
      ],
      readout: { label: 'BONE LOSS', value: '1–1.5%/mo' },
    },
    {
      id: 'st-galley',
      title: 'Galley Water Loop',
      category: 'SYSTEMS',
      position: V(13.2, 1.4, 5.0),
      lines: [
        'Station water recovery reclaims ~98% of crew water,',
        'including sweat, breath humidity and urine.',
        'Today’s coffee is yesterday’s coffee. Mostly.',
        'Fluid shift dulls thirst, so crews drink on a schedule.',
        'Hydration is tracked on your wrist. Sip something.',
      ],
      readout: { label: 'H2O RECOVERY', value: '98%' },
    },
    {
      id: 'st-sleep',
      title: 'Crew Quarters',
      category: 'VITALS',
      position: V(-9.2, 1.4, 12.6),
      radius: 3,
      lines: [
        'In orbit you get ~16 sunrises and sunsets a day.',
        'Circadian rhythm gets confused; crews average only ~6 h of sleep.',
        'Tunable LED lighting shifts blue/warm to cue day and night.',
        'Each berth has a fan: in still air, exhaled CO2 can pool around your head.',
        'Spine also stretches up to ~3% without gravity. Mind your bunk length.',
      ],
      readout: { label: 'SUNRISES/DAY', value: '16' },
    },
    {
      id: 'st-ls',
      title: 'Life Support Wall',
      category: 'ENVIRONMENT',
      position: V(-12.8, 1.5, 8.8),
      lines: [
        'Cabin CO2 on a station runs ~5–10x higher than Earth’s air.',
        'Even a few mmHg is linked to headaches and foggy thinking.',
        'Scrubbers pull CO2; oxygen is made by splitting water (electrolysis).',
        'Cabin air: ~101 kPa, ~21% O2 — just like home.',
        'Headache logged? Check the scrubber before blaming the coffee.',
      ],
      readout: { label: 'ppCO2', value: '~2.5 mmHg' },
    },
  ]

  const portals = [
    { id: 'pt-pod', label: 'Board drop pod → Cinder Reach', target: 'planet', position: V(podPortalPos.x, 1.2, podPortalPos.z), radius: 2.5 },
    { id: 'pt-airlock', label: 'Cycle airlock → Spacewalk', target: 'spacewalk', position: V(lockPortalPos.x, 1.2, lockPortalPos.z), radius: 2.5 },
  ]

  // POI beacons above each object
  for (const poi of pois) kit.beacon(poi.position.clone().add(V(0, 0.9, 0)))

  // ---------------------------------------------------------------- colliders
  const colliders = {
    ground: () => 0,
    boxes: kit.colliders.boxes,
    spheres: kit.colliders.spheres,
    bounds: new THREE.Box3(V(-HALF + 0.3, -2, -HALF + 0.3), V(HALF - 0.3, H, HALF - 0.3)),
  }

  // ---------------------------------------------------------------- animation
  const ecgPos = ecgGeo.attributes.position
  const ecg = (u) => {
    const k = u % 1
    if (k < 0.08) return Math.sin((k / 0.08) * Math.PI) * 0.08
    if (k < 0.16) return 0
    if (k < 0.19) return -0.12
    if (k < 0.23) return 0.5
    if (k < 0.27) return -0.18
    if (k < 0.45) return 0
    if (k < 0.6) return Math.sin(((k - 0.45) / 0.15) * Math.PI) * 0.14
    return 0
  }

  function update(dt, t) {
    kit.update(dt, t)
    earth.rotation.y = t * 0.02
    if (earth.userData.clouds) earth.userData.clouds.rotation.y = t * 0.006
    miniEarth.rotation.y = t * 0.5
    orbiter.position.set(Math.cos(t * 1.2) * 0.75, 1.75 + Math.sin(t * 1.2) * 0.75 * Math.sin(0.9), Math.sin(t * 1.2) * 0.75 * Math.cos(0.9))
    scanBar.position.x = 0.2 + Math.sin(t * 1.4) * 0.9
    alarm.intensity = 2 + (Math.sin(t * 4) > 0.6 ? 5 : 0)
    alarmLamp.visible = Math.sin(t * 4) > 0
    podGlow.intensity = 3 + Math.sin(t * 2) * 1.5
    earthLight.intensity = 16 + Math.sin(t * 0.3) * 3
    fanBlades.rotation.x = t * 8
    co2Lamp.visible = Math.sin(t * 1.1) > -0.9
    waterGlow.scale.y = 1 + Math.sin(t * 3) * 0.1
    liftBar.position.y = 1.3 + Math.sin(t * 1.2) * 0.25
    for (let i = 0; i < ecgPos.count; i++) {
      const u = i / (ecgPos.count - 1)
      ecgPos.setXYZ(i, 0, ecg(u * 2 - t * 1.1) * 1.0, (u - 0.5) * 2.2)
    }
    ecgPos.needsUpdate = true
  }

  function dispose() {
    kit.dispose()
    toys.length = 0
    scene.fog = null
    scene.background = null
  }

  return {
    id: 'station',
    name: 'HALCYON RING — Spin Deck',
    gravity: 9.81,
    movement: 'walk',
    spawn: { position: V(0, 0, 6), yaw: 0 },
    colliders,
    environment: { o2Drain: 0, radiation: 0.5, tempC: 22, pressureKPa: 101.3, vacuum: false },
    pois,
    portals,
    update,
    dispose,
  }
}
