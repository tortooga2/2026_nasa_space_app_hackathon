import * as THREE from 'three'
import { Input } from './core/input.js'
import { PhysicsWorld } from './core/physics.js'
import { Player } from './core/player.js'
import { Hud } from './ui/hud.js'
import { createStation } from './scenes/station.js'
import { createPlanet } from './scenes/planet.js'
import { createSpacewalk } from './scenes/spacewalk.js'

const LEVELS = { station: createStation, planet: createPlanet, spacewalk: createSpacewalk }

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.getElementById('app').appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 3000)
const input = new Input(renderer.domElement)
const hud = new Hud(document.getElementById('hud'))

let level = null
let scene = null
let physics = null
let player = null
let started = false
let traveling = false

function load(id) {
  if (level) level.dispose()
  if (player) player.dispose()
  if (physics) physics.dispose()

  scene = new THREE.Scene()
  physics = new PhysicsWorld(scene)
  const ctx = { THREE, scene, physics, camera, renderer, hud }
  level = LEVELS[id](ctx)

  physics.setGravity(level.gravity)
  physics.setColliders(level.colliders)

  player = new Player({ camera, input, physics, scene, hud })
  player.setEnvironment({ gravity: level.gravity, movement: level.movement })
  player.teleport(level.spawn.position, level.spawn.yaw)

  hud.setLocation(level)
  hud.notify(`ARRIVED: ${level.name}`)
}

function travel(target) {
  if (traveling) return
  traveling = true
  hud.closeEntry()
  hud.transition(() => {
    load(target)
    traveling = false
  })
}

// Nearest interactable the player is looking at.
const _toTarget = new THREE.Vector3()
const _look = new THREE.Vector3()
const _eye = new THREE.Vector3()
function findTarget() {
  player.head.getWorldPosition(_eye)
  camera.getWorldDirection(_look)
  let best = null
  let bestScore = Infinity
  const consider = (item, kind) => {
    _toTarget.subVectors(item.position, _eye)
    const dist = _toTarget.length()
    if (dist > (item.radius ?? 2.5) + 1.5) return
    const facing = _toTarget.normalize().dot(_look)
    if (facing < 0.75 && dist > 1.2) return
    const score = dist * (2 - facing)
    if (score < bestScore) {
      bestScore = score
      best = { item, kind }
    }
  }
  for (const poi of level.pois) consider(poi, 'poi')
  for (const portal of level.portals) consider(portal, 'portal')
  return best
}

const timer = new THREE.Timer()
timer.connect(document)
let elapsed = 0

function frame(timestamp) {
  requestAnimationFrame(frame)
  timer.update(timestamp)
  const dt = Math.min(timer.getDelta(), 1 / 30)
  if (!level) return
  elapsed += dt

  if (started && !traveling) {
    if (input.pressed('Tab')) hud.toggleDevice()
    const paused = hud.isDeviceOpen()

    if (!paused) {
      player.update(dt)
      physics.step(dt)
    }
    level.update(dt, elapsed, player)

    const target = paused ? null : findTarget()
    hud.setTarget(target?.kind === 'poi' ? target.item : null)
    if (hud.isEntryOpen()) {
      hud.showPrompt('[E] Close readout')
      if (input.pressed('KeyE') || input.pressed('Escape')) hud.closeEntry()
    } else if (target) {
      const label = target.kind === 'poi' ? `[E] Scan: ${target.item.title}` : `[E] ${target.item.label}`
      hud.showPrompt(label)
      if (input.pressed('KeyE')) {
        if (target.kind === 'poi') hud.openEntry(target.item)
        else travel(target.item.target)
      }
    } else {
      hud.showPrompt(null)
    }

    hud.update(dt, { ...player.telemetry(), scene: level.id, gravity: level.gravity })
  } else {
    level.update(dt, elapsed, player)
  }

  renderer.render(scene, camera)
  input.endFrame()
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// Clicking the canvas re-captures the mouse after Esc.
renderer.domElement.addEventListener('click', () => {
  if (started && !input.locked && !hud.isDeviceOpen()) input.requestLock()
})

load('station')
hud.showTitle(() => {
  started = true
  input.requestLock()
})
frame()
