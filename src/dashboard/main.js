import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/800.css'
import '../displays/displays.css'
import './dashboard.css'
import {
  createIcons,
  Activity,
  BatteryMedium,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowDownToLine,
  Calendar,
  CircleGauge,
  ClipboardList,
  Cloud,
  CloudFog,
  Droplet,
  Droplets,
  Dumbbell,
  Eye,
  Gauge,
  GlassWater,
  HeartPulse,
  Moon,
  MoveDownRight,
  MoveRight,
  MoveUpRight,
  Orbit,
  Pill,
  Plus,
  Radiation,
  Scale,
  Smile,
  Sun,
  TestTubes,
  Thermometer,
  ThermometerSun,
  Timer,
  TriangleAlert,
  Utensils,
  Volume2,
  Wind,
  X,
} from 'lucide'
import { widget, Readout, Meter, Radial, Trace, Log, startAlertBeat } from '../displays/components.js'
import { createSquid } from './squid.js'
import { createFlows } from './flows.js'

// Companion dashboard, three views cycled with the arrows under the stage:
//   Main      — a locked panel around the (empty) companion disc, plus a scrolling column of everything else
//   Spacewalk — only the stats that matter outside, drawn larger
//   History   — every tracked stat as a plain list: latest value, 14-day trend, range
// The tasks panel stays on the right throughout.

// ------------------------------------------------------------------ stats

// Every live widget reads one stat from here. A stat's limits drive the widget's lamp (amber = caution,
// red = warning), and the debug menu can change any stat. Stats with `vary` drift inside a [low, high]
// range instead of holding one value, the way a pulse or breathing rate does.
//   limits: crit below critLo · caution below warnLo · fine · caution above warnHi · crit above critHi
const STATS = {
  // Vitals
  hr: { label: 'Heart rate', group: 'Vitals', unit: 'bpm', min: 30, max: 200, step: 1, vary: [64, 76], critLo: 40, warnLo: 50, warnHi: 100, critHi: 140 },
  spo2: { label: 'SpO₂', group: 'Vitals', unit: '%', min: 80, max: 100, step: 1, vary: [96, 99], critLo: 89, warnLo: 93 },
  coreTemp: { label: 'Core temp', group: 'Vitals', unit: '°C', min: 34, max: 40, step: 0.1, vary: [36.6, 37], critLo: 35, warnLo: 35.9, warnHi: 37.4, critHi: 38.5 },
  resp: { label: 'Breathing rate', group: 'Vitals', unit: '/min', min: 4, max: 40, step: 1, vary: [12, 16], critLo: 8, warnLo: 10, warnHi: 20, critHi: 28 },
  bpSys: { label: 'BP systolic', group: 'Vitals', unit: 'mmHg', min: 80, max: 200, step: 1, value: 118, warnHi: 129, critHi: 139 },
  bpDia: { label: 'BP diastolic', group: 'Vitals', unit: 'mmHg', min: 40, max: 130, step: 1, value: 76 },
  glucose: { label: 'Glucose', group: 'Vitals', unit: 'mg/dL', min: 40, max: 300, step: 1, vary: [96, 108], critLo: 54, warnLo: 70, warnHi: 180, critHi: 250 },
  // Daily
  sleep: { label: 'Sleep', group: 'Daily', unit: 'h', min: 0, max: 10, step: 0.1, value: 6.4, critLo: 4, warnLo: 6 },
  exercise: { label: 'Exercise', group: 'Daily', unit: 'h', min: 0, max: 3, step: 0.1, value: 1.6, warnLo: 0.5 },
  water: { label: 'Water', group: 'Daily', unit: 'L', min: 0, max: 3, step: 0.05, value: 1.9, critLo: 0.75, warnLo: 1.25 },
  kcal: { label: 'Energy intake', group: 'Daily', unit: 'kcal', min: 0, max: 3500, step: 10, value: 2150, critLo: 1200, warnLo: 1800 },
  mood: { label: 'Mood', group: 'Daily', unit: '/ 5', min: 1, max: 5, step: 1, value: 4, critLo: 1, warnLo: 2 },
  cycleDay: { label: 'Cycle day', group: 'Daily', unit: '', min: 1, max: 28, step: 1, value: 12 },
  bodyMass: { label: 'Body mass', group: 'Daily', unit: 'kg', min: 55, max: 90, step: 0.1, value: 71.8, critLo: 65, warnLo: 68 },
  vision: { label: 'Vision shift', group: 'Daily', unit: 'D', min: -1.5, max: 0.5, step: 0.05, value: -0.2, critLo: -0.76, warnLo: -0.26 },
  reaction: { label: 'Reaction time', group: 'Daily', unit: 'ms', min: 180, max: 400, step: 1, value: 268, warnHi: 300, critHi: 340 },
  vo2: { label: 'VO₂ max', group: 'Daily', unit: 'mL/kg/min', min: 25, max: 55, step: 0.5, value: 39.5, critLo: 30, warnLo: 35 },
  // Cabin
  co2: { label: 'Cabin CO₂', group: 'Cabin', unit: 'mmHg', min: 0, max: 10, step: 0.1, value: 2.6, warnHi: 3, critHi: 5.3 },
  cabinP: { label: 'Cabin pressure', group: 'Cabin', unit: 'kPa', min: 90, max: 110, step: 0.1, value: 101.3, critLo: 96, warnLo: 99, warnHi: 103, critHi: 105 },
  cabinO2: { label: 'Cabin O₂', group: 'Cabin', unit: 'kPa', min: 14, max: 30, step: 0.1, value: 21.2, critLo: 17, warnLo: 19.5, warnHi: 23.1, critHi: 25 },
  gravity: { label: 'Gravity', group: 'Cabin', unit: 'g', min: 0, max: 1.2, step: 0.01, value: 0.38 },
  lux: { label: 'Light', group: 'Cabin', unit: 'lux', min: 0, max: 3000, step: 10, value: 1840 },
  pm25: { label: 'Air particulate', group: 'Cabin', unit: 'µg/m³', min: 0, max: 60, step: 1, value: 8, warnHi: 15, critHi: 35 },
  kpG: { label: 'Geomagnetic', group: 'Cabin', unit: 'G', min: 0, max: 5, step: 1, value: 2, warnHi: 2, critHi: 3 },
  kpS: { label: 'Solar radiation', group: 'Cabin', unit: 'S', min: 0, max: 5, step: 1, value: 1, warnHi: 2, critHi: 3 },
  kpR: { label: 'Radio blackout', group: 'Cabin', unit: 'R', min: 0, max: 5, step: 1, value: 0, warnHi: 2, critHi: 3 },
  radiation: { label: 'Career dose', group: 'Cabin', unit: 'mSv', min: 0, max: 700, step: 1, value: 182, warnHi: 450, critHi: 600 },
  noise: { label: 'Noise', group: 'Cabin', unit: 'dBA', min: 30, max: 100, step: 1, vary: [52, 58], warnHi: 60, critHi: 72 },
  // Spacewalk
  suitP: { label: 'Suit pressure', group: 'Spacewalk', unit: 'kPa', min: 26, max: 33, step: 0.1, value: 29.6, critLo: 27.5, warnLo: 28.6, warnHi: 30.6, critHi: 31.5 },
  evaTime: { label: 'Time remaining', group: 'Spacewalk', unit: 'h', min: 0, max: 8, step: 0.1, value: 3.1, critLo: 0.5, warnLo: 1 },
  suitO2: { label: 'Suit O₂', group: 'Spacewalk', unit: '%', min: 0, max: 100, step: 1, value: 64, critLo: 25, warnLo: 40 },
  helmetCo2: { label: 'Helmet CO₂', group: 'Spacewalk', unit: 'mmHg', min: 0, max: 10, step: 0.1, vary: [1.6, 2.2], warnHi: 3, critHi: 5.3 },
  metabolic: { label: 'Metabolic rate', group: 'Spacewalk', unit: 'kJ/h', min: 400, max: 2500, step: 10, vary: [1100, 1300], warnHi: 1800, critHi: 2200 },
}
for (const s of Object.values(STATS)) {
  s.digits = String(s.step).split('.')[1]?.length ?? 0
  if (s.vary) s.value = (s.vary[0] + s.vary[1]) / 2
  s.zones = [
    { max: s.critLo ?? -Infinity, tone: 'crit' },
    { max: s.warnLo ?? -Infinity, tone: 'warn' },
    { max: s.warnHi ?? Infinity, tone: 'ok' },
    { max: s.critHi ?? Infinity, tone: 'warn' },
    { max: Infinity, tone: 'crit' },
  ]
}
const DEFAULTS = Object.fromEntries(Object.entries(STATS).map(([id, s]) => [id, s.vary ? [...s.vary] : s.value]))
const toneOf = (s, v = s.value) => s.zones.find((z) => v <= z.max).tone
const fmtStat = (id, v = STATS[id].value) => v.toLocaleString('en-US', { minimumFractionDigits: STATS[id].digits, maximumFractionDigits: STATS[id].digits })

