#!/usr/bin/env node
// Vital-Link headless smoke test (owned by CI checker).
// Usage: node scripts/smoke.mjs   (node >= 20; use /opt/homebrew/bin/node)
// Exit code: 0 = all PASS (PENDING modules are not failures), 1 = at least one FAIL.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = process.env.SMOKE_GAME_DIR || join(ROOT, 'src')
const FRAMES = 240
const DT = 1 / 60

// ---------------------------------------------------------------- tiny DOM stubs
// Levels may legitimately build CanvasTextures procedurally. Give them an inert canvas so node
// doesn't die on `document.createElement('canvas')`. No real rendering happens here.
const noopProxy = () =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : noopProxy()),
    apply: () => noopProxy(),
    set: () => true,
  })
if (typeof globalThis.document === 'undefined') {
  const makeEl = (tag) => ({
    tagName: String(tag).toUpperCase(), width: 256, height: 256, style: {}, children: [],
    getContext: () => noopProxy(), appendChild() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, toDataURL: () => '', classList: { add() {}, remove() {}, toggle() {} },
  })
  globalThis.document = {
    createElement: makeEl, createElementNS: (_ns, t) => makeEl(t),
    addEventListener() {}, removeEventListener() {}, body: makeEl('body'),
    getElementById: () => makeEl('div'),
  }
}

// ---------------------------------------------------------------- reporting
const results = [] // { status:'PASS'|'FAIL'|'PENDING'|'WARN', name, detail }
const rec = (status, name, detail = '') => results.push({ status, name, detail })
const fails = (arr) => arr.length ? arr : null

const HUD_METHODS = ['setLocation', 'update', 'showPrompt', 'setTarget', 'openEntry', 'closeEntry',
  'isEntryOpen', 'toggleDevice', 'isDeviceOpen', 'notify', 'transition', 'showTitle']
const LEVELS = [
  { id: 'station', file: 'scenes/station.js', fn: 'createStation' },
  { id: 'planet', file: 'scenes/planet.js', fn: 'createPlanet' },
  { id: 'spacewalk', file: 'scenes/spacewalk.js', fn: 'createSpacewalk' },
]
const CATEGORIES = ['VITALS', 'PHYSIOLOGY', 'ENVIRONMENT', 'SYSTEMS', 'LOG']

async function tryImport(rel) {
  const abs = join(GAME, rel)
  if (!existsSync(abs)) return { pending: true }
  try {
    return { mod: await import(pathToFileURL(abs).href) }
  } catch (e) {
    return { error: e }
  }
}
const errStr = (e) => {
  const s = String(e?.stack || e)
  const lines = s.split('\n')
  const loc = lines.find((l) => l.includes('/src/')) || lines[1] || ''
  return `${lines[0]}  @ ${loc.trim().replace(ROOT + '/', '')}`
}

// ---------------------------------------------------------------- stubs
function makeHudStub(log) {
  const base = {}
  for (const m of HUD_METHODS) base[m] = (...a) => { log.calls[m] = (log.calls[m] || 0) + 1; if (m === 'transition' && typeof a[0] === 'function') a[0](); return false }
  return new Proxy(base, {
    get(t, k) {
      if (typeof k === 'symbol' || k === 'then' || k in t) return t[k]
      log.unknown.add(String(k))
      return () => {}
    },
  })
}
function makeRendererStub() {
  return new Proxy({ domElement: document.createElement('canvas'), shadowMap: {}, capabilities: { isWebGL2: true, getMaxAnisotropy: () => 1 } }, {
    get(t, k) { return k in t ? t[k] : k === 'then' ? undefined : () => {} },
  })
}
class FakeInput {
  constructor() { this.reset() }
  reset() { this.keys = new Set(); this.kp = new Set(); this.btn = new Set(); this.bp = new Set(); this.br = new Set(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.locked = true }
  down(c) { return this.keys.has(c) }
  pressed(c) { return this.kp.has(c) }
  mouseDown(b) { return this.btn.has(b) }
  mousePressed(b) { return this.bp.has(b) }
  mouseReleased(b) { return this.br.has(b) }
  requestLock() {}
  exitLock() {}
  endFrame() { this.kp.clear(); this.bp.clear(); this.br.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0 }
  // Script: set state for frame i
  script(i, zerog) {
    const hold = (c, on) => { if (on && !this.keys.has(c)) this.kp.add(c); on ? this.keys.add(c) : this.keys.delete(c) }
    const mb = (b, on) => { if (on && !this.btn.has(b)) this.bp.add(b); if (!on && this.btn.has(b)) this.br.add(b); on ? this.btn.add(b) : this.btn.delete(b) }
    hold('KeyW', i < 120 || (i >= 200 && i < 230))
    hold('ShiftLeft', i >= 40 && i < 90)
    hold('Space', zerog ? (i >= 80 && i < 120) : (i === 82 || i === 150))
    hold('ControlLeft', zerog && i >= 120 && i < 150)
    hold('KeyA', i >= 150 && i < 170)
    hold('KeyD', i >= 170 && i < 190)
    mb(0, i >= 100 && i < 160)              // grab press @100, release @160
    mb(2, i === 185)                        // shove
    hold('KeyF', i === 192)                 // flop (ragdoll-ish limp camera), player.js extra
    this.mouseDX = i >= 90 && i < 100 ? 8 : i >= 155 && i < 161 ? 120 : 0 // fast flick on release → throw
    this.mouseDY = i >= 90 && i < 100 ? 4 : i >= 100 && i < 110 ? -6 : 0
    this.wheel = i === 130 ? 100 : 0
  }
}

// ---------------------------------------------------------------- numeric sanity
function finiteDeep(v, depth = 0) {
  if (v == null) return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (depth > 2) return true
  if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false; return true }
  if (typeof v === 'object') {
    if ('x' in v && 'y' in v && 'z' in v) return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
    for (const k of ['position', 'p', 'pos', 'x0', 'prev']) if (k in v && !finiteDeep(v[k], depth + 1)) return false
  }
  return true
}
function bodiesFinite(physics) {
  for (const b of physics.bodies || []) {
    const ps = b.particles
    if (!ps) continue
    if (ArrayBuffer.isView(ps)) { if (!finiteDeep(ps)) return b.name || b.userData?.name || b.kind } else {
      for (const p of ps) if (!finiteDeep(p)) return b.name || b.userData?.name || b.kind || 'body'
    }
  }
  return null
}
function particleCount(physics) {
  let n = 0
  for (const b of physics.bodies || []) {
    const ps = b.particles
    if (!ps) continue
    n += ArrayBuffer.isView(ps) ? ps.length / 3 : ps.length ?? 0
  }
  return Math.round(n)
}

