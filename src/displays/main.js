import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/800.css'
import './displays.css'
import {
  createIcons,
  Activity,
  ArrowDownToLine,
  Brain,
  Calendar,
  ChartSpline,
  CircleDot,
  CircleGauge,
  ClipboardList,
  Cloud,
  CloudFog,
  Droplet,
  Droplets,
  Dumbbell,
  Eye,
  FlaskConical,
  Gauge,
  GlassWater,
  Hash,
  HeartPulse,
  List,
  Microscope,
  Moon,
  MoveDownRight,
  MoveRight,
  MoveUpRight,
  Orbit,
  Pill,
  Radiation,
  RectangleHorizontal,
  Rocket,
  Scale,
  Smile,
  Sun,
  TestTubes,
  Thermometer,
  ThermometerSun,
  TriangleAlert,
  Timer,
  Utensils,
  Volume2,
  Wind,
} from 'lucide'
import { card, usage, Readout, Meter, Radial, Trace, Log } from './components.js'

// ------------------------------------------------------------------ sample signals

const gauss = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s))
let bpm = 72
function ecg(t) {
  const p = ((((t * bpm) / 60) % 1) + 1) % 1
  return 0.12 * gauss(p, 0.1, 0.025) - 0.1 * gauss(p, 0.2, 0.008) + gauss(p, 0.225, 0.01) - 0.25 * gauss(p, 0.25, 0.01) + 0.3 * gauss(p, 0.45, 0.04)
}
const breath = (t) => Math.sin((t * 14 * 2 * Math.PI) / 60) * 0.8 + Math.sin(t * 0.37) * 0.1

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

// ------------------------------------------------------------------ cards

const live = []
const liveHr = Readout({ value: 72, unit: 'bpm', zones: [{ max: 100, tone: 'ok' }, { max: 140, tone: 'warn' }, { max: Infinity, tone: 'crit' }] })
const ecgTrace = Trace({ mode: 'live', gen: ecg, min: -0.35, max: 1.05, samples: 240, rate: 80, height: 64, solid: true })
const respTrace = Trace({ mode: 'live', gen: breath, min: -1, max: 1, samples: 200, rate: 40 })
live.push(ecgTrace, respTrace)

const internal = [
  card({ title: 'Heart rate', icon: 'heart-pulse', accent: 'pulse', parts: [liveHr, ecgTrace] }),
  card({
    title: 'Blood pressure', icon: 'activity', accent: 'pulse',
    parts: [Meter({ min: 40, max: 180, range: [76, 118], unit: 'mmHg', label: 'Sys / dia', target: [60, 120], zones: [{ max: 129, tone: 'ok' }, { max: 139, tone: 'warn' }, { max: Infinity, tone: 'crit' }], scale: ['40', '120', '180'] })],
    note: 'Bright edge = normal range. The bar spans diastolic to systolic.',
  }),
  card({
    title: 'SpO₂', icon: 'droplets', accent: 'oxygen',
    parts: [
      Readout({ value: 97, unit: '%', zones: [{ max: 89, tone: 'crit' }, { max: 93, tone: 'warn' }, { max: Infinity, tone: 'ok' }] }),
      Meter({ min: 85, max: 100, value: 97, label: 'Scale 85–100', zones: [{ max: 89, tone: 'crit' }, { max: 93, tone: 'warn' }, { max: Infinity, tone: 'ok' }], markers: [{ at: 90, label: '90' }, { at: 94, label: '94' }], scale: ['85', '100'] }),
    ],
  }),
  card({
    title: 'Body temp', icon: 'thermometer', accent: 'thermal',
    parts: [Meter({ min: 35, max: 39.5, value: 36.8, tuner: { major: 1, minor: 1 }, target: [36.1, 37.2], digits: 1, unit: '°C', label: 'Core', scale: ['35', '37', '39.5'], zones: [{ max: 35.9, tone: 'warn' }, { max: 37.4, tone: 'ok' }, { max: Infinity, tone: 'warn' }] })],
    note: 'Bright edge = normal range (36.1–37.2 °C).',
  }),
  card({
    title: 'Blood glucose', icon: 'droplet', accent: 'signal',
    parts: [
      Readout({ value: 104, unit: 'mg/dL', trend: 'up' }),
      Trace({ mode: 'line', data: walk(48, 92, 9, 7, 75, 125), min: 50, max: 180, band: [70, 140] }),
    ],
    note: 'Shaded band = target range (70–140). Last 4 h.',
  }),
  card({ title: 'Respiratory rate', icon: 'wind', accent: 'oxygen', parts: [Readout({ value: 14, unit: '/min' }), respTrace] }),
  card({
    title: 'Sleep', icon: 'moon', accent: 'neural',
    parts: [
      Radial({ mode: 'ring', rings: [{ value: 6.4, max: 8, label: 'Slept' }], center: '6.4', sub: 'Goal 8 h' }),
      Trace({ mode: 'step', data: [3, 2, 1, 0, 0, 1, 2, 1, 0, 1, 2, 2, 1, 0, 1, 2, 3, 2, 1, 2, 2, 3], min: -0.3, max: 3.3, yLabels: ['Wake', 'REM', 'Light', 'Deep'] }),
    ],
  }),
  card({
    title: 'Mood', icon: 'smile', accent: 'neural',
    parts: [
      Meter({ min: 0, max: 5, value: 4, segments: 5, label: 'Self-rated', valueText: '4 / 5', scale: ['Low', 'High'] }),
      Trace({ mode: 'line', data: [3, 3, 4, 2, 3, 4, 4], min: 0.5, max: 5.5 }),
    ],
    note: 'Last 7 days.',
  }),
]