const subs = {}
// Calls fn now and whenever the stat changes.
function bind(id, fn) {
  ;(subs[id] ||= []).push(fn)
  fn(STATS[id].value)
}
function setStat(id, v) {
  const s = STATS[id]
  s.value = Math.min(s.max, Math.max(s.min, v))
  for (const fn of subs[id] ?? []) fn(s.value)
}

// Widget factories: the same kit components, built from a stat and kept in sync with it.
function meter(id, o = {}) {
  const s = STATS[id]
  const m = Meter({ min: s.min, max: s.max, value: s.value, digits: s.digits, unit: s.unit, zones: s.zones, ...o })
  bind(id, (v) => m.set(v))
  return m
}
function readout(id, o = {}) {
  const s = STATS[id]
  const r = Readout({ value: s.value, digits: s.digits, unit: s.unit, zones: s.zones, ...o })
  bind(id, (v) => r.set(v))
  return r
}
function dial(id, o = {}) {
  const s = STATS[id]
  const r = Radial({ min: s.min, max: s.max, value: s.value, zones: s.zones, center: (v) => fmtStat(id, v), ...o })
  bind(id, (v) => r.set(v))
  return r
}

// ------------------------------------------------------------------ live signals

// The ECG and breathing traces follow the current heart and breathing rates. Phase is integrated so a
// rate change speeds the trace up or slows it down without a jump.
const gauss = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s))
const beat = { phase: 0, t: 0 }
const breathing = { phase: 0, t: 0 }
function ecg(t) {
  const p = (((beat.phase + ((t - beat.t) * STATS.hr.value) / 60) % 1) + 1) % 1
  return 0.12 * gauss(p, 0.1, 0.025) - 0.1 * gauss(p, 0.2, 0.008) + gauss(p, 0.225, 0.01) - 0.25 * gauss(p, 0.25, 0.01) + 0.3 * gauss(p, 0.45, 0.04)
}
const breath = (t) => Math.sin((breathing.phase + ((t - breathing.t) * STATS.resp.value) / 60) * 2 * Math.PI) * 0.8

// Deterministic pseudo-random walk for static sample histories.
function walk(n, start, step, seed, lo = -Infinity, hi = Infinity) {
  let s = seed
  let v = start
  const out = []
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647
    v = Math.min(hi, Math.max(lo, v + ((s / 2147483647) - 0.5) * step))
    out.push(v)
  }
  return out
}

const h = (html) => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

const live = []
function heartRate() {
  const ro = readout('hr')
  const tr = Trace({ mode: 'live', gen: ecg, min: -0.35, max: 1.05, samples: 240, rate: 80, height: 64, solid: true })
  live.push(tr)
  return widget({ icon: 'heart-pulse', accent: 'pulse', parts: [ro, tr] })
}
const tempTuner = () => meter('coreTemp', { min: 35, max: 39.5, tuner: { major: 1, minor: 1 }, target: [36.1, 37.2], label: 'Core', scale: ['35', '37', '39.5'] })

// A widget with a small caption above it, for the scrolling column and the spacewalk view.
const item = (title, el) => {
  const wrap = h(`<div class="item"><span class="item-title">${title}</span></div>`)
  wrap.append(el)
  return wrap
}

const WATER_GOAL = 2.5

// Blood pressure is one bar spanning diastolic to systolic, so it follows two stats.
function bloodPressure() {
  const m = Meter({ min: 40, max: 180, range: [STATS.bpDia.value, STATS.bpSys.value], unit: 'mmHg', target: [60, 120], zones: STATS.bpSys.zones, scale: ['40', '120', '180'] })
  const update = () => m.set([STATS.bpDia.value, STATS.bpSys.value])
  bind('bpSys', update)
  bind('bpDia', update)
  return m
}

// ------------------------------------------------------------------ view 1: main

// Top: the core vitals across the full width. Left: four of the Display Kit's dials. Middle: the companion's
// circle. Right: a scrolling list that bends around the circle and keeps only the rows beside it in focus.
const dialTile = (id, icon, accent, o) => widget({ icon, accent, parts: [dial(id, o)] })

// ------------------------------------------------------------------ companion

