// ORBIT · Health log view (the old dashboard's History view): a featured hydration chart, then every
// tracked stat as a labelled chart, grouped into categories. A 7D / 30D / 90D toggle sets how many days
// the daily charts show.
import { widget, Trace } from '../displays/components.js'
import { h, walk, MISSION, WATER_GOAL } from './util.js'

// ------------------------------------------------------------------ view 3: history

// Charts grouped into categories, each with a vertical label down its left side. Every chart is labelled:
// a value scale on the left (top, middle and bottom of the range) and times along the bottom. `height`
// is each chart's minimum; charts stretch to fill their row. Big ones span two columns. `band` shades
// the normal range. Daily stats (no `span`) keep 90 days of samples, the last one today; the range
// toggle shows the last 7, 30 or 90 of them, so the shorter ranges are the tail of the longer ones.
const RANGES = [7, 30, 90]
const D = RANGES.at(-1)
const SLEEP_STAGES = [3, 2, 1, 0, 0, 1, 2, 1, 0, 0, 1, 2, 2, 1, 0, 1, 2, 3, 2, 1, 2, 1, 2, 2, 3]
const HISTORY_GROUPS = [
  ['Sleep & mood', ['Sleep', 'Mood']],
  ['Heart & lungs', ['Heart rate', 'BP systolic', 'SpO₂', 'Respiratory rate']],
  ['Fuel & body', ['Blood glucose', 'Core temp', 'Body mass', 'Energy intake', 'Exercise']],
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
  { name: 'BP systolic', icon: 'activity', accent: 'pulse', unit: 'mmHg', data: walk(D, 116, 6, 5, 104, 128), band: [90, 120], lo: 90, hi: 140, height: 44 },
  { name: 'SpO₂', icon: 'droplets', accent: 'oxygen', unit: '%', data: walk(D, 97, 1.2, 9, 94, 99), band: [95, 100], lo: 90, hi: 100, height: 44 },
  { name: 'Core temp', icon: 'thermometer', accent: 'thermal', unit: '°C', digits: 1, data: walk(D, 36.8, 0.3, 4, 36.3, 37.3), band: [36.1, 37.2], lo: 35.5, hi: 38, height: 44 },
  { name: 'Mood', icon: 'smile', accent: 'neural', unit: '/ 5', data: walk(D, 4, 1.4, 19, 1, 5).map(Math.round),
    chart: { mode: 'step', min: 0.7, max: 5.3, yLabels: ['5', '4', '3', '2', '1'], height: 72 } },
  { name: 'Respiratory rate', icon: 'wind', accent: 'oxygen', unit: '/min', data: walk(D, 14, 1.5, 13, 11, 18), band: [12, 20], lo: 8, hi: 24, height: 44 },
  { name: 'Body mass', span: '6 mo', icon: 'scale', accent: 'signal', unit: 'kg', digits: 1, data: walk(24, 74, 0.6, 3, 71, 74.5).map((v, i) => v - i * 0.08), height: 44 },
  { name: 'Exercise', icon: 'dumbbell', accent: 'phosphor', unit: 'h', digits: 1, data: walk(D, 2, 0.8, 31, 0.5, 2.8), band: [2, 3], lo: 0, hi: 3, height: 44, mode: 'step' },
  { name: 'Energy intake', icon: 'utensils', accent: 'thermal', unit: 'kcal', data: walk(D, 2400, 300, 29, 1900, 2900), band: [2500, 2900], lo: 1500, hi: 3200, height: 44 },
  { name: 'Reaction time', icon: 'brain', accent: 'neural', unit: 'ms', data: walk(D, 255, 18, 37, 230, 290), band: [235, 275], height: 44 },
  { name: 'Vision shift', icon: 'eye', accent: 'signal', unit: 'D', digits: 2, data: walk(D, -0.1, 0.08, 41, -0.4, 0.15).map((v, i) => v - i * 0.002), band: [-0.25, 0.25], lo: -1, hi: 0.5, height: 44 },
  { name: 'Cabin CO₂', icon: 'cloud', accent: 'phosphor', unit: 'mmHg', digits: 1, data: walk(D, 2.6, 0.6, 43, 1.8, 3.6), band: [0, 3], lo: 0, hi: 6, height: 44 },
  { name: 'Radiation dose', icon: 'radiation', accent: 'rad', unit: 'mSv/day', digits: 2, data: walk(D, 0.6, 0.12, 47, 0.45, 0.8), height: 44 },
  { name: 'Noise', icon: 'volume-2', accent: 'phosphor', unit: 'dBA', data: walk(D, 60, 5, 53, 52, 70), band: [30, 60], lo: 40, hi: 80, height: 44, mode: 'step' },
  { name: 'Cabin climate', span: 'Now', icon: 'thermometer-sun', accent: 'thermal',
    xy: { x: 22.4, y: 46, xr: [16, 30], yr: [10, 90], zone: { x: [18.3, 26.7], y: [25, 70] }, xLabel: 'Temp °C', yLabel: 'RH %' } },
]
// Daily water intake in litres; the last day is today and is replaced by the live value.
const WATER_DAYS = walk(D, 2.2, 0.5, 23, 1.4, 2.9)

