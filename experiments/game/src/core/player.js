// First-person controller with floppy physics arms (walk + zero-g), per .agents/CONTRACT.md.
import * as THREE from 'three'

const EYE = 1.6
const RADIUS = 0.35
const HEIGHT = 1.75
const STEP = 0.45
const SENS = 0.0022
const REACH = 3.5
const WALK_SPEED = 4.2
const SPRINT_SPEED = 7
const JUMP_V = 4.6
const MAX_JUMP_H = 2
const THRUST = 3.2
const THRUST_BOOST = 6
const ZG_MAX_SPEED = 9
const SPHERE_OFFSETS = [RADIUS, HEIGHT / 2, HEIGHT - RADIUS]
const FLOP_TIME = 1.5
const FLOP_GETUP = 0.45 // last part of the flop: springing back up
const HIST = 12

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const wrapAngle = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
const damp = (rate, dt) => 1 - Math.exp(-rate * dt)

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _n = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _ident = new THREE.Quaternion()
const _m4 = new THREE.Matrix4()
const _X = new THREE.Vector3()
const _Y = new THREE.Vector3()
const _Z = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _eye = new THREE.Vector3()

/** Quaternion with local +Y along y and local +X as close as possible to r. */
function basisQuat(y, r, out) {
  _Y.copy(y)
  if (_Y.lengthSq() < 1e-10) _Y.set(0, 1, 0)
  _Y.normalize()
  _X.copy(r).addScaledVector(_Y, -r.dot(_Y))
  if (_X.lengthSq() < 1e-8) _X.set(0, 0, 1).addScaledVector(_Y, -_Y.z)
  _X.normalize()
  _Z.crossVectors(_X, _Y)
  _m4.makeBasis(_X, _Y, _Z)
  return out.setFromRotationMatrix(_m4)
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, metalness: 0.05, ...extra })

// ---------------------------------------------------------------------------------------------
/**
 * One floppy arm: shoulder (fixed, camera-local) → elbow → hand verlet chain in camera space.
 * Soft underdamped springs pull the joints toward targets (overshoot/wobble), the elbow is pushed
 * out along a "pole" so the arm always shows a bend, and gravity droop offsets the targets.
 */
class Arm {
  constructor(side, camera, mats, geos) {
    this.side = side
    // Shoulder anchors sit just below the bottom edge of the frame (not at the camera plane, where
    // perspective would make every segment point radially at the screen centre and read as one rod).
    // Upper arms rise from the bottom edge to elbows that bend out to the sides, then the forearms
    // run inward to the gloves ~30-35% up from the bottom: a clear L-shaped bend on screen.
    this.shoulder = new THREE.Vector3(0.45 * side, -0.62, -0.45)
    this.elbowRest = new THREE.Vector3(0.58 * side, -0.25, -0.55) // droop brings it to ~-0.31
    this.handRest = new THREE.Vector3(0.245 * side, -0.105, -0.6) // droop brings it to ~-0.175
    this.pole = new THREE.Vector3().addVectors(this.shoulder, this.handRest).multiplyScalar(0.5)
    this.pole.subVectors(this.elbowRest, this.pole).normalize() // elbow bends out & down
    this.L1 = this.shoulder.distanceTo(this.elbowRest)
    this.L2 = this.elbowRest.distanceTo(this.handRest)
    this.e = this.elbowRest.clone()
    this.ePrev = this.e.clone()
    this.h = this.handRest.clone()
    this.hPrev = this.h.clone()
    this.eTarget = this.elbowRest.clone()
    this.hTarget = this.handRest.clone()
    this.stretch = 1.05
    this.k = 7 // spring rate (1/s)
    this.keep = 0.95 // velocity retention per frame (lower = more damping)
    this.bend = 0.14 // minimum elbow offset from the shoulder→hand line

    const mk = (g, m) => {
      const o = new THREE.Mesh(g, m)
      o.frustumCulled = false
      o.castShadow = false
      camera.add(o)
      return o
    }
    this.upper = mk(geos.upper, mats.suit)
    this.elbow = mk(geos.elbow, mats.suit)
    this.fore = mk(geos.fore, mats.suit)
    this.cuff = mk(geos.cuff, mats.accent)
    this.glove = mk(geos.glove, mats.glove)
    this.mitt = mk(geos.mitt, mats.glove)
    this.thumb = mk(geos.thumb, mats.glove)
    this.meshes = [this.upper, this.elbow, this.fore, this.cuff, this.glove, this.mitt, this.thumb]
    if (side < 0) {
      this.device = mk(geos.device, mats.device)
      this.screen = mk(geos.screen, mats.screen)
      this.meshes.push(this.device, this.screen)
    }
  }

  reset() {
    this.e.copy(this.elbowRest); this.ePrev.copy(this.e)
    this.h.copy(this.handRest); this.hPrev.copy(this.h)
  }

  /** Default pose targets + elbow on its pole between shoulder and hand target. */
  poseElbow(sag = 0.0) {
    this.eTarget.lerpVectors(this.shoulder, this.hTarget, 0.5)
    const half2 = this.shoulder.distanceToSquared(this.hTarget) / 4
    // long stretchy reaches sag like a noodle (bend grows with distance)
    const bend = Math.max(this.bend, 0.16 * Math.sqrt(half2) * 2, Math.sqrt(Math.max(0, ((this.L1 + this.L2) / 2) ** 2 - half2)))
    this.eTarget.addScaledVector(this.pole, bend)
    this.eTarget.y -= sag
  }

