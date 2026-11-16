// The companion: a little squid whose mood mirrors the crew member's stats. Four moods (happy, okay,
// not great, bad) change its face, colour and how its tentacles move. It blinks, and its body and eyes
// lean gently toward the pointer.

import './squid.css'

const NS = 'http://www.w3.org/2000/svg'
const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

// Per mood: eye size, mouth path, tentacle motion (sway amplitude, speed, how far the tips curl) and bob.
const MOODS = {
  happy: { eyeH: 30, eyeY: 62, mouth: 'M89,90 Q100,101 111,90', sway: 0.22, speed: 1.6, curl: 1.7, bob: 3.2, bobSpeed: 2.2 },
  okay: { eyeH: 30, eyeY: 62, mouth: 'M90,93 L110,93', sway: 0.16, speed: 1.2, curl: 1.4, bob: 2.4, bobSpeed: 1.5 },
  low: { eyeH: 30, eyeY: 62, lid: 12, mouth: 'M90,96 Q100,89 110,96', sway: 0.1, speed: 0.8, curl: 0.9, bob: 1.6, bobSpeed: 1 },
  bad: { eyeH: 20, eyeY: 66, brows: true, sweat: true, mouth: 'M85,95 q3.75,-4 7.5,0 t7.5,0 t7.5,0 t7.5,0', sway: 0.3, speed: 3.4, curl: 0.5, bob: 1.2, bobSpeed: 5, jitter: 0.9 },
}

// Five tentacles hang from the mantle's bottom and fan out; the outer ones are a little shorter and grow
// from the head's lower corners, so the head's sides run on into them. Positive lean points an arm right,
// negative left.
const ARMS = [
  { x: 53, len: 62, lean: -0.5, w: 21 },
  { x: 76, len: 72, lean: -0.22, w: 21 },
  { x: 100, len: 76, lean: 0, w: 21 },
  { x: 124, len: 72, lean: 0.22, w: 21 },
  { x: 147, len: 62, lean: 0.5, w: 21 },
]
const ARM_TOP = 110
const STEPS = 18
// Head and arms are drawn as separate shapes, then a "gooey" filter blurs them together and sharpens the
// edge again, so wherever they meet the outline becomes one smooth curve instead of a hard corner.
const GOO = 2.4

// A tentacle is a tapered ribbon along a spine. The spine's angle bends more toward the tip, with a
// travelling wave for the sway and a curl that rolls the tip outward.
function armPath(a, i, t, m) {
  const pts = []
  let x = a.x
  let y = ARM_TOP
  const out = a.lean > 0 || (a.lean === 0 && i % 2) ? 1 : -1 // tips roll outward: left arms to the left, right arms to the right
  const seg = a.len / STEPS
  for (let k = 0; k <= STEPS; k++) {
    const s = k / STEPS
    const wave = Math.sin(t * m.speed + i * 1.3 - s * 3.2) * m.sway * (0.3 + s)
    const theta = a.lean * (0.6 + s) + wave + out * m.curl * s ** 4
    // Gentle taper: arms stay chunky all the way down to a round tip.
    const w = a.w * (1 - 0.3 * s)
    pts.push({ x, y, theta, w })
    x += Math.sin(theta) * seg
    y += Math.cos(theta) * seg
  }
  const left = pts.map((p) => [p.x - (Math.cos(p.theta) * p.w) / 2, p.y + (Math.sin(p.theta) * p.w) / 2])
  const right = pts.map((p) => [p.x + (Math.cos(p.theta) * p.w) / 2, p.y - (Math.sin(p.theta) * p.w) / 2]).reverse()
  const tip = pts.at(-1)
  const f = (n) => n.toFixed(1)
  return `M${left.map(([px, py]) => `${f(px)},${f(py)}`).join('L')}` +
    `A${f(tip.w / 2)},${f(tip.w / 2)} 0 0 0 ${f(right[0][0])},${f(right[0][1])}` +
    `L${right.map(([px, py]) => `${f(px)},${f(py)}`).join('L')}Z`
}

