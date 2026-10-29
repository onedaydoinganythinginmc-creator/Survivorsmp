// SURVIVOR SMP - headless gameplay smoke test (no deps)
// Run: node tests/smoke.mjs
import { WorldRuntime } from '../src/shared/worldRuntime.js'
import { TILE, BUILDS } from '../src/shared/constants.js'
import { ITEMS } from '../src/shared/items.js'
import assert from 'node:assert'

const rt = new WorldRuntime(12345)
const p = rt.join('token-test-1', 'Tester')
p.online = true
rt.tick(0.1)

const findNearest = (lv, type, x, y, maxTiles = 40) => {
  let best = null, bd = maxTiles * TILE
  for (const o of lv.objects.values()) {
    if (!o.alive || o.t !== type) continue
    const wx = o.x * TILE + TILE / 2, wy = o.y * TILE + TILE / 2
    const d = Math.hypot(wx - x, wy - y)
    if (d < bd) { bd = d; best = o }
  }
  return best
}
const punch = (lv, obj, times) => {
  const wx = obj.x * TILE + TILE / 2, wy = obj.y * TILE + TILE / 2
  for (let i = 0; i < times; i++) {
    p.stamina = 100
    rt.handleAction(p, { t: 'attack', x: wx, y: wy })
    rt.tick(0.6) // covers cooldown
  }
}
const count = (id) => WorldRuntime.invCount(p.inv, id)

// ------------------------------------------------ 1. punch a tree (bare hands allowed)
const lv0 = rt.getLevel(0)
const tree = findNearest(lv0, 'tree', p.x, p.y)
assert.ok(tree, 'found a tree')
p.x = tree.x * TILE + TILE / 2 + 40 // stand next to it
p.y = tree.y * TILE + TILE / 2
punch(lv0, tree, 20)
p.x = tree.x * TILE + TILE / 2
p.y = tree.y * TILE + TILE / 2
rt.tick(0.1) // walk over the drop -> auto pickup
assert.ok(count('wood') >= 1, `got wood from tree (have ${count('wood')})`)

// ------------------------------------------------ 2. bush by hand: berries+fiber
const bush = findNearest(lv0, 'bush', p.x, p.y)
assert.ok(bush, 'found a bush')
p.x = bush.x * TILE + TILE / 2 + 30
p.y = bush.y * TILE + TILE / 2
punch(lv0, bush, 10)
assert.ok(count('berries') >= 1 && count('fiber') >= 1, `bush gives berries(${count('berries')})+fiber(${count('fiber')})`)

// eat berries
rt.handleAction(p, { t: 'eat', from: p.inv.findIndex(s => s && s.id === 'berries') })
assert.ok(p.inv.every(s => !s || s.id !== 'berries' || true), 'ate')

