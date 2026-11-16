// Vital-Link — Planet surface: "CINDER REACH", a fictional dusty red world with Mars-like 0.38 g.
// Low-poly heightfield valley (ground(x,z) samples the exact mesh triangles), surface hab, rover,
// ice crater, dust-storm mast, wobbly crewmates and bouncy regolith blobs. Portal back to station.

import * as THREE from 'three'
import { LowPolyKit, PALETTES, PHOSPHOR, fbm2, noise2, rng, smoothstep } from './lowpoly.js'

const P = PALETTES.planet
const SIZE = 180 // terrain side (m)
const SEG = 60 // cells per side (3 m cells)
const CELL = SIZE / SEG
const SEED = 1337
const PLAY = 60 // playable half-extent (m)

// Feature sites (x, z)
const SITES = {
  pad: [0, 22],
  hab: [20, -6],
  rover: [-11, 5],
  mast: [30, 24],
  crew: [6, -22],
  crater: [-28, -22],
}
const CRATER_R = 9

function rawHeight(x, z) {
  let h = (fbm2(x * 0.018 + 10, z * 0.018 - 4, 4, SEED) - 0.5) * 9
  h += (noise2(x * 0.11, z * 0.11, SEED + 9) - 0.5) * 0.9
  // valley rim rising into ridges beyond the playable area
  const r = Math.hypot(x, z)
  h += smoothstep(PLAY - 6, PLAY + 28, r) * (14 + fbm2(x * 0.05, z * 0.05, 3, SEED + 3) * 16)
  // impact crater with raised rim
  const [cx, cz] = SITES.crater
  const d = Math.hypot(x - cx, z - cz)
  if (d < CRATER_R) h -= 4.2 * (1 - (d / CRATER_R) ** 2)
  h += 1.6 * Math.exp(-(((d - CRATER_R) / 2.6) ** 2))
  return h
}

// flatten building pads to their own centre height
const PADS = [
  { at: SITES.pad, r: 6 },
  { at: SITES.hab, r: 9 },
  { at: SITES.rover, r: 4.5 },
  { at: SITES.mast, r: 3 },
  { at: SITES.crew, r: 5 },
].map((p) => ({ x: p.at[0], z: p.at[1], r: p.r, h: rawHeight(p.at[0], p.at[1]) }))

function shapedHeight(x, z) {
  let h = rawHeight(x, z)
  for (const p of PADS) {
    const w = 1 - smoothstep(p.r, p.r + 5, Math.hypot(x - p.x, z - p.z))
    if (w > 0) h += (p.h - h) * w
  }
  return h
}

// Height grid (shared by mesh + ground())
const N = SEG + 1
const HEIGHTS = new Float32Array(N * N)
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) HEIGHTS[j * N + i] = shapedHeight(-SIZE / 2 + i * CELL, -SIZE / 2 + j * CELL)
}
const hv = (i, j) => HEIGHTS[j * N + i]

/**
 * Exact height of the rendered terrain at (x,z). Each cell is split along the (i,j+1)–(i+1,j)
 * diagonal into triangles (a,b,d) and (b,c,d) — the same split used to build the mesh.
 */
export function planetGround(x, z) {
  let gx = (x + SIZE / 2) / CELL
  let gz = (z + SIZE / 2) / CELL
  gx = Math.min(SEG - 1e-6, Math.max(0, gx))
  gz = Math.min(SEG - 1e-6, Math.max(0, gz))
  const i = Math.floor(gx)
  const j = Math.floor(gz)
  const u = gx - i
  const v = gz - j
  const ha = hv(i, j)
  const hb = hv(i, j + 1)
  const hc = hv(i + 1, j + 1)
  const hd = hv(i + 1, j)
  if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v
  return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v)
}

