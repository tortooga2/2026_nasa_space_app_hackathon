// Small helpers shared by the ORBIT page's modules.

// Deterministic pseudo-random walk for static sample histories.
export function walk(n, start, step, seed, lo = -Infinity, hi = Infinity) {
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

export const h = (html) => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}


// Who and when this demo is about. Mission day counts from launch; today is day 42 of 180.
export const MISSION = { name: 'Odyssey-04', crew: 'Crew 01', member: 'A. Morgan', day: 42, days: 180 }
export const WATER_GOAL = 2.5