  /** Inertia: rotate the chain by qRel (pos only → injects swing) and push by pseudo-acceleration. */
  inertia(qRel, accLocal, dt) {
    const k = -dt * dt
    _v.subVectors(this.e, this.shoulder).applyQuaternion(qRel)
    this.e.copy(this.shoulder).add(_v).addScaledVector(accLocal, k * 1.1)
    _v.subVectors(this.h, this.shoulder).applyQuaternion(qRel)
    this.h.copy(this.shoulder).add(_v).addScaledVector(accLocal, k * 1.6)
  }

  _integrate(p, o, t, k) {
    _w.subVectors(p, o).multiplyScalar(this.keep)
    o.copy(p)
    p.add(_w)
    p.x += (t.x - p.x) * k
    p.y += (t.y - p.y) * k
    p.z += (t.z - p.z) * k
  }

  simulate(dt) {
    this._integrate(this.e, this.ePrev, this.eTarget, damp(this.k * 0.6, dt))
    this._integrate(this.h, this.hPrev, this.hTarget, damp(this.k, dt))
    const reach = (this.L1 + this.L2) * this.stretch
    for (let it = 0; it < 3; it++) {
      clampLen(this.e, this.shoulder, this.L1 * 0.85, this.L1 * this.stretch, 1)
      // elbow-hand: share correction
      _w.subVectors(this.h, this.e)
      const d = _w.length()
      if (d > 1e-6) {
        const lo = this.L2 * 0.85, hi = this.L2 * this.stretch
        const tgt = d < lo ? lo : d > hi ? hi : d
        if (tgt !== d) {
          const corr = (d - tgt) / d
          this.e.addScaledVector(_w, corr * 0.35)
          this.h.addScaledVector(_w, -corr * 0.65)
        }
      }
      // keep a visible bend: hand never quite reaches full extension
      clampLen(this.h, this.shoulder, 0.25, reach * 0.93, 1)
    }
    // keep the hand in front of the camera and roughly in view (never fill the screen)
    if (this.h.z > -0.3) this.h.z = -0.3
    const lim = -this.h.z * 0.95
    if (this.h.y > lim * 0.6) this.h.y = lim * 0.6
    if (this.h.y < -lim * 0.66) this.h.y = -lim * 0.66
    if (Math.abs(this.h.x) > lim * 1.2) this.h.x = Math.sign(this.h.x) * lim * 1.2
    if (!Number.isFinite(this.e.x + this.e.y + this.e.z + this.h.x + this.h.y + this.h.z)) this.reset()
  }

  updateMeshes() {
    const S = this.shoulder, E = this.e, Hh = this.h
    _right.set(1, 0, 0)
    // upper arm
    _v.subVectors(E, S)
    let len = _v.length()
    let thin = clamp(1 / Math.sqrt(len / this.L1), 0.45, 1.1)
    this.upper.position.addVectors(S, E).multiplyScalar(0.5)
    basisQuat(_v, _right, this.upper.quaternion)
    this.upper.scale.set(thin, len + 0.03, thin)
    this.elbow.position.copy(E)
    this.elbow.quaternion.copy(this.upper.quaternion)
    // forearm
    _v.subVectors(Hh, E)
    len = _v.length()
    thin = clamp(1 / Math.sqrt(len / this.L2), 0.45, 1.1)
    this.fore.position.addVectors(E, Hh).multiplyScalar(0.5)
    basisQuat(_v, _right, this.fore.quaternion)
    this.fore.scale.set(thin, len + 0.02, thin)
    const q = this.fore.quaternion
    _n.copy(_v).normalize()
    this.cuff.position.copy(E).addScaledVector(_v, 0.88)
    this.cuff.quaternion.copy(q)
    // chunky mitten: palm block + curled finger block + thumb
    this.glove.position.copy(Hh).addScaledVector(_n, 0.045)
    this.glove.quaternion.copy(q)
    _w.set(0, 0, -0.012).applyQuaternion(q)
    this.mitt.position.copy(Hh).addScaledVector(_n, 0.1).add(_w)
    this.mitt.quaternion.copy(q)
    _w.set(0.05 * this.side, 0, -0.01).applyQuaternion(q)
    this.thumb.position.copy(Hh).addScaledVector(_n, 0.055).add(_w)
    this.thumb.quaternion.copy(q)
    this.thumb.rotateZ(-0.5 * this.side)
    if (this.device) {
      _w.set(0, 0, 0.045).applyQuaternion(q)
      this.device.position.copy(E).addScaledVector(_v, 0.66).add(_w)
      this.device.quaternion.copy(q)
      _w.set(0, 0, 0.06).applyQuaternion(q)
      this.screen.position.copy(E).addScaledVector(_v, 0.66).add(_w)
      this.screen.quaternion.copy(q)
    }
  }
}

function clampLen(p, anchor, lo, hi, share) {
  _w.subVectors(p, anchor)
  const d = _w.length()
  if (d < 1e-6) return
  const t = d < lo ? lo : d > hi ? hi : d
  if (t !== d) p.copy(anchor).addScaledVector(_w, (t / d - 1) * share + 1)
}