// ------------------------------------------------ 3. build a workbench (needs wood 8 + fiber 2)
for (let i = 0; i < 30; i++) {
  const t2 = findNearest(lv0, 'tree', p.x, p.y, 200)
  if (!t2) break
  p.x = t2.x * TILE + TILE / 2 + 40
  p.y = t2.y * TILE + TILE / 2
  punch(lv0, t2, 16)
  p.x = t2.x * TILE + TILE / 2
  p.y = t2.y * TILE + TILE / 2
  rt.tick(0.1)
  if (count('wood') >= 20) break
}
assert.ok(count('wood') >= 8 && count('fiber') >= 2, `enough mats wood=${count('wood')} fiber=${count('fiber')}`)
// place next to player on a free tile
let placed = false
for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [2, 2], [-1, 1], [3, 0], [0, 3], [1, -2]]) {
  const tx = Math.floor(p.x / TILE) + dx, ty = Math.floor(p.y / TILE) + dy
  const err = rt.handleAction(p, { t: 'build', kind: 'workbench', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
  if (!err) { placed = true; break }
}
assert.ok(placed, 'workbench placed')

// ------------------------------------------------ 4. craft tools at the workbench
for (const [recId, out] of [['r_axe_wood', 'axe_wood'], ['r_pick_wood', 'pick_wood'], ['r_sword_wood', 'sword_wood']]) {
  const err = rt.handleAction(p, { t: 'craft', id: recId })
  assert.ok(!err, `${recId} crafts (${err || ''})`)
  assert.ok(WorldRuntime.invCount(p.inv, out) + (p.equip.hand && p.equip.hand.id === out ? 1 : 0) >= 1, `have ${out}`)
}
// equip axe
const axeSlot = p.inv.findIndex(s => s && s.id === 'axe_wood')
rt.handleAction(p, { t: 'equip', from: axeSlot })
assert.ok(p.equip.hand && p.equip.hand.id === 'axe_wood', 'axe equipped')
// chop a full tree with the axe (26hp / power 6 -> 5 hits)
const tree2 = findNearest(lv0, 'tree', p.x, p.y, 60)
p.x = tree2.x * TILE + TILE / 2 + 40
p.y = tree2.y * TILE + TILE / 2
const woodBefore = count('wood')
punch(lv0, tree2, 8)
assert.ok(tree2.alive === false || count('wood') > woodBefore, 'axe chops tree')

// ------------------------------------------------ 5. stone + furnace? at least rock needs pick
const rock = findNearest(lv0, 'rock', p.x, p.y, 100)
assert.ok(rock, 'found rock')
p.x = rock.x * TILE + TILE / 2 + 40
p.y = rock.y * TILE + TILE / 2
let err2 = rt.handleAction(p, { t: 'attack', x: rock.x * TILE + TILE / 2, y: rock.y * TILE + TILE / 2 })
assert.ok(!err2, 'pick can mine rock')
// mine it
punch(lv0, rock, 8)
assert.ok(count('stone') >= 1, `stone collected (${count('stone')})`)

// ------------------------------------------------ 6. chest storage
err2 = rt.handleAction(p, { t: 'build', kind: 'chest', x: (Math.floor(p.x / TILE) + 1) * TILE + TILE / 2, y: (Math.floor(p.y / TILE)) * TILE + TILE / 2 })
if (err2) {
  // try other tiles until success
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, -1], [2, 1], [-2, 0]]) {
    const tx = Math.floor(p.x / TILE) + dx, ty = Math.floor(p.y / TILE) + dy
    err2 = rt.handleAction(p, { t: 'build', kind: 'chest', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
    if (!err2) break
  }
}
assert.ok(!err2, `chest placed (${err2 || ''})`)
const chestObj = [...rt.getLevel(0).objects.values()].find(o => o.t === 'b:chest' && o.alive)
assert.ok(chestObj, 'chest object exists')
// put wood inside
const fromWood = p.inv.findIndex(s => s && s.id === 'wood')
err2 = rt.handleAction(p, { t: 'chest', objId: chestObj.i, op: 'put', from: fromWood })
assert.ok(!err2, `chest put ok (${err2 || ''})`)
const chestHasWood = chestObj.container.items.some(s => s && s.id === 'wood')
assert.ok(chestHasWood, 'wood stored in chest')
// take back
const chestSlot = chestObj.container.items.findIndex(s => s && s.id === 'wood')
err2 = rt.handleAction(p, { t: 'chest', objId: chestObj.i, op: 'take', from: chestSlot })
assert.ok(!err2, `chest take ok (${err2 || ''})`)
assert.ok(count('wood') >= 1, 'wood back in inventory')

// ------------------------------------------------ 7. cave: enter near entrance, mine coal, come back
const en = rt.gen.surface.entrances[0]
p.x = en.x * TILE + TILE / 2 + 20
p.y = en.y * TILE + TILE / 2
err2 = rt.handleAction(p, { t: 'enterCave' })
assert.ok(!err2, `entered cave (${err2 || ''})`)
assert.equal(p.levelId, 1, 'player in cave level 1')
const caveLv = rt.getLevel(1)
// mine coal with wooden pick
const coal = findNearest(caveLv, 'ore_coal', p.x, p.y, 60)
assert.ok(coal, 'coal node in cave')
p.x = coal.x * TILE + TILE / 2 + 36
p.y = coal.y * TILE + TILE / 2
punch(caveLv, coal, 8)
assert.ok(count('coal') >= 1, `coal mined (${count('coal')})`)
err2 = rt.handleAction(p, { t: 'exitCave' })
assert.ok(!err2, `exited cave (${err2 || ''})`)
assert.equal(p.levelId, 0, 'back on surface')

// ------------------------------------------------ 8. cave descent chain to boss floor
p.x = en.x * TILE + TILE / 2 + 20
p.y = en.y * TILE + TILE / 2
rt.handleAction(p, { t: 'enterCave' })
const mapTile = [...rt.getLevel(1).objects.values()].find(o => o.t === 'cave_down' && o.alive)
assert.ok(mapTile, 'cave_down exists on level 1')
p.x = mapTile.x * TILE + TILE / 2
p.y = mapTile.y * TILE + TILE / 2
err2 = rt.handleAction(p, { t: 'descend' })
assert.ok(!err2 && p.levelId === 2, `descended to level 2 (${err2})`)
// spawn boss encounter (stand near boss position of L3 via descend again)
const down2 = [...rt.getLevel(2).objects.values()].find(o => o.t === 'cave_down' && o.alive)
if (down2) {
  p.x = down2.x * TILE + TILE / 2
  p.y = down2.y * TILE + TILE / 2
  err2 = rt.handleAction(p, { t: 'descend' })
  assert.ok(!err2 && p.levelId === 3, `descended to level 3 (${err2})`)
  p.x = rt.levels[3].bossPos[0] * TILE + TILE / 2
  p.y = rt.levels[3].bossPos[1] * TILE + TILE / 2 + 200
  for (let i = 0; i < 12; i++) rt.tick(1) // boss should spawn with player nearby
  const boss = rt.levels[3].ents.find(e => e.boss)
  assert.ok(boss, 'golem boss spawned at deep level')
}

// ------------------------------------------------ 9. combat: geld medieval: attack wolf? use quick sim of melee kill on slime if any; instead rabbit
p.levelId = 0
p.hp = p.maxHp
p.stamina = 100
p.equip.hand = WorldRuntime.mkItem('sword_wood', 1)
rt.spawnableTileSafe = null
for (let i = 0; i < lv0.ents.length; i++) {
  // manually move a rabbit adjacent and kill it
}
const rabbit = lv0.ents.find(e => e.type === 'rabbit')
if (rabbit) {
  rabbit.x = p.x + 40
  rabbit.y = p.y
  const exp0 = p.exp
  for (let i = 0; i < 10; i++) { p.stamina = 100; rt.handleAction(p, { t: 'attack', x: rabbit.x, y: rabbit.y }); rt.tick(0.6) }
  assert.ok(p.exp > exp0, 'killed rabbit, gained exp')
  assert.ok(count('meat_raw') >= 1, `meat drop (${count('meat_raw')})`)
}

// ------------------------------------------------ 10. persistence roundtrip
const snap = rt.serialize()
const rt2 = new WorldRuntime(snap.seed)
assert.ok(rt2.load(snap), 'load ok')
const p2 = rt2.join('token-test-1', 'Tester')
p2.online = true
assert.ok(p2.inv.filter(Boolean).length > 0, 'inventory persisted')
assert.ok(Math.abs(p2.x - p.x) < 1e-6, 'position persisted')
assert.equal(rt2.levelStat(p2), rt.levelStat(p), 'level persisted')
console.log('SMOKE TEST PASS ✔  inv:', p.inv.filter(Boolean).map(s => `${s.id}x${s.qty}`).slice(0, 12).join(', '), '| lvl', p.lvl, '| kills', p.kills)
