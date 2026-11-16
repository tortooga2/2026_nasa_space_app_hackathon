// Keyboard + mouse state with per-frame edges. Call endFrame() once at the end of each frame.
export class Input {
  constructor(element) {
    this.element = element
    this.keys = new Set()
    this.keysPressed = new Set()
    this.buttons = new Set()
    this.buttonsPressed = new Set()
    this.buttonsReleased = new Set()
    this.mouseDX = 0
    this.mouseDY = 0
    this.wheel = 0
    this.locked = false

    this._onKeyDown = (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault()
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code)
      this.keys.add(e.code)
    }
    this._onKeyUp = (e) => this.keys.delete(e.code)
    this._onMouseDown = (e) => {
      this.buttons.add(e.button)
      this.buttonsPressed.add(e.button)
    }
    this._onMouseUp = (e) => {
      this.buttons.delete(e.button)
      this.buttonsReleased.add(e.button)
    }
    this._onMouseMove = (e) => {
      if (!this.locked) return
      this.mouseDX += e.movementX || 0
      this.mouseDY += e.movementY || 0
    }
    this._onWheel = (e) => (this.wheel += e.deltaY)
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.element
      if (!this.locked) {
        this.keys.clear()
        this.buttons.clear()
      }
    }
    this._onContext = (e) => e.preventDefault()
    this._onBlur = () => {
      this.keys.clear()
      this.buttons.clear()
    }

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup', this._onMouseUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('wheel', this._onWheel, { passive: true })
    window.addEventListener('contextmenu', this._onContext)
    window.addEventListener('blur', this._onBlur)
    document.addEventListener('pointerlockchange', this._onLockChange)
  }

  requestLock() {
    try {
      const p = this.element.requestPointerLock?.()
      p?.catch?.(() => {})
    } catch {
      // Pointer lock is optional; mouse look just won't engage.
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  down(code) { return this.keys.has(code) }
  pressed(code) { return this.keysPressed.has(code) }
  mouseDown(btn) { return this.buttons.has(btn) }
  mousePressed(btn) { return this.buttonsPressed.has(btn) }
  mouseReleased(btn) { return this.buttonsReleased.has(btn) }

  endFrame() {
    this.keysPressed.clear()
    this.buttonsPressed.clear()
    this.buttonsReleased.clear()
    this.mouseDX = 0
    this.mouseDY = 0
    this.wheel = 0
  }
}