// ---------------------------------------------------------------- physics API audit (what levels/player call)
const PHYS_MEMBERS = new Set(['setGravity', 'setColliders', 'colliders', 'createSoftBody', 'createRope', 'createRagdoll', 'raycast', 'grab', 'explode', 'bodies', 'step', 'setPlayerCollider', 'dispose', 'remove'])
const OPT_KEYS = {
  createSoftBody: ['position', 'radius', 'detail', 'shape', 'size', 'color', 'stiffness', 'pressure', 'mass', 'wobble', 'name'],
  createRope: ['start', 'end', 'segments', 'color', 'thickness', 'slack'],
  createRagdoll: ['position', 'color', 'scale', 'name', 'pose', 'standStrength', 'yaw'],
}
// Option keys physics.js actually reads (opts.foo / const { foo } = opts) — used to tell an
// undocumented-but-implemented extension (WARN) from a key physics silently ignores (FAIL).
const PHYS_READS = new Set()
try {
  const src = readFileSync(join(GAME, 'core/physics.js'), 'utf8')
  for (const m of src.matchAll(/\bopts\??\.(\w+)/g)) PHYS_READS.add(m[1])
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*opts\b/g)) for (const k of m[1].split(',')) { const n = k.trim().split(/[\s=:]/)[0]; if (n) PHYS_READS.add(n) }
} catch { /* physics.js pending */ }
function auditedPhysics(world, log) {
  return new Proxy(world, {
    get(t, k) {
      const v = Reflect.get(t, k, t)
      if (typeof k === 'symbol') return v
      if (!PHYS_MEMBERS.has(k) && !(k in Object.prototype)) log.unknownMembers.add(k)
      if (typeof v !== 'function') return v
      if (OPT_KEYS[k]) {
        return (opts = {}, ...rest) => {
          for (const key of Object.keys(opts || {})) {
            if (OPT_KEYS[k].includes(key)) continue
            if (PHYS_READS.has(key)) log.extOpts.add(`${k}({${key}})`) // physics.js reads it: extension, not a bug
            else log.unknownOpts.add(`${k}({${key}})`)
          }
          if (k === 'createSoftBody' && opts?.shape && !['sphere', 'box', 'capsule'].includes(opts.shape)) log.unknownOpts.add(`createSoftBody shape:'${opts.shape}'`)
          if (k === 'createRagdoll' && opts?.pose && !['stand', 'sit', 'float'].includes(opts.pose)) log.unknownOpts.add(`createRagdoll pose:'${opts.pose}'`)
          const pos = opts?.position ?? opts?.start
          if (pos && !pos.isVector3) log.unknownOpts.add(`${k} position/start is not a THREE.Vector3`)
          return v.call(t, opts, ...rest)
        }
      }
      return v.bind(t)
    },
  })
}
// Minimal stand-in so level shape can be validated before physics.js exists.
function stubPhysicsWorld(THREE) {
  return class StubPhysics {
    constructor(scene) { this.scene = scene; this.bodies = []; this.colliders = null }
    _body(kind, pos) {
      const g = new THREE.Group(); if (pos?.isVector3) g.position.copy(pos); this.scene.add(g)
      const b = { kind, mesh: g, group: g, particles: [], userData: {}, center: () => g.position.clone(), velocity: () => new THREE.Vector3(), applyImpulse() {}, translate(v) { g.position.add(v) }, pinTo() {}, attachStart() {}, attachEnd() {} }
      this.bodies.push(b); return b
    }
    setGravity() {} setColliders(c) { this.colliders = c }
    createSoftBody(o) { return this._body('soft', o?.position) }
    createRope(o) { return this._body('rope', o?.start) }
    createRagdoll(o) { return this._body('ragdoll', o?.position) }
    raycast() { return null } grab() { return { setTarget() {}, release() {}, body: null } } explode() {} setPlayerCollider() {} step() {} dispose() {}
  }
}

