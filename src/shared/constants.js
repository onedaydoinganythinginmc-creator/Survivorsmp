// SURVIVOR SMP - shared constants (used by client and server)
export const TILE = 32
export const WORLD_W = 176
export const WORLD_H = 176
export const CAVE_W = 112
export const CAVE_H = 112
export const CAVE_LEVELS = 3
export const CAVE_ENTRANCES = 8

export const DAY_LENGTH = 540 // seconds per full day/night cycle
export const NIGHT_START = 0.72
export const NIGHT_END = 0.12

export const DROP_LIFETIME = 300 // seconds on ground
export function isNight(t) { return t > NIGHT_START || t < NIGHT_END }
export const OBJECT_RESPAWN = { tree: 480, rock: 600, bush: 420, ore: 900 }
export const BOSS_RESPAWN = 900

export const PLAYER_BASE = {
  hp: 100, hunger: 100, stamina: 100,
  speed: 112, sprintMult: 1.45,
  expBase: 40, expGrowth: 1.22,
}

export const VIEW_RADIUS = 820 // snapshot/viewport radius in world units
export const SNAPSHOT_HZ = 8
export const SAVE_INTERVAL = 8

export const BIOME = { DEEP_WATER: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4, FOREST: 5, ROCK: 6, CAVE_FLOOR: 7, CAVE_WALL: 8 }

export const TERRAIN_SOLID = new Set([BIOME.DEEP_WATER, BIOME.WATER, BIOME.CAVE_WALL])

export const ENTITY_TYPES = {
  rabbit: { hp: 20, speed: 130, flee: 260, atk: 0, exp: 3, drops: [['meat_raw', 1, 2]] },
  deer: { hp: 55, speed: 120, flee: 250, atk: 0, exp: 7, drops: [['meat_raw', 2, 3], ['leather', 1, 2], ['bone', 0, 2]] },
  boar: { hp: 70, speed: 84, flee: 90, atk: 12, exp: 10, drops: [['meat_raw', 2, 4], ['leather', 1, 2]] },
  wolf: { hp: 48, speed: 140, flee: 130, atk: 14, exp: 13, drops: [['meat_raw', 1, 2], ['leather', 2, 3]] },
  zombie: { hp: 60, speed: 66, flee: 0, atk: 13, exp: 9, drops: [['bone', 0, 2], ['fiber', 0, 1]] },
  slime: { hp: 34, speed: 52, flee: 0, atk: 8, exp: 6, drops: [['fiber', 1, 2]] },
  bat: { hp: 26, speed: 118, flee: 0, atk: 7, exp: 5, drops: [['bone', 0, 1]] },
  skeleton: { hp: 90, speed: 74, flee: 0, atk: 18, exp: 16, drops: [['bone', 1, 3], ['coal', 0, 2]] },
  golem: { hp: 650, speed: 58, flee: 0, atk: 30, exp: 150, drops: [['ancient_core', 1, 1], ['gold_ore', 2, 4], ['gem', 0, 2]], boss: true },
}

export const MONSTER_SPAWN_AREA = { min: 380, max: 760 }
export const NIGHT_SPAWN_CAP_PER_PLAYER = 4
export const CAVE_SPAWN_CAP_PER_PLAYER = 3

export const BUILDS = {
  floor_wood: { name: 'Sàn gỗ', cat: 'floor', solid: false, hp: 60, cost: { wood: 2 }, mat: 'wood' },
  wall_wood: { name: 'Tường gỗ', cat: 'wall', solid: true, hp: 150, cost: { wood: 4 }, mat: 'wood' },
  wall_stone: { name: 'Tường đá', cat: 'wall', solid: true, hp: 400, cost: { stone: 6 }, mat: 'stone' },
  fence: { name: 'Hàng rào', cat: 'wall', solid: true, hp: 90, cost: { wood: 3 }, mat: 'wood' },
  door: { name: 'Cửa gỗ', cat: 'door', solid: false, hp: 130, cost: { wood: 5 }, mat: 'wood' },
  roof: { name: 'Mái gỗ', cat: 'roof', solid: false, hp: 90, cost: { wood: 3, fiber: 2 }, mat: 'wood' },
  chest: { name: 'Rương', cat: 'station', solid: true, hp: 110, cost: { wood: 8, stone: 2 }, slots: 18 },
  workbench: { name: 'Bàn chế tạo', cat: 'station', solid: true, hp: 120, cost: { wood: 8, fiber: 2 }, slots: 0 },
  furnace: { name: 'Lò nung', cat: 'station', solid: true, hp: 160, cost: { stone: 10, coal: 2, wood: 2 }, slots: 0 },
  campfire: { name: 'Lửa trại', cat: 'station', solid: false, hp: 60, cost: { wood: 5, stone: 3 }, slots: 0 },
  hammer_anvil: { name: 'Đe sửa chữa', cat: 'station', solid: true, hp: 140, cost: { iron_bar: 2, stone: 6 }, slots: 0 },
}
