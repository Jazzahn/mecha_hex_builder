import { UNIT_TYPES } from '../data/gameData';
import { hexDistance, hexKey, hexNeighborAt, inBounds, isDeployZone, BOARD_COLS, BOARD_ROWS, vectorToFacing } from './hexMath';
import { getEquippedWeapons, canWeaponTarget, hasActiveUpgrade, getAllSlots, parseStatValue, damagePerHit } from './combat';
import { gameReducer, PLAY_PHASES, effectiveSlotDamage } from './gameReducer';

function weaponED(weapon, target, dist = 99) {
  const isAccurate = weapon.special?.includes('Accurate');
  const light      = weapon.special?.includes('Light Arms') ? 1 : 0;
  const eva   = Math.max(2, parseStatValue(UNIT_TYPES[target.typeId].eva));
  const blk   = Math.max(2, parseStatValue(UNIT_TYPES[target.typeId].tou) + weapon.str - light);
  const hitR  = Math.max(0, (7 - eva) / 6);
  const blkR  = Math.max(0, (7 - blk) / 6);
  const hitMult = isAccurate ? 2 : 1;
  const minRangePenalty = weapon.minRange && dist <= weapon.minRange ? weapon.minRange - dist + 1 : 0;
  const effectiveAtt = Math.max(1, weapon.att - minRangePenalty);
  return effectiveAtt * hitR * hitMult * (1 - blkR) * damagePerHit(weapon);
}

function unitRemainingHP(unit) {
  const slots = getAllSlots(unit.armyUnit, unit.slotDamage);
  return slots.reduce((sum, s) => sum + Math.max(0, s.threshold - s.dmg), 0);
}

function pickShot(attacker, weaponList, enemies, terrain) {
  let best = null, bestED = -1;
  for (let wi = 0; wi < weaponList.length; wi++) {
    const we = weaponList[wi];
    if (we.disabled) continue;
    for (const enemy of enemies) {
      if (!canWeaponTarget(attacker, enemy, we.weapon, terrain)) continue;
      const dist = hexDistance(attacker.q, attacker.r, enemy.q, enemy.r);
      const ed = weaponED(we.weapon, enemy, dist);
      if (ed > bestED) { bestED = ed; best = { wi, targetId: enemy.id }; }
    }
  }
  return best;
}

const BUFFER_ARMOR_IDS = ['extraArmor', 'reinforcedPlating', 'hardenedArmor'];

function pickDamageSlot(unit, pendingDamage, lockedKey, lockedLocation) {
  const eff = effectiveSlotDamage(unit, pendingDamage ?? []);
  const all = getAllSlots(unit.armyUnit, unit.slotDamage).filter(s => (eff[s.key] ?? 0) < s.threshold);
  const pool = lockedLocation === 'buffer'
    ? all.filter(s => BUFFER_ARMOR_IDS.includes(s.upgradeId))
    : lockedLocation
    ? all.filter(s => s.location === lockedLocation)
    : all;
  const candidates = pool.length > 0 ? pool : all;
  if (lockedKey) {
    const locked = candidates.find(s => s.key === lockedKey);
    if (locked) return locked.key;
  }
  candidates.sort((a, b) => ((eff[b.key] ?? 0) / b.threshold) - ((eff[a.key] ?? 0) / a.threshold));
  return candidates[0]?.key ?? null;
}

function aiDeploy(state) {
  const pi  = state.deployPlayerIndex;
  const idx = state.deployedCount[pi];
  if (idx >= state.armies[pi].units.length) return null;

  const occ = new Set(state.units.map(u => hexKey(u.q, u.r)));
  const candidates = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let q = 0; q < BOARD_COLS; q++) {
      if (!isDeployZone(q, r, pi)) continue;
      if (occ.has(hexKey(q, r))) continue;
      if (state.terrain[hexKey(q, r)]?.type === 'blocking') continue;
      candidates.push({ q, r });
    }
  }
  if (!candidates.length) return null;

  const { q, r } = candidates[Math.floor(Math.random() * candidates.length)];
  const facing = pi === 0 ? 4 : 1;

  let s = gameReducer(state, { type: 'SELECT_DEPLOY_UNIT', index: idx });
  s     = gameReducer(s,     { type: 'DEPLOY_UNIT', q, r, facing });
  return s;
}

function canMoveTo(state, unit, q, r) {
  if (!inBounds(q, r)) return false;
  if (state.terrain[hexKey(q, r)]?.type === 'blocking') return false;
  const occupied = new Set(state.units.filter(u => u.id !== unit.id && !u.destroyed).map(u => hexKey(u.q, u.r)));
  if (occupied.has(hexKey(q, r))) return false;
  const fromEl = state.terrain[hexKey(unit.q, unit.r)]?.elevation ?? 0;
  const toEl   = state.terrain[hexKey(q, r)]?.elevation ?? 0;
  if (toEl - fromEl > 1) return false;
  return true;
}

