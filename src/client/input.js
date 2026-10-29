// SURVIVOR SMP - input: touch joystick + action buttons + keyboard
export class Input {
  constructor(canvas) {
    this.canvas = canvas
    this.keys = {}
    this.joy = { active: false, dx: 0, dy: 0, mag: 0 }
    this.aimAng = 0
    this.attackQueued = false
    this.interactQueued = false
    this.justTapped = false // tap-to-aim world position (desktop)
    this.viewport = { x: 0, y: 0, w: 1, h: 1, zoom: 1 }
    this.bind()
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return
      this.keys[e.key.toLowerCase()] = true
      if (e.key === ' ') { this.attackQueued = true; e.preventDefault() }
      if (e.key.toLowerCase() === 'e') this.interactQueued = true
    })
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false
    })
    // desktop aim via mouse position
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this.tapWorld = this.toWorld(e.clientX, e.clientY)
      this.justTapped = true
    })
    this.canvas.addEventListener('mousemove', (e) => {
      this.tapWorld = this.toWorld(e.clientX, e.clientY)
    })
    // joystick (pointer events, multi-touch safe)
    const joyWebView = document.getElementById('joy')
    const stick = document.getElementById('joyStick')
    let joyId = null
    const joyCenter = () => {
      const r = joyWebView.getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    }
    const setStick = (dx, dy) => {
      const len = Math.hypot(dx, dy) || 1
      const clamped = Math.min(len, 55)
      stick.style.transform = `translate(${dx / len * clamped}px, ${dy / len * clamped}px)`
      return Math.min(1, clamped / 55)
    }
    joyWebView.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId
      joyWebView.setPointerCapture(e.pointerId)
      this.joy.active = true
      e.preventDefault()
    })
    joyWebView.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return
      const [cx, cy] = joyCenter()
      const dx = e.clientX - cx, dy = e.clientY - cy
      const mag = setStick(dx, dy)
      const len = Math.hypot(dx, dy) || 1
      this.joy.dx = dx / len
      this.joy.dy = dy / len
      this.joy.mag = mag
      if (mag > 0.15) this.aimAng = Math.atan2(dy, dx)
      e.preventDefault()
    })
    const releaseJoy = (e) => {
      if (e.pointerId !== joyId && joyId !== null) return
      joyId = null
      this.joy.active = false
      this.joy.mag = 0
      this.joy.dx = 0
      this.joy.dy = 0
      stick.style.transform = 'translate(0px, 0px)'
    }
    joyWebView.addEventListener('pointerup', releaseJoy)
    joyWebView.addEventListener('pointercancel', releaseJoy)
  }

  toWorld(cx, cy) {
    const v = this.viewport
    const dpr = window.devicePixelRatio || 1
    const vwCss = this.canvas.clientWidth
    const vhCss = this.canvas.clientHeight
    const worldW = this.canvas.width / v.zoom / dpr
    const worldH = this.canvas.height / v.zoom / dpr
    const x = cx / vwCss * worldW + (v.camX || 0)
    const y = cy / vhCss * worldH + (v.camY || 0)
    return { x, y }
  }

  moveVector() {
    let dx = 0, dy = 0
    if (this.joy.mag > 0.12) { dx = this.joy.dx; dy = this.joy.dy }
    if (this.keys['w'] || this.keys['arrowup']) dy -= 1
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1
    if (this.keys['d'] || this.keys['arrowright']) dx += 1
    const mag = Math.hypot(dx, dy)
    if (mag > 0) {
      dx /= mag; dy /= mag
      return { dx, dy, mag: Math.min(1, mag + (this.joy.mag > 0.12 ? this.joy.mag - 0.5 : 0)) || 1 }
    }
    return null
  }

  sprint() { return this.keys['shift'] || this.joy.mag > 0.92 }

  consumeTap() {
    const t = this.justTapped
    this.justTapped = false
    return t ? this.tapWorld : null
  }

  consumeAttack() {
    const a = this.attackQueued
    this.attackQueued = false
    return a
  }

  consumeInteract() {
    const i = this.interactQueued
    this.interactQueued = false
    return i
  }
}
