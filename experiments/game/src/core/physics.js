// Vital-Link wobble engine: a small custom Verlet / position-based soft-body sim.
// Soft jelly shells (edge springs + pressure + shape matching), ropes, floppy ragdolls,
// static colliders (ground fn, boxes, spheres, bounds), player capsule push, cheap body-vs-body.
// Fixed 120 Hz substeps. No external physics libraries.
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

const HZ = 120
const H = 1 / HZ
const H2 = H * H
const MAX_SUBSTEPS = 5
const ITERATIONS = 3
const MAX_MOVE = 0.5 // max particle displacement per substep (60 m/s)
const SAFE_EVERY = 30
const STATIC_SLIP2 = (0.05 * H) ** 2 // contacts slower than 5 cm/s stick // substeps between "last known good" snapshots (NaN recovery)

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _t = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _X = new THREE.Vector3()
const _Y = new THREE.Vector3()
const _Z = new THREE.Vector3()

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** World position of an attach/pin target: Object3D (world pos) or a live Vector3. */
function targetPosition(target, out) {
  if (target && target.isObject3D) return target.getWorldPosition(out)
  return out.copy(target)
}

/** Quaternion whose local +Y points along y and whose local +X is as close to `r` as possible. */
function basisQuat(yx, yy, yz, rx, ry, rz, outQ) {
  let l = Math.hypot(yx, yy, yz)
  if (l < 1e-8) { yx = 0; yy = 1; yz = 0; l = 1 }
  _Y.set(yx / l, yy / l, yz / l)
  const d = rx * _Y.x + ry * _Y.y + rz * _Y.z
  _X.set(rx - _Y.x * d, ry - _Y.y * d, rz - _Y.z * d)
  if (_X.lengthSq() < 1e-10) {
    _X.set(1, 0, 0)
    if (Math.abs(_Y.x) > 0.9) _X.set(0, 0, 1)
    const d2 = _X.dot(_Y)
    _X.addScaledVector(_Y, -d2)
  }
  _X.normalize()
  _Z.crossVectors(_X, _Y)
  _m4.makeBasis(_X, _Y, _Z)
  return outQ.setFromRotationMatrix(_m4)
}

export class Particle {
  constructor(body, x, y, z, invMass, radius, contactRadius = radius, friction = 0.3) {
    this.position = new THREE.Vector3(x, y, z)
    this.previous = new THREE.Vector3(x, y, z)
    this.safe = new THREE.Vector3(x, y, z)
    this.invMass = invMass
    this.baseInvMass = invMass
    this.radius = radius // vs static colliders / player
    this.contactRadius = contactRadius // vs other bodies
    this.friction = friction
    this.contact = false
    this.body = body
    this.index = 0
  }
}

// ---------------------------------------------------------------------------------------------
class Body {
  constructor(world, kind, opts) {
    this.world = world
    this.kind = kind
    this.name = opts.name ?? kind
    this.particles = []
    this.userData = {}
    this.mass = Math.max(0.01, opts.mass ?? 1)
    this._consList = []
    this._pin = null
    this._held = 0
    this._c = new THREE.Vector3()
    this._r = 0
    this._coreRadius = 0
    this.disposed = false
  }

  _addParticle(x, y, z, invMass, radius, contactRadius, friction) {
    const p = new Particle(this, x, y, z, invMass, radius, contactRadius, friction)
    p.index = this.particles.length
    this.particles.push(p)
    return p
  }

  /** type 0 = equality, 1 = min distance only, 2 = max distance only */
  _addConstraint(i, j, stiffness = 1, type = 0, rest) {
    const P = this.particles
    if (rest === undefined) rest = P[i].position.distanceTo(P[j].position)
    this._consList.push([i, j, rest, stiffness, type])
  }

  _finalize() {
    const n = this._consList.length
    this.cA = new Int32Array(n)
    this.cB = new Int32Array(n)
    this.cRest = new Float64Array(n)
    this.cStiff = new Float64Array(n)
    this.cType = new Uint8Array(n)
    this._consList.forEach((c, k) => {
      this.cA[k] = c[0]
      this.cB[k] = c[1]
      this.cRest[k] = c[2]
      this.cStiff[k] = c[3]
      this.cType[k] = c[4]
    })
    this._consList = null
    this._computeBounds()
  }

  center(target = new THREE.Vector3()) {
    const P = this.particles
    target.set(0, 0, 0)
    for (let i = 0; i < P.length; i++) target.add(P[i].position)
    return P.length ? target.multiplyScalar(1 / P.length) : target
  }

  velocity(target = new THREE.Vector3()) {
    const P = this.particles
    target.set(0, 0, 0)
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      target.x += p.position.x - p.previous.x
      target.y += p.position.y - p.previous.y
      target.z += p.position.z - p.previous.z
    }
    return P.length ? target.multiplyScalar(1 / (P.length * H)) : target
  }

  /** Momentum impulse (kg·m/s): velocity change = v / mass, spread over the whole body. */
  applyImpulse(v) {
    this.addVelocity(_t.copy(v).multiplyScalar(1 / this.mass))
  }

  /** Adds a velocity change (m/s) to every free particle. */
  addVelocity(v) {
    const P = this.particles
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      if (p.invMass > 0) p.previous.addScaledVector(v, -H)
    }
  }

  translate(v) {
    const P = this.particles
    for (let i = 0; i < P.length; i++) {
      P[i].position.add(v)
      P[i].previous.add(v)
      P[i].safe.add(v)
    }
    this._c.add(v)
  }

  /** Softly tethers the body's centre to an Object3D / live Vector3 (null releases). */
  pinTo(target) {
    this._pin = target || null
  }

  /** Bounding sphere of the particles; returns false if anything is non-finite. */
  _computeBounds() {
    const P = this.particles
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < P.length; i++) {
      const q = P[i].position
      cx += q.x; cy += q.y; cz += q.z
    }
    const inv = 1 / Math.max(1, P.length)
    cx *= inv; cy *= inv; cz *= inv
    let r2 = 0
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      const q = p.position
      const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + p.contactRadius
      if (d > r2) r2 = d
    }
    if (!Number.isFinite(cx + cy + cz + r2)) return false
    this._c.set(cx, cy, cz)
    this._r = r2
    return true
  }

  _snapshot() {
    const P = this.particles
    for (let i = 0; i < P.length; i++) P[i].safe.copy(P[i].position)
  }

  _recover() {
    const P = this.particles
    for (let i = 0; i < P.length; i++) {
      P[i].position.copy(P[i].safe)
      P[i].previous.copy(P[i].safe)
    }
    this._computeBounds()
  }

  _preStep(world) {
    if (!this._pin) return
    targetPosition(this._pin, _t)
    if (!Number.isFinite(_t.x + _t.y + _t.z)) return
    const c = this.center(_c)
    const dx = (_t.x - c.x) * 0.08, dy = (_t.y - c.y) * 0.08, dz = (_t.z - c.z) * 0.08
    const P = this.particles
    // cancel gravity for pinned bodies so they hang at the target instead of sagging
    const gy = world.gravity * H2
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      if (p.invMass === 0) continue
      p.position.x += dx; p.position.y += dy + gy; p.position.z += dz
      p.previous.x += dx; p.previous.y += dy + gy; p.previous.z += dz
      p.previous.lerp(p.position, 0.03)
    }
  }

  _solveDistances() {
    const P = this.particles
    const cA = this.cA, cB = this.cB, cRest = this.cRest, cStiff = this.cStiff, cType = this.cType
    for (let k = 0, n = cA.length; k < n; k++) {
      const a = P[cA[k]], b = P[cB[k]]
      const wa = a.invMass, wb = b.invMass
      const ws = wa + wb
      if (ws === 0) continue
      const pa = a.position, pb = b.position
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < 1e-9) continue
      const rest = cRest[k]
      const t = cType[k]
      if (t === 1 && d >= rest) continue
      if (t === 2 && d <= rest) continue
      const s = ((d - rest) / (d * ws)) * cStiff[k]
      pa.x += dx * s * wa; pa.y += dy * s * wa; pa.z += dz * s * wa
      pb.x -= dx * s * wb; pb.y -= dy * s * wb; pb.z -= dz * s * wb
    }
  }

  _solve() {
    this._solveDistances()
  }

  _postSolve() {}

  /** Default raycast: particle spheres. Returns { t, particle } or null. */
  _raycast(o, d, maxDist) {
    let best = null
    let bestT = maxDist
    const P = this.particles
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      const t = raySphere(o, d, p.position, p.contactRadius + 0.05)
      if (t !== null && t < bestT) {
        bestT = t
        best = p
      }
    }
    return best ? { t: bestT, particle: best } : null
  }

  _updateMesh() {}

  _disposeObject(obj) {
    if (!obj) return
    obj.removeFromParent()
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) m.dispose()
      }
    })
  }

  dispose() {
    this.disposed = true
  }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z
  const b = ox * d.x + oy * d.y + oz * d.z
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  let t = -b - s
  if (t < 0) t = -b + s
  return t >= 0 ? t : null
}

