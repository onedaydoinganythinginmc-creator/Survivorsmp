// SURVIVOR SMP - DOM overlay UI (HUD, panels, toasts, menu) - mobile first
import { ITEMS, repairCost } from '../shared/items.js'
import { RECIPES, BUILD_FORGE, canAfford } from '../shared/recipes.js'
import { BUILDS, TILE } from '../shared/constants.js'

export const $ = (id) => document.getElementById(id)
const el = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

export class UI {
  constructor() {
    this.toastWrap = $('toasts')
    this.hpBar = $('barHpFill')
    this.hungerBar = $('barHungerFill')
    this.staminaBar = $('barStaminaFill')
    this.xpFill = $('barXpFill')
    this.lvlLabel = $('lvlLabel')
    this.timeLabel = $('timeLabel')
    this.onlineChip = $('onlineChip')
    this.menu = $('menu')
    this.nameInput = $('nameInput')
    this.connectStatus = $('connectStatus')
    this.playBtn = $('playBtn')
    this.deathOverlay = $('deathOverlay')
    this.respawnBtn = $('respawnBtn')
    this.deathMsg = $('deathMsg')
    this.modeBanner = $('modeBanner')
    this.interactBtn = $('btnInteract')
    this.atkBtn = $('btnAttack')
    this.toolbar = $('toolbar')
    this.activePanel = null
    this.panelWrap = $('panelWrap')
    this.panelTitle = $('panelTitle')
    this.panelBody = $('panelBody')
    this.interactCb = null
    this.equipClick = null

    $('closePanel').addEventListener('click', () => this.closePanel())
    this.interactBtn.addEventListener('click', () => this.interactCb && this.interactCb())
    this.respawnBtn.addEventListener('click', () => this.respawnCb && this.respawnCb())
    this.setupToolbar()
  }

  setupToolbar() {
    const defs = [
      ['btnInv', 'Balo', () => this.cb('inv')],
      ['btnCraft', 'Chế tạo', () => this.cb('craft')],
      ['btnBuild', 'Xây dựng', () => this.cb('build')],
      ['btnMap', 'Bản đồ', () => this.cb('map')],
      ['btnPlayers', 'Người chơi', () => this.cb('players')],
    ]
    for (const [id, label, fn] of defs) {
      const b = document.getElementById(id)
      if (b) b.addEventListener('click', fn)
    }
  }

  cb(kind) { if (this.uiCb) this.uiCb(kind) }

  toast(msg, kind = 'info') {
    const t = el('div', 'toast ' + kind, msg)
    this.toastWrap.appendChild(t)
    setTimeout(() => t.classList.add('show'), 10)
    setTimeout(() => {
      t.classList.remove('show')
      setTimeout(() => t.remove(), 400)
    }, 2600)
    while (this.toastWrap.children.length > 4) this.toastWrap.firstChild.remove()
  }

  setBars(p) {
    if (!p) return
    this.hpBar.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%'
    this.hungerBar.style.width = Math.max(0, p.hunger) + '%'
    this.staminaBar.style.width = Math.max(0, p.stamina) + '%'
    this.lvlLabel.textContent = 'Lv. ' + p.lvl
    this.xpFill.style.width = (Math.min(100, ((p.exp === undefined ? 0 : p.exp)) % 100)) + '%'
  }

  setTime(t, day) {
    const night = t > 0.72 || t < 0.12
    const hour = Math.floor(((t + 0.0) % 1) * 24)
    this.timeLabel.textContent = `${night ? '🌙' : '☀️'} Ngày ${day} `
  }

  setOnline(n, maxN) { this.onlineChip.textContent = `👤 ${n} online` }

  setInteract(text, cb) {
    if (text) {
      this.interactBtn.style.display = 'flex'
      this.interactBtn.textContent = text
      this.interactCb = cb
    } else {
      this.interactBtn.style.display = 'none'
      this.interactCb = null
    }
  }

  setDeath(dead, msg) {
    this.deathOverlay.style.display = dead ? 'flex' : 'none'
    if (dead) this.deathMsg.textContent = msg
  }

  showPanel(title) {
    this.activePanel = title
    this.panelWrap.style.display = 'flex'
    this.panelTitle.textContent = title
    this.panelBody.innerHTML = ''
  }
  closePanel() {
    this.panelWrap.style.display = 'none'
    this.activePanel = null
    if (this.onPanelClosed) this.onPanelClosed()
  }

