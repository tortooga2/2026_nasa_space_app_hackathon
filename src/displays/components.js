// Five display primitives. Every stat card on the page is built from these with small option changes:
//   Readout — big number + unit (+ trend); absorbs a following live/line Trace into the same block
//   Meter   — linear bar: progress | threshold | range | bullet | segmented | stacked | tuner
//   Radial  — square tile: gauge | ring (goal) | segments (clock / cycle), icon + reading inside
//   Trace   — time series: live | line | step, plus xy (2-D zone plot)
//   Log     — event list with chips, or per-row pipeline steps
//
// Visual language: every widget is a "block" — an icon tab plus a body with a colour strip along the top.
// Colour is the surface; everything drawn on it is dark ink (the page background). The inset lines are
// not drawn: they are gaps where the background shows through.
// Each primitive returns { el, kind, set?(value), tick?(dt, t) }.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const norm = (v, min, max) => clamp((v - min) / (max - min), 0, 1)
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (x) => `${(x * 100).toFixed(2)}%`

function h(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

function toneFor(v, zones) {
  if (!zones) return null
  for (const z of zones) if (v <= z.max) return z.tone
  return zones.at(-1).tone
}

// Widgets mark their state with a class (.is-warn / .is-crit) but don't restyle themselves. Instead a
// warning lamp flashes over the widget's icon: hollow in the widget colour for a warning, solid red when bad.
function setState(el, tone) {
  el.classList.toggle('is-warn', tone === 'warn')
  el.classList.toggle('is-crit', tone === 'crit')
  if (tone === 'warn' || tone === 'crit') el.title = tone === 'crit' ? 'Out of safe range' : 'Approaching limit'
  else el.removeAttribute('title')
}
const applyTone = (el, v, zones) => setState(el, toneFor(v, zones))

// Icon tab + body. An empty tab is filled with the card's icon by card().
const LAMP = '<span class="lamp" aria-hidden="true"><i data-lucide="triangle-alert"></i></span>'

// Icon tab + body. An empty icon slot is filled with the card's icon by card().
// `tabValue` is the number shown inside the tab when the page puts values there
// (html[data-values="tab"]); otherwise it stays hidden and the value shows in the body.
function block(cls, { icon, tabText } = {}, inner = '', tabValue = '') {
  const tab = tabText ? `<span>${tabText}</span>` : icon ? `<i data-lucide="${icon}"></i>` : ''
  return `<div class="blk ${cls}"><div class="tab"><span class="ico">${tab}</span>${LAMP}${tabValue ? `<span class="tab-val">${tabValue}</span>` : ''}</div><div class="blk-body">${inner}</div></div>`
}

function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><b style="background:${i.swatch}"></b>${i.label}</span>`).join('')}</div>`
}

// Tally of which primitives the page uses, shown in the header legend.
export const usage = {}
const count = (name) => (usage[name] = (usage[name] || 0) + 1)

// Appends parts to a container. A Readout followed by a live/line Trace shares one block: number on the
// left, trace on the right. Empty icon slots get the given icon.
function compose(body, parts, icon) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const next = parts[i + 1]
    body.append(p.el)
    if (p.kind === 'Readout' && next?.plot && !next.standalone) {
      p.el.querySelector('.slot').append(next.plot)
      p.el.classList.add('has-trace')
      if (next.solid) p.el.classList.add('solid-trace')
      i++
    }
  }
  for (const slot of body.querySelectorAll('.ico:empty')) slot.innerHTML = `<i data-lucide="${icon}"></i>`
}

// A bare widget with no card chrome (title, footer), for placing on a dashboard.
export function widget({ icon, accent = 'phosphor', parts, cls = '' }) {
  const el = h(`<div class="widget ${cls}" style="--accent: var(--${accent})"></div>`)
  compose(el, parts, icon)
  return el
}

// ------------------------------------------------------------------ Card