export function createSquid({ reduced = false } = {}) {
  const el = document.createElement('div')
  el.className = 'pet'
  el.dataset.mood = 'okay'
  const bubble = document.createElement('p')
  bubble.className = 'pet-bubble'
  bubble.setAttribute('aria-live', 'polite')
  const svg = svgEl('svg', { class: 'squid', viewBox: '0 0 200 200', role: 'img', 'aria-label': 'Companion squid' })
  const filter = svgEl('filter', { id: 'sq-goo', filterUnits: 'userSpaceOnUse', x: -60, y: -60, width: 320, height: 320 })
  filter.append(
    svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: GOO, result: 'blur' }),
    svgEl('feColorMatrix', { in: 'blur', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8' }),
  )
  const defs = svgEl('defs')
  defs.append(filter)
  svg.append(defs)
  const body = svgEl('g', { class: 'sq-body' })
  const goo = body.appendChild(svgEl('g', { filter: 'url(#sq-goo)' }))
  const arms = ARMS.map(() => goo.appendChild(svgEl('path', { class: 'sq-arm' })))
  // Mantle: a squarish head, softly rounded corners, with straight sides and a flat bottom that leaves a
  // band of head below the mouth before the tentacles begin.
  goo.append(svgEl('path', {
    class: 'sq-mantle',
    d: 'M44,70 C44,34 64,20 100,20 C136,20 156,34 156,70 C157,82 157,94 156,104 C156,116 147,122 134,122 L66,122 C53,122 44,116 44,104 C43,94 43,82 44,70 Z',
  }))
  const face = svgEl('g', { class: 'sq-face' })
  const eyes = [78, 122].map(() => face.appendChild(svgEl('rect', { class: 'sq-eye', width: 18, rx: 9 })))
  const lids = [78, 122].map(() => face.appendChild(svgEl('rect', { class: 'sq-lid', width: 24 })))
  const brows = face.appendChild(svgEl('path', { class: 'sq-brow', d: 'M70,48 L86,43 M130,48 L114,43' }))
  const mouth = face.appendChild(svgEl('path', { class: 'sq-mouth' }))
  const sweat = face.appendChild(svgEl('path', { class: 'sq-sweat', d: 'M164,40 q6,9 0,13 q-6,-4 0,-13 Z' }))
  body.append(face)
  svg.append(body)
  // Bubbles float up through the bowl when it's tapped; the layer is clipped to the circle.
  const fizzLayer = document.createElement('div')
  fizzLayer.className = 'fizz-layer'
  fizzLayer.setAttribute('aria-hidden', 'true')
  el.append(bubble, svg, fizzLayer)

  let mood = MOODS.okay
  const pointer = { x: 0, y: 0, seen: false }
  const look = { x: 0, y: 0 }
  let nextBlink = 2
  let blinkAt = -1

  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.seen = true
  }, { passive: true })

  // `detail` is an optional second line of context ("1.1 L to daily goal"), shown with the "+n more".
  function setMood(name, hint, more = 0, detail = '') {
    mood = MOODS[name]
    el.dataset.mood = name
    const sub = [detail, more ? `+${more} more` : ''].filter(Boolean).join(' · ')
    const text = `${hint}|${sub}`
    if (bubble.dataset.text !== text) {
      bubble.dataset.text = text
      bubble.textContent = hint
      if (sub) bubble.append(Object.assign(document.createElement('span'), { className: 'pet-more', textContent: sub }))
    }
    mouth.setAttribute('d', mood.mouth)
    brows.style.display = mood.brows ? '' : 'none'
    sweat.style.display = mood.sweat ? '' : 'none'
    for (const lid of lids) lid.style.display = mood.lid ? '' : 'none'
  }

  function tick(dt, t) {
    if (!el.isConnected) return
    stream(t)
    // Where the pointer is relative to the squid, as -1..1 on each axis, eased so it drifts rather than snaps.
    let tx = 0
    let ty = 0
    if (pointer.seen) {
      const b = svg.getBoundingClientRect()
      // Full lean once the pointer is about two squid-widths away, in any direction.
      const reach = b.width * 2
      tx = Math.max(-1, Math.min(1, (pointer.x - (b.left + b.width / 2)) / reach))
      ty = Math.max(-1, Math.min(1, (pointer.y - (b.top + b.height / 2)) / reach))
    }
    const k = 1 - Math.exp(-dt * 3)
    look.x += (tx - look.x) * k
    look.y += (ty - look.y) * k

    const still = reduced ? 0 : 1
    const bob = Math.sin(t * mood.bobSpeed) * mood.bob * still
    const jitter = (mood.jitter ?? 0) * Math.sin(t * 29) * still
    body.setAttribute('transform', `translate(${(look.x * 7 + jitter).toFixed(2)} ${(look.y * 4 + bob).toFixed(2)}) rotate(${(look.x * 5).toFixed(2)} 100 70)`)
    face.setAttribute('transform', `translate(${(look.x * 7).toFixed(2)} ${(look.y * 5).toFixed(2)})`)
    arms.forEach((p, i) => p.setAttribute('d', armPath(ARMS[i], i, still ? t : 0, mood)))

    // Blink every 2–5 s: the eyes squash shut over 0.16 s.
    if (t > nextBlink) {
      blinkAt = t
      nextBlink = t + 2 + Math.random() * 3
    }
    const bt = (t - blinkAt) / 0.16
    const open = bt >= 0 && bt < 1 ? Math.abs(bt * 2 - 1) : 1
    const h = Math.max(2.5, mood.eyeH * open)
    eyes.forEach((e, i) => {
      const cx = i ? 122 : 78
      e.setAttribute('x', cx - 9)
      e.setAttribute('y', (mood.eyeY - h / 2).toFixed(2))
      e.setAttribute('height', h.toFixed(2))
      e.setAttribute('ry', Math.min(9, h / 2).toFixed(2))
    })
    // Heavy lids: a strip of body colour over the top of each eye.
    if (mood.lid) lids.forEach((l, i) => {
      l.setAttribute('x', (i ? 122 : 78) - 12)
      l.setAttribute('y', mood.eyeY - mood.eyeH / 2 - 2)
      l.setAttribute('height', mood.lid + 2)
    })
  }

  // One bubble at (x, y) in the bowl's own pixels, rising and wobbling as it fades.
  function bubbleAt(x, y, { size, rise, dur, delay = 0, cls = '' }) {
    const dot = document.createElement('span')
    dot.className = `fizz ${cls}`
    dot.style.cssText = [
      `left:${x.toFixed(1)}px`,
      `top:${y.toFixed(1)}px`,
      `--size:${size.toFixed(1)}px`,
      `--rise:${rise.toFixed(0)}px`,
      `--sway:${((Math.random() - 0.5) * 16).toFixed(1)}px`,
      `--dur:${dur.toFixed(2)}s`,
      `animation-delay:${delay.toFixed(2)}s`,
    ].join(';')
    dot.addEventListener('animationend', () => dot.remove(), { once: true })
    fizzLayer.append(dot)
  }

  // A tap releases a few small bubbles from (clientX, clientY).
  function fizz(clientX, clientY) {
    const b = el.getBoundingClientRect()
    const n = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      bubbleAt(clientX - b.left + (Math.random() - 0.5) * 24, clientY - b.top + (Math.random() - 0.5) * 10, {
        size: 4 + Math.random() * 8,
        rise: -70 - Math.random() * 90,
        dur: 1.4 + Math.random() * 0.9,
        delay: i * 0.08 + Math.random() * 0.12,
      })
    }
  }

  // Two faint streams rise all the time from near the bottom of the bowl, either side of the squid:
  // tiny bubbles every second or so, travelling most of the way up before they fade.
  const STREAMS = [
    { x: 0.24, y: 0.86, next: 0.4 },
    { x: 0.79, y: 0.8, next: 1.1 },
  ]
  function stream(t) {
    if (reduced) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    for (const st of STREAMS) {
      if (t < st.next) continue
      st.next = t + 0.8 + Math.random() * 1.1
      bubbleAt(st.x * w + (Math.random() - 0.5) * 6, st.y * h, {
        size: 2.5 + Math.random() * 3.5,
        rise: -h * (0.45 + Math.random() * 0.25),
        dur: 3.2 + Math.random() * 1.6,
        cls: 'ambient',
      })
    }
  }

  return { el, setMood, tick, fizz }
}
