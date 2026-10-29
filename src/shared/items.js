// SURVIVOR SMP - item definitions
// kind: tool(axe|pick), weapon(sword|spear|bow), armor, food, resource, special
export const ITEMS = {
  // resources
  wood: { name: 'Gỗ', stack: 99, color: '#9c6b3a' },
  stone: { name: 'Đá', stack: 99, color: '#9aa2a6' },
  coal: { name: 'Than', stack: 99, color: '#3c4650' },
  copper_ore: { name: 'Quặng đồng', stack: 99, color: '#c47a3d' },
  iron_ore: { name: 'Quặng sắt', stack: 99, color: '#b8c0c8' },
  gold_ore: { name: 'Quặng vàng', stack: 99, color: '#e8c53d' },
  gem: { name: 'Ngọc hiếm', stack: 99, color: '#7ce0d3' },
  fiber: { name: 'Dây leo', stack: 99, color: '#8fb548' },
  leather: { name: 'Da', stack: 99, color: '#a3713f' },
  bone: { name: 'Xương', stack: 99, color: '#e8e4d4' },
  ancient_core: { name: 'Lõi cổ', stack: 5, color: '#bf5bff', rare: true },

  // food
  meat_raw: { name: 'Thịt sống', stack: 20, food: { hunger: 8, hp: 0 }, color: '#d96a6a' },
  meat_cooked: { name: 'Thịt nướng', stack: 20, food: { hunger: 38, hp: 18 }, color: '#c98a4b' },
  berries: { name: 'Quả mọng', stack: 20, food: { hunger: 14, hp: 3 }, color: '#c0392b' },

  // arrows
  arrow: { name: 'Mũi tên', stack: 60, color: '#cfc06a' },

  // tools: power = dmg to matching resource, tier = gate for ore hardness
  axe_wood: { name: 'Rìu gỗ', stack: 1, tool: { type: 'axe', power: 6, tier: 1 }, dur: 60, dmg: 6, range: 54, cd: 0.5, cost: 6, color: '#a8763e' },
  pick_wood: { name: 'Cuốc gỗ', stack: 1, tool: { type: 'pick', power: 5, tier: 1 }, dur: 60, dmg: 5, range: 54, cd: 0.5, cost: 6, color: '#a8763e' },
  axe_stone: { name: 'Rìu đá', stack: 1, tool: { type: 'axe', power: 11, tier: 2 }, dur: 160, dmg: 9, range: 54, cd: 0.5, cost: 12, color: '#8f9599' },
  pick_stone: { name: 'Cuốc đá', stack: 1, tool: { type: 'pick', power: 9, tier: 2 }, dur: 160, dmg: 9, range: 54, cd: 0.5, cost: 12, color: '#8f9599' },
  axe_iron: { name: 'Rìu sắt', stack: 1, tool: { type: 'axe', power: 18, tier: 3 }, dur: 320, dmg: 13, range: 56, cd: 0.45, cost: 20, color: '#cdd6de' },
  pick_iron: { name: 'Cuốc sắt', stack: 1, tool: { type: 'pick', power: 16, tier: 3 }, dur: 320, dmg: 13, range: 56, cd: 0.45, cost: 20, color: '#cdd6de' },

  // weapons
  sword_wood: { name: 'Kiếm gỗ', stack: 1, weapon: { atk: 9, range: 62, arc: 1.6, cd: 0.45, stam: 6 }, dur: 80, color: '#a8763e' },
  sword_stone: { name: 'Kiếm đá', stack: 1, weapon: { atk: 13, range: 64, arc: 1.6, cd: 0.45, stam: 6 }, dur: 170, color: '#8f9599' },
  sword_copper: { name: 'Kiếm đồng', stack: 1, weapon: { atk: 18, range: 66, arc: 1.6, cd: 0.45, stam: 6 }, dur: 250, color: '#c47a3d' },
  sword_iron: { name: 'Kiếm sắt', stack: 1, weapon: { atk: 26, range: 68, arc: 1.6, cd: 0.42, stam: 6 }, dur: 380, color: '#cdd6de' },
  spear_iron: { name: 'Giáo sắt', stack: 1, weapon: { atk: 22, range: 105, arc: 0.85, cd: 0.6, stam: 8 }, dur: 300, color: '#9fb3a1' },
  bow: { name: 'Cung', stack: 1, weapon: { atk: 17, range: 520, arc: 0, cd: 0.75, stam: 5, projectile: 'arrow' }, dur: 220, ammo: 'arrow', color: '#b5854f' },
  hammer: { name: 'Búa xây', stack: 1, tool: { type: 'hammer', power: 8, tier: 1 }, dur: 200, dmg: 8, range: 54, cd: 0.5, color: '#8f7f6a' },

  // armor: hp bonus via def multiplier + hp bonus points
  armor_cloth: { name: 'Giáp vải', stack: 1, armor: { def: 3, bonus: 8 }, dur: 180, color: '#d8cfc0' },
  armor_leather: { name: 'Giáp da', stack: 1, armor: { def: 7, bonus: 18 }, dur: 240, color: '#a3713f' },
  armor_wood: { name: 'Giáp gỗ', stack: 1, armor: { def: 11, bonus: 26 }, dur: 280, color: '#8a5a2b' },
  armor_copper: { name: 'Giáp đồng', stack: 1, armor: { def: 18, bonus: 36 }, dur: 340, color: '#c47a3d' },
  armor_iron: { name: 'Giáp sắt', stack: 1, armor: { def: 27, bonus: 52 }, dur: 460, color: '#cdd6de' },
  armor_gold: { name: 'Giáp vàng', stack: 1, armor: { def: 34, bonus: 64 }, dur: 500, color: '#e8c53d' },
  armor_ancient: { name: 'Giáp cổ', stack: 1, armor: { def: 50, bonus: 90, speed: 1.1 }, dur: 900, rare: true, color: '#bf5bff' },

  // bars for repair/upgrade
  copper_bar: { name: 'Thỏi đồng', stack: 99, color: '#c47a3d' },
  iron_bar: { name: 'Thỏi sắt', stack: 99, color: '#cdd6de' },
  gold_bar: { name: 'Thỏi vàng', stack: 99, color: '#e8c53d' },
}

export function itemDef(id) { return ITEMS[id] }

// repair cost of equipped hand/armor item: returns {id, qty} or null
export function repairCost(itemId) {
  const d = ITEMS[itemId]
  if (!d || (!d.dur)) return null
  if (d.color === '#a8763e') return { id: 'wood', qty: 2 }
  const table = { '#8f9599': { id: 'stone', qty: 3 }, '#c47a3d': { id: 'copper_bar', qty: 1 }, '#cdd6de': { id: 'iron_bar', qty: 1 }, '#e8c53d': { id: 'gold_bar', qty: 1 }, '#bf5bff': { id: 'gem', qty: 1 } }
  if (d.armor) {
    if (itemId === 'armor_cloth') return { id: 'fiber', qty: 4 }
    if (itemId === 'armor_leather') return { id: 'leather', qty: 3 }
  }
  if (itemId === 'armor_wood') return { id: 'wood', qty: 6 }
  return table[d.color] || { id: 'wood', qty: 2 }
}
