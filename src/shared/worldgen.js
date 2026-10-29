// SURVIVOR SMP - deterministic world generation (no deps, shared client+server)
import { WORLD_W, WORLD_H, CAVE_W, CAVE_H, CAVE_LEVELS, CAVE_ENTRANCES, BIOME } from './constants.js'

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
function hash2(seed, x, y) {
  let h = seed ^ (x * 374761393) ^ (y * 668265263)
  h = Math.imul(h ^ h >>> 13, 1274126177)
  return ((h ^ h >>> 16) >>> 0) / 4294967296
}
function smooth(t) { return t * t * (3 - 2 * t) }
function valueNoise(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi)
  const c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1)
  const u = smooth(xf), v = smooth(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
export function fbm(seed, x, y, oct = 4, scale = 0.05) {
  let amp = 1, f = scale, sum = 0, norm = 0
  for (let i = 0; i < oct; i++) { sum += valueNoise(seed + i * 101, x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2 }
  return sum / norm
}

const ORE_BY_BIOME = ['copper', 'iron', 'coal', 'gold', 'gem']

export function generateWorld(seed) {
  const rng = mulberry32(seed)
  // ---- surface ----
  const W = WORLD_W, H = WORLD_H
  const tiles = new Uint8Array(W * H)
  const objects = []
  const addObject = (t, x, y, extra = {}) => {
    const maxHp = extra.maxHp != null ? extra.maxHp : RESOURCE_HP[t]
    const o = { i: `0:${t}:${x}:${y}`, t, x, y, max: maxHp, hp: maxHp, alive: true, ...extra }
    objects.push(o)
    return o
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = fbm(seed, x, y, 4, 0.028)
    const m = fbm(seed + 9999, x, y, 3, 0.05)
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
    let b
    if (edge < 3) b = BIOME.DEEP_WATER
    else if (e < 0.33) b = edge < 8 ? BIOME.WATER : BIOME.DEEP_WATER
    else if (e < 0.37) b = BIOME.SAND
    else if (e > 0.70) b = BIOME.ROCK
    else if (m > 0.60) b = BIOME.FOREST
    else if (m > 0.42) b = BIOME.MEADOW
    else b = BIOME.GRASS
    tiles[y * W + x] = b
  }
  const oreTypeAt = (x, y, tile) => {
    const r = hash2(seed ^ 777, x, y)
    if (tile === BIOME.ROCK) {
      if (r < 0.020 && e(x, y) > 0.79) return 'gem'
      if (r < 0.055) return 'copper'
      if (r < 0.085) return 'iron'
      if (r < 0.135 && e(x, y) > 0.75) return 'gold'
      if (r < 0.20) return 'coal'
      return null
    }
    return null
  }
  const e = (x, y) => fbm(seed, x, y, 4, 0.028)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = tiles[y * W + x]
    if (b === BIOME.ROCK) {
      if (hash2(seed ^ 111, x, y) < 0.42) addObject('rock', x, y)
      const ot = oreTypeAt(x, y, b)
      if (ot) addObject('ore_' + ot, x, y)
    } else if (b === BIOME.FOREST) {
      if (hash2(seed ^ 222, x, y) < 0.24) addObject('tree', x, y)
      else if (hash2(seed ^ 333, x, y) < 0.05) addObject('bush', x, y)
    } else if (b === BIOME.GRASS || b === BIOME.MEADOW) {
      if (hash2(seed ^ 222, x, y) < 0.035) addObject('tree', x, y)
      else if (hash2(seed ^ 333, x, y) < 0.045) addObject('bush', x, y)
      else if (b === BIOME.MEADOW && hash2(seed ^ 444, x, y) < 0.055) addObject('grass_tuft', x, y)
    }
  }
  // cave entrances: pick 8 walkable land spots spread across quadrants
  const entrances = []
  const cand = []
  for (let y = 8; y < H - 8; y += 5) for (let x = 8; x < W - 8; x += 5) {
    const b = tiles[y * W + x]
    if (b === BIOME.GRASS || b === BIOME.MEADOW || b === BIOME.ROCK || b === BIOME.SAND) cand.push([x, y])
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = cand[i]; cand[i] = cand[j]; cand[j] = t }
  const quads = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]
  let qi = 0
  for (const [qx, qy] of quads) {
    let placed = 0
    for (const [x, y] of cand) {
      if (Math.floor((x / W) / 0.5) === qx && Math.floor((y / H) / 0.5) === qy && entrances.every(p => Math.abs(p.x - x) > 30 || Math.abs(p.y - y) > 30)) {
        addObject('cave_entrance', x, y, { entranceId: entrances.length })
        entrances.push({ id: entrances.length, x, y })
        if (++placed >= 2) break
      }
    }
  }
  const caves = []
  for (let L = 0; L < CAVE_LEVELS; L++) caves.push(genCave(seed ^ (1000 + L * 77), L, entrances))
  // world spawn: walkable tile nearest to centre
  let spawn = findFloorNear(tiles, W, H, W >> 1, H >> 1, b => b === BIOME.GRASS || b === BIOME.MEADOW || b === BIOME.SAND)
  return { seed, surface: { w: W, h: H, tiles, objects, entrances }, caves, spawn }
}

