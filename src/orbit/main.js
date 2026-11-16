import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/800.css'
import '../displays/displays.css'
import '../dashboard/dashboard.css'
import './orbit.css'
import './history.css'
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
import { createSquid } from '../dashboard/squid.js'
import { h, walk, MISSION, WATER_GOAL } from './util.js'
import { historyView } from './history.js'

// ORBIT v2: the companion dashboard with the team's Figma ideas folded in. Three views cycled with the
// arrows under the stage:
//   Overview   — the companion squid in its bowl, the core dials and a scrolling column of everything else
//   Spacewalk  — only the stats that matter outside, drawn larger
//   Health log — every tracked stat as a chart, with a range toggle and a hydration chart (history.js)
// The tasks panel stays on the right throughout, with quick logging under it.
// New over the original dashboard: every number says whether it is LIVE (wearable or station sensor) or
// LOGGED (entered by hand, with when), most carry one line of context against a goal or baseline, and
// the status bar names the mission and shows the last wearable sync.

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

// Station time runs from a fixed start so the demo always opens at the same moment. Minutes count from
// 00:00 today; negative minutes are earlier days.
const GMT_START = 11 * 3600 + 42 * 60 + 10
let clockT = 0
const stationMinutes = () => (GMT_START + clockT) / 60
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.floor(m) % 60)}`

// ------------------------------------------------------------------ where each number comes from

// Live stats stream from the wearable or station sensors. Logged ones are entered by hand or come from
// an assessment, and say when: a time today, "yesterday", or the mission day.
const LOGGED_AT = {
  sleep: 7 * 60 + 5,
  water: 11 * 60 + 30,
  kcal: 8 * 60 + 40,
  mood: -14 * 60,
  cycleDay: 6 * 60 + 30,
  bodyMass: -2 * 1440 + 9 * 60,
  vision: -7 * 1440 + 10 * 60,
  reaction: -1440 + 16 * 60,
  vo2: -14 * 1440 + 9 * 60,
}
for (const [id, s] of Object.entries(STATS)) {
  s.source = id in LOGGED_AT ? 'logged' : 'live'
  s.loggedAt = LOGGED_AT[id]
}
function whenText(m) {
  if (m >= 0) return hhmm(m)
  if (m >= -1440) return 'yesterday'
  return `D${String(MISSION.day + Math.floor(m / 1440)).padStart(3, '0')}`
}
const provText = (id) => (STATS[id].source === 'live' ? 'Live' : `Logged · ${whenText(STATS[id].loggedAt)}`)
const provEls = {}
function provTag(id) {
  const el = h(`<span class="prov ${STATS[id].source}">${provText(id)}</span>`)
  ;(provEls[id] ||= []).push(el)
  return el
}

// One line of context per stat, against a goal or a baseline.
const PREFLIGHT = { bodyMass: 73, vo2: 43, reaction: 255 }
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`
const CONTEXT = {
  water: (v) => (v >= WATER_GOAL ? 'Daily goal met' : `${(WATER_GOAL - v).toFixed(1)} L to daily goal`),
  kcal: (v) => `${Math.round((v / 2800) * 100)}% of daily energy goal`,
  exercise: (v) => (v >= 2.5 ? 'Daily goal met' : `${Math.round((2.5 - v) * 60)} min to daily goal`),
  sleep: (v) => (v >= 8 ? '8 h goal met' : `${(8 - v).toFixed(1)} h short of 8 h`),
  mood: (v) => `${['', 'Very low', 'Low', 'Okay', 'Good', 'Great'][Math.round(v)]} · self-reported`,
  bodyMass: (v) => `${signed(v - PREFLIGHT.bodyMass)} kg from preflight`,
  vo2: (v) => `${signed(v - PREFLIGHT.vo2)} from preflight`,
  reaction: (v) => `${signed(v - PREFLIGHT.reaction, 0)} ms vs your baseline`,
  vision: (v) => (v > -0.26 ? 'Within normal shift' : 'Check with flight surgeon'),
  glucose: (v) => (v < 70 ? 'Below range' : v > 140 ? 'Above range' : 'In range'),
  co2: (v) => (v <= 3 ? 'Under 3 mmHg goal' : `${(v - 3).toFixed(1)} mmHg over goal`),
  radiation: (v) => `${Math.max(0, 600 - v)} mSv to career limit`,
  noise: (v) => (v <= 60 ? 'Quiet enough to sleep' : 'Ear protection advised'),
  spo2: (v) => (v >= 95 ? 'Normal' : 'Low · breathe deeply, recheck'),
  coreTemp: (v) => (v > 37.4 ? 'Running warm' : v < 35.9 ? 'Running cold' : 'Normal'),
}

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
// A hand-entered value: sets the stat and stamps when it was logged (a past entry never moves the stamp back).
function logStat(id, v, at = stationMinutes()) {
  const s = STATS[id]
  s.loggedAt = Math.max(s.loggedAt ?? -Infinity, at)
  setStat(id, v)
  for (const el of provEls[id] ?? []) el.textContent = provText(id)
}
function ctxTag(id) {
  const el = h('<span class="ctx"></span>')
  bind(id, (v) => { el.textContent = CONTEXT[id](v) })
  return el
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

const live = []
function heartRate() {
  const ro = readout('hr')
  const tr = Trace({ mode: 'live', gen: ecg, min: -0.35, max: 1.05, samples: 240, rate: 80, height: 64, solid: true })
  live.push(tr)
  return widget({ icon: 'heart-pulse', accent: 'pulse', parts: [ro, tr] })
}
const tempTuner = () => meter('coreTemp', { min: 35, max: 39.5, tuner: { major: 1, minor: 1 }, target: [36.1, 37.2], label: 'Core', scale: ['35', '37', '39.5'] })

// A widget with a small caption above it, for the scrolling column and the spacewalk view.
// With a stat id, the caption also says where the number comes from, and a context line goes underneath.
const item = (title, el, id) => {
  const wrap = h(`<div class="item"><div class="item-head"><span class="item-title">${title}</span></div></div>`)
  if (id) wrap.firstElementChild.append(provTag(id))
  wrap.append(el)
  if (id && CONTEXT[id]) wrap.append(ctxTag(id))
  return wrap
}


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
// A dial beside the circle, with its context and source underneath.
function dialCell(id, icon, accent, o) {
  const cell = h('<div class="dial-cell"><div class="dial-meta"></div></div>')
  cell.prepend(dialTile(id, icon, accent, o))
  cell.lastElementChild.append(ctxTag(id), provTag(id))
  return cell
}

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
function showPetMood() {
  const issues = Object.entries(STATS)
    .map(([id, s]) => ({ id, tone: toneOf(s) }))
    .filter((x) => x.tone !== 'ok')
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'crit' ? -1 : 1))
  const score = issues.reduce((n, x) => n + (x.tone === 'crit' ? 3 : 1), 0)
  const name = score === 0 ? 'happy' : score <= 2 ? 'okay' : score <= 5 ? 'low' : 'bad'
  const worst = issues[0]?.id
  pet.setMood(name, worst ? hintFor(worst) : 'Feeling great!', Math.max(0, issues.length - 1), worst && CONTEXT[worst] ? CONTEXT[worst](STATS[worst].value) : '')
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
    dialCell('sleep', 'moon', 'neural', { mode: 'ring', rings: [{ value: STATS.sleep.value, max: 8, label: 'Slept' }], sub: 'Goal 8 h' }),
    dialCell('exercise', 'dumbbell', 'phosphor', { mode: 'ring', rings: [{ value: STATS.exercise.value, max: 2.5 }], sub: 'Goal 2.5 h' }),
    dialCell('water', 'glass-water', 'oxygen', { mode: 'ring', rings: [{ value: STATS.water.value, max: WATER_GOAL }], center: (v) => v.toFixed(1), sub: `Goal ${WATER_GOAL} L` }),
    dialCell('kcal', 'utensils', 'thermal', { mode: 'ring', rings: [{ value: STATS.kcal.value, max: 2800, label: 'kcal' }, { value: 96, max: 120, label: 'Protein' }, { value: 1.4, max: 1.8, label: 'Ca²⁺' }], center: (v) => `${Math.round((v / 2800) * 100)}%` }),
  )
  const tileRow = (...tiles) => {
    const row = h('<div class="tile-row"></div>')
    row.append(...tiles)
    return row
  }

  // Top bar: the core vitals, spread across the full width.
  el.querySelector('.topbar').append(
    item('Heart rate', heartRate(), 'hr'),
    item('SpO₂', widget({ icon: 'droplets', accent: 'oxygen', parts: [meter('spo2', { min: 85, unit: '', markers: [{ at: 90, label: '90' }, { at: 94, label: '94' }], scale: ['85', '100'] })] }), 'spo2'),
    item('Core temp', widget({ icon: 'thermometer', accent: 'thermal', parts: [tempTuner()] }), 'coreTemp'),
  )

  // Bottom bar: the cabin exposures that matter over a mission, not a minute.
  el.querySelector('.bottombar').append(
    item('Cabin CO₂', widget({ icon: 'cloud', accent: 'phosphor', parts: [meter('co2', { max: 8, markers: [{ at: 3, label: 'Goal' }, { at: 5.3, label: 'Limit' }], scale: ['0', '8'] })] }), 'co2'),
    item('Career dose', widget({ icon: 'radiation', accent: 'rad', parts: [meter('radiation', { max: 600, markers: [{ at: 600, label: '' }], scale: ['0', '600 limit'] })] }), 'radiation'),
    item('Noise', widget({ icon: 'volume-2', accent: 'phosphor', parts: [meter('noise', { max: 90, segments: 12, scale: ['30', '60', '90'] })] }), 'noise'),
  )

  const resp = Trace({ mode: 'live', gen: breath, min: -1, max: 1, samples: 200, rate: 40 })
  live.push(resp)
  const SECTIONS = [
    ['Body', 'heart-pulse', [
      item('Blood pressure', widget({ icon: 'activity', accent: 'pulse', parts: [bloodPressure()] }), 'bpSys'),
      item('Mood', widget({ icon: 'smile', accent: 'neural', parts: [meter('mood', { min: 0, segments: 5, label: 'Self-rated', valueText: (v) => `${v} / 5`, scale: ['Low', 'High'] })] }), 'mood'),
      item('Cycle', tileRow(dialTile('cycleDay', 'calendar', 'flux', {
      mode: 'segments', min: 0, max: 28,
      segments: [{ from: 0, to: 5, ink: 0.9, label: 'Menstrual' }, { from: 5, to: 13, ink: 0.35, label: 'Follicular' }, { from: 13, to: 16, ink: 0.65, label: 'Ovulation' }, { from: 16, to: 28, ink: 0.15, label: 'Luteal' }],
      sub: 'Day',
    }))),
      item('Respiration', widget({ icon: 'wind', accent: 'oxygen', parts: [readout('resp'), resp] }), 'resp'),
      item('Glucose · 4 h', widget({ icon: 'droplet', accent: 'signal', parts: [readout('glucose', { trend: 'up' }), Trace({ mode: 'line', data: walk(48, 92, 9, 7, 75, 125), min: 50, max: 180, band: [70, 140] })] }), 'glucose'),
      item('Body mass · 6 mo', widget({ icon: 'scale', accent: 'signal', parts: [readout('bodyMass', { trend: 'down' }), Trace({ mode: 'line', data: walk(24, 74, 0.6, 3, 71, 74.5).map((v, i) => v - i * 0.08), min: 69, max: 76 })] }), 'bodyMass'),
      item('Vision vs preflight', widget({ icon: 'eye', accent: 'signal', parts: [meter('vision', { target: [-0.25, 0.25], scale: ['−1.5', '+0.5'] })] }), 'vision'),
      item('Reaction time', widget({ icon: 'brain', accent: 'neural', parts: [meter('reaction', { max: 360, target: [235, 275], scale: ['180', '360'] })] }), 'reaction'),
      item('VO₂ max', widget({ icon: 'heart-pulse', accent: 'phosphor', parts: [meter('vo2', { target: [41, 46], scale: ['25', '55'] })] }), 'vo2'),
    ]],
    ['Cabin', 'gauge', [
      item('Air particulate', widget({ icon: 'cloud-fog', accent: 'phosphor', parts: [meter('pm25', { segments: 6, scale: ['Good', 'Hazard'] })] }), 'pm25'),
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
    item('Time remaining', widget({ icon: 'timer', accent: 'oxygen', parts: [meter('evaTime', { markers: [{ at: 1, label: 'Walk-back' }], scale: ['0', '8'] })] }), 'evaTime'),
    item('Suit O₂', widget({ icon: 'wind', accent: 'oxygen', parts: [meter('suitO2', { markers: [{ at: 25, label: 'Return' }, { at: 40, label: 'Low' }] })] }), 'suitO2'),
    item('Helmet CO₂', widget({ icon: 'cloud', accent: 'phosphor', parts: [meter('helmetCo2', { max: 8, markers: [{ at: 5.3, label: 'Limit' }], scale: ['0', '8'] })] }), 'helmetCo2'),
    item('Core temp', widget({ icon: 'thermometer', accent: 'thermal', parts: [tempTuner()] }), 'coreTemp'),
    item('Heart rate', heartRate(), 'hr'),
    item('Metabolic rate', widget({ icon: 'activity', accent: 'pulse', parts: [readout('metabolic'), Trace({ mode: 'line', data: walk(40, 900, 120, 11, 700, 1300), min: 500, max: 1600 })] }), 'metabolic'),
  )
  return el
}

// ------------------------------------------------------------------ views

const VIEWS = [
  { name: 'Overview', el: mainView() },
  { name: 'Spacewalk', el: spacewalkView() },
  { name: 'Health log', el: historyView({ waterToday: () => STATS.water.value }) },
]
const host = document.getElementById('view-host')
let view = 0
function showView(i) {
  view = (i + VIEWS.length) % VIEWS.length
  host.replaceChildren(VIEWS[view].el)
  VIEWS[view].el.refresh?.()
  document.getElementById('view-now').textContent = VIEWS[view].name
}
document.getElementById('prev').addEventListener('click', () => showView(view - 1))
document.getElementById('next').addEventListener('click', () => showView(view + 1))

// ------------------------------------------------------------------ tasks

// Each task has a due time (station time, minutes after 00:00 GMT). Drinking repeats every two hours.
const TASKS = [
  { id: 'sleep', icon: 'moon', accent: 'signal', text: 'Log sleep', detail: 'Last night', due: 7 * 60 },
  { id: 'mood', icon: 'smile', accent: 'neural', text: 'Rate your mood', detail: 'Daily check-in', due: 9 * 60 },
  { id: 'drink', icon: 'glass-water', accent: 'oxygen', text: 'Drink water', detail: '250 mL', due: 12 * 60, repeat: 120 },
  { id: 'ared', icon: 'dumbbell', accent: 'phosphor', text: 'ARED session', detail: '45 min', due: 13 * 60 + 15 },
  { id: 'sample', icon: 'test-tubes', accent: 'neural', text: 'Freeze BLD-14', detail: 'Blood sample', due: 15 * 60 + 30 },
]

const span = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${pad(Math.floor(m % 60))} m` : `${Math.max(1, Math.floor(m))} m`)

const list = document.getElementById('task-list')
list.innerHTML = TASKS.map((t) => `<li class="task" data-id="${t.id}" style="--accent: var(--${t.accent})">
  <span class="t-tab"><i data-lucide="${t.icon}"></i></span>
  <div class="t-body">
    <span class="t-time">${hhmm(t.due)}</span>
    <span class="t-text">${t.text}</span>
    <span class="t-detail">${t.detail}</span>
    <span class="t-when"></span>
    <button type="button" aria-label="${t.repeat ? 'Log' : 'Done'}: ${t.text}">
      <i data-lucide="${t.repeat ? 'plus' : 'check'}"></i>
    </button>
  </div>
</li>`).join('')
const rowOf = (t) => list.querySelector(`[data-id="${t.id}"]`)

list.addEventListener('click', (e) => {
  const row = e.target.closest('button') && e.target.closest('.task')
  if (!row) return
  const t = TASKS.find((x) => x.id === row.dataset.id)
  if (t.id === 'drink') return drink(0.25)
  if (t.done) return
  t.done = true
  row.classList.add('done')
  if (t.id === 'mood') logStat('mood', 5)
  if (t.id === 'sleep') logStat('sleep', STATS.sleep.value)
  renderTasks()
})

// Logging a drink adds to today's water and pushes the next drink reminder two hours out.
function drink(litres, at = stationMinutes()) {
  logStat('water', STATS.water.value + litres, at)
  const t = TASKS.find((x) => x.id === 'drink')
  t.due = stationMinutes() + t.repeat
  rowOf(t).querySelector('.t-time').textContent = hhmm(t.due)
  renderTasks()
}

// ------------------------------------------------------------------ quick logging

// Log water and Log meal add a standard serving now. Add health log (and Add past entry, which opens it
// with the time ready to change) takes any of the hand-logged stats, today or yesterday, at any time.
// Yesterday's entries are kept for the record but don't change today's totals.
const LOGGABLE = {
  water: { label: 'Water', unit: 'L', step: 0.05, value: 0.25, add: true },
  kcal: { label: 'Meal', unit: 'kcal', step: 10, value: 600, add: true },
  mood: { label: 'Mood', unit: '/ 5', step: 1, value: 4, min: 1, max: 5 },
  sleep: { label: 'Sleep', unit: 'h', step: 0.1, value: 7 },
  bodyMass: { label: 'Body mass', unit: 'kg', step: 0.1, value: STATS.bodyMass.value },
}
const tasksEl = document.querySelector('.tasks')
const logDone = document.getElementById('log-done')
let doneTimer = 0
function confirmLog(text) {
  logDone.textContent = text
  logDone.hidden = false
  clearTimeout(doneTimer)
  doneTimer = setTimeout(() => { logDone.hidden = true }, 5000)
}
function saveLog(id, amount, at) {
  const l = LOGGABLE[id]
  const shown = `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${l.unit}`
  if (at < 0) return confirmLog(`Saved ${l.label.toLowerCase()} ${shown} to yesterday`)
  if (id === 'water') drink(amount, at)
  else logStat(id, l.add ? STATS[id].value + amount : amount, at)
  confirmLog(`Logged ${l.label.toLowerCase()} ${shown} · ${hhmm(at)}`)
}
tasksEl.querySelector('.quick-log').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quick]')
  if (b) saveLog(b.dataset.quick, LOGGABLE[b.dataset.quick].value, stationMinutes())
})

const sheet = h(`<form class="log-sheet" hidden aria-label="Add health log">
  <header><h2 class="sec-head">Add health log</h2><button type="button" class="dbg-close" data-close aria-label="Close"><i data-lucide="x"></i></button></header>
  <fieldset class="log-what"><legend>What</legend>
    ${Object.entries(LOGGABLE).map(([id, l], i) => `<label><input type="radio" name="what" value="${id}"${i ? '' : ' checked'}><span>${l.label}</span></label>`).join('')}
  </fieldset>
  <label class="log-field"><span>Amount</span><span class="log-amount"><input type="number" name="amount" inputmode="decimal"><b class="log-unit"></b></span></label>
  <div class="log-field"><span>When</span><span class="log-when">
    <select name="day" aria-label="Day"><option value="0">Today</option><option value="-1">Yesterday</option></select>
    <input type="time" name="time" aria-label="Time">
  </span></div>
  <div class="log-actions"><button type="button" class="log-cancel" data-close>Cancel</button><button type="submit" class="log-primary">Save</button></div>
</form>`)
tasksEl.append(sheet)
const amountIn = sheet.elements.amount
function pickWhat(id) {
  const l = LOGGABLE[id]
  amountIn.step = l.step
  amountIn.min = l.min ?? 0
  if (l.max) amountIn.max = l.max
  else amountIn.removeAttribute('max')
  amountIn.value = id === 'bodyMass' ? STATS.bodyMass.value : l.value
  sheet.querySelector('.log-unit').textContent = l.unit
}
function openSheet(past = false) {
  sheet.hidden = false
  sheet.elements.day.value = '0'
  sheet.elements.time.value = hhmm(stationMinutes())
  pickWhat(sheet.elements.what.value)
  ;(past ? sheet.elements.time : amountIn).focus()
}
sheet.addEventListener('change', (e) => { if (e.target.name === 'what') pickWhat(e.target.value) })
sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) sheet.hidden = true })
sheet.addEventListener('submit', (e) => {
  e.preventDefault()
  const amount = Number(amountIn.value)
  if (!Number.isFinite(amount) || amount <= 0) return amountIn.focus()
  const [hh, mm] = sheet.elements.time.value.split(':').map(Number)
  saveLog(sheet.elements.what.value, amount, Number(sheet.elements.day.value) * 1440 + hh * 60 + mm)
  sheet.hidden = true
})
document.getElementById('add-log').addEventListener('click', () => openSheet())
document.getElementById('past-entry').addEventListener('click', () => openSheet(true))

// ------------------------------------------------------------------ station clock

// Station time runs from a fixed start so the demo always opens at the same moment.
const EVA_START = 2 * 3600 + 14 * 60 + 8
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
const gmtEl = document.getElementById('gmt')
const gmtSEl = document.getElementById('gmt-s')
const metEl = document.getElementById('met')
const syncEl = document.getElementById('sync-time')
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
  metEl.innerHTML = `Mission day <b>${String(MISSION.day).padStart(3, '0')}</b> of ${MISSION.days}`
  syncEl.textContent = hhmm(Math.floor(g / 60))
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
  <p class="dbg-links"><a href="/">Original dashboard (v1)</a> · <a href="/displays.html">Display Kit</a></p>
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
