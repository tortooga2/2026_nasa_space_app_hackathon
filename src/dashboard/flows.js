// Guided check-ins for the demo, following the team's user flows. Each opens as a panel over the tasks
// column, so the companion stays in view and reacts to the result.
//   Weight check-in — pick SAMMD (pushed along a 1 m track) or BMMD (oscillates on a spring), measure,
//     confirm or type the mass, then compare with last week: on track → green, avatar unchanged;
//     losing faster than expected → yellow (moderate) or red (severe), and the avatar changes to match.
//   Cardio check — read heart rate from the wrist sensor, then blood pressure from the cuff. Each is
//     average → green, or low/high → red, a sad avatar and a warning.
// Measurements read the current stats, so the debug menu decides what the "device" sees.

const PREV_MASS = { kg: 72, day: 'D035' } // last week's check-in
// Weekly loss limits: up to 0.3 kg is the expected in-flight loss or maintenance; up to 0.8 kg is moderate.
const LOSS_OK = 0.3
const LOSS_MODERATE = 0.8

const ADVICE = {
  hrHigh: 'Rest for 5 minutes and recheck. If it stays high, contact the flight surgeon.',
  hrLow: 'Sit down and recheck. If you feel dizzy or faint, contact the flight surgeon.',
  bpHigh: 'Rest, avoid exercise for now and recheck in 30 minutes. Flight surgeon notified.',
  bpLow: 'Drink fluids, sit or lie down and recheck. Flight surgeon notified.',
  massModerate: 'Add a snack and log every meal today.',
  massSevere: 'Flight surgeon notified. Follow the nutrition plan and recheck in 3 days.',
}

