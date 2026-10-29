// SURVIVOR SMP - client entry: ties rendering, input, UI, and world adapters together
import { Renderer } from './render.js'
import { Input } from './input.js'
import { UI, $ } from './ui.js'
import { OfflineAdapter, OnlineAdapter, makeToken, detectServerUrl } from './worldBridge.js'
import { TILE, BUILDS, PLAYER_BASE, DAY_LENGTH, isNight } from '../shared/constants.js'
import { ITEMS } from '../shared/items.js'
import { canAfford, BUILD_FORGE } from '../shared/recipes.js'

const MELEE = 62
const canvas = $('gameCanvas')
const renderer = new Renderer(canvas)
const input = new Input(canvas)
const ui = new UI()

let adapter = null
let connecting = false
let aimPoint = null // world target for attack/build {x,y}
let attackCd = 0
let lastFacing = { x: 1, y: 0 }
let buildMode = { active: false, kind: null, demolish: false }
let stations = new Set()
let deathShown = false
let footTimer = 0

// ------------------------------------------------------------------ helpers
function storage() {
  try { return window.localStorage } catch { return null }
}
const STORE = storage()
const getSavedName = () => { try { return STORE.getItem('smp_name') || '' } catch { return '' } }

function localStorageKeyFor(seed, token) {
  return 'smp_solo_' + token.slice(0, 12)
}

// ------------------------------------------------------------------ world setup
function startOnline(name) {
  connecting = true
  ui.connectStatus.textContent = 'Đang kiểm tra máy chủ SMP chung…'
  // fast health probe so static deployments fail over to solo mode quickly
  const probe = fetch('/health', { cache: 'no-store' }).then(r => r.ok).catch(() => false)
  Promise.race([probe, new Promise(res => setTimeout(() => res(false), 1600))]).then((ok) => {
    if (adapter) return
    if (!ok) { startOffline(name); return }
    ui.connectStatus.textContent = 'Đang vào thế giới SMP…'
    const a = new OnlineAdapter(detectServerUrl(), makeToken(), name, () => onOnlineFail(name))
    setupAdapter(a)
    a.onInit = () => {
      connecting = false
      enterGame()
    }
  })
}

function startOffline(name) {
  const tokenKey = makeToken()
  const a = new OfflineAdapter(1708301, localStorageKeyFor(1708301, tokenKey), name)
  setupAdapter(a)
  enterGame()
  ui.modeBanner.textContent = '⚠️ Chế độ OFFLINE (solo): máy chủ multiplayer không khả dụng. Tiến trình lưu trên trình duyệt. Truy cập bản chính có máy chủ để chơi SMP chung.'
  ui.modeBanner.style.display = 'block'
  setTimeout(() => { ui.modeBanner.style.display = 'none' }, 12000)
}

let failTimer = null
function onOnlineFail(name) {
  if (failTimer) return
  failTimer = setTimeout(() => {
    failTimer = null
    if (adapter && adapter.mode === 'offline') return
    connecting = false
    adapter = null
    startOffline(name)
  }, 2500)
}

function setupAdapter(a) {
  adapter = a
  a.uiBind = true
}

function enterGame() {
  ui.menu.style.display = 'none'
  document.body.classList.add('playing')
  loopLast = performance.now()
  requestAnimationFrame(loop)
}

// ------------------------------------------------------------------ station proximity (client side)
function computeStations() {
  stations = new Set()
  const p = adapter.self()
  if (!p) return
  const objs = adapter.objects()
  const d2max = (3.2 * TILE + 40) ** 2
  for (const o of objs) {
    if (!o.alive || !o.t.startsWith('b:')) continue
    const kind = o.t.slice(2)
    if (!['workbench', 'furnace', 'campfire', 'hammer_anvil'].includes(kind)) continue
    const dx = o.x * TILE + TILE / 2 - p.x
    const dy = o.y * TILE + TILE / 2 - p.y
    if (dx * dx + dy * dy <= d2max && !stations.has('hammer_anvil')) stations.add(kind)
  }
}