// ---------------------------------------------------------------------------------------------
export class Player {
  constructor({ camera, input, physics, scene, hud }) {
    this.camera = camera
    this.input = input
    this.physics = physics
    this.scene = scene
    this.hud = hud
    this.position = new THREE.Vector3()
    this.velocity = new THREE.Vector3()
    this.holding = null
    this.gravity = 9.81
    this.movement = 'walk'
    this.yaw = 0
    this.pitch = 0
    this.roll = 0
    this._rollVel = 0
    this.grounded = false
    this._impact = 0
    this._exertion = 0.1
    this._thrusting = false
    this._bob = 0
    this._bobAmp = 0
    this._dip = 0
    this._dipV = 0
    this._stepOffset = 0
    this._time = 0
    this._grab = null
    this._holdDist = 1.6
    this._reachT = 0
    this._flail = 0
    this._slap = 0
    this._hist = Array.from({ length: HIST }, () => ({ t: -1, p: new THREE.Vector3() })) // throw ring buffer
    this._histN = 0
    this._histI = 0
    this._gp = new THREE.Vector3()
    // flop (ragdoll-ish limp camera): spring states for pitch / roll / yaw / height offsets
    this._flopT = 0
    this._flopCool = 0
    this._flopGetup = false
    this._fl = { p: 0, pv: 0, pt: 0, r: 0, rv: 0, rt: 0, y: 0, yv: 0, yt: 0, h: 0, hv: 0, ht: 0, sp: 0, sr: 0, sy: 0 }
    this._carry = new THREE.Vector3()
    this._camPosPrev = null
    this._camVelPrev = new THREE.Vector3()
    this._camQuatPrev = new THREE.Quaternion()
    this._qInv = new THREE.Quaternion()
    this._camVel = new THREE.Vector3()
    this._acc = new THREE.Vector3()
    this._gravLocal = new THREE.Vector3()
    this._playerCol = { position: new THREE.Vector3(), radius: RADIUS + 0.05, height: HEIGHT - 2 * RADIUS }

    // rig: root (feet, yaw) → head (eye, pitch) → camera (bob, roll)
    this.root = new THREE.Object3D()
    this.root.name = 'player'
    this.head = new THREE.Object3D()
    this.head.position.y = EYE
    this.root.add(this.head)
    camera.removeFromParent()
    camera.position.set(0, 0, 0)
    camera.rotation.set(0, 0, 0)
    this.head.add(camera)
    scene.add(this.root)

    // arms
    this._geos = {
      // cylinders run +Y = toward the hand: top radius is the wrist/elbow end (tapered)
      upper: new THREE.CylinderGeometry(0.05, 0.068, 1, 7),
      elbow: new THREE.IcosahedronGeometry(0.055, 0),
      fore: new THREE.CylinderGeometry(0.04, 0.054, 1, 7),
      cuff: new THREE.CylinderGeometry(0.056, 0.056, 0.05, 7),
      glove: new THREE.BoxGeometry(0.085, 0.085, 0.052),
      mitt: new THREE.BoxGeometry(0.078, 0.06, 0.06),
      thumb: new THREE.BoxGeometry(0.03, 0.055, 0.038),
      device: new THREE.BoxGeometry(0.062, 0.075, 0.026),
      screen: new THREE.BoxGeometry(0.048, 0.056, 0.007),
    }
    this._mats = {
      suit: mat(0xe9e5da),
      accent: mat(0xff7a1a),
      glove: mat(0x3a3f46),
      device: mat(0x2a2f2a),
      screen: mat(0x0a1a0a, { emissive: 0x33ff66, emissiveIntensity: 0.9 }),
    }
    this.arms = [new Arm(-1, camera, this._mats, this._geos), new Arm(1, camera, this._mats, this._geos)]
    this._syncRig()
  }

  setEnvironment({ gravity, movement } = {}) {
    if (Number.isFinite(gravity)) this.gravity = gravity
    if (movement === 'walk' || movement === 'zerog') this.movement = movement
  }

  teleport(position, yaw = 0) {
    if (position) this.position.copy(position)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw || 0
    this.pitch = 0
    this.roll = 0
    this._rollVel = 0
    this.grounded = false
    this._dip = this._dipV = this._stepOffset = 0
    this._flopT = this._flopCool = 0
    const fl = this._fl
    fl.p = fl.r = fl.y = fl.h = fl.pv = fl.rv = fl.yv = fl.hv = 0
    this._releaseGrab()
    for (const a of this.arms) a.reset()
    this._camPosPrev = null
    this._syncRig()
  }

  get zerog() {
    return this.movement === 'zerog' || this.gravity <= 0.01
  }

  update(dt) {
    dt = clamp(dt || 0, 0, 1 / 20)
    if (dt === 0) return
    this._time += dt
    this._impact = 0
    const input = this.input

    if (input.pressed('KeyF')) this._startFlop(0.35)
    const flopping = this._flopT > 0

    // --- look (lost while flopped)
    if (!flopping) {
      this.yaw -= (input.mouseDX || 0) * SENS
      this.pitch = clamp(this.pitch - (input.mouseDY || 0) * SENS, -1.45, 1.45)
      if (this.zerog) this._rollVel += -(input.mouseDX || 0) * 0.00025
    }

    if (this.zerog) this._moveZeroG(dt)
    else this._moveWalk(dt)

    // --- integrate & collide in small steps
    const dist = this.velocity.length() * dt
    const steps = clamp(Math.ceil(dist / 0.15), 1, 8)
    const sdt = dt / steps
    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(this.velocity, sdt)
      this._collide()
    }
    if (!Number.isFinite(this.position.x + this.position.y + this.position.z)) {
      this.position.set(0, 2, 0)
      this.velocity.set(0, 0, 0)
    }
    if (!Number.isFinite(this.velocity.x + this.velocity.y + this.velocity.z)) this.velocity.set(0, 0, 0)