// The squid's mood comes from every stat: each caution counts 1 and each warning 3. Its speech bubble
// names the worst one ("Hydration low"), and how many more need attention.
const HINTS = {
  water: { lo: 'Hydration low' },
  sleep: { lo: 'Not enough sleep' },
  exercise: { lo: 'Need some exercise' },
  kcal: { lo: 'Eat something' },
  mood: { lo: 'Feeling down' },
  co2: { hi: 'Stuffy air (CO₂ high)' },
  radiation: { hi: 'Radiation dose high' },
  noise: { hi: 'Too noisy' },
}
const pet = createSquid({ reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
live.push(pet)
function hintFor(id) {
  const s = STATS[id]
  const side = s.value <= (s.warnLo ?? -Infinity) ? 'lo' : 'hi'
  return HINTS[id]?.[side] ?? `${s.label} ${side === 'lo' ? 'low' : 'high'}`
}
// The latest result of each guided check-in (weight, heart rate, blood pressure). A bad result holds the
// squid at least that unhappy, and names itself in the bubble, until the check is passed again.
const checks = {}
const MOODS = ['happy', 'okay', 'low', 'bad']
function showPetMood() {
  const issues = Object.entries(STATS)
    .map(([id, s]) => ({ id, tone: toneOf(s) }))
    .filter((x) => x.tone !== 'ok')
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'crit' ? -1 : 1))
  const score = issues.reduce((n, x) => n + (x.tone === 'crit' ? 3 : 1), 0)
  let name = score === 0 ? 'happy' : score <= 2 ? 'okay' : score <= 5 ? 'low' : 'bad'
  let hint = issues.length ? hintFor(issues[0].id) : 'Feeling great!'
  let more = Math.max(0, issues.length - 1)
  const worst = Object.values(checks).filter((c) => c.mood).sort((a, b) => MOODS.indexOf(b.mood) - MOODS.indexOf(a.mood))[0]
  if (worst && MOODS.indexOf(worst.mood) >= MOODS.indexOf(name)) {
    name = worst.mood
    hint = worst.hint
    more = issues.length
  }
  pet.setMood(name, hint, more)
}
showPetMood()

