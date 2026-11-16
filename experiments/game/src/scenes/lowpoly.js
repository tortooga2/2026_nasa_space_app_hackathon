// Vital-Link — shared low-poly toolkit for the level modules (World lead).
//
// Art direction: chunky, flat-shaded, few segments, slightly jittered vertices, a small palette per
// level, emissive phosphor-green for anything the wrist computer can "see" (POI beacons, portals).
//
// Usage inside a level:
//   const kit = new LowPolyKit(scene)
//   kit.box(2, 1, 1, P.hull, { position: [0, 0.5, 0], collider: true })
//   kit.beacon(new THREE.Vector3(0, 2, 0))
//   ...
//   update: kit.update(dt, t)      dispose: kit.dispose()
//
// Everything a kit creates lives under `kit.root` (one Group added to the scene) and every geometry,
// material and texture it creates is tracked and freed by kit.dispose().

import * as THREE from 'three'

// ------------------------------------------------------------------------------------------------
// Deterministic randomness + noise
// ------------------------------------------------------------------------------------------------

/** Seeded PRNG (mulberry32). Returns () => [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer lattice hash → [0,1). */
export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const fade = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

/** Smooth 2D value noise in [0,1]. */
export function noise2(x, z, seed = 0) {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(z - zi)
  const a = hash3(xi, 0, zi, seed)
  const b = hash3(xi + 1, 0, zi, seed)
  const c = hash3(xi, 0, zi + 1, seed)
  const d = hash3(xi + 1, 0, zi + 1, seed)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

/** Smooth 3D value noise in [0,1]. */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const n = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed)
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v),
    w,
  )
}

/** Fractal 2D noise in roughly [0,1]. */
export function fbm2(x, z, octaves = 4, seed = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, z * f, seed + i * 17) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

/** Fractal 3D noise in roughly [0,1]. */
export function fbm3(x, y, z, octaves = 4, seed = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f, y * f, z * f, seed + i * 31) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Displace each vertex by a hash of its (rounded) position so vertices shared between faces move
 * together — the mesh stays watertight even for non-indexed geometry.
 */
export function jitterGeometry(geo, amount = 0.05, seed = 1, scale = [1, 1, 1]) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const kx = Math.round(x * 1000)
    const ky = Math.round(y * 1000)
    const kz = Math.round(z * 1000)
    pos.setXYZ(
      i,
      x + (hash3(kx, ky, kz, seed) - 0.5) * 2 * amount * scale[0],
      y + (hash3(kx, ky, kz, seed + 1) - 0.5) * 2 * amount * scale[1],
      z + (hash3(kx, ky, kz, seed + 2) - 0.5) * 2 * amount * scale[2],
    )
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

// ------------------------------------------------------------------------------------------------
// Palettes (one limited palette per level)
// ------------------------------------------------------------------------------------------------

export const PHOSPHOR = 0x39ff88

export const PALETTES = {
  station: {
    hull: 0xc9cdc4,
    panel: 0x9aa39c,
    panelDark: 0x6b7670,
    trim: 0x3a4744,
    floor: 0x46524f,
    floorLine: 0x2c3533,
    dark: 0x1c2322,
    accent: PHOSPHOR,
    warm: 0xffb347,
    med: 0x6fd3bd,
    red: 0xd9573b,
    blue: 0x4f8fd6,
    pad: 0xe8e2cf,
    glass: 0x9fd8ff,
  },
  planet: {
    sand: 0xc2673d,
    dust: 0xd98c5c,
    rock: 0x7d3c27,
    darkRock: 0x4e2519,
    cliff: 0x9a4b2e,
    ice: 0xdaf1ff,
    iceDeep: 0x9cc9e6,
    hab: 0xe7e2d3,
    habTrim: 0x5d6563,
    metal: 0x8f9593,
    dark: 0x2a2624,
    accent: PHOSPHOR,
    warm: 0xffb347,
    skyTop: 0x3d2a3a,
    skyMid: 0xb86b48,
    skyHorizon: 0xe3a77c,
  },
  space: {
    hull: 0xd9dcd6,
    panel: 0xb4bab4,
    trim: 0x4b5552,
    gold: 0xd4a640,
    solar: 0x1f3a78,
    solarLine: 0x7fa0d8,
    radiator: 0xeef2ee,
    dark: 0x151a1c,
    accent: PHOSPHOR,
    warm: 0xffb347,
    red: 0xd9573b,
  },
}