    if (this._impact > 0.8) this._startFlop(this._impact)
    this._updateFlop(dt)
    this._cameraEffects(dt)
    this._syncRig()
    this._updateGrab(dt)
    this._updateArms(dt)
    this._updateExertion(dt)

    this._playerCol.position.copy(this.position).y += HEIGHT / 2
    this.physics.setPlayerCollider(this._playerCol)
  }

  // ------------------------------------------------------------------------------ movement
  _moveWalk(dt) {
    const input = this.input
    const limp = this._flopT > 0
    const f = limp ? 0 : (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0)
    const s = limp ? 0 : (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0)
    const sprint = !limp && (input.down('ShiftLeft') || input.down('ShiftRight'))
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s
    const wl = Math.hypot(wx, wz)
    if (wl > 0) { wx /= wl; wz /= wl }
    let speed = sprint ? SPRINT_SPEED : WALK_SPEED
    if (this.holding) speed *= 0.85
    // low gravity: lazier ground control
    const gFactor = clamp(this.gravity / 9.81, 0.3, 1)
    const accel = limp ? (this.grounded ? 2.5 : 0) : this.grounded ? 12 * gFactor : 2.5
    if ((this.grounded || wl > 0) && accel > 0) {
      const k = damp(accel, dt)
      this.velocity.x += (wx * speed - this.velocity.x) * k
      this.velocity.z += (wz * speed - this.velocity.z) * k
    }
    this._moving = wl > 0
    this._sprinting = sprint && wl > 0
    this._thrusting = false
    this.velocity.y -= this.gravity * dt
    if (this.grounded && !limp && input.pressed('Space')) {
      this.velocity.y = Math.min(JUMP_V, Math.sqrt(2 * this.gravity * MAX_JUMP_H))
      this.grounded = false
      this._jumped = 0.15
      this._exertion = Math.min(1, this._exertion + 0.08)
    }
    if (this._jumped > 0) this._jumped -= dt
  }

  _moveZeroG(dt) {
    const input = this.input
    const limp = this._flopT > 0
    const f = limp ? 0 : (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0)
    const s = limp ? 0 : (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0)
    const u = limp ? 0 : (input.down('Space') ? 1 : 0) - (input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC') ? 1 : 0)
    const boost = !limp && (input.down('ShiftLeft') || input.down('ShiftRight'))
    this.camera.getWorldQuaternion(_q)
    _fwd.set(0, 0, -1).applyQuaternion(_q)
    _right.set(1, 0, 0).applyQuaternion(_q)
    _up.set(0, 1, 0).applyQuaternion(_q)
    _v.set(0, 0, 0).addScaledVector(_fwd, f).addScaledVector(_right, s).addScaledVector(_up, u)
    this._thrusting = _v.lengthSq() > 0
    this._moving = this._thrusting
    this._sprinting = boost && this._thrusting
    if (this._thrusting) {
      _v.normalize()
      this.velocity.addScaledVector(_v, (boost ? THRUST_BOOST : THRUST) * dt)
      this._rollVel += (Math.random() - 0.5) * 0.4 * dt - s * 0.15 * dt
    } else if (!limp) {
      // gentle auto-stabilise
      this.velocity.multiplyScalar(1 - damp(0.08, dt))
    }
    const sp = this.velocity.length()
    if (sp > ZG_MAX_SPEED) this.velocity.multiplyScalar(1 - damp(2, dt) * (1 - ZG_MAX_SPEED / sp))
    if (this.gravity > 0) this.velocity.y -= this.gravity * dt
    // roll drift with auto-level
    this._rollVel += (Math.sin(this._time * 0.37) * 0.02 - this.roll * 0.7) * dt
    this._rollVel *= 1 - damp(0.9, dt)
    this.roll = clamp(this.roll + this._rollVel * dt, -0.35, 0.35)
    this.grounded = false
  }

  // ------------------------------------------------------------------------------ collision
  _collide() {
    const cols = this.physics.colliders || {}
    const pos = this.position, vel = this.velocity
    const zerog = this.zerog
    const boxes = cols.boxes || []
    const spheres = cols.spheres || []
    const ground = typeof cols.ground === 'function' ? cols.ground : null

    // --- support surface under the feet (ground fn, box tops, sphere tops within step height)
    let support = -Infinity
    if (ground) {
      const g = ground(pos.x, pos.z)
      if (Number.isFinite(g)) support = g
    }
    const reach = RADIUS * 0.7
    for (const b of boxes) {
      if (pos.x < b.min.x - reach || pos.x > b.max.x + reach || pos.z < b.min.z - reach || pos.z > b.max.z + reach) continue
      if (b.max.y <= pos.y + STEP && b.max.y > support) support = b.max.y
    }
    for (const s of spheres) {
      const dx = pos.x - s.center.x, dz = pos.z - s.center.z
      const h2 = s.radius * s.radius - dx * dx - dz * dz
      if (h2 <= 0) continue
      const top = s.center.y + Math.sqrt(h2)
      if (top <= pos.y + STEP && top > support) support = top
    }

    const wasGrounded = this.grounded
    if (!zerog) this.grounded = false
    if (support > -Infinity) {
      if (pos.y <= support) {
        if (zerog) {
          if (vel.y < 0) {
            this._bump(-vel.y)
            vel.y = -vel.y * 0.3
          }
          pos.y = support
        } else {
          if (!wasGrounded && vel.y < 0) this._land(-vel.y)
          const rise = support - pos.y
          if (wasGrounded && rise > 0.05) this._stepOffset -= rise
          pos.y = support
          if (vel.y < 0) vel.y = 0
          this.grounded = true
        }
      } else if (!zerog && wasGrounded && vel.y <= 0.01 && !(this._jumped > 0) && pos.y - support < 0.3) {
        // stick to slopes / walk down stairs
        const drop = pos.y - support
        if (drop > 0.05) this._stepOffset += drop
        pos.y = support
        vel.y = 0
        this.grounded = true
      }
    }

    // --- walls / ceilings: sphere stack vs boxes
    for (const b of boxes) {
      if (b.max.y <= pos.y + STEP && !zerog) continue // floor-like, handled above
      if (pos.x < b.min.x - RADIUS || pos.x > b.max.x + RADIUS || pos.z < b.min.z - RADIUS || pos.z > b.max.z + RADIUS) continue
      if (pos.y > b.max.y + 0.01 || pos.y + HEIGHT < b.min.y) continue
      for (const off of SPHERE_OFFSETS) {
        const cy = pos.y + off
        const qx = clamp(pos.x, b.min.x, b.max.x), qy = clamp(cy, b.min.y, b.max.y), qz = clamp(pos.z, b.min.z, b.max.z)
        const dx = pos.x - qx, dy = cy - qy, dz = pos.z - qz
        const d2 = dx * dx + dy * dy + dz * dz
        let pen
        if (d2 < 1e-12) {
          // centre inside the box: push out horizontally along the shallowest side
          const opts = [[pos.x - b.min.x, -1, 0], [b.max.x - pos.x, 1, 0], [pos.z - b.min.z, 0, -1], [b.max.z - pos.z, 0, 1]]
          let best = opts[0]
          for (const o of opts) if (o[0] < best[0]) best = o
          _n.set(best[1], 0, best[2])
          pen = best[0] + RADIUS
        } else {
          if (d2 >= RADIUS * RADIUS) continue
          const d = Math.sqrt(d2)
          _n.set(dx / d, dy / d, dz / d)
          pen = RADIUS - d
          // walls: keep it horizontal unless it's a ceiling/floor contact
          if (Math.abs(_n.y) < 0.7 && !zerog) {
            _n.y = 0
            if (_n.lengthSq() < 1e-8) continue
            _n.normalize()
          }
        }
        pos.addScaledVector(_n, pen)
        this._resolveVel(_n, zerog)
        if (_n.y > 0.7 && !zerog) this.grounded = true
      }
    }

    // --- static spheres (rocks/asteroids)
    for (const s of spheres) {
      for (const off of SPHERE_OFFSETS) {
        const cy = pos.y + off
        _n.set(pos.x - s.center.x, cy - s.center.y, pos.z - s.center.z)
        const rr = s.radius + RADIUS
        const d2 = _n.lengthSq()
        if (d2 >= rr * rr) continue
        const d = Math.sqrt(d2)
        if (d < 1e-6) _n.set(0, 1, 0)
        else _n.multiplyScalar(1 / d)
        pos.addScaledVector(_n, rr - d)
        this._resolveVel(_n, zerog)
        if (_n.y > 0.6 && !zerog) this.grounded = true
      }
    }

    // --- soft world bounds
    const bd = cols.bounds
    if (bd) {
      for (const ax of ['x', 'y', 'z']) {
        const lo = bd.min[ax], hi = bd.max[ax]
        if (pos[ax] < lo) {
          vel[ax] += (lo - pos[ax]) * 0.4
          if (pos[ax] < lo - 2) pos[ax] = lo - 2
        } else if (pos[ax] > hi) {
          vel[ax] += (hi - pos[ax]) * 0.4
          if (pos[ax] > hi + 2) pos[ax] = hi + 2
        }
      }
    }
  }

  _resolveVel(n, zerog) {
    const vn = this.velocity.dot(n)
    if (vn >= 0) return
    if (zerog) {
      this._bump(-vn)
      this.velocity.addScaledVector(n, -vn * 1.3) // bounce, restitution 0.3
    } else {
      if (n.y > 0.7 && !this.grounded) this._land(-vn)
      else if (-vn > 6) this._impact = Math.max(this._impact, clamp((-vn - 6) / 8, 0, 0.4)) // walking into walls never flops
      this.velocity.addScaledVector(n, -vn)
    }
  }

  _land(speed) {
    this._impact = Math.max(this._impact, clamp((speed - 5) / 7, 0, 1))
    this._dipV -= Math.min(speed * 0.12, 1.2)
  }

  _bump(speed) {
    this._impact = Math.max(this._impact, clamp((speed - 1.5) / 6, 0, 1))
    this._dipV -= Math.min(speed * 0.05, 0.5)
  }

  // ------------------------------------------------------------------------------ camera
  _cameraEffects(dt) {
    const hs = Math.hypot(this.velocity.x, this.velocity.z)
    const walking = this.grounded && hs > 0.5
    this._bobAmp += ((walking ? Math.min(1, hs / SPRINT_SPEED) : 0) - this._bobAmp) * damp(8, dt)
    if (walking) this._bob += dt * (5 + hs * 1.3)
    // landing squash spring
    this._dipV += (-this._dip * 140 - this._dipV * 13) * dt
    this._dip = clamp(this._dip + this._dipV * dt, -0.35, 0.2)
    this._stepOffset *= 1 - damp(14, dt)
    if (!this.zerog) {
      this.roll += (Math.sin(this._bob) * 0.012 * this._bobAmp - this.roll) * damp(10, dt)
    }
  }

  _syncRig() {
    const cam = this.camera
    this.root.position.copy(this.position)
    const fl = this._fl
    this.root.rotation.set(0, this.yaw + fl.y, 0)
    this.head.position.set(Math.sin(fl.r) * 0.3 * Math.min(1, -fl.h), EYE + fl.h, 0) // flop: head drops toward the floor
    let pitch = this.pitch + fl.p
    if (fl.p !== 0 && !this.zerog) {
      // flopped on the ground: keep part of the horizon/sky in frame (no blank floor/sky screens)
      pitch = clamp(pitch, Math.min(this.pitch, -0.3), Math.max(this.pitch, 0.55))
    }
    this.head.rotation.set(pitch, 0, 0)
    const a = this._bobAmp
    cam.position.set(
      Math.cos(this._bob) * 0.03 * a,
      Math.abs(Math.sin(this._bob)) * 0.05 * a - 0.025 * a + this._dip + this._stepOffset,
      0,
    )
    cam.rotation.set(0, 0, this.roll + fl.r)
    this.root.updateMatrixWorld(true)
  }

  // ------------------------------------------------------------------------------ flop
  /** Go limp for FLOP_TIME seconds (F key or a very hard impact). */
  _startFlop(impact) {
    if (this._flopT > 0 || this._flopCool > 0) return
    this._flopT = FLOP_TIME
    this._flopGetup = false
    this._impact = Math.max(this._impact, clamp(impact, 0, 1))
    this._releaseGrab()
    const fl = this._fl
    const rnd = Math.random
    if (this.zerog) {
      fl.pt = fl.rt = fl.yt = fl.ht = 0
      fl.sp = (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 0.8)
      fl.sr = (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 1.2)
      fl.sy = (rnd() - 0.5) * 1.6
    } else {
      const backward = rnd() < 0.7
      fl.pt = (backward ? 0.5 : -0.28) - this.pitch
      fl.rt = (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.3)
      fl.yt = (rnd() - 0.5) * 0.8
      fl.ht = -(EYE - 0.38)
      fl.pv += fl.pt * 2.5
      fl.rv += fl.rt * 3.5
      fl.sp = fl.sr = fl.sy = 0
    }
  }

  _updateFlop(dt) {
    const fl = this._fl
    if (this._flopT > 0) {
      this._flopT -= dt
      if (this._flopT <= FLOP_GETUP && !this._flopGetup) {
        // begin getting up: unwind any zero-g spin to the nearest upright angle
        this._flopGetup = true
        fl.p = wrapAngle(fl.p); fl.r = wrapAngle(fl.r); fl.y = wrapAngle(fl.y)
        fl.sp = fl.sr = fl.sy = 0
      }
      if (this._flopT <= 0) { this._flopT = 0; this._flopCool = 0.6 }
    } else if (this._flopCool > 0) this._flopCool -= dt

    const limp = this._flopT > FLOP_GETUP
    const t = this._time
    let k, c, hk, hc
    if (limp && this.zerog) {
      // slow tumble: angular velocities ease toward the spin rates, no restoring spring
      const e = damp(1.5, dt)
      fl.pv += (fl.sp - fl.pv) * e; fl.rv += (fl.sr - fl.rv) * e; fl.yv += (fl.sy - fl.yv) * e
      k = 0; c = 0; hk = 30; hc = 8
    } else if (limp) {
      k = 26; c = 3.5; hk = 45; hc = 6 // bouncy collapse
    } else {
      k = 70; c = 6.5; hk = 60; hc = 7 // wobbly get-up (underdamped → overshoot)
    }
    const wob = limp && !this.zerog ? Math.sin(t * 6.3) * 0.06 : 0
    const pt = limp ? fl.pt + wob : 0, rt = limp ? fl.rt - wob : 0, yt = limp ? fl.yt : 0, ht = limp ? fl.ht : 0
    fl.pv += ((pt - fl.p) * k - fl.pv * c) * dt
    fl.rv += ((rt - fl.r) * k - fl.rv * c) * dt
    fl.yv += ((yt - fl.y) * k - fl.yv * c) * dt
    fl.hv += ((ht - fl.h) * hk - fl.hv * hc) * dt
    fl.p += fl.pv * dt; fl.r += fl.rv * dt; fl.y += fl.yv * dt
    if (!this.zerog && Math.abs(fl.r) > 0.7) { fl.r = Math.sign(fl.r) * 0.7; fl.rv *= -0.3 }
    fl.h = clamp(fl.h + fl.hv * dt, -(EYE - 0.3), 0.15)
    // never let the flopped camera sink within 0.35 m of the terrain under it
    const ground = this.physics.colliders?.ground
    if (typeof ground === 'function' && fl.h < 0) {
      const g = ground(this.position.x, this.position.z)
      if (Number.isFinite(g)) {
        const minH = g + 0.35 - this.position.y - EYE
        if (fl.h < minH) { fl.h = Math.min(0, minH); if (fl.hv < 0) fl.hv = 0 }
      }
    }
    if (!this._flopT && Math.abs(fl.p) + Math.abs(fl.r) + Math.abs(fl.y) + Math.abs(fl.h) < 1e-4) {
      fl.p = fl.r = fl.y = fl.h = fl.pv = fl.rv = fl.yv = fl.hv = 0
    }
  }

  // ------------------------------------------------------------------------------ grabbing
  _updateGrab(dt) {
    const input = this.input
    const cam = this.camera
    cam.getWorldPosition(_eye)
    cam.getWorldDirection(_fwd)

    if (this._grab && (this._grab.body.disposed || !this.physics.bodies.includes(this._grab.body))) {
      this._grab = null
      this.holding = null
    }

    const limp = this._flopT > 0
    if (input.mousePressed(0) && !this._grab && !limp) {
      const hit = this.physics.raycast(_eye, _fwd, REACH)
      if (hit) {
        this._grab = this.physics.grab(hit)
        if (this._grab) {
          this.holding = hit.body
          this._holdDist = clamp(hit.distance, 1.3, 2.4)
          this._reachT = 0
          this._histN = 0
        }
      } else {
        this._flail = 0.5
      }
    }

    if (input.mousePressed(2) && !limp) {
      this._slap = 0.32
      if (this._grab) {
        // shove while holding = hurl it forward
        const v = _v.copy(_fwd).multiplyScalar(11).add(this.velocity)
        this._releaseGrab(v)
      } else {
        const hit = this.physics.raycast(_eye, _fwd, 3)
        if (hit) {
          const m = hit.body.mass ?? 1
          _v.copy(_fwd).addScaledVector(_up.set(0, 1, 0), 0.3).normalize().multiplyScalar(5 * m)
          hit.body.applyImpulse(_v)
          this.physics.explode(hit.point, 0.35, 3)
          this._impact = Math.max(this._impact, 0.05)
        }
      }
    }

    if (!this._grab) return
    if (!input.mouseDown(0) || input.mouseReleased(0)) {
      this._releaseGrab(this._throwVelocity())
      return
    }
    if (input.wheel) this._holdDist = clamp(this._holdDist - input.wheel * 0.0015, 1, REACH)
    this._reachT += dt
    // carry point in front of the eye
    this._carry.copy(_eye).addScaledVector(_fwd, this._holdDist)
    this._carry.y -= 0.15
    const blend = clamp(this._reachT / 0.25, 0, 1)
    const target = _w.copy(this._grab.particle.position).lerp(this._carry, blend * blend * (3 - 2 * blend))
    this._grab.setTarget(target)
    const slot = this._hist[this._histI]
    slot.t = this._time
    slot.p.copy(target)
    this._histI = (this._histI + 1) % HIST
    this._histN = Math.min(HIST, this._histN + 1)
    // give up if the object is stuck far away
    if (this._grab.particle.position.distanceTo(this._carry) > 4) this._releaseGrab()
  }

  _throwVelocity() {
    if (this._histN < 2) return this.velocity.clone()
    const b = this._hist[(this._histI - 1 + HIST) % HIST]
    // oldest sample within the last 0.12 s
    let a = b
    for (let k = 2; k <= this._histN; k++) {
      const c = this._hist[(this._histI - k + HIST * 2) % HIST]
      if (b.t - c.t > 0.12) break
      a = c
    }
    const span = b.t - a.t
    if (span < 1e-3) return this.velocity.clone()
    const v = new THREE.Vector3().subVectors(b.p, a.p).multiplyScalar(1 / span)
    const sp = v.length()
    if (sp > 3) v.multiplyScalar(1.25)
    if (v.length() > 16) v.setLength(16)
    return v
  }

  _releaseGrab(throwVelocity) {
    if (this._grab) this._grab.release(throwVelocity)
    this._grab = null
    this.holding = null
    this._histN = 0
  }

  // ------------------------------------------------------------------------------ arms
  _updateArms(dt) {
    const cam = this.camera
    cam.getWorldQuaternion(_q)
    cam.getWorldPosition(_eye)
    // inertial effects in camera space
    _q2.copy(_q).invert().multiply(this._camQuatPrev) // world-fixed vectors rotate by this in camera space
    if (!this._camPosPrev) {
      this._camPosPrev = _eye.clone()
      this._camVelPrev.set(0, 0, 0)
      _q2.identity()
    }
    _q2.slerp(_ident, 0.38) // ~60% of the turn lags (springs pull it back with overshoot) (springs pull it back with overshoot)
    const qInv = this._qInv.copy(_q).invert()
    const camVel = this._camVel.subVectors(_eye, this._camPosPrev).multiplyScalar(1 / dt)
    const acc = this._acc.subVectors(camVel, this._camVelPrev).multiplyScalar(1 / dt)
    if (acc.length() > 80) acc.setLength(80)
    this._camVelPrev.copy(camVel)
    this._camPosPrev.copy(_eye)
    this._camQuatPrev.copy(_q)
    acc.applyQuaternion(qInv)
    const gravLocal = this._gravLocal.set(0, -1, 0).applyQuaternion(qInv) // world down, camera space

    const zg = this.zerog
    const t = this._time
    const breathe = Math.sin(t * 1.7) * 0.012
    const swayX = Math.cos(this._bob) * 0.025 * this._bobAmp
    const swayY = Math.sin(this._bob * 2) * 0.018 * this._bobAmp
    if (this._flail > 0) this._flail -= dt
    if (this._slap > 0) this._slap -= dt

    const grabbing = !!this._grab
    const limp = this._flopT > 0
    if (grabbing) cam.worldToLocal(this._gp.copy(this._grab.particle.position))
    for (const arm of this.arms) {
      const sd = arm.side
      arm.inertia(_q2, acc, dt)
      arm.stretch = 1.05
      arm.k = 7
      arm.keep = 0.95
      // idle: gravity droop (zero-g: drift up a little), breathing and walk sway
      arm.hTarget.copy(arm.handRest)
      arm.hTarget.x += swayX + Math.sin(t * 0.9 + sd) * 0.006
      arm.hTarget.y += swayY + breathe
      if (zg) arm.hTarget.y += 0.035 + Math.sin(t * 0.7 + sd * 1.3) * 0.015
      else arm.hTarget.addScaledVector(gravLocal, 0.07)
      if (limp) {
        // dangling noodles
        arm.hTarget.copy(arm.handRest)
        arm.hTarget.x += sd * 0.12
        if (zg) arm.hTarget.y += 0.12 + Math.sin(t * 1.3 + sd) * 0.05
        else arm.hTarget.addScaledVector(gravLocal, 0.3)
        arm.k = 3.5
        arm.keep = 0.96
        arm.stretch = 1.3
      } else if (grabbing) {
        // both hands clamp onto the grabbed spot
        arm.hTarget.copy(this._gp)
        arm.hTarget.x += sd * 0.11
        arm.stretch = 9
        arm.k = 22
        arm.keep = 0.88
      } else if (this._flail > 0) {
        const f = this._flail / 0.5
        arm.hTarget.set(
          sd * 0.15 + Math.sin(t * 31 + sd) * 0.14,
          -0.12 + Math.cos(t * 27 + sd * 2) * 0.12,
          -0.8 - Math.sin(t * 19) * 0.1,
        )
        arm.hTarget.lerp(arm.handRest, 1 - Math.min(1, f * 2))
        arm.stretch = 2.2
        arm.k = 24
        arm.keep = 0.9
      }
      if (this._slap > 0 && sd > 0 && !grabbing && !limp) {
        const p = 1 - this._slap / 0.32
        const e = Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5)
        arm.hTarget.set(0.45 - 0.6 * e, -0.22 + 0.1 * e, -0.45 - 0.45 * e)
        arm.stretch = 2.5
        arm.k = 34
        arm.keep = 0.88
      }
      arm.poseElbow(limp || zg ? 0.02 : 0.05)
      // reaching: elbow stays out near its corner and the forearm stretches (keeps a visible kink on screen)
      if (grabbing || this._flail > 0) arm.eTarget.lerp(arm.elbowRest, 0.7)
      else if (this._slap > 0 && sd > 0) arm.eTarget.lerp(arm.elbowRest, 0.4)
      if (!zg) arm.eTarget.addScaledVector(gravLocal, limp ? 0.15 : 0.06)
      arm.simulate(dt)
      arm.updateMeshes()
    }
  }

  _updateExertion(dt) {
    const hs = Math.hypot(this.velocity.x, this.velocity.z)
    let target
    if (this.zerog) target = this._thrusting ? (this._sprinting ? 0.55 : 0.35) : 0.12
    else if (!this.grounded) target = 0.45
    else target = 0.08 + clamp(hs / SPRINT_SPEED, 0, 1) * 0.5 + (this._sprinting ? 0.25 : 0)
    if (this.holding) target += 0.12 + Math.min(0.2, (this.holding.mass ?? 1) * 0.03)
    if (this._slap > 0 || this._flail > 0) target += 0.1
    if (this._flopT > 0) target += 0.15
    target = clamp(target, 0, 1)
    const rate = target > this._exertion ? 0.9 : 0.25
    this._exertion = clamp(this._exertion + (target - this._exertion) * damp(rate, dt), 0, 1)
  }

  telemetry() {
    return {
      exertion: this._exertion,
      speed: this.velocity.length(),
      impact: this._impact,
      airborne: !this.grounded,
      holding: !!this.holding,
      thrusting: !!this._thrusting,
    }
  }

  dispose() {
    this._releaseGrab()
    for (const a of this.arms) for (const m of a.meshes) m.removeFromParent()
    for (const g of Object.values(this._geos)) g.dispose()
    for (const m of Object.values(this._mats)) m.dispose()
    this.camera.removeFromParent()
    this.camera.position.set(0, EYE, 0)
    this.camera.rotation.set(0, 0, 0)
    this.root.removeFromParent()
    this.physics.setPlayerCollider?.(null)
  }
}
