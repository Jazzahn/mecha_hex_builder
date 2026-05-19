import { UNIT_TYPES, ALL_UPGRADES, ARMORED_UNIT_IDS, MECHA_UNIT_IDS, getSlotCost } from '../data/gameData';

const VEHICLE_IDS = ['groundVehicle', 'heavyVehicle'];

// Weapons grouped by slot cost, roughly ordered by effectiveness within each tier
const WEAPONS_BY_COST = {
  3: ['largePulseLaser', 'ultraAC10', 'lb10xAC', 'autocannon20', 'largeLaser', 'lrm20', 'ppc', 'gaussRifle', 'arrowIVArtillery'],
  2: ['mediumPulseLaser', 'ultraAC5', 'lb5xAC', 'autocannon10', 'mediumLaser', 'lrm10', 'erMediumLaser'],
  1: ['smallPulseLaser', 'streakSRMRack', 'machineGunArray', 'ultraAC2', 'lb2xAC', 'smallLaser', 'autocannon2', 'lrm5', 'erSmallLaser'],
};

const UNIT_POOL = [
  { typeId: 'assault',       pts: 100 },
  { typeId: 'heavy',         pts: 80  },
  { typeId: 'medium',        pts: 60  },
  { typeId: 'light',         pts: 40  },
  { typeId: 'heavyVehicle',  pts: 25  },
  { typeId: 'groundVehicle', pts: 15  },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _nextId = 5000;

function makeBlankUnit(typeId) {
  const unitType = UNIT_TYPES[typeId];
  const slots = unitType.isMecha
    ? { torso: [], larm: [], rarm: [] }
    : { single: [] };
  return { id: _nextId++, typeId, name: unitType.name, slots, heroId: null, titleId: null, aceCustomSlot: null };
}

function pickWeapon(cost, usedCounts, isVehicle) {
  for (const id of shuffle(WEAPONS_BY_COST[cost] ?? [])) {
    const upgrade = ALL_UPGRADES[id];
    if (!upgrade) continue;
    if (isVehicle && upgrade.mechaOnly) continue;
    if ((usedCounts[id] ?? 0) >= 2) continue;
    return id;
  }
  return null;
}

function fillLocation(slots, loc, maxSlots, usedCounts, isVehicle) {
  let remaining = maxSlots;
  for (const cost of [3, 2, 1]) {
    while (remaining >= cost) {
      const id = pickWeapon(cost, usedCounts, isVehicle);
      if (!id) break;
      slots[loc].push(id);
      usedCounts[id] = (usedCounts[id] ?? 0) + 1;
      remaining -= cost;
    }
  }
}

function fillSlots(unit) {
  const unitType = UNIT_TYPES[unit.typeId];
  const usedCounts = {};

  if (!unitType.isMecha) {
    const isArmored = ARMORED_UNIT_IDS.includes(unit.typeId);
    let remaining = unitType.totalSlots;
    if (isArmored) {
      unit.slots.single.push('extraArmor');
      remaining -= getSlotCost('extraArmor', unit.typeId);
    }
    fillLocation(unit.slots, 'single', remaining, usedCounts, true);
    return;
  }

  for (const loc of ['torso', 'larm', 'rarm']) {
    fillLocation(unit.slots, loc, unitType.slots[loc] ?? 0, usedCounts, false);
  }
}

export function generateBotArmy(pointLimit) {
  const units = [];
  let budget = pointLimit;

  while (budget >= 15) {
    const mechaCount   = units.filter(u => MECHA_UNIT_IDS.includes(u.typeId)).length;
    const vehicleCount = units.filter(u => VEHICLE_IDS.includes(u.typeId)).length;
    const gvCount      = units.filter(u => u.typeId === 'groundVehicle').length;
    const maxGVs       = Math.floor(pointLimit / 50);

    const canAddVehicle = vehicleCount < mechaCount;
    const canAddGV      = gvCount < maxGVs;

    const candidates = UNIT_POOL.filter(u => {
      if (u.pts > budget) return false;
      if (VEHICLE_IDS.includes(u.typeId) && !canAddVehicle) return false;
      if (u.typeId === 'groundVehicle' && !canAddGV) return false;
      return true;
    });

    if (!candidates.length) break;

    // Weight by pts so heavier units are proportionally more likely to be chosen
    const totalWeight = candidates.reduce((s, c) => s + c.pts, 0);
    let rand = Math.random() * totalWeight;
    let picked = candidates[candidates.length - 1];
    for (const c of candidates) {
      rand -= c.pts;
      if (rand <= 0) { picked = c; break; }
    }

    const unit = makeBlankUnit(picked.typeId);
    fillSlots(unit);
    units.push(unit);
    budget -= picked.pts;
  }

  return { armyName: 'Bot Army', pointLimit, units };
}