function makeMaterial(color, roughness = 0.6, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness, metalness: 0.05, ...extra })
}

// ---------------------------------------------------------------------------------------------
export class SoftBody extends Body {
  constructor(world, opts) {
    super(world, 'soft', opts)
    const radius = Math.max(0.05, opts.radius ?? 0.5)
    const detail = clamp(Math.round(opts.detail ?? 1), 0, 3)
    const shape = opts.shape ?? 'sphere'
    const stiffness = clamp(opts.stiffness ?? 0.6, 0, 1)
    this.pressure = opts.pressure ?? 1
    this.wobble = Math.max(0.1, opts.wobble ?? 1)
    this.stiffness = stiffness
    const origin = opts.position ?? new THREE.Vector3()

    let geo = new THREE.IcosahedronGeometry(1, detail)
    geo.deleteAttribute('normal')
    geo.deleteAttribute('uv')
    geo = mergeVertices(geo, 1e-4)
    const pos = geo.attributes.position
    const n = pos.count

    // --- shape the unit sphere into the requested rest shape
    const size = opts.size
    const hx = (size?.x ?? radius * 2) / 2, hy = (size?.y ?? radius * 2) / 2, hz = (size?.z ?? radius * 2) / 2
    const capH = Math.max(radius * 2, size?.y ?? radius * 3) / 2
    const rest = new Float64Array(n * 3)
    let minExtent = radius
    for (let i = 0; i < n; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      if (shape === 'box') {
        const s = 1 / Math.max(Math.abs(x) / hx, Math.abs(y) / hy, Math.abs(z) / hz)
        // blend a little toward the sphere so corners stay soft and particles well spaced
        x *= s; y *= s; z *= s
      } else if (shape === 'capsule') {
        const stretch = Math.sign(y) * Math.min(1, Math.abs(y) * 2.5) * (capH - radius)
        x *= radius; z *= radius; y = y * radius + stretch
      } else {
        x *= radius; y *= radius; z *= radius
      }
      rest[i * 3] = x; rest[i * 3 + 1] = y; rest[i * 3 + 2] = z
    }
    if (shape === 'box') minExtent = Math.min(hx, hy, hz)
    // recentre rest shape
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < n; i++) { cx += rest[i * 3]; cy += rest[i * 3 + 1]; cz += rest[i * 3 + 2] }
    cx /= n; cy /= n; cz /= n
    for (let i = 0; i < n; i++) { rest[i * 3] -= cx; rest[i * 3 + 1] -= cy; rest[i * 3 + 2] -= cz }
    this._rest = rest