function mainView() {
  const el = h(`<div class="view view-main">
    <div class="topbar"></div>
    <div class="dials"></div>
    <div class="orbit">
      <div class="companion" aria-label="Companion"></div>
      <div class="snap" tabindex="0" aria-label="More stats"><div class="snap-list"></div></div>
      <div class="snap-nav" role="group" aria-label="Sections"></div>
    </div>
    <div class="bottombar"></div>
  </div>`)

  // The same dials as the Display Kit, nothing added.
  // The same dials as the Display Kit, nothing added. Personal ones stay beside the circle; the cabin
  // and cycle dials sit in their list sections.
  el.querySelector('.dials').append(
    dialTile('sleep', 'moon', 'neural', { mode: 'ring', rings: [{ value: STATS.sleep.value, max: 8, label: 'Slept' }], sub: 'Goal 8 h' }),
    dialTile('exercise', 'dumbbell', 'phosphor', { mode: 'ring', rings: [{ value: STATS.exercise.value, max: 2.5 }], sub: 'Goal 2.5 h' }),
    dialTile('water', 'glass-water', 'oxygen', { mode: 'ring', rings: [{ value: STATS.water.value, max: WATER_GOAL }], center: (v) => v.toFixed(1), sub: `Goal ${WATER_GOAL} L` }),
    dialTile('kcal', 'utensils', 'thermal', { mode: 'ring', rings: [{ value: STATS.kcal.value, max: 2800, label: 'kcal' }, { value: 96, max: 120, label: 'Protein' }, { value: 1.4, max: 1.8, label: 'Ca²⁺' }], center: (v) => `${Math.round((v / 2800) * 100)}%` }),
  )
  const tileRow = (...tiles) => {
    const row = h('<div class="tile-row"></div>')
    row.append(...tiles)
    return row
  }

  // Top bar: the core vitals, spread across the full width.
  el.querySelector('.topbar').append(
    heartRate(),
    widget({ icon: 'droplets', accent: 'oxygen', parts: [meter('spo2', { min: 85, unit: '', markers: [{ at: 90, label: '90' }, { at: 94, label: '94' }], scale: ['85', '100'] })] }),
    widget({ icon: 'thermometer', accent: 'thermal', parts: [tempTuner()] }),
  )

  // Bottom bar: the cabin exposures that matter over a mission, not a minute.
  el.querySelector('.bottombar').append(
    widget({ icon: 'cloud', accent: 'phosphor', parts: [meter('co2', { max: 8, markers: [{ at: 3, label: 'Goal' }, { at: 5.3, label: 'Limit' }], scale: ['0', '8'] })] }),
    widget({ icon: 'radiation', accent: 'rad', parts: [meter('radiation', { max: 600, markers: [{ at: 600, label: '' }], scale: ['0', '600 limit'] })] }),
    widget({ icon: 'volume-2', accent: 'phosphor', parts: [meter('noise', { max: 90, segments: 12, scale: ['30', '60', '90'] })] }),
  )

  const resp = Trace({ mode: 'live', gen: breath, min: -1, max: 1, samples: 200, rate: 40 })
  live.push(resp)
  const SECTIONS = [
    ['Body', 'heart-pulse', [
      item('Blood pressure', widget({ icon: 'activity', accent: 'pulse', parts: [bloodPressure()] })),
      item('Mood', widget({ icon: 'smile', accent: 'neural', parts: [meter('mood', { min: 0, segments: 5, label: 'Self-rated', valueText: (v) => `${v} / 5`, scale: ['Low', 'High'] })] })),
      item('Cycle', tileRow(dialTile('cycleDay', 'calendar', 'flux', {
      mode: 'segments', min: 0, max: 28,
      segments: [{ from: 0, to: 5, ink: 0.9, label: 'Menstrual' }, { from: 5, to: 13, ink: 0.35, label: 'Follicular' }, { from: 13, to: 16, ink: 0.65, label: 'Ovulation' }, { from: 16, to: 28, ink: 0.15, label: 'Luteal' }],
      sub: 'Day',
    }))),
      item('Respiration', widget({ icon: 'wind', accent: 'oxygen', parts: [readout('resp'), resp] })),
      item('Glucose · 4 h', widget({ icon: 'droplet', accent: 'signal', parts: [readout('glucose', { trend: 'up' }), Trace({ mode: 'line', data: walk(48, 92, 9, 7, 75, 125), min: 50, max: 180, band: [70, 140] })] })),
      item('Body mass · 6 mo', widget({ icon: 'scale', accent: 'signal', parts: [readout('bodyMass', { trend: 'down' }), Trace({ mode: 'line', data: walk(24, 74, 0.6, 3, 71, 74.5).map((v, i) => v - i * 0.08), min: 69, max: 76 })] })),
      item('Vision vs preflight', widget({ icon: 'eye', accent: 'signal', parts: [meter('vision', { target: [-0.25, 0.25], scale: ['−1.5', '+0.5'] })] })),
      item('Reaction time', widget({ icon: 'brain', accent: 'neural', parts: [meter('reaction', { max: 360, target: [235, 275], scale: ['180', '360'] })] })),
      item('VO₂ max', widget({ icon: 'heart-pulse', accent: 'phosphor', parts: [meter('vo2', { target: [41, 46], scale: ['25', '55'] })] })),
    ]],
    ['Cabin', 'gauge', [
      item('Air particulate', widget({ icon: 'cloud-fog', accent: 'phosphor', parts: [meter('pm25', { segments: 6, scale: ['Good', 'Hazard'] })] })),
      item('Pressure · O₂ · gravity · light', tileRow(
        dialTile('cabinP', 'gauge', 'signal', { min: 95, max: 106, band: [99, 103], sub: 'kPa' }),
        dialTile('cabinO2', 'circle-gauge', 'oxygen', { min: 15, max: 28, band: [19.5, 23.1], sub: 'kPa O₂' }),
        dialTile('gravity', 'arrow-down-to-line', 'signal', { sub: 'g' }),
        dialTile('lux', 'sun', 'rad', {
      mode: 'segments', min: 0, max: 24, at: 14.5,
      segments: [{ from: 0, to: 6.5, ink: 0.9, label: 'Dark' }, { from: 6.5, to: 8, ink: 0.5 }, { from: 8, to: 12.5, ink: 0.08, label: 'Bright' }, { from: 12.5, to: 18, ink: 0.25 }, { from: 18, to: 22, ink: 0.55, label: 'Dim / warm' }, { from: 22, to: 24, ink: 0.9 }],
      sub: 'lux',
    }),
      )),
      item('Space weather', widget({ icon: 'orbit', accent: 'flux', parts: [
        meter('kpG', { segments: 5, tabText: 'G', valueText: (v) => `G${v}` }),
        meter('kpS', { segments: 5, tabText: 'S', valueText: (v) => `S${v}` }),
        meter('kpR', { segments: 5, tabText: 'R', valueText: (v) => `R${v}` }),
      ] })),
    ]],
    ['Logs', 'clipboard-list', [
      item('Symptoms', widget({ icon: 'clipboard-list', accent: 'pulse', parts: [Log({ items: [
        { time: '07:10', text: 'Headache, mild', chip: { label: 'CO₂?', tone: 'warn' } },
        { time: '09:45', text: 'Congestion', chip: { label: 'Fluid shift', tone: 'info' } },
      ] })] })),
      item('Medication', widget({ icon: 'pill', accent: 'signal', parts: [Log({ items: [
        { time: '06:30', text: 'Vitamin D', chip: { label: 'Taken', tone: 'ok' } },
        { time: '21:30', text: 'Melatonin', chip: { label: 'Due', tone: 'info' } },
      ] })] })),
    ]],
    ['Samples', 'test-tubes', [
      item('Lab samples', widget({ icon: 'test-tubes', accent: 'neural', parts: [Log({ items: [
        { time: 'BLD-14', text: 'Blood', steps: [{ label: 'Collect', state: 'done' }, { label: 'Spin', state: 'done' }, { label: 'Freeze', state: 'active' }, { label: 'Return', state: 'todo' }] },
        { time: 'URN-22', text: 'Urine', steps: [{ label: 'Collect', state: 'active' }, { label: 'Spin', state: 'todo' }, { label: 'Freeze', state: 'todo' }, { label: 'Return', state: 'todo' }] },
      ] })] })),
    ]],
  ]

  const snap = el.querySelector('.snap')
  const list = el.querySelector('.snap-list')
  const nav = el.querySelector('.snap-nav')
  const secs = SECTIONS.map(([name, icon, items]) => {
    const sec = h(`<section class="snap-sec" aria-label="${name}"><h2 class="snap-title sec-head">${name}</h2></section>`)
    sec.append(...items)
    list.append(sec)
    const b = h(`<button type="button" aria-label="${name}"><i data-lucide="${icon}"></i><span>${name}</span></button>`)
    // Jump so the section's title sits level with the circle's centre, where rows snap.
    const title = sec.firstElementChild
    b.addEventListener('click', () => snap.scrollTo({ top: title.offsetTop + title.offsetHeight / 2 - geo.cy, behavior: 'smooth' }))
    nav.append(b)
    return sec
  })
  const rows = [...list.querySelectorAll('.snap-sec > *')]

  // The list is a plain full-width list. Every frame, each row is pushed right by just enough to clear
  // the circle at its current height, so rows bend around the circle as they scroll past it and
  // straighten out again above and below it. A soft envelope (wider than the circle) keeps the bend
  // smooth instead of rows jumping sideways at the circle's top and bottom.
  const orbit = el.querySelector('.orbit')
  const companion = el.querySelector('.companion')
  companion.append(pet.el)
  // Tapping the bowl releases bubbles. The scrolling list sits over the circle (masked out there), so the
  // tap is caught on the orbit and kept only when it lands inside the circle.
  orbit.addEventListener('pointerdown', (e) => {
    const b = companion.getBoundingClientRect()
    const r = b.width / 2
    if (Math.hypot(e.clientX - (b.left + r), e.clientY - (b.top + r)) <= r) pet.fizz(e.clientX, e.clientY)
  })
  const wide = window.matchMedia('(min-width: 1101px)')
  const geo = { on: false, cx: 0, cy: 0, R: 0, reach: 0 }
  function bend() {
    if (!geo.on) return
    const top0 = snap.getBoundingClientRect().top
    const { cx, cy, R, reach } = geo
    const looks = rows.map((r) => {
      const b = r.getBoundingClientRect()
      const top = b.top - top0
      const bottom = top + b.height
      const dy = cy < top ? top - cy : cy > bottom ? cy - bottom : 0
      const need = dy < R ? cx + Math.sqrt(R * R - dy * dy) : 0
      // Rows rest part-way across, so the bend around the circle is gentle rather than a full curve.
      const rest = cx + R * 0.45
      const soft = rest + (dy < reach ? (cx + R - rest) * Math.sqrt(1 - (dy / reach) ** 2) : 0)
      // Rows in line with the circle are in focus; well past its top or bottom they dim and soften a
      // little, but stay readable.
      const t = Math.min(1, Math.max(0, (dy - R * 0.85) / (R * 0.8)))
      return { x: Math.max(need, soft), t }
    })
    rows.forEach((r, i) => {
      const { x, t } = looks[i]
      r.style.marginLeft = `${x.toFixed(1)}px`
      r.style.opacity = (1 - 0.55 * t).toFixed(3)
      r.style.filter = t > 0.01 ? `blur(${(t * 1.2).toFixed(2)}px)` : ''
    })
    let on = 0
    // The highlighted section is the one beside the top half of the circle.
    secs.forEach((sec, i) => { if (sec.offsetTop <= snap.scrollTop + cy + 8) on = i })
    nav.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', on === j))
  }
  function layout() {
    const W = orbit.clientWidth
    const H = orbit.clientHeight
    geo.on = wide.matches && W > 0 && H > 0
    if (!geo.on) {
      companion.removeAttribute('style')
      snap.removeAttribute('style')
      for (const r of rows) {
        r.style.marginLeft = ''
        r.style.opacity = ''
        r.style.filter = ''
      }
      list.style.paddingBottom = ''
      list.style.paddingTop = ''
      return
    }
    // The circle leaves room above and below it, so rows can be seen straightening out.
    const r = Math.min(H * 0.72, W * 0.48) / 2
    geo.cx = r
    geo.cy = H / 2
    geo.R = r + 16
    geo.reach = geo.R * 1.45
    companion.style.cssText = `width:${2 * r}px;height:${2 * r}px;top:${geo.cy - r}px;left:0`
    snap.style.cssText = `--cx:${geo.cx}px;--cy:${geo.cy}px;--R:${geo.R}px`
    // Every row snaps to the circle's centre line, like a dial, so the first and last rows need room
    // to reach it.
    list.style.paddingTop = `${Math.max(0, geo.cy - rows[0].offsetHeight / 2)}px`
    list.style.paddingBottom = `${Math.max(0, H - geo.cy - rows.at(-1).offsetHeight / 2)}px`
    bend()
  }
  let queued = false
  snap.addEventListener('scroll', () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; bend() })
  }, { passive: true })
  new ResizeObserver(layout).observe(orbit)
  wide.addEventListener('change', layout)
  return el
}