  // --------------------------------------------------- inventory & equipment
  renderInventory(adapter, opts) {
    const p = adapter.self()
    this.showPanel('Túi đồ')
    const body = this.panelBody
    // equipment row
    const eq = el('div', 'inv-eq')
    const slots = [
      ['hand', '⚔️ Tay vũ khí'],
      ['armor', '🛡️ Giáp'],
    ]
    for (const [slot, label] of slots) {
      const item = p.equip[slot]
      const box = el('div', 'inv-slot eq-slot')
      if (item) {
        box.innerHTML = itemHtml(item)
        box.title = ITEMS[item.id].name
        if (item.dur != null) {
          const d = ITEMS[item.id]
          const durFrac = Math.max(0, Math.min(1, item.dur / d.dur))
          box.appendChild(el('div', 'durbar', `<i style="width:${durFrac * 100}%"></i>`))
        }
        const rep = el('button', 'mini-btn', 'Sửa')
        rep.addEventListener('click', () => this.equipClick('repair', slot))
        box.appendChild(rep)
      } else box.appendChild(el('div', 'inv-empty', 'Trống'))
      box.appendChild(el('div', 'inv-label', label))
      eq.appendChild(box)
    }
    body.appendChild(eq)
    const grid = el('div', 'inv-grid')
    for (let i = 0; i < p.inv.length; i++) {
      const s = p.inv[i]
      const box = el('div', 'inv-slot')
      if (s) {
        box.innerHTML = itemHtml(s) + (s.qty > 1 ? `<i class="qty">${s.qty}</i>` : '')
        const def = ITEMS[s.id]
        const actions = []
        if (def.weapon || def.tool) actions.push(['Trang bị', 'equip'])
        if (def.armor) actions.push(['Mặc', 'equip'])
        if (def.food) actions.push(['Ăn', 'eat'])
        actions.push(['Vứt 1', 'drop'])
        const menu2 = el('div', 'inv-menu')
        for (const [txt, act] of actions) {
          const b = el('button', 'mini-btn', txt)
          b.addEventListener('click', () => this.invClick && this.invClick(i, act))
          menu2.appendChild(b)
        }
        box.appendChild(menu2)
      } else box.classList.add('empty')
      box.addEventListener('click', () => { for (const b of box.querySelectorAll('.mini-btn')) b.classList.toggle('show') ; box.classList.toggle('sel') })
      grid.appendChild(box)
    }
    body.appendChild(grid)
  }

  // --------------------------------------------------- crafting
  renderCraft(adapter, stations) {
    const p = adapter.self()
    this.showPanel('Chế tạo')
    const body = this.panelBody
    const near = !!(stations && stations.size)
    const note = el('div', 'panel-note', near
      ? 'Công thức đặc biệt khả dụng khi đứng gần trạm.'
      : 'Chế tạo cơ bản không cần trạm. Cận các trạm để mở thêm công thức.')
    body.appendChild(note)
    const hasStation = (want) => {
      if (want === 'any') return true
      if (!stations) return false
      if (want === 'anvil') return stations.has('hammer_anvil')
      return stations.has(want)
    }
    for (const rec of RECIPES) {
      if (rec.hidden) continue
      const okStation = hasStation(rec.where)
      const afford = canAfford(p.inv, rec.in)
      const row = el('div', 'craft-row' + (!afford || !okStation ? ' disabled' : ''))
      const o0 = rec.out[0]
      const def = ITEMS[out]
      const mats = Object.entries(rec.in).map(([k, v]) => `${ITEMS[k].name} x${v}`).join(', ')
      row.innerHTML = `
        <i class="ico" style="background:${def ? def.color : '#888'}"></i>
        <div class="craft-info"><b>${def ? def.name : rec.id}</b>${qty > 1 ? ` <span class="xqty">x${qty}</span>` : ''}
        <span class="mats">${mats}</span></div>
        <button class="mini-btn big">${okStation ? (afford ? 'Chế tạo' : 'Thiếu NL') : 'Cần trạm'}</button>`
      const btn = row.querySelector('button')
      if (okStation && afford) btn.addEventListener('click', () => this.uiAction('craft', { id: rec.id }))
      body.appendChild(row)
    }
  }

  // --------------------------------------------------- build
  renderBuild(adapter, buildMode, demolishMode) {
    const p = adapter.self()
    this.showPanel('Xây dựng')
    const body = this.panelBody
    const note = el('div', 'panel-note', 'Chọn công trình rồi di chuyển/HUD nút Xây để đặt tại vị trí ô lưới. Phá dỡ cần Búa và chỉ phá công trình của bạn.')
    body.appendChild(note)
    const dem = el('button', 'mini-btn big wide' + (demolishMode ? ' danger on' : ''), demolishMode ? 'Đang CHẾ ĐỘ PHÁ DỠ (tắt)' : 'Chế độ phá dỡ (nhu cầu búa)')
    dem.addEventListener('click', () => this.uiAction('demolish-mode'))
    body.appendChild(dem)
    for (const [kind, b] of Object.entries(BUILDS)) {
      const afford = canAfford(p.inv, BUILD_FORGE[kind] || b.cost)
      const mats = Object.entries(BUILD_FORGE[kind] || b.cost).map(([k, v]) => `${ITEMS[k].name} x${v}`).join(', ')
      const row = el('div', 'craft-row' + (afford ? '' : ' disabled'))
      row.innerHTML = `
        <i class="ico buildi ${kind}" style="background:${buildColor(kind)}"></i>
        <div class="craft-info"><b>${b.name}</b><span class="mats">${mats}</span></div>
        <button class="mini-btn big">${afford ? 'Chọn' : 'Thiếu NL'}</button>`
      if (afford) row.querySelector('button').addEventListener('click', () => this.uiAction('build-select', kind))
      body.appendChild(row)
    }
  }