export function createPlanet(ctx) {
  const { scene, physics } = ctx
  const kit = new LowPolyKit(scene)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const ground = planetGround
  const G = (x, z) => ground(x, z)

  scene.background = new THREE.Color(P.skyHorizon)
  scene.fog = new THREE.Fog(0xd39a72, 45, 290)

  // ---------------------------------------------------------------- sky + light
  kit.skyDome(900, [
    [-1, 0xd39a72],
    [0.0, 0xe3a77c],
    [0.12, 0xc9805a],
    [0.45, 0x8a4f45],
    [1, 0x3a2633],
  ])
  const sunDir = new THREE.Vector3(-0.55, 0.55, -0.62).normalize()
  kit.sun(sunDir.clone().multiplyScalar(800), 0xfff0dc, 34)
  // small fictional moon
  kit.ball(9, 0x9b8f86, { position: [420, 300, 520], detail: 1, jitter: 1.2, matOpts: { fog: false }, cast: false, receive: false })
  const light = kit.lights({
    sky: 0xffd9b8,
    ground: 0x6a3020,
    hemiIntensity: 0.95,
    sunColor: 0xffe6c8,
    sunIntensity: 2.4,
    direction: [sunDir.x, sunDir.y, sunDir.z],
    distance: 70,
    area: 80,
    mapSize: 2048,
  })

  // ---------------------------------------------------------------- terrain mesh
  {
    const cellCount = SEG * SEG
    const pos = new Float32Array(cellCount * 6 * 3)
    const col = new Float32Array(cellCount * 6 * 3)
    const c = new THREE.Color()
    const tmp = new THREE.Color()
    const [cx, cz] = SITES.crater
    let k = 0
    const put = (i, j) => {
      pos[k++] = -SIZE / 2 + i * CELL
      pos[k++] = hv(i, j)
      pos[k++] = -SIZE / 2 + j * CELL
    }
    const shade = (tri, f) => {
      // tri: [[i,j],[i,j],[i,j]] → face colour by slope / height / noise
      const h = (hv(...tri[0]) + hv(...tri[1]) + hv(...tri[2])) / 3
      const hs = [hv(...tri[0]), hv(...tri[1]), hv(...tri[2])]
      const slope = (Math.max(...hs) - Math.min(...hs)) / CELL
      const mx = -SIZE / 2 + ((tri[0][0] + tri[1][0] + tri[2][0]) / 3) * CELL
      const mz = -SIZE / 2 + ((tri[0][1] + tri[1][1] + tri[2][1]) / 3) * CELL
      const n = noise2(mx * 0.15, mz * 0.15, SEED + 21)
      const dc = Math.hypot(mx - cx, mz - cz)
      if (dc < CRATER_R * 0.62) c.setHex(n > 0.5 ? P.ice : P.iceDeep)
      else if (slope > 0.75) c.setHex(P.darkRock)
      else if (slope > 0.45 || h > 12) c.setHex(P.cliff)
      else if (n > 0.62) c.setHex(P.dust)
      else if (n < 0.3) c.setHex(P.rock)
      else c.setHex(P.sand)
      tmp.copy(c).multiplyScalar(0.94 + (f % 7) * 0.012)
      for (let q = 0; q < 3; q++) col.set([tmp.r, tmp.g, tmp.b], k - 9 + q * 3)
    }
    let f = 0
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = [i, j]
        const b = [i, j + 1]
        const cc = [i + 1, j + 1]
        const d = [i + 1, j]
        put(...a)
        put(...b)
        put(...d)
        shade([a, b, d], f++)
        put(...b)
        put(...cc)
        put(...d)
        shade([b, cc, d], f++)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    kit.mesh(geo, kit.mat(0xffffff, { vertexColors: true, roughness: 0.95 }), { cast: false, receive: true, name: 'terrain' })
  }

  // distant mountains (outside the terrain, hazed by fog)
  {
    const r = rng(SEED + 4)
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2
      const dist = 150 + r() * 70
      const h = 25 + r() * 45
      const w = 25 + r() * 30
      const m = kit.cylinder(0, w, h, 5 + Math.floor(r() * 3), r() < 0.5 ? 0x8a3f2b : 0x6b3022, {
        position: [Math.cos(a) * dist, h / 2 - 4, Math.sin(a) * dist],
        jitter: w * 0.12,
        seed: i + 50,
        cast: false,
        receive: false,
      })
      m.rotation.y = r() * Math.PI
    }
  }

  // ---------------------------------------------------------------- rocks
  {
    const r = rng(SEED + 8)
    const keepOut = [
      ...PADS.map((p) => [p.x, p.z, p.r + 2]),
      [SITES.crater[0], SITES.crater[1], CRATER_R * 0.7],
      [0, 10, 5],
    ]
    let placed = 0
    for (let n = 0; n < 400 && placed < 70; n++) {
      const x = (r() * 2 - 1) * (PLAY + 8)
      const z = (r() * 2 - 1) * (PLAY + 8)
      if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue
      const big = r() < 0.25
      const rad = big ? 0.9 + r() * 1.4 : 0.25 + r() * 0.45
      kit.rock(rad, r() < 0.5 ? P.rock : P.darkRock, 100 + n, {
        position: [x, Math.min(G(x - rad, z), G(x + rad, z), G(x, z - rad), G(x, z + rad), G(x, z)) + rad * 0.1, z],
        detail: big ? 1 : 0,
        collider: rad > 0.45,
      })
      placed++
    }
  }

  // ---------------------------------------------------------------- landing pad + drop pod
  const [px, pz] = SITES.pad
  const padY = G(px, pz)
  kit.cylinder(5, 5.3, 0.18, 8, 0x8a6a58, { position: [px, padY + 0.02, pz], cast: false })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    kit.box(0.3, 0.06, 0.3, 0, { position: [px + Math.cos(a) * 4.6, padY + 0.14, pz + Math.sin(a) * 4.6], mat: kit.glow(P.warm, 1.5), cast: false })
  }
  const pod = new THREE.Group()
  pod.position.set(px, padY + 0.1, pz + 2.6)
  kit.root.add(pod)
  kit.cylinder(0.9, 1.5, 2.0, 8, 0xe9e4d6, { parent: pod, position: [0, 1.4, 0], jitter: 0.02 })
  kit.cylinder(0.3, 0.9, 0.9, 8, 0xe9e4d6, { parent: pod, position: [0, 2.85, 0] })
  kit.cylinder(1.5, 1.4, 0.35, 8, 0x5b2a1c, { parent: pod, position: [0, 0.3, 0] }) // scorched heat shield
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    kit.box(0.12, 1.0, 0.12, P.metal, { parent: pod, position: [Math.cos(a) * 1.5, 0.35, Math.sin(a) * 1.5], rotation: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] })
  }
  kit.box(0.8, 1.1, 0.08, 0x2a2624, { parent: pod, position: [0, 1.35, -1.25], rotation: [-0.27, 0, 0] }) // hatch
  kit.box(0.5, 0.08, 0.04, PHOSPHOR, { parent: pod, position: [0, 2.0, -1.12], rotation: [-0.27, 0, 0], mat: kit.glow(PHOSPHOR, 1.6), cast: false })
  kit.boxCollider([px - 1.6, padY - 1, pz + 1.0], [px + 1.6, padY + 3.4, pz + 4.2])
  const portalFloor = V(px, padY, pz - 0.6)
  kit.portalMarker(portalFloor, 'DROP POD  >  HALCYON RING', { labelY: 2.6 })

  // ---------------------------------------------------------------- surface habitat
  const [hx, hz] = SITES.hab
  const habY = G(hx, hz)
  const hab = new THREE.Group()
  hab.position.set(hx, habY, hz)
  kit.root.add(hab)
  kit.cylinder(4.2, 4.4, 2.8, 10, P.hab, { parent: hab, position: [0, 1.4, 0], jitter: 0.03 })
  const dome = kit.mesh(new THREE.SphereGeometry(4.2, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), kit.mat(P.hab), { parent: hab, position: [0, 2.8, 0] })
  dome.scale.y = 0.55
  // regolith berm (shielding) around the base and sandbag ring on top
  const rr = rng(SEED + 12)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    if (Math.abs(a - Math.PI) < 0.45) continue // leave the door clear (door faces -x)
    kit.rock(1.1 + rr() * 0.3, P.dust, 300 + i, { parent: hab, position: [Math.cos(a) * 4.7, 0.3, Math.sin(a) * 4.7], squash: 0.55, collider: true })
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    kit.box(1.4, 0.45, 0.8, P.sand, { parent: hab, position: [Math.cos(a) * 2.6, 4.75, Math.sin(a) * 2.6], rotation: [0, -a, 0], jitter: 0.06 })
  }
  // airlock tube + door (facing -x, toward the landing pad)
  kit.box(2.6, 2.4, 2.2, P.hab, { parent: hab, position: [-5.2, 1.2, 0] })
  kit.box(0.1, 1.9, 1.2, P.habTrim, { parent: hab, position: [-6.52, 1.05, 0] })
  kit.box(0.06, 0.12, 1.0, P.warm, { parent: hab, position: [-6.56, 2.25, 0], mat: kit.glow(P.warm, 1.6), cast: false })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3
    kit.box(0.06, 0.5, 0.9, 0x9fd8ff, { parent: hab, position: [Math.cos(a) * 4.25, 2.0, Math.sin(a) * 4.25], rotation: [0, -a, 0], mat: kit.glow(0xffd9a0, 0.9), cast: false })
  }
  kit.boxCollider([hx - 4.6, habY - 1, hz - 4.6], [hx + 4.6, habY + 5.2, hz + 4.6])
  kit.boxCollider([hx - 6.6, habY - 1, hz - 1.15], [hx - 3.9, habY + 2.45, hz + 1.15])
  // solar array farm south-east of the hab
  const solarPanels = []
  for (let i = 0; i < 4; i++) {
    const sx = hx + 3 + i * 3.4
    const sz = hz + 9
    const sy = G(sx, sz)
    kit.box(0.15, 1.3, 0.15, P.metal, { position: [sx, sy + 0.65, sz] })
    const pnl = kit.box(2.8, 0.06, 1.8, 0x1f3a78, { position: [sx, sy + 1.4, sz], matOpts: { metalness: 0.4, roughness: 0.35 } })
    pnl.rotation.x = -0.5
    solarPanels.push(pnl)
    kit.boxCollider([sx - 1.4, sy, sz - 0.9], [sx + 1.4, sy + 1.9, sz + 0.9])
  }
  // sol clock pylon
  const scX = hx - 3
  const scZ = hz + 8
  const scY = G(scX, scZ)
  kit.box(0.5, 2.2, 0.5, P.habTrim, { position: [scX, scY + 1.1, scZ], collider: true })
  kit.cylinder(0.55, 0.55, 0.06, 12, 0x07140f, { position: [scX, scY + 2.0, scZ - 0.29], rotation: [Math.PI / 2, 0, 0], mat: kit.mat(0x07140f, { emissive: 0x0b2a18, emissiveIntensity: 1 }) })
  const solHand = kit.box(0.04, 0.45, 0.02, PHOSPHOR, { position: [scX, scY + 2.0, scZ - 0.33], mat: kit.glow(PHOSPHOR, 2), cast: false })
  solHand.geometry.translate(0, 0.2, 0)
  kit.labelSprite('HAB-1  //  CREW 4', { position: [hx, habY + 6.2, hz], height: 0.45 })

  // ---------------------------------------------------------------- rover
  const [rx, rz] = SITES.rover
  const rvY = G(rx, rz)
  const rover = new THREE.Group()
  rover.position.set(rx, rvY, rz)
  rover.rotation.y = Math.PI / 2 // axis-aligned so colliderFrom() is exact
  kit.root.add(rover)
  kit.box(2.2, 0.6, 3.6, 0xe6e0d0, { parent: rover, position: [0, 1.0, 0], jitter: 0.03 })
  kit.box(1.9, 0.9, 1.5, 0xe6e0d0, { parent: rover, position: [0, 1.75, -0.8] })
  kit.box(1.7, 0.5, 0.05, 0x9fd8ff, { parent: rover, position: [0, 1.9, -1.56], mat: kit.mat(0x7ab6d8, { metalness: 0.6, roughness: 0.15 }), cast: false })
  kit.box(2.3, 0.1, 3.7, P.warm, { parent: rover, position: [0, 0.75, 0] })
  for (const sx of [-1.25, 1.25]) {
    for (const sz of [-1.3, 0, 1.3]) {
      kit.cylinder(0.45, 0.45, 0.35, 8, P.dark, { parent: rover, position: [sx, 0.45, sz], rotation: [0, 0, Math.PI / 2], jitter: 0.02 })
    }
  }
  kit.box(0.08, 1.2, 0.08, P.metal, { parent: rover, position: [0.7, 2.7, 0.6] })
  const roverCam = kit.box(0.35, 0.2, 0.2, P.dark, { parent: rover, position: [0.7, 3.35, 0.6] })
  kit.box(0.12, 0.08, 0.02, PHOSPHOR, { parent: roverCam, position: [0, 0, -0.11], mat: kit.glow(PHOSPHOR, 2), cast: false })
  const dish = kit.cylinder(0.5, 0.05, 0.2, 8, 0xf0f0ea, { parent: rover, position: [-0.6, 2.4, 1.1], rotation: [0.6, 0, 0] })
  kit.colliderFrom(rover)

  // ---------------------------------------------------------------- dust-storm sensor mast
  const [mx, mz] = SITES.mast
  const mY = G(mx, mz)
  kit.cylinder(0.08, 0.12, 6, 5, P.metal, { position: [mx, mY + 3, mz] })
  kit.box(0.7, 0.6, 0.5, P.habTrim, { position: [mx, mY + 0.3, mz], collider: true })
  kit.boxCollider([mx - 0.2, mY, mz - 0.2], [mx + 0.2, mY + 6, mz + 0.2])
  const anemo = new THREE.Group()
  anemo.position.set(mx, mY + 6.1, mz)
  kit.root.add(anemo)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    kit.box(0.6, 0.03, 0.03, P.metal, { parent: anemo, position: [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], rotation: [0, -a, 0] })
    kit.ball(0.09, P.warm, { parent: anemo, position: [Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6], detail: 0 })
  }
  kit.box(0.4, 0.3, 0.3, 0xe6e0d0, { position: [mx, mY + 4.2, mz + 0.25] })
  const mastLamp = kit.ball(0.1, P.warm, { position: [mx, mY + 6.35, mz], detail: 0, mat: kit.glow(0xff5533, 2.5), cast: false })
  const pennant = kit.box(0.02, 0.35, 0.9, P.warm, { position: [mx, mY + 5.4, mz + 0.5], cast: false })

  // ---------------------------------------------------------------- ice crater
  const [cx, cz] = SITES.crater
  const drill = new THREE.Group()
  drill.position.set(cx, G(cx, cz), cz)
  kit.root.add(drill)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const leg = kit.box(0.1, 3.2, 0.1, P.metal, { parent: drill, position: [Math.cos(a) * 0.7, 1.5, Math.sin(a) * 0.7] })
    leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22)
  }
  const bit = kit.cylinder(0.08, 0.08, 2.4, 6, P.warm, { parent: drill, position: [0, 1.2, 0] })
  kit.box(0.5, 0.4, 0.5, P.habTrim, { parent: drill, position: [0, 3.0, 0] })
  kit.boxCollider([cx - 0.8, drill.position.y - 1, cz - 0.8], [cx + 0.8, drill.position.y + 3.2, cz + 0.8])
  {
    const r = rng(SEED + 30)
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2
      const d = 2 + r() * 3.5
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      const rad = 0.3 + r() * 0.5
      kit.rock(rad, P.ice, 500 + i, { position: [x, G(x, z) + rad * 0.2, z], collider: rad > 0.45 })
    }
  }

  // ---------------------------------------------------------------- crew gait lab marker cones
  const [gx, gz] = SITES.crew
  const gY = G(gx, gz)
  for (let i = 0; i < 6; i++) {
    kit.cylinder(0.02, 0.18, 0.45, 5, P.warm, { position: [gx - 5 + i * 2, gY + 0.22, gz + 3], cast: false })
  }
  kit.labelSprite('GAIT LAB  //  0.38 g', { position: [gx, gY + 3.4, gz + 3], height: 0.4 })

  // ---------------------------------------------------------------- dust motes
  const motes = (() => {
    const count = 400
    const r = rng(SEED + 40)
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (r() - 0.5) * 40
      pos[i * 3 + 1] = r() * 8
      pos[i * 3 + 2] = (r() - 0.5) * 40
    }
    const g = kit.track(new THREE.BufferGeometry())
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = kit.track(new THREE.PointsMaterial({ color: 0xf0c0a0, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false }))
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    kit.root.add(pts)
    return pts
  })()

  // ---------------------------------------------------------------- physics toys
  physics.createRagdoll({ position: V(gx - 1.5, gY, gz), color: 0xff8a3d, pose: 'stand', standStrength: 0.6, name: 'Crewmate Ochre' })
  physics.createRagdoll({ position: V(gx + 2, gY, gz - 1.5), color: 0x4fc3b0, pose: 'stand', standStrength: 0.55, name: 'Crewmate Teal' })
  const blobs = []
  {
    const r = rng(SEED + 50)
    // on the flattened pads so they don't roll away downhill
    const spots = [
      [4, 17],
      [-4, 17.5],
      [4.5, 21],
      [-4.5, 21.5],
      [2, -19.5],
      [10, -20],
    ]
    for (const [x, z] of spots) {
      const rad = 0.3 + r() * 0.3
      blobs.push(
        physics.createSoftBody({
          position: V(x, G(x, z) + rad + 0.3, z),
          radius: rad,
          detail: 1,
          color: r() < 0.5 ? 0xd9733f : 0xb85a34,
          stiffness: 0.45,
          pressure: 1.3,
          mass: 0.8,
          wobble: 1.6,
          name: 'Regolith blob',
        }),
      )
    }
  }

  // ---------------------------------------------------------------- POIs
  const at = (x, z, dy = 1.3) => V(x, G(x, z) + dy, z)
  const pois = [
    {
      id: 'pl-gait',
      title: 'Crew Gait Lab',
      category: 'PHYSIOLOGY',
      position: at(gx, gz + 2.5),
      radius: 3,
      lines: [
        'Gravity here: 3.72 m/s² = 0.38 g, the same as Mars.',
        'In low g, walking gets awkward and people switch to a bouncy lope sooner.',
        'Apollo crews on the Moon (0.17 g) often bunny-hopped instead.',
        'Bones and muscles carry less load, so exercise still matters down here.',
        'Shove a crewmate: they wobble, they recover. Mostly.',
      ],
      readout: { label: 'GRAVITY', value: '0.38 g' },
    },
    {
      id: 'pl-hab',
      title: 'Regolith-Shielded Hab',
      category: 'ENVIRONMENT',
      position: at(hx - 7.2, hz + 2.2),
      radius: 3,
      lines: [
        'Like Mars, Cinder Reach has no global magnetic field and thin air.',
        'Surface dose: ~0.7 mSv/day, close to what Curiosity’s RAD measured on Mars.',
        'Deep-space cruise is worse: ~1.8 mSv/day on the way out.',
        'Piled regolith on the roof cuts the dose; water walls make a storm shelter.',
        'Solar flare warning? Get inside. Run, but in a dignified lope.',
      ],
      readout: { label: 'SURFACE DOSE', value: '0.7 mSv/day' },
    },
    {
      id: 'pl-sol',
      title: 'Sol Clock',
      category: 'LOG',
      position: at(scX, scZ - 1.1, 1.5),
      lines: [
        'A local day here runs 24 h 39 min, the same as a Mars sol.',
        'That extra 39 min a day pulls you out of sync with Earth fast.',
        'Mission teams who lived on Mars time reported fatigue and poor sleep.',
        'Fix: bright, blue-rich light at "morning", dim warm light at night.',
        'Your circadian score is on the wrist. It is judging you.',
      ],
      readout: { label: 'SOL LENGTH', value: '24h 39m' },
    },
    {
      id: 'pl-rover',
      title: 'Rover Telemetry',
      category: 'VITALS',
      position: at(rx + 2.4, rz - 2.4),
      radius: 3,
      lines: [
        'Moonwalkers burned an average of ~200–300 kcal/h on EVA.',
        'Heart rate, O2 use and suit heat load all climb together.',
        'Golden rule: never drive farther than you can walk BACK.',
        'Pressurised rovers let crews rest out of the suit between stops.',
        'HR and suit O2 are live on your wrist. Pace yourself.',
      ],
      readout: { label: 'EVA BURN', value: '200–300 kcal/h' },
    },
    {
      id: 'pl-mast',
      title: 'Dust Storm Mast',
      category: 'ENVIRONMENT',
      position: at(mx - 1.4, mz - 1.2),
      lines: [
        'Dust here is like Mars dust: ultra-fine, sharp, statically clingy.',
        'Mars soil holds ~0.5–1% perchlorates (found by the Phoenix lander).',
        'Perchlorates can block the thyroid’s iodine uptake. Don’t track it inside.',
        'Storms can go planet-wide for weeks and starve solar arrays.',
        'At ~0.6 kPa, even a gale barely pushes you. Dust gets in anyway.',
      ],
      readout: { label: 'PERCHLORATE', value: '0.5–1% soil' },
    },
    {
      id: 'pl-ice',
      title: 'Ice Crater',
      category: 'SYSTEMS',
      position: at(cx + 6.5, cz + 5.5),
      radius: 3,
      lines: [
        'Water ice hides in crater floors and just under the dust.',
        'Melt it for drinking water, rocket fuel and radiation shielding.',
        'Electrolysis splits water into breathable O2 + hydrogen.',
        'On Mars, the MOXIE test made O2 straight from CO2 air (2021–2023).',
        'Hydration note: ice cores are samples, not snacks.',
      ],
      readout: { label: '1 m³ ICE', value: '~917 L H2O' },
    },
  ]
  for (const poi of pois) kit.beacon(poi.position.clone().add(V(0, 1.0, 0)))

  const portals = [
    { id: 'pt-pod', label: 'Board drop pod → Halcyon Ring', target: 'station', position: V(portalFloor.x, portalFloor.y + 1.2, portalFloor.z), radius: 2.5 },
  ]

  // ---------------------------------------------------------------- colliders
  const colliders = {
    ground,
    boxes: kit.colliders.boxes,
    spheres: kit.colliders.spheres,
    bounds: new THREE.Box3(V(-PLAY, -60, -PLAY), V(PLAY, 200, PLAY)),
  }

  const spawnPos = V(px, padY, pz - 4.5)
  spawnPos.y = ground(spawnPos.x, spawnPos.z)

  // ---------------------------------------------------------------- update
  const motePos = motes.geometry.attributes.position
  function update(dt, t, player) {
    kit.update(dt, t)
    const pp = player?.position
    if (pp) {
      light.follow(pp)
      motes.position.set(pp.x, pp.y - 1, pp.z)
    }
    for (let i = 0; i < motePos.count; i++) {
      let x = motePos.getX(i) + dt * 1.6
      let y = motePos.getY(i) + Math.sin(t * 0.7 + i) * dt * 0.2
      if (x > 20) x -= 40
      if (y > 8) y -= 8
      if (y < 0) y += 8
      motePos.setX(i, x)
      motePos.setY(i, y)
    }
    motePos.needsUpdate = true
    anemo.rotation.y = t * 3.5
    pennant.rotation.y = Math.sin(t * 2.3) * 0.25
    mastLamp.visible = Math.sin(t * 3) > 0.2
    roverCam.rotation.y = Math.sin(t * 0.4) * 1.1
    dish.rotation.z = Math.sin(t * 0.2) * 0.4
    bit.rotation.y = t * 6
    solHand.rotation.z = -((t / 60) % 1) * Math.PI * 2
    for (const sp of solarPanels) sp.rotation.x = -0.5 + Math.sin(t * 0.05) * 0.05
  }

  function dispose() {
    kit.dispose()
    blobs.length = 0
    scene.fog = null
    scene.background = null
  }

  return {
    id: 'planet',
    name: 'CINDER REACH — Surface',
    gravity: 3.72,
    movement: 'walk',
    spawn: { position: spawnPos, yaw: 0 },
    colliders,
    environment: { o2Drain: 0.35, radiation: 0.7, tempC: -63, pressureKPa: 0.6, vacuum: true },
    pois,
    portals,
    update,
    dispose,
  }
}