// ------------------------------------------------------------------ view 2: spacewalk

function spacewalkView() {
  const el = h(`<div class="view view-eva">
    <header class="eva-head">
      <span class="eva-tag">EVA 3</span>
      <span class="eva-clock">Elapsed <b id="eva-elapsed">02:14:08</b></span>
    </header>
    <div class="eva-tiles"></div>
    <div class="eva-grid"></div>
  </div>`)
  el.querySelector('.eva-tiles').append(
    widget({ icon: 'gauge', accent: 'oxygen', parts: [dial('suitP', { band: [28.6, 30.6], sub: 'Suit kPa' })] }),
  )
  el.querySelector('.eva-grid').append(
    item('Time remaining', widget({ icon: 'timer', accent: 'oxygen', parts: [meter('evaTime', { markers: [{ at: 1, label: 'Walk-back' }], scale: ['0', '8'] })] })),
    item('Suit O₂', widget({ icon: 'wind', accent: 'oxygen', parts: [meter('suitO2', { markers: [{ at: 25, label: 'Return' }, { at: 40, label: 'Low' }] })] })),
    item('Helmet CO₂', widget({ icon: 'cloud', accent: 'phosphor', parts: [meter('helmetCo2', { max: 8, markers: [{ at: 5.3, label: 'Limit' }], scale: ['0', '8'] })] })),
    item('Core temp', widget({ icon: 'thermometer', accent: 'thermal', parts: [tempTuner()] })),
    item('Heart rate', heartRate()),
    item('Metabolic rate', widget({ icon: 'activity', accent: 'pulse', parts: [readout('metabolic'), Trace({ mode: 'line', data: walk(40, 900, 120, 11, 700, 1300), min: 500, max: 1600 })] })),
  )
  return el
}

// ------------------------------------------------------------------ view 3: history

// Charts grouped into categories, each with a vertical label down its left side. Every chart is labelled:
// a value scale on the left (top, middle and bottom of the range) and times along the bottom. `height`
// is each chart's minimum; charts stretch to fill their row. Big ones span two columns. `band` shades
// the normal range.
const SLEEP_STAGES = [3, 2, 1, 0, 0, 1, 2, 1, 0, 0, 1, 2, 2, 1, 0, 1, 2, 3, 2, 1, 2, 1, 2, 2, 3]
const HISTORY_GROUPS = [
  ['Sleep & mood', ['Sleep', 'Mood']],
  ['Heart & lungs', ['Heart rate', 'BP systolic', 'SpO₂', 'Respiratory rate']],
  ['Fuel & body', ['Blood glucose', 'Core temp', 'Body mass', 'Water', 'Energy intake', 'Exercise']],
  ['Brain & eyes', ['Reaction time', 'Vision shift']],
  ['Cabin', ['Cabin CO₂', 'Radiation dose', 'Noise', 'Cabin climate']],
]
// Times along the bottom of a chart, by its span.
const X_LABELS = { '24 h': ['00:00', '12:00', 'Now'], 'Last night': ['22:30', '02:30', '06:30'], '6 mo': ['May', 'Aug', 'Now'] }
const HISTORY = [
  { name: 'Sleep', span: 'Last night', icon: 'moon', accent: 'neural', wide: true, value: 7.3, digits: 1, unit: 'h',
    chart: { mode: 'step', data: SLEEP_STAGES, min: -0.3, max: 3.3, yLabels: ['Wake', 'REM', 'Light', 'Deep'], height: 72 } },
  { name: 'Heart rate', span: '24 h', icon: 'heart-pulse', accent: 'pulse', wide: true, unit: 'bpm', data: walk(96, 64, 6, 2, 52, 96), band: [50, 100], height: 64 },
  { name: 'Blood glucose', span: '24 h', icon: 'droplet', accent: 'signal', wide: true, unit: 'mg/dL', data: walk(96, 95, 11, 7, 72, 150), band: [70, 140], lo: 50, hi: 180, height: 64 },
  { name: 'BP systolic', icon: 'activity', accent: 'pulse', unit: 'mmHg', data: walk(14, 116, 6, 5, 104, 128), band: [90, 120], lo: 90, hi: 140, height: 44 },
  { name: 'SpO₂', icon: 'droplets', accent: 'oxygen', unit: '%', data: walk(14, 97, 1.2, 9, 94, 99), band: [95, 100], lo: 90, hi: 100, height: 44 },
  { name: 'Core temp', icon: 'thermometer', accent: 'thermal', unit: '°C', digits: 1, data: walk(14, 36.8, 0.3, 4, 36.3, 37.3), band: [36.1, 37.2], lo: 35.5, hi: 38, height: 44 },
  { name: 'Mood', icon: 'smile', accent: 'neural', unit: '/ 5', chart: { mode: 'step', data: walk(14, 4, 1.4, 19, 1, 5).map(Math.round), min: 0.7, max: 5.3, yLabels: ['5', '4', '3', '2', '1'], height: 72 } },
  { name: 'Respiratory rate', icon: 'wind', accent: 'oxygen', unit: '/min', data: walk(14, 14, 1.5, 13, 11, 18), band: [12, 20], lo: 8, hi: 24, height: 44 },
  { name: 'Body mass', span: '6 mo', icon: 'scale', accent: 'signal', unit: 'kg', digits: 1, data: walk(24, 74, 0.6, 3, 71, 74.5).map((v, i) => v - i * 0.08), height: 44 },
  { name: 'Water', icon: 'glass-water', accent: 'oxygen', unit: 'L', digits: 1, data: walk(14, 2.2, 0.5, 23, 1.4, 2.9), band: [2.5, 3.5], lo: 0, hi: 3.5, height: 44, mode: 'step' },
  { name: 'Exercise', icon: 'dumbbell', accent: 'phosphor', unit: 'h', digits: 1, data: walk(14, 2, 0.8, 31, 0.5, 2.8), band: [2, 3], lo: 0, hi: 3, height: 44, mode: 'step' },
  { name: 'Energy intake', icon: 'utensils', accent: 'thermal', unit: 'kcal', data: walk(14, 2400, 300, 29, 1900, 2900), band: [2500, 2900], lo: 1500, hi: 3200, height: 44 },
  { name: 'Reaction time', icon: 'brain', accent: 'neural', unit: 'ms', data: walk(14, 255, 18, 37, 230, 290), band: [235, 275], height: 44 },
  { name: 'Vision shift', icon: 'eye', accent: 'signal', unit: 'D', digits: 2, data: walk(14, -0.3, 0.08, 41, -0.6, 0).map((v, i) => v - i * 0.01), band: [-0.25, 0.25], lo: -1, hi: 0.5, height: 44 },
  { name: 'Cabin CO₂', icon: 'cloud', accent: 'phosphor', unit: 'mmHg', digits: 1, data: walk(14, 2.6, 0.6, 43, 1.8, 3.6), band: [0, 3], lo: 0, hi: 6, height: 44 },
  { name: 'Radiation dose', icon: 'radiation', accent: 'rad', unit: 'mSv/day', digits: 2, data: walk(14, 0.6, 0.12, 47, 0.45, 0.8), height: 44 },
  { name: 'Noise', icon: 'volume-2', accent: 'phosphor', unit: 'dBA', data: walk(14, 60, 5, 53, 52, 70), band: [30, 60], lo: 40, hi: 80, height: 44, mode: 'step' },
  { name: 'Cabin climate', span: 'Now', icon: 'thermometer-sun', accent: 'thermal',
    xy: { x: 22.4, y: 46, xr: [16, 30], yr: [10, 90], zone: { x: [18.3, 26.7], y: [25, 70] }, xLabel: 'Temp °C', yLabel: 'RH %' } },
]

