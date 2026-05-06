import { ALL_UPGRADES, UNIT_TYPES, getSlotCost } from '../data/gameData';
import { hexDistance, hexKey, hexLine, inFrontArc } from './hexMath';

export function parseStatValue(statStr) {
  if (typeof statStr === 'number') return statStr;
  return parseInt(statStr, 10);
}

// Hits needed to destroy an upgrade (= slot cost, except Extra Armor = 3)
export function damageThreshold(upgradeId, unitTypeId) {
  if (upgradeId === 'extraArmor') return 3;
  return getSlotCost(upgradeId, unitTypeId) || 1;
}

// All equipped weapon slots with disabled status
export function getEquippedWeapons(armyUnit, slotDamage) {
  const weapons = [];
  for (const [loc, upgradeIds] of Object.entries(armyUnit.slots)) {
    upgradeIds.forEach((upgradeId, idx) => {
      const upgrade = ALL_UPGRADES[upgradeId];
      if (!upgrade?.isWeapon) return;
      const key = `${loc}:${idx}`;
      const threshold = damageThreshold(upgradeId, armyUnit.typeId);
      const disabled = (slotDamage[key] ?? 0) >= threshold;
      weapons.push({ upgradeId, location: loc, slotIndex: idx, weapon: upgrade, disabled, key });
    });
  }
  return weapons;
}

// All equipped slots with full damage status — used by CombatPanel and damage checks
export function getAllSlots(armyUnit, slotDamage) {
  const slots = [];
  for (const [loc, upgradeIds] of Object.entries(armyUnit.slots)) {
    upgradeIds.forEach((upgradeId, idx) => {
      const upgrade = ALL_UPGRADES[upgradeId];
      if (!upgrade) return;
      const key = `${loc}:${idx}`;
      const dmg = slotDamage[key] ?? 0;
      const threshold = damageThreshold(upgradeId, armyUnit.typeId);
      slots.push({
        upgradeId, location: loc, slotIndex: idx, upgrade,
        disabled: dmg >= threshold, dmg, threshold, key,
      });
    });
  }
  return slots;
}

// True if unit has at least one non-disabled instance of a given upgrade
export function hasActiveUpgrade(armyUnit, slotDamage, upgradeId) {
  for (const [loc, upgradeIds] of Object.entries(armyUnit.slots)) {
    for (let idx = 0; idx < upgradeIds.length; idx++) {
      if (upgradeIds[idx] !== upgradeId) continue;
      const key = `${loc}:${idx}`;
      if ((slotDamage[key] ?? 0) < damageThreshold(upgradeId, armyUnit.typeId)) return true;
    }
  }
  return false;
}

// Att dice penalty from cover terrain or RAM Armor (always counts as cover)
export function getCoverPenalty(target, _attacker, terrain) {
  if (target.hasJumped) return 1;
  if (terrain[hexKey(target.q, target.r)]?.type === 'cover') return 1;
  if (hasActiveUpgrade(target.armyUnit, target.slotDamage, 'ramArmor')) return 1;
  return 0;
}

// Mechs (and structures) occupy 2 elevation levels; ground vehicles occupy 1
export function unitHeight(typeId) {
  return (typeId === 'groundVehicle' || typeId === 'heavyVehicle') ? 1 : 2;
}

// Check LOS — blocked by 'blocking' terrain or by elevation reaching either unit's eye level.
// Eye level = hex elevation + unit height. An intervening hex blocks if its elevation >= the
// lower of the two eye levels (the unit on lower ground can't see over it).
export function checkLOS(fromQ, fromR, toQ, toR, terrain, fromHeight = 2, toHeight = 2) {
  const fromEl = terrain[hexKey(fromQ, fromR)]?.elevation ?? 0;
  const toEl   = terrain[hexKey(toQ,   toR)]?.elevation ?? 0;
  const minEye = Math.min(fromEl + fromHeight, toEl + toHeight);
  const line = hexLine(fromQ, fromR, toQ, toR);
  for (let i = 1; i < line.length - 1; i++) {
    const { q, r } = line[i];
    const t = terrain[`${q},${r}`];
    if (t?.type === 'blocking') return false;
    if ((t?.elevation ?? 0) >= minEye) return false;
  }
  return true;
}

// Can attacker fire this weapon at target?
export function canWeaponTarget(attacker, target, weapon, terrain) {
  if (target.destroyed || target.surrendered) return false;
  const dist = hexDistance(attacker.q, attacker.r, target.q, target.r);
  if (dist < 1 || dist > weapon.range) return false;

  const isIndirect = weapon.special?.includes('Indirect') || !!attacker.hasJumped;
  const hasTurret = UNIT_TYPES[attacker.typeId]?.special?.includes('Turret');

  if (!hasTurret && !isIndirect) {
    if (!inFrontArc(attacker.q, attacker.r, attacker.facing, target.q, target.r)) return false;
  }
  if (!isIndirect) {
    if (!checkLOS(attacker.q, attacker.r, target.q, target.r, terrain,
        unitHeight(attacker.typeId), unitHeight(target.typeId))) return false;
  }
  return true;
}

export function rollDice(n) {
  return Array.from({ length: Math.max(0, n) }, () => Math.floor(Math.random() * 6) + 1);
}

export function countSuccesses(rolls, threshold) {
  return rolls.filter(r => r === 6 || r >= threshold).length;
}

export function countOverheats(rolls) {
  return rolls.filter(r => r === 1).length;
}

export function damagePerHit(weapon) {
  return weapon.special?.includes('Deadly') ? 2 : 1;
}

// Damage each model takes when one rams the other.
// Vehicles can't ram and return no damage when rammed (rammerTakes = 0).
export function calcRamDamage(rammer, target) {
  const isVehicle = u => u.typeId === 'groundVehicle' || u.typeId === 'heavyVehicle';
  const rammerSlots = UNIT_TYPES[rammer.typeId]?.totalSlots ?? 1;
  const targetSlots = UNIT_TYPES[target.typeId]?.totalSlots ?? 1;
  const diff = rammerSlots - targetSlots; // positive → rammer is bigger

  let rammerTakes = 1;
  let targetTakes = 1;

  if (diff > 0) targetTakes  += Math.floor(diff / 3);
  else if (diff < 0) rammerTakes += Math.floor(-diff / 3);

  if (hasActiveUpgrade(rammer.armyUnit, rammer.slotDamage, 'meleeOptimized'))  targetTakes++;
  if (hasActiveUpgrade(target.armyUnit, target.slotDamage, 'meleeOptimized'))  rammerTakes++;
  if (hasActiveUpgrade(rammer.armyUnit, rammer.slotDamage, 'reinforcedFrame') || rammer.hasJumped) rammerTakes = Math.max(0, rammerTakes - 1);
  if (hasActiveUpgrade(target.armyUnit, target.slotDamage, 'reinforcedFrame') || target.hasJumped) targetTakes = Math.max(0, targetTakes - 1);

  if (isVehicle(target)) rammerTakes = 0;

  return { rammerTakes, targetTakes };
}

// True when all equipped upgrade slots are disabled
export function isUnitDestroyed(armyUnit, slotDamage) {
  let hasAny = false;
  for (const [loc, upgradeIds] of Object.entries(armyUnit.slots)) {
    for (let idx = 0; idx < upgradeIds.length; idx++) {
      if (!ALL_UPGRADES[upgradeIds[idx]]) continue;
      hasAny = true;
      const dmg = slotDamage[`${loc}:${idx}`] ?? 0;
      if (dmg < damageThreshold(upgradeIds[idx], armyUnit.typeId)) return false;
    }
  }
  return hasAny;
}