export const RESOURCE_HP = {
  tree: 26, rock: 30, bush: 10, grass_tuft: 4,
  ore_copper: 45, ore_iron: 60, ore_coal: 35, ore_gold: 80, ore_gem: 110,
  chest: 40, cave_entrance: 1e9, cave_exit: 1e9,
}
export const ORE_TIER = { ore_coal: 1, ore_copper: 2, ore_iron: 3, ore_gold: 3, ore_gem: 3 }
export const ORE_DROPS = {
  ore_copper: { copper_ore: [2, 4] }, ore_iron: { iron_ore: [2, 4] },
  ore_coal: { coal: [2, 4] }, ore_gold: { gold_ore: [2, 3], gem: [0, 1] },
  ore_gem: { gem: [1, 3] },
}

function genCave(seed, level, entrances) {
  const W = CAVE_W, H = CAVE_H
  const rng = mulberry32(seed)
  let t = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) t[i] = rng() < 0.44 ? 1 : 0
  for (let gen = 0; gen < 5; gen++) {
    const nt = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        n += (nx < 0 || ny < 0 || nx >= W || ny >= H || t[ny * W + nx]) ? 1 : 0
      }
      nt[y * W + x] = n > 4 ? 1 : n < 3 ? 0 : t[y * W + x]
    }
    t = nt
    // border always wall
    for (let x = 0; x < W; x++) { t[x] = 1; t[(H - 1) * W + x] = 1 }
    for (let y = 0; y < H; y++) { t[y * W] = 1; t[y * W + W - 1] = 1 }
  }
  // spawn points per entrance + flood fill boundary
  const floor = (x, y) => !t[y * W + x]
  const spawns = entrances.map((en, i) => {
    const sx = Math.round(6 + (i % 4) * 26 + (i % 2) * 6), sy = Math.round(12 + Math.floor(i / 4) * 30)
    return findFloorNear(t, W, H, sx, sy, floor)
  })
  // carve spawn areas open so exits usable
  for (const [sx, sy] of spawns) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = sx + dx, ny = sy + dy
    if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) t[ny * W + nx] = 0
  }
  // connectivity flood fill from spawns, fill isolated pockets
  const reach = new Uint8Array(W * H)
  const q = spawns.map(([x, y]) => y * W + x)
  for (const c of q) reach[c] = 1
  while (q.length) {
    const c = q.pop(), x = c % W, y = (c / W) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const n = ny * W + nx
      if (!t[n] && !reach[n]) { reach[n] = 1; q.push(n) }
    }
  }
  for (let i = 0; i < W * H; i++) if (!t[i] && !reach[i]) t[i] = 1
  const tiles = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) tiles[i] = t[i] ? BIOME.CAVE_WALL : BIOME.CAVE_FLOOR
  const objects = []
  const addObject = (ty, x, y, extra = {}) => {
    const o = { i: `${level + 1}:${ty}:${x}:${y}`, t: ty, x, y, max: extra.maxHp || 1, hp: extra.maxHp || 1, alive: true, ...extra }
    objects.push(o)
    return o
  }
  for (const [i, [sx, sy]] of spawns.entries()) addObject('cave_exit', sx, sy, { entranceId: i })
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (tiles[y * W + x] !== BIOME.CAVE_FLOOR) continue
    const nearWall = !floor(x + 1, y) || !floor(x - 1, y) || !floor(x, y + 1) || !floor(x, y - 1)
    if (!nearWall) continue
    const r = hash2(seed ^ 321, x, y)
    if (r < 0.130) addObject('rock', x, y, { max: 30, hp: 30 })
    else if (r < 0.270) addObject('ore_coal', x, y, { max: 35, hp: 35 })
    else if (r < 0.400) addObject('ore_copper', x, y, { max: 45, hp: 45 })
    else if (level >= 1 && r < 0.520) addObject('ore_iron', x, y, { max: 60, hp: 60 })
    else if (level >= 1 && r < 0.600) addObject('ore_gold', x, y, { max: 80, hp: 80 })
    else if (level >= 2 && r < 0.660) addObject('ore_gem', x, y, { max: 110, hp: 110 })
  }
  // treasure chests (static container objects)
  const chestCount = 2 + level * 2
  let placedChests = 0, guard = 0
  while (placedChests < chestCount && guard++ < 4000) {
    const x = 3 + ((rng() * (W - 6)) | 0), y = 3 + ((rng() * (H - 6)) | 0)
    if (floor(x, y) && !objects.some(o => o.x === x && o.y === y) && spawns.every(([sx, sy]) => Math.abs(sx - x) > 12 || Math.abs(sy - y) > 12)) {
      addObject('chest', x, y, { max: 60, hp: 60, container: { items: lootToSlots(randomLoot(rng, level)) }, loot: true })
      placedChests++
    }
  }
  // descender shaft to the next level (not on the deepest level)
  if (level < 2) {
    let best = null, bestD = -1
    for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < W - 3; x += 2) {
      if (!floor(x, y)) continue
      let d = 1e9
      for (const [sx, sy] of spawns) d = Math.min(d, (sx - x) ** 2 + (sy - y) ** 2)
      if (d > bestD && d < 1e8) { bestD = d; best = [x, y] }
    }
    if (best) addObject('cave_down', best[0], best[1])
  }
  // boss anchor for level 3
  let bossPos = null
  if (level === CAVE_LEVELS - 1) {
    let best = -1
    for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < W - 3; x += 2) {
      if (!floor(x, y)) continue
      let d = 1e9
      for (const [sx, sy] of spawns) d = Math.min(d, (sx - x) ** 2 + (sy - y) ** 2)
      if (d > best && d < 1e8) { best = d; bossPos = [x, y] }
    }
  }
  return { w: W, h: H, tiles, objects, spawns, bossPos }
}

