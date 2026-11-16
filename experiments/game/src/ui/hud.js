// VL-7 Vital-Link — wrist-worn crew health monitor HUD.
// Fictional maker: Lumen Orbital Medical. All naming and art original.
// Contract: see .agents/CONTRACT.md (Hud API). All DOM lives inside the root element.
import './hud.css'

const G0 = 9.81
/** Demo time scale: 1 real second = this many mission hours (used for dose + mission clock). */
export const DEMO_HOURS_PER_SEC = 1
const AGENCY = 'LUMEN ORBITAL MEDICAL'
const DEVICE = 'VL-7 VITAL-LINK'
/** NASA (2022) career effective-dose limit for astronauts, mSv. */
const CAREER_LIMIT_MSV = 600

const LOCATIONS = [
  { id: 'station', label: 'ORBITAL STATION', sub: 'HUB // PRESSURISED' },
  { id: 'planet', label: 'PLANETARY SURFACE', sub: 'PARTIAL GRAVITY' },
  { id: 'spacewalk', label: 'EXTRAVEHICULAR SITE', sub: 'VACUUM // MICRO-g' },
]

const TABS = ['stat', 'codex', 'map']

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const approach = (cur, target, tau, dt) => (tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau)))
const reducedMotion = () => {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Physiology model (pure; no DOM). Exported so it can be unit-tested.
// ---------------------------------------------------------------------------
/* VITALS-MODEL-START */
export class VitalsModel {
  constructor() {
    this.reset()
  }

  reset() {
    this.hr = 68 // bpm
    this.spo2 = 98 // %
    this.suitO2 = 100 // % of tank
    this.coreTemp = 36.8 // °C
    this.dose = 0 // mSv accumulated (mission)
    this.doseRate = 0 // mSv/day
    this.hydration = 100 // %
    this.stress = 12 // index 0..100
    this.resp = 14 // breaths/min
    this.fluidShift = 0 // 0..1 cephalad (head-ward) fluid shift
    this.metHours = 0 // mission elapsed (demo hours)
    this.timeInMicroG = 0 // s
    this.gChangeTimer = 0 // s since a large gravity change (vestibular re-adaptation)
    this.impactTimer = 0
    this.load = 0
    this.g = 1 // gravity in g
    this.env = { vacuum: false, radiation: 0, tempC: 21, pressureKPa: 101.3, o2Drain: 0 }
  }

  setEnvironment(env) {
    const e = env || {}
    this.env = {
      vacuum: !!e.vacuum,
      radiation: Math.max(0, num(e.radiation, 0)),
      tempC: num(e.tempC, 21),
      pressureKPa: Math.max(0, num(e.pressureKPa, e.vacuum ? 0 : 101.3)),
      o2Drain: clamp(num(e.o2Drain, 0), 0, 1),
    }
  }

  setGravity(ms2) {
    const g = Math.max(0, num(ms2, G0)) / G0
    if (Math.abs(g - this.g) > 0.25) this.gChangeTimer = 60
    this.g = g
  }

  /** O2 drain intensity (1 ≈ 1 % per 6 s at rest). 0 = no drain (recharging if pressurised). */
  drainIntensity() {
    const e = this.env
    if (e.o2Drain > 0) return clamp(e.o2Drain / 0.6, 0.25, 1.6)
    return e.vacuum ? 1 : 0
  }

  /**
   * Advance the model.
   * @param {number} dt seconds
   * @param {object} t telemetry { exertion, impact, holding, thrusting }
   */
  step(dt, t) {
    dt = clamp(num(dt, 0), 0, 0.25)
    if (dt === 0) return
    const tel = t || {}
    const ex = clamp(num(tel.exertion, 0), 0, 1)
    const impact = clamp(num(tel.impact, 0), 0, 1)
    const env = this.env
    const load = clamp(ex + (tel.holding ? 0.12 : 0) + (tel.thrusting ? 0.1 : 0), 0, 1.2)
    this.load = approach(this.load, load, 2, dt)
    const L = Math.min(this.load, 1)

    // Impacts: sympathetic spike in HR and stress.
    if (impact > 0.05) {
      this.hr += impact * 28
      this.stress = Math.min(100, this.stress + impact * 35)
      this.impactTimer = 8
    }
    this.impactTimer = Math.max(0, this.impactTimer - dt)
    this.gChangeTimer = Math.max(0, this.gChangeTimer - dt)

    // Gravity / fluid shift (head-ward shift in micro-g, partial in low g).
    const micro = this.g < 0.1
    this.timeInMicroG = micro ? this.timeInMicroG + dt : Math.max(0, this.timeInMicroG - dt * 0.5)
    const fsTarget = micro ? 1 : this.g < 0.7 ? 0.4 * (1 - this.g / 0.7) : 0
    this.fluidShift = approach(this.fluidShift, fsTarget, fsTarget > this.fluidShift ? 40 : 25, dt)

    // Suit O2: drains outside, recharges in pressurised habitat.
    const drain = this.drainIntensity()
    if (drain > 0) this.suitO2 -= (1 / 6) * drain * (0.75 + 0.5 * L) * dt
    else if (env.pressureKPa >= 60) this.suitO2 += 2.5 * dt
    this.suitO2 = clamp(this.suitO2, 0, 100)

    // SpO2: ~98 %, sags slightly with exertion, drops when suit O2 runs low.
    const hypoxia = clamp((25 - this.suitO2) / 25, 0, 1)
    const spo2Target = 98.2 - L * 0.8 - hypoxia * 9
    this.spo2 = clamp(approach(this.spo2, spo2Target, 12, dt), 70, 100)
    const desat = clamp((95 - this.spo2) / 8, 0, 1)

    // Core temperature: exertion heat, mild "space fever" rise in micro-g, small env leak through suit.
    const tempTarget =
      36.8 + L * 0.9 + (micro ? 0.3 * Math.min(1, this.timeInMicroG / 120) : 0) + clamp((env.tempC - 22) * 0.004, -0.3, 0.3)
    this.coreTemp = approach(this.coreTemp, tempTarget, tempTarget > this.coreTemp ? 45 : 70, dt)

    // Heart rate.
    const rest = 68 - this.fluidShift * 3
    const hrTarget = clamp(
      rest + 82 * L + this.stress * 0.12 + desat * 22 + Math.max(0, this.coreTemp - 37.2) * 10,
      50,
      165,
    )
    this.hr = clamp(approach(this.hr, hrTarget, hrTarget > this.hr ? 6 : 22, dt), 45, 185)

    // Stress index.
    const stressTarget = clamp(
      10 + L * 25 + hypoxia * 55 + (this.impactTimer > 0 ? 15 : 0) + (this.doseRate > 2 ? 10 : 0),
      0,
      100,
    )
    this.stress = approach(this.stress, stressTarget, stressTarget > this.stress ? 5 : 30, dt)

    // Respiration.
    this.resp = approach(this.resp, 14 + L * 18 + desat * 8, 4, dt)

    // Radiation dose (environment rate in mSv/day, time-scaled).
    this.doseRate = env.radiation
    this.dose += (env.radiation / 24) * DEMO_HOURS_PER_SEC * dt

    // Hydration: sweat + respiration losses; drinking possible in pressurised habitat.
    let dh = -(0.012 + 0.06 * L)
    if (!env.vacuum && env.pressureKPa >= 60 && drain === 0) dh += 0.04
    this.hydration = clamp(this.hydration + dh * dt, 60, 100)

    this.metHours += dt * DEMO_HOURS_PER_SEC
  }

  /** 'ok' | 'warn' | 'crit' per displayed quantity. */
  state(key) {
    switch (key) {
      case 'hr':
        return this.hr > 170 || this.hr < 40 ? 'crit' : this.hr > 135 || this.hr < 48 ? 'warn' : 'ok'
      case 'spo2':
        return this.spo2 < 90 ? 'crit' : this.spo2 < 95 ? 'warn' : 'ok'
      case 'suitO2':
        return this.suitO2 < 25 ? 'crit' : this.suitO2 < 50 ? 'warn' : 'ok'
      case 'coreTemp':
        return this.coreTemp > 38.5 || this.coreTemp < 35.5 ? 'crit' : this.coreTemp > 37.8 || this.coreTemp < 36 ? 'warn' : 'ok'
      case 'dose':
        return this.dose >= CAREER_LIMIT_MSV || this.doseRate > 5 ? 'crit' : this.doseRate > 1 ? 'warn' : 'ok'
      case 'hydration':
        return this.hydration < 75 ? 'crit' : this.hydration < 88 ? 'warn' : 'ok'
      case 'stress':
        return this.stress > 80 ? 'crit' : this.stress > 60 ? 'warn' : 'ok'
      default:
        return 'ok'
    }
  }

  alerts() {
    const out = []
    const add = (key, crit, warn) => {
      const s = this.state(key)
      if (s === 'crit') out.push({ level: 'crit', text: crit })
      else if (s === 'warn') out.push({ level: 'warn', text: warn })
    }
    add('suitO2', 'SUIT O2 CRITICAL — RETURN TO PRESSURISED VOLUME', 'SUIT O2 BELOW 50 %')
    add('spo2', 'HYPOXIA — SpO2 < 90 %', 'SpO2 LOW')
    add('hr', 'HEART RATE CRITICAL', 'HEART RATE ELEVATED')
    add('coreTemp', 'CORE TEMP CRITICAL', 'CORE TEMP OUT OF BAND')
    add('dose', 'RADIATION FLUX SEVERE — SEEK SHIELDING', 'RADIATION FLUX ELEVATED')
    add('hydration', 'DEHYDRATION', 'HYDRATE')
    add('stress', 'STRESS INDEX HIGH', 'STRESS RISING')
    return out
  }

  /** Body-system status for the device silhouette. */
  systems() {
    const micro = this.g < 0.1
    const partial = !micro && this.g < 0.7
    const hrS = this.state('hr')
    const spS = this.state('spo2')
    const cardio =
      hrS === 'crit' || spS === 'crit'
        ? ['crit', 'OVERLOAD / DESAT']
        : hrS === 'warn' || spS === 'warn'
          ? ['warn', 'ELEVATED LOAD']
          : micro
            ? ['ok', 'FLUID SHIFT ADAPTING']
            : ['ok', 'NOMINAL']
    const msk =
      this.impactTimer > 0
        ? ['warn', 'IMPACT LOAD DETECTED']
        : micro && this.timeInMicroG > 30
          ? ['warn', 'UNLOADED — BONE/MUSCLE LOSS RISK']
          : partial
            ? ['ok', 'PARTIAL LOADING']
            : ['ok', 'NOMINAL']
    const vest =
      micro && this.timeInMicroG < 90
        ? ['warn', 'ADAPTING — MOTION SICKNESS RISK']
        : this.gChangeTimer > 0
          ? ['warn', 'RE-ADAPTING TO NEW g']
          : ['ok', 'NOMINAL']
    const vision = this.fluidShift > 0.6 ? ['warn', 'SANS WATCH — OPTIC DISC'] : ['ok', 'NOMINAL']
    const ds = this.state('dose')
    const rad =
      ds === 'crit' ? ['crit', 'LIMIT / SEVERE FLUX'] : ds === 'warn' ? ['warn', 'ELEVATED FLUX'] : ['ok', 'WITHIN BUDGET']
    return { cardio, msk, vest, vision, rad }
  }
}
/* VITALS-MODEL-END */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function el(tag, cls, parent, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  if (parent) parent.appendChild(e)
  return e
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(e)
  return e
}

/** One ECG cycle sample for beat phase p in [0,1). PQRST as gaussians. */
function ecgWave(p) {
  const g = (c, w, a) => a * Math.exp(-((p - c) * (p - c)) / (2 * w * w))
  return g(0.12, 0.025, 0.12) + g(0.22, 0.008, -0.12) + g(0.25, 0.01, 1) + g(0.28, 0.01, -0.25) + g(0.45, 0.045, 0.3)
}

function fmtMet(hours) {
  const d = Math.floor(hours / 24)
  const h = Math.floor(hours % 24)
  const m = Math.floor((hours * 60) % 60)
  return `MET ${String(d).padStart(3, '0')}/${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fmtDose(msv) {
  return msv < 10 ? msv.toFixed(2) : msv < 100 ? msv.toFixed(1) : msv.toFixed(0)
}

function lockCanvas() {
  try {
    const c = document.querySelector('#app canvas')
    const p = c?.requestPointerLock?.()
    p?.catch?.(() => {})
  } catch {
    // optional; main.js re-locks on canvas click
  }
}

/** Typewriter over a list of elements. */
class Typewriter {
  constructor(targets, cps, cursor, onDone) {
    this.targets = targets.map((t) => ({ el: t.el, text: String(t.text ?? '') }))
    this.cps = cps
    this.cursor = cursor
    this.onDone = onDone
    this.i = 0
    this.chars = 0
    this.done = false
    for (const t of this.targets) t.el.textContent = ''
    if (!this.targets.length) this.finish()
  }

  tick(dt) {
    if (this.done) return
    this.chars += dt * this.cps
    while (!this.done) {
      const t = this.targets[this.i]
      const n = Math.floor(this.chars)
      if (n >= t.text.length) {
        t.el.textContent = t.text
        this.chars -= t.text.length
        this.i++
        if (this.i >= this.targets.length) {
          this.finish()
          return
        }
      } else {
        if (n !== this._lastN || this._lastI !== this.i) {
          this._lastN = n
          this._lastI = this.i
          t.el.textContent = t.text.slice(0, n)
          if (this.cursor) t.el.appendChild(this.cursor)
        }
        return
      }
    }
  }

  finish() {
    if (this.done) return
    for (const t of this.targets) t.el.textContent = t.text
    const last = this.targets[this.targets.length - 1]
    if (this.cursor && last) last.el.appendChild(this.cursor)
    this.done = true
    this.onDone?.()
  }
}

// ---------------------------------------------------------------------------
// Hud
// ---------------------------------------------------------------------------
export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root || document.getElementById('hud') || el('div', '', document.body)
    this.root.classList.add('vl-root')
    this.vitals = new VitalsModel()

    this.level = null
    this.levelId = null
    this.gravity = G0
    this.known = new Map() // levelId -> { name, pois: [poi] }
    this.codex = new Map() // poiId -> { poi, levelId, levelName, order }
    this.visited = new Set()

    this._prompt = undefined
    this._target = undefined
    this._entryOpen = false
    this._deviceOpen = false
    this._tab = 'stat'
    this._codexSel = 0
    this._writers = new Set()
    this._toasts = []
    this._domTimer = 0
    this._histTimer = 0
    this._chartTimer = 0
    this._hist = { hr: [], spo2: [], suitO2: [], dose: [] }
    this._histLen = 180
    // Pre-fill with a resting baseline so the charts read as live from the first open.
    for (let i = 0; i < this._histLen; i++) {
      const w = Math.sin(i * 0.21) * 1.2 + Math.sin(i * 0.057) * 1.5
      this._hist.hr.push(68 + w + (Math.random() - 0.5) * 2)
      this._hist.spo2.push(98 + (Math.random() - 0.5) * 0.6)
      this._hist.suitO2.push(100)
      this._hist.dose.push(0)
    }
    this._txBusy = false
    this._txQueue = []
    this._titleOpen = false
    this._beatFlash = 0

    this._build()
    this._bindKeys()

    this._lastTs = performance.now()
    const loop = (ts) => {
      const dt = Math.min(0.1, Math.max(0, (ts - this._lastTs) / 1000))
      this._lastTs = ts
      this._tickUi(dt)
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
    this._renderLocation()
    this._renderVitals()
  }

  // ---------------------------------------------------------------- build DOM
  _build() {
    const r = this.root
    el('div', 'vl-crt', r)
    this.alarmEdge = el('div', 'vl-alarm-edge', r)

    // Top-left location block.
    const loc = el('div', 'vl-loc vl-panel', r)
    const locHead = el('div', 'vl-loc-head', loc)
    el('span', 'vl-dim', locHead, 'LOC //')
    this.locName = el('span', 'vl-loc-name', locHead, 'ACQUIRING…')
    this.locArea = el('div', 'vl-loc-area', loc, '')
    this.locSub = el('div', 'vl-loc-sub vl-dim', loc, '')
    const grid = el('div', 'vl-loc-grid', loc)
    const row = (label) => {
      el('span', 'vl-dim', grid, label)
      return el('span', 'vl-val', grid, '--')
    }
    this.locGrav = row('GRAV')
    this.locPress = row('PRESS')
    this.locTemp = row('EXT T')
    this.locRad = row('RAD')
    this.locFluid = el('div', 'vl-fluid', loc)
    this.locMet = el('div', 'vl-met vl-dim', loc, fmtMet(0))

    // Reticle.
    this.reticle = el('div', 'vl-reticle', r)
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `vl-br vl-br-${c}`, this.reticle)
    el('b', 'vl-dot', this.reticle)
    this.reticleLabel = el('div', 'vl-reticle-label', this.reticle, 'SCAN')
    this.reticleCat = el('div', 'vl-reticle-cat', this.reticle, '')

    // Prompt.
    this.promptEl = el('div', 'vl-prompt', r)

    // Toasts.
    this.toastBox = el('div', 'vl-toasts', r)

    // Wrist strip.
    const w = el('div', 'vl-wrist vl-panel', r)
    const wh = el('div', 'vl-wrist-head', w)
    el('span', 'vl-brand', wh, 'VL-7')
    el('span', 'vl-dim', wh, 'BIOMONITOR')
    this.linkEl = el('span', 'vl-link', wh, '● LINK')
    const ecgRow = el('div', 'vl-ecg-row', w)
    this.ecgCanvas = el('canvas', 'vl-ecg', ecgRow)
    const hrBox = el('div', 'vl-hr', ecgRow)
    el('div', 'vl-dim vl-small', hrBox, 'HR ♥')
    this.hrVal = el('div', 'vl-hr-val', hrBox, '68')
    el('div', 'vl-dim vl-small', hrBox, 'BPM')
    this.hrBox = hrBox
    const cells = el('div', 'vl-cells', w)
    const cell = (label, unit) => {
      const c = el('div', 'vl-cell', cells)
      el('span', 'vl-cell-l', c, label)
      const v = el('span', 'vl-cell-v', c, '--')
      el('span', 'vl-cell-u', c, unit)
      return { c, v }
    }
    this.cSpo2 = cell('SpO2', '%')
    this.cO2 = cell('SUIT O2', '%')
    this.cTemp = cell('CORE', '°C')
    this.cDose = cell('DOSE', 'mSv')
    this.cH2O = cell('H2O', '%')
    this.cStress = cell('STRESS', '/100')
    this.o2Bar = el('div', 'vl-o2bar', w)
    this.o2Fill = el('i', '', this.o2Bar)
    this.doseRateEl = el('div', 'vl-small vl-dim vl-rate', w, '')
    this.alertEl = el('div', 'vl-alert', w, '')

    this._ecg = { canvas: this.ecgCanvas, ctx: null, buf: null, x: 0, acc: 0, phase: 0, dirty: true, w: 0, h: 0, dpr: 1 }
    try {
      this._ecg.ctx = this.ecgCanvas.getContext('2d')
    } catch {
      this._ecg.ctx = null
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this._ecg.dirty = true
      })
      this._ro.observe(this.ecgCanvas)
    }
    window.addEventListener('resize', () => {
      this._ecg.dirty = true
    })

    this._buildEntry(r)
    this._buildDevice(r)
    this._buildTransition(r)
    this._buildTitle(r)
    this.cursor = el('span', 'vl-cursor', null, '█')
  }

  _buildEntry(r) {
    const e = el('div', 'vl-entry vl-panel', r)
    const head = el('div', 'vl-entry-head', e)
    this.entryCat = el('span', 'vl-tag', head, '')
    this.entryNo = el('span', 'vl-dim', head, '')
    this.entryTitle = el('h2', 'vl-entry-title', e, '')
    this.entryLines = el('div', 'vl-entry-lines', e)
    this.entryReadout = el('div', 'vl-readout', e)
    this.entryReadLabel = el('div', 'vl-readout-l', this.entryReadout, '')
    this.entryReadValue = el('div', 'vl-readout-v', this.entryReadout, '')
    this.entryFoot = el('div', 'vl-entry-foot', e, '')
    el('div', 'vl-entry-hint vl-dim', e, '[E] CLOSE READOUT')
    this.entryEl = e
  }

  _buildDevice(r) {
    const d = el('div', 'vl-device', r)
    const bezel = el('div', 'vl-bezel', d)
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `vl-screw vl-screw-${c}`, bezel)
    const plate = el('div', 'vl-plate', bezel)
    el('b', '', plate, DEVICE)
    el('span', '', plate, AGENCY)
    const side = el('div', 'vl-side', bezel)
    el('i', 'vl-knob', side)
    el('i', 'vl-knob vl-knob-sm', side)
    el('i', 'vl-lamp', side)
    el('i', 'vl-grille', side)

    const screen = el('div', 'vl-screen', bezel)
    const tabs = el('div', 'vl-tabs', screen)
    this.tabBtns = {}
    TABS.forEach((t, i) => {
      const b = el('button', 'vl-tab', tabs, `${i + 1} ${t.toUpperCase()}`)
      b.type = 'button'
      b.addEventListener('click', () => this._setTab(t))
      this.tabBtns[t] = b
    })
    const close = el('button', 'vl-tab vl-close', tabs, '[TAB] CLOSE')
    close.type = 'button'
    close.addEventListener('click', () => {
      if (this._deviceOpen) this.toggleDevice()
    })

    const pages = el('div', 'vl-pages', screen)
    this.pages = {}
    for (const t of TABS) this.pages[t] = el('div', `vl-page vl-page-${t}`, pages)
    el('div', 'vl-device-foot vl-dim', screen, '[Q]/[E] or [1][2][3] SWITCH TAB   ·   [↑][↓] SELECT   ·   [TAB] CLOSE')
    el('div', 'vl-screen-glass', screen)

    this._buildStat(this.pages.stat)
    this._buildCodex(this.pages.codex)
    this._buildMap(this.pages.map)
    this.deviceEl = d
  }

  _buildStat(p) {
    const charts = el('div', 'vl-stat-charts', p)
    const chart = (title) => {
      const box = el('div', 'vl-chart', charts)
      const h = el('div', 'vl-chart-h', box)
      el('span', '', h, title)
      const v = el('span', 'vl-chart-v', h, '--')
      const c = el('canvas', '', box)
      return { box, v, c }
    }
    this.chHr = chart('HEART RATE // BPM // LAST 3 MIN')
    this.chO2 = chart('OXYGEN // SpO2 + SUIT TANK %')
    this.chDose = chart('MISSION DOSE // mSv')

    const body = el('div', 'vl-stat-body', p)
    el('div', 'vl-chart-h', body, 'BODY SYSTEMS')
    const s = svg('svg', { viewBox: '0 0 100 200', class: 'vl-body' }, body)
    // Low-poly faceted silhouette; each region keyed to a system.
    svg('polygon', { class: 'vl-sys vl-sys-rad vl-aura', points: '50,2 80,30 92,100 80,170 50,198 20,170 8,100 20,30' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-vest', points: '50,8 60,12 63,24 58,34 42,34 37,24 40,12' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-vision', points: '42,20 48,19 48,23 42,23' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-vision', points: '52,19 58,20 58,23 52,23' }, s)
    svg('polygon', { class: 'vl-facet', points: '46,34 54,34 55,40 45,40' }, s)
    svg('polygon', { class: 'vl-facet', points: '30,42 70,42 74,70 66,100 34,100 26,70' }, s)
    svg('path', { class: 'vl-edge', d: 'M30,42 L50,60 L70,42 M26,70 L50,60 L74,70 M50,60 L50,100' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-cardio', points: '53,52 60,50 63,56 58,64 54,61' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-msk', points: '29,43 25,70 19,98 13,96 17,68 22,46' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-msk', points: '71,43 75,70 81,98 87,96 83,68 78,46' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-msk', points: '34,102 49,102 47,150 44,190 36,190 35,150' }, s)
    svg('polygon', { class: 'vl-sys vl-sys-msk', points: '51,102 66,102 65,150 64,190 56,190 53,150' }, s)
    this.bodySvg = s

    const list = el('div', 'vl-sys-list', body)
    this.sysRows = {}
    for (const [k, label] of [
      ['cardio', 'CARDIOVASCULAR'],
      ['msk', 'MUSCULOSKELETAL'],
      ['vest', 'VESTIBULAR'],
      ['vision', 'VISION / SANS'],
      ['rad', 'RADIATION'],
    ]) {
      const row = el('div', 'vl-sys-row', list)
      el('span', 'vl-sys-name', row, label)
      this.sysRows[k] = el('span', 'vl-sys-state', row, 'NOMINAL')
    }
    this.statSummary = el('div', 'vl-stat-summary', body, '')
  }

  _buildCodex(p) {
    this.codexList = el('div', 'vl-codex-list', p)
    const det = el('div', 'vl-codex-detail', p)
    this.cdCat = el('div', 'vl-tag', det, '')
    this.cdTitle = el('h2', 'vl-entry-title', det, '')
    this.cdLoc = el('div', 'vl-dim vl-small', det, '')
    this.cdLines = el('div', 'vl-entry-lines', det)
    this.cdReadout = el('div', 'vl-readout', det)
    this.cdReadL = el('div', 'vl-readout-l', this.cdReadout, '')
    this.cdReadV = el('div', 'vl-readout-v', this.cdReadout, '')
  }

  _buildMap(p) {
    const s = svg('svg', { viewBox: '0 0 260 220', class: 'vl-map-svg' }, p)
    svg('circle', { cx: 110, cy: 110, r: 82, class: 'vl-orbit' }, s)
    svg('circle', { cx: 110, cy: 110, r: 34, class: 'vl-planet' }, s)
    svg('polyline', { points: '84,98 98,90 118,92 134,101 140,116', class: 'vl-edge' }, s)
    this.mapNodes = {}
    // [nodeX, nodeY, labelX, labelY, anchor, short label] — labels kept clear of the disc
    const pos = {
      station: [110, 28, 122, 32, 'start', 'ORBITAL STATION'],
      planet: [110, 122, 110, 166, 'middle', 'SURFACE SITE'],
      spacewalk: [192, 110, 204, 114, 'start', 'EVA SITE'],
    }
    for (const loc of LOCATIONS) {
      const [x, y, lx, ly, anchor, short] = pos[loc.id]
      const g = svg('g', { class: 'vl-map-node' }, s)
      svg('rect', { x: x - 5, y: y - 5, width: 10, height: 10, transform: `rotate(45 ${x} ${y})` }, g)
      const t = svg('text', { x: lx, y: ly, 'text-anchor': anchor }, g)
      t.textContent = short
      this.mapNodes[loc.id] = g
    }
    this.mapList = el('div', 'vl-map-list', p)
  }

  _buildTransition(r) {
    const t = el('div', 'vl-tx', r)
    el('div', 'vl-tx-top', t)
    el('div', 'vl-tx-bot', t)
    el('div', 'vl-tx-beam', t)
    this.txText = el('div', 'vl-tx-text', t)
    this.txEl = t
  }

  _buildTitle(r) {
    const t = el('div', 'vl-title', r)
    const col = el('div', 'vl-title-col', t)
    const logo = el('div', 'vl-logo', col)
    const s = svg('svg', { viewBox: '0 0 64 64', class: 'vl-logo-mark' }, logo)
    svg('ellipse', { cx: 32, cy: 32, rx: 29, ry: 11, transform: 'rotate(-20 32 32)', class: 'vl-orbit' }, s)
    svg('polyline', { points: '6,34 20,34 25,24 31,46 37,16 42,34 58,34', class: 'vl-logo-ecg' }, s)
    const lt = el('div', 'vl-logo-text', logo)
    el('div', 'vl-logo-name', lt, 'VL-7 VITAL-LINK')
    el('div', 'vl-dim vl-small', lt, `${AGENCY} // CREW HEALTH TELEMETRY`)
    this.bootLog = el('div', 'vl-boot', col)
    this.titleRest = el('div', 'vl-title-rest', col)
    el(
      'p',
      'vl-pitch',
      this.titleRest,
      'A wrist-worn health monitor that tracks heart rhythm, blood oxygen, suit air, core temperature and radiation dose in real time — and warns the crew before the body does.',
    )
    const card = el('div', 'vl-controls', this.titleRest)
    for (const [k, v] of [
      ['W A S D', 'MOVE'],
      ['MOUSE', 'LOOK'],
      ['SHIFT', 'SPRINT'],
      ['SPACE', 'JUMP / ASCEND'],
      ['CTRL', 'DESCEND (0 g)'],
      ['LMB', 'GRAB & THROW (FLOPPY ARMS)'],
      ['RMB', 'SHOVE'],
      ['F', 'FLOP (GO LIMP)'],
      ['E', 'SCAN / INTERACT'],
      ['TAB', 'WRIST DEVICE'],
    ]) {
      el('kbd', '', card, k)
      el('span', '', card, v)
    }
    this.engage = el('div', 'vl-engage', this.titleRest, '[ CLICK TO ENGAGE ]')
    this.titleEl = t
  }

  // ------------------------------------------------------------- key handling
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (this._titleOpen && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        this._startFromTitle()
        return
      }
      if (!this._deviceOpen) return
      const idx = TABS.indexOf(this._tab)
      switch (e.code) {
        case 'KeyQ':
        case 'ArrowLeft':
          this._setTab(TABS[(idx + TABS.length - 1) % TABS.length])
          break
        case 'KeyE':
        case 'ArrowRight':
          this._setTab(TABS[(idx + 1) % TABS.length])
          break
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
          this._setTab(TABS[Number(e.code.slice(5)) - 1])
          break
        case 'ArrowUp':
        case 'KeyW':
          if (this._tab === 'codex') this._selectCodex(this._codexSel - 1)
          break
        case 'ArrowDown':
        case 'KeyS':
          if (this._tab === 'codex') this._selectCodex(this._codexSel + 1)
          break
        case 'Escape':
          this.toggleDevice()
          break
        default:
          return
      }
      e.preventDefault()
    })
  }

  // ------------------------------------------------------------------ API
  setLocation(level) {
    try {
      const lv = level || {}
      const id = lv.id || 'unknown'
      this.level = lv
      this.levelId = id
      this.visited.add(id)
      const pois = Array.isArray(lv.pois) ? lv.pois.filter((p) => p && p.id != null) : []
      this.known.set(id, { name: String(lv.name || id).toUpperCase(), pois })
      this.vitals.setEnvironment(lv.environment)
      if (typeof lv.gravity === 'number') {
        this.gravity = lv.gravity
        this.vitals.setGravity(lv.gravity)
      }
      this._renderLocation()
      if (this._deviceOpen) this._renderPage()
    } catch (err) {
      console.error('[hud] setLocation', err)
    }
  }

  update(dt, telemetry) {
    try {
      const t = telemetry || {}
      dt = clamp(num(dt, 0), 0, 0.1)
      if (typeof t.gravity === 'number') {
        this.gravity = t.gravity
        this.vitals.setGravity(t.gravity)
      }
      const paused = this._deviceOpen
      if (!paused) {
        this.vitals.step(dt, t)
        this._histTimer += dt
        if (this._histTimer >= 1) {
          this._histTimer -= 1
          this._pushHistory()
        }
      }
      this._drawEcg(dt)
      this._domTimer -= dt
      if (this._domTimer <= 0) {
        this._domTimer = 0.125
        this._renderVitals()
        this._renderLocationDynamic()
      }
      if (this._deviceOpen && this._tab === 'stat') {
        this._chartTimer -= dt
        if (this._chartTimer <= 0) {
          this._chartTimer = 0.1
          this._renderStat()
        }
      }
    } catch (err) {
      console.error('[hud] update', err)
    }
  }

  showPrompt(text) {
    const v = text == null || text === '' ? null : String(text)
    if (v === this._prompt) return
    this._prompt = v
    this.promptEl.textContent = v || ''
    this.promptEl.classList.toggle('is-on', !!v)
  }

  setTarget(poi) {
    const p = poi || null
    if (p === this._target) return
    this._target = p
    this.reticle.classList.toggle('is-target', !!p)
    this.reticleCat.textContent = p ? String(p.category || 'SIGNAL') : ''
    if (p) {
      // restart the "lock-on" animation
      this.reticle.classList.remove('lock')
      void this.reticle.offsetWidth
      this.reticle.classList.add('lock')
    }
  }

  openEntry(entry) {
    if (!entry) return
    try {
      const id = entry.id ?? entry.title ?? `poi-${this.codex.size}`
      const poi = entry.id != null ? entry : { ...entry, id }
      const isNew = !this.codex.has(id)
      if (isNew) {
        this.codex.set(id, {
          poi,
          levelId: this.levelId,
          levelName: this.known.get(this.levelId)?.name || '',
          order: this.codex.size + 1,
        })
        // make sure it's counted even if setLocation's poi list missed it
        const k = this.known.get(this.levelId)
        if (k && !k.pois.some((p) => p.id === id)) k.pois.push(poi)
      }
      const rec = this.codex.get(id)
      const { found, total } = this._counts()
      this.entryCat.textContent = `[${String(poi.category || 'LOG').toUpperCase()}]`
      this.entryNo.textContent = `SCAN #${String(rec.order).padStart(4, '0')}`
      this.entryTitle.textContent = String(poi.title || 'UNKNOWN SIGNAL')
      this.entryFoot.textContent = `${isNew ? 'ENTRY LOGGED' : 'ENTRY ON FILE'} // ${found} of ${total} discovered`
      this.entryFoot.classList.toggle('is-new', isNew)
      this._fillReadout(poi, this.entryReadout, this.entryReadLabel, this.entryReadValue)
      this.entryReadout.classList.remove('is-shown')
      this._entryWriter = this._typeLines(this.entryLines, poi.lines, reducedMotion() ? 600 : 70, () => {
        this.entryReadout.classList.add('is-shown')
      }, this._entryWriter)
      this._entryOpen = true
      this.root.classList.add('vl-entry-open')
      this.entryEl.classList.remove('is-open')
      void this.entryEl.offsetWidth
      this.entryEl.classList.add('is-open')
      if (isNew) this.notify(`CODEX +1 // ${String(poi.title || 'ENTRY').toUpperCase()}`)
    } catch (err) {
      console.error('[hud] openEntry', err)
    }
  }

  closeEntry() {
    if (!this._entryOpen) return
    this._entryOpen = false
    this.root.classList.remove('vl-entry-open')
    this.entryEl.classList.remove('is-open')
    if (this._entryWriter) this._writers.delete(this._entryWriter)
    this._entryWriter = null
  }

  isEntryOpen() {
    return this._entryOpen
  }

  toggleDevice() {
    this._deviceOpen = !this._deviceOpen
    this.deviceEl.classList.toggle('is-open', this._deviceOpen)
    this.root.classList.toggle('vl-device-open', this._deviceOpen)
    if (this._deviceOpen) {
      this.closeEntry()
      try {
        if (document.pointerLockElement) document.exitPointerLock()
      } catch {
        // ignore
      }
      this._chartTimer = 0
      this._renderPage()
    } else {
      lockCanvas()
    }
    return this._deviceOpen
  }

  isDeviceOpen() {
    return this._deviceOpen
  }

  notify(text) {
    if (text == null || text === '') return
    const t = el('div', 'vl-toast', this.toastBox)
    const span = el('span', '', t)
    const w = new Typewriter([{ el: span, text: String(text) }], reducedMotion() ? 2000 : 60, null)
    this._writers.add(w)
    const toast = { el: t, life: 4.5, writer: w }
    this._toasts.push(toast)
    while (this._toasts.length > 4) this._removeToast(this._toasts[0])
  }

  transition(callback) {
    if (this._txBusy) {
      this._txQueue.push(callback)
      return
    }
    this._txBusy = true
    const tx = this.txEl
    const rm = reducedMotion()
    const lines = ['VL-7 // CARRIER LOST', 'TRAVEL VECTOR LOCKED', 'LINK ESTABLISHED', 'BIOMETRIC RE-SYNC … OK']
    tx.className = 'vl-tx is-off'
    this.txText.textContent = ''
    const at = (ms, fn) => setTimeout(fn, rm ? ms * 0.6 : ms)
    at(560, () => {
      try {
        callback?.()
      } catch (err) {
        console.error('[hud] transition callback', err)
      }
      tx.className = 'vl-tx is-black'
      const w = new Typewriter(
        lines.map((text) => ({ el: el('div', '', this.txText), text })),
        rm ? 2000 : 140,
        this.cursor,
      )
      this._writers.add(w)
    })
    at(1150, () => {
      tx.className = 'vl-tx is-on'
    })
    at(1620, () => {
      tx.className = 'vl-tx'
      this.txText.textContent = ''
      this._txBusy = false
      const next = this._txQueue.shift()
      if (next) this.transition(next)
    })
  }

  showTitle(onStart) {
    this._onStart = typeof onStart === 'function' ? onStart : null
    this._titleOpen = true
    this.root.classList.add('vl-title-on')
    this.titleEl.classList.add('is-open')
    this.titleRest.classList.remove('is-shown')
    this.bootLog.textContent = ''
    const lines = [
      `${AGENCY}  ·  ${DEVICE}  ·  FW 7.4.2`,
      'POWER-ON SELF TEST ............ OK',
      'PHOSPHOR DISPLAY .............. OK',
      'ECG ELECTRODES (3-LEAD) ....... OK',
      'PULSE OXIMETER (SpO2) ......... OK',
      'SUIT O2 PARTIAL PRESSURE ...... OK',
      'DOSIMETER ..................... OK',
      'CORE TEMP SENSOR .............. OK',
      'BIOMETRIC SYNC ................ OK',
      'CREW LINK ESTABLISHED — MONITORING',
    ]
    const targets = lines.map((text) => ({ el: el('div', 'vl-boot-line', this.bootLog), text }))
    this._titleWriter = new Typewriter(targets, reducedMotion() ? 2000 : 110, this.cursor, () => {
      this.titleRest.classList.add('is-shown')
    })
    this._writers.add(this._titleWriter)
    if (!this._titleClick) {
      this._titleClick = () => this._startFromTitle()
      this.titleEl.addEventListener('click', this._titleClick)
    }
  }

  // --------------------------------------------------------------- internals
  _startFromTitle() {
    if (!this._titleOpen) return
    this._titleOpen = false
    this._titleWriter?.finish()
    this.titleEl.classList.remove('is-open')
    this.root.classList.remove('vl-title-on')
    const cb = this._onStart
    this._onStart = null
    try {
      cb?.()
    } catch (err) {
      console.error('[hud] onStart', err)
    }
  }

  _tickUi(dt) {
    for (const w of this._writers) {
      w.tick(dt)
      if (w.done) this._writers.delete(w)
    }
    for (const t of [...this._toasts]) {
      t.life -= dt
      if (t.life < 0.6) t.el.classList.add('is-fading')
      if (t.life <= 0) this._removeToast(t)
    }
  }

  _removeToast(t) {
    const i = this._toasts.indexOf(t)
    if (i >= 0) this._toasts.splice(i, 1)
    this._writers.delete(t.writer)
    t.el.remove()
  }

  _typeLines(container, lines, cps, onDone, prev) {
    if (prev) this._writers.delete(prev)
    container.textContent = ''
    const arr = Array.isArray(lines) ? lines : lines != null ? [String(lines)] : []
    const targets = arr.map((text) => ({ el: el('p', 'vl-line', container), text: `> ${text}` }))
    const w = new Typewriter(targets, cps, this.cursor, onDone)
    if (!w.done) this._writers.add(w)
    return w
  }

  _fillReadout(poi, box, l, v) {
    const ro = poi.readout
    const has = ro && (ro.label != null || ro.value != null)
    box.style.display = has ? '' : 'none'
    l.textContent = has ? String(ro.label ?? '') : ''
    v.textContent = has ? String(ro.value ?? '') : ''
  }

  _counts() {
    let total = 0
    for (const k of this.known.values()) total += k.pois.length
    return { found: this.codex.size, total: Math.max(total, this.codex.size) }
  }

  _pushHistory() {
    const v = this.vitals
    const h = this._hist
    const push = (a, x) => {
      a.push(x)
      if (a.length > this._histLen) a.shift()
    }
    push(h.hr, v.hr)
    push(h.spo2, v.spo2)
    push(h.suitO2, v.suitO2)
    push(h.dose, v.dose)
  }

  _renderLocation() {
    const lv = this.level || {}
    const def = LOCATIONS.find((l) => l.id === this.levelId)
    const full = lv.name ? String(lv.name).toUpperCase() : def?.label || 'ACQUIRING…'
    const parts = full.split(/\s+[—–-]\s+/)
    this.locName.textContent = parts[0]
    this.locName.title = full
    this.locArea.textContent = parts.slice(1).join(' · ')
    const env = this.vitals.env
    const pressurised = !env.vacuum && env.pressureKPa >= 60
    this.locSub.textContent = env.vacuum
      ? 'VACUUM — SUIT SEALED'
      : pressurised
        ? 'PRESSURISED — SUIT O2 RECHARGING'
        : 'THIN ATMOSPHERE — SUIT SEALED'
    this.locPress.textContent = `${env.pressureKPa.toFixed(env.pressureKPa < 10 ? 2 : 1)} kPa`
    this.locTemp.textContent = `${Math.round(env.tempC)} °C`
    this.locRad.textContent = `${env.radiation.toFixed(2)} mSv/d`
    this._renderLocationDynamic()
  }

  _renderLocationDynamic() {
    const g = Math.max(0, this.gravity) / G0
    this.locGrav.textContent = g < 0.005 ? '0.00 g  μ-g' : `${g.toFixed(2)} g`
    const v = this.vitals
    const fs = v.fluidShift
    if (fs > 0.08) {
      const n = Math.round(fs * 5)
      this.locFluid.textContent = `FLUID SHIFT ${'▲'.repeat(n)}${'△'.repeat(5 - n)} HEAD-WARD`
      this.locFluid.classList.add('is-on')
    } else {
      this.locFluid.classList.remove('is-on')
    }
    this.locMet.textContent = `${fmtMet(v.metHours)}   ·   1 s = ${DEMO_HOURS_PER_SEC} h`
  }

  _setCell(cell, text, state) {
    if (cell.v.textContent !== text) cell.v.textContent = text
    if (cell.c.dataset.state !== state) cell.c.dataset.state = state
  }

  _renderVitals() {
    const v = this.vitals
    this.hrVal.textContent = String(Math.round(v.hr))
    this.hrBox.dataset.state = v.state('hr')
    this._setCell(this.cSpo2, v.spo2.toFixed(0), v.state('spo2'))
    this._setCell(this.cO2, v.suitO2.toFixed(0), v.state('suitO2'))
    this._setCell(this.cTemp, v.coreTemp.toFixed(1), v.state('coreTemp'))
    this._setCell(this.cDose, fmtDose(v.dose), v.state('dose'))
    this._setCell(this.cH2O, v.hydration.toFixed(0), v.state('hydration'))
    this._setCell(this.cStress, v.stress.toFixed(0), v.state('stress'))
    this.o2Fill.style.width = `${v.suitO2.toFixed(1)}%`
    this.o2Bar.dataset.state = v.state('suitO2')
    const drain = v.drainIntensity()
    const o2txt = drain > 0 ? `O2 −${((1 / 6) * drain * (0.75 + 0.5 * Math.min(v.load, 1)) * 60).toFixed(1)}%/min` : 'O2 RECHARGE'
    this.doseRateEl.textContent = `RAD +${v.doseRate.toFixed(2)} mSv/d · ${o2txt}`
    const alerts = v.alerts()
    const top = alerts[0]
    this.alertEl.textContent = top ? `▲ ${top.text}${alerts.length > 1 ? `  (+${alerts.length - 1})` : ''}` : ''
    this.alertEl.dataset.state = top ? top.level : 'ok'
    this.root.classList.toggle('vl-o2-low', v.suitO2 < 25)
  }

  _drawEcg(dt) {
    const E = this._ecg
    const ctx = E.ctx
    if (!ctx) return
    if (E.dirty) {
      E.dirty = false
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = Math.max(1, this.ecgCanvas.clientWidth)
      const ch = Math.max(1, this.ecgCanvas.clientHeight)
      E.dpr = dpr
      E.w = Math.max(1, Math.round(cw * dpr))
      E.h = Math.max(1, Math.round(ch * dpr))
      this.ecgCanvas.width = E.w
      this.ecgCanvas.height = E.h
      E.buf = new Float32Array(E.w).fill(NaN)
      E.x = 0
      E.acc = 0
    }
    const W = E.w
    const H = E.h
    const sweep = 3.2 // seconds per screen
    const pxPerSec = W / sweep
    E.acc += dt * pxPerSec
    const n = Math.min(W, Math.floor(E.acc))
    E.acc -= n
    const spp = 1 / pxPerSec
    const hr = this.vitals.hr
    const gap = Math.round(10 * E.dpr)
    for (let i = 0; i < n; i++) {
      const prev = E.phase
      E.phase += (hr / 60) * spp
      if (E.phase >= 1) E.phase -= 1
      if (prev < 0.25 && E.phase >= 0.25) this._beatFlash = 0.15
      E.buf[E.x] = ecgWave(E.phase) + (Math.random() - 0.5) * 0.03
      E.x = (E.x + 1) % W
      for (let k = 0; k < gap; k++) E.buf[(E.x + k) % W] = NaN
    }
    if (this._beatFlash > 0) {
      this._beatFlash -= dt
      this.hrBox.classList.toggle('beat', this._beatFlash > 0)
    }
    if (n === 0 && dt > 0) return
    const st = this.vitals.state('hr')
    const color = st === 'crit' ? '#ff4b3a' : st === 'warn' ? '#ffbf3c' : '#6dff9c'
    ctx.clearRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(109,255,156,0.10)'
    ctx.lineWidth = 1
    ctx.beginPath()
    const step = Math.max(4, Math.round(H / 4))
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(W, y + 0.5)
    }
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, H)
    }
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, 1.6 * E.dpr)
    ctx.shadowColor = color
    ctx.shadowBlur = 6 * E.dpr
    ctx.beginPath()
    const mid = H * 0.62
    const amp = H * 0.5
    let pen = false
    const stride = W > 1400 ? 2 : 1
    for (let x = 0; x < W; x += stride) {
      const val = E.buf[x]
      if (Number.isNaN(val)) {
        pen = false
        continue
      }
      const y = mid - val * amp
      if (pen) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      pen = true
    }
    ctx.stroke()
    ctx.shadowBlur = 0
    const hx = (E.x + W - 1) % W
    const hv = E.buf[hx]
    if (!Number.isNaN(hv)) {
      ctx.fillStyle = '#d8ffe4'
      ctx.beginPath()
      ctx.arc(hx, mid - hv * amp, 2 * E.dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ------------------------------------------------------------ device pages
  _setTab(tab) {
    if (!TABS.includes(tab)) return
    this._tab = tab
    this._chartTimer = 0
    this._renderPage()
  }

  _renderPage() {
    for (const t of TABS) {
      this.pages[t].classList.toggle('is-active', t === this._tab)
      this.tabBtns[t].classList.toggle('is-active', t === this._tab)
    }
    if (this._tab === 'stat') this._renderStat()
    else if (this._tab === 'codex') this._renderCodex()
    else this._renderMap()
  }

  _renderStat() {
    const v = this.vitals
    const h = this._hist
    this.chHr.v.textContent = `${Math.round(v.hr)} BPM`
    this.chO2.v.textContent = `SpO2 ${v.spo2.toFixed(0)}%  ·  TANK ${v.suitO2.toFixed(0)}%`
    this.chDose.v.textContent = `${fmtDose(v.dose)} / ${CAREER_LIMIT_MSV} mSv CAREER`
    this._chart(this.chHr.c, [{ data: h.hr, color: '#6dff9c' }], 40, 180, [135, 170])
    this._chart(
      this.chO2.c,
      [
        { data: h.spo2, color: '#6dff9c' },
        { data: h.suitO2, color: '#7fd8ff' },
      ],
      0,
      100,
      [25, 50],
    )
    const maxDose = Math.max(1, ...h.dose) * 1.2
    this._chart(this.chDose.c, [{ data: h.dose, color: '#ffbf3c' }], 0, maxDose, [])
    const sys = v.systems()
    for (const k in sys) {
      const [state, text] = sys[k]
      const row = this.sysRows[k]
      if (row.textContent !== text) row.textContent = text
      row.dataset.state = state
      this.bodySvg.classList.remove(`${k}-warn`, `${k}-crit`)
      if (state !== 'ok') this.bodySvg.classList.add(`${k}-${state}`)
    }
    this.statSummary.textContent =
      `CORE ${v.coreTemp.toFixed(1)} °C · H2O ${v.hydration.toFixed(0)}% · STRESS ${v.stress.toFixed(0)} · ` +
      `RESP ${Math.round(v.resp)}/min · FLUID SHIFT ${(v.fluidShift * 100).toFixed(0)}%`
  }

  _chart(canvas, series, min, max, thresholds) {
    const ctx = canvas.getContext?.('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const H = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    ctx.clearRect(0, 0, W, H)
    const yOf = (val) => H - ((val - min) / (max - min || 1)) * (H - 4 * dpr) - 2 * dpr
    ctx.strokeStyle = 'rgba(109,255,156,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 4; i++) {
      const y = Math.round((H * i) / 4) + 0.5
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    for (let i = 1; i < 6; i++) {
      const x = Math.round((W * i) / 6) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    ctx.stroke()
    ctx.setLineDash([4 * dpr, 4 * dpr])
    ctx.strokeStyle = 'rgba(255,191,60,0.5)'
    ctx.beginPath()
    for (const t of thresholds) {
      const y = Math.round(yOf(t)) + 0.5
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    for (const s of series) {
      const d = s.data
      if (!d.length) continue
      ctx.strokeStyle = s.color
      ctx.shadowColor = s.color
      ctx.shadowBlur = 5 * dpr
      ctx.lineWidth = 1.6 * dpr
      ctx.beginPath()
      const dx = W / (this._histLen - 1)
      const x0 = W - (d.length - 1) * dx
      for (let i = 0; i < d.length; i++) {
        const x = x0 + i * dx
        const y = yOf(clamp(d[i], min, max))
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    ctx.fillStyle = 'rgba(109,255,156,0.55)'
    ctx.font = `${11 * dpr}px ui-monospace, monospace`
    ctx.fillText(String(Math.round(max)), 3 * dpr, 12 * dpr)
    ctx.fillText(String(Math.round(min)), 3 * dpr, H - 4 * dpr)
  }

  _codexOrder() {
    // Discovered entries in location order then discovery order.
    const ids = [...LOCATIONS.map((l) => l.id), ...[...this.known.keys()].filter((k) => !LOCATIONS.some((l) => l.id === k))]
    const out = []
    for (const lid of ids) {
      for (const rec of this.codex.values()) if (rec.levelId === lid) out.push(rec)
    }
    for (const rec of this.codex.values()) if (!out.includes(rec)) out.push(rec)
    return out
  }

  _renderCodex() {
    const list = this.codexList
    list.textContent = ''
    const order = this._codexOrder()
    this._codexSel = clamp(this._codexSel, 0, Math.max(0, order.length - 1))
    const { found, total } = this._counts()
    el('div', 'vl-codex-count', list, `ENTRIES ${found} / ${total} KNOWN SIGNALS`)
    const locIds = [...LOCATIONS.map((l) => l.id), ...[...this.known.keys()].filter((k) => !LOCATIONS.some((l) => l.id === k))]
    this._codexBtns = []
    for (const lid of locIds) {
      const k = this.known.get(lid)
      const def = LOCATIONS.find((l) => l.id === lid)
      el('div', 'vl-codex-loc', list, `── ${k?.name || def?.label || lid} ──`)
      if (!k) {
        el('div', 'vl-codex-item is-locked', list, '▒▒▒ LOCATION NOT SURVEYED')
        continue
      }
      for (const p of k.pois) {
        const rec = this.codex.get(p.id)
        if (!rec) {
          el('div', 'vl-codex-item is-locked', list, '▒▒▒ SIGNAL NOT ACQUIRED')
          continue
        }
        const idx = order.indexOf(rec)
        const b = el('button', 'vl-codex-item', list, `[${String(p.category || 'LOG').slice(0, 4)}] ${p.title || 'ENTRY'}`)
        b.type = 'button'
        b.addEventListener('click', () => this._selectCodex(idx))
        this._codexBtns[idx] = b
      }
      // discovered entries not in the known list (defensive)
      for (const rec of order) {
        if (rec.levelId === lid && !k.pois.some((p) => p.id === rec.poi.id)) {
          const idx = order.indexOf(rec)
          const b = el('button', 'vl-codex-item', list, `[${String(rec.poi.category || 'LOG').slice(0, 4)}] ${rec.poi.title || 'ENTRY'}`)
          b.type = 'button'
          b.addEventListener('click', () => this._selectCodex(idx))
          this._codexBtns[idx] = b
        }
      }
    }
    const orphans = order.filter((rec) => !this.known.has(rec.levelId))
    if (orphans.length) el('div', 'vl-codex-loc', list, '── UNSORTED ──')
    for (const rec of orphans) {
      const idx = order.indexOf(rec)
      const b = el('button', 'vl-codex-item', list, `[${String(rec.poi.category || 'LOG').slice(0, 4)}] ${rec.poi.title || 'ENTRY'}`)
      b.type = 'button'
      b.addEventListener('click', () => this._selectCodex(idx))
      this._codexBtns[idx] = b
    }
    this._selectCodex(this._codexSel, true)
  }

  _selectCodex(i, force) {
    const order = this._codexOrder()
    if (!order.length) {
      this.cdCat.textContent = ''
      this.cdTitle.textContent = 'NO ENTRIES LOGGED'
      this.cdLoc.textContent = 'Aim at a signal in the world and press [E] to scan it.'
      this.cdLines.textContent = ''
      this.cdReadout.style.display = 'none'
      return
    }
    const n = clamp(i, 0, order.length - 1)
    if (n === this._codexSel && !force) return
    this._codexSel = n
    this._codexBtns?.forEach((b, j) => b?.classList.toggle('is-active', j === n))
    const btn = this._codexBtns?.[n]
    if (btn) {
      // manual scroll: scrollIntoView could also scroll the overflow-hidden HUD root
      const L = this.codexList
      const top = btn.offsetTop - L.offsetTop
      if (top < L.scrollTop) L.scrollTop = top
      else if (top + btn.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = top + btn.offsetHeight - L.clientHeight
    }
    const rec = order[n]
    const p = rec.poi
    this.cdCat.textContent = `[${String(p.category || 'LOG').toUpperCase()}]  SCAN #${String(rec.order).padStart(4, '0')}`
    this.cdTitle.textContent = String(p.title || 'ENTRY')
    this.cdLoc.textContent = `LOGGED AT: ${rec.levelName || '—'}`
    this._fillReadout(p, this.cdReadout, this.cdReadL, this.cdReadV)
    this.cdReadout.classList.add('is-shown')
    this._cdWriter = this._typeLines(this.cdLines, p.lines, reducedMotion() ? 2000 : 240, null, this._cdWriter)
  }

  _renderMap() {
    const list = this.mapList
    list.textContent = ''
    for (const loc of LOCATIONS) {
      const k = this.known.get(loc.id)
      const here = this.levelId === loc.id
      const node = this.mapNodes[loc.id]
      node.classList.toggle('is-here', here)
      node.classList.toggle('is-known', !!k)
      const row = el('div', `vl-map-row${here ? ' is-here' : ''}${k ? '' : ' is-unknown'}`, list)
      el('span', 'vl-map-mark', row, here ? '◉' : k ? '◇' : '·')
      const name = el('div', 'vl-map-name', row)
      el('b', '', name, k?.name || loc.label)
      el('span', 'vl-dim vl-small', name, here ? `YOU ARE HERE // ${loc.sub}` : k ? loc.sub : 'NOT SURVEYED')
      let found = 0
      if (k) for (const p of k.pois) if (this.codex.has(p.id)) found++
      el('span', 'vl-map-count', row, k ? `${found}/${k.pois.length} SIGNALS` : '?? SIGNALS')
    }
  }
}

export default Hud