// ---------------------------------------------------------------- level validation
function validateLevel(L, id, THREE) {
  const p = []
  if (!L || typeof L !== 'object') return ['create returned nothing']
  if (L.id !== id) p.push(`id is ${JSON.stringify(L.id)}, expected '${id}'`)
  if (typeof L.name !== 'string' || !L.name) p.push('name missing')
  if (typeof L.gravity !== 'number' || !Number.isFinite(L.gravity)) p.push('gravity not a finite number')
  if (!['walk', 'zerog'].includes(L.movement)) p.push(`movement=${L.movement}`)
  if (!(L.spawn?.position instanceof THREE.Vector3)) p.push('spawn.position not a THREE.Vector3')
  if (typeof L.spawn?.yaw !== 'number') p.push('spawn.yaw not a number')
  const c = L.colliders
  if (!c) p.push('colliders missing')
  else {
    if (typeof c.ground !== 'function') p.push('colliders.ground not a function')
    if (!Array.isArray(c.boxes)) p.push('colliders.boxes not an array')
    else c.boxes.forEach((b, i) => { if (!(b instanceof THREE.Box3)) p.push(`colliders.boxes[${i}] not a Box3`); else if (b.isEmpty()) p.push(`colliders.boxes[${i}] is empty/inverted`) })
    if (c.spheres !== undefined && !Array.isArray(c.spheres)) p.push('colliders.spheres not an array')
    else (c.spheres || []).forEach((s, i) => { if (!(s?.center instanceof THREE.Vector3) || !(s.radius > 0)) p.push(`colliders.spheres[${i}] malformed`) })
    if (c.bounds !== undefined && !(c.bounds instanceof THREE.Box3)) p.push('colliders.bounds not a Box3')
  }
  const e = L.environment
  if (!e) p.push('environment missing')
  else {
    for (const k of ['o2Drain', 'radiation', 'tempC', 'pressureKPa']) if (typeof e[k] !== 'number') p.push(`environment.${k} not a number`)
    if (typeof e.vacuum !== 'boolean') p.push('environment.vacuum not boolean')
    if (typeof e.o2Drain === 'number' && (e.o2Drain < 0 || e.o2Drain > 1)) p.push('environment.o2Drain outside 0..1')
  }
  if (!Array.isArray(L.pois)) p.push('pois not an array')
  else {
    if (L.pois.length === 0) p.push('pois empty')
    const ids = new Set()
    L.pois.forEach((q, i) => {
      const tag = `pois[${i}](${q?.id})`
      if (!q?.id) p.push(`${tag} id missing`)
      else if (ids.has(q.id)) p.push(`${tag} duplicate id`); ids.add(q?.id)
      if (!q?.title) p.push(`${tag} title missing`)
      if (!CATEGORIES.includes(q?.category)) p.push(`${tag} category '${q?.category}' invalid`)
      if (!(q?.position instanceof THREE.Vector3)) p.push(`${tag} position not Vector3`)
      if (!Array.isArray(q?.lines) || q.lines.length < 3 || q.lines.length > 6 || !q.lines.every((s) => typeof s === 'string')) p.push(`${tag} lines must be 3–6 strings (got ${q?.lines?.length})`)
      if (q?.readout && (typeof q.readout.label !== 'string' || q.readout.value == null)) p.push(`${tag} readout malformed`)
    })
  }
  if (!Array.isArray(L.portals)) p.push('portals not an array')
  else L.portals.forEach((q, i) => {
    const tag = `portals[${i}](${q?.id})`
    if (!q?.id) p.push(`${tag} id missing`)
    if (!q?.label) p.push(`${tag} label missing`)
    if (!LEVELS.some((l) => l.id === q?.target)) p.push(`${tag} target '${q?.target}' is not a level`)
    if (q?.target === id) p.push(`${tag} targets its own level`)
    if (!(q?.position instanceof THREE.Vector3)) p.push(`${tag} position not Vector3`)
  })
  if (typeof L.update !== 'function') p.push('update not a function')
  if (typeof L.dispose !== 'function') p.push('dispose not a function')
  // spawn sanity
  if (L.spawn?.position && c?.boxes && Array.isArray(c.boxes)) {
    const s = L.spawn.position
    for (const h of [0.1, 0.9, 1.6]) {
      const pt = new THREE.Vector3(s.x, s.y + h, s.z)
      const i = c.boxes.findIndex((b) => b instanceof THREE.Box3 && b.containsPoint(pt))
      if (i >= 0) { p.push(`spawn (${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) is inside colliders.boxes[${i}] at +${h}m`); break }
    }
    for (const [i, sp] of (c.spheres || []).entries()) if (sp?.center && sp.center.distanceTo(s) < sp.radius) p.push(`spawn inside colliders.spheres[${i}]`)
    if (L.movement === 'walk' && typeof c.ground === 'function') {
      const g = c.ground(s.x, s.z)
      if (!Number.isFinite(g)) p.push(`walk level: ground(spawn) = ${g}`)
      else if (g > s.y + 0.05) p.push(`ground(spawn)=${g.toFixed(2)} is above spawn.y=${s.y.toFixed(2)}`)
    }
  }
  return p
}

