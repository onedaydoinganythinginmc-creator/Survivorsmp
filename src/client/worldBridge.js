// SURVIVOR SMP - client world adapters.
// The exact same shared runtime powers both modes:
//  - OnlineAdapter: real single shared SMP server via WebSocket
//  - OfflineAdapter: local solo world (published static build / no server)
import { WorldRuntime } from '../shared/worldRuntime.js'
import { generateWorld } from '../shared/worldgen.js'
import { PLAYER_BASE } from '../shared/constants.js'

export class OfflineAdapter {
  constructor(seed, localStorageKey, name) {
    this.storageKey = localStorageKey
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(localStorageKey) || 'null') } catch {}
    this.runtime = new WorldRuntime(saved && saved.seed ? saved.seed : seed)
    if (saved) this.runtime.load(saved)
    this.playerToken = 'local-' + (localStorage.getItem('smp_local_token') || (() => {
      const t = 'local' + Math.random().toString(36).slice(2, 12)
      localStorage.setItem('smp_local_token', t)
      return t
    })())
    this.localPlayer = this.runtime.join(this.playerToken, name || '')
    this.localPlayer.name = name || this.localPlayer.name
    this.runtime.players.get(this.playerToken).online = true
    this.events = []
    this.lastSave = 0
    this.runtime.emit = (p, ev) => { if (p === this.localPlayer) this.events.push(ev) }
  }
  get mode() { return 'offline' }
  get online() { return false }
  get time() { return this.runtime.time }
  get seed() { return this.runtime.seed }
  self() { return this.localPlayer }
  levelId() { return this.localPlayer.levelId }
  level() { return this.runtime.getLevel(this.localPlayer.levelId) }
  tiles(levelId) { return this.runtime.getLevel(levelId) }
  othersAround() {
    const p = this.localPlayer
    return [...this.runtime.players.values()].filter(q => q !== p && q.online && q.levelId === p.levelId)
      .map(q => ({ id: q.token, name: q.name, x: q.x, y: q.y, dir: q.dir, hp: q.hp, maxHp: q.maxHp, lvl: q.lvl, hue: q.hue, dead: q.dead }))
  }
  ents() { return this.level().ents }
  drops() { return [...this.level().drops.values()].map(d => ({ id: d.id, item: d.item, x: d.x, y: d.y })) }
  objects() { return [...this.level().objects.values()] }
  move(nx, ny, dir, sprint) {
    const p = this.localPlayer
    if (p.dead) return
    const maxStep = PLAYER_BASE.speed * PLAYER_BASE.sprintMult * 0.05 * 2.5
    const dx = nx - p.x, dy = ny - p.y
    const d = Math.hypot(dx, dy)
    const lv = this.level()
    const tryPos = (x, y) => !this.runtime.posSolid(lv, x, y)
    let fx = p.x, fy = p.y
    if (d <= maxStep) { fx = nx; fy = ny }
    else { fx = p.x + dx / d * maxStep; fy = p.y + dy / d * maxStep }
    if (!tryPos(fx, fy)) {
      if (tryPos(fx, p.y)) fy = p.y
      else if (tryPos(p.x, fy)) fx = p.x
      else { fx = p.x; fy = p.y }
    }
    p.x = fx; p.y = fy
    if (dir !== undefined) { p.dir = dir; p.face = dir > 0 ? 1 : -1 }
    p._moving = d > 1
    if (sprint && p.stamina > 1 && p._moving) p.stamina = Math.max(0, p.stamina - 0.2)
  }
  act(type, payload) {
    const err = this.runtime.handleAction(this.localPlayer, { t: type, ...payload })
    if (err) this.events.push({ type: 'err', msg: err })
    return err
  }
  respawn() { this.act('respawn', {}) }
  name() { return this.localPlayer.name }
  onlineCount() { return 1 }
  drainEvents() { const e = this.events; this.events = []; return e }
  tick(dt) {
    this.runtime.tick(Math.min(dt, 0.25))
    this.runtime.autoPickup()
    const now = performance.now()
    if (this.runtime.dirty && now - this.lastSave > 5000) {
      this.lastSave = now
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.runtime.serialize())) } catch (e) {
        console.warn('localStorage save failed', e)
      }
      this.runtime.markSaved()
    }
  }
  saveNow() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.runtime.serialize())) } catch {}
    this.runtime.markSaved()
  }
}

