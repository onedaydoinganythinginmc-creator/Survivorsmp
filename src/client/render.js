// SURVIVOR SMP - canvas renderer (top-down 2D, mobile-first pixel style)
import { TILE, BIOME, ENTITY_TYPES, BUILDS, NIGHT_START, NIGHT_END, isNight } from '../shared/constants.js'

const TILE_COLORS = {
  [BIOME.DEEP_WATER]: ['#1b4b72', '#19456a'],
  [BIOME.WATER]: ['#2a6d97', '#27678f'],
  [BIOME.SAND]: ['#d8c58c', '#cbbd7f'],
  [BIOME.GRASS]: ['#5d9440', '#57903c'],
  [BIOME.MEADOW]: ['#7f9c43', '#799840'],
  [BIOME.FOREST]: ['#3f7a34', '#3a7330'],
  [BIOME.ROCK]: ['#8d8f92', '#86888b'],
  [BIOME.CAVE_FLOOR]: ['#4c4652', '#494450'],
  [BIOME.CAVE_WALL]: ['#221d26', '#262029'],
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.zoom = 1
    this.mapCache = new Map() // levelId -> {canvas}
    this.deco = { t: 0 }
  }

  resize(w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.vw = w
    this.vh = h
  }

  mapForLevel(tiles) {
    const key = tiles.w + ':' + tiles.h + ':' + tiles.seedTag
    let c = this.mapCache.get(key)
    if (c) return c
    c = document.createElement('canvas')
    c.width = tiles.w; c.height = tiles.h
    const g = c.getContext('2d')
    const im = g.createImageData(tiles.w, tiles.h)
    for (let y = 0; y < tiles.h; y++) for (let x = 0; x < tiles.w; x++) {
      const b = tiles.tiles[y * tiles.w + x]
      const col = TILE_COLORS[b] ? TILE_COLORS[b][0] : '#000'
      // parse hex
      const n = parseInt(col.slice(1), 16)
      const i = (y * tiles.w + x) * 4
      im.data[i] = (n >> 16) & 255
      im.data[i + 1] = (n >> 8) & 255
      im.data[i + 2] = n & 255
      im.data[i + 3] = 255
    }
    g.putImageData(im, 0, 0)
    c.seedTag = tiles.seedTag
    this.mapCache.set(key, c)
    return c
  }

  seedTag(tiles) { return this.seedTagVal }

  draw(state) {
    const { ctx, canvas, vw, vh } = this
    const a = state.adapter
    if (!a) return
    const levelTiles = a.tiles(a.levelId())
    if (!levelTiles) { this.drawBaseBg(state, 0); this.camX = 0; this.camY = 0; return }
    const p = a.self()
    const camX = p.x - vw / 2 / this.zoom
    const camY = p.y - vh / 2 / this.zoom
    this.camX = camX; this.camY = camY
    this.deco.t += 1 / 60
    this.ctx.save()
    this.ctx.scale(this.zoom, this.zoom)
    this.ctx.translate(-camX, -camY)
    const x0 = Math.max(0, Math.floor(camX / TILE) - 1), x1 = Math.min(levelTiles.w - 1, Math.ceil((camX + vw / this.zoom) / TILE) + 1)
    const y0 = Math.max(0, Math.floor(camY / TILE) - 1), y1 = Math.min(levelTiles.h - 1, Math.ceil((camY + vh / this.zoom) / TILE) + 1)
    // tiles
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const b = levelTiles.tiles[ty * levelTiles.w + tx]
      const pair = TILE_COLORS[b] || ['#222', '#222']
      const ck = hash(tx, ty) % 2
      ctx.fillStyle = pair[ck]
      ctx.fillRect(tx * TILE, ty * TILE, TILE + 0.6, TILE + 0.6)
      if (b === BIOME.WATER || b === BIOME.DEEP_WATER) {
        const wav = (Math.sin(this.deco.t * 1.4 + tx * 1.3 + ty * 0.7) + 1) / 2
        ctx.fillStyle = `rgba(255,255,255,${0.04 + wav * 0.05})`
        ctx.fillRect(tx * TILE + 4, ty * TILE + 10, TILE - 8, 2)
      } else if (b === BIOME.GRASS || b === BIOME.MEADOW || b === BIOME.FOREST) {
        ctx.fillStyle = 'rgba(0,0,0,0.05)'
        if ((hash(tx, ty) & 7) === 0) ctx.fillRect(tx * TILE + 8, ty * TILE + 18, 3, 2)
        if ((hash(tx + 31, ty) & 7) === 0) ctx.fillRect(tx * TILE + 20, ty * TILE + 8, 3, 2)
      } else if (b === BIOME.CAVE_FLOOR) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)'
        if ((hash(tx, ty + 7) & 15) === 0) ctx.fillRect(tx * TILE + 10, ty * TILE + 14, 4, 3)
      }
    }
    // cave border shading for surface level cliffs
    if (a.levelId() === 0) {
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (levelTiles.tiles[ty * levelTiles.w + tx] !== BIOME.ROCK) continue
        ctx.fillStyle = 'rgba(0,0,0,0.10)'
        if (ty + 1 <= y1 && levelTiles.tiles[(ty + 1) * levelTiles.w + tx] !== BIOME.ROCK) ctx.fillRect(tx * TILE, ty * TILE + TILE - 6, TILE, 6)
      }
    }
    // objects sorted by y
    const objs = []
    const overrides = a.objects()
    for (const o of overrides) objs.push(o)
    // baseline objects not overridden (offline adapter passes everything already)
    const baseline = state.baseline || []
    if (state.useBaseline) {
      const seen = new Set(objs.map(o => o.i))
      for (const o of baseline) { if (!seen.has(o.i)) objs.push(o) }
    }
    objs.sort((a, b) => a.y - b.y)
    for (const o of objs) this.drawObject(ctx, o, state)
    // drops
    for (const d of a.drops()) this.drawDrop(ctx, d)
    // entities + other players + projectiles
    const living = []
    for (const e of a.ents()) { if (e.hp > 0) living.push(e) }
    for (const e of living) this.drawEntity(ctx, e, state)
    for (const q of a.othersAround()) this.drawOtherPlayer(ctx, q, state)
    this.drawSelf(ctx, a, state)
    ctx.restore()
    // build ghost last
    if (state.buildGhost) this.drawGhost(ctx, state)
    // day/night overlay + lights
    this.drawLighting(state, camX, camY)
    // vignette-ish border
  }

  drawBaseBg(state, alpha) {
    const { ctx, vw, vh } = this
    ctx.fillStyle = '#10131b'
    ctx.fillRect(0, 0, vw, vh)
  }

  // ------------------------------------------------------------- objects
  drawObject(ctx, o, state) {
    const x = o.x * TILE + TILE / 2, y = o.y * TILE + TILE / 2
    const dead = !o.alive
    ctx.save()
    ctx.translate(x, y)
    switch (o.t) {
      case 'tree': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath(); ctx.ellipse(3, 10, 13, 5, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#6b4a2b'
        ctx.fillRect(-3, -2, 6, 12)
        if (dead) { ctx.fillStyle = '#7a7f74'; ctx.fillRect(-2, -4, 5, 10); break }
        const h = hash(o.x, o.y)
        const sway = Math.sin(this.deco.t * 0.8 + h) * 1.2
        ctx.fillStyle = '#2f6d2a'
        ctx.beginPath(); ctx.arc(sway, -8, 15, 0, 7); ctx.fill()
        ctx.fillStyle = '#3d8a35'
        ctx.beginPath(); ctx.arc(sway - 3, -11, 11, 0, 7); ctx.fill()
        ctx.fillStyle = '#57a349'
        ctx.beginPath(); ctx.arc(sway + 2, -13, 7, 0, 7); ctx.fill()
        break
      }
      case 'rock': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath(); ctx.ellipse(2, 8, 12, 5, 0, 0, 7); ctx.fill()
        ctx.fillStyle = dead ? '#6d7175' : '#8a8f93'
        ctx.beginPath()
        ctx.moveTo(-11, 6); ctx.lineTo(-9, -6); ctx.lineTo(-2, -10); ctx.lineTo(8, -7); ctx.lineTo(11, 4); ctx.lineTo(6, 8); ctx.lineTo(-6, 8)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = dead ? '#767b7f' : '#9aa1a5'
        ctx.fillRect(-6, -6, 6, 4)
        if (dead) { ctx.fillStyle = '#85898c'; ctx.beginPath(); ctx.arc(2, 4, 5, 0, 7); ctx.fill() }
        break
      }
      case 'bush': {
        ctx.fillStyle = 'rgba(0,0,0,0.2)'
        ctx.beginPath(); ctx.ellipse(0, 8, 10, 4, 0, 0, 7); ctx.fill()
        if (dead) { ctx.fillStyle = '#6c6a52'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill(); break }
        ctx.fillStyle = '#2e6b2f'
        ctx.beginPath(); ctx.arc(-4, -2, 8, 0, 7); ctx.arc(4, -1, 8, 0, 7); ctx.arc(0, 2, 8, 0, 7); ctx.fill()
        ctx.fillStyle = '#c0392b'
        ctx.beginPath(); ctx.arc(-5, -1, 2, 0, 7); ctx.arc(3, 3, 2, 0, 7); ctx.arc(5, -4, 2, 0, 7); ctx.fill()
        break
      }
      case 'grass_tuft': {
        ctx.strokeStyle = dead ? '#918a6d' : '#8fb548'
        ctx.lineWidth = 2
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath()
          ctx.moveTo(i * 4 - 2, 8)
          ctx.quadraticCurveTo(i * 3 - 2, 0, i * 5, -6)
          ctx.stroke()
        }
        break
      }
      default: {
        if (o.t.startsWith('ore_')) {
          const colors = { ore_coal: '#2f3843', ore_copper: '#c47a3d', ore_iron: '#cfd6dc', ore_gold: '#e8c53d', ore_gem: '#7ce0d3' }
          const c = colors[o.t] || '#aaa'
          ctx.fillStyle = 'rgba(0,0,0,0.25)'
          ctx.beginPath(); ctx.ellipse(2, 8, 13, 5, 0, 0, 7); ctx.fill()
          ctx.fillStyle = dead ? '#75797d' : '#8a8f93'
          ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-9, -7); ctx.lineTo(0, -11); ctx.lineTo(9, -6); ctx.lineTo(12, 5); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill()
          ctx.fillStyle = c
          const hp = o.hp / o.max
          if (!dead) {
            ctx.beginPath(); ctx.arc(-4, -3, 3 + hp * 1.5, 0, 7); ctx.arc(3, 2, 2.5 + hp, 0, 7); ctx.arc(5, -5, 2 + hp, 0, 7); ctx.fill()
          }
        } else if (o.t === 'cave_entrance') {
          ctx.fillStyle = '#0d0a06'
          ctx.beginPath(); ctx.ellipse(0, 0, 13, 11, 0, 0, 7); ctx.fill()
          ctx.fillStyle = '#2c2620'
          ctx.beginPath(); ctx.ellipse(0, 3, 13, 8, 0, 3.34, 6.1); ctx.fill()
          ctx.strokeStyle = '#7a6b4d'
          ctx.lineWidth = 3
          ctx.stroke()
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.beginPath(); ctx.ellipse(0, 2, 7, 5, 0, 0, 7); ctx.fill()
        } else if (o.t === 'cave_exit') {
          ctx.fillStyle = '#141018'
          ctx.beginPath(); ctx.ellipse(0, 0, 12, 12, 0, 0, 7); ctx.fill()
          ctx.strokeStyle = '#d8b25a'
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.fill()
          ctx.fillStyle = '#e8c53d'
          ctx.fillRect(-8, -2, 3, 10)
          ctx.fillRect(5, -2, 3, 10)
        } else if (o.t === 'cave_down') {
          ctx.fillStyle = '#0b070d'
          ctx.beginPath(); ctx.ellipse(0, 0, 12, 12, 0, 0, 7); ctx.fill()
          ctx.strokeStyle = '#5a5747'
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke()
        } else if (o.t.startsWith('b:')) {
          this.drawBuild(ctx, o, state)
        } else if (o.t === 'chest') {
          ctx.fillStyle = 'rgba(0,0,0,0.3)'
          ctx.beginPath(); ctx.ellipse(0, 6, 10, 4, 0, 0, 7); ctx.fill()
          ctx.fillStyle = '#8a5a2b'
          ctx.fillRect(-8, -6, 16, 12)
          ctx.fillStyle = '#a3703a'
          ctx.fillRect(-8, -6, 16, 5)
          ctx.fillStyle = '#e8c53d'
          ctx.fillRect(-2, -2, 4, 4)
        }
      }
    }
    ctx.restore()
    if (o.hp != null && o.max && o.hp < o.max && o.alive && o.t !== 'cave_entrance' && o.t !== 'cave_exit' && !o.t.startsWith('b:chest')) {
      state.hpBars.push({ x, y: y - 16, hp: o.hp, max: o.max })
    }
  }

  drawBuild(ctx, o, state) {
    const kind = o.t.slice(2)
    const b = BUILDS[kind]
    const isOwner = state.selfToken ? o.owner === state.selfToken : true
    ctx.save()
    if (kind === 'floor_wood') {
      ctx.fillStyle = '#a3713f'
      ctx.fillRect(-16, -16, 32, 32)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.strokeStyle = '#8a5a2b'
      ctx.lineWidth = 1
      ctx.strokeRect(-16, -16, 32, 32)
      ctx.strokeRect(-16, -6, 32, 10)
      ctx.strokeRect(-6, -16, 12, 32)
    } else if (kind === 'wall_wood') {
      ctx.fillStyle = '#8a5a2b'
      ctx.fillRect(-15, -15, 30, 30)
      ctx.fillStyle = '#a3713f'
      ctx.fillRect(-15, -15, 30, 8)
      ctx.strokeStyle = '#6b4623'
      ctx.strokeRect(-15, -15, 30, 30)
    } else if (kind === 'wall_stone') {
      ctx.fillStyle = '#74797e'
      ctx.fillRect(-15, -15, 30, 30)
      ctx.fillStyle = '#8d9296'
      ctx.fillRect(-15, -15, 13, 13)
      ctx.fillRect(2, -2, 13, 13)
      ctx.strokeStyle = '#5c6165'
      ctx.strokeRect(-15, -15, 30, 30)
    } else if (kind === 'fence') {
      ctx.fillStyle = '#9c6b3a'
      ctx.fillRect(-14, -7, 4, 16)
      ctx.fillRect(10, -7, 4, 16)
      ctx.fillRect(-14, -5, 28, 3)
      ctx.fillRect(-14, 2, 28, 3)
    } else if (kind === 'door') {
      ctx.fillStyle = o.open ? 'rgba(138,90,43,0.25)' : '#8a5a2b'
      ctx.fillRect(-15, -15, 30, 30)
      ctx.fillStyle = '#a3713f'
      if (o.open) ctx.fillRect(-15, -15, 10, 30)
      else ctx.fillRect(-13, -13, 26, 26)
      ctx.fillStyle = '#e8c53d'
      ctx.fillRect(3, -2, 3, 3)
    } else if (kind === 'roof') {
      ctx.fillStyle = 'rgba(178,116,55,0.92)'
      ctx.fillRect(-16, -16, 32, 32)
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(-16, -16, 32, 9)
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.strokeRect(-16, -16, 32, 32)
    } else if (kind === 'chest') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath(); ctx.ellipse(0, 6, 11, 4, 0, 0, 7); ctx.fill()
      ctx.fillStyle = '#8a5a2b'
      ctx.fillRect(-11, -8, 22, 15)
      ctx.fillStyle = '#a3703a'
      ctx.fillRect(-11, -8, 22, 7)
      ctx.strokeStyle = '#6b4623'
      ctx.strokeRect(-11, -8, 22, 15)
      ctx.fillStyle = '#e8c53d'
      ctx.fillRect(-2, -3, 4, 5)
    } else if (kind === 'workbench') {
      ctx.fillStyle = '#9c713d'
      ctx.fillRect(-14, -8, 28, 17)
      ctx.fillStyle = '#b98a55'
      ctx.fillRect(-14, -12, 28, 6)
      ctx.fillStyle = '#77512c'
      ctx.fillRect(-11, -3, 9, 3)
      ctx.fillRect(2, -4, 10, 2)
    } else if (kind === 'furnace') {
      ctx.fillStyle = '#6b7076'
      ctx.fillRect(-13, -12, 26, 24)
      ctx.fillStyle = '#868b90'
      ctx.fillRect(-13, -12, 26, 8)
      ctx.fillStyle = '#2a2d30'
      ctx.fillRect(-8, -2, 16, 12)
      const lit = Math.sin(this.deco.t * 5) > -0.3
      ctx.fillStyle = lit ? '#ff9a3c' : '#7a3c1d'
      ctx.fillRect(-5, 1, 10, 7)
    } else if (kind === 'campfire') {
      ctx.fillStyle = '#5d4a33'
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        ctx.fillRect(Math.cos(a) * 9 - 2, Math.sin(a) * 7 - 2, 4, 4)
      }
      const f = 0.7 + Math.sin(this.deco.t * 7 + o.x) * 0.3
      ctx.fillStyle = '#ff9a3c'
      ctx.beginPath(); ctx.moveTo(-5, 6); ctx.quadraticCurveTo(-6 + f, -8, 0, -4 - f * 8); ctx.quadraticCurveTo(6 - f, -8, 5, 6); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#ffd23c'
      ctx.beginPath(); ctx.moveTo(-3, 6); ctx.quadraticCurveTo(-2, -3, 0, -1 - f * 4); ctx.quadraticCurveTo(3, -3, 3, 6); ctx.closePath(); ctx.fill()
    } else if (kind === 'hammer_anvil') {
      ctx.fillStyle = '#575b60'
      ctx.fillRect(-11, -2, 22, 12)
      ctx.fillStyle = '#2f3336'
      ctx.fillRect(-13, -7, 26, 7)
      ctx.fillStyle = '#8d9296'
      ctx.fillRect(-6, -10, 12, 4)
    }
    ctx.restore()
    if (kind !== 'floor_wood' && o.hp != null && o.max && o.hp < o.max) {
      state.hpBars.push({ x: o.x * TILE + 16, y: o.y * TILE - 4, hp: o.hp, max: o.max })
    }
  }

  drawGhost(ctx, state) {
    const g = state.buildGhost
    if (!g) return
    const { x, y, ok, kind } = g
    ctx.save()
    ctx.translate(x * TILE + TILE / 2, y * TILE + TILE / 2)
    ctx.globalAlpha = 0.55
    this.drawBuild(ctx, { t: 'b:' + kind, x, y, hp: 1, max: 1, open: false }, { ...state, hpBars: [] })
    ctx.globalAlpha = 1
    ctx.strokeStyle = ok ? 'rgba(120,255,140,0.9)' : 'rgba(255,90,90,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(-17, -17, 34, 34)
    ctx.restore()
  }

  // ------------------------------------------------------------- entities
  drawEntityEyes(ctx, dx, dy, color = '#1c1c1c') {
    ctx.fillStyle = color
    if (Math.abs(dx) > Math.abs(dy)) {
      ctx.fillRect(dx > 0 ? 3 : -5, -3, 2.5, 2.5)
      ctx.fillRect(dx > 0 ? 3 : -5, 1, 2.5, 2.5)
    } else {
      ctx.fillRect(-4, dy > 0 ? 2 : -5, 2.5, 2.5)
      ctx.fillRect(2, dy > 0 ? 2 : -5, 2.5, 2.5)
    }
  }

  drawEntity(ctx, e, state) {
    const dx = e.vx || 0, dy = e.vy || 0
    const bob = Math.sin(this.deco.t * 8 + e.id.length) * 1.2
    ctx.save()
    ctx.translate(e.x, e.y)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath(); ctx.ellipse(0, e.boss ? 14 : 8, e.boss ? 20 : 9, e.boss ? 7 : 4, 0, 0, 7); ctx.fill()
    switch (e.type) {
      case 'rabbit':
        ctx.fillStyle = '#d8d2c8'
        ctx.beginPath(); ctx.ellipse(0, 0, 7 + bob * 0.4, 5.5, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#e8e3db'
        ctx.beginPath(); ctx.arc(dx > 0 ? 5 : -5, -2, 4, 0, 7); ctx.fill()
        ctx.fillRect(dx > 0 ? 3 : -6, -11, 2, 8)
        ctx.fillRect(dx > 0 ? 6 : -3, -12, 2, 9)
        ctx.fillStyle = '#c98a8a'
        ctx.arc(dx > 0 ? 8 : -8, -1, 1.5, 0, 7); ctx.fill()
        break
      case 'deer':
        ctx.fillStyle = '#a3713f'
        ctx.beginPath(); ctx.ellipse(0, 0, 11, 7, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#b57e45'
        ctx.beginPath(); ctx.arc(dx > 0 ? 10 : -10, -6, 5, 0, 7); ctx.fill()
        ctx.strokeStyle = '#7a5226'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(dx > 0 ? 11 : -11, -12); ctx.lineTo(dx > 0 ? 14 : -14, -18)
        ctx.stroke()
        this.drawEntityEyes(ctx, dx, dy)
        break
      case 'boar':
        ctx.fillStyle = '#6d6a63'
        ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#7d7a72'
        ctx.beginPath(); ctx.arc(dx > 0 ? 10 : -10, -3, 6, 0, 7); ctx.fill()
        ctx.strokeStyle = '#e8e4d4'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(dx > 0 ? 13 : -13, -6); ctx.lineTo(dx > 0 ? 17 : -17, -10)
        ctx.stroke()
        this.drawEntityEyes(ctx, dx, dy, '#2a0000')
        break
      case 'wolf':
        ctx.fillStyle = '#4c4c52'
        ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#5c5c62'
        ctx.beginPath(); ctx.arc(dx > 0 ? 11 : -11, -4, 6, 0, 7); ctx.fill()
        ctx.fillRect(dx > 0 ? 7 : -11, -12, 3, 7)
        ctx.fillRect(dx > 0 ? 12 : -6, -12, 3, 7)
        this.drawEntityEyes(ctx, dx, dy, '#c0392b')
        break
      case 'zombie': {
        const z = Math.sin(this.deco.t * 6) * 1.6
        ctx.fillStyle = '#5a7a4a'
        ctx.beginPath(); ctx.arc(0, -6 + z, 7, 0, 7); ctx.fill()
        ctx.fillRect(-6, 0, 12, 9)
        ctx.fillStyle = '#3c5330'
        ctx.fillRect(-9, -4, 4, 11)
        ctx.fillRect(6, -4, 4, 11)
        ctx.fillStyle = '#c0392b'
        ctx.fillRect(-4, -8 + z, 3, 2)
        ctx.fillRect(2, -8 + z, 3, 2)
        break
      }
      case 'slime': {
        const j = 1 + Math.abs(Math.sin(this.deco.t * 5 + e.x)) * 0.25
        ctx.fillStyle = 'rgba(110,200,110,0.8)'
        ctx.beginPath(); ctx.ellipse(0, 2, 9 * j, 7 / j, 0, 0, 7); ctx.fill()
        ctx.fillStyle = 'rgba(70,150,70,0.5)'
        ctx.beginPath(); ctx.ellipse(-3, -1, 3, 2, 0, 0, 7); ctx.fill()
        this.drawEntityEyes(ctx, dx, dy)
        break
      }
      case 'bat': {
        const f = Math.sin(this.deco.t * 14) * 5
        ctx.fillStyle = '#3d2f4f'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(-8, -8 - f, -14, -2 - f * 0.5)
        ctx.quadraticCurveTo(-7, 0, 0, 2)
        ctx.quadraticCurveTo(7, 0, 14, -2 - f * 0.5)
        ctx.quadraticCurveTo(8, -8 - f, 0, 0)
        ctx.fill()
        ctx.fillStyle = '#c0392b'
        ctx.fillRect(-3, -3, 2, 2)
        ctx.fillRect(2, -3, 2, 2)
        break
      }
      case 'skeleton': {
        const z = Math.sin(this.deco.t * 6) * 1.2
        ctx.fillStyle = '#e4e0d0'
        ctx.beginPath(); ctx.arc(0, -7 + z, 6.5, 0, 7); ctx.fill()
        ctx.fillStyle = '#c9c5b5'
        ctx.fillRect(-5, -2, 10, 10)
        ctx.fillRect(-3, -15 + z, 6, 3)
        ctx.fillStyle = '#1c1c1c'
        ctx.fillRect(-3.5, -8 + z, 2.5, 2.5)
        ctx.fillRect(1, -8 + z, 2.5, 2.5)
        break
      }
      case 'golem': {
        const br = 0.75 + Math.sin(this.deco.t * 3) * 0.25
        ctx.fillStyle = '#4f5257'
        ctx.fillRect(-18, -22, 36, 34)
        ctx.fillStyle = '#5f6259'
        ctx.fillRect(-14, -18, 28, 10)
        ctx.fillStyle = '#ff7a3c'
        ctx.globalAlpha = br
        ctx.fillRect(-9, -13, 6, 5)
        ctx.fillRect(4, -13, 6, 5)
        ctx.globalAlpha = 1
        ctx.fillStyle = '#3f4247'
        ctx.fillRect(-26, -6, 9, 20)
        ctx.fillRect(17, -6, 9, 20)
        break
      }
      default:
        ctx.fillStyle = '#a33'
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill()
    }
    ctx.restore()
    state.hpBars.push({ x: e.x, y: e.y - (e.boss ? 36 : 20), hp: e.hp, max: e.max, boss: e.boss })
  }

  drawOtherPlayer(ctx, q, state) {
    if (q.dead) return
    const bob = Math.sin(this.deco.t * 9 + q.x) * 1.1
    ctx.save()
    ctx.translate(q.x, q.y)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath(); ctx.ellipse(0, 7, 8, 3.5, 0, 0, 7); ctx.fill()
    ctx.fillStyle = `hsl(${q.hue ?? 210} 65% 55%)`
    ctx.beginPath(); ctx.arc(0, -4 + bob * 0.3, 6.5, 0, 7); ctx.fill()
    ctx.fillStyle = `hsl(${q.hue ?? 210} 60% 38%)`
    ctx.beginPath(); ctx.arc(0, 3, 7.5, 0, Math.PI, true); ctx.fill()
    ctx.fillStyle = '#f2d9a0'
    ctx.beginPath(); ctx.arc(0, -5 + bob * 0.3, 5.2, 0, 7); ctx.fill()
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(q.dir > 0 ? 1 : -4, -6 + bob * 0.3, 2.5, 2)
    ctx.fillRect(q.dir > 0 ? 1 : -4, -2.6 + bob * 0.3, 2.5, 2)
    ctx.restore()
    // name + hp bar
    ctx.save()
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(q.x - 26, q.y - 26, 52, 11)
    ctx.fillStyle = '#fff'
    ctx.fillText(q.name.slice(0, 12), q.x, q.y - 17.5)
    state.hpBars.push({ x: q.x, y: q.y - 29, hp: q.hp, max: q.maxHp, skip: true })
    ctx.restore()
  }

  drawSelf(ctx, a, state) {
    const p = a.self()
    if (!p || p.dead) return
    const bob = p._moving ? Math.sin(this.deco.t * 11) * 1.4 : 0
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(0, 8, 9, 4, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#2e86c8'
    ctx.beginPath(); ctx.arc(0, 3, 8, 0, Math.PI, true); ctx.fill()
    ctx.fillStyle = '#f2d9a0'
    ctx.beginPath(); ctx.arc(0, bob * 0.4, 6, 0, 7); ctx.fill()
    ctx.fillStyle = '#1b1b1b'
    const fx = Math.cos((p.dir ?? 0) > 0 ? 0 : Math.PI)
    ctx.fillRect(fx > 0 ? 1 : -4, -2.2 + bob * 0.4, 2.5, 2.2)
    ctx.fillStyle = `hsl(${p.hue ?? 210} 70% 55%)`
    ctx.beginPath(); ctx.arc(0, -3.5 + bob * 0.4, 5.6, Math.PI, 0); ctx.fill()
    ctx.restore()
    // outline highlight
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.arc(p.x, p.y + 3, 9.5, 0, 7); ctx.stroke()
    ctx.restore()
  }

  drawDrop(ctx, d) {
    const bob = Math.sin(this.deco.t * 5 + (d.id | 0)) * 1.6
    ctx.save()
    ctx.translate(d.x, d.y + bob)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = d.item.dur != null ? '#f5c542' : '#cfd6dc'
    ctx.fillRect(-4, -4, 8, 8)
    ctx.fillStyle = d_itemColor(d.item.id)
    ctx.fillRect(-2.6, -2.6, 5.2, 5.2)
    ctx.restore()
  }

  drawLighting(state, camX, camY) {
    const a = state.adapter
    const t = a.time.t
    let darkness = 0
    if (isNight(t)) {
      // fade in/out over ~8% of a day around the boundaries
      if (t > NIGHT_START) darkness = Math.min(1, (t - NIGHT_START) * 10)
      else darkness = Math.min(1, (NIGHT_END - t) * 10)
    }
    if (a.levelId() > 0) darkness = Math.max(0.62, darkness) // caves are always dark
    if (darkness <= 0.01) return
    const { ctx } = this
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    const g = ctx.createLinearGradient(0, 0, 0, this.vh)
    ctx.fillStyle = `rgba(8, 10, 34, ${darkness * 0.66})`
    ctx.fillRect(0, 0, this.vw, this.vh)
    // lights: campfires, furnace glow, player torch-free small radius
    ctx.globalCompositeOperation = 'lighter'
    const lights = []
    for (const o of a.objects()) {
      if (o.t === 'b:campfire' || o.t === 'b:furnace') lights.push([o.x * TILE + 16, o.y * TILE + 16, 120, 0.5])
    }
    for (const l of lights) {
      const sx = (l[0] - camX) * this.zoom, sy = (l[1] - camY) * this.zoom
      const r = l[2] * this.zoom
      const grad = ctx.createRadialGradient(sx, sy, 4, sx, sy, r)
      grad.addColorStop(0, `rgba(255,170,80,${0.5 * darkness})`)
      grad.addColorStop(1, 'rgba(255,170,80,0)')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill()
    }
    ctx.restore()
  }

  drawHpBars(ctx, bars) {
    for (const b of bars) {
      const w = b.boss ? 60 : 22
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(b.x - w / 2, b.y, w, 4)
      const f = Math.max(0, b.hp / b.max)
      ctx.fillStyle = b.skip ? '#62d26f' : '#e05252'
      ctx.fillRect(b.x - w / 2 + 0.6, b.y + 0.6, (w - 1.2) * f, 2.8)
    }
  }
}

function d_itemColor(id) {
  const map = {
    wood: '#a3713f', stone: '#9aa2a6', coal: '#3c4650', copper_ore: '#c47a3d', iron_ore: '#b8c0c8',
    gold_ore: '#e8c53d', gem: '#7ce0d3', fiber: '#8fb548', leather: '#a3713f', bone: '#e8e4d4',
    meat_raw: '#d96a6a', meat_cooked: '#c98a4b', berries: '#c0392b', arrow: '#cfc06a',
    axe_wood: '#a8763e', pick_wood: '#a8763e', sword_wood: '#a8763e', copper_bar: '#c47a3d', iron_bar: '#cdd6de', gold_bar: '#e8c53d',
    ancient_core: '#bf5bff',
  }
  return map[id] || '#8fb548'
}