  // --------------------------------------------------- chest
  renderChest(adapter, chestObj, op) {
    this.showPanel('Rương')
    const body = this.panelBody
    const grid = el('div', 'inv-grid chest')
    const items = chestObj.container && Array.isArray(chestObj.container.items) ? chestObj.container.items : []
    for (let i = 0; i < items.length; i++) {
      const s = items[i]
      const box = el('div', 'inv-slot')
      if (s) {
        box.innerHTML = itemHtml(s) + (s.qty > 1 ? `<i class="qty">${s.qty}</i>` : '')
        box.addEventListener('click', () => this.uiAction('chestTake', { objId: chestObj.id || chestObj.i, from: i }))
      }
      grid.appendChild(box)
    }
    body.appendChild(grid)
    const sep = el('div', 'panel-note', 'Chạm ô bên dưới để chuyển vào rương (tự động gộp):')
    body.appendChild(sep)
    const p = adapter.self()
    const pgrid = el('div', 'inv-grid')
    for (let i = 0; i < p.inv.length; i++) {
      const s = p.inv[i]
      const box = el('div', 'inv-slot' + (s ? '' : ' empty'))
      if (s) {
        box.innerHTML = itemHtml(s) + (s.qty > 1 ? `<i class="qty">${s.qty}</i>` : '')
        box.addEventListener('click', () => this.uiAction('chestPut', { objId: chestObj.id || chestObj.i, from: i }))
      }
      pgrid.appendChild(box)
    }
    body.appendChild(pgrid)
  }

  renderPlayers(adapter) {
    this.showPanel('Người chơi trực tuyến')
    const body = this.panelBody
    const list = [adapter.self(), ...adapter.othersAround()]
    for (const q of list) {
      const row = el('div', 'player-row')
      row.innerHTML = `<i style="background:hsl(${q.hue ?? 210} 65% 55%)"></i><b>${(q.name || '?').slice(0, 14)}</b><span>Lv.${q.lvl ?? 1}</span>`
      body.appendChild(row)
    }
    const note = el('div', 'panel-note', adapter.mode === 'offline'
      ? 'Chế độ solo offline: thế giới riêng của bạn. Multiplayer cần máy chủ live.'
      : `Máy chủ chung: ${adapter.onlineCount()} người chơi trên cùng một thế giới SMP.`)
    body.appendChild(note)
  }

  renderMap(adapter, renderer, drawMarkers) {
    this.showPanel('Bản đồ')
    const body = this.panelBody
    const c = el('canvas', 'map-canvas')
    c.width = 420; c.height = 420
    body.appendChild(c)
    this.mapCanvas = c
    this.mapCb = drawMarkers
    const g = c.getContext('2d')
    const tiles = adapter.tiles(adapter.levelId())
    if (!tiles) return
    const mini = renderer.mapForLevel({ ...tiles, seedTag: 'map' + tiles.w + tiles.h + adapter.seed })
    g.imageSmoothingEnabled = false
    g.drawImage(mini, 0, 0, c.width, c.height)
    if (this.mapCb) this.mapCb(g, c, adapter)
  }
  confirmModal(msg, onYes) {
    const wrap = el('div', 'modal-wrap')
    const card = el('div', 'modal-card')
    card.innerHTML = `<h3>🪓 Xác nhận</h3><p>${msg}</p>`
    const acts = el('div', 'modal-acts')
    const yes = el('button', 'mini-btn big', 'Xác nhận')
    const no = el('button', 'mini-btn', 'Hủy')
    yes.addEventListener('click', () => { wrap.remove(); onYes && onYes() })
    no.addEventListener('click', () => wrap.remove())
    acts.appendChild(no); acts.appendChild(yes)
    card.appendChild(acts)
    wrap.appendChild(card)
    document.body.appendChild(wrap)
  }
}

function itemHtml(item) {
  const def = ITEMS[item.id]
  if (!def) return '?'
  return `<i class="ico" style="background:${def.color}"></i>`
}

function buildColor(kind) {
  const colors = { floor_wood: '#a3713f', wall_wood: '#8a5a2b', wall_stone: '#8d9296', fence: '#9c6b3a', door: '#8a5a2b', roof: '#b2743f', chest: '#8a5a2b', workbench: '#9c713d', furnace: '#6b7076', campfire: '#ff9a3c', hammer_anvil: '#575b60' }
  return colors[kind] || '#888'
}