    // --- triangles & edges
    const idx = geo.index.array
    this._tri = new Int32Array(idx)
    const edgeSet = new Set()
    const edges = []
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)]
        const key = a < b ? a * 100000 + b : b * 100000 + a
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push(a, b) }
      }
    }
    let edgeSum = 0
    for (let k = 0; k < edges.length; k += 2) {
      const a = edges[k] * 3, b = edges[k + 1] * 3
      edgeSum += Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2])
    }
    const meanEdge = edgeSum / (edges.length / 2)

    // --- particles
    const w = n / this.mass
    const cr = clamp(meanEdge * 0.4, 0.03, 0.25)
    for (let i = 0; i < n; i++) {
      this._addParticle(origin.x + rest[i * 3], origin.y + rest[i * 3 + 1], origin.z + rest[i * 3 + 2], w, 0.015, cr, 0.25)
    }
    const edgeStiff = 0.15 + 0.75 * stiffness
    for (let k = 0; k < edges.length; k += 2) this._addConstraint(edges[k], edges[k + 1], edgeStiff)
    this._edgeCount = edges.length / 2
    this._appliedPressure = 1

    // volume
    this._grad = new Float64Array(n * 3)
    let V = this._volume()
    if (V < 0) {
      for (let t = 0; t < this._tri.length; t += 3) {
        const tmp = this._tri[t + 1]; this._tri[t + 1] = this._tri[t + 2]; this._tri[t + 2] = tmp
      }
      V = -V
    }
    this._restVolume = V
    this._volumeStiff = 0.6 + 0.4 * stiffness
    this._shapeAlpha = clamp((0.015 + 0.16 * stiffness) / this.wobble, 0.003, 0.5)
    this._q = [0, 0, 0, 1] // shape-matching rotation (x, y, z, w), warm started
    this._coreRadius = minExtent * 0.7

    // --- mesh (vertices stored relative to mesh.position = body centre)
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(this._tri), 1))
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage)
    const mat = makeMaterial(opts.color ?? 0xffffff, 0.4)
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.name = this.name
    this.mesh.userData.physicsBody = this
    world.scene.add(this.mesh)
    this._finalize()
    this._syncPressure()
    this._updateMesh()
  }

  _volume() {
    const P = this.particles
    const T = this._tri
    let V = 0
    for (let t = 0; t < T.length; t += 3) {
      const a = P[T[t]].position, b = P[T[t + 1]].position, c = P[T[t + 2]].position
      V += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x)
    }
    return V / 6
  }

  _solveVolume() {
    const P = this.particles
    const T = this._tri
    const g = this._grad
    g.fill(0)
    // positions relative to body centre for precision
    const ox = this._c.x, oy = this._c.y, oz = this._c.z
    let V = 0
    for (let t = 0; t < T.length; t += 3) {
      const i0 = T[t], i1 = T[t + 1], i2 = T[t + 2]
      const a = P[i0].position, b = P[i1].position, c = P[i2].position
      const ax = a.x - ox, ay = a.y - oy, az = a.z - oz
      const bx = b.x - ox, by = b.y - oy, bz = b.z - oz
      const cx = c.x - ox, cy = c.y - oy, cz = c.z - oz
      // cross products
      const bcx = by * cz - bz * cy, bcy = bz * cx - bx * cz, bcz = bx * cy - by * cx
      V += ax * bcx + ay * bcy + az * bcz
      g[i0 * 3] += bcx; g[i0 * 3 + 1] += bcy; g[i0 * 3 + 2] += bcz
      g[i1 * 3] += cy * az - cz * ay; g[i1 * 3 + 1] += cz * ax - cx * az; g[i1 * 3 + 2] += cx * ay - cy * ax
      g[i2 * 3] += ay * bz - az * by; g[i2 * 3 + 1] += az * bx - ax * bz; g[i2 * 3 + 2] += ax * by - ay * bx
    }
    V /= 6
    const C = V - this._restVolume * this.pressure
    let denom = 0
    for (let i = 0; i < P.length; i++) {
      const gx = g[i * 3] / 6, gy = g[i * 3 + 1] / 6, gz = g[i * 3 + 2] / 6
      denom += P[i].invMass * (gx * gx + gy * gy + gz * gz)
    }
    if (denom < 1e-12) return
    const lambda = (-C / denom) * this._volumeStiff
    // Net impulse on a closed shell must be zero: remove the mass-weighted mean correction
    let mx = 0, my = 0, mz = 0, msum = 0
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      if (p.invMass === 0) continue
      const s = (lambda * p.invMass) / 6
      const m = 1 / p.invMass
      mx += g[i * 3] * s * m; my += g[i * 3 + 1] * s * m; mz += g[i * 3 + 2] * s * m
      msum += m
    }
    if (msum > 0) { mx /= msum; my /= msum; mz /= msum }
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      if (p.invMass === 0) continue
      const s = (lambda * p.invMass) / 6
      p.position.x += g[i * 3] * s - mx
      p.position.y += g[i * 3 + 1] * s - my
      p.position.z += g[i * 3 + 2] * s - mz
    }
  }

  /** Keeps rest shape + edge lengths consistent with the inflated (pressure) volume so the
   * volume, edge and shape-matching constraints share one equilibrium (no internal fight → no drift). */
  _syncPressure() {
    const pr = Math.max(0.05, Number(this.pressure) || 1)
    if (pr === this._appliedPressure) return
    const f = Math.cbrt(pr / this._appliedPressure)
    const R = this._rest
    for (let i = 0; i < R.length; i++) R[i] *= f
    const n = this._edgeCount
    for (let k = 0; k < n; k++) this.cRest[k] *= f
    this._coreRadius *= f
    this._appliedPressure = pr
  }

  /** Shape matching: pull every particle toward the best-fit rotated rest shape. */
  _shapeMatch() {
    const alpha = this._shapeAlpha
    if (alpha <= 0) return
    const P = this.particles
    const R = this._rest
    const n = P.length
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < n; i++) { const q = P[i].position; cx += q.x; cy += q.y; cz += q.z }
    cx /= n; cy /= n; cz /= n
    // A = sum (p - c) * r^T ; a_rc
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0
    for (let i = 0; i < n; i++) {
      const q = P[i].position
      const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz
      const rx = R[i * 3], ry = R[i * 3 + 1], rz = R[i * 3 + 2]
      a00 += dx * rx; a01 += dx * ry; a02 += dx * rz
      a10 += dy * rx; a11 += dy * ry; a12 += dy * rz
      a20 += dz * rx; a21 += dz * ry; a22 += dz * rz
    }
    // rotation extraction (Mueller et al. 2016), warm-started quaternion
    const Q = this._q
    let qx = Q[0], qy = Q[1], qz = Q[2], qw = Q[3]
    let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1
    for (let it = 0; it < 6; it++) {
      r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw)
      r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qx * qw)
      r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (qx * qx + qy * qy)
      // omega = sum_i cross(R_i, A_i) / |sum_i dot(R_i, A_i)|  (columns)
      const ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12)
      const oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22)
      const oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02)
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-9
      const wx = ox / den, wy = oy / den, wz = oz / den
      const w = Math.sqrt(wx * wx + wy * wy + wz * wz)
      if (w < 1e-9) break
      const half = w * 0.5
      const s = Math.sin(half) / w
      const dx = wx * s, dy = wy * s, dz = wz * s, dw = Math.cos(half)
      const nx = dw * qx + dx * qw + dy * qz - dz * qy
      const ny = dw * qy - dx * qz + dy * qw + dz * qx
      const nz = dw * qz + dx * qy - dy * qx + dz * qw
      const nw = dw * qw - dx * qx - dy * qy - dz * qz
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1
      qx = nx / l; qy = ny / l; qz = nz / l; qw = nw / l
    }
    if (!Number.isFinite(qx + qy + qz + qw)) { qx = 0; qy = 0; qz = 0; qw = 1 }
    Q[0] = qx; Q[1] = qy; Q[2] = qz; Q[3] = qw
    r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw)
    r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qx * qw)
    r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (qx * qx + qy * qy)
    for (let i = 0; i < n; i++) {
      const p = P[i]
      if (p.invMass === 0) continue
      const rx = R[i * 3], ry = R[i * 3 + 1], rz = R[i * 3 + 2]
      const q = p.position
      q.x += (cx + r00 * rx + r01 * ry + r02 * rz - q.x) * alpha
      q.y += (cy + r10 * rx + r11 * ry + r12 * rz - q.y) * alpha
      q.z += (cz + r20 * rx + r21 * ry + r22 * rz - q.z) * alpha
    }
  }

  _solve() {
    this._solveDistances()
    this._solveVolume()
  }

  _raycast(o, d, maxDist) {
    const P = this.particles
    const T = this._tri
    let bestT = maxDist
    let bestTri = -1
    for (let t = 0; t < T.length; t += 3) {
      const p0 = P[T[t]].position, p1 = P[T[t + 1]].position, p2 = P[T[t + 2]].position
      const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z
      const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z
      const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-12) continue
      const inv = 1 / det
      const tx = o.x - p0.x, ty = o.y - p0.y, tz = o.z - p0.z
      const u = (tx * px + ty * py + tz * pz) * inv
      if (u < 0 || u > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const v = (d.x * qx + d.y * qy + d.z * qz) * inv
      if (v < 0 || u + v > 1) continue
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (tt > 1e-4 && tt < bestT) { bestT = tt; bestTri = t }
    }
    if (bestTri < 0) return null
    _a.copy(o).addScaledVector(d, bestT)
    let best = P[T[bestTri]]
    let bd = Infinity
    for (let e = 0; e < 3; e++) {
      const p = P[T[bestTri + e]]
      const dd = p.position.distanceToSquared(_a)
      if (dd < bd) { bd = dd; best = p }
    }
    return { t: bestT, particle: best }
  }

  _updateMesh() {
    const P = this.particles
    const attr = this.mesh.geometry.attributes.position
    const arr = attr.array
    const c = this.center(_c)
    this.mesh.position.copy(c)
    for (let i = 0; i < P.length; i++) {
      const q = P[i].position
      arr[i * 3] = q.x - c.x
      arr[i * 3 + 1] = q.y - c.y
      arr[i * 3 + 2] = q.z - c.z
    }
    attr.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
    this.mesh.geometry.computeBoundingSphere()
  }

  dispose() {
    super.dispose()
    this._disposeObject(this.mesh)
  }
}

// ---------------------------------------------------------------------------------------------
const ROPE_SIDES = 5

