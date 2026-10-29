// SURVIVOR SMP - multiplayer session layer: WebSocket frames, protocol, snapshots, saves.


const MAX_MSG = 1 << 20

// ----------------------------------------------------------------- WS framing
class WsConn {
  constructor(socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.fragments = []
    this.fragmentOp = -1
    this.closed = false
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
    socket.setNoDelay(true)
  }
  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (true) {
      if (this.buf.length < 2) return
      const b0 = this.buf[0], b1 = this.buf[1]
      const fin = !!(b0 & 0x80)
      const op = b0 & 0x0f
      const masked = !!(b1 & 0x80)
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2); off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        const big = this.buf.readBigUInt64BE(2)
        if (big > BigInt(MAX_MSG)) { this.close(); return }
        len = Number(big); off = 10
      }
      if (len > MAX_MSG) { this.close(); return }
      const maskBytes = masked ? 4 : 0
      if (this.buf.length < off + maskBytes + len) return
      const mask = masked ? this.buf.subarray(off, off + 4) : null
      let payload = this.buf.subarray(off + maskBytes, off + maskBytes + len)
      if (mask) {
        const un = Buffer.allocUnsafe(len)
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3]
        payload = un
      }
      this.buf = this.buf.subarray(off + maskBytes + len)
      if (op === 8) { this.close(); return }        // close
      else if (op === 9) { this.socket.write(WsConn.frame(10, payload)); continue } // ping -> pong
      else if (op === 10) continue                  // pong
      else if (op === 1 || op === 2 || op === 0) {
        if (op !== 0 && fin) { this.onMessage(op, payload); continue }
        // fragmented message
        if (op !== 0) { this.fragmentOp = op; this.fragments = [payload] }
        else this.fragments.push(payload)
        if (fin) {
          const whole = Buffer.concat(this.fragments)
          const fop = this.fragmentOp
          this.fragments = []
          this.fragmentOp = -1
          this.onMessage(fop, whole)
        }
      }
    }
  }
  static frame(op, payload) {
    const len = payload.length
    let head
    if (len < 126) {
      head = Buffer.from([0x80 | op, len])
    } else if (len < 65536) {
      head = Buffer.alloc(4)
      head[0] = 0x80 | op; head[1] = 126
      head.writeUInt16BE(len, 2)
    } else {
      head = Buffer.alloc(10)
      head[0] = 0x80 | op; head[1] = 127
      head.writeBigUInt64BE(BigInt(len), 2)
    }
    return Buffer.concat([head, payload])
  }
  onMessage(op, payload) {
    if (op !== 1) return
    try {
      const text = payload.toString('utf8')
      if (text.length > 1024) return
      this.emit && this.emit(JSON.parse(text))
    } catch { /* protocol garbage – ignore */ }
  }
  sendText(obj) {
    if (this.closed) return
    try { this.socket.write(WsConn.frame(1, Buffer.from(JSON.stringify(obj), 'utf8'))) } catch { this.close() }
  }
  sendPing() {
    if (!this.closed) { try { this.socket.write(WsConn.frame(9, Buffer.alloc(0))) } catch { this.close() } }
  }
  close() {
    if (this.closed) return
    this.closed = true
    try { this.socket.end() } catch {}
    if (this.onClose) setTimeout(() => this.onClose(), 10)
  }
}

// ----------------------------------------------------------------- game server
export class GameServer {
  constructor(world, { snapshotHz = 8, saveInterval = 8, saveWorld, loadSave } = {}) {
    this.world = world
    this.snapshotEvery = 1000 / snapshotHz
    this.saveEveryMs = saveInterval * 1000
    this.saveWorld = saveWorld
    this.loadSave = loadSave
    this.clients = new Map() // WsConn -> session
    this.lastSaveOk = 0
    const dt = 0.1
    this.tickTimer = setInterval(() => {
      try { world.tick(dt); world.autoPickup() } catch (e) { console.error('[game] tick error', e) }
    }, 100)
    this.snapTimer = setInterval(() => this.broadcastSnapshots(), this.snapshotEvery)
    this.saveTimer = setInterval(() => this.maybeSave(), this.saveEveryMs)

    // feed runtime events
    const self = this
    world.emit = (p, ev) => self.dispatchEv(ev, p)
  }

  pathOk(url) { return url === '/ws' || url.startsWith('/ws?') }

  attachClient(socket) {
    const conn = new WsConn(socket)
    const session = { conn, token: null, player: null, objCache: new Map(), lastSeq: -1, lastSeen: Date.now(), alive: false }
    conn.onClose = () => this.onDisconnect(conn, session)
    conn.emit = (msg) => this.onMessage(session, msg)
    this.clients.set(conn, session)
    conn.sendText({ t: 'hello', time: this.world.time, seed: this.world.seed })
  }

