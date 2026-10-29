// SURVIVOR SMP - crafting & smelting recipes
// where: 'any' | 'workbench' | 'furnace' | 'campfire' | 'anvil'
import { ITEMS } from './items.js'

// Buildings (chest, workbench, furnace, campfire, hammer_anvil, walls...) are
// placed directly in BUILD MODE consuming raw resources from BUILD_FORGE.
export const RECIPES = [
  { id: 'r_hammer', where: 'workbench', out: [{ id: 'hammer', qty: 1 }], in: { wood: 4, stone: 3 }, desc: 'Cần búa để phá dỡ công trình thu hồi vật liệu' },
  { id: 'r_axe_wood', where: 'workbench', out: [{ id: 'axe_wood', qty: 1 }], in: { wood: 6 } },
  { id: 'r_pick_wood', where: 'workbench', out: [{ id: 'pick_wood', qty: 1 }], in: { wood: 6 } },
  { id: 'r_sword_wood', where: 'workbench', out: [{ id: 'sword_wood', qty: 1 }], in: { wood: 7 } },
  { id: 'r_axe_stone', where: 'workbench', out: [{ id: 'axe_stone', qty: 1 }], in: { wood: 4, stone: 6 } },
  { id: 'r_pick_stone', where: 'workbench', out: [{ id: 'pick_stone', qty: 1 }], in: { wood: 4, stone: 6 } },
  { id: 'r_sword_stone', where: 'workbench', out: [{ id: 'sword_stone', qty: 1 }], in: { wood: 3, stone: 7 } },
  { id: 'r_copper_bar', where: 'furnace', out: [{ id: 'copper_bar', qty: 1 }], in: { copper_ore: 2, coal: 1 } },
  { id: 'r_iron_bar', where: 'furnace', out: [{ id: 'iron_bar', qty: 1 }], in: { iron_ore: 3, coal: 2 } },
  { id: 'r_gold_bar', where: 'furnace', out: [{ id: 'gold_bar', qty: 1 }], in: { gold_ore: 3, coal: 2 } },
  { id: 'r_sword_copper', where: 'workbench', out: [{ id: 'sword_copper', qty: 1 }], in: { copper_bar: 3, wood: 2 } },
  { id: 'r_sword_iron', where: 'workbench', out: [{ id: 'sword_iron', qty: 1 }], in: { iron_bar: 3, wood: 2 } },
  { id: 'r_spear_iron', where: 'workbench', out: [{ id: 'spear_iron', qty: 1 }], in: { iron_bar: 2, wood: 5 } },
  { id: 'r_bow', where: 'workbench', out: [{ id: 'bow', qty: 1 }], in: { wood: 6, fiber: 5, leather: 2 } },
  { id: 'r_arrow', where: 'workbench', out: [{ id: 'arrow', qty: 10 }], in: { wood: 2, stone: 1 } },
  { id: 'r_axe_iron', where: 'workbench', out: [{ id: 'axe_iron', qty: 1 }], in: { iron_bar: 3, wood: 3 } },
  { id: 'r_pick_iron', where: 'workbench', out: [{ id: 'pick_iron', qty: 1 }], in: { iron_bar: 3, wood: 3 } },
  { id: 'r_meat_cooked', where: 'campfire', out: [{ id: 'meat_cooked', qty: 1 }], in: { meat_raw: 1 } },
  { id: 'r_armor_cloth', where: 'workbench', out: [{ id: 'armor_cloth', qty: 1 }], in: { fiber: 6 } },
  { id: 'r_armor_leather', where: 'workbench', out: [{ id: 'armor_leather', qty: 1 }], in: { leather: 6, fiber: 3 } },
  { id: 'r_armor_wood', where: 'workbench', out: [{ id: 'armor_wood', qty: 1 }], in: { wood: 12, fiber: 4 } },
  { id: 'r_armor_copper', where: 'workbench', out: [{ id: 'armor_copper', qty: 1 }], in: { copper_bar: 4, leather: 2 } },
  { id: 'r_armor_iron', where: 'workbench', out: [{ id: 'armor_iron', qty: 1 }], in: { iron_bar: 5, leather: 2, wood: 2 } },
  { id: 'r_armor_gold', where: 'workbench', out: [{ id: 'armor_gold', qty: 1 }], in: { gold_bar: 3, iron_bar: 2 } },
  { id: 'r_armor_ancient', where: 'workbench', out: [{ id: 'armor_ancient', qty: 1 }], in: { ancient_core: 1, iron_bar: 4, gem: 2 }, rare: true },
]

// builds crafted directly from resources without needing the item in hand
export const BUILD_FORGE = {
  floor_wood: { in: { wood: 2 } }, wall_wood: { in: { wood: 4 } }, wall_stone: { in: { stone: 6 } },
  fence: { in: { wood: 3 } }, door: { in: { wood: 5 } }, roof: { in: { wood: 3, fiber: 2 } },
}

export function recipeAvailable(rec, nearStation, hasStationType) {
  if (rec.hidden) return false
  const w = rec.where
  if (w === 'any') return true
  return !!hasStationType(w)
}

export function canAfford(inv, cost) {
  for (const k in cost) {
    let have = 0
    for (const s of inv) if (s && s.id === k) have += s.qty
    if (have < cost[k]) return false
  }
  return true
}

export function def(id) { return ITEMS[id] }