function historyCard(s) {
  const d = s.digits ?? 0
  const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  let reading = ''
  let chart
  if (s.xy) {
    chart = Trace({ mode: 'xy', ...s.xy })
    reading = `<span class="h-val"><b>${s.xy.x}</b> °C <b>${s.xy.y}</b> %</span>`
  } else {
    const data = s.chart?.data ?? s.data
    const lo = Math.min(...data)
    const hi = Math.max(...data)
    const pad = (hi - lo) * 0.25 || 1
    const min = s.lo ?? lo - pad
    const max = s.hi ?? hi + pad
    // Scale labels sit at the top, middle and bottom of the chart's range.
    const scaleDigits = max - min < 3 ? Math.max(d, 1) : d
    const tick = (v) => v.toLocaleString('en-US', { minimumFractionDigits: scaleDigits, maximumFractionDigits: scaleDigits })
    reading = `<span class="h-val"><b>${fmt(s.value ?? data.at(-1))}</b> ${s.unit}</span>`
    chart = Trace(s.chart ?? { mode: s.mode ?? 'line', data, min, max, band: s.band, height: s.height, yLabels: [tick(max), tick((min + max) / 2), tick(min)] })
  }
  const x = s.xy ? null : X_LABELS[s.span] ?? ['14 d ago', '7 d', 'Today']
  const card = h(`<article class="h-card${s.wide ? ' wide' : ''}">
    <header><h3>${s.name}</h3>${reading}</header>
  </article>`)
  card.append(widget({ icon: s.icon, accent: s.accent, parts: [chart] }))
  if (x) card.append(h(`<div class="h-x">${x.map((t) => `<span>${t}</span>`).join('')}</div>`))
  return card
}

function historyView() {
  const el = h(`<div class="view view-history">
    <header class="hist-head"><h2 class="sec-head">History</h2><span>Shaded band = normal range</span></header>
  </div>`)
  const byName = new Map(HISTORY.map((s) => [s.name, s]))
  for (const [cat, names] of HISTORY_GROUPS) {
    const group = h(`<section class="hist-group" aria-label="${cat}"><h3 class="hist-cat"><span>${cat}</span></h3><div class="hist-grid"></div></section>`)
    group.querySelector('.hist-grid').append(...names.map((n) => historyCard(byName.get(n))))
    el.append(group)
  }
  return el
}

// ------------------------------------------------------------------ views

const VIEWS = [
  { name: 'Main', el: mainView() },
  { name: 'Spacewalk', el: spacewalkView() },
  { name: 'History', el: historyView() },
]
const host = document.getElementById('view-host')
let view = 0
function showView(i) {
  view = (i + VIEWS.length) % VIEWS.length
  host.replaceChildren(VIEWS[view].el)
  document.getElementById('view-now').textContent = VIEWS[view].name
}
document.getElementById('prev').addEventListener('click', () => showView(view - 1))
document.getElementById('next').addEventListener('click', () => showView(view + 1))

// ------------------------------------------------------------------ tasks

// Each task has a due time (station time, minutes after 00:00 GMT). Drinking repeats every two hours.
const TASKS = [
  { id: 'weight', icon: 'scale', accent: 'signal', text: 'Weight check-in', detail: 'SAMMD or BMMD', due: 10 * 60, flow: 'weight' },
  { id: 'cardio', icon: 'heart-pulse', accent: 'pulse', text: 'Cardio check', detail: 'Heart rate · blood pressure', due: 11 * 60 + 50, flow: 'cardio' },
  { id: 'sleep', icon: 'moon', accent: 'signal', text: 'Log sleep', detail: 'Last night', due: 7 * 60 },
  { id: 'mood', icon: 'smile', accent: 'neural', text: 'Rate your mood', detail: 'Daily check-in', due: 9 * 60 },
  { id: 'drink', icon: 'glass-water', accent: 'oxygen', text: 'Drink water', detail: '250 mL', due: 12 * 60, repeat: 120 },
  { id: 'ared', icon: 'dumbbell', accent: 'phosphor', text: 'ARED session', detail: '45 min', due: 13 * 60 + 15 },
  { id: 'sample', icon: 'test-tubes', accent: 'neural', text: 'Freeze BLD-14', detail: 'Blood sample', due: 15 * 60 + 30 },
]

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.floor(m) % 60)}`
const span = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${pad(Math.floor(m % 60))} m` : `${Math.max(1, Math.floor(m))} m`)

const list = document.getElementById('task-list')
list.innerHTML = TASKS.map((t) => `<li class="task" data-id="${t.id}" style="--accent: var(--${t.accent})">
  <span class="t-tab"><i data-lucide="${t.icon}"></i></span>
  <div class="t-body">
    <span class="t-time">${hhmm(t.due)}</span>
    <span class="t-text">${t.text}</span>
    <span class="t-detail">${t.detail}</span>
    <span class="t-when"></span>
    <button type="button" aria-label="${t.flow ? 'Start' : t.repeat ? 'Log' : 'Done'}: ${t.text}">
      <i data-lucide="${t.flow ? 'chevron-right' : t.repeat ? 'plus' : 'check'}"></i>
    </button>
  </div>
</li>`).join('')
const rowOf = (t) => list.querySelector(`[data-id="${t.id}"]`)