const external = [
  card({
    title: 'Cabin pressure', icon: 'gauge', accent: 'signal',
    parts: [Radial({ min: 95, max: 106, value: 101.3, band: [99, 103], ticks: [{ at: 95, label: '95' }, { at: 101.3, label: '' }, { at: 106, label: '106' }], center: '101.3', sub: 'kPa', zones: [{ max: 98.9, tone: 'warn' }, { max: 103, tone: 'ok' }, { max: Infinity, tone: 'warn' }] })],
  }),
  card({
    title: 'CO₂', icon: 'cloud', accent: 'phosphor',
    parts: [Meter({ min: 0, max: 8, value: 2.6, unit: 'mmHg', digits: 1, label: 'Partial pressure', zones: [{ max: 3, tone: 'ok' }, { max: 5.3, tone: 'warn' }, { max: Infinity, tone: 'crit' }], markers: [{ at: 3, label: 'Goal' }, { at: 5.3, label: 'Limit' }], scale: ['0', '8'] })],
    note: 'Lower is always better. Markers show the limits.',
  }),
  card({
    title: 'O₂ (cabin)', icon: 'circle-gauge', accent: 'oxygen',
    parts: [Radial({ min: 15, max: 28, value: 21.2, band: [19.5, 23.1], ticks: [{ at: 15, label: '15' }, { at: 28, label: '28' }], center: '21.2', sub: 'kPa O₂', zones: [{ max: 19.4, tone: 'crit' }, { max: 23.1, tone: 'ok' }, { max: Infinity, tone: 'warn' }] })],
  }),
  card({
    title: 'Radiation dose', icon: 'radiation', accent: 'rad',
    parts: [
      Readout({ value: 0.62, digits: 2, unit: 'mSv/day', size: 'md' }),
      Meter({ min: 0, max: 600, value: 182, unit: 'mSv', label: 'Career total', markers: [{ at: 600, label: '' }], scale: ['0', '600 limit'] }),
    ],
  }),
  card({
    title: 'Gravity', icon: 'arrow-down-to-line', accent: 'signal',
    parts: [Radial({ min: 0, max: 1.2, value: 0.38, ticks: [{ at: 0, label: '0' }, { at: 0.17, label: 'Moon' }, { at: 0.38, label: 'Mars' }, { at: 1, label: 'Earth' }], center: '0.38', sub: 'g' })],
  }),
  card({
    title: 'Light exposure', icon: 'sun', accent: 'rad',
    parts: [Radial({
      mode: 'segments', min: 0, max: 24, value: 14.5,
      segments: [{ from: 0, to: 6.5, ink: 0.9, label: 'Dark' }, { from: 6.5, to: 8, ink: 0.5 }, { from: 8, to: 12.5, ink: 0.08, label: 'Bright' }, { from: 12.5, to: 18, ink: 0.25 }, { from: 18, to: 22, ink: 0.55, label: 'Dim / warm' }, { from: 22, to: 24, ink: 0.9 }],
      ticks: [{ at: 0, label: '00' }, { at: 6, label: '06' }, { at: 12, label: '12' }, { at: 18, label: '18' }],
      center: '1,840', sub: 'lux',
    })],
    note: '24-hour clock. The lighter the arc, the brighter the light.',
  }),
  card({
    title: 'Noise', icon: 'volume-2', accent: 'phosphor',
    parts: [Meter({ min: 30, max: 90, value: 62, segments: 12, unit: 'dBA', label: 'Cabin level', zones: [{ max: 60, tone: 'ok' }, { max: 72, tone: 'warn' }, { max: Infinity, tone: 'crit' }], scale: ['30', '60', '90'] })],
  }),
  card({
    title: 'Space weather', icon: 'orbit', accent: 'flux',
    parts: [
      Meter({ min: 0, max: 5, value: 2, segments: 5, tabText: 'G', label: 'Geomagnetic', valueText: 'G2', zones: [{ max: 2, tone: 'ok' }, { max: 3, tone: 'warn' }, { max: 5, tone: 'crit' }] }),
      Meter({ min: 0, max: 5, value: 1, segments: 5, tabText: 'S', label: 'Solar radiation', valueText: 'S1', zones: [{ max: 2, tone: 'ok' }, { max: 3, tone: 'warn' }, { max: 5, tone: 'crit' }] }),
      Meter({ min: 0, max: 5, value: 0, segments: 5, tabText: 'R', label: 'Radio blackout', valueText: 'R0', zones: [{ max: 2, tone: 'ok' }, { max: 3, tone: 'warn' }, { max: 5, tone: 'crit' }] }),
    ],
    note: 'NOAA scales, 1–5.',
  }),
  card({
    title: 'Air particulate', icon: 'cloud-fog', accent: 'phosphor',
    parts: [Meter({ min: 0, max: 6, value: 1, segments: 6, label: 'PM2.5', valueText: '8 µg/m³ · Good', zones: [{ max: 2, tone: 'ok' }, { max: 4, tone: 'warn' }, { max: 6, tone: 'crit' }], scale: ['Good', 'Hazard'] })],
  }),
  card({
    title: 'Cabin temp & humidity', icon: 'thermometer-sun', accent: 'thermal',
    parts: [Trace({ mode: 'xy', x: 22.4, y: 46, xr: [16, 30], yr: [10, 90], zone: { x: [18.3, 26.7], y: [25, 70] }, xLabel: 'Temp °C', yLabel: 'RH %' })],
    note: '22.4 °C · 46 % RH, inside the comfort box.',
  }),
  card({
    title: 'EVA', icon: 'rocket', accent: 'oxygen', span: 2,
    parts: [
      Radial({ min: 26, max: 33, value: 29.6, band: [28.6, 30.6], ticks: [{ at: 26, label: '26' }, { at: 33, label: '33' }], center: '29.6', sub: 'Suit kPa' }),
      Meter({ min: 0, max: 100, value: 64, unit: '%', icon: 'wind', label: 'Suit O₂', zones: [{ max: 25, tone: 'crit' }, { max: 40, tone: 'warn' }, { max: Infinity, tone: 'ok' }], markers: [{ at: 25, label: 'Return' }] }),
      Meter({ min: 0, max: 8, value: 3.1, digits: 1, unit: 'h left', icon: 'timer', label: 'EVA time remaining', markers: [{ at: 1, label: 'Walk-back' }] }),
      Meter({ min: 0, max: 8, value: 1.9, unit: 'mmHg', digits: 1, icon: 'cloud', label: 'Helmet CO₂', zones: [{ max: 3, tone: 'ok' }, { max: 5.3, tone: 'warn' }, { max: Infinity, tone: 'crit' }], markers: [{ at: 5.3, label: 'Limit' }] }),
    ],
  }),
]