function lootToSlots(dict) {
  const items = []
  for (const [id, qty] of Object.entries(dict || {})) items.push({ id, qty, dur: null })
  return items.slice(0, 18)
}

function randomLoot(rng, level) {
  const pool = [['coal', 4, 9], ['iron_ore', 3, 7], ['copper_ore', 4, 8], ['arrow', 8, 20], ['leather', 1, 3], ['fiber', 2, 5], ['berries', 2, 5], ['stone', 4, 10], ['meat_raw', 1, 3]]
  if (level >= 1) pool.push(['gold_ore', 2, 4], ['iron_bar', 1, 2])
  const items = {}
  const n = 2 + ((rng() * 3) | 0)
  for (let i = 0; i < n; i++) {
    const [id, lo, hi] = pool[(rng() * pool.length) | 0]
    items[id] = (items[id] || 0) + lo + ((rng() * (hi - lo + 1)) | 0)
  }
  if (level >= 2 && rng() < 0.35) { items.gem = (items.gem || 0) + 1 + ((rng() * 2) | 0) }
  return items
}

export function findFloorNear(tiles, W, H, cx, cy, okFn) {
  let best = [cx, cy], bestD = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!okFn(tiles[y * W + x])) continue
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy)
    if (bestD < 0 || d < bestD) { bestD = d; best = [x, y] }
  }
  return best
}