// ---------------------------------------------------------------- telemetry
function validateTelemetry(t) {
  const p = []
  if (!t || typeof t !== 'object') return ['telemetry() returned nothing']
  for (const k of ['exertion', 'speed', 'impact']) if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) p.push(`telemetry.${k} not finite number (${t[k]})`)
  for (const k of ['exertion', 'impact']) if (typeof t[k] === 'number' && (t[k] < 0 || t[k] > 1)) p.push(`telemetry.${k}=${t[k].toFixed(3)} outside 0..1`)
  for (const k of ['airborne', 'holding', 'thrusting']) if (typeof t[k] !== 'boolean') p.push(`telemetry.${k} not boolean (${t[k]})`)
  return p
}

// ---------------------------------------------------------------- disposal tracking
function installDisposeTracker(THREE) {
  const disposed = new WeakSet()
  for (const C of [THREE.BufferGeometry, THREE.Material, THREE.Texture]) {
    const orig = C.prototype.dispose
    C.prototype.dispose = function (...a) { disposed.add(this); return orig.apply(this, a) }
  }
  return disposed
}
function collectResources(scene) {
  const set = new Set()
  scene.traverse((o) => {
    if (o.geometry) set.add(o.geometry)
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of ms) { set.add(m); for (const k of ['map', 'emissiveMap', 'normalMap', 'alphaMap']) if (m[k]) set.add(m[k]) }
  })
  return set
}