export function createFlows({ STATS, h, mount, onResult, onOpen }) {
  const el = h(`<aside class="flow" aria-live="polite" hidden>
    <header><h2 class="sec-head"></h2><button type="button" class="dbg-close" data-close aria-label="Close"><i data-lucide="x"></i></button></header>
    <ol class="flow-steps"></ol>
    <div class="flow-body"></div>
  </aside>`)
  mount.append(el)
  const title = el.querySelector('h2')
  const stepsEl = el.querySelector('.flow-steps')
  const body = el.querySelector('.flow-body')
  let timers = []
  let done = () => {}

  const later = (ms, fn) => timers.push(setTimeout(fn, ms))
  const every = (ms, fn) => timers.push(setInterval(fn, ms))
  const stopTimers = () => {
    timers.forEach((t) => { clearTimeout(t); clearInterval(t) })
    timers = []
  }
  function close() {
    stopTimers()
    el.hidden = true
  }
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close() })

  // The step list across the top: done steps ticked, the current one lit.
  function show(steps, at, html) {
    stepsEl.innerHTML = steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}">${s}</li>`).join('')
    body.innerHTML = html
  }
  const verdict = (tone, head, text) => `<div class="flow-verdict ${tone}"><b>${head}</b><p>${text}</p></div>`

  // ---------------------------------------------------------------- weight
  const W_STEPS = ['Method', 'Measure', 'Confirm', 'Trend']
  const METHODS = {
    SAMMD: { name: 'SAMMD', how: 'Linear acceleration', text: 'Pushes you along a 1 m track and measures the force.' },
    BMMD: { name: 'BMMD', how: 'Oscillation', text: 'Rocks you back and forth on a spring and times the swing.' },
  }

  function weightMethod() {
    show(W_STEPS, 0, `<p class="flow-lede">How will you weigh in?</p>
      <div class="flow-options">${Object.values(METHODS).map((m) => `<button type="button" class="flow-option" data-method="${m.name}">
        <b>${m.name}</b><span>${m.how}</span><small>${m.text}</small></button>`).join('')}</div>`)
    body.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => weightMeasure(METHODS[b.dataset.method])))
  }

  // A short animation of the device, then the reading.
  function weightMeasure(m) {
    const track = m.name === 'SAMMD'
      ? `<div class="rig sammd"><span class="rig-body"></span><span class="rig-rail"></span><span class="rig-ticks"><i>0 m</i><i>1 m</i></span></div>`
      : `<div class="rig bmmd"><span class="rig-spring"></span><span class="rig-body"></span></div>`
    show(W_STEPS, 1, `<p class="flow-lede">${m.name} · ${m.how.toLowerCase()}</p>${track}
      <p class="flow-status"><span class="flow-spin"></span><span data-status>Hold still…</span></p>`)
    const status = body.querySelector('[data-status]')
    later(1200, () => { status.textContent = m.name === 'SAMMD' ? 'Measuring force over the track…' : 'Timing the oscillation…' })
    later(3200, () => weightConfirm(m, Math.round(STATS.bodyMass.value * 10) / 10))
  }

  function weightConfirm(m, measured) {
    show(W_STEPS, 2, `<p class="flow-lede">${m.name} measured <b>${measured.toFixed(1)} kg</b>. Correct it if the reading looks wrong.</p>
      <form class="flow-form">
        <label><span>Current mass</span><span class="flow-input"><input type="number" name="mass" step="0.1" min="40" max="120" value="${measured.toFixed(1)}" inputmode="decimal"><b>kg</b></span></label>
        <p class="flow-note">Last check-in: ${PREV_MASS.kg.toFixed(1)} kg · ${PREV_MASS.day}</p>
        <button type="submit" class="flow-primary">Save mass</button>
      </form>`)
    const form = body.querySelector('form')
    form.elements.mass.focus()
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const kg = Number(form.elements.mass.value)
      if (!Number.isFinite(kg) || kg < 40 || kg > 120) return form.elements.mass.focus()
      weightTrend(kg)
    })
  }

  function weightTrend(kg) {
    const loss = PREV_MASS.kg - kg
    const tone = loss <= LOSS_OK ? 'ok' : loss <= LOSS_MODERATE ? 'warn' : 'crit'
    const change = `${loss > 0 ? '−' : '+'}${Math.abs(loss).toFixed(1)} kg since ${PREV_MASS.day}`
    const text = {
      ok: [loss > 0 ? 'On track' : 'Holding steady', `${change}, within the expected ${LOSS_OK} kg a week. Your companion is unchanged.`],
      warn: ['Moderate weight loss', `${change}, more than the expected ${LOSS_OK} kg a week. ${ADVICE.massModerate}`],
      crit: ['Severe weight loss', `${change}, well over the expected ${LOSS_OK} kg a week. ${ADVICE.massSevere}`],
    }[tone]
    onResult('weight', { tone, value: kg, hint: tone === 'ok' ? '' : 'Losing weight fast', detail: change, warning: tone === 'ok' ? '' : `${text[0]}: ${text[1]}` })
    show(W_STEPS, 3, `${verdict(tone, text[0], text[1])}<button type="button" class="flow-primary" data-finish>Done</button>`)
    body.querySelector('[data-finish]').addEventListener('click', () => { close(); done() })
  }

  // ---------------------------------------------------------------- cardio
  const C_STEPS = ['Heart rate', 'Blood pressure', 'Summary']
  const results = {}

  function bpmMeasure() {
    show(C_STEPS, 0, `<p class="flow-lede">Reading heart rate from the wrist sensor…</p>
      <div class="flow-reading pulse"><span class="beat"></span><b data-val>--</b><span>bpm</span></div>
      <div class="flow-progress"><span></span></div>`)
    const val = body.querySelector('[data-val]')
    const samples = []
    every(300, () => {
      samples.push(STATS.hr.value)
      val.textContent = Math.round(STATS.hr.value)
    })
    later(4000, () => {
      stopTimers()
      bpmResult(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length))
    })
  }

  function bpmResult(bpm) {
    const s = STATS.hr
    const side = bpm <= s.warnLo ? 'low' : bpm > s.warnHi ? 'high' : null
    const tone = side ? 'crit' : 'ok'
    results.bpm = { tone, label: `${bpm} bpm`, side }
    const head = side ? `Heart rate ${side} · ${bpm} bpm` : `Average · ${bpm} bpm`
    const text = side ? ADVICE[side === 'high' ? 'hrHigh' : 'hrLow'] : 'Logged. Within the normal 60–100 bpm resting range.'
    // Mildly out of range makes the companion sad; far out (the red zone) makes it distressed.
    const mood = !side ? null : bpm <= s.critLo || bpm > s.critHi ? 'bad' : 'low'
    onResult('bpm', { tone, mood, value: bpm, hint: side ? `Heart rate ${side}` : '', detail: `${bpm} bpm`, warning: side ? `${head}. ${text}` : '' })
    show(C_STEPS, 0, `${verdict(tone, head, text)}<button type="button" class="flow-primary" data-next>Next: blood pressure</button>`)
    body.querySelector('[data-next]').addEventListener('click', bpMeasure)
  }

  function bpMeasure() {
    show(C_STEPS, 1, `<p class="flow-lede">Reading blood pressure from the cuff…</p>
      <div class="flow-reading"><b data-val>0</b><span>mmHg</span></div>
      <p class="flow-status"><span class="flow-spin"></span><span data-status>Inflating</span></p>`)
    const val = body.querySelector('[data-val]')
    const status = body.querySelector('[data-status]')
    const t0 = performance.now()
    // Inflate to 180 mmHg over 1.2 s, then deflate to 50 over 2.4 s, like a cuff.
    every(50, () => {
      const t = (performance.now() - t0) / 1000
      const p = t < 1.2 ? (t / 1.2) * 180 : Math.max(50, 180 - ((t - 1.2) / 2.4) * 130)
      if (t >= 1.2) status.textContent = 'Deflating'
      val.textContent = Math.round(p)
    })
    later(3700, () => {
      stopTimers()
      bpResult(Math.round(STATS.bpSys.value), Math.round(STATS.bpDia.value))
    })
  }

  function bpResult(sys, dia) {
    const side = sys > 129 || dia > 80 ? 'high' : sys < 90 || dia < 60 ? 'low' : null
    const tone = side ? 'crit' : 'ok'
    const label = `${sys}/${dia} mmHg`
    results.bp = { tone, label, side }
    const head = side ? `Blood pressure ${side} · ${label}` : `Average · ${label}`
    const text = side ? ADVICE[side === 'high' ? 'bpHigh' : 'bpLow'] : 'Logged. Within the normal range.'
    const mood = !side ? null : sys > 139 || sys < 80 ? 'bad' : 'low'
    onResult('bp', { tone, mood, value: [sys, dia], hint: side ? `Blood pressure ${side}` : '', detail: label, warning: side ? `${head}. ${text}` : '' })
    show(C_STEPS, 1, `${verdict(tone, head, text)}<button type="button" class="flow-primary" data-next>See summary</button>`)
    body.querySelector('[data-next]').addEventListener('click', cardioSummary)
  }

  function cardioSummary() {
    const row = (name, r) => `<li><span>${name}</span><b>${r.label}</b><span class="flow-chip ${r.tone}">${r.tone === 'ok' ? 'Average' : r.side === 'high' ? 'High' : 'Low'}</span></li>`
    show(C_STEPS, 2, `<ul class="flow-summary">${row('Heart rate', results.bpm)}${row('Blood pressure', results.bp)}</ul>
      <button type="button" class="flow-primary" data-finish>Done</button>`)
    body.querySelector('[data-finish]').addEventListener('click', () => { close(); done() })
  }

  // ---------------------------------------------------------------- open
  const FLOWS = {
    weight: { title: 'Weight check-in', start: weightMethod },
    cardio: { title: 'Cardio check', start: bpmMeasure },
  }
  function open(kind, onDone = () => {}) {
    stopTimers()
    done = onDone
    title.textContent = FLOWS[kind].title
    el.hidden = false
    onOpen?.()
    FLOWS[kind].start()
  }

  return { el, open }
}