const format = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length

// Mission day of the sample `ago` days before today. Days before launch use NASA's L-minus count.
function dayLabel(ago) {
  if (ago === 0) return 'Today'
  const m = MISSION.day - ago
  return m >= 1 ? `D${String(m).padStart(3, '0')}` : `L-${1 - m}`
}
// Index of the middle sample of an n-day range, and the first / middle / last labels.
const mid = (n) => Math.floor((n - 1) / 2)
const dayLabels = (n) => [dayLabel(n - 1), dayLabel(n - 1 - mid(n)), dayLabel(0)]

// One chart card. `n` is the number of days shown, for daily stats; spanned stats ignore it.
function historyCard(s, n) {
  const d = s.digits ?? 0
  const daily = !s.span
  let reading = ''
  let chart
  let summary = ''
  if (s.xy) {
    chart = Trace({ mode: 'xy', ...s.xy })
    reading = `<span class="h-val"><b>${s.xy.x}</b> °C <b>${s.xy.y}</b> %</span>`
  } else {
    const data = daily ? s.data.slice(-n) : s.chart?.data ?? s.data
    const lo = Math.min(...data)
    const hi = Math.max(...data)
    const pad = (hi - lo) * 0.25 || 1
    const min = s.lo ?? lo - pad
    const max = s.hi ?? hi + pad
    // Scale labels sit at the top, middle and bottom of the chart's range.
    const scaleDigits = max - min < 3 ? Math.max(d, 1) : d
    const tick = (v) => format(v, scaleDigits)
    reading = `<span class="h-val"><b>${format(s.value ?? data.at(-1), d)}</b> ${s.unit}</span>`
    chart = Trace(s.chart ? { ...s.chart, data } : { mode: s.mode ?? 'line', data, min, max, band: s.band, height: s.height, yLabels: [tick(max), tick((min + max) / 2), tick(min)] })
    // One line under the chart: the average over the range and, with a normal band, how many days sat in it.
    if (daily) {
      const inRange = s.band && data.filter((v) => v >= s.band[0] && v <= s.band[1]).length
      summary = `${n}-day avg ${format(mean(data), d)} ${s.unit}${s.band ? ` <span>· ${inRange}/${n} days in range</span>` : ''}`
    }
  }
  const x = s.xy ? null : daily ? dayLabels(n) : X_LABELS[s.span]
  const card = h(`<article class="h-card${s.wide ? ' wide' : ''}">
    <header><h3>${s.name}</h3>${reading}</header>
  </article>`)
  card.append(widget({ icon: s.icon, accent: s.accent, parts: [chart] }))
  if (x) card.append(h(`<div class="h-x">${x.map((t) => `<span>${t}</span>`).join('')}</div>`))
  if (summary) card.append(h(`<p class="h-sum">${summary}</p>`))
  return card
}

// ------------------------------------------------------------------ featured: hydration

// A bar per day with a dashed goal line; today's bar is the live intake, in amber while it's in
// progress. Bars are drawn in day units (one unit wide each) and stretched to fit, so they stay crisp
// at any width; the labels are HTML laid over and around the plot.
const WATER_MAX = 3