function bestMoveDir(state, unit, target) {
  const dirs = [0, 1, 2, 3, 4, 5];
  const passable = dirs
    .map(dir => { const nb = hexNeighborAt(unit.q, unit.r, dir); return { dir, q: nb.q, r: nb.r }; })
    .filter(({ q, r }) => canMoveTo(state, unit, q, r))
    .sort((a, b) => hexDistance(a.q, a.r, target.q, target.r) - hexDistance(b.q, b.r, target.q, target.r));
  return passable[0] ?? null;
}

function aiMoveStep(state) {
  const pa   = state.pendingAction;
  const unit = state.units.find(u => u.id === state.selectedUnitId);
  if (!unit) return gameReducer(state, { type: 'END_STEP_MOVE' });
  if (!pa?.remainingMoves) return gameReducer(state, { type: 'END_STEP_MOVE' });

  const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
  if (!enemies.length) return gameReducer(state, { type: 'END_STEP_MOVE' });

  const target = enemies.reduce((b, e) =>
    hexDistance(unit.q, unit.r, e.q, e.r) < hexDistance(unit.q, unit.r, b.q, b.r) ? e : b);

  const distToTarget = hexDistance(unit.q, unit.r, target.q, target.r);
  const hasTurret    = UNIT_TYPES[unit.typeId]?.special?.includes('Turret');

  if (pa.isJumping) {
    if (distToTarget <= 1) return gameReducer(state, { type: 'END_STEP_MOVE' });
    const desired = vectorToFacing(unit.q, unit.r, target.q, target.r);
    const before  = hexKey(unit.q, unit.r);
    const moved   = gameReducer(state, { type: 'STEP_MOVE', direction: desired });
    const afterUnit = moved.units.find(u => u.id === unit.id);
    if (hexKey(afterUnit.q, afterUnit.r) === before) return gameReducer(state, { type: 'END_STEP_MOVE' });
    if (moved.pendingAction?.action === 'jump-land') return moved;
    const distAfter = hexDistance(afterUnit.q, afterUnit.r, target.q, target.r);
    if (distAfter <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });
    return moved;
  }

  if (distToTarget <= 1) return gameReducer(state, { type: 'END_STEP_MOVE' });

  // Pick the passable neighbor that gets closest to the target
  const best = bestMoveDir(state, unit, target);
  if (!best) return gameReducer(state, { type: 'END_STEP_MOVE' });

  const desired = best.dir;

  if (!hasTurret && unit.facing !== desired) {
    const leftTurns  = (desired - unit.facing + 6) % 6;
    const rightTurns = (unit.facing - desired + 6) % 6;
    return gameReducer(state, { type: 'STEP_TURN', dir: leftTurns <= rightTurns ? 'left' : 'right' });
  }

  const before = hexKey(unit.q, unit.r);
  const moved  = gameReducer(state, { type: 'STEP_MOVE', direction: 'forward' });
  const afterUnit = moved.units.find(u => u.id === unit.id);
  if (hexKey(afterUnit.q, afterUnit.r) === before) return gameReducer(state, { type: 'END_STEP_MOVE' });
  const distAfter = hexDistance(afterUnit.q, afterUnit.r, target.q, target.r);
  if (distAfter <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });
  return moved;
}

// Returns the player index who controls the current pendingCombat step
function combatStepController(state) {
  const pc = state.pendingCombat;
  if (!pc) return null;
  const { units } = state;
  const attacker = units.find(u => u.id === pc.attackerId);
  const target   = units.find(u => u.id === pc.targetId);
  const rammer   = units.find(u => u.id === pc.rammerId);
  switch (pc.step) {
    case 'block-roll': case 'damage-assign':
      return target?.playerIndex ?? 0;
    case 'exp-armor-roll':
      return pc.expArmorNextStep === 'ram-damage-rammer'
        ? (rammer?.playerIndex ?? 0)
        : (target?.playerIndex ?? 0);
    case 'overheat-assign': case 'overheat-result':
      return attacker?.playerIndex ?? 0;
    case 'ram-damage-rammer':
      return rammer?.playerIndex ?? 0;
    case 'ram-damage-target':
      return target?.playerIndex ?? 0;
    case 'ram-push':
      return pc.pushChooserIndex ?? 0;
    default:
      return attacker?.playerIndex ?? (rammer?.playerIndex ?? 0);
  }
}

