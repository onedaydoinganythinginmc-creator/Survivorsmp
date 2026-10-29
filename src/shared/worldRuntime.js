// SURVIVOR SMP - authoritative world runtime.
// Pure ES module, no DOM/node deps. Used by the game server (multiplayer)
// and by the client (offline solo world fallback) so both behave identically.
import {
  TILE, WORLD_W, WORLD_H, DAY_LENGTH, NIGHT_START, NIGHT_END, DROP_LIFETIME, isNight,
  PLAYER_BASE, VIEW_RADIUS, OBJECT_RESPAWN, BIOME, TERRAIN_SOLID, ENTITY_TYPES,
  NIGHT_SPAWN_CAP_PER_PLAYER, CAVE_SPAWN_CAP_PER_PLAYER, CAVE_LEVELS, BUILDS,
} from './constants.js'
import { ITEMS, repairCost } from './items.js'
import { RECIPES, canAfford, BUILD_FORGE } from './recipes.js'
import { generateWorld, RESOURCE_HP, ORE_TIER, ORE_DROPS, findFloorNear } from './worldgen.js'

const INV_SIZE = 24
const CHEST_SLOTS = 18
const NEAR_STATION = 3.2 // tiles


function prng(seed) {
  let a = seed | 0
  return () => {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- world state
export class WorldRuntime {
  constructor(seed = 1708301) {
    this.seed = seed
    this.gen = generateWorld(seed)
    this.levels = {}
    this.players = new Map() // token -> player (runtime fields + persisted data)
    this.time = { t: 0.25, day: 1 }
    this.clock = 0 // seconds elapsed
    this.dirty = true
    this.emitEv = () => {}
    this.emit = () => {}
    this.rng = prng(seed ^ 0xA5C3)
    this.initLevels()
    this.surfacePopulate()
  }

  initLevels() {
    const mk = (base, idx) => {
      const objects = new Map()
      for (const o of base.objects) objects.set(o.i, { ...o })
      return { idx, w: base.w, h: base.h, tiles: base.tiles, objects, ents: [], drops: new Map(), nextEnt: 1, nextDrop: 1, bossPos: base.bossPos || null }
    }
    this.levels['0'] = mk(this.gen.surface, 0)
    for (let L = 0; L < this.gen.caves.length; L++) this.levels[String(L + 1)] = mk(this.gen.caves[L], L + 1)
  }

  static mkItem(id, qty, dur = null) {
    const def = ITEMS[id]
    if (def && def.dur != null && dur == null) dur = def.dur
    return { id, qty, dur }
  }

  static invAdd(inv, id, qty, dur = null) {
    let left = qty
    const def = ITEMS[id]
    // merge first
    if (!dur && def && def.stack > 1) {
      for (let i = 0; i < inv.length && left > 0; i++) {
        const s = inv[i]
        if (s && s.id === id && s.qty < def.stack) {
          const add = Math.min(def.stack - s.qty, left)
          s.qty += add; left -= add
        }
      }
    }
    while (left > 0) {
      const slot = inv.findIndex(s => !s)
      if (slot < 0) break
      const put = Math.min(def ? def.stack : 99, left)
      inv[slot] = WorldRuntime.mkItem(id, put, dur !== null ? Math.min(dur, left) : null)
      left -= put
    }
    return qty - left // added count
  }

  static invCount(inv, id) {
    let n = 0
    for (const s of inv) if (s && s.id === id) n += s.qty
    return n
  }

  static invConsume(inv, id, qty) {
    let left = qty
    for (let i = 0; i < inv.length && left > 0; i++) {
      const s = inv[i]
      if (!s || s.id !== id) continue
      const take = Math.min(s.qty, left)
      left -= take
      s.qty -= take
      if (s.qty <= 0) inv[i] = null
    }
    return qty - left
  }

  surfacePopulate() {
    const lv = this.levels['0']
    const spawnSet = (type, count, biomes) => {
      for (let n = 0; n < count; n++) {
        const p = this.spawnableTile(lv, biomes, 24, null)
        if (p) this.addEntity(lv, type, p[0], p[1])
      }
    }
    spawnSet('rabbit', 26, [BIOME.GRASS, BIOME.MEADOW, BIOME.SAND])
    spawnSet('deer', 16, [BIOME.GRASS, BIOME.MEADOW, BIOME.FOREST])
    spawnSet('boar', 14, [BIOME.FOREST, BIOME.MEADOW])
    spawnSet('wolf', 10, [BIOME.FOREST, BIOME.ROCK])
  }

  spawnableTile(lv, biomes, margin = 6, awayFrom = null) {
    const R = this.rng
    for (let k = 0; k < 80; k++) {
      const tx = margin + ((R() * (lv.w - margin * 2)) | 0)
      const ty = margin + ((R() * (lv.h - margin * 2)) | 0)
      const b = lv.tiles[ty * lv.w + tx]
      if (biomes && !biomes.includes(b)) continue
      if (!this.levelTileFree(lv, tx, ty)) continue
      if (awayFrom && Math.hypot(awayFrom[0] - tx, awayFrom[1] - ty) < 15) continue
      return [tx, ty]
    }
    return null
  }

  // ---------------------------------------------------------------- helpers
  tileToWorld(t) { return t * TILE + TILE / 2 }
  levelOf(pid) { return this.levels[String(pid & 7)] }

  getLevel(levelId) { return this.levels[String(levelId)] ?? this.levels['0'] }

  terrainSolid(lv, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return true
    return TERRAIN_SOLID.has(lv.tiles[ty * lv.w + tx])
  }

  tileBlocking(lv, tx, ty) { // solid object or terrain?
    if (this.terrainSolid(lv, tx, ty)) return true
    for (const o of lv.objects.values()) {
      if (o.x === tx && o.y === ty && o.alive) {
        const bd = o.t.startsWith('b:') ? BUILDS[o.t.slice(2)] : null
        if (o.t === 'tree' || o.t === 'rock' || o.t.startsWith('ore_') || (bd && bd.solid) || (bd && o.t === 'b:door' && !o.open)) return true
      }
    }
    return false
  }

  levelTileFree(lv, tx, ty) {
    if (this.terrainSolid(lv, tx, ty)) return false
    for (const o of lv.objects.values()) {
      if (o.x === tx && o.y === ty && o.alive && o.t !== 'cave_entrance' && o.t !== 'cave_exit') return false
    }
    return true
  }

  posSolid(lv, x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE)
    return this.tileBlocking(lv, tx, ty)
  }

  nearStation(lv, x, y, kinds) {
    const px = Math.floor(x / TILE), py = Math.floor(y / TILE)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > NEAR_STATION * NEAR_STATION) continue
      for (const o of lv.objects.values()) {
        if (!o.alive || o.x !== px + dx || o.y !== py + dy) continue
        if (o.t.startsWith('b:') && kinds.includes(o.t.slice(2) === 'hammer_anvil' ? 'anvil' : o.t.slice(2))) return o.t.slice(2)
      }
    }
    return null
  }

  addEntity(lv, type, tx, ty, over = {}) {
    const def = ENTITY_TYPES[type]
    if (!def) return null
    const e = {
      id: `e${lv.nextEnt++}`, type, x: this.tileToWorld(tx), y: this.tileToWorld(ty),
      hp: def.hp, max: def.hp, vx: 0, vy: 0, atkCd: 0, wanderCd: 0, fleeT: 0,
      boss: def.boss || false, ...over,
    }
    lv.ents.push(e)
    return e
  }

  addDrop(lv, x, y, itemId, qty, dur = null) {
    if (qty <= 0) return
    const d = { id: `d${lv.nextDrop++}`, item: WorldRuntime.mkItem(itemId, qty, dur), x, y, expire: this.clock + DROP_LIFETIME, vx: 0, vy: 0 }
    lv.drops.set(d.id, d)
    return d
  }

  levelStat(p) {
    let lvl = 1, acc = 0
    for (let l = 1; l < 60; l++) {
      acc += Math.round(PLAYER_BASE.expBase * Math.pow(PLAYER_BASE.expGrowth, l - 1))
      if (acc > p.exp) break
      lvl = l + 1
    }
    return lvl
  }

  giveExp(p, amount) {
    p.exp += amount
    const newLvl = this.levelStat(p)
    if (newLvl > p.lvl) {
      p.lvl = newLvl
      p.maxHp = PLAYER_BASE.hp + (p.lvl - 1) * 12
      p.hp = Math.min(p.maxHp, p.hp + 40)
      this.emit(p, { type: 'levelup', lvl: p.lvl })
    }
  }

  playerDamageMult(p) { return 1 + (p.lvl - 1) * 0.07 }

  // ---------------------------------------------------------------- players
  join(token, name) {
    let p = this.players.get(token)
    if (p) { p.name = name || p.name; p.online = true; return p }
    const spawn = this.gen.spawn
    p = {
      token, name: (name || 'Survivor').slice(0, 16), x: this.tileToWorld(spawn[0]) + (this.rng() - 0.5) * TILE,
      y: this.tileToWorld(spawn[1]) + (this.rng() - 0.5) * TILE, levelId: 0, dir: 0,
      hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp, hunger: PLAYER_BASE.hunger, stamina: PLAYER_BASE.stamina,
      exp: 0, lvl: 1, inv: new Array(INV_SIZE).fill(null), equip: { hand: null, armor: null },
      dead: false, kills: 0, deaths: 0, hue: (this.rng() * 360) | 0, online: false, joined: this.clock, face: 0,
    }
    this.players.set(token, p)
    this.dirty = true
    return p
  }

  online() { return [...this.players.values()].filter(p => p.online) }

  snapshotFor(p) {
    const lv = this.getLevel(p.levelId)
    const R = VIEW_RADIUS, R2 = R * R
    const near = []
    for (const q of this.players.values()) {
      if (q === p || !q.online || q.levelId !== p.levelId) continue
      const dx = q.x - p.x, dy = q.y - p.y
      if (dx * dx + dy * dy <= R2) near.push(this.playerPub(q))
    }
    const ents = lv.ents.filter(e => d2(e, p) <= R2).map(e => ({ id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, max: e.max, boss: e.boss }))
    const drops = []
    for (const d of lv.drops.values()) if (d2(d, p) <= R2) drops.push({ id: d.id, item: d.item, x: d.x, y: d.y })
    const objs = []
    for (const o of lv.objects.values()) {
      if ((o.x * TILE + 16 - p.x) ** 2 + (o.y * TILE + 16 - p.y) ** 2 > R2 + 4096) continue
      objs.push(o)
    }
    return {
      t: 'sn', now: this.clock, time: this.time.t, day: this.time.day,
      me: this.selfState(p), players: near, ents, drops, objs,
    }
  }

  playerPub(p) {
    return { id: p.token.slice(0, 8), name: p.name, x: p.x, y: p.y, dir: p.dir, hp: p.hp, maxHp: p.maxHp, lvl: p.lvl, hue: p.hue, dead: p.dead }
  }

  selfState(p) {
    return { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, hunger: p.hunger, stamina: p.stamina, exp: p.exp, lvl: p.lvl, inv: p.inv, equip: p.equip, dir: p.dir, alive: !p.dead, levelId: p.levelId, name: p.name, hue: p.hue }
  }

  // generic validation
  actionRange(p, a, maxDist) {
    if (a.x == null || a.y == null) return false
    return Math.hypot(a.x - p.x, a.y - p.y) <= maxDist
  }

  // ---------------------------------------------------------------- actions
  handleAction(p, a) {
    if (!p || p.dead) return 'Bạn đã gục. Nhấn Hồi sinh.'
    const lv = this.getLevel(p.levelId)
    let err = null
    switch (a.t) {
      case 'move': err = this.aMove(p, a); break
      case 'attack': err = this.aAttack(p, lv, a); break
      case 'build': err = this.aBuild(p, lv, a); break
      case 'demolish': err = this.aDemolish(p, lv, a); break
      case 'door': err = this.aDoor(p, lv, a); break
      case 'chest': err = this.aChest(p, lv, a); break
      case 'craft': err = this.aCraft(p, lv, a); break
      case 'smelt': err = this.aCraft(p, lv, a); break
      case 'eat': err = this.aEat(p, lv, a); break
      case 'equip': err = this.aEquip(p, a); break
      case 'repair': err = this.aRepair(p, lv, a); break
      case 'drop': err = this.aDropItem(p, lv, a); break
      case 'enterCave': err = this.aEnterCave(p, lv); break
      case 'exitCave': err = this.aExitCave(p, lv); break
      case 'descend': err = this.aDescend(p, lv); break
      case 'respawn': err = this.aRespawn(p); break
      default: err = 'Hành động không hợp lệ.'
    }
    return err
  }

  aMove(p, a) {
    const now = this.clock
    if (p.lastMove == null) p.lastMove = now - 0.1
    const dt = Math.max(0, Math.min(1, now - p.lastMove))
    p.lastMove = now
    const maxDist = PLAYER_BASE.speed * PLAYER_BASE.sprintMult * dt + TILE * 0.6
    const dist = Math.hypot((a.x ?? p.x) - p.x, (a.y ?? p.y) - p.y)
    if (dist > maxDist) return 'detect-cheat'
    let x = a.x, y = a.y
    if (this.posSolid(this.getLevel(p.levelId), x, y)) {
      // try sliding on each axis
      if (!this.posSolid(this.getLevel(p.levelId), p.x, y)) x = p.x
      else if (!this.posSolid(this.getLevel(p.levelId), x, p.y)) y = p.y
      else return null
    }
    p.x = x; p.y = y
    if (a.dir != null) { p.dir = a.dir; p.face = a.dir > 0 ? 1 : -1 }
    if (a.sprint && p.stamina > 1) p.stamina = Math.max(0, p.stamina - 12 * dt)
    return null
  }

  aAttack(p, lv, a) {
    if ((p.atkCd || 0) > 0) return null
    const hand = p.equip.hand
    const def = hand && ITEMS[hand.id]
    let it = def && (def.weapon || def.tool || null)
    const isBow = !!(def && def.weapon && def.weapon.projectile)
    if (!it) {
      // bare hands: weak, only for trees/bushes/tufts
      it = { type: 'hand', power: 2, range: 44, cd: 0.6, stam: 4 }
    }
    if (isBow) {
      if (WorldRuntime.invCount(p.inv, 'arrow') <= 0) return 'Hết mũi tên.'
      WorldRuntime.invConsume(p.inv, 'arrow', 1)
    }
    if (p.stamina < (it.stam || 5)) return 'Hết thể lực.'
    p.stamina -= (it.stam || 5)
    p.atkCd = it.cd || 0.5
    if (hand && hand.dur != null) { hand.dur--; if (hand.dur <= 0) { p.equip.hand = null; this.emit(p, { type: 'toast', msg: 'Trang bị đã vỡ!' }) } }
    if (isBow) {
      const dx = (a.x ?? p.x + p.face * 100) - p.x, dy = (a.y ?? p.y) - p.y, dist = Math.hypot(dx, dy) || 1
      const speed = 420
      lv.projs = lv.projs || []
      lv.projs.push({
        id: `p${lv.nextEnt++}`, owner: p.token, x: p.x, y: p.y,
        vx: dx / dist * speed, vy: dy / dist * speed, life: 1.6, dmg: def.weapon.atk * this.playerDamageMult(p), kind: 'arrow',
      })
      this.emit(p, { type: 'shoot', x: p.x, y: p.y })
      return null
    }
    // melee: hit entities within arc, then objects
    const range = it.range || 60, arc = it.arc ?? 1.7
    const aim = Math.atan2((a.y ?? p.y) - p.y, (a.x ?? p.x + p.face * 100) - p.x)
    let hitSomething = false
    for (const e of lv.ents) {
      if (e.hp <= 0) continue
      const dx = e.x - p.x, dy = e.y - p.y
      if (Math.hypot(dx, dy) > range + 22) continue
      if (Math.abs(angDiff(Math.atan2(dy, dx), aim)) > arc) continue
      e.lastHitBy = p
      this.hitEntity(lv, e, (it.atk || it.power || 6) * this.playerDamageMult(p))
      hitSomething = true
    }
    if (!hitSomething) {
      const tx = Math.floor((a.x ?? p.x + p.face * 60) / TILE), ty = Math.floor((a.y ?? p.y) / TILE)
      return this.hitObject(p, lv, tx, ty, it)
    }
    return null
  }

  hitObject(p, lv, tx, ty, tool) {
    for (const o of lv.objects.values()) {
      if (!o.alive || o.x !== tx || o.y !== ty) continue
      if (o.t === 'cave_entrance' || o.t === 'cave_exit') return 'Dùng nút tương tác để vào hang.'
      if (o.t.startsWith('b:')) return 'Dùng búa ở chế độ Xây để phá dỡ.'
      if (o.t === 'tree') {
        if (tool && tool.type !== 'axe' && tool.type !== 'hand') return 'Cần rìu để chặt cây.'
      } else if (o.t === 'rock' || o.t.startsWith('ore_')) {
        if (!tool || tool.type !== 'pick') return 'Cần cuốc để khai thác đá và quặng.'
      } else if (o.t === 'bush' || o.t === 'grass_tuft') {
        // harvestable by anything
      } else return null
      if (o.t.startsWith('ore_')) {
        const needTier = ORE_TIER[o.t] || 1
        if (!tool || tool.tier < needTier) return `Cuốc quá yếu. Cần cuốc cấp ${needTier}+.`
      }
      const power = tool ? (tool.power || 4) : 2
      if (p.stamina < 4) return 'Hết thể lực.'
      p.stamina -= 4
      o.hp -= power
      if (tool) {
        if (p.equip.hand && p.equip.hand.dur != null) {
          p.equip.hand.dur--
          if (p.equip.hand.dur <= 0) { p.equip.hand = null; this.emit(p, { type: 'toast', msg: 'Công cụ đã vỡ!' }) }
        }
      }
      this.dirty = true
      if (o.hp <= 0) return this.destroyObject(p, lv, o)
      this.emit(p, { type: 'harvest', x: o.x * TILE + 16, y: o.y * TILE + 16, hp: o.hp })
      return null
    }
    return null
  }

  destroyObject(p, lv, o) {
    o.alive = false
    this.dirty = true
    const cx = o.x * TILE + 16, cy = o.y * TILE + 16
    const give = (id, lo, hi) => {
      const qty = lo + ((this.rng() * (hi - lo + 1)) | 0)
      if (qty > 0) this.addDrop(lv, cx, cy, id, qty)
    }
    if (o.t === 'tree') give('wood', 2, 4), give('fiber', 0, 1)
    else if (o.t === 'rock') give('stone', 2, 4)
    else if (o.t === 'bush') give('berries', 2, 4), give('fiber', 1, 2)
    else if (o.t === 'grass_tuft') give('fiber', 1, 2)
    else if (o.t.startsWith('ore_')) {
      const drops = ORE_DROPS[o.t]
      for (const id in drops) give(id, drops[id][0], drops[id][1])
    } else if (o.t === 'chest') {
      if (o.container) for (const s of o.container.items) if (s) this.addDrop(lv, cx, cy, s.id, s.qty, s.dur)
      if (o.loot) { give('gem', 0, 1); give('iron_bar', 0, 1) }
    }
    if (p) this.giveExp(p, 2)
    o.respawnAt = OBJECT_RESPAWN[o.t] ? this.clock + OBJECT_RESPAWN[o.t] : null
    if (o.respawnAt === null) o.respawnAt = undefined
    return null
  }

  hitEntity(lv, e, dmg) {
    e.hp -= dmg
    e.hp = Math.max(0, e.hp)
    this.dirty = true
    this.emit(null, { type: 'hit', id: e.id, hp: e.hp, max: e.max, x: e.x, y: e.y, lvl: lv.idx })
  }

  killEntity(lv, e, killer) {
    const def = ENTITY_TYPES[e.type]
    const idx = lv.ents.indexOf(e)
    if (idx >= 0) lv.ents.splice(idx, 1)
    for (const [id, lo, hi] of def.drops) {
      const qty = lo + ((this.rng() * (hi - lo + 1)) | 0)
      if (qty > 0) this.addDrop(lv, e.x, e.y, id, qty)
    }
    if (e.boss) { lv.bossDeadAt = this.clock }
    if (killer) { this.giveExp(killer, def.exp); killer.kills++ }
    this.emit(null, { type: 'kill', x: e.x, y: e.y, lvl: lv.idx })
    this.dirty = true
  }

  aBuild(p, lv, a) {
    const b = BUILDS[a.kind]
    if (!b) return 'Không có công trình này.'
    const tx = Math.floor((a.x ?? 0) / TILE), ty = Math.floor((a.y ?? 0) / TILE)
    if (!this.actionRange(p, { x: a.x, y: a.y }, 6.2 * TILE)) return 'Quá xa để xây.'
    if (lv.tiles[ty * lv.w + tx] && (this.terrainSolid(lv, tx, ty))) return 'Không thể xây trên vị trí này.'
    for (const o of lv.objects.values()) if (o.x === tx && o.y === ty && o.alive && o.t !== 'cave_exit') return 'Vị trí đã có vật cản.'
    for (const q of this.players.values()) {
      if (q.levelId !== p.levelId || !q.online) continue
      if (Math.floor(q.x / TILE) === tx && Math.floor(q.y / TILE) === ty) return 'Có người chơi đứng ở đó.'
    }
    const cost = BUILD_FORGE[a.kind] || b.cost
    if (!canAfford(p.inv, cost)) return 'Thiếu nguyên liệu xây dựng.'
    for (const k in cost) WorldRuntime.invConsume(p.inv, k, cost[k])
    const o = { i: `${lv.idx}:b:${a.kind}:${tx}:${ty}`, t: 'b:' + a.kind, x: tx, y: ty, max: b.hp, hp: b.hp, alive: true, owner: p.token, open: false, cver: 0, container: b.slots ? { items: new Array(b.slots).fill(null), v: 0 } : null, placedAt: this.clock }
    lv.objects.set(o.i, o)
    this.dirty = true
    this.emit(p, { type: 'build', x: tx, y: ty, lvl: lv.idx })
    return null
  }

  aDemolish(p, lv, a) {
    const hand = p.equip.hand
    const hammer = hand && ITEMS[hand.id] && ITEMS[hand.id].tool && ITEMS[hand.id].tool.type === 'hammer'
    if (!hammer) return 'Cần trang bị búa để phá dỡ.'
    const tx = Math.floor((a.x ?? 0) / TILE), ty = Math.floor((a.y ?? 0) / TILE)
    if (!this.actionRange(p, { x: a.x, y: a.y }, 5.5 * TILE)) return 'Quá xa.'
    for (const o of lv.objects.values()) {
      if (!o.alive || o.x !== tx || o.y !== ty) continue
      if (!o.t.startsWith('b:')) return 'Chỉ có thể phá công trình của bạn.'
      if (o.owner !== p.token) return 'Bạn không phải chủ nhân công trình này.'
      const kind = o.t.slice(2)
      const refund = BUILD_FORGE[kind] || BUILDS[kind].cost
      for (const k in refund) this.addDrop(lv, o.x * TILE + 16, o.y * TILE + 16, k, refund[k])
      if (o.container) for (const s of o.container.items) if (s) this.addDrop(lv, o.x * TILE + 16, o.y * TILE + 16, s.id, s.qty, s.dur)
      o.alive = false
      lv.objects.delete(o.i)
      this.dirty = true
      this.emit(p, { type: 'toast', msg: 'Đã phá dỡ, vật liệu rơi xuống đất.' })
      return null
    }
    return 'Không có công trình.'
  }

  aDoor(p, lv, a) {
    const tx = Math.floor((a.x ?? 0) / TILE), ty = Math.floor((a.y ?? 0) / TILE)
    if (!this.actionRange(p, a, 4.5 * TILE)) return 'Quá xa.'
    for (const o of lv.objects.values()) {
      if (!o.alive || o.x !== tx || o.y !== ty || o.t !== 'b:door') continue
      o.open = !o.open
      this.dirty = true
      return null
    }
    return 'Không có cửa ở đó.'
  }

  aChest(p, lv, a) {
    const o = lv.objects.get(a.objId)
    if (!o || !o.alive || !(o.t === 'b:chest' || o.t === 'chest')) return 'Rương không tồn tại.'
    if (!o.container || !Array.isArray(o.container.items)) return 'Rương không thể mở.'
    if (Math.hypot(o.x * TILE + 16 - p.x, o.y * TILE + 16 - p.y) > 4.5 * TILE) return 'Rương quá xa.'
    if (a.op === 'put') {
      const s = p.inv[a.from]
      if (!s) return 'Ô trống.'
      const left = dictAdd(o.container.items, s)
      if (left) return 'Rương đã đầy.'
      p.inv[a.from] = null
      o.cver = (o.cver || 0) + 1
    } else if (a.op === 'take') {
      const item = o.container.items[a.from]
      if (!item) return 'Ô rỗng.'
      const added = WorldRuntime.invAdd(p.inv, item.id, item.qty, item.dur)
      if (added >= item.qty) o.container.items[a.from] = null
      else item.qty -= added
      o.cver = (o.cver || 0) + 1
    }
    this.dirty = true
    return null
  }

  aCraft(p, lv, a) {
    const rec = RECIPES.find(r => r.id === a.id)
    if (!rec || rec.hidden) return 'Công thức không tồn tại.'
    const st = this.nearStation(lv, p.x, p.y, [rec.where === 'anvil' ? 'hammer_anvil' : rec.where])
    if (rec.where !== 'any' && (!st || (rec.where === 'anvil' ? st !== 'hammer_anvil' : st !== rec.where))) {
      return rec.where === 'workbench' ? 'Cần đứng gần bàn chế tạo.' : rec.where === 'furnace' ? 'Cần đứng gần lò nung.' : rec.where === 'campfire' ? 'Cần đứng gần lửa trại.' : 'Cần đứng gần đe.'
    }
    if (!canAfford(p.inv, rec.in)) return 'Thiếu nguyên liệu.'
    for (const k in rec.in) WorldRuntime.invConsume(p.inv, k, rec.in[k])
    const o0 = rec.out[0]
    const added = WorldRuntime.invAdd(p.inv, o0.id, o0.qty)
    if (added < o0.qty) this.addDrop(lv, p.x, p.y + 12, o0.id, o0.qty - added)
    this.dirty = true
    this.emit(p, { type: 'craft', id: o0.id })
    return null
  }

  aEat(p, lv, a) {
    const s = p.inv[a.from]
    if (!s) return 'Không có món đó.'
    const def = ITEMS[s.id]
    if (!def || !def.food) return 'Không thể ăn món này.'
    p.hunger = Math.min(100, p.hunger + def.food.hunger)
    p.hp = Math.min(p.maxHp, p.hp + def.food.hp)
    s.qty--
    if (s.qty <= 0) p.inv[a.from] = null
    this.dirty = true
    this.emit(p, { type: 'eat', id: s.id })
    return null
  }

  aEquip(p, a) {
    const s = p.inv[a.from]
    if (!s) return 'Không có thứ đó.'
    const def = ITEMS[s.id]
    let slot = def.weapon || def.tool ? 'hand' : null
    if (def.armor) slot = 'armor'
    if (!slot) return 'Không thể mặc thứ này.'
    const cur = p.equip[slot]
    p.equip[slot] = WorldRuntime.mkItem(s.id, s.qty, s.dur)
    p.inv[a.from] = cur ? { ...cur } : null
    this.dirty = true
    return null
  }

  aRepair(p, lv, a) {
    const st = this.nearStation(lv, p.x, p.y, ['hammer_anvil', 'workbench'])
    if (!st) return 'Cần đứng gần đe hoặc bàn chế tạo.'
    const item = p.equip[a.slot === 'armor' ? 'armor' : 'hand']
    if (!item) return 'Không có trang bị.'
    const def = ITEMS[item.id]
    if (item.dur == null || !def.dur) return 'Trang bị này không hỏng được.'
    if (item.dur >= def.dur) return 'Trang bị còn nguyên.'
    const cost = repairCost(item.id)
    if (!cost) return 'Không sửa được.'
    if (WorldRuntime.invCount(p.inv, cost.id) < cost.qty) return `Cần ${cost.qty} ${ITEMS[cost.id].name} để sửa.`
    WorldRuntime.invConsume(p.inv, cost.id, cost.qty)
    item.dur = Math.min(def.dur, item.dur + Math.round(def.dur * 0.4))
    this.dirty = true
    return null
  }

  aDropItem(p, lv, a) {
    const s = p.inv[a.from]
    if (!s) return 'Không có thứ đó.'
    const qty = Math.min(s.qty, Math.max(1, a.qty || 1))
    this.addDrop(lv, p.x, p.y + 10, s.id, qty, s.dur != null ? s.dur : null)
    s.qty -= qty
    if (s.qty <= 0) p.inv[a.from] = null
    this.dirty = true
    return null
  }

  aEnterCave(p, lv) {
    if (p.levelId !== 0) return 'Bạn đã ở dưới lòng đất.'
    for (const o of lv.objects.values()) {
      if (!o.alive || o.t !== 'cave_entrance') continue
      if (Math.hypot(o.x * TILE + 16 - p.x, o.y * TILE + 16 - p.y) > 4.2 * TILE) continue
      const appId = o.entranceId
      const target = this.levels['1']
      const [tx, ty] = target.spawns[Math.min(appId, target.spawns.length - 1)]
      p.x = this.tileToWorld(tx); p.y = this.tileToWorld(ty)
      p.levelId = 1
      this.emit(p, { type: 'toast', msg: 'Bạn đã xuống lòng đất (tầng 1).' })
      this.dirty = true
      return null
    }
    return 'Cần đứng gần cửa hang.'
  }

  aDescend(p, lv) {
    if (p.levelId === 0) return 'Cần ở dưới lòng đất để xuống sâu hơn.'
    if (p.levelId >= CAVE_LEVELS) return 'Đây là tầng sâu nhất rồi.'
    for (const o of lv.objects.values()) {
      if (!o.alive || o.t !== 'cave_down') continue
      if (Math.hypot(o.x * TILE + 16 - p.x, o.y * TILE + 16 - p.y) > 4.2 * TILE) continue
      const next = this.levels[String(p.levelId + 1)]
      const [tx, ty] = next.spawns[0]
      p.x = this.tileToWorld(tx); p.y = this.tileToWorld(ty)
      p.levelId = p.levelId + 1
      this.emit(p, { type: 'toast', msg: `Bạn xuống tầng ${p.levelId}. Càng sâu càng nguy hiểm!` })
      this.dirty = true
      return null
    }
    return 'Cần đứng gần lối xuống sâu hơn.'
  }

  aExitCave(p, lv) {
    if (p.levelId === 0) return 'Bạn đang ở mặt đất.'
    let pos = null, entranceId = 0
    for (const o of lv.objects.values()) {
      if (!o.alive || o.t !== 'cave_exit') continue
      if (Math.hypot(o.x * TILE + 16 - p.x, o.y * TILE + 16 - p.y) <= 4.2 * TILE) { pos = o; break }
    }
    if (!pos) return 'Cần đứng gần lối lên hang.'
    entranceId = pos.entranceId ?? 0
    if (p.levelId > 1) {
      // climb one level toward surface via connecting ladder: teleport to level-1 spawn area of same entrance chain
      const below = this.levels[String(p.levelId - 1)]
      const [tx, ty] = below.spawns[entranceId % below.spawns.length]
      p.x = this.tileToWorld(tx); p.y = this.tileToWorld(ty)
      p.levelId = p.levelId - 1
      this.emit(p, { type: 'toast', msg: `Bạn lên tầng ${p.levelId}.` })
    } else {
      const en = this.gen.surface.entrances[entranceId] || this.gen.surface.entrances[0]
      p.x = en.x * TILE + TILE + 8; p.y = en.y * TILE + 16
      p.levelId = 0
      this.emit(p, { type: 'toast', msg: 'Bạn đã trở về mặt đất.' })
    }
    this.dirty = true
    return null
  }

  aRespawn(p) {
    if (!p.dead) return null
    p.dead = false
    const spawn = this.gen.spawn
    p.x = this.tileToWorld(spawn[0]) + (this.rng() - 0.5) * TILE * 2
    p.y = this.tileToWorld(spawn[1]) + (this.rng() - 0.5) * TILE * 2
    p.levelId = 0
    p.hp = p.maxHp; p.hunger = Math.max(40, p.hunger); p.stamina = PLAYER_BASE.stamina
    this.dirty = true
    this.emit(p, { type: 'respawn' })
    return null
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    this.clock += dt
    // time of day
    this.time.t += dt / DAY_LENGTH
    while (this.time.t >= 1) { this.time.t -= 1; this.time.day++ }
    const night = isNight(this.time.t)
    for (const key in this.levels) {
      const lv = this.levels[key]
      // respawn mining objects
      for (const o of lv.objects.values()) {
        if (!o.alive && o.respawnAt && this.clock >= o.respawnAt) {
          o.alive = true; o.hp = o.max; o.respawnAt = undefined
          if (o.loot) o.container.items = randomLoot2(this.rng, lv.idx - 1)
          this.dirty = true
        }
      }
      // drops expire
      for (const [id, d] of [...lv.drops]) {
        if (this.clock > d.expire) { lv.drops.delete(id); this.dirty = true }
      }
      // projectiles
      if (lv.projs) {
        for (let i = lv.projs.length - 1; i >= 0; i--) {
          const pr = lv.projs[i]
          const steps = Math.max(1, Math.ceil(Math.hypot(pr.vx, pr.vy) * dt / 12))
          let removed = false
          for (let s = 0; s < steps && !removed; s++) {
            pr.x += pr.vx * dt / steps; pr.y += pr.vy * dt / steps
            pr.life -= dt / steps
            if (pr.life <= 0 || this.posSolid(lv, pr.x, pr.y)) { lv.projs.splice(i, 1); removed = true; break }
            for (const e of lv.ents) {
              if (e.hp <= 0) continue
              if (Math.hypot(e.x - pr.x, e.y - pr.y) < 26) {
                this.hitEntity(lv, e, pr.dmg)
                lv.projs.splice(i, 1)
                removed = true
                break
              }
            }
          }
        }
      }
      // AI
      for (let i = lv.ents.length - 1; i >= 0; i--) {
        const e = lv.ents[i]
        if (e.hp <= 0) { this.killEntity(lv, e, e.lastHitBy || null); continue }
        this.aiTick(lv, e, dt, night, key)
      }
      // cave monster population
      if (key !== '0') this.caveSpawning(lv, key, dt)
      else this.nightSpawning(lv, dt, night)
    }
    // player vitals
    for (const p of this.players.values()) {
      if (!p.online) continue
      if (p.dead) continue
      p.atkCd = Math.max(0, (p.atkCd || 0) - dt)
      const eating = p.hunger > 60
      p.hunger = Math.max(0, p.hunger - dt * (eating ? 0.5 : 0.35))
      if (p.hunger <= 0) p.hp -= dt * 0.9
      else if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt * (p.hunger > 80 ? 1.6 : 0.6))
      const moving = p._moving
      p.stamina = Math.min(100, p.stamina + dt * (moving ? 4.5 : 12))
      p._moving = false
      if (p.hp <= 0) this.playerDie(p)
    }
    // animal repopulation
    this.autoPickup()
    this.repopulate(dt)  // C2 fixed below
    this.dirty = false   // save flag managed by store layer via markSaved()
  }

  markSaved() { this.dirty = false }

  repopulate(dt) {
    this.repTimer = (this.repTimer || 0) + dt
    if (this.repTimer < 45) return
    this.repTimer = 0
    const lv = this.levels['0']
    const want = { rabbit: 26, deer: 16, boar: 14, wolf: 10 }
    const cur = {}
    for (const e of lv.ents) cur[e.type] = (cur[e.type] || 0) + 1
    for (const t in want) {
      if ((cur[t] || 0) < want[t]) {
        const biomes = { rabbit: [BIOME.GRASS, BIOME.MEADOW], deer: [BIOME.GRASS, BIOME.FOREST], boar: [BIOME.FOREST], wolf: [BIOME.FOREST] }[t]
        const p = this.spawnableTile(lv, biomes)
        if (p) this.addEntity(lv, t, p[0], p[1])
      }
    }
  }

  nightSpawning(lv, dt, night) {
    if (!night) {
      // burn away monsters at dawn
      for (let i = lv.ents.length - 1; i >= 0; i--) {
        const e = lv.ents[i]
        if (['zombie', 'slime'].includes(e.type)) lv.ents.splice(i, 1)
      }
      return
    }
    this.nightTimer = (this.nightTimer || 0) + dt
    if (this.nightTimer < 3.5) return
    this.nightTimer = 0
    for (const p of this.players.values()) {
      if (!p.online || p.levelId !== 0 || p.dead) continue
      let near = 0
      for (const e of lv.ents) if (Math.hypot(e.x - p.x, e.y - p.y) < 800) near++
      if (near >= NIGHT_SPAWN_CAP_PER_PLAYER + 12) continue
      const spawn = this.findSpawnNear(lv, p)
      if (spawn) this.addEntity(lv, this.rng() < 0.7 ? 'zombie' : 'slime', spawn[0], spawn[1])
    }
  }

  caveSpawning(lv, key, dt) {
    this.caveTimer = (this.caveTimer || 0) + dt
    if (this.caveTimer < 5) return
    this.caveTimer = 0
    for (const p of this.players.values()) {
      if (!p.online || String(p.levelId) !== key || p.dead) continue
      let near = 0
      for (const e of lv.ents) if (Math.hypot(e.x - p.x, e.y - p.y) < 700) near++
      if (near >= CAVE_SPAWN_CAP_PER_PLAYER) continue
      const deep = lv.idx
      const type = deep === 1 ? (this.rng() < 0.75 ? 'bat' : 'slime') : 'skeleton'
      const spawn = this.findSpawnNear(lv, p)
      if (spawn) this.addEntity(lv, type, spawn[0], spawn[1])
    }
    // boss (level 3 anchor)
    if (lv.bossPos && (lv.bossDeadAt == null || this.clock - lv.bossDeadAt > BOSS_RESPAWN_SECS())) {
      let someone = false
      for (const p of this.players.values()) if (p.online && String(p.levelId) === key && !p.dead) someone = true
      if (someone && !lv.ents.some(e => e.boss)) {
        const [bx, by] = lv.bossPos
        this.addEntity(lv, 'golem', bx, by)
        this.emit(null, { type: 'toast', lvl: key, msg: 'Cổ Thạch Golem đã xuất hiện ở tầng sâu nhất!' })
      }
    }
  }

  findSpawnNear(lv, p, minD = 12, maxD = 24) {
    for (let k = 0; k < 60; k++) {
      const ang = this.rng() * Math.PI * 2
      const d = (minD + this.rng() * (maxD - minD)) * TILE
      const tx = Math.floor((p.x + Math.cos(ang) * d) / TILE), ty = Math.floor((p.y + Math.sin(ang) * d) / TILE)
      if (tx <= 2 || ty <= 2 || tx >= lv.w - 2 || ty >= lv.h - 2) continue
      if (this.tileBlocking(lv, tx, ty)) continue
      return [tx, ty]
    }
    return null
  }

  playerDie(p) {
    p.dead = true
    p.deaths++
    const lv = this.getLevel(p.levelId)
    // drop inventory at death place
    for (let i = 0; i < p.inv.length; i++) {
      const s = p.inv[i]
      if (s) { this.addDrop(lv, p.x + (this.rng() - 0.5) * 30, p.y + (this.rng() - 0.5) * 30, s.id, s.qty, s.dur); p.inv[i] = null }
    }
    for (const k of ['hand', 'armor']) {
      const e = p.equip[k]
      if (e) { this.addDrop(lv, p.x, p.y, e.id, 1, e.dur); p.equip[k] = null }
    }
    p.hp = 0
    this.dirty = true
    this.emit(p, { type: 'death', x: p.x, y: p.y, lvl: p.levelId })
  }

  aiTick(lv, e, dt, night, levelKey) {
    const def = ENTITY_TYPES[e.type]
    e.atkCd = Math.max(0, e.atkCd - dt)
    // nearest online player on this level
    let target = null, td = 1e9
    for (const p of this.players.values()) {
      if (!p.online || p.dead || p.levelId !== Number(levelKey)) continue
      const d = Math.hypot(p.x - e.x, p.y - e.y)
      if (d < td) { td = d; target = p }
    }
    let mx = 0, my = 0
    const spd = def.speed * (night && !def.boss && ['zombie', 'skeleton'].includes(e.type) ? 1.15 : 1)
    const aggro = def.atk > 0 ? (def.boss ? 520 : 300) : 0
    const fleeing = target && def.flee > 0 && !def.boss && td < 190
    if (fleeing) {
      // flee
      mx = e.x - target.x; my = e.y - target.y
    } else if (target && def.atk > 0 && td < aggro) {
      mx = target.x - e.x; my = target.y - e.y
      if (td < 30 + (def.boss ? 26 : 0) && e.atkCd <= 0) {
        e.atkCd = def.boss ? 1.6 : 1.1
        this.damagePlayer(target, def.atk, e)
      }
    } else {
      e.wanderCd -= dt
      if (e.wanderCd <= 0) {
        e.wanderCd = 1.5 + this.rng() * 3
        const a = this.rng() * Math.PI * 2
        e.wd = this.rng() < 0.35 ? null : a
      }
      if (e.wd != null) { mx = Math.cos(e.wd); my = Math.sin(e.wd) }
    }
    const len = Math.hypot(mx, my)
    if (len > 0) {
      mx = mx / len * spd * dt; my = my / len * spd * dt
      // axis-separated move with blocking
      if (!this.posSolid(lv, e.x + mx, e.y)) e.x += mx
      if (!this.posSolid(lv, e.x, e.y + my)) e.y += my
      e.vx = mx / dt; e.vy = my / dt
    } else { e.vx = 0; e.vy = 0 }
  }

  damagePlayer(p, rawDmg, source) {
    if (p.dead) return
    let dmg = rawDmg
    const armor = p.equip.armor && ITEMS[p.equip.armor.id]
    if (armor && armor.armor) {
      dmg = rawDmg * (1 - Math.min(0.8, armor.armor.def / (armor.armor.def + 90)))
      if (p.equip.armor.dur != null) {
        p.equip.armor.dur--
        if (p.equip.armor.dur <= 0) { p.equip.armor = null; this.emit(p, { type: 'toast', msg: 'Giáp đã vỡ!' }) }
      }
    }
    p.hp -= dmg
    this.emit(p, { type: 'hurt', dmg: Math.round(dmg), x: p.x, y: p.y })
    if (p.hp <= 0) this.playerDie(p)
    this.dirty = true
  }

  // auto-pickup drops near players
  autoPickup() {
    for (const p of this.players.values()) {
      if (!p.online || p.dead) continue
      const lv = this.getLevel(p.levelId)
      for (const [id, d] of [...lv.drops]) {
        const dist = Math.hypot(d.x - p.x, d.y - p.y)
        if (dist > 34) continue
        const added = WorldRuntime.invAdd(p.inv, d.item.id, d.item.qty, d.item.dur)
        if (added <= 0) { this.emit(p, { type: 'toast', msg: 'Túi đã đầy!' }); continue }
        if (added >= d.item.qty) lv.drops.delete(id)
        else d.item.qty -= added
        this.dirty = true
      }
    }
  }

  // ------------------------------------------------------- persistence I/O
  serialize() {
    const players = {}
    for (const [token, p] of this.players) {
      players[token] = {
        name: p.name, x: p.x, y: p.y, levelId: p.levelId, hp: p.hp, maxHp: p.maxHp, hunger: p.hunger,
        stamina: p.stamina, exp: p.exp, lvl: p.lvl, inv: p.inv, equip: p.equip, dead: p.dead,
        kills: p.kills, deaths: p.deaths, hue: p.hue, joined: p.joined, face: p.face,
      }
    }
    const levels = {}
    for (const key in this.levels) {
      const lv = this.levels[key]
      levels[key] = {
        objects: [...lv.objects.values()].map(o => ({ ...o })),
        ents: lv.ents.map(e => ({ id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, max: e.max })),
        drops: [...lv.drops.values()].map(d => ({ id: d.id, item: d.item, x: d.x, y: d.y, expire: d.expire })),
        nextEnt: lv.nextEnt, nextDrop: lv.nextDrop, bossDeadAt: lv.bossDeadAt ?? null,
      }
    }
    return { v: 3, seed: this.seed, clock: this.clock, time: this.time, players, levels }
  }

  load(json) {
    if (!json || json.v !== 3 || !json.levels) return false
    try {
      this.time = json.time || this.time
      this.clock = json.clock || 0
      this.players.clear()
      for (const [token, d] of Object.entries(json.players || {})) {
        this.players.set(token, {
          token, ...d, online: false, atkCd: 0, lastMove: null, _moving: false, spawnCache: null, spawnTimer: null, face: d.face || 1,
          joined: d.joined || 0, inv: Array.isArray(d.inv) ? d.inv.slice(0, INV_SIZE) : new Array(INV_SIZE).fill(null),
        })
      }
      for (const key in this.levels) {
        const lv = this.levels[key]
        const saved = json.levels[key]
        if (!saved) continue
        lv.objects.clear()
        for (const o of saved.objects || []) lv.objects.set(o.i, o)
        lv.ents = (saved.ents || []).map(e => ({ ...e, vx: 0, vy: 0, atkCd: 0, wanderCd: 0, wd: null, boss: ENTITY_TYPES[e.type]?.boss || false }))
        lv.drops.clear()
        for (const d of saved.drops || []) lv.drops.set(d.id, d)
        if (saved.nextEnt) lv.nextEnt = saved.nextEnt
        if (saved.nextDrop) lv.nextDrop = saved.nextDrop
        lv.bossDeadAt = saved.bossDeadAt ?? null
      }
      return true
    } catch { return false }
  }
}