export class Rope extends Body {
  constructor(world, opts) {
    super(world, 'rope', { mass: 0.3, ...opts })
    const start = opts.start ?? new THREE.Vector3(0, 2, 0)
    const end = opts.end ?? new THREE.Vector3(0, 0, 0)
    const segs = Math.max(2, Math.round(opts.segments ?? 20))
    const slack = Math.max(1, opts.slack ?? 1.1)
    this.thickness = Math.max(0.005, opts.thickness ?? 0.03)
    const dist = start.distanceTo(end)
    const segLen = (Math.max(dist, 0.05) * slack) / segs
    const w = (segs + 1) / this.mass
    // initial shape: straight line plus a gentle sag so the slack is visible
    for (let i = 0; i <= segs; i++) {
      const f = i / segs
      _a.lerpVectors(start, end, f)
      const sag = Math.sin(f * Math.PI) * dist * (slack - 1) * 0.8
      this._addParticle(_a.x, _a.y - sag, _a.z, w, this.thickness, this.thickness + 0.03, 0.5)
    }
    for (let i = 0; i < segs; i++) this._addConstraint(i, i + 1, 1, 2, segLen)
    for (let i = 0; i < segs - 1; i++) this._addConstraint(i, i + 2, 0.05, 1, segLen * 1.2) // mild anti-kink
    this._attach = [null, null] // { target, link?: {particle} }

    const rings = segs + 1
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rings * ROPE_SIDES * 3), 3).setUsage(THREE.DynamicDrawUsage))
    const index = []
    for (let i = 0; i < segs; i++) {
      for (let s = 0; s < ROPE_SIDES; s++) {
        const a = i * ROPE_SIDES + s
        const b = i * ROPE_SIDES + ((s + 1) % ROPE_SIDES)
        const c = a + ROPE_SIDES
        const d = b + ROPE_SIDES
        index.push(a, c, b, b, c, d)
      }
    }
    geo.setIndex(index)
    this.mesh = new THREE.Mesh(geo, makeMaterial(opts.color ?? 0xcccccc, 0.8))
    this.mesh.castShadow = true
    this.mesh.name = this.name
    this.mesh.userData.physicsBody = this
    this.mesh.frustumCulled = false
    world.scene.add(this.mesh)
    this._finalize()
    this._updateMesh()
  }

  attachStart(target) { this._setAttach(0, target) }
  attachEnd(target) { this._setAttach(1, target) }

  _setAttach(which, target) {
    const p = which === 0 ? this.particles[0] : this.particles[this.particles.length - 1]
    if (!target) {
      this._attach[which] = null
      p.invMass = p.baseInvMass
      return
    }
    // Attaching to another physics body's mesh/group ties the rope to that body's nearest particle.
    const other = target.isObject3D ? target.userData?.physicsBody : null
    if (other && other !== this && !other.disposed) {
      let best = other.particles[0]
      let bd = Infinity
      for (const q of other.particles) {
        const d = q.position.distanceToSquared(p.position)
        if (d < bd) { bd = d; best = q }
      }
      this._attach[which] = { target, link: best }
      p.invMass = p.baseInvMass
      return
    }
    this._attach[which] = { target, link: null }
    p.invMass = 0
    targetPosition(target, _t)
    if (Number.isFinite(_t.x + _t.y + _t.z)) { p.position.copy(_t); p.previous.copy(_t) }
  }

  _preStep(world) {
    super._preStep(world)
    for (let k = 0; k < 2; k++) {
      const a = this._attach[k]
      if (!a || a.link) continue
      const p = k === 0 ? this.particles[0] : this.particles[this.particles.length - 1]
      targetPosition(a.target, _t)
      if (!Number.isFinite(_t.x + _t.y + _t.z)) continue
      p.previous.copy(p.position)
      p.position.copy(_t)
    }
  }

  _solve() {
    this._solveDistances()
    for (let k = 0; k < 2; k++) {
      const a = this._attach[k]
      if (!a || !a.link) continue
      if (a.link.body.disposed) { this._setAttach(k, null); continue }
      const p = k === 0 ? this.particles[0] : this.particles[this.particles.length - 1]
      const q = a.link
      const ws = p.invMass + q.invMass
      if (ws === 0) continue
      _a.subVectors(q.position, p.position)
      p.position.addScaledVector(_a, p.invMass / ws)
      q.position.addScaledVector(_a, -q.invMass / ws)
    }
  }

  _updateMesh() {
    const P = this.particles
    const arr = this.mesh.geometry.attributes.position.array
    const n = P.length
    const th = this.thickness
    // parallel-transport frame
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)].position, b = P[Math.min(n - 1, i + 1)].position
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl; ty /= tl; tz /= tl
      if (i === 0) {
        // any perpendicular
        if (Math.abs(ty) < 0.9) { nx = tz; ny = 0; nz = -tx } else { nx = 0; ny = -tz; nz = ty }
      }
      const d = nx * tx + ny * ty + nz * tz
      nx -= tx * d; ny -= ty * d; nz -= tz * d
      let nl = Math.hypot(nx, ny, nz)
      if (nl < 1e-6) {
        if (Math.abs(ty) < 0.9) { nx = tz; ny = 0; nz = -tx } else { nx = 0; ny = -tz; nz = ty }
        nl = Math.hypot(nx, ny, nz) || 1
      }
      nx /= nl; ny /= nl; nz /= nl
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx
      const c = P[i].position
      for (let s = 0; s < ROPE_SIDES; s++) {
        const ang = (s / ROPE_SIDES) * Math.PI * 2
        const ca = Math.cos(ang) * th, sa = Math.sin(ang) * th
        const o = (i * ROPE_SIDES + s) * 3
        arr[o] = c.x + nx * ca + bx * sa
        arr[o + 1] = c.y + ny * ca + by * sa
        arr[o + 2] = c.z + nz * ca + bz * sa
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
    this.mesh.geometry.computeBoundingSphere()
  }

  dispose() {
    super.dispose()
    this._disposeObject(this.mesh)
  }
}

// ---------------------------------------------------------------------------------------------
// Ragdoll skeleton indices
const HEAD = 0, CHEST = 1, PELVIS = 2, LSH = 3, RSH = 4, LEL = 5, REL = 6, LHA = 7, RHA = 8
const LHIP = 9, RHIP = 10, LKN = 11, RKN = 12, LFT = 13, RFT = 14
// Stand template (feet at y=0, facing +Z), metres at scale 1.
const RAG_T = [
  [0, 1.6, 0.02], [0, 1.33, 0.08], [0, 0.98, 0.02], [-0.21, 1.4, 0], [0.21, 1.4, 0],
  [-0.25, 1.12, 0.01], [0.25, 1.12, 0.01], [-0.27, 0.85, 0.05], [0.27, 0.85, 0.05],
  [-0.11, 0.92, 0], [0.11, 0.92, 0], [-0.12, 0.5, 0.04], [0.12, 0.5, 0.04], [-0.12, 0.07, 0], [0.12, 0.07, 0],
]
const RAG_R = [0.14, 0.13, 0.12, 0.07, 0.07, 0.055, 0.055, 0.06, 0.06, 0.08, 0.08, 0.065, 0.065, 0.07, 0.07]
const RAG_M = [1, 1.6, 1.6, 1, 1, 0.5, 0.5, 0.35, 0.35, 1, 1, 0.7, 0.7, 0.6, 0.6]
const RAG_F = [0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.3, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.8, 0.8]
// limb segments for meshes / raycast: [a, b, radius, material slot]
const RAG_LIMBS = [
  [LSH, LEL, 0.06, 0], [RSH, REL, 0.06, 0], [LEL, LHA, 0.05, 0], [REL, RHA, 0.05, 0],
  [LHIP, LKN, 0.08, 0], [RHIP, RKN, 0.08, 0], [LKN, LFT, 0.065, 0], [RKN, RFT, 0.065, 0],
]

