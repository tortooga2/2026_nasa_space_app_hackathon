import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/800.css'
import './story.css'

// The story page: the live dashboard (an iframe of /) worn on a forearm, in front of a world that changes
// as you scroll. Each chapter picks a scene, how much weather blows across it, and what the dashboard
// should show. The dashboard exposes window.vitalLink for this (applyPreset, showView, setStat, setRange).
// A value in `set` is a fixed reading; a [low, high] pair is a range a fluctuating stat wanders in.

const CHAPTERS = {
  hero: { scene: 'habitat', weather: { motes: 1 }, preset: 'Nominal', view: 0 },
  habitat: { scene: 'habitat', weather: { motes: 1 }, preset: 'Nominal', view: 0 },
  surface: { scene: 'surface', weather: { sand: 0.15 }, preset: 'Nominal', view: 1 },
  dust: { scene: 'dust', weather: { sand: 1 }, haze: 1, preset: 'Dehydrated', set: { suitO2: 34, helmetCo2: [3.2, 3.6], pm25: 28, noise: [64, 70] }, view: 0 },
  solar: { scene: 'solar', weather: { solar: 1 }, preset: 'Solar storm', view: 0 },
  night: { scene: 'night', weather: { stars: 1 }, preset: 'Nominal', view: 0 },
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const root = document.documentElement
const scenes = [...document.querySelectorAll('.scene')]
const chapters = [...document.querySelectorAll('.chapter')]
const haze = document.querySelector('.haze')
const iframe = document.querySelector('.screen iframe')

// ------------------------------------------------------------------ the dashboard on the wrist

// The dashboard is laid out for 1440×900; the screen shows it scaled down to fit.
const DASH = { w: 1440, h: 900 }
const screen = document.querySelector('.screen')
function fitScreen() {
  iframe.style.transform = `scale(${screen.clientWidth / DASH.w})`
}
new ResizeObserver(fitScreen).observe(screen)

let dash = null
let pending = null
iframe.addEventListener('load', () => {
  dash = iframe.contentWindow.vitalLink ?? null
  if (pending) drive(pending)
  // The wheel over the device always moves the story, so the reader never gets stuck scrolling a list
  // inside the dashboard. Taps and clicks still reach it.
  iframe.contentWindow.addEventListener('wheel', (e) => {
    e.preventDefault()
    window.scrollBy({ top: e.deltaY, behavior: 'instant' })
  }, { passive: false })
})
// Apply a chapter's state to the dashboard (or remember it until the dashboard has loaded).
function drive(c) {
  if (!dash) return void (pending = c)
  pending = null
  dash.applyPreset(c.preset)
  for (const [id, v] of Object.entries(c.set ?? {})) {
    if (Array.isArray(v)) dash.setRange(id, v[0], v[1])
    else dash.setStat(id, v)
  }
  dash.showView(c.view)
}

// ------------------------------------------------------------------ chapters

let current = null
function enter(name) {
  if (name === current) return
  current = name
  const c = CHAPTERS[name]
  for (const s of scenes) s.classList.toggle('on', s.dataset.scene === c.scene)
  for (const sys of Object.values(weather)) sys.target = c.weather[sys.name] ?? 0
  haze.style.opacity = c.haze ?? 0
  drive(c)
}

// The chapter whose middle is nearest the middle of the screen is the current one. Over the first
// screen the arm also lifts from a low, tilted angle to face you.
function onScroll() {
  const mid = window.innerHeight / 2
  let best = chapters[0]
  let bestD = Infinity
  for (const ch of chapters) {
    const b = ch.getBoundingClientRect()
    const d = Math.abs(b.top + b.height / 2 - mid)
    if (d < bestD) { best = ch; bestD = d }
  }
  enter(best.dataset.chapter)
  const lift = Math.min(1, window.scrollY / (window.innerHeight * 0.9))
  root.style.setProperty('--lift', reduced ? 1 : lift.toFixed(3))
}
window.addEventListener('scroll', onScroll, { passive: true })
window.addEventListener('resize', onScroll)

// ------------------------------------------------------------------ weather

// Particle systems drawn on two canvases: one behind the arm and one in front of it, so sand and
// streaks blow past the device as well as behind it. Each system eases its strength toward the
// chapter's target, so scenes blend rather than cut.
const back = document.querySelector('.weather.back')
const front = document.querySelector('.weather.front')
const rand = (a, b) => a + Math.random() * (b - a)
let W = 0
let H = 0
function sizeCanvases() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  for (const c of [back, front]) {
    c.width = W * dpr
    c.height = H * dpr
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}

function system(name, count, spawn, draw) {
  return { name, level: 0, target: 0, parts: [], count, spawn, draw }
}
const weather = {
  // Sand: fast horizontal streaks with a wobble. Front-layer grains are bigger and blurrier.
  sand: system('sand', 420, (front) => ({
    x: rand(-W, W), y: rand(0, H), v: rand(700, 1500) * (front ? 1.4 : 1), len: rand(8, 34) * (front ? 2 : 1),
    w: front ? rand(1.5, 3.5) : rand(0.6, 1.6), a: rand(0.25, 0.7), ph: rand(0, 6), front,
  }), (ctx, p, dt, t, level) => {
    p.x += p.v * dt * (0.4 + level)
    const y = p.y + Math.sin(t * 3 + p.ph) * 6
    if (p.x > W + 60) { p.x = rand(-200, -20); p.y = rand(0, H) }
    ctx.strokeStyle = `rgba(232, 168, 104, ${p.a * level})`
    ctx.lineWidth = p.w
    ctx.beginPath()
    ctx.moveTo(p.x, y)
    ctx.lineTo(p.x - p.len, y - p.len * 0.08)
    ctx.stroke()
  }),
  // Solar particles: thin diagonal streaks from the upper right.
  solar: system('solar', 70, (front) => ({
    x: rand(0, W * 1.6), y: rand(-H, H), v: rand(900, 1800), len: rand(40, 140), a: rand(0.2, 0.7), front,
    hue: Math.random() < 0.5 ? '255, 120, 220' : '255, 240, 255',
  }), (ctx, p, dt, t, level) => {
    p.x -= p.v * dt * 0.8
    p.y += p.v * dt * 0.55
    if (p.x < -200 || p.y > H + 200) { p.x = rand(W * 0.3, W * 1.6); p.y = rand(-H * 0.6, 0) }
    ctx.strokeStyle = `rgba(${p.hue}, ${p.a * level})`
    ctx.lineWidth = p.front ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + p.len * 0.8, p.y - p.len * 0.55)
    ctx.stroke()
  }),
  // Dust motes drifting in the habitat's light.
  motes: system('motes', 60, () => ({ x: rand(0, W), y: rand(0, H), r: rand(0.6, 1.8), vx: rand(-6, 6), vy: rand(-10, -2), a: rand(0.15, 0.45) }),
    (ctx, p, dt, t, level) => {
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.y < -10) { p.y = H + 10; p.x = rand(0, W) }
      ctx.fillStyle = `rgba(255, 220, 180, ${p.a * level})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }),
  // Stars that twinkle.
  stars: system('stars', 260, () => ({ x: rand(0, W), y: rand(0, H * 0.85), r: rand(0.4, 1.4), ph: rand(0, 6), s: rand(0.5, 2) }),
    (ctx, p, dt, t, level) => {
      const a = (0.45 + 0.4 * Math.sin(t * p.s + p.ph)) * level
      ctx.fillStyle = `rgba(230, 240, 255, ${a})`
      ctx.fillRect(p.x, p.y, p.r * 2, p.r * 2)
    }),
}
// Sand and solar streaks also blow in front of the arm; a quarter of their particles live there.
const FRONT = { sand: 0.2, solar: 0.25 }
function populate() {
  for (const sys of Object.values(weather)) {
    sys.parts = Array.from({ length: sys.count }, (_, i) => sys.spawn(i < sys.count * (FRONT[sys.name] ?? 0)))
  }
}

let last = performance.now()
let t = 0
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  t += dt
  const bctx = back.getContext('2d')
  const fctx = front.getContext('2d')
  bctx.clearRect(0, 0, W, H)
  fctx.clearRect(0, 0, W, H)
  for (const sys of Object.values(weather)) {
    sys.level += (sys.target - sys.level) * (1 - Math.exp(-dt * 1.5))
    if (sys.level < 0.01) continue
    for (const p of sys.parts) sys.draw(p.front ? fctx : bctx, p, reduced ? 0 : dt, reduced ? 0 : t, sys.level)
  }
  requestAnimationFrame(frame)
}

sizeCanvases()
populate()
window.addEventListener('resize', () => { sizeCanvases(); populate() })
onScroll()
requestAnimationFrame(frame)