export function card({ title, icon, accent = 'phosphor', span = 1, parts, note }) {
  const el = h(`<article class="card${span > 1 ? ' span-2' : ''}" style="--accent: var(--${accent})">
    <header><h3>${title}</h3></header>
    <div class="card-body"></div>
    <footer></footer>
  </article>`)
  const body = el.querySelector('.card-body')
  compose(body, parts, icon)
  // A tile followed by other widgets sits on the left with the rest stacked beside it.
  if (parts[0].kind.startsWith('Radial') && body.children.length > 1) {
    body.classList.add('with-tile')
    body.firstElementChild.style.gridRow = `span ${body.children.length - 1}`
  }
  if (note) body.append(h(`<p class="note">${note}</p>`))
  const kinds = [...new Set(parts.map((p) => p.kind))]
  el.querySelector('footer').innerHTML = kinds.map((k) => `<span class="tag">${k}</span>`).join('<span class="plus">+</span>')
  return el
}

// ------------------------------------------------------------------ Readout

const TREND_ICON = { up: 'move-up-right', down: 'move-down-right', flat: 'move-right' }

export function Readout({ value, unit = '', digits = 0, trend, sub, zones, size = 'lg', icon, tabText }) {
  count('Readout')
  const el = h(block(`readout ${size}`, { icon, tabText }, `<div class="panel">
    <div class="ro"><span class="num"></span><span class="unit">${unit}</span></div>
    ${trend ? `<i class="trend" data-lucide="${TREND_ICON[trend]}"></i>` : ''}
    ${sub ? `<span class="sub">${sub}</span>` : ''}
    <div class="slot"></div>
  </div>`, `<span class="num"></span><span class="unit">${unit}</span>${trend ? `<i class="trend" data-lucide="${TREND_ICON[trend]}"></i>` : ''}`))
  const nums = el.querySelectorAll('.num')
  const set = (v) => {
    for (const num of nums) num.textContent = typeof v === 'string' ? v : fmt(v, digits)
    if (typeof v === 'number') applyTone(el, v, zones)
  }
  set(value)
  return { el, kind: 'Readout', set }
}

// ------------------------------------------------------------------ Meter

// Scale labels live inside the bar (the bar is the widget's whole box). Numeric labels ("120",
// "600 limit") are placed by value; word labels ("Low", "High") are spread evenly. End labels hug the
// bar's edges, the rest are centred on their value.
function scaleLabel(text, i, n, min, max) {
  const num = parseFloat(text.replace('−', '-'))
  const at = Number.isFinite(num) ? norm(num, min, max) : n > 1 ? i / (n - 1) : 0
  const place = at < 0.02 ? 'left:5px' : at > 0.98 ? 'right:5px' : `left:${pct(at)};transform:translateX(-50%)`
  return `<span class="sc" style="${place}">${text}</span>`
}