const user = [
  card({
    title: 'Body mass', icon: 'scale', accent: 'signal',
    parts: [Readout({ value: 71.8, digits: 1, unit: 'kg', trend: 'down' }), Trace({ mode: 'line', data: walk(24, 74, 0.6, 3, 71, 74.5).map((v, i) => v - i * 0.08), min: 69, max: 76 })],
    note: 'Weekly, last 6 months.',
  }),
  card({
    title: 'Hydration', icon: 'glass-water', accent: 'oxygen',
    parts: [Radial({ mode: 'ring', rings: [{ value: 1.9, max: 2.5 }], center: '1.9', sub: 'Goal 2.5 L' })],
  }),
  card({
    title: 'Nutrition', icon: 'utensils', accent: 'thermal',
    parts: [Radial({ mode: 'ring', rings: [{ value: 2150, max: 2800, label: 'kcal' }, { value: 96, max: 120, label: 'Protein' }, { value: 1.4, max: 1.8, label: 'Ca²⁺' }], center: '77%' })],
  }),
  card({
    title: 'Activity & exercise', icon: 'dumbbell', accent: 'phosphor',
    parts: [
      Radial({ mode: 'ring', rings: [{ value: 1.6, max: 2.5 }], center: '1.6', sub: 'Goal 2.5 h' }),
      Meter({ label: 'Split', stack: [{ label: 'Resistance', value: 55, accent: 'phosphor' }, { label: 'Cardio', value: 45, accent: 'oxygen' }] }),
    ],
  }),
  card({
    title: 'Symptoms', icon: 'clipboard-list', accent: 'pulse',
    parts: [Log({ items: [
      { time: '07:10', text: 'Headache, mild', chip: { label: 'CO₂?', tone: 'warn' } },
      { time: '09:45', text: 'Nasal congestion', chip: { label: 'Fluid shift', tone: 'info' } },
      { time: '13:20', text: 'Lower back ache', chip: { label: 'Mild', tone: 'ok' } },
    ] })],
  }),
  card({
    title: 'Vision check', icon: 'eye', accent: 'signal',
    parts: [Readout({ value: '−0.50', unit: 'D', sub: 'Near-focus shift', size: 'md' }), Meter({ min: -1.5, max: 0.5, value: -0.5, digits: 2, unit: 'D', label: 'Vs preflight', target: [-0.25, 0.25], zones: [{ max: -0.76, tone: 'crit' }, { max: -0.26, tone: 'warn' }, { max: Infinity, tone: 'ok' }], scale: ['−1.5', '+0.5'] })],
    note: 'Bright edge = preflight baseline.',
  }),
  card({
    title: 'Cognition & reaction', icon: 'brain', accent: 'neural',
    parts: [
      Meter({ min: 180, max: 360, value: 268, unit: 'ms', icon: 'timer', label: 'Reaction time', target: [235, 275], scale: ['180', '360'] }),
      Meter({ min: 0, max: 100, value: 84, unit: 'pts', icon: 'brain', label: 'Working memory', target: [78, 92] }),
    ],
    note: 'Bright edge = your baseline.',
  }),
  card({
    title: 'Cycle tracking', icon: 'calendar', accent: 'flux',
    parts: [Radial({
      mode: 'segments', min: 0, max: 28, value: 12,
      segments: [{ from: 0, to: 5, ink: 0.9, label: 'Menstrual' }, { from: 5, to: 13, ink: 0.35, label: 'Follicular' }, { from: 13, to: 16, ink: 0.65, label: 'Ovulation' }, { from: 16, to: 28, ink: 0.15, label: 'Luteal' }],
      ticks: [{ at: 0, label: '1' }, { at: 7, label: '8' }, { at: 14, label: '15' }, { at: 21, label: '22' }],
      center: '12', sub: 'Day',
    })],
  }),
  card({
    title: 'Gut biome', icon: 'microscope', accent: 'phosphor',
    parts: [
      Readout({ value: 3.8, digits: 1, sub: 'Shannon diversity index', size: 'md' }),
      Meter({ label: 'Composition', stack: [{ label: 'Firmicutes', value: 48, accent: 'phosphor' }, { label: 'Bacteroidetes', value: 34, accent: 'oxygen' }, { label: 'Actino.', value: 10, accent: 'rad' }, { label: 'Other', value: 8, accent: 'overlay' }] }),
    ],
  }),
  card({
    title: 'Medication', icon: 'pill', accent: 'signal',
    parts: [Log({ items: [
      { time: '06:30', text: 'Vitamin D 1000 IU', chip: { label: 'Taken', tone: 'ok' } },
      { time: '21:30', text: 'Melatonin 3 mg', chip: { label: 'Due', tone: 'info' } },
      { time: 'Yest.', text: 'Antihistamine', chip: { label: 'Missed', tone: 'crit' } },
    ] })],
  }),
  card({
    title: 'Urine log', icon: 'flask-conical', accent: 'rad',
    parts: [Log({ items: [
      { time: '06:15', text: 'Void · 420 mL', swatch: '#E8C547', chip: { label: 'Drink', tone: 'warn' } },
      { time: '10:40', text: 'Void · 310 mL', swatch: '#F2E39A', chip: { label: 'OK', tone: 'ok' } },
      { time: '14:05', text: 'Void · 280 mL', swatch: '#F7EFC4', chip: { label: 'OK', tone: 'ok' } },
    ] })],
    note: 'Swatch = colour against the hydration chart.',
  }),
  card({
    title: 'Lab samples', icon: 'test-tubes', accent: 'neural', span: 2,
    parts: [Log({ items: [
      { time: 'BLD-14', text: 'Blood draw', steps: [{ label: 'Collect', state: 'done' }, { label: 'Spin', state: 'done' }, { label: 'Freeze', state: 'active' }, { label: 'Return', state: 'todo' }] },
      { time: 'SAL-09', text: 'Saliva', steps: [{ label: 'Collect', state: 'done' }, { label: 'Spin', state: 'skip' }, { label: 'Freeze', state: 'done' }, { label: 'Return', state: 'todo' }] },
      { time: 'URN-22', text: 'Urine 24 h', steps: [{ label: 'Collect', state: 'active' }, { label: 'Spin', state: 'todo' }, { label: 'Freeze', state: 'todo' }, { label: 'Return', state: 'todo' }] },
    ] })],
  }),
  card({
    title: 'Fitness tests', icon: 'timer', accent: 'phosphor',
    parts: [
      Meter({ min: 25, max: 55, value: 39.5, digits: 1, unit: 'mL/kg/min', icon: 'heart-pulse', label: 'VO₂ max', target: [41, 46], scale: ['25', '55'] }),
      Meter({ min: 20, max: 60, value: 44, unit: 'kg', icon: 'dumbbell', label: 'Grip strength', target: [42, 48], scale: ['20', '60'] }),
    ],
    note: 'Bright edge = preflight baseline.',
  }),
]