// ------------------------------------------------------------------ interactions
function nearestInteractable() {
  const p = adapter.self()
  const objs = adapter.objects()
  let best = null
  let bd = 4.2 * TILE
  for (const o of objs) {
    if (!o.alive) continue
    const dx = o.x * TILE + TILE / 2 - p.x, dy = o.y * TILE + TILE / 2 - p.y
    const d = Math.hypot(dx, dy) - (o.t === 'cave_entrance' ? 10 : 0)
    if (d > bd) continue
    if (o.t === 'cave_entrance') best = { kind: 'cave', o, d }
    else if (o.t === 'cave_exit') best = { kind: 'exit', o, d }
    else if (o.t === 'cave_down') best = { kind: 'down', o, d }
    else if (o.t === 'b:door') best = { kind: 'door', o, d }
    else if (o.t === 'b:chest' || o.t === 'chest') best = { kind: 'chest', o, d }
  }
  return best
}

function doInteract() {
  const p = adapter.self()
  if (p.dead) return
  const near = nearestInteractable()
  if (!near) return
  switch (near.kind) {
    case 'cave':
      ui.confirmModal('Xuống hang? Tầng 1 khá an toàn; tầng sâu hơn có quái vật nguy hiểm và quặng hiếm.', () => {
        adapter.act('enterCave', {})
        if (adapter.send) adapter.send({ t: 'resetdiff' })
      })
      break
    case 'exit':
      adapter.act('exitCave', {})
      if (adapter.send) adapter.send({ t: 'resetdiff' })
      break
    case 'down':
      adapter.act('descend', {})
      if (adapter.send) adapter.send({ t: 'resetdiff' })
      break
    case 'door':
      adapter.act('door', { x: near.o.x * TILE + TILE / 2, y: near.o.y * TILE + TILE / 2 })
      break
    case 'chest':
      ui.activeChest = near.o
      ui.renderChest(adapter, near.o)
      break
  }
}


// ------------------------------------------------------------------ combat
function autoAimPoint(maxRange) {
  const p = adapter.self()
  aimF = null
  // 1) prefer mouse/tap target if fresh
  const tap = input.consumeTap()
  let point = null
  if (tap) point = tap
  else if (nearestEnemyIn(maxRange * 2)) {
    const e = nearestEnemyIn(maxRange * 2)
    point = { x: e.x, y: e.y }
  } else point = { x: p.x + lastFacing.x * maxRange, y: p.y + lastFacing.y * maxRange }
  return point
}

function nearestEnemyIn(range) {
  const p = adapter.self()
  let best = null, bd = range
  for (const e of adapter.ents()) {
    if (e.hp <= 0) continue
    const d = Math.hypot(e.x - p.x, e.y - p.y)
    if (d < bd) { bd = d; best = e }
  }
  return best
}

function tryAttack() {
  const p = adapter.self()
  if (!p || p.dead) return
  const hand = p.equip.hand
  const def = hand && ITEMS[hand.id]
  const isBow = !!(def && def.weapon && def.weapon.projectile)
  const range = def && (def.weapon || def.tool) ? (def.weapon ? def.weapon.range || MELEE : def.range || MELEE) : MELEE
  const target = autoAimPoint(range)
  if (!target) return
  adapter.act('attack', { x: target.x, y: target.y })
}

// ------------------------------------------------------------------ build
function buildGhostPosition() {
  const p = adapter.self()
  const aimFrom = aimJoystickOrFacing()
  const dist = 2.6 * TILE
  let gx = p.x + aimFrom.x * dist, gy = p.y + aimFrom.y * dist
  const tap = input.tapWorld
  if (tap && !isTouchOnly()) {
    gx = tap.x; gy = tap.y
  }
  const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE)
  return { gx, gy, tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
}

function isTouchOnly() {
  try { return matchMedia('(pointer: coarse)').matches } catch { return false }
}

