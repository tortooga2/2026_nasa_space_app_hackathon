// Vital-Link — Spacewalk: outside the Halcyon Ring. Zero-g EVA along the main truss, solar wings,
// an ammonia radiator and the airlock, with Earth filling the view below. Tethered to the airlock.

import * as THREE from 'three'
import { LowPolyKit, PALETTES, PHOSPHOR, rng } from './lowpoly.js'

const P = PALETTES.space

export function createSpacewalk(ctx) {
  const { scene, physics, hud } = ctx
  const kit = new LowPolyKit(scene)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  scene.background = new THREE.Color(0x000000)
  scene.fog = null

  // ---------------------------------------------------------------- sky, sun, Earth
  const sunDir = V(0.55, 0.5, 0.67).normalize()
  kit.stars(2200, 2750, 21, 2) // beyond Earth's limb (~1.6 km) so no star draws in front of it
  kit.sun(sunDir.clone().multiplyScalar(2600), 0xfffbe8, 160)
  const earth = kit.planetSphere(1700, 'earth', { position: [0, -2300, -100], detail: 56, cloudDetail: 36, seed: 3, cloudCover: 0.62 })
  earth.rotation.set(-1.2, 0, 0.2) // tilt the pole away so we look down on mid-latitudes
  kit.lights({
    sky: 0x2a3550,
    ground: 0x3f78c0, // earthshine from below
    hemiIntensity: 0.75,
    sunColor: 0xfff6e6,
    sunIntensity: 3.0,
    direction: [sunDir.x, sunDir.y, sunDir.z],
    distance: 70,
    area: 90,
    mapSize: 2048,
  })

  // ---------------------------------------------------------------- habitat module (along X)
  const hab = new THREE.Group()
  kit.root.add(hab)
  const habMat = kit.mat(P.hull, { roughness: 0.7 })
  kit.cylinder(2.5, 2.5, 20, 12, P.hull, { parent: hab, rotation: [0, 0, Math.PI / 2], mat: habMat })
  for (let x = -9; x <= 9; x += 3) {
    kit.cylinder(2.56, 2.56, 0.25, 12, P.panel, { parent: hab, position: [x, 0, 0], rotation: [0, 0, Math.PI / 2] })
  }
  for (const sx of [-1, 1]) {
    kit.cylinder(2.3, 2.5, 0.4, 12, P.trim, { parent: hab, position: [sx * 10.2, 0, 0], rotation: [0, 0, Math.PI / 2] })
  }
  // handrails (gold) along the top
  for (const z of [-1.0, 1.0]) {
    kit.box(18, 0.06, 0.06, P.gold, { parent: hab, position: [0, 2.75, z], mat: kit.mat(P.gold, { metalness: 0.8, roughness: 0.3 }) })
    for (let x = -8; x <= 8; x += 4) kit.box(0.05, 0.25, 0.05, P.gold, { parent: hab, position: [x, 2.6, z], mat: kit.mat(P.gold, { metalness: 0.8, roughness: 0.3 }) })
  }
  // windows
  for (const x of [-6, -2, 2]) kit.box(0.9, 0.05, 0.9, 0x07140f, { parent: hab, position: [x, 2.52, 0], mat: kit.glow(0xffd9a0, 0.7), cast: false })
  kit.boxCollider([-10.4, -2.5, -2.5], [10.4, 2.5, 2.5])
  kit.boxCollider([-8, 2.5, -1.2], [8, 2.85, 1.2]) // handrail strip

  // micrometeoroid shield on the -X end cap (pitted)
  const shield = new THREE.Group()
  shield.position.set(-10.55, 0, 0)
  kit.root.add(shield)
  kit.cylinder(2.2, 2.2, 0.2, 10, 0xc9c9c0, { parent: shield, rotation: [0, 0, Math.PI / 2], jitter: 0.03 })
  {
    const r = rng(9)
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2
      const d = r() * 1.8
      kit.cylinder(0.05 + r() * 0.1, 0.02, 0.04, 5, 0x3a3a36, { parent: shield, position: [-0.11, Math.sin(a) * d, Math.cos(a) * d], rotation: [0, 0, Math.PI / 2], cast: false })
    }
  }
  kit.boxCollider([-10.75, -2.2, -2.2], [-10.4, 2.2, 2.2])

  // ---------------------------------------------------------------- airlock (along +Z at x=4)
  const AX = 4
  const lock = new THREE.Group()
  lock.position.set(AX, 0, 0)
  kit.root.add(lock)
  kit.cylinder(1.3, 1.3, 3.6, 10, P.hull, { parent: lock, position: [0, 0, 4.2], rotation: [Math.PI / 2, 0, 0], mat: habMat })
  kit.cylinder(1.4, 1.4, 0.25, 10, P.trim, { parent: lock, position: [0, 0, 6.0], rotation: [Math.PI / 2, 0, 0] })
  kit.cylinder(0.95, 0.95, 0.12, 10, 0xbfc5bd, { parent: lock, position: [0, 0, 6.1], rotation: [Math.PI / 2, 0, 0] }) // hatch
  kit.cylinder(0.2, 0.2, 0.2, 6, P.trim, { parent: lock, position: [0, 0, 6.2], rotation: [Math.PI / 2, 0, 0] })
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    kit.box(0.28, 0.1, 0.05, k % 2 ? 0x1a1a1a : P.warm, { parent: lock, position: [Math.cos(a) * 1.2, Math.sin(a) * 1.2, 6.14], rotation: [0, 0, a + Math.PI / 2], cast: false })
  }
  const lockLamp = kit.ball(0.1, P.red, { parent: lock, position: [0, 1.45, 5.9], detail: 0, mat: kit.glow(P.red, 2.5), cast: false })
  const tetherAnchor = V(AX + 1.1, 0.9, 6.45) // just outside the airlock collider (max z 6.2) so the pinned end isn't buried
  kit.mesh(new THREE.TorusGeometry(0.12, 0.03, 4, 8), kit.mat(P.gold, { metalness: 0.8, roughness: 0.3 }), { position: tetherAnchor })
  kit.boxCollider([AX - 1.4, -1.4, 2.4], [AX + 1.4, 1.4, 6.2])
  const portalMarker = kit.portalMarker(V(AX, 0, 6.25), 'AIRLOCK  >  HALCYON RING', { radius: 1.15, labelY: 1.8, uprightY: 0.9 })
  portalMarker.rotation.x = Math.PI / 2

  // ---------------------------------------------------------------- main truss (along X at z=-6)
  const TZ = -6
  const TL = 32
  {
    const trussMat = kit.mat(0x9aa09c, { metalness: 0.5, roughness: 0.45 })
    for (const [y, z] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      kit.box(TL * 2, 0.14, 0.14, 0, { position: [0, y, TZ + z], mat: trussMat })
    }
    for (let x = -TL; x <= TL; x += 2) {
      kit.box(0.1, 2, 0.1, 0, { position: [x, 0, TZ - 1], mat: trussMat })
      kit.box(0.1, 2, 0.1, 0, { position: [x, 0, TZ + 1], mat: trussMat })
      kit.box(0.1, 0.1, 2, 0, { position: [x, 1, TZ], mat: trussMat })
      kit.box(0.1, 0.1, 2, 0, { position: [x, -1, TZ], mat: trussMat })
      if (x < TL) {
        const d = kit.box(0.07, 2.83, 0.07, 0, { position: [x + 1, 0, TZ + 1], mat: trussMat })
        d.rotation.z = Math.PI / 4 * (x % 4 === 0 ? 1 : -1)
        const d2 = kit.box(0.07, 2.83, 0.07, 0, { position: [x + 1, 0, TZ - 1], mat: trussMat })
        d2.rotation.z = -d.rotation.z
      }
    }
    kit.boxCollider([-TL - 0.1, -1.1, TZ - 1.1], [TL + 0.1, 1.1, TZ + 1.1])
    // struts hab → truss
    for (const x of [-6, 0, 6]) {
      kit.box(0.5, 0.5, 2.6, P.panel, { position: [x, 0, -3.7], collider: true })
    }
    // equipment boxes on the truss (orange-ish thermal blankets)
    const r = rng(33)
    for (let i = 0; i < 8; i++) {
      const x = -26 + i * 7 + r() * 2
      kit.box(1.2, 0.8, 1.2, r() < 0.5 ? 0xe9e4d6 : P.gold, { position: [x, 1.5, TZ], jitter: 0.04, collider: true })
    }
  }

  // ---------------------------------------------------------------- solar wings at both truss ends
  const wings = []
  for (const sx of [-1, 1]) {
    const x = sx * (TL - 3)
    kit.cylinder(0.5, 0.5, 2.6, 8, P.trim, { position: [x, 0, TZ], rotation: [Math.PI / 2, 0, 0] }) // rotary joint
    for (const side of [-1, 1]) {
      const g = new THREE.Group()
      g.position.set(x, 0, TZ + side * 1.4)
      kit.root.add(g)
      const len = 13
      kit.box(0.12, 0.12, len, P.panel, { parent: g, position: [0, 0, (side * len) / 2] })
      for (let s = 0; s < 6; s++) {
        kit.box(4.4, 0.06, 2.0, P.solar, {
          parent: g,
          position: [0, 0, side * (1.2 + s * 2.1)],
          matOpts: { metalness: 0.5, roughness: 0.3, emissive: 0x0a1430, emissiveIntensity: 0.6 },
        })
        kit.box(4.45, 0.065, 0.06, P.solarLine, { parent: g, position: [0, 0, side * (0.15 + s * 2.1)], cast: false })
      }
      wings.push(g)
      const z0 = TZ + side * 1.4
      const z1 = z0 + side * (len + 0.4)
      kit.boxCollider([x - 2.25, -0.2, Math.min(z0, z1)], [x + 2.25, 0.2, Math.max(z0, z1)])
    }
  }

  // ---------------------------------------------------------------- radiator panels below the truss
  for (let i = 0; i < 3; i++) {
    const x = 11 + i * 3.4
    kit.box(0.2, 1.0, 0.2, P.trim, { position: [x, -1.5, TZ] })
    kit.box(3.0, 7.5, 0.12, P.radiator, { position: [x, -5.8, TZ], matOpts: { roughness: 0.4 } })
    for (let k = 0; k < 6; k++) kit.box(3.02, 0.05, 0.13, 0xbfc8c4, { position: [x, -2.6 - k * 1.25, TZ], cast: false })
    kit.boxCollider([x - 1.5, -9.6, TZ - 0.15], [x + 1.5, -1.0, TZ + 0.15])
  }
  kit.pipe([10, -1.2, TZ + 0.3], [19, -1.2, TZ + 0.3], 0.07, 0xb8bec0, { cast: false })

  // comms antenna on top of the truss
  const antenna = new THREE.Group()
  antenna.position.set(-14, 1.1, TZ)
  kit.root.add(antenna)
  kit.box(0.12, 2.4, 0.12, P.trim, { parent: antenna, position: [0, 1.2, 0] })
  const dish = kit.cylinder(1.1, 0.12, 0.4, 10, 0xf0f0ea, { parent: antenna, position: [0, 2.6, 0], rotation: [0.5, 0, 0] })
  kit.boxCollider([-14.2, 1.1, TZ - 0.2], [-13.8, 3.5, TZ + 0.2])

  // ---------------------------------------------------------------- tether (airlock → player)
  // spawn east of the airlock, facing back along the hab toward the drifting crewmate and truss
  // (portal is behind-left, out of the prompt cone; first thrust carries you away from it)
  const SPAWN = V(AX + 3, 2.6, 11.5)
  const SPAWN_YAW = 1.3 // ≈ looking -x toward the drifting crewmate
  const tetherEnd = SPAWN.clone().add(V(0, 0.9, 0))
  // Rope rest length = |end - start| * slack. Build it already ending at the player's clip point and
  // use slack to set a ~35 m reel (just over TETHER_LEN), so nothing whips across the scene on arrival.
  const ROPE_LEN = 35
  const tether = physics.createRope({
    start: tetherAnchor.clone(),
    end: tetherEnd.clone(),
    segments: 28,
    color: 0xffd23f,
    thickness: 0.016,
    slack: ROPE_LEN / tetherAnchor.distanceTo(tetherEnd),
  })
  tether.attachStart(tetherAnchor)
  tether.attachEnd(tetherEnd)

  // ---------------------------------------------------------------- floating toys
  const tools = [
    physics.createSoftBody({ position: V(1.5, 0.8, 9.5), shape: 'capsule', radius: 0.14, detail: 1, color: P.warm, stiffness: 0.55, pressure: 1.0, mass: 0.6, wobble: 1.6, name: 'Jelly wrench' }),
    physics.createSoftBody({ position: V(2.5, 2.2, 10.5), shape: 'box', size: V(0.5, 0.35, 0.35), color: 0xe9e4d6, stiffness: 0.6, pressure: 1.0, mass: 1.2, wobble: 1.3, name: 'Jelly toolbox' }),
    physics.createSoftBody({ position: V(6.0, -1.2, 11.0), radius: 0.3, detail: 1, color: PHOSPHOR, stiffness: 0.45, pressure: 1.0, mass: 0.5, wobble: 2, name: 'Jelly helmet lamp' }),
    physics.createSoftBody({ position: V(-4.0, 3.6, 3.0), radius: 0.22, detail: 1, color: 0xd65db1, stiffness: 0.45, pressure: 1.0, mass: 0.3, wobble: 2, name: 'Lost snack' }),
  ]
  const drift = [V(0.1, 0.05, -0.05), V(-0.08, 0.05, 0.03), V(0.0, 0.08, -0.05), V(0.05, -0.03, 0.05)]
  tools.forEach((b, i) => b.applyImpulse(drift[i].clone().multiplyScalar(b === tools[1] ? 1.2 : 0.6)))
  const crewHome = V(-3.5, 2.8, 8.5)
  const crewmate = physics.createRagdoll({ position: crewHome.clone(), color: 0xf1f0ea, pose: 'float', standStrength: 0, name: 'Drifting crewmate' })
  crewmate.applyImpulse(V(0.25, 0.1, -0.15))

  // ---------------------------------------------------------------- POIs
  const crewPoiPos = crewHome.clone().add(V(0, 0.3, 0))
  const pois = [
    {
      id: 'sw-airlock',
      title: 'Airlock & Pre-breathe',
      category: 'PHYSIOLOGY',
      position: V(AX + 2.6, 0.6, 6.4),
      lines: [
        'Suit pressure: ~29.6 kPa (4.3 psi) of pure O2. Cabin: ~101 kPa air.',
        'Drop pressure that fast and dissolved nitrogen fizzes out of your tissues',
        'like an opened soda: decompression sickness, "the bends".',
        'So crews pre-breathe pure O2 for hours first, often while exercising.',
        'Low suit pressure keeps the gloves bendable. Your fingers say thanks.',
        'Real EVA safety tethers reel out ~26 m (85 ft). This reel is a generous 34 m.',
      ],
      readout: { label: 'SUIT', value: '29.6 kPa O2' },
    },
    {
      id: 'sw-crew',
      title: 'Drifting Crewmate',
      category: 'VITALS',
      position: crewPoiPos,
      radius: 3,
      lines: [
        'A typical spacewalk runs ~6.5 h; the suit packs ~8 h of oxygen.',
        'Pressurised gloves fight every grip, so hand fatigue is the top complaint.',
        'Some crews have even lost fingernails after long EVAs.',
        'Always clipped on: tether first, a small rescue jetpack as backup.',
        'This one forgot to clip in. Maybe tow them home.',
      ],
      readout: { label: 'EVA LENGTH', value: '~6.5 h' },
    },
    {
      id: 'sw-solar',
      title: 'Solar Wing Thermal',
      category: 'ENVIRONMENT',
      position: V(TL - 6, 1.5, TZ + 2.4),
      radius: 3,
      lines: [
        'Sunlit hardware can bake past +120 °C; in shadow it drops toward -150 °C.',
        'In orbit you swap between the two every ~45 minutes.',
        'Your suit’s cooling garment pumps water through ~90 m of fine tubing.',
        'Overheating pushes up heart rate and sweat. Core temp is on your wrist.',
      ],
      readout: { label: 'SURFACE TEMP', value: '-157/+121 °C' },
    },
    {
      id: 'sw-radiator',
      title: 'Ammonia Radiator',
      category: 'SYSTEMS',
      position: V(14.4, -2.2, TZ + 2.0),
      radius: 3,
      lines: [
        'These panels dump station heat to space via ammonia coolant loops.',
        'Ammonia is toxic. After leak work, crews check suits for frozen flakes',
        'and let sunlight bake them off before heading inside.',
        'An ammonia alarm indoors means masks on and a dash to a safe module.',
      ],
      readout: { label: 'COOLANT', value: 'NH3 loop' },
    },
    {
      id: 'sw-mmod',
      title: 'Micrometeoroid Shield',
      category: 'ENVIRONMENT',
      position: V(-11.9, 0.6, 1.6),
      lines: [
        'Orbital debris hits at ~10 km/s on average; meteoroids are faster.',
        'At that speed a paint fleck can pit a window.',
        'Layered bumper shields shatter impactors into spray before the hull.',
        'Big debris is tracked; the station dodges with a thruster burn.',
        'Gloves are inspected after every EVA for cuts from sharp edges.',
      ],
      readout: { label: 'IMPACT SPEED', value: '~10 km/s' },
    },
    {
      id: 'sw-horizon',
      title: 'Truss End: No Down',
      category: 'PHYSIOLOGY',
      position: V(-TL + 6, 1.6, TZ + 2.4),
      radius: 3,
      lines: [
        'Your inner ear expects an up and a down. Out here there is neither.',
        'Over half of first-time flyers get space motion sickness in the first days.',
        'Being sick in a helmet is a real hazard: nothing pulls it away.',
        'The brain adapts in a few days, then must relearn gravity on landing.',
        'Look at Earth. It is the only "down" on offer.',
      ],
      readout: { label: 'ADAPTATION', value: '2–3 days' },
    },
  ]
  let crewBeacon = null
  for (const poi of pois) {
    if (poi.id === 'sw-crew') {
      const follower = new THREE.Group()
      kit.root.add(follower)
      kit.beacon(V(0, 0, 0), { parent: follower })
      crewBeacon = follower
    } else {
      kit.beacon(poi.position.clone().add(V(0, 0.9, 0)))
    }
  }

  const portals = [{ id: 'pt-airlock', label: 'Cycle airlock → Halcyon Ring', target: 'station', position: V(AX, 0, 7.3), radius: 2.5 }]

  // ---------------------------------------------------------------- colliders
  const colliders = {
    ground: () => -Infinity,
    boxes: kit.colliders.boxes,
    spheres: kit.colliders.spheres,
    bounds: new THREE.Box3(V(-42, -28, -32), V(42, 24, 32)),
  }

  // Pre-settle: a 35 m rope spawned between two points ~6 m apart starts over-sagged and briefly stretched.
  // Relax it (and let the toys settle) before the first rendered frame. Same gravity/colliders main.js sets next.
  physics.setGravity(0)
  physics.setColliders(colliders)
  for (let i = 0; i < 60; i++) physics.step(1 / 60)

  // ---------------------------------------------------------------- update
  const _c = new THREE.Vector3()
  const _n = new THREE.Vector3()
  const TETHER_LEN = 34 // gameplay reel; real EVA safety tethers are ~26 m (85 ft)
  const TETHER_SPRING = 6
  const TETHER_BOUNCE = 0.35
  let lastTautNotify = -Infinity
  const _home = new THREE.Vector3()
  function update(dt, t, player) {
    kit.update(dt, t)
    if (player?.position) {
      // clip on at the hip/back pack: below the eye and 0.35 m behind the view direction, so it trails out of view
      const yaw = Number.isFinite(player.yaw) ? player.yaw : 0
      tetherEnd.copy(player.position).add(V09)
      tetherEnd.x += Math.sin(yaw) * 0.35
      tetherEnd.z += Math.cos(yaw) * 0.35
      // tether is a real limit: past TETHER_LEN, cancel outward velocity (+ a little rebound) and spring back in
      _n.subVectors(tetherEnd, tetherAnchor)
      const d = _n.length()
      if (d > TETHER_LEN && player.velocity) {
        _n.divideScalar(d)
        const out = player.velocity.dot(_n)
        if (out > 0) player.velocity.addScaledVector(_n, -out * (1 + TETHER_BOUNCE))
        player.velocity.addScaledVector(_n, -Math.min(d - TETHER_LEN, 3) * TETHER_SPRING * dt)
        if (t - lastTautNotify > 3) {
          lastTautNotify = t
          hud?.notify?.('TETHER TAUT')
        }
      }
    }
    earth.rotation.y = t * 0.012
    if (earth.userData.clouds) earth.userData.clouds.rotation.y = t * 0.004
    lockLamp.visible = Math.sin(t * 3) > 0
    dish.rotation.x = 0.5 + Math.sin(t * 0.25) * 0.3
    antenna.rotation.y = t * 0.1
    for (const w of wings) w.rotation.z = Math.sin(t * 0.05) * 0.04
    // crewmate POI + beacon follow the floating ragdoll; nudge it home if it wanders
    crewmate.center(_c) // out-param: no per-frame allocation
    if (Number.isFinite(_c.x)) {
      crewPoiPos.copy(_c).add(V03)
      crewBeacon.position.copy(_c).add(V12)
      const off = _c.distanceTo(crewHome)
      if (off > 7) crewmate.applyImpulse(_home.copy(crewHome).sub(_c).normalize().multiplyScalar(0.4 * dt))
    }
  }
  const V09 = V(0, 0.9, 0)
  const V03 = V(0, 0.3, 0)
  const V12 = V(0, 1.2, 0)

  function dispose() {
    kit.dispose()
    tools.length = 0
  }

  return {
    id: 'spacewalk',
    name: 'EVA — Halcyon Ring Exterior',
    gravity: 0,
    movement: 'zerog',
    spawn: { position: SPAWN, yaw: SPAWN_YAW },
    colliders,
    environment: { o2Drain: 1, radiation: 1.0, tempC: -100, pressureKPa: 0, vacuum: true },
    pois,
    portals,
    update,
    dispose,
  }
}