// Returns next game state after one AI action, or null if it's not the bot's turn.
export function aiStep(state, botPlayerIndex) {
  if (state.phase === 'over') return null;

  if (state.pendingMorale) {
    if (state.pendingMorale.playerIndex === botPlayerIndex) {
      return gameReducer(state, { type: 'DISMISS_MORALE' });
    }
    return null;
  }

  if (state.phase === 'deploy') {
    if (state.deployPlayerIndex !== botPlayerIndex) return null;
    return aiDeploy(state);
  }

  if (state.phase !== 'playing') return null;

  const pc = state.pendingCombat;
  if (pc) {
    if (combatStepController(state) !== botPlayerIndex) return null;
    switch (pc.step) {
      case 'weapon-select': {
        const attacker = state.units.find(u => u.id === pc.attackerId);
        const enemies  = state.units.filter(u => u.playerIndex !== attacker.playerIndex && !u.destroyed && !u.surrendered);
        const shot = pickShot(attacker, pc.weaponList, enemies, state.terrain);
        if (!shot) return gameReducer(state, { type: 'CANCEL_SHOOT' });
        return gameReducer(state, { type: 'SELECT_WEAPON', weaponIdx: shot.wi });
      }
      case 'target-select': {
        if (!pc.validTargets.length) return gameReducer(state, { type: 'CANCEL_SHOOT' });
        const targetId = pc.validTargets.reduce((best, id) => {
          const u = state.units.find(u => u.id === id);
          const b = state.units.find(u => u.id === best);
          return unitRemainingHP(u) < unitRemainingHP(b) ? id : best;
        }, pc.validTargets[0]);
        return gameReducer(state, { type: 'SELECT_COMBAT_TARGET', targetId });
      }
      case 'hit-roll':
        if (!pc.hitRolls.length) return gameReducer(state, { type: 'ROLL_HIT_DICE' });
        return gameReducer(state, { type: 'ADVANCE_HIT' });
      case 'block-roll':
        if (!pc.blockRolls.length) return gameReducer(state, { type: 'ROLL_BLOCK_DICE' });
        return gameReducer(state, { type: 'ADVANCE_BLOCK' });
      case 'exp-armor-roll':
        if (!pc.expArmorRolls.length) return gameReducer(state, { type: 'ROLL_EXP_ARMOR_DICE' });
        return gameReducer(state, { type: 'ADVANCE_EXP_ARMOR' });
      case 'overheat-result':
        return gameReducer(state, { type: 'ADVANCE_OVERHEAT' });
      case 'location-roll':
        return gameReducer(state, { type: 'ROLL_LOCATION_DICE' });
      case 'overheat-assign': {
        const attacker = state.units.find(u => u.id === pc.attackerId);
        const key = pickDamageSlot(attacker, state.pendingDamage, pc.lockedUpgradeKey, null);
        if (!key) return gameReducer(state, { type: 'ADVANCE_OVERHEAT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'damage-assign': {
        const target = state.units.find(u => u.id === pc.targetId);
        const key = pickDamageSlot(target, state.pendingDamage, pc.lockedUpgradeKey, pc.lockedLocation);
        if (!key) return gameReducer(state, { type: 'CANCEL_SHOOT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'ram-damage-target': {
        const target = state.units.find(u => u.id === pc.targetId);
        const key = pickDamageSlot(target, state.pendingDamage, pc.lockedUpgradeKey, null);
        if (!key) return gameReducer(state, { type: 'CANCEL_SHOOT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'ram-damage-rammer': {
        const rammer = state.units.find(u => u.id === pc.rammerId);
        const key = pickDamageSlot(rammer, state.pendingDamage, pc.lockedUpgradeKey, null);
        if (!key) return gameReducer(state, { type: 'CANCEL_SHOOT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'ram-push': {
        const pushHex = pc.validPushHexes?.[0];
        if (pushHex) return gameReducer(state, { type: 'RESOLVE_RAM_PUSH', q: pushHex.q, r: pushHex.r });
        return gameReducer(state, { type: 'RESOLVE_RAM_PUSH', q: 0, r: 0 });
      }
      case 'done':
        return gameReducer(state, { type: 'FINISH_COMBAT' });
      default:
        return gameReducer(state, { type: 'CANCEL_SHOOT' });
    }
  }

  if (state.activePlayer !== botPlayerIndex) return null;

  if (state.selectedUnitId) {
    const unit = state.units.find(u => u.id === state.selectedUnitId);
    if (!unit) return gameReducer(state, { type: 'END_ACTIVATION' });

    const pa = state.pendingAction;

    if (!pa) {
      const hasJump = hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'boostJets');
      return gameReducer(state, { type: 'START_ACTION', action: 'move', isJumping: hasJump || undefined });
    }

    if (pa.remainingMoves) return aiMoveStep(state);

    if (pa.action === 'jump-land') {
      const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
      const target  = enemies.length
        ? enemies.reduce((b, e) => hexDistance(unit.q, unit.r, e.q, e.r) < hexDistance(unit.q, unit.r, b.q, b.r) ? e : b)
        : null;
      const facing = target ? vectorToFacing(unit.q, unit.r, target.q, target.r) : unit.facing;
      return gameReducer(state, { type: 'JUMP_LAND', facing });
    }

    if (!unit.hasCruised) {
      const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
      const weapons = getEquippedWeapons(unit.armyUnit, unit.slotDamage)
        .filter(w => !w.disabled && !(unit.firedWeaponKeys ?? []).includes(w.key));
      if (pickShot(unit, weapons, enemies, state.terrain)) {
        return gameReducer(state, { type: 'START_SHOOT' });
      }
    }

    return gameReducer(state, { type: 'END_ACTIVATION' });
  }

  const phase = PLAY_PHASES[state.phaseIndex];
  if (!phase) return null;

  const nextUnit = state.units.find(u =>
    !u.activated && !u.destroyed && !u.surrendered &&
    u.playerIndex === state.activePlayer &&
    phase.types.includes(u.typeId)
  );

  if (nextUnit) return gameReducer(state, { type: 'SELECT_UNIT', unitId: nextUnit.id });
  return null;
}