function BOSS_RESPAWN_SECS() { return 900 }

function angDiff(a, b) {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

function d2(o, p) { const dx = o.x - p.x, dy = o.y - p.y; return dx * dx + dy * dy }

function dictAdd(slots, item) {
  // returns null on success, truthy leftover object when full
  let left = item.qty
  const def = ITEMS[item.id]
  if (def && def.stack > 1) {
    for (const s of slots) {
      if (s && s.id === item.id && s.qty < def.stack && !item.dur) {
        const add = Math.min(def.stack - s.qty, left)
        s.qty += add; left -= add
        if (left <= 0) return null
      }
    }
  }
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) {
      const put = Math.min(def ? def.stack : 99, left)
      slots[i] = WorldRuntime.mkItem(item.id, put, item.dur)
      left -= put
      if (left <= 0) return null
    }
  }
  return { qty: left }
}

function randomLoot2(rng, level) {
  const pool = [['coal', 4, 9], ['iron_ore', 3, 7], ['copper_ore', 4, 8], ['arrow', 8, 20], ['leather', 1, 3]]
  const out = []
  const n = 2 + ((rng() * 3) | 0)
  for (let i = 0; i < n; i++) {
    const [id, lo, hi] = pool[(rng() * pool.length) | 0]
    out.push({ id, qty: lo + ((rng() * (hi - lo + 1)) | 0), dur: null })
  }
  if (level >= 1 && rng() < 0.4) out.push({ id: 'gem', qty: 1, dur: null }, { id: 'gold_bar', qty: 1, dur: null })
  return out
}