export function Meter(o) {
  count('Meter')
  const { min = 0, max = 100, label = '', unit = '', digits = 0, zones, markers = [], segments = 0, target, stack, scale, tuner, icon, tabText } = o
  const variant = tuner ? 'tuner' : stack ? 'stacked' : segments ? 'segmented' : o.range ? 'range' : target ? 'bullet' : markers.length ? 'threshold' : 'progress'

  let lane = ''
  if (target) {
    const a = norm(target[0], min, max)
    lane += `<div class="target" style="left:${pct(a)};width:${pct(norm(target[1], min, max) - a)}"></div>`
  }
  if (stack) {
    const total = stack.reduce((s, x) => s + x.value, 0)
    lane += stack.map((s) => `<div class="slice" style="flex:${s.value / total};background:var(--${s.accent})"></div>`).join('')
  } else if (tuner) {
    // Radio-dial scale on a dark track: tick marks (longer at each major step) and a sliding needle.
    // Ticks are placed by value, starting at the first whole step at or above min.
    for (let v = Math.ceil(min / tuner.minor - 1e-9) * tuner.minor; v <= max + 1e-9; v += tuner.minor) {
      const major = Math.abs(v / tuner.major - Math.round(v / tuner.major)) < 1e-6
      lane += `<div class="grad${major ? ' major' : ''}" style="left:${pct(norm(v, min, max))}"></div>`
    }
    lane += '<div class="tuner-needle"></div>'
  } else if (segments) {
    lane += '<div class="cell"></div>'.repeat(segments)
  } else {
    lane += '<div class="fill"></div>'
  }
  // Marker labels sit inside the bar beside their notch, on whichever side has room.
  for (const m of markers) {
    const at = norm(m.at, min, max)
    lane += `<div class="mark${at > 0.8 ? ' flip' : ''}" style="left:${pct(at)}">${m.label ? `<span>${m.label}</span>` : ''}</div>`
  }
  if (scale) lane += scale.map((s, i) => scaleLabel(s, i, scale.length, min, max)).join('')
  lane += '<span class="val"></span>'

  const el = h(`<div class="meter ${variant}${target ? ' has-target' : ''}${scale ? ' has-scale' : ''}">
    ${label ? `<div class="meter-label">${label}</div>` : ''}
    ${block('bar', { icon, tabText }, `<div class="lane">${lane}</div>`, '<span class="tv"></span>')}
    ${stack ? legend(stack.map((s) => ({ label: `${s.label} ${s.value}%`, swatch: `var(--${s.accent})` }))) : ''}
  </div>`)
  const blk = el.querySelector('.blk')
  const fill = el.querySelector('.fill')
  const cells = [...el.querySelectorAll('.cell')]
  const valEl = el.querySelector('.val')
  const tabValEl = el.querySelector('.tab-val .tv')

  // Value text sits at the right end of the lane: ink when the colour runs under all of it, colour when
  // the colour stops short, and a background notch when the colour ends partway under the text.
  let edge = 1
  const laneEl = el.querySelector('.lane')
  const measure = () => {
    const l = laneEl.getBoundingClientRect()
    const v = valEl.getBoundingClientRect()
    const right = l.left + edge * l.width
    valEl.classList.toggle('on-fill', right >= v.right + 4)
    valEl.classList.toggle('notch', right > v.left - 6 && right < v.right + 4)
    // In-bar labels: ink over the fill, colour over the empty track; hidden where they'd hit the value.
    const lit = fill ? [fill] : cells.filter((c) => c.classList.contains('on'))
    const f = lit.length ? { left: lit[0].getBoundingClientRect().left, right: lit.at(-1).getBoundingClientRect().right } : null
    const needle = laneEl.querySelector('.tuner-needle')?.getBoundingClientRect()
    const hits = (r, x) => r.left - 4 < x && r.right + 4 > x
    const shown = []
    for (const t of laneEl.querySelectorAll('.mark span')) {
      const r = t.getBoundingClientRect()
      const mid = (r.left + r.right) / 2
      t.classList.toggle('on-fill', !!f && mid > f.left && mid < f.right)
      // Hide a label rather than let it collide with the value, another label, the fill's edge or the
      // needle.
      const clash = (v.width > 0 && r.right > v.left - 6 && r.left < v.right + 6) ||
        (f && (hits(r, f.left) || hits(r, f.right))) ||
        (needle && hits(r, (needle.left + needle.right) / 2)) ||
        shown.some((o) => r.right > o.left - 6 && r.left < o.right + 6)
      t.classList.toggle('hidden', !!clash)
      if (!clash) shown.push(r)
    }
    // Scale numbers live in the thick top strip, clear of the fill. Ink where the strip is bright (all of
    // it, or the normal-range section on bars that have one), colour where it is dimmed.
    const tgt = laneEl.querySelector('.target')?.getBoundingClientRect()
    const ruled = []
    const lr = laneEl.getBoundingClientRect()
    for (const t of laneEl.querySelectorAll('.sc')) {
      t.style.translate = ''
      let r = t.getBoundingClientRect()
      // A label split by the edge of the bright section is nudged wholly to one side: into the bright
      // section when it sits on the edge, otherwise to whichever side holds most of it.
      for (const [edge, into] of tgt ? [[tgt.left, 1], [tgt.right, -1]] : []) {
        if (r.left >= edge || r.right <= edge) continue
        const m = (r.left + r.right) / 2
        const dir = Math.abs(m - edge) < r.width * 0.25 ? into : m < edge ? -1 : 1
        let dx = dir < 0 ? edge - 3 - r.right : edge + 3 - r.left
        dx = Math.max(lr.left + 2 - r.left, Math.min(lr.right - 2 - r.right, dx))
        t.style.translate = `${dx.toFixed(1)}px 0`
        r = t.getBoundingClientRect()
      }
      const mid = (r.left + r.right) / 2
      t.classList.toggle('on-strip', !tgt || (mid > tgt.left && mid < tgt.right))
      const clash = (needle && hits(r, (needle.left + needle.right) / 2)) ||
        ruled.some((o) => r.right > o.left - 6 && r.left < o.right + 6)
      t.classList.toggle('hidden', !!clash)
      if (!clash) ruled.push(r)
    }
  }
  new ResizeObserver(measure).observe(laneEl)
  const showValue = (fraction, text) => {
    valEl.textContent = text
    tabValEl.textContent = text
    edge = fraction
    requestAnimationFrame(measure)
  }

  const set = (v) => {
    if (stack) return showValue(1, o.valueText ?? '')
    if (o.range) {
      const [lo, hi] = v
      fill.style.left = pct(norm(lo, min, max))
      fill.style.width = pct(norm(hi, min, max) - norm(lo, min, max))
      applyTone(blk, hi, zones)
      return showValue(norm(hi, min, max), `${fmt(hi, digits)}/${fmt(lo, digits)}`)
    }
    const n = norm(v, min, max)
    applyTone(blk, v, zones)
    // valueText can be fixed text or a function of the value (e.g. v => `${v} / 5`).
    const text = typeof o.valueText === 'function' ? o.valueText(v) : o.valueText ?? `${fmt(v, digits)}${unit ? ` ${unit}` : ''}`
    if (segments) {
      const lit = Math.round(n * segments)
      cells.forEach((c, i) => {
        c.classList.toggle('on', i < lit)
      })
      return showValue(lit / segments, text)
    }
    if (tuner) {
      el.querySelector('.tuner-needle').style.left = pct(n)
      return showValue(0, text)
    }
    fill.style.width = pct(n)
    showValue(n, text)
  }
  set(o.range ?? o.value)
  return { el, kind: `Meter · ${variant}`, set }
}