function hydrationCard() {
  const panel = h(`<div class="panel hyd" role="img"></div>`)
  // A block in the kit's shape (icon tab, colour strip, body) so it reads like the other widgets.
  const part = { el: h(`<div class="blk trace"><div class="tab"><span class="ico"></span></div><div class="blk-body"></div></div>`), kind: 'Bars' }
  part.el.querySelector('.blk-body').append(panel)
  const card = h(`<article class="h-card wide hyd-card">
    <header><h3>Water</h3><span class="h-val"><b></b> L today</span></header>
  </article>`)
  card.append(widget({ icon: 'glass-water', accent: 'oxygen', parts: [part] }))
  const todayEl = card.querySelector('.h-val b')

  card.render = (n, today) => {
    const days = [...WATER_DAYS.slice(-n, -1), today]
    const past = days.slice(0, -1)
    const atGoal = days.filter((v) => v >= WATER_GOAL).length
    const met = today >= WATER_GOAL
    const w = n <= 7 ? 0.44 : n <= 30 ? 0.62 : 0.7
    const y = (v) => 100 - (Math.min(Math.max(v, 0), WATER_MAX) / WATER_MAX) * 100
    const bars = days.map((v, i) => `<rect class="${i === n - 1 ? 'hyd-today' : 'hyd-bar'}" x="${(i + (1 - w) / 2).toFixed(2)}" y="${y(v).toFixed(2)}" width="${w}" height="${(100 - y(v)).toFixed(2)}"/>`).join('')
    const ticks = [0, mid(n), n - 1]
    todayEl.textContent = format(today, 1)
    panel.innerHTML = `
      <div class="hyd-y">${[3, 2, 1, 0].map((v) => `<span>${v} L</span>`).join('')}</div>
      <div class="hyd-chart">
        <div class="hyd-plot">
          <svg viewBox="0 0 ${n} 100" preserveAspectRatio="none" aria-hidden="true">
            ${bars}
            <line class="hyd-goal" x1="0" x2="${n}" y1="${y(WATER_GOAL)}" y2="${y(WATER_GOAL)}" vector-effect="non-scaling-stroke"/>
          </svg>
          <span class="hyd-goal-label" style="top:${y(WATER_GOAL)}%">Goal ${WATER_GOAL} L</span>
        </div>
        <div class="hyd-x">${ticks.map((i) => `<span style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%">${dayLabel(n - 1 - i)}</span>`).join('')}</div>
      </div>
      <div class="hyd-side">
        <span class="hyd-k">${n}-day average</span>
        <span class="hyd-avg"><b>${format(mean(past), 1)}</b> L / day</span>
        <span class="hyd-k">${atGoal} / ${n} days at goal</span>
        <span class="hyd-k ${met ? 'met' : 'live'}">${met ? 'Today’s goal is met.' : 'Today is in progress.'}</span>
      </div>`
    panel.setAttribute('aria-label', `Water, last ${n} days: average ${format(mean(past), 1)} litres a day, ${atGoal} of ${n} days at goal, ${format(today, 1)} litres so far today`)
  }
  return card
}

// ------------------------------------------------------------------ view

export function historyView({ waterToday }) {
  const el = h(`<div class="view view-history">
    <header class="hist-head"><h2 class="sec-head">Health log</h2><span>Shaded band = normal range</span>
      <div class="hist-range" role="group" aria-label="Range">${RANGES.map((n) => `<button type="button" data-n="${n}">${n}D</button>`).join('')}</div>
    </header>
  </div>`)
  const group = (cat) => h(`<section class="hist-group" aria-label="${cat}"><h3 class="hist-cat"><span>${cat}</span></h3><div class="hist-grid"></div></section>`)

  const water = group('Hydration')
  const hyd = hydrationCard()
  water.querySelector('.hist-grid').append(hyd)
  el.append(water)

  // Daily cards are built once per range up front, so their icons get drawn with the rest of the page;
  // the toggle just shows one set.
  const byName = new Map(HISTORY.map((s) => [s.name, s]))
  const daily = []
  for (const [cat, names] of HISTORY_GROUPS) {
    const g = group(cat)
    const grid = g.querySelector('.hist-grid')
    for (const s of names.map((n) => byName.get(n))) {
      if (s.span) grid.append(historyCard(s))
      else for (const n of RANGES) {
        const card = historyCard(s, n)
        card.dataset.n = n
        daily.push(card)
        grid.append(card)
      }
    }
    el.append(g)
  }

  let range = RANGES[0]
  const show = (n) => {
    range = n
    for (const b of el.querySelectorAll('.hist-range button')) b.setAttribute('aria-pressed', String(+b.dataset.n === n))
    for (const c of daily) c.hidden = +c.dataset.n !== n
    hyd.render(n, waterToday())
  }
  el.querySelector('.hist-range').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (b) show(+b.dataset.n)
  })
  el.refresh = () => hyd.render(range, waterToday())
  show(range)
  return el
}