let aimF = null
function aimJoystickOrFacing() {
  if (input.joy.mag > 0.15) return { x: input.joy.dx, y: input.joy.dy }
  return lastFacing
}

function validAt(tx, ty) {
  const tiles = adapter.tiles(adapter.levelId())
  if (!tiles) return false
  if (tx <= 0 || ty <= 0 || tx >= tiles.w - 1 || ty >= tiles.h - 1) return false
  const b = tiles.tiles[ty * tiles.w + tx]
  const water = b <= 1 // deep/water
  const caveWall = b === 8
  if (water || caveWall) return false
  const objs = adapter.objects()
  for (const o of objs) {
    if (o.x === tx && o.y === ty && o.alive) return false
  }
  for (const e of adapter.ents()) if (Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty) return false
  return true
}

// ------------------------------------------------------------------ main loop
let loopLast = 0
function loop(ts) {
  const dt = Math.min(0.1, Math.max(0.001, (ts - loopLast) / 1000))
  loopLast = ts
  try { step(dt) } catch (e) { console.error(e) }
  requestAnimationFrame(loop)
}

function step(dt) {
  adapter.tick(dt)
  const p = adapter.self()
  if (!p) return
  // movement
  const mv = input.moveVector()
  if (mv && !p.dead) {
    const speed = PLAYER_BASE.speed * (1 + ((p.lvl || 1) - 1) * 0.02)
    const sprint = input.sprint()
    const mult = sprint && p.stamina > 1 ? 1.42 : 1
    const nx = p.x + mv.dx * speed * mult * dt
    const ny = p.y + mv.dy * speed * mult * dt
    adapter.move(nx, ny, Math.atan2(mv.dy, mv.dx), sprint)
    lastFacing = { x: mv.dx, y: mv.dy }
    footTimer += dt
  }
  attackCd -= dt
  if (input.consumeAttack() && attackCd <= 0) {
    tryAttack()
    const hand = p.equip.hand && ITEMS[p.equip.hand.id]
    attackCd = hand && hand.weapon ? hand.weapon.cd : 0.5
  }
  if (input.consumeInteract()) doInteract()
  // contextual interact button
  const near = nearestInteractable()
  const labels = { cave: 'Vào hang', exit: 'Lên lên', down: 'Xuống sâu', door: 'Mở cửa', chest: 'Rương' }
  ui.setInteract(near ? labels[near.kind] : null, doInteract)
  computeStations()
  // build ghost + snapshot contributions
  const hand = p.equip.hand
  let buildGhost = null
  if (buildMode.active && buildMode.kind) {
    const g = buildGhostPosition()
    buildGhost = { x: g.tx, y: g.ty, gx: g.tx, gy: g.ty, kind: buildMode.kind, ok: validAt(g.tx, g.ty) }
  }
  // adapter's world time
  ui.setTime(adapter.time.t, adapter.time.day)
  ui.setOnline(adapter.onlineCount())
  ui.setBars(p)
  // draw
  const state = {
    adapter,
    selfToken: adapter.tokenSelf || null,
    hpBars: [],
    buildGhost,
    baseline: adapter.gen ? baselineObjectsFor(adapter) : null,
    useBaseline: adapter.mode === 'online',
  }
  const vw = window.innerWidth, vh = window.innerHeight
  renderer.resize(vw, vh)
  renderer.zoom = Math.min(1.45, Math.max(0.85, Math.min(vw / (isTouchOnly() ? 400 : 620), vh / 430)))
  renderer.draw(state)
  input.viewport = { zoom: renderer.zoom, camX: renderer.camX, camY: renderer.camY }
  // hp bars overlay
  const ctx = renderer.ctx
  renderer.drawHpBars(ctx, state.hpBars)
  // events (toasts from server/runtime)
  const evs = adapter.drainEvents()
  for (const e of evs) {
    if (e.type === 'err' && e.msg) ui.toast('⚠️ ' + e.msg, 'warn')
    else if (e.type === 'err' && !e.msg) ui.toast('⚠️ Hành động không hợp lệ.', 'warn')
    else if (e.type === 'toast') ui.toast('💬 ' + e.msg)
    else if (e.type === 'levelup') ui.toast('🎉 Lên cấp ' + e.lvl + '!', 'good')
    else if (e.type === 'shoot' || e.type === 'build' || e.type === 'craft' || e.type === 'eat') { /* silent */ }
  }
  // death overlay
  if (p.dead && !deathShown) {
    deathShown = true
    ui.setDeath(true, 'Bạn đã bị hạ. Vật phẩm đã rơi tại chỗ gục. Nhấn Hồi sinh để quay lại điểm sinh tồn.')
  } else if (!p.dead && deathShown) {
    deathShown = false
    ui.setDeath(false)
  }
  ui.respawnCb = () => { adapter.respawn() }
  // callbacks for UI panels
  ui.uiAction = (act, arg) => handleUiAction(act, arg)
  ui.invClick = (slot, action) => handleInvAction(slot, action)
  ui.equipClick = (act, slot) => { if (act === 'repair') { adapter.act('repair', { slot }) ; setTimeout(() => ui.renderInventory(adapter), 120) } }
  ui.uiCb = (kind) => {
    if (kind === 'inv') ui.renderInventory(adapter)
    else if (kind === 'craft') ui.renderCraft(adapter, stations)
    else if (kind === 'build') ui.renderBuild(adapter, buildMode.active, buildMode.demolish)
    else if (kind === 'map') ui.renderMap(adapter, renderer, (g, c) => drawMapMarkers(g, c))
    else if (kind === 'players') ui.renderPlayers(adapter)
  }
  ui.onPanelClosed = () => { buildMode.active = false; buildMode.demolish = false }
}