// ------------------------------------------------------------------ layout

function section(id, title, blurb, cards) {
  const s = document.createElement('section')
  s.id = id
  s.innerHTML = `<div class="section-head"><h2>${title}</h2><p>${blurb}</p></div><div class="grid"></div>`
  s.querySelector('.grid').append(...cards)
  return s
}

const LEGEND = [
  ['Readout', 'hash', 'Big number + unit. Optional trend arrow.', 'value · unit · zones · trend'],
  ['Meter', 'rectangle-horizontal', 'Linear track.', 'progress · threshold · range · bullet · segmented · stacked · tuner'],
  ['Radial', 'circle-dot', 'Square tile, icon + number inside.', 'gauge · ring · segments'],
  ['Trace', 'chart-spline', 'Values over time.', 'live · line · step · xy'],
  ['Log', 'list', 'Events with status chips.', 'chips · pipeline'],
]

// The same widget in each state, to show the warning lamp.
const O2_ZONES = [{ max: 25, tone: 'crit' }, { max: 40, tone: 'warn' }, { max: Infinity, tone: 'ok' }]
const states = [
  ['Normal', 82, 'No lamp.'],
  ['Warning', 34, 'The icon flashes to a warning sign: approaching a limit.'],
  ['Bad', 18, 'A red warning sign flashes over the icon: out of the safe range.'],
].map(([name, value, note]) => card({
  title: `Suit O₂ · ${name}`, icon: 'wind', accent: 'oxygen', note,
  parts: [Meter({ min: 0, max: 100, value, unit: '%', label: 'Tank', zones: O2_ZONES, markers: [{ at: 25, label: 'Return' }, { at: 40, label: 'Low' }] })],
}))