export class Ragdoll extends Body {
  constructor(world, opts) {
    super(world, 'ragdoll', { mass: 1.5, ...opts })
    const s = Math.max(0.1, opts.scale ?? 1)
    this.scale = s
    this.pose = ['stand', 'sit', 'float'].includes(opts.pose) ? opts.pose : 'stand'
    this.standStrength = Math.max(0, opts.standStrength ?? 0.6)
    this._seed = Math.random() * 100
    const origin = opts.position ?? new THREE.Vector3()
    const yaw = opts.yaw ?? 0

    // template positions (scaled) for rest lengths
    const T = RAG_T.map((p) => new THREE.Vector3(p[0] * s, p[1] * s, p[2] * s))
    const len = (i, j) => T[i].distanceTo(T[j])
    const Lu = len(LSH, LEL), Lf = len(LEL, LHA), Lt = len(LHIP, LKN), Ls = len(LKN, LFT)
    this._legLen = Lt + Ls
    this._headUp = T[HEAD].y - T[PELVIS].y
    this._pelvisH = T[PELVIS].y - T[LFT].y

    // build requested pose (local, before yaw/translation)
    const L = T.map((v) => v.clone())
    const limb = (root, mid, tip, l1, l2, d1, d2) => {
      L[mid].copy(L[root]).addScaledVector(_a.set(...d1).normalize(), l1)
      L[tip].copy(L[mid]).addScaledVector(_a.set(...d2).normalize(), l2)
    }
    if (this.pose === 'sit') {
      // origin = seat surface under the pelvis
      const lift = RAG_R[PELVIS] * s - T[PELVIS].y + 0.04 * s
      for (const i of [HEAD, CHEST, PELVIS, LSH, RSH, LHIP, RHIP]) L[i].y += lift
      limb(LHIP, LKN, LFT, Lt, Ls, [0, 0, 1], [0, -1, 0.1])
      limb(RHIP, RKN, RFT, Lt, Ls, [0, 0, 1], [0, -1, 0.1])
      limb(LSH, LEL, LHA, Lu, Lf, [-0.1, -1, 0.3], [0, -0.3, 1])
      limb(RSH, REL, RHA, Lu, Lf, [0.1, -1, 0.3], [0, -0.3, 1])
    } else if (this.pose === 'float') {
      // origin = body centre
      const drop = -0.95 * s
      for (const i of [HEAD, CHEST, PELVIS, LSH, RSH, LHIP, RHIP]) L[i].y += drop
      limb(LSH, LEL, LHA, Lu, Lf, [-0.8, -0.4, 0.2], [-0.6, 0.4, 0.4])
      limb(RSH, REL, RHA, Lu, Lf, [0.8, -0.4, 0.2], [0.6, 0.4, 0.4])
      limb(LHIP, LKN, LFT, Lt, Ls, [-0.3, -1, 0.15], [-0.05, -1, -0.3])
      limb(RHIP, RKN, RFT, Lt, Ls, [0.3, -1, 0.15], [0.05, -1, -0.3])
    }
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const mSum = RAG_M.reduce((a, b) => a + b, 0)
    for (let i = 0; i < L.length; i++) {
      const v = L[i]
      const x = v.x * cy + v.z * sy, z = -v.x * sy + v.z * cy
      const r = RAG_R[i] * s
      this._addParticle(origin.x + x, origin.y + v.y, origin.z + z, mSum / (RAG_M[i] * this.mass), r, r, RAG_F[i])
    }

    // constraints: rest lengths from the stand template (so any pose keeps proportions)
    const con = (i, j, k = 1, type = 0, rest) => this._addConstraint(i, j, k, type, rest ?? len(i, j))
    // torso (braced, nearly rigid)
    const torso = [CHEST, PELVIS, LSH, RSH, LHIP, RHIP]
    for (let a = 0; a < torso.length; a++) for (let b = a + 1; b < torso.length; b++) con(torso[a], torso[b], 1)
    // neck (a bit floppy)
    con(HEAD, CHEST, 0.9); con(HEAD, LSH, 0.5); con(HEAD, RSH, 0.5)
    // limbs
    con(LSH, LEL); con(LEL, LHA); con(RSH, REL); con(REL, RHA)
    con(LHIP, LKN); con(LKN, LFT); con(RHIP, RKN); con(RKN, RFT)
    // soft joint limits (min distances)
    con(LSH, LHA, 0.5, 1, (Lu + Lf) * 0.5); con(RSH, RHA, 0.5, 1, (Lu + Lf) * 0.5)
    con(LHIP, LFT, 0.5, 1, (Lt + Ls) * 0.55); con(RHIP, RFT, 0.5, 1, (Lt + Ls) * 0.55)
    con(LFT, RFT, 0.3, 1, 0.14 * s); con(LKN, RKN, 0.3, 1, 0.12 * s)
    con(LHA, CHEST, 0.3, 1, 0.16 * s); con(RHA, CHEST, 0.3, 1, 0.16 * s)
    con(HEAD, PELVIS, 0.5, 1, this._headUp * 0.85)
    this._finalize()

    // --- meshes
    const suit = new THREE.Color(opts.color ?? 0xdddddd)
    const matSuit = makeMaterial(suit, 0.7)
    const matDark = makeMaterial(0x2b2f36, 0.8)
    const matVisor = makeMaterial(0x1a2a3a, 0.2, { metalness: 0.6, emissive: 0x0a2a1a, emissiveIntensity: 0.4 })
    const matAccent = makeMaterial(0xff7a1a, 0.6)
    this._mats = [matSuit, matDark, matVisor, matAccent]
    const geoLimb = new THREE.CylinderGeometry(1, 0.85, 1, 6)
    const geoTorso = new THREE.BoxGeometry(0.42 * s, 1, 0.26 * s)
    const geoPack = new THREE.BoxGeometry(0.3 * s, 0.75, 0.14 * s)
    const geoHead = new THREE.IcosahedronGeometry(0.16 * s, 1)
    const geoVisor = new THREE.BoxGeometry(0.2 * s, 0.1 * s, 0.08 * s)
    const geoHand = new THREE.IcosahedronGeometry(0.07 * s, 0)
    const geoBoot = new THREE.BoxGeometry(0.13 * s, 0.1 * s, 0.24 * s)
    const geoStripe = new THREE.BoxGeometry(0.44 * s, 0.05, 0.28 * s)
    this.group = new THREE.Group()
    this.group.name = this.name
    this.group.userData.physicsBody = this
    this.mesh = this.group
    const mk = (g, m, parent = this.group) => {
      const o = new THREE.Mesh(g, m)
      o.castShadow = true
      o.receiveShadow = true
      parent.add(o)
      return o
    }
    this._torso = mk(geoTorso, matSuit)
    const pack = mk(geoPack, matDark, this._torso)
    pack.position.set(0, 0.05, -0.19 * s)
    const stripe = mk(geoStripe, matAccent, this._torso)
    stripe.position.set(0, -0.32, 0)
    this._head = mk(geoHead, matSuit)
    const visor = mk(geoVisor, matVisor, this._head)
    visor.position.set(0, 0.01 * s, 0.11 * s)
    this._limbs = RAG_LIMBS.map((l) => ({ mesh: mk(geoLimb, matSuit), a: l[0], b: l[1], r: l[2] * s }))
    this._hands = [mk(geoHand, matAccent), mk(geoHand, matAccent)]
    this._boots = [mk(geoBoot, matDark), mk(geoBoot, matDark)]
    this._geos = [geoLimb, geoTorso, geoPack, geoHead, geoVisor, geoHand, geoBoot, geoStripe]
    world.scene.add(this.group)
    this._updateMesh()
  }

  _preStep(world) {
    super._preStep(world)
    const s = this.standStrength
    if (!(world.gravity > 0.05) || s <= 0 || this.pose === 'float' || this._held) return
    const P = this.particles
    const head = P[HEAD].position, chest = P[CHEST].position, pel = P[PELVIS].position
    const lf = P[LFT], rf = P[RFT]
    const grounded = lf.contact || rf.contact || P[PELVIS].contact
    if (!grounded) return
    const t = world._time
    // uprightness 0..1
    const ux = head.x - pel.x, uy = head.y - pel.y, uz = head.z - pel.z
    const ul = Math.hypot(ux, uy, uz) || 1
    const up = Math.max(0, uy / ul)
    const k = s * (0.25 + 0.75 * up) * Math.min(1, world.gravity / 9.81 + 0.3)
    // drunk sway of the head target
    const swx = Math.sin(t * 1.7 + this._seed) * 0.07 + Math.sin(t * 3.1 + this._seed * 2) * 0.03
    const swz = Math.cos(t * 1.3 + this._seed * 1.7) * 0.07
    let ex = pel.x + swx * this.scale - head.x
    let ey = pel.y + this._headUp - head.y
    let ez = pel.z + swz * this.scale - head.z
    const el = Math.hypot(ex, ey, ez)
    if (el > 0.3) { ex *= 0.3 / el; ey *= 0.3 / el; ez *= 0.3 / el }
    const f = 0.02 * k
    head.x += ex * f; head.y += ey * f; head.z += ez * f
    chest.x += ex * f * 0.6; chest.y += ey * f * 0.6; chest.z += ez * f * 0.6
    pel.x -= ex * f * 0.6; pel.z -= ez * f * 0.6
    const feetDown = lf.contact || rf.contact
    if (feetDown) {
      lf.position.y -= ey * f * 0.5; rf.position.y -= ey * f * 0.5
    }
    // damp head wobble a touch so it sways rather than vibrates
    P[HEAD].previous.lerp(head, 0.015 * k)
    if (this.pose === 'stand' && feetDown) {
      const fx = (lf.position.x + rf.position.x) / 2, fz = (lf.position.z + rf.position.z) / 2
      const fy = Math.min(lf.position.y, rf.position.y)
      const dy = clamp(fy + this._pelvisH * 0.97 - pel.y, -0.1, 0.3)
      const dx = clamp(fx - pel.x, -0.3, 0.3), dz = clamp(fz - pel.z, -0.3, 0.3)
      const g = 0.025 * k
      pel.x += dx * g * 0.5; pel.y += dy * g; pel.z += dz * g * 0.5
      P[LHIP].position.y += dy * g * 0.7; P[RHIP].position.y += dy * g * 0.7
      lf.position.y -= dy * g * 0.5; rf.position.y -= dy * g * 0.5
      lf.position.x -= dx * g * 0.25; rf.position.x -= dx * g * 0.25
      lf.position.z -= dz * g * 0.25; rf.position.z -= dz * g * 0.25
      this._standActive = true
    } else this._standActive = false
  }

