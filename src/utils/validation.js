import {
  MECHA_UNIT_IDS,
  ARMORED_UNIT_IDS,
  HEROES,
  TITLES,
  UNIT_TYPES,
  ALL_UPGRADES,
  getSlotCost,
} from '../data/gameData';

const ARMOR_IDS = ['extraArmor', 'reinforcedPlating', 'hardenedArmor'];

export function calcUnitPoints(unit) {
  const unitType = UNIT_TYPES[unit.typeId];
  const unitPts = unitType?.pts ?? 0;
  const heroPts = unit.heroId ? (HEROES[unit.heroId]?.pts ?? 0) : 0;
  const titlePts = unit.titleId ? (TITLES[unit.titleId]?.pts ?? 0) : 0;
  return unitPts + heroPts + titlePts;
}

export function calcPoints(army) {
  return army.units.reduce((sum, unit) => sum + calcUnitPoints(unit), 0);
}

export function slotsUsed(unit, location) {
  return (unit.slots[location] || []).reduce((sum, id) => sum + getSlotCost(id, unit.typeId), 0);
}

export function slotsMax(unit, location) {
  const unitType = UNIT_TYPES[unit.typeId];
  if (!unitType) return 0;
  const base = unitType.slots[location] ?? 0;
  const bonus = unit.aceCustomSlot === location ? 1 : 0;
  return base + bonus;
}

// Returns one entry per physical slot. Multi-slot items occupy multiple consecutive entries.
// Entry: { upgradeId, assignedIndex, isFirst, isLast } | null (empty slot)
export function buildSlotRows(unit, location) {
  const max = slotsMax(unit, location);
  const assigned = unit.slots[location] || [];
  const rows = [];

  assigned.forEach((upgradeId, assignedIndex) => {
    const cost = getSlotCost(upgradeId, unit.typeId);
    for (let i = 0; i < cost; i++) {
      rows.push({ upgradeId, assignedIndex, isFirst: i === 0, isLast: i === cost - 1, totalSlots: cost });
    }
  });

  while (rows.length < max) rows.push(null);
  return rows.slice(0, max);
}

function checkSlotLimits(unit, unitType) {
  const errors = [];
  if (unitType.isMecha) {
    ['torso', 'larm', 'rarm'].forEach(loc => {
      const max = slotsMax(unit, loc);
      const used = slotsUsed(unit, loc);
      if (used > max) {
        const label = loc === 'larm' ? 'L.Arm' : loc === 'rarm' ? 'R.Arm' : 'Torso';
        errors.push(`${label} exceeds slot limit (${used}/${max} slots used).`);
      }
    });
  } else {
    const max = unitType.totalSlots;
    const used = slotsUsed(unit, 'single');
    if (used > max) {
      errors.push(`Exceeds slot limit (${used}/${max} slots used).`);
    }
  }
  return errors;
}

export function validateUnit(unit, unitType) {
  const errors = [];

  if (ARMORED_UNIT_IDS.includes(unit.typeId)) {
    const allAssigned = Object.values(unit.slots).flat();
    if (!allAssigned.some(id => ARMOR_IDS.includes(id))) {
      errors.push('Armored units must take Extra Armor.');
    }
  }

  if (!unitType.isMecha) {
    Object.values(unit.slots).flat().forEach(upgradeId => {
      const upgrade = ALL_UPGRADES[upgradeId];
      if (upgrade?.mechaOnly) {
        errors.push(`"${upgrade.name}" is Mecha Only and cannot be equipped here.`);
      }
    });
    if (unit.heroId) errors.push('Heroes can only be assigned to mecha.');
    if (unit.titleId) errors.push('Titles can only be assigned to mecha.');
  }

  errors.push(...checkSlotLimits(unit, unitType));

  const allAssigned = Object.values(unit.slots).flat();
  const armorTaken = ARMOR_IDS.filter(id => allAssigned.includes(id));
  if (armorTaken.length > 1) {
    errors.push('Only one armor upgrade (Extra Armor / Reinforced Plating / Hardened Armor) may be equipped at a time.');
  }

  const counts = {};
  allAssigned.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  Object.entries(counts).forEach(([id, count]) => {
    const upgrade = ALL_UPGRADES[id];
    if (!upgrade) return;
    if (upgrade.isWeapon && count > 2) {
      errors.push(`"${upgrade.name}" equipped ${count}× — max 2 of any weapon.`);
    }
    const upgradeMax = id === 'heatSinks' ? 2 : 1;
    if (!upgrade.isWeapon && count > upgradeMax) {
      errors.push(`"${upgrade.name}" equipped ${count}× — max ${upgradeMax} of this upgrade.`);
    }
  });

  return errors;
}

export function canAddToZone(unit, location, upgradeId) {
  const upgrade = ALL_UPGRADES[upgradeId];
  if (!upgrade) return false;
  const unitType = UNIT_TYPES[unit.typeId];
  if (upgrade.mechaOnly && !unitType.isMecha) return false;
  const cost = getSlotCost(upgradeId, unit.typeId);
  const used = slotsUsed(unit, location);
  const max = slotsMax(unit, location);
  if (used + cost > max) return false;
  const allAssigned = Object.values(unit.slots).flat();
  if (ARMOR_IDS.includes(upgradeId) && allAssigned.some(id => ARMOR_IDS.includes(id) && id !== upgradeId)) return false;
  const count = allAssigned.filter(id => id === upgradeId).length;
  if (upgrade.isWeapon && count >= 2) return false;
  const upgradeMax = upgradeId === 'heatSinks' ? 2 : 1;
  if (!upgrade.isWeapon && count >= upgradeMax) return false;
  return true;
}

export function validateArmy(army) {
  const errors = [];

  const mechaUnits = army.units.filter(u => MECHA_UNIT_IDS.includes(u.typeId));
  const vehicleUnits = army.units.filter(u => ['groundVehicle', 'heavyVehicle'].includes(u.typeId));
  const gvUnits = army.units.filter(u => u.typeId === 'groundVehicle');

  if (vehicleUnits.length > mechaUnits.length) {
    errors.push(`Too many vehicles: ${vehicleUnits.length} vehicles but only ${mechaUnits.length} mecha.`);
  }

  const maxGVs = Math.floor(army.pointLimit / 50);
  if (gvUnits.length > maxGVs) {
    errors.push(`Too many ground vehicles: ${gvUnits.length} GVs but max is ${maxGVs} (1 per 50pts).`);
  }

  const heroTaken = {};
  army.units.forEach(unit => {
    if (unit.heroId) {
      if (heroTaken[unit.heroId]) {
        errors.push(`Hero "${HEROES[unit.heroId]?.name}" taken more than once — each hero is unique per army.`);
      }
      heroTaken[unit.heroId] = true;
    }
  });

  const heroCount = army.units.filter(u => u.heroId).length;
  const allowedHeroes = Math.floor(army.pointLimit / 200);
  if (heroCount > allowedHeroes) {
    errors.push(`Too many heroes: ${heroCount} taken, max ${allowedHeroes} for a ${army.pointLimit}pt army (1 per 200pts).`);
  }

  army.units.forEach(unit => {
    const unitType = UNIT_TYPES[unit.typeId];
    if (!unitType) return;
    validateUnit(unit, unitType).forEach(e => errors.push(`[${unit.name}] ${e}`));
  });

  const totalPts = calcPoints(army);
  if (totalPts > army.pointLimit) {
    errors.push(`Army is over the ${army.pointLimit}pt limit by ${totalPts - army.pointLimit}pts.`);
  }

  return errors;
}