list.addEventListener('click', (e) => {
  const row = e.target.closest('button') && e.target.closest('.task')
  if (!row) return
  const t = TASKS.find((x) => x.id === row.dataset.id)
  if (t.id === 'drink') {
    setStat('water', STATS.water.value + 0.25)
    // The next drink is due two hours from now.
    t.due = stationMinutes() + t.repeat
    row.querySelector('.t-time').textContent = hhmm(t.due)
    renderTasks()
    return
  }
  if (t.flow) {
    // Guided check-ins run on the main view, so the companion can be seen reacting. They can be redone.
    flows.open(t.flow, () => markDone(t))
    return
  }
  if (t.done) return
  if (t.id === 'mood') setStat('mood', 5)
  markDone(t)
})
function markDone(t) {
  t.done = true
  rowOf(t).classList.add('done')
  renderTasks()
}

// ------------------------------------------------------------------ guided check-ins

// A warning along the bottom of the stage when a check-in finds a problem; dismissed with ×, or cleared
// when that check passes.
const banner = h(`<div class="alert-banner" role="alert" hidden>
  <i data-lucide="triangle-alert"></i><p></p><button type="button" aria-label="Dismiss warning"><i data-lucide="x"></i></button>
</div>`)
document.querySelector('.stage').append(banner)
banner.querySelector('button').addEventListener('click', () => { banner.hidden = true })
const flows = createFlows({
  STATS,
  h,
  mount: document.querySelector('.dash'),
  onOpen: () => showView(0),
  onResult(kind, r) {
    if (kind === 'weight') setStat('bodyMass', r.value)
    const mood = r.mood !== undefined ? r.mood : r.tone === 'crit' ? 'bad' : r.tone === 'warn' ? 'low' : null
    checks[kind] = { mood, hint: r.hint, warning: r.warning, tone: r.tone }
    const open = Object.values(checks).filter((c) => c.warning)
    if (open.length) {
      const latest = r.warning ? checks[kind] : open.at(-1)
      banner.className = `alert-banner ${latest.tone}`
      banner.querySelector('p').textContent = latest.warning
      banner.hidden = false
    } else banner.hidden = true
    showPetMood()
  },
})

// ------------------------------------------------------------------ station clock

// Station time runs from a fixed start so the demo always opens at the same moment.
const GMT_START = 11 * 3600 + 42 * 60 + 10
const MET_START = 142 * 3600 + 6 * 60 + 31
const EVA_START = 2 * 3600 + 14 * 60 + 8
let clockT = 0
const stationMinutes = () => (GMT_START + clockT) / 60
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
const gmtEl = document.getElementById('gmt')
const gmtSEl = document.getElementById('gmt-s')
const metEl = document.getElementById('met')
const countEl = document.getElementById('task-count')
const evaEl = VIEWS[1].el.querySelector('#eva-elapsed')

// Each row says how long until it's due (or how late it is); the soonest upcoming task is marked next.
function renderTasks() {
  const now = stationMinutes()
  const open = TASKS.filter((t) => !t.done)
  const next = open.filter((t) => t.due >= now).sort((a, b) => a.due - b.due)[0]
  for (const t of TASKS) {
    const row = rowOf(t)
    const late = !t.done && t.due < now
    row.classList.toggle('late', late)
    row.classList.toggle('next', t === next)
    row.querySelector('.t-when').textContent = t.done ? 'Done' : late ? `${span(now - t.due)} late` : `in ${span(t.due - now)}`
  }
  countEl.textContent = `${open.length}/${TASKS.length}`
  // Keep the list in due order, finished tasks last. Only touch the DOM when the order changes.
  const order = [...open.sort((a, b) => a.due - b.due), ...TASKS.filter((t) => t.done)]
  if (order.some((t, i) => list.children[i] !== rowOf(t))) list.append(...order.map(rowOf))
}

function renderClocks(t) {
  clockT = t
  const g = Math.floor(GMT_START + t)
  gmtEl.textContent = hhmm(g / 60)
  gmtSEl.textContent = `:${pad(g % 60)}`
  const m = Math.floor(MET_START + t)
  metEl.innerHTML = `MET <b>${Math.floor(m / 86400)}/${hms(m % 86400)}</b>`
  evaEl.textContent = hms(Math.floor(EVA_START + t))
  renderTasks()
}

// Icons are drawn into the live DOM only, so every view goes into a hidden holder first.
const holder = document.createElement('div')
holder.hidden = true
holder.append(...VIEWS.map((v) => v.el))
document.body.append(holder)
createIcons({
  icons: { Activity, ArrowDownToLine, Calendar, BatteryMedium, Brain, Check, ChevronLeft, ChevronRight, CircleGauge, ClipboardList, Cloud, CloudFog, Droplet, Droplets, Dumbbell, Eye, Gauge, GlassWater, HeartPulse, Moon, MoveDownRight, MoveRight, MoveUpRight, Orbit, Pill, Plus, Radiation, Scale, Smile, Sun, TestTubes, Thermometer, ThermometerSun, Timer, TriangleAlert, Utensils, Volume2, Wind, X },
  attrs: { 'stroke-width': 2.25 },
})
holder.remove()
showView(0)

// ------------------------------------------------------------------ debug menu

// Change any stat and watch the widgets and their lamps follow. Fixed stats get one slider; drifting stats
// (pulse, breathing…) get a low and a high, and their value wanders between the two. Presets set up the
// demo scenarios in one click. Open with the Debug button or the ` key.
const PRESETS = {
  Nominal: {},
  Dehydrated: { water: 0.6, hr: [92, 104], coreTemp: [37.3, 37.6], mood: 3, glucose: [110, 125] },
  'High CO₂': { co2: 6.1, resp: [20, 24], hr: [88, 96], mood: 2, reaction: 318 },
  'High heart rate': { hr: [112, 120] },
  'High BP': { bpSys: 146, bpDia: 94 },
  Fever: { coreTemp: [38.6, 39], hr: [104, 116], resp: [20, 24], spo2: [93, 95], sleep: 4.5 },
  'Solar storm': { kpG: 4, kpS: 4, kpR: 3, radiation: 590 },
  'EVA emergency': { suitO2: 22, evaTime: 0.4, suitP: 27.8, helmetCo2: [4.8, 5.6], hr: [128, 146], metabolic: [1900, 2300] },
  Flatline: flatline(),
}
// Every stat pushed into its critical zone (the low side when it has one), or its caution zone if it has
// no critical limit. Drifting stats wobble within that zone.
function flatline() {
  const out = {}
  for (const [id, s] of Object.entries(STATS)) {
    const zone = s.critLo > s.min ? [s.min, s.critLo] : s.critHi < s.max ? [s.critHi, s.max]
      : s.warnLo > s.min ? [s.min, s.warnLo] : s.warnHi < s.max ? [s.warnHi, s.max] : null
    if (!zone) continue
    const snap = (v) => Math.round(v / s.step) * s.step
    const [a, b] = zone
    const mid = snap((a + b) / 2)
    out[id] = s.vary ? [snap(a + (b - a) * 0.3), snap(a + (b - a) * 0.7)] : mid
  }
  return out
}
const TONE_TEXT = { ok: 'OK', warn: 'Caution', crit: 'Warning' }

