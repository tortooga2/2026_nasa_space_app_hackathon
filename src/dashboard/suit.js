// Drawings for the companion: a glass dome helmet (green outlines) that goes over the squid's bowl, and
// a simple flat spacesuit for the spacewalk view with a slot where the helmet (and squid) go. Styled in
// suit.css.
import './suit.css'

const NS = 'http://www.w3.org/2000/svg'
function svg(markup, attrs) {
  const el = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.innerHTML = markup
  return el
}

// The glass ball: an outline, two glare marks and a glint on the glass, and a small air valve on the
// side. No collar; the squid floats in a glass hamster ball. Drawn on top of the squid, so it reads as
// being inside the glass.
export function helmet() {
  return svg(`
    <circle class="hm-glass" cx="50" cy="50" r="48.5" />
    <path class="hm-glare" d="M20,33 A34,34 0 0 1 40,15" />
    <path class="hm-glare thin" d="M15,46 A37,37 0 0 1 17,38" />
    <circle class="hm-glint" cx="64" cy="13" r="1.4" />
    <path class="hm-line" d="M98.5,45 h3 v10 h-3" />
  `, { class: 'helmet', viewBox: '0 0 100 100', 'aria-hidden': 'true' })
}

// The suit, falling backwards, in a 400 × 220 box: the helmet on the left, the body running right from
// a neck ring on the helmet's side, one arm flung up and one down, and the legs kicked out behind, one
// bent up and one trailing down. Flat shapes, no outlines: a cylinder torso with a shaded underside, a
// backpack on its back (underneath, as it falls backwards), a chest panel in the middle of the belly,
// turned to lie along the body, whose two lights blink and glance toward the pointer, noodle limbs (thick round-capped curves) that sway on their own, and round hands
// and feet. The helmet goes in a slot over the left end (see .suit-helmet); the neck ring is drawn over
// the helmet's edge so the two join.
export function suit() {
  const fig = document.createElement('figure')
  fig.className = 'suit'
  fig.setAttribute('aria-label', 'Your suit')
  fig.append(svg(`
    <defs><clipPath id="suit-torso"><rect x="136" y="76" width="126" height="64" rx="30" /></clipPath></defs>
    <path class="st-tether" d="M236,138 C252,176 236,200 268,218" />
    <g class="st-limb leg-up"><path class="st-noodle" d="M250,92 C256,64 268,46 290,42 C304,40 318,42 330,46" /><circle class="st-gear" cx="338" cy="48" r="13" /></g>
    <g class="st-limb leg-down"><path class="st-noodle" d="M252,120 C278,114 300,114 314,124 C322,130 328,138 332,146" /><circle class="st-gear" cx="336" cy="153" r="13" /></g>
    <g class="st-limb arm-up"><path class="st-noodle" d="M170,86 C168,50 178,26 206,16" /><circle class="st-gear" cx="214" cy="13" r="11" /></g>
    <rect class="st-pack" x="158" y="128" width="84" height="28" rx="10" />
    <g clip-path="url(#suit-torso)">
      <rect class="st-suit" x="136" y="76" width="126" height="64" />
      <rect class="st-shade" x="136" y="116" width="126" height="24" />
      <rect class="st-light" x="148" y="84" width="22" height="5" rx="2.5" />
      <rect class="st-belt" x="226" y="70" width="12" height="76" />
    </g>
    <rect class="st-panel" x="180" y="80" width="18" height="28" rx="4" />
    <g class="st-eyes"><circle class="st-dot" cx="189" cy="88.5" r="2.5" /><circle class="st-dot" cx="189" cy="99.5" r="2.5" /></g>
    <g class="st-limb arm-down"><path class="st-noodle" d="M176,126 C178,168 170,194 136,202" /><circle class="st-gear" cx="128" cy="204" r="11" /></g>
  `, { class: 'suit-body', viewBox: '0 0 400 220', 'aria-hidden': 'true' }))
  const slot = document.createElement('div')
  slot.className = 'suit-helmet pet-home'
  slot.append(helmet())
  fig.append(slot)
  // The panel's two lights look toward the pointer, up to 2.5 units off centre.
  const eyes = fig.querySelector('.st-eyes')
  const panel = fig.querySelector('.st-panel')
  window.addEventListener('pointermove', (e) => {
    if (!fig.isConnected) return
    const b = panel.getBoundingClientRect()
    const dx = e.clientX - (b.left + b.width / 2)
    const dy = e.clientY - (b.top + b.height / 2)
    const d = Math.hypot(dx, dy) || 1
    const k = Math.min(1, d / 200) * 2.5
    eyes.style.transform = `translate(${((dx / d) * k).toFixed(2)}px, ${((dy / d) * k * 0.7).toFixed(2)}px)`
  }, { passive: true })
  // The neck ring, in front of the helmet's right edge, where the torso joins it.
  fig.append(svg(`
    <ellipse class="st-ring" cx="142" cy="106" rx="10" ry="34" />
    <ellipse class="st-ring-in" cx="139" cy="106" rx="5" ry="26" />
  `, { class: 'suit-body', viewBox: '0 0 400 220', 'aria-hidden': 'true' }))
  return fig
}