const root = document.getElementById('kit')
root.append(
  section('lamps', 'Warning lamps', 'The widget icon flashes to a warning sign when a value nears its limit, and to a red warning sign when it leaves the safe range.', states),
  section('internal', 'Internal', 'Measured on the body by the wearable.', internal),
  section('external', 'External', 'Measured in the cabin, suit or environment.', external),
  section('user', 'User input', 'Logged by the crew member or from lab results.', user),
)

document.getElementById('legend').innerHTML = LEGEND.map(
  ([name, icon, desc, opts]) => `<li>
    <span class="ltab"><i data-lucide="${icon}"></i></span>
    <div class="lbody"><b>${name}</b><span class="uses">×${usage[name] ?? 0}</span><p>${desc}</p><code>${opts}</code></div>
  </li>`,
).join('')
document.getElementById('stat-count').textContent = String(internal.length + external.length + user.length)

// Where values sit: inside the icon tab, or in the bar. Remembered per viewer; defaults to the tab.
const toggle = document.getElementById('values-toggle')
const applyValues = (mode) => {
  document.documentElement.dataset.values = mode
  toggle.textContent = mode === 'tab' ? 'Numbers: in tab' : 'Numbers: in bar'
  toggle.setAttribute('aria-pressed', String(mode === 'tab'))
}
let valuesMode = 'tab'
try {
  valuesMode = localStorage.getItem('vl-values') ?? 'tab'
} catch {
  // Storage can be unavailable; the default still applies.
}
applyValues(valuesMode)
toggle.addEventListener('click', () => {
  valuesMode = valuesMode === 'tab' ? 'bar' : 'tab'
  applyValues(valuesMode)
  try {
    localStorage.setItem('vl-values', valuesMode)
  } catch {
    // Not remembered, but the switch still works for this visit.
  }
})

createIcons({ icons: { Activity, ArrowDownToLine, Brain, Calendar, ChartSpline, CircleDot, CircleGauge, ClipboardList, Cloud, CloudFog, Droplet, Droplets, Dumbbell, Eye, FlaskConical, Gauge, GlassWater, Hash, HeartPulse, List, Microscope, Moon, MoveDownRight, MoveRight, MoveUpRight, Orbit, Pill, Radiation, RectangleHorizontal, Rocket, Scale, Smile, Sun, TestTubes, Thermometer, ThermometerSun, TriangleAlert, Timer, Utensils, Volume2, Wind }, attrs: { 'stroke-width': 2.25 } })

// ------------------------------------------------------------------ live loop

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let last = performance.now()
let t = 0
let nextBeat = 0
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  t += dt
  for (const p of live) p.tick(dt, t)
  if (t > nextBeat) {
    bpm = 70 + Math.sin(t * 0.21) * 3 + Math.random() * 2
    liveHr.set(Math.round(bpm))
    nextBeat = t + 60 / bpm
  }
  if (!reduced) requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