// ---------------------------------------------------------------- static scans
function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|css|html)$/.test(f)) out.push(p)
  }
  return out
}
function staticChecks() {
  // HUD API
  const hudPath = join(GAME, 'ui/hud.js')
  if (!existsSync(hudPath)) rec('PENDING', 'hud.js static API', 'src/ui/hud.js not written yet')
  else {
    const src = readFileSync(hudPath, 'utf8')
    const miss = []
    if (!/export\s+(default\s+)?class\s+Hud\b/.test(src) && !/export\s*\{[^}]*\bHud\b/.test(src)) miss.push('`export class Hud`')
    for (const m of HUD_METHODS) if (!new RegExp(`(?:^|[\\s;{}])(?:async\\s+)?${m}\\s*\\([^)]*\\)\\s*\\{`, 'm').test(src)) miss.push(`${m}()`)
    rec(miss.length ? 'FAIL' : 'PASS', 'hud.js static API', miss.length ? `missing: ${miss.join(', ')}` : `${HUD_METHODS.length} methods`)
    if (!existsSync(join(GAME, 'ui/hud.css'))) rec('PENDING', 'hud.css exists', 'not written yet')
  }
  // Network assets + banned names across all game source
  const bannedI = /\b(pip[- ]?boy|vault[- ]?tec|vault[- ]?boy|vault[- ]?dweller|fallout|totally accurate battle|nuka[- ]?cola)/i
  // TABS / Peak are also ordinary words/identifiers, so match their studios/full titles instead.
  const bannedT = /(totally accurate|landfall games|aggro crab|wobbly life)/i
  const banned = { test: (l) => bannedI.test(l) || bannedT.test(l) }
  const net = /(https?:\/\/(?!www\.w3\.org)[^\s'"`)]+)|\b(GLTFLoader|OBJLoader|FBXLoader|TextureLoader|FontLoader|fetch\s*\()|@import\s+url|fonts\.googleapis/
  const hitsB = [], hitsN = []
  for (const f of [...walk(GAME), join(ROOT, 'index.html')]) {
    if (!existsSync(f)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const loc = `${relative(ROOT, f)}:${i + 1}`
      if (banned.test(line)) hitsB.push(`${loc} "${line.trim().slice(0, 70)}"`)
      if (net.test(line) && !/^\s*(\/\/|\*)/.test(line)) hitsN.push(`${loc} "${line.trim().slice(0, 70)}"`)
    })
  }
  rec(hitsB.length ? 'FAIL' : 'PASS', 'no copyrighted names', hitsB.join(' | '))
  rec(hitsN.length ? 'FAIL' : 'PASS', 'no network asset loads', hitsN.join(' | '))
}

// ---------------------------------------------------------------- engine API direct test
function engineApiTest(THREE, PhysicsWorld) {
  const p = []
  const scene = new THREE.Scene()
  let w
  try {
    w = new PhysicsWorld(scene)
    w.setGravity(9.81)
    w.setColliders({ ground: () => 0, boxes: [new THREE.Box3(new THREE.Vector3(2, 0, -1), new THREE.Vector3(3, 2, 1))], spheres: [{ center: new THREE.Vector3(-3, 0, 0), radius: 1 }] })
    if (!w.colliders?.ground) p.push('world.colliders not set by setColliders')
    const made = []
    const tryMake = (label, fn, shape) => {
      try {
        const b = fn()
        if (!b) { p.push(`${label} returned nothing`); return null }
        for (const k of shape) if (b[k] === undefined) p.push(`${label} result missing .${k}`)
        made.push(b); return b
      } catch (e) { p.push(`${label} threw: ${errStr(e)}`); return null }
    }
    const softShape = ['mesh', 'particles', 'center', 'velocity', 'applyImpulse', 'addVelocity', 'mass', 'translate', 'pinTo', 'userData', 'kind']
    const s1 = tryMake('createSoftBody(sphere)', () => w.createSoftBody({ position: new THREE.Vector3(0, 2, 0), radius: 0.5, name: 'jelly' }), softShape)
    tryMake('createSoftBody(box)', () => w.createSoftBody({ position: new THREE.Vector3(1, 2, 0), shape: 'box', size: new THREE.Vector3(0.6, 0.6, 0.6), stiffness: 0.9, pressure: 1.2, mass: 2, wobble: 1.5, color: 0xff8800 }), softShape)
    tryMake('createSoftBody(capsule)', () => w.createSoftBody({ position: new THREE.Vector3(-1, 2, 0), shape: 'capsule', radius: 0.3, detail: 2 }), softShape)
    const anchor = new THREE.Object3D(); anchor.position.set(0, 4, 0); scene.add(anchor)
    const rope = tryMake('createRope', () => w.createRope({ start: new THREE.Vector3(0, 4, 0), end: new THREE.Vector3(0, 1, 0), segments: 12, thickness: 0.03, color: 0xffffff }), ['mesh', 'attachStart', 'attachEnd', 'particles', 'kind'])
    if (rope && s1) { try { rope.attachStart(anchor); rope.attachEnd(s1.mesh) } catch (e) { p.push(`rope.attach* threw: ${errStr(e)}`) } }
    const rd = tryMake('createRagdoll', () => w.createRagdoll({ position: new THREE.Vector3(0, 0, 2), pose: 'stand', standStrength: 0.6 }), ['group', 'mesh', 'particles', 'center', 'applyImpulse', 'addVelocity', 'mass', 'translate', 'kind', 'userData'])
    tryMake('createRagdoll(float,limp)', () => w.createRagdoll({ position: new THREE.Vector3(0, 3, 3), pose: 'float', standStrength: 0 }), ['group', 'particles'])
    tryMake('createRagdoll(sit)', () => w.createRagdoll({ position: new THREE.Vector3(2, 0, 3), pose: 'sit', scale: 0.8 }), ['group'])
    for (const b of made) if (!w.bodies?.includes(b)) p.push(`${b.kind} not in world.bodies`)
    if (s1) {
      if (!(s1.center() instanceof THREE.Vector3)) p.push('softBody.center() not a Vector3')
      if (!(s1.velocity() instanceof THREE.Vector3)) p.push('softBody.velocity() not a Vector3')
      s1.applyImpulse(new THREE.Vector3(0, 1, 0)); s1.translate(new THREE.Vector3(0, 0.1, 0))
      if (s1.kind !== 'soft') p.push(`softBody.kind='${s1.kind}'`)
    }
    if (rd && rd.kind !== 'ragdoll') p.push(`ragdoll.kind='${rd.kind}'`)
    if (rope && rope.kind !== 'rope') p.push(`rope.kind='${rope.kind}'`)
    w.setPlayerCollider?.({ position: new THREE.Vector3(5, 0, 5), radius: 0.4 })
    for (let i = 0; i < 120; i++) {
      w.step(DT)
      const bad = bodiesFinite(w); if (bad) { p.push(`NaN in ${bad} particles at step ${i}`); break }
    }
    if (s1) {
      const c = s1.center()
      if (c.y < -0.3) p.push(`soft body fell through ground=0 (center.y=${c.y.toFixed(2)})`)
      // raycast + grab
      const origin = c.clone().add(new THREE.Vector3(0, 0, -3))
      const hit = w.raycast(origin, new THREE.Vector3(0, 0, 1), 10)
      if (!hit) p.push('raycast toward soft body returned null')
      else {
        for (const k of ['body', 'point', 'distance']) if (hit[k] === undefined) p.push(`raycast hit missing .${k}`)
        const g = w.grab(hit)
        if (!g || typeof g.setTarget !== 'function' || typeof g.release !== 'function') p.push('grab() did not return {setTarget, release}')
        else {
          for (let i = 0; i < 30; i++) { g.setTarget(new THREE.Vector3(0, 2 + i * 0.02, 0)); w.step(DT) }
          g.release(new THREE.Vector3(3, 2, 0))
          for (let i = 0; i < 30; i++) w.step(DT)
        }
      }
      s1.pinTo(anchor); w.step(DT); s1.pinTo(null)
    }
    if (rd && rd.mesh !== rd.group) p.push('ragdoll.mesh !== ragdoll.group (contract v2)')
    // v2: world.remove(body) frees the body and its mesh
    const extra = w.createSoftBody({ position: new THREE.Vector3(4, 2, 4), radius: 0.3 })
    try {
      extra.addVelocity(new THREE.Vector3(1, 0, 0))
      const n0 = w.bodies.length
      w.remove(extra)
      if (w.bodies.length !== n0 - 1 || w.bodies.includes(extra)) p.push('world.remove(body) did not remove it from world.bodies')
      if (extra.mesh?.parent) p.push('world.remove(body) left the mesh in the scene')
      w.step(DT)
    } catch (e) { p.push(`remove/addVelocity threw: ${errStr(e)}`) }
    w.explode(new THREE.Vector3(0, 0.5, 0), 4, 10)
    w.setGravity(0)
    for (let i = 0; i < 60; i++) w.step(DT)
    const bad = bodiesFinite(w); if (bad) p.push(`NaN in ${bad} after explode/zero-g`)
    w.dispose()
  } catch (e) {
    p.push(`threw: ${errStr(e)}`)
  }
  return p
}

// ---------------------------------------------------------------- main
async function main() {
  const THREE = await import('three')
  const disposed = installDisposeTracker(THREE)
  staticChecks()

  const phys = await tryImport('core/physics.js')
  const play = await tryImport('core/player.js')
  const PhysicsWorld = phys.mod?.PhysicsWorld
  const Player = play.mod?.Player
  if (phys.pending) rec('PENDING', 'physics.js', 'not written yet')
  else if (phys.error) rec('FAIL', 'physics.js import', errStr(phys.error))
  else if (!PhysicsWorld) rec('FAIL', 'physics.js import', 'no export PhysicsWorld')
  if (play.pending) rec('PENDING', 'player.js', 'not written yet')
  else if (play.error) rec('FAIL', 'player.js import', errStr(play.error))
  else if (!Player) rec('FAIL', 'player.js import', 'no export Player')

  if (PhysicsWorld) {
    const p = engineApiTest(THREE, PhysicsWorld)
    rec(p.length ? 'FAIL' : 'PASS', 'engine API (soft/rope/ragdoll/raycast/grab/explode)', p.join('; '))
  }

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 3000)
  const renderer = makeRendererStub()
  // Sequence mimics main.js travel: station → planet → spacewalk → station (catches dispose/state bugs)
  const order = ['station', 'planet', 'spacewalk', 'station']
  const loaded = {}
  for (const L of LEVELS) loaded[L.id] = await tryImport(L.file)
  for (const L of LEVELS) {
    const r = loaded[L.id]
    if (r.pending) rec('PENDING', `${L.id}`, `${L.file} not written yet`)
    else if (r.error) rec('FAIL', `${L.id} import`, errStr(r.error))
    else if (typeof r.mod[L.fn] !== 'function') rec('FAIL', `${L.id} import`, `no export ${L.fn}`)
  }
  const realPhysics = !!PhysicsWorld
  const World = PhysicsWorld || stubPhysicsWorld(THREE)
  if (!realPhysics) rec('PENDING', 'level simulation', 'physics.js missing: validating level shape with a stub world only')

  const seen = new Set()
  for (const id of order) {
    const L = LEVELS.find((l) => l.id === id)
    const create = loaded[id].mod?.[L.fn]
    if (typeof create !== 'function') continue
    const pass = seen.has(id) ? 2 : 1
    seen.add(id)
    const tag = pass === 2 ? `${id} (reload)` : id
    const hudLog = { calls: {}, unknown: new Set() }
    const hud = makeHudStub(hudLog)
    const scene = new THREE.Scene()
    let physics, level, player
    const problems = []
    const warns = []
    const physLog = { unknownMembers: new Set(), unknownOpts: new Set(), extOpts: new Set() }
    try {
      physics = new World(scene)
      const t0 = performance.now()
      level = create({ THREE, scene, physics: auditedPhysics(physics, physLog), camera, renderer, hud })
      const createMs = performance.now() - t0
      if (pass === 1 && level?.movement === 'walk' && typeof level?.colliders?.ground === 'function') {
        // Reachability heuristic (main.js targets items within radius+1.5 m of the eye at feet+1.6 m)
        for (const it of [...(level.pois || []), ...(level.portals || [])]) {
          if (!it?.position?.isVector3) continue
          const g = level.colliders.ground(it.position.x, it.position.z)
          const reach = (it.radius ?? 2.5) + 1.5
          if (Number.isFinite(g) && Math.abs(it.position.y - (g + 1.6)) > reach - 0.3) warns.push(`'${it.id}' at y=${it.position.y.toFixed(1)} is ${(it.position.y - g - 1.6).toFixed(1)} m from eye height over ground — likely untargetable`)
        }
      }
      if (pass === 1) {
        const v = validateLevel(level, id, THREE)
        rec(v.length ? 'FAIL' : 'PASS', `${id} level shape/spawn`, v.length ? v.join('; ') : `${level.pois.length} pois, ${level.portals.length} portals, ${level.colliders.boxes.length} boxes, ${(level.colliders.spheres || []).length} spheres, ${physics.bodies?.length ?? 0} bodies`)
        if (v.some((s) => /not a function|missing$|create returned/.test(s))) { level?.dispose?.(); physics.dispose?.(); continue }
      }
      if (!realPhysics) {
        let t = 0
        try { for (let i = 0; i < 30; i++) { t += DT; level.update(DT, t, { position: level.spawn.position.clone(), velocity: new THREE.Vector3(), head: new THREE.Object3D(), holding: null, telemetry: () => ({}) }) } } catch (e) { problems.push(`level.update threw (stub physics): ${errStr(e)}`) }
        if (physLog.unknownMembers.size) problems.push(`uses non-contract physics members: ${[...physLog.unknownMembers].join(', ')}`)
        if (physLog.unknownOpts.size) problems.push(`passes physics options that physics.js never reads: ${[...physLog.unknownOpts].join(', ')}`)
        try { level.dispose() } catch (e) { problems.push(`level.dispose threw: ${errStr(e)}`) }
        if (problems.length) rec('FAIL', `${tag} run`, problems.join('; '))
        continue
      }
      physics.setGravity(level.gravity)
      physics.setColliders(level.colliders)
      if (!Player) { warns.push('player.js pending: stepped physics+level only') }
      else {
        const input = new FakeInput()
        player = new Player({ camera, input, physics, scene, hud })
        player.setEnvironment({ gravity: level.gravity, movement: level.movement })
        player.teleport(level.spawn.position.clone(), level.spawn.yaw)
        if (!player.head?.isObject3D) problems.push('player.head is not an Object3D')
        const zerog = level.movement === 'zerog'
        const ground = level.colliders.ground
        let t = 0, frameMs = 0, worst = 0, maxImpact = 0, sawHolding = false, sawThrust = false, sawAir = false
        const startPos = player.position.clone()
        let maxDist = 0
        for (let i = 0; i < FRAMES; i++) {
          input.script(i, zerog)
          t += DT
          const f0 = performance.now()
          try {
            player.update(DT)
            physics.step(DT)
            level.update(DT, t, player)
          } catch (e) { problems.push(`frame ${i} threw: ${errStr(e)}`); break }
          const fm = performance.now() - f0
          frameMs += fm; worst = Math.max(worst, fm)
          const tel = player.telemetry()
          if (i === 0 || i === FRAMES - 1) { const tv = validateTelemetry(tel); if (tv.length) { problems.push(`frame ${i}: ${tv.join(', ')}`) } }
          else if (tel) { if (!Number.isFinite(tel.speed) || !Number.isFinite(tel.exertion)) { problems.push(`frame ${i}: telemetry non-finite`); break } }
          if (tel) { maxImpact = Math.max(maxImpact, tel.impact || 0); sawHolding ||= !!tel.holding; sawThrust ||= !!tel.thrusting; sawAir ||= !!tel.airborne }
          const pp = player.position
          if (!finiteDeep(pp) || !finiteDeep(player.velocity)) { problems.push(`frame ${i}: NaN in player position/velocity`); break }
          const bad = bodiesFinite(physics); if (bad) { problems.push(`frame ${i}: NaN in body '${bad}' particles`); break }
          maxDist = Math.max(maxDist, pp.distanceTo(startPos))
          if (!zerog) {
            const g = ground(pp.x, pp.z)
            if (Number.isFinite(g) && pp.y < g - 0.3) { problems.push(`frame ${i}: player fell through ground (y=${pp.y.toFixed(2)} < ground ${g.toFixed(2)} at x=${pp.x.toFixed(1)},z=${pp.z.toFixed(1)})`); break }
            if (!Number.isFinite(g) && pp.y < -50) { problems.push(`frame ${i}: player left the walkable area and fell (y=${pp.y.toFixed(1)})`); break }
          }
          input.endFrame()
        }
        // Directed grab test: drop a soft body right in front of the eye, LMB hold, carry, flick-release (throw).
        if (!problems.length && pass === 1) {
          try {
            input.reset(); input.endFrame()
            player.teleport(level.spawn.position.clone(), level.spawn.yaw)
            for (let i = 0; i < 5; i++) { t += DT; player.update(DT); physics.step(DT); level.update(DT, t, player); input.endFrame() }
            const target = (physics.bodies || []).find((b) => b.kind === 'soft') || (physics.bodies || [])[0]
            if (!target) warns.push('no physics bodies in level — grab not exercised')
            else {
              const eye = new THREE.Vector3(), dir = new THREE.Vector3()
              player.head.getWorldPosition(eye); camera.getWorldDirection(dir)
              target.translate(eye.clone().addScaledVector(dir, 1.2).sub(target.center()))
              let held = 0, heldTel = false
              for (let i = 0; i < 50; i++) {
                if (i === 0) { input.btn.add(0); input.bp.add(0) }
                if (i >= 30 && i < 40) input.mouseDX = 60
                if (i === 40) { input.btn.delete(0); input.br.add(0) }
                t += DT
                player.update(DT); physics.step(DT); level.update(DT, t, player)
                if (player.holding) held++
                if (player.telemetry()?.holding) heldTel = true
                input.endFrame()
              }
              const bad = bodiesFinite(physics)
              if (bad) problems.push(`NaN in '${bad}' after grab/throw`)
              else if (!held) problems.push(`grab: LMB on a soft body placed 1.2 m in front of the eye never set player.holding (raycast/grab path broken?)`)
              else if (!heldTel) problems.push('grab: player.holding set but telemetry().holding never true')
              else if (player.holding) problems.push('grab: still holding after LMB released')
              else sawHolding = true
            }
          } catch (e) { problems.push(`grab test threw: ${errStr(e)}`) }
        }
        if (!problems.length) {
          if (maxDist < 0.5) problems.push(`player barely moved (${maxDist.toFixed(2)}m) with W/Shift held for 120 frames`)
          if (zerog && !sawThrust) warns.push('telemetry.thrusting never true during zero-g thrust')
          if (!zerog && !sawAir) warns.push('telemetry.airborne never true after jump')
          const avg = frameMs / FRAMES
          const pc = particleCount(physics)
          const info = `create ${createMs.toFixed(0)}ms, frame avg ${avg.toFixed(2)}ms worst ${worst.toFixed(1)}ms, ${physics.bodies?.length ?? '?'} bodies / ${pc} particles, moved ${maxDist.toFixed(1)}m, grabbed=${sawHolding}`
          if (avg > 6) warns.push(`slow sim: ${avg.toFixed(2)}ms/frame avg in node (physics+player+level, no render)`)
          if (pc > 4000) warns.push(`${pc} particles total — heavy`)
          rec('PASS', `${tag} 240-frame sim`, info)
        }
      }
      if (!Player) {
        let t = 0
        for (let i = 0; i < FRAMES; i++) {
          t += DT
          try { physics.step(DT); level.update(DT, t, { position: level.spawn.position.clone(), velocity: new THREE.Vector3(), head: new THREE.Object3D(), holding: null, telemetry: () => ({}) }) } catch (e) { problems.push(`frame ${i} threw: ${errStr(e)}`); break }
          const bad = bodiesFinite(physics); if (bad) { problems.push(`frame ${i}: NaN in body '${bad}'`); break }
        }
        if (!problems.length) rec('PASS', `${tag} 240-frame physics+level (no player)`, `${physics.bodies?.length ?? '?'} bodies / ${particleCount(physics)} particles`)
      }
      if (physLog.unknownMembers.size) problems.push(`level uses non-contract physics members: ${[...physLog.unknownMembers].join(', ')}`)
      if (physLog.unknownOpts.size) problems.push(`level passes physics options that physics.js never reads: ${[...physLog.unknownOpts].join(', ')}`)
      if (physLog.extOpts.size && pass === 1) warns.push(`uses physics options outside the contract (implemented by physics.js, so OK — Director may document): ${[...physLog.extOpts].join(', ')}`)
      if (hudLog.unknown.size) problems.push(`called non-contract hud methods: ${[...hudLog.unknown].join(', ')}`)
      // dispose in main.js order, check GPU resources were freed
      const res = collectResources(scene)
      try { level.dispose() } catch (e) { problems.push(`level.dispose threw: ${errStr(e)}`) }
      try { player?.dispose() } catch (e) { problems.push(`player.dispose threw: ${errStr(e)}`) }
      try { physics.dispose() } catch (e) { problems.push(`physics.dispose threw: ${errStr(e)}`) }
      if (pass === 1) {
        const leaked = [...res].filter((r) => !disposed.has(r))
        if (leaked.length) {
          const kinds = {}
          for (const r of leaked) { const k = r.isBufferGeometry ? 'geometries' : r.isTexture ? 'textures' : 'materials'; kinds[k] = (kinds[k] || 0) + 1 }
          warns.push(`after dispose, ${leaked.length}/${res.size} scene GPU resources never .dispose()d (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`)
        }
      }
    } catch (e) {
      problems.push(`threw: ${errStr(e)}`)
    }
    if (problems.length) rec('FAIL', `${tag} run`, problems.join('; '))
    for (const w of warns) rec('WARN', `${tag}`, w)
  }
}

const origWarn = console.warn
const threeWarnings = []
console.warn = (...a) => { threeWarnings.push(a.join(' ')); }
try { await main() } catch (e) { rec('FAIL', 'smoke harness', errStr(e)) }
console.warn = origWarn

const icon = { PASS: 'PASS   ', FAIL: 'FAIL   ', PENDING: 'PENDING', WARN: 'WARN   ' }
for (const r of results) console.log(`${icon[r.status]} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
const uniq = [...new Set(threeWarnings)].filter((w) => !/WebGL/i.test(w)).slice(0, 5)
if (uniq.length) console.log(`(console.warn during run: ${uniq.map((w) => w.slice(0, 120)).join(' | ')})`)
const n = (s) => results.filter((r) => r.status === s).length
console.log(`\nSMOKE: ${n('FAIL') ? 'FAIL' : 'PASS'} — ${n('PASS')} pass, ${n('FAIL')} fail, ${n('WARN')} warn, ${n('PENDING')} pending`)
process.exit(n('FAIL') ? 1 : 0)