// ------------------------------------------------------------------ Radial

const P = (r, a) => [60 + r * Math.sin((a * Math.PI) / 180), 60 - r * Math.cos((a * Math.PI) / 180)]
function arc(r, a0, a1) {
  if (a1 - a0 >= 359.99) a1 = a0 + 359.99
  const [x0, y0] = P(r, a0)
  const [x1, y1] = P(r, a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

// Rings nest inward; each inner ring is a fainter tint of the same colour.
const RING_TINT = [1, 0.6, 0.35]
const tintSwatch = (op) => `color-mix(in srgb, var(--accent) ${Math.round(op * 100)}%, var(--bg))`

// A small square tile, like a watch complication: a gauge, ring or segmented clock with the icon and the
// reading inside it.
export function Radial(o) {
  count('Radial')
  const { min = 0, max = 100, mode = 'needle', sweep = mode === 'needle' ? 240 : 360, band, rings, segments, center = '', sub = '', zones, icon } = o
  const a = (v) => -sweep / 2 + norm(v, min, max) * sweep
  let svg = ''

  if (mode === 'needle') {
    // Gauge: open arc, the normal band in a mid tint, a dot at the reading.
    svg += `<path class="r-track" d="${arc(50, -sweep / 2, sweep / 2)}"/>`
    if (band) svg += `<path class="r-band" d="${arc(50, a(band[0]), a(band[1]))}"/>`
    svg += '<circle class="r-dot" r="7"/>'
  } else if (mode === 'ring') {
    const step = rings.length > 1 ? 10 : 0
    rings.forEach((r, i) => {
      const rad = 51 - i * step
      svg += `<path class="r-track${rings.length > 1 ? ' thin' : ''}" d="${arc(rad, 0, 360)}"/>`
      const d = arc(rad, 0, Math.max(0.5, norm(r.value, 0, r.max) * 360))
      svg += `<path class="r-fill${rings.length > 1 ? ' thin' : ''}" style="opacity:${r.tint ?? RING_TINT[i]}" d="${d}"/>`
    })
  } else if (mode === 'segments') {
    // `ink` is how dark a segment is, so the visible tint is its inverse.
    for (const s of segments) svg += `<path class="r-seg" style="opacity:${(1 - s.ink * 0.85).toFixed(2)}" d="${arc(50, a(s.from) + 2, a(s.to) - 2)}"/>`
    const [mx, my] = P(50, a(o.at ?? o.value))
    svg += `<circle class="r-now" cx="${mx}" cy="${my}" r="6"/>`
  }

  const legendItems = rings && rings.length > 1
    ? rings.map((r, i) => ({ label: r.label, swatch: tintSwatch(r.tint ?? RING_TINT[i]) }))
    : segments?.some((s) => s.label) ? segments.filter((s) => s.label).map((s) => ({ label: s.label, swatch: tintSwatch(1 - s.ink * 0.85) })) : null

  const el = h(`<div class="radial-wrap">
    <div class="tile ${mode}">
      <svg viewBox="0 0 120 120" role="img">${svg}</svg>
      <div class="tile-in">
        <span class="tile-icon"><span class="ico">${icon ? `<i data-lucide="${icon}"></i>` : ''}</span>${LAMP}</span>
        <span class="t-num"></span>
        ${sub ? `<span class="t-unit">${sub}</span>` : ''}
      </div>
    </div>
    ${legendItems ? legend(legendItems) : ''}
  </div>`)
  const tile = el.querySelector('.tile')
  const dot = el.querySelector('.r-dot')
  const numEl = el.querySelector('.t-num')

  if (!dot && zones && rings) applyTone(tile, rings[0].value, zones)
  const set = (v) => {
    if (dot) {
      const [x, y] = P(50, a(v))
      dot.setAttribute('cx', x.toFixed(2))
      dot.setAttribute('cy', y.toFixed(2))
      applyTone(tile, v, zones)
    }
    // A ring with a value passed to set() redraws its outer ring (e.g. water logged during the day).
    if (mode === 'ring' && typeof v === 'number') {
      el.querySelector('.r-fill').setAttribute('d', arc(51, 0, Math.max(0.5, norm(v, 0, rings[0].max) * 360)))
      if (zones) applyTone(tile, v, zones)
    }
    // Segments: the marker follows the value, unless it is pinned with `at` (e.g. the time of day on the
    // light clock while the number shows lux).
    if (mode === 'segments' && typeof v === 'number') {
      const [mx, my] = P(50, a(o.at ?? v))
      const now = el.querySelector('.r-now')
      now.setAttribute('cx', mx.toFixed(2))
      now.setAttribute('cy', my.toFixed(2))
      if (zones) applyTone(tile, v, zones)
    }
    numEl.textContent = typeof center === 'function' ? center(v) : center
  }
  set(o.value ?? rings?.[0].value)
  return { el, kind: `Radial · ${mode === 'needle' ? 'gauge' : mode}`, set }
}

// ------------------------------------------------------------------ Trace

export function Trace(o) {
  count('Trace')
  const { mode = 'line', min = 0, max = 1, band, height = mode === 'step' ? 32 : 20, yLabels, icon, tabText } = o

  if (mode === 'xy') {
    const { x, y, xr, yr, zone, xLabel, yLabel } = o
    const X = (v) => 14 + norm(v, xr[0], xr[1]) * 182
    const Y = (v) => 50 - norm(v, yr[0], yr[1]) * 46
    let grid = ''
    for (let i = 0; i <= 6; i++) {
      const gx = 14 + (i / 6) * 182
      grid += `<line class="t-grid" x1="${gx}" y1="4" x2="${gx}" y2="50"/>`
    }
    for (let i = 0; i <= 2; i++) {
      const gy = 4 + (i / 2) * 46
      grid += `<line class="t-grid" x1="14" y1="${gy}" x2="196" y2="${gy}"/>`
    }
    const el = h(block('trace mode-xy', { icon, tabText }, `<div class="panel"><svg viewBox="0 0 200 60">
      ${grid}
      <rect class="t-zone" x="${X(zone.x[0])}" y="${Y(zone.y[1])}" width="${X(zone.x[1]) - X(zone.x[0])}" height="${Y(zone.y[0]) - Y(zone.y[1])}"/>
      <circle class="t-point" cx="${X(x)}" cy="${Y(y)}" r="3.5"/>
      <text class="t-axis start" x="14" y="58">${xr[0]}</text>
      <text class="t-axis" x="105" y="58">${xLabel}</text>
      <text class="t-axis end" x="196" y="58">${xr[1]}</text>
      <text class="t-axis" x="6" y="27" transform="rotate(-90 6 27)">${yLabel}</text>
    </svg></div>`))
    return { el, kind: 'Trace · xy' }
  }

  const plot = h(`<div class="plot" style="--h:${height}px">
    <svg viewBox="0 0 200 100" preserveAspectRatio="none">
      ${band ? `<rect class="t-band" x="0" width="200" y="${100 - norm(band[1], min, max) * 100}" height="${(norm(band[1], min, max) - norm(band[0], min, max)) * 100}"/>` : ''}
      <path class="t-line" vector-effect="non-scaling-stroke"/>
    </svg>
    <span class="t-dot"></span>
  </div>`)
  // Step traces (hypnogram) need their axis labels, so they always stand alone.
  const standalone = mode === 'step' || !!yLabels
  const el = h(block(`trace mode-${mode}`, { icon, tabText }, `<div class="panel">
    ${yLabels ? `<div class="ylabels">${yLabels.map((l) => `<span>${l}</span>`).join('')}</div>` : ''}
  </div>`))
  el.querySelector('.panel').append(plot)
  const path = plot.querySelector('.t-line')
  const dot = plot.querySelector('.t-dot')

  const draw = (data) => {
    const n = data.length
    let d = ''
    data.forEach((v, i) => {
      const x = (i / (n - 1)) * 200
      const y = 100 - norm(v, min, max) * 100
      if (i === 0) d += `M${x.toFixed(1)} ${y.toFixed(1)}`
      else if (mode === 'step') d += `H${x.toFixed(1)}V${y.toFixed(1)}`
      else d += `L${x.toFixed(1)} ${y.toFixed(1)}`
    })
    path.setAttribute('d', d)
    dot.style.left = '100%'
    dot.style.top = pct(1 - norm(data[n - 1], min, max))
  }

  if (mode === 'live') {
    const rate = o.rate ?? 60
    const samples = o.samples ?? 160
    const buf = Array.from({ length: samples }, (_, i) => o.gen((i - samples) / rate))
    let acc = 0
    const tick = (dt, t) => {
      acc += dt * rate
      while (acc >= 1) {
        acc -= 1
        buf.shift()
        buf.push(o.gen(t))
      }
      draw(buf)
    }
    draw(buf)
    return { el, plot, standalone, solid: !!o.solid, kind: 'Trace · live', tick }
  }

  draw(o.data)
  return { el, plot, standalone, solid: !!o.solid, kind: `Trace · ${mode}` }
}

// ------------------------------------------------------------------ Log

export function Log({ items }) {
  count('Log')
  const pipeline = items.some((i) => i.steps)
  const el = h(`<ol class="log">${items
    .map(
      (i) => `<li>
        <time>${i.time}</time>
        <span class="text">${i.swatch ? `<b class="swatch" style="background:${i.swatch}"></b>` : ''}${i.text}</span>
        ${i.chip ? `<span class="chip ${i.chip.tone ?? ''}">${i.chip.label}</span>` : ''}
        ${i.steps ? `<span class="steps">${i.steps.map((s) => `<span class="step ${s.state}">${s.label}</span>`).join('')}</span>` : ''}
      </li>`,
    )
    .join('')}</ol>`)
  return { el, kind: pipeline ? 'Log · pipeline' : 'Log' }
}