  _solve() {
    this._solveDistances()
    if (this._standActive) {
      // springy "straighten the knees" so the dummy can carry itself
      const P = this.particles
      const k = 0.12 * this.standStrength
      const pairs = [LHIP, LFT, RHIP, RFT]
      for (let i = 0; i < 4; i += 2) {
        const a = P[pairs[i]], b = P[pairs[i + 1]]
        _a.subVectors(b.position, a.position)
        const d = _a.length()
        if (d < 1e-6) continue
        const target = this._legLen * 0.97
        const ws = a.invMass + b.invMass
        const corr = ((d - target) / (d * ws)) * k
        a.position.addScaledVector(_a, corr * a.invMass)
        b.position.addScaledVector(_a, -corr * b.invMass)
      }
    }
  }

  _raycast(o, d, maxDist) {
    let bestT = maxDist
    let best = null
    const P = this.particles
    const test = (pos, r, particle) => {
      const t = raySphere(o, d, pos, r)
      if (t !== null && t < bestT) { bestT = t; best = particle }
    }
    for (let i = 0; i < P.length; i++) test(P[i].position, P[i].radius * 1.3 + 0.03, P[i])
    // sample along limbs and torso so mid-segments are hittable
    for (const l of RAG_LIMBS) {
      const a = P[l[0]], b = P[l[1]]
      for (let f = 0.25; f < 0.9; f += 0.25) {
        _b.lerpVectors(a.position, b.position, f)
        test(_b, l[2] * this.scale * 1.3 + 0.03, f < 0.5 ? a : b)
      }
    }
    for (let f = 0.25; f < 0.9; f += 0.25) {
      _b.lerpVectors(P[PELVIS].position, P[CHEST].position, f)
      test(_b, 0.2 * this.scale, P[CHEST])
    }
    return best ? { t: bestT, particle: best } : null
  }

  _updateMesh() {
    const P = this.particles
    const s = this.scale
    const lS = P[LSH].position, rS = P[RSH].position, lH = P[LHIP].position, rH = P[RHIP].position
    // torso frame
    const rx = rS.x - lS.x + rH.x - lH.x, ry = rS.y - lS.y + rH.y - lH.y, rz = rS.z - lS.z + rH.z - lH.z
    const ux = (lS.x + rS.x - lH.x - rH.x) / 2, uy = (lS.y + rS.y - lH.y - rH.y) / 2, uz = (lS.z + rS.z - lH.z - rH.z) / 2
    const tl = Math.hypot(ux, uy, uz)
    const torso = this._torso
    torso.position.set((lS.x + rS.x + lH.x + rH.x) / 4, (lS.y + rS.y + lH.y + rH.y) / 4, (lS.z + rS.z + lH.z + rH.z) / 4)
    basisQuat(ux, uy, uz, rx, ry, rz, torso.quaternion)
    torso.scale.set(1, tl + 0.16 * s, 1)
    // head
    const hp = P[HEAD].position, cp = P[CHEST].position
    this._head.position.copy(hp)
    basisQuat(hp.x - cp.x, hp.y - cp.y, hp.z - cp.z, rx, ry, rz, this._head.quaternion)
    // limbs
    for (const l of this._limbs) {
      const a = P[l.a].position, b = P[l.b].position
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
      const d = Math.hypot(dx, dy, dz)
      l.mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
      basisQuat(-dx, -dy, -dz, rx, ry, rz, l.mesh.quaternion)
      l.mesh.scale.set(l.r, d + l.r * 1.2, l.r)
    }
    // hands
    for (let i = 0; i < 2; i++) {
      const h = P[i === 0 ? LHA : RHA].position, e = P[i === 0 ? LEL : REL].position
      const m = this._hands[i]
      m.position.copy(h)
      basisQuat(h.x - e.x, h.y - e.y, h.z - e.z, rx, ry, rz, m.quaternion)
    }
    // boots: sole roughly perpendicular to the shin, toe forward
    for (let i = 0; i < 2; i++) {
      const f = P[i === 0 ? LFT : RFT].position, k = P[i === 0 ? LKN : RKN].position
      const m = this._boots[i]
      basisQuat(k.x - f.x, k.y - f.y, k.z - f.z, rx, ry, rz, m.quaternion)
      _a.set(0, 0, 0.05 * s).applyQuaternion(m.quaternion)
      m.position.set(f.x + _a.x, f.y + _a.y - 0.01 * s, f.z + _a.z)
    }
  }

  dispose() {
    super.dispose()
    this.group.removeFromParent()
    for (const g of this._geos) g.dispose()
    for (const m of this._mats) m.dispose()
  }
}

// ---------------------------------------------------------------------------------------------
class Grab {
  constructor(world, hit) {
    this.world = world
    this.body = hit.body
    this.particle = hit.particle
    this.target = (hit.point ?? hit.particle.position).clone()
    this.active = true
    this.members = []
    const b = this.body
    const radius = b.kind === 'soft' ? Math.max(0.12, b._r * 0.45) : b.kind === 'ragdoll' ? 0.14 * b.scale : 0.001
    for (const p of b.particles) {
      if (p.invMass === 0) continue
      const d = p.position.distanceTo(this.particle.position)
      if (d <= radius) this.members.push({ p, w: p === this.particle ? 1 : 0.6 * (1 - d / radius) + 0.1 })
    }
    if (!this.members.some((m) => m.p === this.particle)) this.members.push({ p: this.particle, w: 1 })
    this.gravityComp = b.kind === 'ragdoll' ? 0.5 : b.kind === 'rope' ? 0.3 : 0.85
    // whole-body follow so heavy/detailed shells actually lift (members still lead → stretchy)
    this.pull = b.kind === 'soft' ? 0.03 : b.kind === 'ragdoll' ? 0.012 : 0
    b._held++
  }

  setTarget(v) {
    if (v && Number.isFinite(v.x + v.y + v.z)) this.target.copy(v)
  }

  /** Releases; optional throwVelocity (m/s) is blended into the body's velocity. */
  release(throwVelocity) {
    if (!this.active) return
    this.active = false
    this.body._held = Math.max(0, this.body._held - 1)
    const i = this.world._grabs.indexOf(this)
    if (i >= 0) this.world._grabs.splice(i, 1)
    if (throwVelocity && Number.isFinite(throwVelocity.x + throwVelocity.y + throwVelocity.z) && !this.body.disposed) {
      const v = this.body.velocity(_b)
      _c.subVectors(throwVelocity, v).multiplyScalar(0.85)
      if (_c.length() > 40) _c.setLength(40)
      this.body.addVelocity(_c)
    }
  }

  _solve(world) {
    if (this.body.disposed) { this.release(); return }
    const P = this.particle.position
    let dx = this.target.x - P.x, dy = this.target.y - P.y, dz = this.target.z - P.z
    const dl = Math.hypot(dx, dy, dz)
    if (dl > 1.5) { dx *= 1.5 / dl; dy *= 1.5 / dl; dz *= 1.5 / dl }
    for (const m of this.members) {
      const k = 0.22 * m.w
      const q = m.p.position
      q.x += dx * k; q.y += dy * k; q.z += dz * k
      m.p.previous.lerp(q, 0.06 * m.w)
    }
    // whole body: partial gravity compensation, mild drag and a gentle pull so it follows the hand
    const gy = world.gravity * H2 * this.gravityComp
    const pull = this.pull
    for (const p of this.body.particles) {
      if (p.invMass === 0) continue
      p.position.x += dx * pull; p.position.y += dy * pull + gy; p.position.z += dz * pull
      p.previous.lerp(p.position, 0.015)
    }
  }
}