function setRange(id, lo, hi) {
  const s = STATS[id]
  s.vary = [Math.min(lo, hi), Math.max(lo, hi)]
  s.target = null
}
function applyPreset(name) {
  const p = { ...DEFAULTS, ...PRESETS[name] }
  for (const [id, v] of Object.entries(p)) {
    if (Array.isArray(v)) setRange(id, v[0], v[1])
    else setStat(id, v)
  }
  syncDebug()
}

const debug = h(`<aside class="debug" id="debug" aria-label="Debug" hidden>
  <header><h2 class="sec-head">Debug</h2><button type="button" class="dbg-close" aria-label="Close debug"><i data-lucide="x"></i></button></header>
  <label class="dbg-switch"><input type="checkbox" id="frame-flash"> Flash frame on alerts</label>
  <div class="dbg-presets">${Object.keys(PRESETS).map((n) => `<button type="button" data-preset="${n}">${n}</button>`).join('')}</div>
  <div class="dbg-body"></div>
</aside>`)
const range = (id, which, v) => {
  const s = STATS[id]
  return `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-id="${id}" data-which="${which}" aria-label="${s.label} ${which}">`
}
const groups = [...new Set(Object.values(STATS).map((s) => s.group))]
debug.querySelector('.dbg-body').innerHTML = groups.map((g) => `<section><h3>${g}</h3>${Object.entries(STATS).filter(([, s]) => s.group === g).map(([id, s]) => `
  <div class="dbg-row" data-id="${id}">
    <span class="dbg-label">${s.label}</span>
    <output class="dbg-val"></output>
    <span class="dbg-tone"></span>
    ${s.vary
      ? `<div class="dbg-range"><span>Low</span>${range(id, 'lo', s.vary[0])}<b data-lo></b><span>High</span>${range(id, 'hi', s.vary[1])}<b data-hi></b></div>`
      : `<div class="dbg-range single">${range(id, 'value', s.value)}</div>`}
  </div>`).join('')}</section>`).join('')
document.body.append(debug)
createIcons({ icons: { X }, attrs: { 'stroke-width': 2.25 } })

// Frame flash: the green frame flashes with the alerts, red if any stat is at warning, else amber.
const frameFlash = debug.querySelector('#frame-flash')
try { frameFlash.checked = localStorage.getItem('frameFlash') === '1' } catch {}
const setFrameFlash = (on) => { document.documentElement.toggleAttribute('data-frame-flash', on) }
setFrameFlash(frameFlash.checked)
frameFlash.addEventListener('change', () => {
  setFrameFlash(frameFlash.checked)
  try { localStorage.setItem('frameFlash', frameFlash.checked ? '1' : '0') } catch {}
})
function showWorstTone() {
  const tones = Object.values(STATS).map((s) => toneOf(s))
  document.documentElement.dataset.alert = tones.includes('crit') ? 'crit' : tones.includes('warn') ? 'warn' : 'ok'
}

const rowOfStat = (id) => debug.querySelector(`.dbg-row[data-id="${id}"]`)
function syncRow(id) {
  const s = STATS[id]
  const row = rowOfStat(id)
  const tone = toneOf(s)
  row.querySelector('.dbg-val').textContent = `${fmtStat(id)} ${s.unit}`.trim()
  const chip = row.querySelector('.dbg-tone')
  chip.textContent = TONE_TEXT[tone]
  chip.dataset.tone = tone
  if (s.vary) {
    row.querySelector('[data-which="lo"]').value = s.vary[0]
    row.querySelector('[data-which="hi"]').value = s.vary[1]
    row.querySelector('[data-lo]').textContent = fmtStat(id, s.vary[0])
    row.querySelector('[data-hi]').textContent = fmtStat(id, s.vary[1])
  } else if (document.activeElement?.dataset.id !== id) {
    row.querySelector('input').value = s.value
  }
}
function syncDebug() {
  for (const id of Object.keys(STATS)) syncRow(id)
}
for (const id of Object.keys(STATS)) bind(id, () => { if (!debug.hidden) syncRow(id) })

debug.addEventListener('input', (e) => {
  const el = e.target
  if (el.type !== 'range') return
  const id = el.dataset.id
  const v = Number(el.value)
  if (el.dataset.which === 'value') setStat(id, v)
  else {
    const [lo, hi] = STATS[id].vary
    // Low can't pass high and vice versa.
    if (el.dataset.which === 'lo') setRange(id, Math.min(v, hi), hi)
    else setRange(id, lo, Math.max(v, lo))
    syncRow(id)
  }
})
debug.addEventListener('click', (e) => {
  const preset = e.target.closest('[data-preset]')
  if (preset) applyPreset(preset.dataset.preset)
  if (e.target.closest('.dbg-close')) toggleDebug(false)
})
function toggleDebug(open = debug.hidden) {
  debug.hidden = !open
  document.getElementById('debug-toggle').setAttribute('aria-pressed', String(open))
  if (open) syncDebug()
}
document.getElementById('debug-toggle').addEventListener('click', () => toggleDebug())
window.addEventListener('keydown', (e) => {
  if (e.key === '`') toggleDebug()
  if (e.key === 'Escape' && !debug.hidden) toggleDebug(false)
})

// For the story page (story.html), which wears this dashboard on a wrist and changes its state as the
// reader scrolls from scene to scene.
window.vitalLink = { applyPreset, showView, setStat, setRange }

// ------------------------------------------------------------------ live loop

// Drifting stats pick a new point in their range every couple of seconds and ease toward it.
function drift(dt, t) {
  for (const s of Object.values(STATS)) {
    if (!s.vary) continue
    if (s.target == null || t > s.nextPick) {
      s.target = s.vary[0] + Math.random() * (s.vary[1] - s.vary[0])
      s.nextPick = t + 1.5 + Math.random() * 2
    }
    s.raw = (s.raw ?? s.value) + (s.target - (s.raw ?? s.value)) * (1 - Math.exp(-dt / 1.2))
  }
}
function showDrift() {
  for (const [id, s] of Object.entries(STATS)) {
    if (!s.vary) continue
    const v = Math.round(s.raw / s.step) * s.step
    if (Math.abs(v - s.value) > s.step / 2) setStat(id, v)
  }
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let last = performance.now()
let t = 0
let nextShow = 0
let nextClock = 0
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  t += dt
  // Advance the ECG and breathing phases at the current rates before drawing.
  beat.phase += ((t - beat.t) * STATS.hr.value) / 60
  beat.t = t
  breathing.phase += ((t - breathing.t) * STATS.resp.value) / 60
  breathing.t = t
  for (const p of live) p.tick(dt, t)
  drift(dt, t)
  if (t > nextShow) {
    showDrift()
    nextShow = t + 0.25
  }
  if (t > nextClock) {
    renderClocks(t)
    showWorstTone()
    showPetMood()
    nextClock = t + 0.5
  }
  if (!reduced) requestAnimationFrame(loop)
}
renderClocks(0)

startAlertBeat()
if (reduced) setInterval(() => loop(performance.now()), 250)
else requestAnimationFrame(loop)