function baselineObjectsFor(adapter) {
  const id = adapter.levelId()
  if (!adapter.gen) return []
  return id === 0 ? adapter.gen.surface.objects : (adapter.gen.caves[id - 1]?.objects || [])
}

function drawMapMarkers(g, c) {
  const p = adapter.self()
  const tiles = adapter.tiles(adapter.levelId())
  if (!tiles) return
  const tileToPx = (tx, ty) => [tx / tiles.w * c.width, ty / tiles.h * c.height]
  const worldToPx = (wx, wy) => [wx / (TILE * tiles.w) * c.width, wy / (TILE * tiles.h) * c.height]
  if (adapter.levelId() === 0) {
    for (const en of (adapter.world && adapter.world.entrances) || []) {
      const [px, py] = tileToPx(en.x, en.y)
      g.fillStyle = '#000'
      g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill()
      g.strokeStyle = '#ffd23c'; g.lineWidth = 2; g.stroke()
    }
  }
  const [px, py] = worldToPx(p.x, p.y)
  g.fillStyle = '#3ddc84'
  g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill()
  g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke()
  for (const q of adapter.othersAround()) {
    const [qx, qy] = worldToPx(q.x, q.y)
    g.fillStyle = `hsl(${q.hue ?? 210} 65% 55%)`
    g.beginPath(); g.arc(qx, qy, 4, 0, 7); g.fill()
  }
}

// ------------------------------------------------------------------ UI action dispatch
function handleUiAction(act, arg) {
  const p = adapter.self()
  if (act === 'craft') {
    adapter.act('craft', arg)
    setTimeout(() => { computeStations(); ui.renderCraft(adapter, stations) }, 150)
  } else if (act === 'build-select') {
    buildMode = { active: true, kind: arg, demolish: false }
    ui.toast('🧱 Chọn vị trí: nhấn nút Xây (chính giữa phải) để đặt tại ô trước mặt.')
    ui.closePanel()
  } else if (act === 'demolish-mode') {
    buildMode.demolish = !buildMode.demolish
    ui.renderBuild(adapter, buildMode.active, buildMode.demolish)
  }
  // chest ops handled via specific ids
  if (arg && arg.objId) {
    if (act === 'chestPut') {
      adapter.act('chest', { objId: arg.objId, op: 'put', from: arg.from })
      setTimeout(() => refreshChest(arg.objId), 150)
    } else if (act === 'chestTake') {
      adapter.act('chest', { objId: arg.objId, op: 'take', from: arg.from })
      setTimeout(() => refreshChest(arg.objId), 150)
    }
  }
}