// ---------------------------------------------------------------------------------------------
const HASH_SIZE = 1024
const _hashHead = new Int32Array(HASH_SIZE)
let _hashNext = new Int32Array(1024)
const _candBoxes = []
const _candSpheres = []
const EMPTY_COLLIDERS = { ground: () => -Infinity, boxes: [], spheres: [] }

function hashCell(ix, iy, iz) {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (HASH_SIZE - 1)
}

export class PhysicsWorld {
  constructor(scene) {
    this.scene = scene
    this.bodies = []
    this.gravity = 9.81
    this.colliders = EMPTY_COLLIDERS
    this._player = null
    this._grabs = []
    this._acc = 0
    this._time = 0
    this._steps = 0
  }

  setGravity(g) {
    const v = Number(g)
    this.gravity = Number.isFinite(v) ? v : 0
  }

  setColliders(colliders) {
    this.colliders = colliders || EMPTY_COLLIDERS
  }

  createSoftBody(opts = {}) {
    return this._add(new SoftBody(this, opts))
  }

  createRope(opts = {}) {
    return this._add(new Rope(this, opts))
  }

  createRagdoll(opts = {}) {
    return this._add(new Ragdoll(this, opts))
  }

  _add(body) {
    this.bodies.push(body)
    return body
  }

  /** Removes and disposes a single body (extra helper, not required by the contract). */
  remove(body) {
    const i = this.bodies.indexOf(body)
    if (i < 0) return
    for (const g of [...this._grabs]) if (g.body === body) g.release()
    this.bodies.splice(i, 1)
    body.dispose()
  }

  /** { position: Vector3 (capsule centre), radius, height? (segment length, default 0 = sphere) } */
  setPlayerCollider(c) {
    if (!c || !c.position) { this._player = null; return }
    if (!this._player) this._player = { position: new THREE.Vector3(), radius: 0.4, height: 0 }
    this._player.position.copy(c.position)
    this._player.radius = c.radius ?? 0.4
    this._player.height = c.height ?? 0
  }

  raycast(origin, dir, maxDist = 100) {
    const d = _t.copy(dir)
    if (d.lengthSq() < 1e-12) return null
    d.normalize()
    const dCopy = d.clone()
    let best = null
    let bestT = maxDist
    for (const b of this.bodies) {
      if (b.disposed) continue
      b._computeBounds()
      const ts = raySphere(origin, dCopy, b._c, b._r + 0.1)
      if (ts === null || ts > bestT + b._r * 2 + 0.2) continue
      const h = b._raycast(origin, dCopy, bestT)
      if (h && h.t < bestT) {
        bestT = h.t
        best = { body: b, particle: h.particle, point: origin.clone().addScaledVector(dCopy, h.t), distance: h.t }
      }
    }
    return best
  }

  grab(hit) {
    if (!hit || !hit.body || !hit.particle || hit.body.disposed) return null
    const g = new Grab(this, hit)
    this._grabs.push(g)
    return g
  }

  explode(point, radius = 3, strength = 10) {
    const r = Math.max(1e-3, radius)
    for (const b of this.bodies) {
      for (const p of b.particles) {
        if (p.invMass === 0) continue
        _a.subVectors(p.position, point)
        const d = _a.length()
        if (d > r) continue
        if (d < 1e-4) _a.set(0, 1, 0)
        else _a.multiplyScalar(1 / d)
        const dv = strength * (1 - d / r)
        p.previous.addScaledVector(_a, -dv * H)
      }
    }
  }

  step(dt) {
    if (!(dt > 0)) return
    this._acc += Math.min(dt, 0.1)
    let n = 0
    while (this._acc >= H && n < MAX_SUBSTEPS) {
      this._substep()
      this._acc -= H
      n++
    }
    if (n === MAX_SUBSTEPS) this._acc = 0
    for (const b of this.bodies) b._updateMesh()
  }

  _substep() {
    this._time += H
    this._steps++
    const bodies = this.bodies
    const g = this.gravity
    const damp = g > 0.05 ? 0.9995 : 0.99985
    const gy = -g * H2

    for (const b of bodies) b._preStep(this)

    // integrate
    for (const b of bodies) {
      const P = b.particles
      for (let i = 0; i < P.length; i++) {
        const p = P[i]
        p.contact = false
        if (p.invMass === 0) continue
        const q = p.position, o = p.previous
        let vx = (q.x - o.x) * damp, vy = (q.y - o.y) * damp, vz = (q.z - o.z) * damp
        const v2 = vx * vx + vy * vy + vz * vz
        if (v2 > MAX_MOVE * MAX_MOVE) {
          const s = MAX_MOVE / Math.sqrt(v2)
          vx *= s; vy *= s; vz *= s
        }
        o.copy(q)
        q.x += vx; q.y += vy + gy; q.z += vz
      }
    }

    for (const gr of this._grabs.slice()) gr._solve(this)
    for (const b of bodies) if (b.kind === 'soft') { b._syncPressure(); b._computeBounds(); b._shapeMatch() }

    for (let it = 0; it < ITERATIONS; it++) {
      for (const b of bodies) {
        if (it === 0 || b.kind === 'soft') b._computeBounds()
        b._solve()
      }
    }

    const cols = this.colliders || EMPTY_COLLIDERS
    for (const b of bodies) {
      if (!b._computeBounds()) { b._recover(); continue }
      this._collideStatic(b, cols)
    }
    this._collideBodies()

    if (this._steps % SAFE_EVERY === 0) {
      for (const b of bodies) {
        if (b._computeBounds()) b._snapshot()
        else b._recover()
      }
    }
  }