// ------------------------------------------------------------------------------------------------
// Canvas helpers (work headless: fall back to null when there is no DOM)
// ------------------------------------------------------------------------------------------------

function makeCanvas(w, h) {
  try {
    if (typeof document === 'undefined' || !document.createElement) return null
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext && c.getContext('2d')
    if (!ctx) return null
    return { canvas: c, ctx }
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------------------------------
// Toolkit
// ------------------------------------------------------------------------------------------------

const toVec3 = (v) => (v == null ? null : v.isVector3 ? v : new THREE.Vector3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0))

export class LowPolyKit {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene
    this.root = new THREE.Group()
    this.root.name = 'level-root'
    scene.add(this.root)
    this._mats = new Map()
    this._res = new Set()
    this._anim = []
    this.colliders = { boxes: [], spheres: [] }
  }

  /** Track a geometry / material / texture for disposal. Returns it. */
  track(r) {
    if (r) this._res.add(r)
    return r
  }

  /** Register a per-frame animation callback (dt, t). */
  animate(fn) {
    this._anim.push(fn)
    return fn
  }

  // ---------------------------------------------------------------- materials

  /** Cached flat-shaded standard material. */
  mat(color, opts = {}) {
    const key = 's' + color + JSON.stringify(opts)
    let m = this._mats.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts })
      this._mats.set(key, m)
      this.track(m)
    }
    return m
  }

  /** Cached glowing material (emissive phosphor style). */
  glow(color, intensity = 1.6, opts = {}) {
    return this.mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4, ...opts })
  }

  /** Cached unlit material. */
  basic(color, opts = {}) {
    const key = 'b' + color + JSON.stringify(opts)
    let m = this._mats.get(key)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, ...opts })
      this._mats.set(key, m)
      this.track(m)
    }
    return m
  }

  // ---------------------------------------------------------------- generic placement

  /**
   * Wrap a geometry in a mesh and place it.
   * o: { position, rotation:[x,y,z], scale, parent, cast=true, receive=true, collider=false, pad=0, name }
   */
  mesh(geo, material, o = {}) {
    this.track(geo)
    const m = new THREE.Mesh(geo, material)
    const p = toVec3(o.position)
    if (p) m.position.copy(p)
    if (o.rotation) m.rotation.set(o.rotation[0] || 0, o.rotation[1] || 0, o.rotation[2] || 0)
    if (typeof o.scale === 'number') m.scale.setScalar(o.scale)
    else if (o.scale != null) m.scale.copy(toVec3(o.scale))
    m.castShadow = o.cast ?? true
    m.receiveShadow = o.receive ?? true
    if (o.name) m.name = o.name
    ;(o.parent || this.root).add(m)
    if (o.collider) this.colliderFrom(m, o.pad ?? 0)
    return m
  }

  /** Flat-shaded box. o: mesh() options + { jitter, mat } */
  box(w, h, d, color, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d)
    if (o.jitter) jitterGeometry(g, o.jitter, o.seed ?? 3)
    return this.mesh(g, o.mat || this.mat(color, o.matOpts), o)
  }

  /** Cylinder / cone / prism. */
  cylinder(rTop, rBot, h, segs, color, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, o.open ?? false)
    if (o.jitter) jitterGeometry(g, o.jitter, o.seed ?? 5)
    return this.mesh(g, o.mat || this.mat(color, o.matOpts), o)
  }

  /** Low-poly sphere. */
  ball(r, color, o = {}) {
    const g = new THREE.IcosahedronGeometry(r, o.detail ?? 1)
    if (o.jitter) jitterGeometry(g, o.jitter, o.seed ?? 7)
    return this.mesh(g, o.mat || this.mat(color, o.matOpts), o)
  }

  // ---------------------------------------------------------------- colliders

  /** Axis-aligned Box3 collider from an object's world bounds. Use only on axis-aligned objects. */
  colliderFrom(obj, pad = 0) {
    obj.updateWorldMatrix(true, true)
    const b = new THREE.Box3().setFromObject(obj)
    if (pad) b.expandByScalar(pad)
    this.colliders.boxes.push(b)
    return b
  }

  /** Box3 collider from min/max corners. */
  boxCollider(min, max) {
    const b = new THREE.Box3(toVec3(min).clone(), toVec3(max).clone())
    this.colliders.boxes.push(b)
    return b
  }

  /** Box3 collider from center + size. */
  boxColliderCS(center, size) {
    const b = new THREE.Box3().setFromCenterAndSize(toVec3(center).clone(), toVec3(size).clone())
    this.colliders.boxes.push(b)
    return b
  }

  sphereCollider(center, radius) {
    const s = { center: toVec3(center).clone(), radius }
    this.colliders.spheres.push(s)
    return s
  }

  // ---------------------------------------------------------------- props

  /** Jittered low-poly rock. o: mesh opts + { detail=0, squash=0.7, collider (adds sphere) } */
  rock(radius, color, seed = 1, o = {}) {
    const g = new THREE.IcosahedronGeometry(radius, o.detail ?? 0)
    jitterGeometry(g, radius * 0.28, seed)
    const s = o.squash ?? 0.7
    g.scale(1, s, 1)
    g.computeVertexNormals()
    const m = this.mesh(g, this.mat(color), { ...o, collider: false })
    m.rotation.y = hash3(seed, 9, 9) * Math.PI * 2
    if (o.collider) {
      m.updateWorldMatrix(true, false)
      const c = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld)
      this.sphereCollider(c, radius * Math.max(s, 0.6) * 0.95)
    }
    return m
  }

  /** Crate: box body with darker banding. Returns group. */
  crate(size, color, trim, o = {}) {
    const g = new THREE.Group()
    const p = toVec3(o.position)
    if (p) g.position.copy(p)
    if (o.rotation) g.rotation.set(o.rotation[0] || 0, o.rotation[1] || 0, o.rotation[2] || 0)
    ;(o.parent || this.root).add(g)
    this.box(size, size, size, color, { parent: g, jitter: size * 0.015 })
    this.box(size * 1.02, size * 0.14, size * 1.02, trim, { parent: g, position: [0, size * 0.3, 0] })
    this.box(size * 1.02, size * 0.14, size * 1.02, trim, { parent: g, position: [0, -size * 0.3, 0] })
    // footprint of the unrotated crate (rotated AABBs would inflate the collider)
    if (o.collider) this.boxColliderCS(g.position, new THREE.Vector3(size, size, size))
    return g
  }

  /** Cylindrical pipe between two points. */
  pipe(a, b, radius, color, o = {}) {
    const A = toVec3(a)
    const B = toVec3(b)
    const len = A.distanceTo(B)
    const g = new THREE.CylinderGeometry(radius, radius, len, o.segs ?? 6, 1, true)
    const m = this.mesh(g, o.mat || this.mat(color, { metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }), {
      ...o,
      collider: false,
      position: A.clone().add(B).multiplyScalar(0.5),
    })
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
    if (o.collider) this.colliderFrom(m, o.pad ?? 0)
    return m
  }

  /** Wall panel with a recessed inset and optional light strip. Faces +Z in local space. */
  panel(w, h, color, inset, o = {}) {
    const g = new THREE.Group()
    const p = toVec3(o.position)
    if (p) g.position.copy(p)
    if (o.rotation) g.rotation.set(o.rotation[0] || 0, o.rotation[1] || 0, o.rotation[2] || 0)
    ;(o.parent || this.root).add(g)
    this.box(w, h, 0.12, color, { parent: g })
    this.box(w * 0.8, h * 0.7, 0.04, inset, { parent: g, position: [0, 0, 0.07] })
    if (o.strip) this.box(w * 0.6, 0.05, 0.03, o.strip, { parent: g, position: [0, h * 0.42, 0.08], mat: this.glow(o.strip, 1.2) })
    return g
  }

  /**
   * Console: base, slanted top, glowing screen + a few buttons. Faces +Z locally.
   * o: { position, rotationY, width=1.2, height=1.0, depth=0.6, body, screen, collider=true, parent }
   */
  console(o = {}) {
    const w = o.width ?? 1.2
    const h = o.height ?? 1.0
    const d = o.depth ?? 0.6
    const body = o.body ?? 0x6b7670
    const screen = o.screen ?? PHOSPHOR
    const g = new THREE.Group()
    const p = toVec3(o.position)
    if (p) g.position.copy(p)
    g.rotation.y = o.rotationY ?? 0
    ;(o.parent || this.root).add(g)
    this.box(w, h, d, body, { parent: g, position: [0, h / 2, 0] })
    const top = this.box(w, 0.08, d * 0.9, o.trim ?? 0x3a4744, { parent: g, position: [0, h + 0.02, 0.02] })
    top.rotation.x = -0.35
    const scr = this.box(w * 0.7, 0.02, d * 0.5, screen, { parent: g, position: [0, h + 0.075, 0.04], mat: this.glow(screen, 1.4), cast: false })
    scr.rotation.x = -0.35
    const r = rng(o.seed ?? 11)
    const btnCols = [0xd9573b, 0xffb347, PHOSPHOR, 0x4f8fd6]
    for (let i = 0; i < 4; i++) {
      this.box(0.08, 0.04, 0.08, 0, {
        parent: g,
        position: [-w * 0.3 + i * w * 0.2, h * 0.78, d / 2 + 0.02],
        mat: this.glow(btnCols[Math.floor(r() * btnCols.length)], 0.9),
        cast: false,
      })
    }
    g.userData.screen = scr
    if (o.collider ?? true) this.colliderFrom(g)
    return g
  }

  /**
   * Window: chunky frame bars and a faintly tinted glass pane. Faces +Z locally.
   * o: { position, rotationY, glass, frame, bars=3, parent }
   */
  windowFrame(w, h, o = {}) {
    const g = new THREE.Group()
    const p = toVec3(o.position)
    if (p) g.position.copy(p)
    g.rotation.y = o.rotationY ?? 0
    ;(o.parent || this.root).add(g)
    const frame = o.frame ?? 0x3a4744
    const t = 0.22
    this.box(w + t * 2, t, 0.35, frame, { parent: g, position: [0, h / 2 + t / 2, 0] })
    this.box(w + t * 2, t, 0.35, frame, { parent: g, position: [0, -h / 2 - t / 2, 0] })
    this.box(t, h, 0.35, frame, { parent: g, position: [-w / 2 - t / 2, 0, 0] })
    this.box(t, h, 0.35, frame, { parent: g, position: [w / 2 + t / 2, 0, 0] })
    const bars = o.bars ?? 3
    for (let i = 1; i < bars; i++) this.box(0.1, h, 0.2, frame, { parent: g, position: [-w / 2 + (w * i) / bars, 0, 0] })
    const glassMat = this.track(
      new THREE.MeshStandardMaterial({ color: o.glass ?? 0x9fd8ff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    )
    this.mesh(new THREE.PlaneGeometry(w, h), glassMat, { parent: g, cast: false, receive: false })
    return g
  }

  // ---------------------------------------------------------------- sky things

  /** Star field as Points on a shell. Unaffected by fog. */
  stars(count = 1500, radius = 1500, seed = 42, size = 2) {
    const r = rng(seed)
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1
      const th = r() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const rr = radius * (0.85 + r() * 0.15)
      pos[i * 3] = Math.cos(th) * s * rr
      pos[i * 3 + 1] = u * rr
      pos[i * 3 + 2] = Math.sin(th) * s * rr
      const warm = r()
      c.setHSL(warm < 0.2 ? 0.08 : warm < 0.4 ? 0.6 : 0.15, 0.4, 0.55 + r() * 0.45)
      col.set([c.r, c.g, c.b], i * 3)
    }
    const g = this.track(new THREE.BufferGeometry())
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = this.track(new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }))
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.renderOrder = -10
    this.root.add(pts)
    return pts
  }

  /**
   * Low-poly planet sphere with per-face vertex colours. detail = Icosahedron detail (20·(detail+1)² faces).
   * type 'earth' (oceans, green/brown land, ice caps + a cloud shell) or 'red' (dusty world).
   * Returns a Group (spin it). Not fogged.
   */
  planetSphere(radius, type = 'earth', o = {}) {
    const seed = o.seed ?? 7
    const detail = o.detail ?? 4
    const group = new THREE.Group()
    const p = toVec3(o.position)
    if (p) group.position.copy(p)
    ;(o.parent || this.root).add(group)

    const g = new THREE.IcosahedronGeometry(1, detail) // non-indexed: 3 verts per face
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const v = new THREE.Vector3()
    const ctr = new THREE.Vector3()
    const c = new THREE.Color()
    const hAt = (x, y, z) => fbm3(x * 2.1 + 3, y * 2.1, z * 2.1, 5, seed)
    // displace (shared positions get identical displacement → watertight)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize()
      const h = hAt(v.x, v.y, v.z)
      const land = type === 'earth' ? Math.max(0, h - 0.52) : h - 0.5
      v.multiplyScalar(radius * (1 + land * (type === 'earth' ? 0.06 : 0.05)))
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    for (let f = 0; f < pos.count; f += 3) {
      ctr.set(0, 0, 0)
      for (let k = 0; k < 3; k++) ctr.add(v.fromBufferAttribute(pos, f + k))
      ctr.normalize()
      const h = hAt(ctr.x, ctr.y, ctr.z)
      const lat = Math.abs(ctr.y)
      if (type === 'earth') {
        if (lat > 0.88 || (lat > 0.78 && h > 0.5)) c.setHex(0xeef6fb)
        else if (h < 0.5) c.setHex(h < 0.44 ? 0x1b4f8f : 0x2a6db0)
        else if (h < 0.53) c.setHex(0xc8b27a)
        else if (h < 0.6) c.setHex(lat < 0.35 && h < 0.56 ? 0xa88c4c : 0x3f8a3c)
        else c.setHex(0x6b5a3a)
      } else {
        if (lat > 0.9) c.setHex(0xeadfd6)
        else if (h < 0.45) c.setHex(0x7a3520)
        else if (h < 0.55) c.setHex(0xb2583a)
        else c.setHex(0xd38a5a)
      }
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    const surf = this.mesh(g, this.mat(0xffffff, { vertexColors: true, roughness: 0.9, fog: false }), { parent: group, cast: false, receive: false })

    let clouds = null
    if (type === 'earth' && o.clouds !== false) {
      const cg = new THREE.IcosahedronGeometry(radius * 1.02, o.cloudDetail ?? detail)
      const cp = cg.attributes.position
      const keep = []
      for (let f = 0; f < cp.count; f += 3) {
        ctr.set(0, 0, 0)
        for (let k = 0; k < 3; k++) ctr.add(v.fromBufferAttribute(cp, f + k))
        ctr.normalize()
        if (fbm3(ctr.x * 3 + 11, ctr.y * 3, ctr.z * 3, 3, seed + 99) > (o.cloudCover ?? 0.6)) {
          for (let k = 0; k < 3; k++) keep.push(cp.getX(f + k), cp.getY(f + k), cp.getZ(f + k))
        }
      }
      cg.dispose()
      const cloudGeo = new THREE.BufferGeometry()
      cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3))
      cloudGeo.computeVertexNormals()
      clouds = this.mesh(cloudGeo, this.mat(0xffffff, { transparent: true, opacity: 0.6, fog: false, depthWrite: false, emissive: 0x506070, emissiveIntensity: 0.3 }), {
        parent: group,
        cast: false,
        receive: false,
      })
    }
    if (o.atmosphere !== false) {
      const atmo = new THREE.IcosahedronGeometry(radius * 1.08, 12)
      this.mesh(
        atmo,
        this.track(
          new THREE.MeshBasicMaterial({
            color: type === 'earth' ? 0x5fa8ff : 0xe0915c,
            transparent: true,
            opacity: 0.14,
            side: THREE.BackSide,
            fog: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        ),
        { parent: group, cast: false, receive: false },
      )
    }
    group.userData.surface = surf
    group.userData.clouds = clouds
    return group
  }

  /** Huge inverted sphere with a vertical colour gradient (sky). */
  skyDome(radius, stops, o = {}) {
    // stops: [[ny (-1..1), hex], ...] sorted ascending
    const g = new THREE.SphereGeometry(radius, 24, 12)
    const pos = g.attributes.position
    const col = new Float32Array(pos.count * 3)
    const a = new THREE.Color()
    const b = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const ny = pos.getY(i) / radius
      let k = 0
      while (k < stops.length - 2 && ny > stops[k + 1][0]) k++
      const [y0, c0] = stops[k]
      const [y1, c1] = stops[k + 1]
      const t = Math.min(1, Math.max(0, (ny - y0) / (y1 - y0)))
      a.setHex(c0).lerp(b.setHex(c1), t)
      col.set([a.r, a.g, a.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = this.mesh(g, this.basic(0xffffff, { vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }), {
      cast: false,
      receive: false,
      ...o,
    })
    m.renderOrder = -20
    m.frustumCulled = false
    return m
  }

  /** Glowing sun disc (billboard sprite + halo). */
  sun(position, color = 0xfff4d6, size = 40) {
    const tex = this.radialTexture(color)
    const mk = (s, op) => {
      const m = this.track(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: op, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }))
      const sp = new THREE.Sprite(m)
      sp.scale.setScalar(s)
      sp.position.copy(toVec3(position))
      this.root.add(sp)
      return sp
    }
    mk(size * 3, 0.35)
    return mk(size, 1)
  }

  /** Soft radial gradient texture (white core → transparent). */
  radialTexture() {
    const cv = makeCanvas(64, 64)
    if (!cv) return null
    const { canvas, ctx } = cv
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gr
    ctx.fillRect(0, 0, 64, 64)
    const t = this.track(new THREE.CanvasTexture(canvas))
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  // ---------------------------------------------------------------- markers

  /** Text label sprite drawn on a canvas (retro phosphor terminal style). */
  labelSprite(text, o = {}) {
    const color = o.color ?? '#39ff88'
    const fontPx = 44
    const pad = 22
    const cv = makeCanvas(1024, 96)
    let tex = null
    let aspect = 8
    if (cv) {
      const { canvas, ctx } = cv
      ctx.font = `bold ${fontPx}px "Courier New", monospace`
      const measured = ctx.measureText ? ctx.measureText(text) : null
      const tw = Math.min(1024 - pad * 2, Math.max(64, (measured && Number(measured.width)) || text.length * fontPx * 0.6))
      canvas.width = Math.ceil(tw + pad * 2)
      canvas.height = 96
      aspect = canvas.width / canvas.height
      ctx.font = `bold ${fontPx}px "Courier New", monospace`
      ctx.fillStyle = 'rgba(4,16,10,0.78)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = color
      ctx.lineWidth = 4
      ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
      ctx.fillStyle = color
      ctx.textBaseline = 'middle'
      ctx.fillText(text, pad, canvas.height / 2 + 2)
      tex = this.track(new THREE.CanvasTexture(canvas))
      tex.colorSpace = THREE.SRGBColorSpace
    }
    const m = this.track(new THREE.SpriteMaterial({ map: tex, color: tex ? 0xffffff : 0x39ff88, transparent: true, fog: false, depthWrite: false }))
    const sp = new THREE.Sprite(m)
    const h = o.height ?? 0.42
    sp.scale.set(h * aspect, h, 1)
    sp.renderOrder = 5
    const p = toVec3(o.position)
    if (p) sp.position.copy(p)
    ;(o.parent || this.root).add(sp)
    return sp
  }

  /**
   * POI beacon: small bobbing holo-diamond + spinning ring + faint light column.
   * Animated automatically by kit.update(). Returns the group.
   */
  beacon(position, o = {}) {
    const color = o.color ?? PHOSPHOR
    const g = new THREE.Group()
    g.position.copy(toVec3(position))
    ;(o.parent || this.root).add(g)
    const glowMat = this.glow(color, 2.2, { transparent: true, opacity: 0.9 })
    const diamond = this.mesh(new THREE.OctahedronGeometry(0.16, 0), glowMat, { parent: g, cast: false, receive: false })
    diamond.scale.set(1, 1.5, 1)
    const ringMat = this.basic(color, { transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
    const ring = this.mesh(new THREE.TorusGeometry(0.32, 0.018, 3, 16), ringMat, { parent: g, cast: false, receive: false })
    ring.rotation.x = Math.PI / 2
    const ring2 = this.mesh(new THREE.TorusGeometry(0.22, 0.012, 3, 12), ringMat, { parent: g, cast: false, receive: false })
    const phase = (o.phase ?? hash3(Math.round(g.position.x * 10), Math.round(g.position.z * 10), 1)) * 10
    const baseY = g.position.y
    this.animate((dt, t) => {
      const tt = t + phase
      g.position.y = baseY + Math.sin(tt * 2.1) * 0.07
      diamond.rotation.y = tt * 1.6
      ring.rotation.z = tt * 0.9
      ring.scale.setScalar(1 + Math.sin(tt * 3) * 0.08)
      ring2.rotation.y = -tt * 1.3
      ring2.rotation.x = Math.sin(tt * 0.7) * 0.6
    })
    return g
  }

  /**
   * Portal marker: a pulsing floor ring, a slowly spinning upright ring and a floating label.
   * `position` is the floor point. Returns the group.
   */
  portalMarker(position, label, o = {}) {
    const color = o.color ?? PHOSPHOR
    const g = new THREE.Group()
    g.position.copy(toVec3(position))
    if (o.rotationY) g.rotation.y = o.rotationY
    ;(o.parent || this.root).add(g)
    const r = o.radius ?? 1.1
    const ringMat = this.glow(color, 2.0)
    const floorRing = this.mesh(new THREE.TorusGeometry(r, 0.05, 3, 24), ringMat, { parent: g, cast: false, receive: false })
    floorRing.rotation.x = Math.PI / 2
    floorRing.position.y = 0.05
    const pulseMat = this.basic(color, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    const pulse = this.mesh(new THREE.RingGeometry(r * 0.2, r * 0.26, 24, 1), pulseMat, { parent: g, cast: false, receive: false })
    pulse.rotation.x = -Math.PI / 2
    pulse.position.y = 0.07
    const upright = this.mesh(new THREE.TorusGeometry(r * 0.85, 0.03, 3, 6), this.basic(color, { transparent: true, opacity: 0.45, depthWrite: false }), {
      parent: g,
      cast: false,
      receive: false,
      position: [0, (o.uprightY ?? 1.3), 0],
    })
    const sprite = this.labelSprite(label, { parent: g, position: [0, o.labelY ?? 2.6, 0], color: o.css ?? '#39ff88' })
    const phase = hash3(Math.round(g.position.x * 10), Math.round(g.position.z * 10), 2) * 10
    this.animate((dt, t) => {
      const k = ((t + phase) * 0.6) % 1
      pulse.scale.setScalar(1 + k * 3.4)
      pulse.material.opacity = 0.55 * (1 - k)
      upright.rotation.y = (t + phase) * 0.8
      upright.position.y = (o.uprightY ?? 1.3) + Math.sin(t * 1.7) * 0.06
      sprite.position.y = (o.labelY ?? 2.6) + Math.sin(t * 1.3 + 1) * 0.05
    })
    // pulse material must be unique per marker since we animate its opacity
    pulse.material = this.track(pulseMat.clone())
    return g
  }

  // ---------------------------------------------------------------- lighting

  /**
   * Standard rig: hemisphere fill + shadow-casting directional "sun" with the shadow frustum sized to
   * `area` metres around `target`. Returns { hemi, sun, follow(pos) } — call follow() each frame to keep
   * the shadow camera centred on the player for large levels.
   */
  lights(o = {}) {
    const hemi = new THREE.HemisphereLight(o.sky ?? 0xdfeeff, o.ground ?? 0x3a3530, o.hemiIntensity ?? 1.0)
    this.root.add(hemi)
    const sun = new THREE.DirectionalLight(o.sunColor ?? 0xffffff, o.sunIntensity ?? 2.2)
    const target = toVec3(o.target) ?? new THREE.Vector3()
    const offset = toVec3(o.direction ?? [0.5, 1, 0.3]).clone().normalize().multiplyScalar(o.distance ?? 60)
    sun.position.copy(target).add(offset)
    sun.target.position.copy(target)
    sun.castShadow = o.shadows ?? true
    const half = (o.area ?? 40) / 2
    const cam = sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = (o.distance ?? 60) * 2 + half
    cam.updateProjectionMatrix()
    sun.shadow.mapSize.set(o.mapSize ?? 2048, o.mapSize ?? 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    this.root.add(sun)
    this.root.add(sun.target)
    let ambient = null
    if (o.ambient) {
      ambient = new THREE.AmbientLight(o.ambient, o.ambientIntensity ?? 0.3)
      this.root.add(ambient)
    }
    const texel = (half * 2) / (o.mapSize ?? 2048)
    const follow = (pos) => {
      // snap to shadow texels to avoid shimmering
      const x = Math.round(pos.x / texel) * texel
      const z = Math.round(pos.z / texel) * texel
      sun.target.position.set(x, target.y, z)
      sun.position.copy(sun.target.position).add(offset)
    }
    return { hemi, sun, ambient, follow }
  }

  pointLight(color, intensity, distance, position, parent) {
    const l = new THREE.PointLight(color, intensity, distance, 2)
    l.position.copy(toVec3(position))
    ;(parent || this.root).add(l)
    return l
  }

  // ---------------------------------------------------------------- lifecycle

  update(dt, t) {
    for (const fn of this._anim) fn(dt, t)
  }

  dispose() {
    this._anim.length = 0
    this.root.traverse((o) => {
      if (o.geometry) this._res.add(o.geometry)
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of ms) {
        this._res.add(m)
        if (m.map) this._res.add(m.map)
      }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose()
    })
    this.root.removeFromParent()
    for (const r of this._res) r.dispose?.()
    this._res.clear()
    this._mats.clear()
  }
}