  onMessage(session, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return
    session.lastSeen = Date.now()
    const world = this.world
    switch (msg.t) {
      case 'j': {
        const token = typeof msg.token === 'string' && msg.token.length >= 10 && msg.token.length <= 64 ? msg.token : null
        if (!token) { session.conn.sendText({ t: 'err', msg: 'Token không hợp lệ.' }); return }
        const name = String(msg.name || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16) || 'Survivor'
        session.token = token
        session.player = world.join(token, name)
        world.players.get(token).online = true
        session.player = world.players.get(token)
        const p = session.player
        if (p.dead) {
          // restore death position snapshot-side; kept for honesty
        }
        session.objCache.clear()
        session.conn.sendText({
          t: 'init', now: world.clock, time: world.time, seed: world.seed, day: world.time.day,
          me: world.selfState(p), online: world.online().map(q => world.playerPub(q)),
          entrances: world.gen.surface.entrances,
        })
        this.sendSnapshot(session, true)
        return
      }
      case 'move': {
        if (!session.player) return
        const err = world.handleAction(session.player, { t: 'move', x: clampN(msg.x), y: clampN(msg.y), dir: msg.dir === undefined ? undefined : clampN(msg.dir), sprint: !!msg.sprint })
        if (err === 'detect-cheat') this.sendSnapshot(session, true) // force correction
        return
      }
      case 'a': {
        if (!session.player) return
        const act = sanitizeAction(msg.a)
        if (!act) return
        const err = world.handleAction(session.player, act)
        if (err) session.conn.sendText({ t: 'ev', ev: { type: 'err', msg: err } })
        return
      }
      case 'respawn': {
        if (!session.player) return
        world.handleAction(session.player, { t: 'respawn' })
        return
      }
      case 'pose': {
        // idle keepalive with no movement
        return
      }
      case 'resetdiff': {
        session.objCache.clear()
        return
      }
    }
  }

  sendSnapshot(session, force = false) {
    const p = session.player
    if (!p) return
    const snap = this.world.snapshotFor(p)
    // object diffing against per-session cache
    const cache = session.objCache
    const objsAdd = [], objsDel = []
    const seen = new Set()
    for (const o of snap.objs) {
      seen.add(o.i)
      const key = `${o.alive ? 1 : 0}|${Math.round(o.hp)}|${o.cver || 0}|${o.open ? 1 : 0}|${o.respawnAt ? 1 : 0}|${o.entranceId ?? ''}`
      if (cache.get(o.i) !== key) {
        cache.set(o.i, key)
        objsAdd.push(o)
      }
    }
    for (const [id] of cache) if (!seen.has(id)) objsDel.push(id)
    for (const id of objsDel) cache.delete(id)
    const payload = {
      t: 'sn', now: snap.now, time: snap.time, day: snap.day, me: snap.me, players: snap.players, ents: snap.ents, drops: snap.drops,
      objsAdd, objsDel,
    }
    if (force && objsAdd.length > 4000) { /* clamp pathological case */ }
    session.conn.sendText(payload)
  }

  broadcastSnapshots() {
    for (const [conn, session] of this.clients) {
      if (!session.player || conn.closed) continue
      this.sendSnapshot(session)
    }
  }

  dispatchEv(ev, targetPlayer) {
    if (targetPlayer) {
      for (const [conn, session] of this.clients) {
        if (session.player === targetPlayer) { conn.sendText({ t: 'ev', ev }); return }
      }
      return
    }
    for (const [conn, session] of this.clients) conn.sendText({ t: 'ev', ev })
  }

  onDisconnect(conn, session) {
    if (session.player) session.player.online = false
    this.clients.delete(conn)
    // save soon; prevent item dupe via disconnect events
    setImmediate(() => this.maybeSave(true))
  }

  maybeSave(force) {
    if (!this.world.dirty && !force) return
    const json = JSON.stringify(this.world.serialize())
    if (json.length > 64 << 20) { console.error('[game] world too large to save'); return }
    try {
      this.saveWorld(json)
      this.world.markSaved()
      this.lastSaveOk = Date.now()
    } catch (e) {
      console.error('[game] save failed', e)
    }
  }

  saveNow() { this.maybeSave(true) }
}

function clampN(v) {
  const n = Number(v)
  if (!isFinite(n)) return undefined
  return Math.max(-1e6, Math.min(1e6, Math.round(n * 100) / 100))
}

function sanitizeAction(a) {
  if (!a || typeof a !== 'object' || typeof a.t !== 'string') return null
  const copyT = a.t
  const out = { t: copyT }
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : undefined }
  for (const k of ['x', 'y', 'from', 'qty'])
    if (a[k] !== undefined) out[k] = num(a[k]) ?? undefined
  if (typeof a.id === 'string' && a.id.length <= 96) out.id = a.id
  if (typeof a.objId === 'string' && a.objId.length <= 96) out.objId = a.objId
  if (typeof a.kind === 'string' && a.kind.length <= 24) out.kind = a.kind
  if (typeof a.slot === 'string' && a.slot.length <= 8) out.slot = a.slot
  if (typeof a.slotType === 'string' && a.slotType.length <= 8) out.slotType = a.slotType
  if (typeof a.op === 'string' && a.op.length <= 8) out.op = a.op
  if (a.sprint !== undefined) out.sprint = !!a.sprint
  return out
}