  _collideStatic(body, cols) {
    const ground = typeof cols.ground === 'function' ? cols.ground : null
    const boxes = cols.boxes || EMPTY_COLLIDERS.boxes
    const spheres = cols.spheres || EMPTY_COLLIDERS.spheres
    const bounds = cols.bounds
    const c = body._c
    const R = body._r + 0.1
    _candBoxes.length = 0
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i]
      const mn = bx.min, mx = bx.max
      const qx = clamp(c.x, mn.x, mx.x), qy = clamp(c.y, mn.y, mx.y), qz = clamp(c.z, mn.z, mx.z)
      const dx = c.x - qx, dy = c.y - qy, dz = c.z - qz
      if (dx * dx + dy * dy + dz * dz <= R * R) _candBoxes.push(bx)
    }
    _candSpheres.length = 0
    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i]
      if (c.distanceTo(s.center) <= R + s.radius) _candSpheres.push(s)
    }
    const pc = this._player && !body._held ? this._player : null
    let usePlayer = false
    if (pc) {
      const dx = c.x - pc.position.x, dz = c.z - pc.position.z
      const dy = Math.max(0, Math.abs(c.y - pc.position.y) - pc.height / 2)
      usePlayer = dx * dx + dy * dy + dz * dz <= (R + pc.radius) * (R + pc.radius)
    }
    const P = body.particles
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      if (p.invMass === 0) continue
      const q = p.position
      const r = p.radius
      // ground
      if (ground) {
        const gh = ground(q.x, q.z)
        if (gh > -1e9 && q.y < gh + r) {
          q.y = gh + r
          p.contact = true
          friction(p, 0, 1, 0, p.friction)
        }
      }
      // boxes
      for (let k = 0; k < _candBoxes.length; k++) {
        const bx = _candBoxes[k]
        const mn = bx.min, mx = bx.max
        if (q.x < mn.x - r || q.x > mx.x + r || q.y < mn.y - r || q.y > mx.y + r || q.z < mn.z - r || q.z > mx.z + r) continue
        const inside = q.x > mn.x && q.x < mx.x && q.y > mn.y && q.y < mx.y && q.z > mn.z && q.z < mx.z
        let nx = 0, ny = 0, nz = 0, pen = 0
        if (inside) {
          // prefer the face the particle came through, else the shallowest (scalar search, no allocs)
          const o = p.previous
          let bestD = Infinity, bestAny = Infinity, bf = -1, ba = 0
          for (let f = 0; f < 6; f++) {
            const ax = f >> 1, hi = f & 1
            const qv = ax === 0 ? q.x : ax === 1 ? q.y : q.z
            const ov = ax === 0 ? o.x : ax === 1 ? o.y : o.z
            const lo = ax === 0 ? mn.x : ax === 1 ? mn.y : mn.z
            const up = ax === 0 ? mx.x : ax === 1 ? mx.y : mx.z
            const depth = hi ? up - qv : qv - lo
            const came = hi ? ov >= up : ov <= lo
            if (came && depth < bestD) { bestD = depth; bf = f }
            if (depth < bestAny) { bestAny = depth; ba = f }
          }
          if (bf < 0) { bf = ba; bestD = bestAny }
          const sign = bf & 1 ? 1 : -1
          const axis = bf >> 1
          nx = axis === 0 ? sign : 0; ny = axis === 1 ? sign : 0; nz = axis === 2 ? sign : 0
          pen = bestD + r
        } else {
          const cx = clamp(q.x, mn.x, mx.x), cy = clamp(q.y, mn.y, mx.y), cz = clamp(q.z, mn.z, mx.z)
          const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 >= r * r || d2 < 1e-14) continue
          const d = Math.sqrt(d2)
          nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d
        }
        q.x += nx * pen; q.y += ny * pen; q.z += nz * pen
        p.contact = true
        friction(p, nx, ny, nz, p.friction)
      }
      // spheres
      for (let k = 0; k < _candSpheres.length; k++) {
        const s = _candSpheres[k]
        const dx = q.x - s.center.x, dy = q.y - s.center.y, dz = q.z - s.center.z
        const rr = s.radius + r
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 >= rr * rr) continue
        const d = Math.sqrt(d2)
        let nx = 0, ny = 1, nz = 0
        if (d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d }
        const pen = rr - d
        q.x += nx * pen; q.y += ny * pen; q.z += nz * pen
        p.contact = true
        friction(p, nx, ny, nz, p.friction)
      }
      // soft world limit
      if (bounds) {
        const mn = bounds.min, mx = bounds.max
        if (q.x < mn.x) q.x += (mn.x - q.x) * 0.05; else if (q.x > mx.x) q.x += (mx.x - q.x) * 0.05
        if (q.y < mn.y) q.y += (mn.y - q.y) * 0.05; else if (q.y > mx.y) q.y += (mx.y - q.y) * 0.05
        if (q.z < mn.z) q.z += (mn.z - q.z) * 0.05; else if (q.z > mx.z) q.z += (mx.z - q.z) * 0.05
      }
      // player capsule (kinematic)
      if (usePlayer) {
        const pp = pc.position
        const hh = pc.height / 2
        const cy = clamp(q.y, pp.y - hh, pp.y + hh)
        let dx = q.x - pp.x, dy = q.y - cy, dz = q.z - pp.z
        const rr = pc.radius + r
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < rr * rr) {
          let d = Math.sqrt(d2)
          if (d < 1e-6) { dx = 1; dy = 0; dz = 0; d = 1 }
          const pen = rr - Math.min(d, rr)
          q.x += (dx / d) * pen; q.y += (dy / d) * pen; q.z += (dz / d) * pen
        }
      }
    }
  }

  _collideBodies() {
    const B = this.bodies
    for (let i = 0; i < B.length; i++) {
      const A = B[i]
      for (let j = i + 1; j < B.length; j++) {
        const C = B[j]
        const rr = A._r + C._r
        if (A._c.distanceToSquared(C._c) > rr * rr) continue
        this._collidePair(A, C)
        if (C._coreRadius > 0) this._corePush(A, C)
        if (A._coreRadius > 0) this._corePush(C, A)
      }
    }
  }

  _collidePair(A, B) {
    // hash the bigger body, query with the smaller
    if (A.particles.length > B.particles.length) { const t = A; A = B; B = t }
    const PA = A.particles, PB = B.particles
    let maxR = 0
    for (const p of PB) if (p.contactRadius > maxR) maxR = p.contactRadius
    for (const p of PA) if (p.contactRadius > maxR) maxR = p.contactRadius
    const cell = maxR * 2
    const inv = 1 / cell
    if (_hashNext.length < PB.length) _hashNext = new Int32Array(PB.length * 2)
    _hashHead.fill(-1)
    for (let i = 0; i < PB.length; i++) {
      const q = PB[i].position
      const h = hashCell(Math.floor(q.x * inv), Math.floor(q.y * inv), Math.floor(q.z * inv))
      _hashNext[i] = _hashHead[h]
      _hashHead[h] = i
    }
    // only bother with A-particles inside B's bounding sphere
    const bc = B._c, br = B._r + maxR
    for (let i = 0; i < PA.length; i++) {
      const a = PA[i]
      const qa = a.position
      if (qa.distanceToSquared(bc) > br * br) continue
      const ix = Math.floor(qa.x * inv), iy = Math.floor(qa.y * inv), iz = Math.floor(qa.z * inv)
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        let k = _hashHead[hashCell(ix + ox, iy + oy, iz + oz)]
        while (k >= 0) {
          const b = PB[k]
          k = _hashNext[k]
          const qb = b.position
          const dx = qb.x - qa.x, dy = qb.y - qa.y, dz = qb.z - qa.z
          const rr = a.contactRadius + b.contactRadius
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 >= rr * rr || d2 < 1e-12) continue
          const ws = a.invMass + b.invMass
          if (ws === 0) continue
          const d = Math.sqrt(d2)
          const s = (d - rr) / (d * ws)
          qa.x += dx * s * a.invMass; qa.y += dy * s * a.invMass; qa.z += dz * s * a.invMass
          qb.x -= dx * s * b.invMass; qb.y -= dy * s * b.invMass; qb.z -= dz * s * b.invMass
        }
      }
    }
  }

  /** Keeps particles of `A` out of soft body `S`'s squishy core (stops deep interpenetration). */
  _corePush(A, S) {
    const c = S._c
    const cr = S._coreRadius
    const share = A.mass / (A.mass + S.mass)
    for (const p of A.particles) {
      if (p.invMass === 0) continue
      const q = p.position
      const dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z
      const rr = cr + p.radius
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= rr * rr) continue
      const d = Math.sqrt(d2)
      let nx = 0, ny = 1, nz = 0
      if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d }
      const pen = (rr - d) * 0.5
      q.x += nx * pen * (1 - share); q.y += ny * pen * (1 - share); q.z += nz * pen * (1 - share)
      // equal and opposite (spread over the soft body)
      const back = (pen * (1 - share) * (A.mass / A.particles.length)) / S.mass
      for (const sp of S.particles) {
        if (sp.invMass === 0) continue
        sp.position.x -= nx * back; sp.position.y -= ny * back; sp.position.z -= nz * back
      }
    }
  }

  dispose() {
    for (const g of [...this._grabs]) g.release()
    this._grabs.length = 0
    for (const b of this.bodies) b.dispose()
    this.bodies.length = 0
    this._player = null
  }
}

/** Kill inward normal velocity and scale tangential velocity (friction 0..1). */
function friction(p, nx, ny, nz, f) {
  const q = p.position, o = p.previous
  const vx = q.x - o.x, vy = q.y - o.y, vz = q.z - o.z
  const vn = vx * nx + vy * ny + vz * nz
  const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn
  // static friction: very slow sliding contacts stick (stops slow creep/rolling at rest)
  if (tx * tx + ty * ty + tz * tz < STATIC_SLIP2) f = 1
  o.x += tx * f; o.y += ty * f; o.z += tz * f
  if (vn < 0) { o.x += nx * vn; o.y += ny * vn; o.z += nz * vn }
}