function refreshChest(objId) {
  const objs = adapter.objects()
  const chest = objs.find(o => (o.i === objId || o.id === objId))
  if (chest) ui.renderChest(adapter, chest)
}

function handleInvAction(slot, action) {
  const p = adapter.self()
  const item = p.inv && p.inv[slot]
  if (!item) return
  if (action === 'equip') adapter.act('equip', { from: slot })
  else if (action === 'eat') adapter.act('eat', { from: slot })
  else if (action === 'drop') adapter.act('drop', { from: slot, qty: 1 })
  else if (action === 'repair') adapter.act('repair', { slot: 'hand' })
  setTimeout(() => { if (ui.activePanel === 'Túi đồ') ui.renderInventory(adapter) }, 140)
}

// ------------------------------------------------------------------ boot
function boot() {
  ui.nameInput.value = getSavedName()
  ui.playBtn.addEventListener('click', () => {
    const name = (ui.nameInput.value || '').trim().slice(0, 14) || 'Survivor' + Math.floor(100 + Math.random() * 900)
    if (STORE) { try { STORE.setItem('smp_name', name) } catch {} }
    startOnline(name)
  })
  const solo = $('soloBtn')
  if (solo) solo.addEventListener('click', () => {
    const name = (ui.nameInput.value || '').trim().slice(0, 14) || 'Survivor' + Math.floor(100 + Math.random() * 900)
    if (STORE) { try { STORE.setItem('smp_name', name) } catch {} }
    startOffline(name)
  })
  // keyboard panel shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return
    const k = e.key.toLowerCase()
    if (k === 'i') ui.cb('inv')
    if (k === 'c') ui.cb('craft')
    if (k === 'b') ui.cb('build')
    if (k === 'm') ui.cb('map')
    if (k === 'p') ui.cb('players')
  })
  window.addEventListener('beforeunload', () => { try { adapter && adapter.saveNow() } catch {} })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { try { adapter && adapter.saveNow() } catch {} }
  })
  // attack & build action buttons (touch)
  bindHoldButton('btnAttack', () => { tryAttack() }, () => { })
  bindTap('btnBuildApply', () => {
    if (!buildMode.active || !buildMode.kind) {
      ui.toast('Chọn công trình từ panel Xây dựng trước.')
      return
    }
    if (buildMode.demolish) {
      const p2 = adapter.self()
      const g = buildGhostPosition()
      adapter.act('demolish', { x: g.x, y: g.y })
      return
    }
    const g = buildGhostPosition()
    adapter.act('build', { kind: buildMode.kind, x: g.x, y: g.y })
    setTimeout(() => ui.toast('🏗️ Đã gửi lệnh xây.', undefined), 10)
  })
  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight)
  })
}

function bindHoldButton(id, down, up) {
  const b = $(id)
  if (!b) return
  b.addEventListener('pointerdown', (e) => { down(); e.preventDefault() })
  b.addEventListener('pointerup', up)
  b.addEventListener('pointercancel', up)
  b.addEventListener('pointerleave', up)
}

function bindTap(id, fn) {
  const b = $(id)
  if (!b) return
  b.addEventListener('click', () => fn())
}

function SHOW_HELP_ONCE() {
  if (STORE && STORE.getItem('smp_help_seen')) return
  ui.toast('🗺️ Di chuyển bằng cần điều khiển trái. ⚔️ Tấn công, ✋ Tương tác. Mở Chế tạo để làm rìu/cuốc đầu tiên!')
  try { STORE && STORE.setItem('smp_help_seen', '1') } catch {}
}

boot()
window.__SMP = { getAdapter: () => adapter, adapter: () => adapter, tryOffline: startOffline }