export class OnlineAdapter {
  constructor(wsBase, token, name, onFail) {
    this.mode = 'online'
    this.token = token
    this.playerName = name
    this.onFail = onFail
    this.events = []
    this.connected = false
    this.joined = false
    this._self = null
    this.gen = null // client-side worldgen mirror (tiles/baselines by seed)
    this.world = {
      time: { t: 0.3, day: 1 }, seed: 1708301, entrances: [],
      otherPlayers: [], overrides: {}, // levelId -> Map(objId -> obj)
    }
    this.localPose = { x: null, y: null, dir: 0 }
    this.lastMoveSent = 0
    this.connect(wsBase)
  }
  connect(wsBase) {
    try { this.ws = new WebSocket(wsBase) } catch { this.onFail && this.onFail(); return }
    const tryFail = () => { this.connected = false; this.joined = false; if (!(this.ws && this.ws.readyState === 1)) this.onFail && this.onFail() }
    this.ws.onopen = () => {
      this.connected = true
      this.ws.send(JSON.stringify({ t: 'j', token: this.token, name: this.playerName }))
    }
    this.ws.onclose = tryFail
    this.ws.onerror = tryFail
    this.ws.onmessage = (m) => {
      let msg
      try { msg = JSON.parse(m.data) } catch { return }
      this.handle(msg)
    }
  }
  handle(msg) {
    switch (msg.t) {
      case 'hello': break
      case 'init':
        this.joined = true
        this.world.seed = msg.seed
        this.world.time = msg.time
        this.world.entrances = msg.entrances || []
        try { this.gen = generateWorld(msg.seed) } catch { this.gen = null }
        this._self = msg.me
        this.localPose.x = msg.me.x; this.localPose.y = msg.me.y
        this.otherPlayers = msg.online || []
        if (this.onInit) this.onInit(msg)
        break
      case 'sn': this.applySnapshot(msg); break
      case 'ev': if (msg.ev) this.events.push(msg.ev); break
      case 'err': this.events.push({ type: 'err', msg: msg.msg }); break
    }
  }
  applySnapshot(s) {
    this.world.time = { t: s.time, day: s.day }
    this.clock = s.now
    this.otherPlayers = s.players || []
    this._ents = s.ents || []
    this._drops = s.drops || []
    const prevLevel = this._lastLv
    this._self = s.me
    if (prevLevel !== undefined && prevLevel !== this._self.levelId) this.world.overrides = {} // level switch resets
    this._lastLv = this._self.levelId
    // authoritative pose correction only on big drift (keep prediction smooth)
    if (this.localPose.x != null) {
      const drift = Math.hypot(this._self.x - this.localPose.x, this._self.y - this.localPose.y)
      if (drift > 64) { this.localPose.x = this._self.x; this.localPose.y = this._self.y }
      else if (drift < 1.5) { this.localPose.x = this._self.x; this.localPose.y = this._self.y }
    }
    // object overrides merge (never deleted: server diff keeps session-side caches)
    let ov = this.world.overrides[this._self.levelId]
    if (!ov) ov = this.world.overrides[this._self.levelId] = new Map()
    for (const o of s.objsAdd || []) ov.set(o.i, o)
  }
  get online() { return this.joined && this.connected && this.ws && this.ws.readyState === 1 }
  get time() { return this.world.time }
  get seed() { return this.world.seed }
  self() {
    const s = this._self
    if (!s) return null
    return { ...s, x: this.localPose.x ?? s.x, y: this.localPose.y ?? s.y, dir: this.localPose.dir ?? 0 }
  }
  levelId() { return this._self ? this._self.levelId : 0 }
  level() { return { id: this.levelId() } }
  tiles(levelId) {
    if (!this.gen) return null
    return levelId === 0 ? this.gen.surface : this.gen.caves[levelId - 1]
  }
  othersAround() { return this.otherPlayers || [] }
  ents() { return this._ents || [] }
  drops() { return this._drops || [] }
  objects() {
    const id = this.levelId()
    const ov = this.world.overrides[id]
    if (!ov || !ov.size) return []
    return [...ov.values()]
  }
  move(nx, ny, dir, sprint) {
    this.localPose.x = nx
    this.localPose.y = ny
    if (dir !== undefined) this.localPose.dir = dir
    const now = performance.now()
    if (now - this.lastMoveSent > 110) {
      this.lastMoveSent = now
      this.send({ t: 'move', x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100, dir, sprint: !!sprint })
    }
  }
  act(type, payload) { this.send({ t: 'a', a: { t: type, ...payload } }) }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)) } catch {} }
  }
  respawn() { this.send({ t: 'respawn' }) }
  name() { return this._self ? this._self.name : this.playerName }
  onlineCount() { return (this.otherPlayers || []).length + 1 }
  drainEvents() { const e = this.events; this.events = []; return e }
  tick() { /* server ticks; client only renders + predicts */ }
  saveNow() {}
}

export function makeToken() {
  try {
    let t = localStorage.getItem('smp_token')
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : 'tk' + Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 32)
      localStorage.setItem('smp_token', t)
    }
    return t
  } catch { return 'tk' + Math.random().toString(36).slice(2) + Date.now().toString(36) }
}

export function detectServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}
