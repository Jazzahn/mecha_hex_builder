import { UNIT_TYPES, ALL_UPGRADES } from '../data/gameData';
import { hexKey, hexDistance, isDeployZone, hexNeighborAt, hexNeighbors, inBounds, BOARD_COLS, BOARD_ROWS } from './hexMath';
import {
  getEquippedWeapons, canWeaponTarget, rollDice,
  countSuccesses, countOverheats, parseStatValue,
  damagePerHit, getAllSlots, damageThreshold, isUnitDestroyed,
  hasActiveUpgrade, getCoverPenalty, calcRamDamage,
} from './combat';

export const PLAY_PHASES = [
  { key: 'vehicles',   label: 'Vehicles Phase',      types: ['groundVehicle', 'heavyVehicle'] },
  { key: 'light',      label: 'Light Mecha Phase',   types: ['light'] },
  { key: 'medium',     label: 'Medium Mecha Phase',  types: ['medium'] },
  { key: 'heavy',      label: 'Heavy Mecha Phase',   types: ['heavy'] },
  { key: 'assault',    label: 'Assault Mecha Phase', types: ['assault'] },
  { key: 'structures', label: 'Structures Phase',    types: ['armedStructure', 'unarmedStructure', 'fortifiedStructure'] },
];

export function buildInitialState(playerNames, armies) {
  return {
    phase: 'terrain',
    round: 1,
    phaseIndex: 0,
    initiativePlayer: 0,
    activePlayer: 0,

    playerNames,
    armies,

    units: [],
    terrain: {},
    objectives: [],

    terrainTool: 'cover',

    objectivesToPlace: 0,
    objectivePlacingPlayer: 0,

    deployPlayerIndex: 0,
    deployUnitIndex: null,
    deployedCount: [0, 0],

    selectedUnitId: null,
    pendingAction: null,
    pendingCombat: null,
    pendingMorale: null,

    startingMechaCount: [0, 0],

    log: [],
  };
}

let nextGameUnitId = 1;

function makeGameUnit(armyUnit, playerIndex, q, r, facing) {
  const slotDamage = {};
  for (const [loc, upgradeIds] of Object.entries(armyUnit.slots)) {
    upgradeIds.forEach((_, idx) => { slotDamage[`${loc}:${idx}`] = 0; });
  }
  return {
    id: `g${nextGameUnitId++}`,
    armyUnit,
    playerIndex,
    typeId: armyUnit.typeId,
    name: armyUnit.name,
    q, r,
    facing,
    activated: false,
    heldAction: false,
    firedWeaponKeys: [],
    hasCruised: false,
    heatSinkCanceled: 0,
    ammoBoxDamaged: false,
    hasJumped: false,
    slotDamage,
    destroyed: false,
    surrendered: false,
    carryingObjective: false,
  };
}

function occupiedSet(units) {
  const s = new Set();
  units.filter(u => !u.destroyed && !u.surrendered).forEach(u => s.add(hexKey(u.q, u.r)));
  return s;
}

function occupiedSetExcluding(units, excludeId) {
  const s = new Set();
  units.filter(u => !u.destroyed && !u.surrendered && u.id !== excludeId).forEach(u => s.add(hexKey(u.q, u.r)));
  return s;
}

function addLog(state, text) {
  return { ...state, log: [...state.log, { round: state.round, text }] };
}

function checkAnnihilation(state) {
  if (state.phase !== 'playing') return state;
  const alive = [0, 1].map(pi => state.units.some(u => !u.destroyed && !u.surrendered && u.playerIndex === pi));
  if (!alive[0]) return addLog({ ...state, phase: 'over' }, `All of ${state.playerNames[0]}'s units destroyed — ${state.playerNames[1]} wins!`);
  if (!alive[1]) return addLog({ ...state, phase: 'over' }, `All of ${state.playerNames[1]}'s units destroyed — ${state.playerNames[0]} wins!`);
  return state;
}

// After both sides' ram damage is resolved, determine push and transition pendingCombat.
function startRamPushOrEnd(state, rammerId, targetId, targetTypeId, rammerTakes, targetTakes) {
  const rammer = state.units.find(u => u.id === rammerId);
  const target  = state.units.find(u => u.id === targetId);

  const isStructure = ['armedStructure', 'unarmedStructure', 'fortifiedStructure'].includes(targetTypeId);
  const rammerPushed = isStructure || rammerTakes >= targetTakes;
  const pushedUnit   = state.units.find(u => u.id === (rammerPushed ? rammerId : targetId));
  const pushChooserIndex = rammerPushed
    ? (target?.playerIndex ?? 0)
    : (rammer?.playerIndex ?? 0);

  if (!pushedUnit || pushedUnit.destroyed) {
    let finalUnits = state.units;
    if (!rammerPushed && target && !target.destroyed) {
      finalUnits = finalUnits.map(u => u.id === rammerId ? { ...u, q: target.q, r: target.r } : u);
    }
    const activated = finalUnits.map(u => u.id === rammerId ? { ...u, activated: true } : u);
    return advancePhaseIfDone(addLog(
      { ...state, units: activated, selectedUnitId: null, pendingAction: null, pendingCombat: null },
      `${rammer?.name ?? 'Rammer'} (P${(rammer?.playerIndex ?? 0) + 1}) rams.`
    ));
  }

  const ramIds = new Set([rammerId, targetId]);
  const thirdOccupied = new Set(
    state.units
      .filter(u => !u.destroyed && !u.surrendered && !ramIds.has(u.id))
      .map(u => hexKey(u.q, u.r))
  );
  const validPushHexes = hexNeighbors(target.q, target.r).filter(({ q, r }) =>
    inBounds(q, r) &&
    !thirdOccupied.has(hexKey(q, r)) &&
    state.terrain[hexKey(q, r)]?.type !== 'blocking'
  );

  return {
    ...state,
    pendingCombat: {
      step: 'ram-push',
      rammerId,
      targetId,
      pushedUnitId: pushedUnit.id,
      pushChooserIndex,
      validPushHexes,
      rammerPushed,
    },
  };
}

function dropCarriedObjectives(objectives, unitId, q, r, logs) {
  const carried = objectives.filter(o => o.carrierId === unitId);
  if (carried.length === 0) return objectives;
  logs.push(`An objective is dropped at ${q},${r}!`);
  return objectives.map(o => o.carrierId === unitId ? { ...o, carrierId: null, q, r } : o);
}

// Apply 1 damage point to slotKey on unitId. Returns null if slot is invalid/full.
function applyOneDamage(state, unitId, slotKey, { extraDamage = 0, destroySuffix = '' } = {}) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return null;
  const [loc, idxStr] = slotKey.split(':');
  const upgradeId = unit.armyUnit.slots[loc]?.[Number(idxStr)];
  if (!upgradeId) return null;
  const threshold  = damageThreshold(upgradeId, unit.typeId);
  const currentDmg = unit.slotDamage[slotKey] ?? 0;
  if (currentDmg >= threshold) return null;
  const newDmg = Math.min(currentDmg + 1 + extraDamage, threshold);
  const upgradeDestroyed = newDmg >= threshold;
  const newSlotDamage = { ...unit.slotDamage, [slotKey]: newDmg };
  let newUnits = state.units.map(u => u.id === unitId ? { ...u, slotDamage: newSlotDamage } : u);
  let newState = state;
  if (upgradeDestroyed) {
    newState = addLog(newState, `${unit.name}'s ${ALL_UPGRADES[upgradeId]?.name ?? upgradeId} is destroyed${destroySuffix}!`);
  }
  const updatedUnit = newUnits.find(u => u.id === unitId);
  const unitDestroyed = isUnitDestroyed(updatedUnit.armyUnit, updatedUnit.slotDamage);
  if (unitDestroyed) {
    newUnits = newUnits.map(u => u.id === unitId ? { ...u, destroyed: true } : u);
    newState = addLog(newState, `${unit.name} is destroyed${destroySuffix}!`);
    const dropLogs = [];
    const droppedObjs = dropCarriedObjectives(newState.objectives, unitId, unit.q, unit.r, dropLogs);
    newState = { ...newState, objectives: droppedObjs };
    for (const l of dropLogs) newState = addLog(newState, l);
  }
  return { newState, newUnits, upgradeDestroyed, unitDestroyed, newLocked: upgradeDestroyed ? null : slotKey };
}

function commitActivation(state, unit) {
  const moved   = state.pendingAction?.action === 'move';
  const cruised = state.pendingAction?.action === 'cruise';
  const shot    = (unit.firedWeaponKeys?.length ?? 0) > 0;
  const verb    = cruised ? 'cruise' : moved && shot ? 'move and shoot' : moved ? 'move' : shot ? 'shoot' : 'hold';
  const units   = state.units.map(u => u.id === unit.id ? { ...u, activated: true } : u);
  return advancePhaseIfDone(addLog(
    { ...state, units, selectedUnitId: null, pendingAction: null },
    `${unit.name} (P${unit.playerIndex + 1}) ${verb}s.`
  ));
}

function makeCombatState(attackerId, weaponList) {
  return {
    step: 'weapon-select',
    attackerId,
    weaponList,
    selectedWeaponIdx: null,
    targetId: null,
    validTargets: [],
    hitRolls: [],
    blockRolls: [],
    hits: 0,
    blocks: 0,
    netDamage: 0,
    remainingDamage: 0,
    coverPenalty: 0,
    blastTargetIds: [],
    lockedUpgradeKey: null,
    pendingOverheatWounds: 0,
    expArmorRolls: [],
    expArmorNextStep: null,
  };
}

// At natural 'done' points: if attacker has unresolved overheat wounds, go to
// overheat-result first; otherwise go straight to 'done'.
function transitionOrOverheat(state, pcMerge) {
  const pc = state.pendingCombat;
  const wounds = pc?.pendingOverheatWounds ?? 0;
  const merged = { ...pc, ...pcMerge };
  if (wounds > 0) {
    return { ...state, pendingCombat: { ...merged, step: 'overheat-result', overheatRemaining: wounds, pendingOverheatWounds: 0, lockedUpgradeKey: null, lastExpArmorSave: null } };
  }
  return { ...state, pendingCombat: { ...merged, step: 'done' } };
}

// Auto-assign `count` damage points to random available slots on a unit
function autoAssignDamage(units, objectives, targetId, count) {
  let newUnits = units;
  let newObjectives = objectives;
  const logs = [];
  for (let i = 0; i < count; i++) {
    const current = newUnits.find(u => u.id === targetId);
    if (!current || current.destroyed) break;
    const available = getAllSlots(current.armyUnit, current.slotDamage).filter(s => !s.disabled);
    if (available.length === 0) {
      newUnits = newUnits.map(u => u.id === targetId ? { ...u, destroyed: true } : u);
      logs.push(`${current.name} is destroyed!`);
      newObjectives = dropCarriedObjectives(newObjectives, targetId, current.q, current.r, logs);
      break;
    }
    const slot = available[Math.floor(Math.random() * available.length)];
    const newDmg = (current.slotDamage[slot.key] ?? 0) + 1;
    const newSlotDamage = { ...current.slotDamage, [slot.key]: newDmg };
    newUnits = newUnits.map(u => u.id === targetId ? { ...u, slotDamage: newSlotDamage } : u);
    if (newDmg >= slot.threshold) {
      const after = newUnits.find(u => u.id === targetId);
      logs.push(`${after.name}'s ${ALL_UPGRADES[slot.upgradeId]?.name ?? slot.upgradeId} destroyed!`);
      if (isUnitDestroyed(after.armyUnit, after.slotDamage)) {
        newUnits = newUnits.map(u => u.id === targetId ? { ...u, destroyed: true } : u);
        logs.push(`${after.name} is destroyed!`);
        newObjectives = dropCarriedObjectives(newObjectives, targetId, after.q, after.r, logs);
        break;
      }
    }
  }
  return { units: newUnits, objectives: newObjectives, logs };
}

const MECHA_TYPES = new Set(['light', 'medium', 'heavy', 'assault']);
const VEHICLE_TYPES = new Set(['groundVehicle', 'heavyVehicle']);

function startNextRound(state, newRound) {
  const newInitiative = 1 - state.initiativePlayer;
  const resetUnits = state.units.map(u => ({
    ...u, activated: false, heldAction: false,
    firedWeaponKeys: [], hasCruised: false, heatSinkCanceled: 0, ammoBoxDamaged: false, hasJumped: false,
  }));
  const roundStartState = addLog(
    { ...state, round: newRound, phaseIndex: 0, initiativePlayer: newInitiative, activePlayer: newInitiative, units: resetUnits },
    `Round ${newRound} begins. ${state.playerNames[newInitiative]} has initiative.`
  );
  return advancePhaseIfDone(roundStartState);
}

function runMoraleChecks(state) {
  const results = [];
  let newState = state;

  for (const playerIndex of [0, 1]) {
    const startCount = state.startingMechaCount?.[playerIndex] ?? 0;
    if (startCount === 0) continue;
    const aliveMecha = state.units.filter(u =>
      MECHA_TYPES.has(u.typeId) && !u.destroyed && !u.surrendered && u.playerIndex === playerIndex
    );
    if (aliveMecha.length * 2 > startCount) continue; // not at half or below

    for (const unit of aliveMecha) {
      const nonDisabled = getAllSlots(unit.armyUnit, unit.slotDamage).filter(s => !s.disabled).length;
      const roll = rollDice(1)[0];
      const total = roll + nonDisabled;
      const passed = total >= 6;
      results.push({ unitId: unit.id, unitName: unit.name, playerIndex, roll, bonuses: nonDisabled, total, passed });
    }
  }

  if (results.length === 0) return state;

  // Apply surrenders
  const surrenderIds = new Set(results.filter(r => !r.passed).map(r => r.unitId));
  newState = { ...newState, units: newState.units.map(u => surrenderIds.has(u.id) ? { ...u, surrendered: true } : u) };

  for (const r of results) {
    const verb = r.passed ? 'passes' : 'fails';
    newState = addLog(newState, `${r.unitName} ${verb} morale (${r.roll}+${r.bonuses}=${r.total}) — ${r.passed ? 'holds!' : 'surrenders!'}`);
  }

  // Vehicle cascade: if all mecha for a player gone, their vehicles surrender too
  for (const playerIndex of [0, 1]) {
    const mechaRemain = newState.units.some(u =>
      MECHA_TYPES.has(u.typeId) && !u.destroyed && !u.surrendered && u.playerIndex === playerIndex
    );
    if (!mechaRemain) {
      const vehicles = newState.units.filter(u =>
        VEHICLE_TYPES.has(u.typeId) && !u.destroyed && !u.surrendered && u.playerIndex === playerIndex
      );
      if (vehicles.length > 0) {
        newState = { ...newState, units: newState.units.map(u =>
          vehicles.some(v => v.id === u.id) ? { ...u, surrendered: true } : u
        )};
        newState = addLog(newState, `All of ${state.playerNames[playerIndex]}'s mecha have fallen — vehicles surrender!`);
        vehicles.forEach(v => results.push({ unitId: v.id, unitName: v.name, playerIndex, roll: null, bonuses: null, total: null, passed: false, isVehicle: true }));
      }
    }
  }

  newState = checkAnnihilation(newState);
  if (newState.phase === 'over') return newState;

  return { ...newState, pendingMorale: { results } };
}

function advancePhaseIfDone(state) {
  const phase = PLAY_PHASES[state.phaseIndex];
  const phaseUnits = state.units.filter(u =>
    phase.types.includes(u.typeId) && !u.destroyed && !u.surrendered
  );
  const allActivated = phaseUnits.every(u => u.activated);

  const annihilated = checkAnnihilation(state);
  if (annihilated.phase === 'over') return annihilated;

  if (!allActivated) {
    const nextPlayer = 1 - state.activePlayer;
    const nextHasUnits = phaseUnits.some(u => !u.activated && u.playerIndex === nextPlayer);
    return { ...state, activePlayer: nextHasUnits ? nextPlayer : state.activePlayer };
  }

  let nextPhaseIndex = state.phaseIndex + 1;
  while (nextPhaseIndex < PLAY_PHASES.length) {
    const next = PLAY_PHASES[nextPhaseIndex];
    if (state.units.some(u => next.types.includes(u.typeId) && !u.destroyed && !u.surrendered)) break;
    nextPhaseIndex++;
  }

  if (nextPhaseIndex >= PLAY_PHASES.length) {
    const newRound = state.round + 1;
    if (newRound > 4) return addLog({ ...state, phase: 'over' }, 'Game over after 4 rounds!');
    const afterMorale = runMoraleChecks(state);
    if (afterMorale.phase === 'over') return afterMorale;
    if (afterMorale.pendingMorale) return afterMorale; // pause for morale display
    return startNextRound(afterMorale, newRound);
  }

  const nextPhase = PLAY_PHASES[nextPhaseIndex];
  const ipHasUnits = state.units.some(u =>
    nextPhase.types.includes(u.typeId) && !u.destroyed && !u.surrendered && u.playerIndex === state.initiativePlayer
  );
  return addLog(
    { ...state, phaseIndex: nextPhaseIndex, activePlayer: ipHasUnits ? state.initiativePlayer : 1 - state.initiativePlayer },
    `${PLAY_PHASES[nextPhaseIndex].label} begins.`
  );
}

// Called when jump movement ends (END_STEP_MOVE or moves exhausted).
// Applies fall damage (capped at 1) and marks hasJumped on the unit.
function endJump(state) {
  const unit = state.units.find(u => u.id === state.selectedUnitId);
  if (!unit) return { ...state, pendingAction: { action: 'move', moved: true } };
  const startEl  = state.pendingAction?.jumpStartElevation ?? 0;
  const landEl   = state.terrain[hexKey(unit.q, unit.r)]?.elevation ?? 0;
  let newUnits   = state.units.map(u => u.id === unit.id ? { ...u, hasJumped: true } : u);
  let newState   = { ...state, units: newUnits, pendingAction: { action: 'move', moved: true } };
  if (landEl < startEl) {
    newState = addLog(newState, `${unit.name} takes 1 falling damage landing from a jump!`);
    const { units: afterFall, objectives: afterObj, logs } = autoAssignDamage(newState.units, newState.objectives, unit.id, 1);
    newState = { ...newState, units: afterFall, objectives: afterObj };
    for (const l of logs) newState = addLog(newState, l);
    const afterCheck = checkAnnihilation(newState);
    if (afterCheck.phase === 'over') return afterCheck;
    const landed = afterCheck.units.find(u => u.id === unit.id);
    if (landed?.destroyed) {
      const activated = afterCheck.units.map(u => u.id === unit.id ? { ...u, activated: true } : u);
      return advancePhaseIfDone(addLog(
        { ...afterCheck, units: activated, selectedUnitId: null, pendingAction: null },
        `${unit.name} (P${unit.playerIndex + 1}) is destroyed on landing!`
      ));
    }
    return afterCheck;
  }
  return newState;
}

export function gameReducer(state, action) {
  switch (action.type) {

    // ── Terrain editor ─────────────────────────────────────
    case 'SET_TERRAIN_TOOL':
      return { ...state, terrainTool: action.tool };

    case 'APPLY_TERRAIN': {
      const k = hexKey(action.q, action.r);
      const existing = state.terrain[k];
      if (action.tool === 'clear') {
        const { [k]: _, ...rest } = state.terrain;
        return { ...state, terrain: rest };
      }
      if (action.tool.startsWith('elev-')) {
        const elevation = parseInt(action.tool.split('-')[1]);
        return { ...state, terrain: { ...state.terrain, [k]: { type: existing?.type ?? null, elevation } } };
      }
      const newType = existing?.type === action.tool ? null : action.tool;
      if (!newType && !existing?.elevation) {
        const { [k]: _, ...rest } = state.terrain;
        return { ...state, terrain: rest };
      }
      return { ...state, terrain: { ...state.terrain, [k]: { type: newType, elevation: existing?.elevation ?? 0 } } };
    }

    case 'CLEAR_ALL_TERRAIN':
      return { ...state, terrain: {} };

    case 'RANDOMIZE_TERRAIN': {
      const newTerrain = {};
      const types = ['cover', 'difficult', 'blocking', 'dangerous'];

      function growCluster(size) {
        // Seed anywhere except the outermost border ring
        const seedQ = 1 + Math.floor(Math.random() * (BOARD_COLS - 2));
        const seedR = 1 + Math.floor(Math.random() * (BOARD_ROWS - 2));
        const cluster = [{ q: seedQ, r: seedR }];
        const inCluster = new Set([hexKey(seedQ, seedR)]);
        while (cluster.length < size) {
          const base = cluster[Math.floor(Math.random() * cluster.length)];
          const candidates = hexNeighbors(base.q, base.r).filter(n => !inCluster.has(hexKey(n.q, n.r)));
          if (!candidates.length) break;
          const next = candidates[Math.floor(Math.random() * candidates.length)];
          cluster.push(next);
          inCluster.add(hexKey(next.q, next.r));
        }
        return cluster;
      }

      // 5-10 terrain patches
      const patchCount = 5 + Math.floor(Math.random() * 6);
      for (let p = 0; p < patchCount; p++) {
        const type = types[Math.floor(Math.random() * types.length)];
        const size = 2 + Math.floor(Math.random() * 4); // 2-5 hexes
        for (const hex of growCluster(size)) {
          const hk = hexKey(hex.q, hex.r);
          newTerrain[hk] = { type, elevation: newTerrain[hk]?.elevation ?? 0 };
        }
      }

      // 2-4 elevation patches (layer on top, preserve any terrain type)
      const elevCount = 2 + Math.floor(Math.random() * 3);
      for (let e = 0; e < elevCount; e++) {
        const elevation = 1 + Math.floor(Math.random() * 2); // 1 or 2
        const size = 2 + Math.floor(Math.random() * 3); // 2-4 hexes
        for (const hex of growCluster(size)) {
          const hk = hexKey(hex.q, hex.r);
          newTerrain[hk] = { ...(newTerrain[hk] ?? {}), elevation };
        }
      }

      return { ...state, terrain: newTerrain };
    }

    case 'FINISH_TERRAIN': {
      const count = Math.ceil(Math.random() * 3) + 1; // D3+1 objectives
      return addLog(
        { ...state, phase: 'objective-setup', objectivesToPlace: count, objectivePlacingPlayer: state.initiativePlayer },
        `Terrain set. Place ${count} objectives. ${state.playerNames[state.initiativePlayer]} places first.`
      );
    }

    case 'PLACE_OBJECTIVE': {
      const { q, r } = action;
      const newObjectives = [...state.objectives, { q, r, carrierId: null }];
      const nextPlacer = 1 - state.objectivePlacingPlayer;
      const placed = newObjectives.length;
      if (placed >= state.objectivesToPlace) {
        return addLog(
          { ...state, objectives: newObjectives, phase: 'deploy', deployPlayerIndex: 0 },
          `All ${placed} objectives placed. Deployment begins.`
        );
      }
      return addLog(
        { ...state, objectives: newObjectives, objectivePlacingPlayer: nextPlacer },
        `${state.playerNames[state.objectivePlacingPlayer]} places objective ${placed} of ${state.objectivesToPlace}. ${state.playerNames[nextPlacer]}'s turn.`
      );
    }

    // ── Deployment ──────────────────────────────────────────
    case 'SELECT_DEPLOY_UNIT':
      return { ...state, deployUnitIndex: action.index };

    case 'DEPLOY_UNIT': {
      const { q, r } = action;
      const pIdx = state.deployPlayerIndex;
      const army = state.armies[pIdx];
      const unitIdx = state.deployUnitIndex;
      if (unitIdx === null || unitIdx === undefined) return state;
      if (!isDeployZone(q, r, pIdx)) return state;
      if (occupiedSet(state.units).has(hexKey(q, r))) return state;
      if (state.terrain[hexKey(q, r)]?.type === 'blocking') return state;

      const newUnit = makeGameUnit(army.units[unitIdx], pIdx, q, r, action.facing ?? (pIdx === 0 ? 5 : 2));
      const newDeployedCount = [...state.deployedCount];
      newDeployedCount[pIdx]++;

      const playerDone = newDeployedCount[pIdx] >= army.units.length;
      let nextDeployPlayer = pIdx;
      let nextPhase = 'deploy';

      if (playerDone) {
        if (newDeployedCount[1 - pIdx] >= state.armies[1 - pIdx].units.length) nextPhase = 'playing';
        else nextDeployPlayer = 1 - pIdx;
      } else {
        nextDeployPlayer = 1 - pIdx;
        if (newDeployedCount[1 - pIdx] >= state.armies[1 - pIdx].units.length) nextDeployPlayer = pIdx;
      }

      const s = { ...state, units: [...state.units, newUnit], deployedCount: newDeployedCount, deployUnitIndex: null, deployPlayerIndex: nextDeployPlayer, phase: nextPhase };
      if (nextPhase === 'playing') {
        // Advance past any phases that have no units (e.g. no vehicles → skip Vehicles Phase)
        const logged = addLog(s, `Deployment complete. Round 1 begins. ${s.playerNames[s.initiativePlayer]} has initiative.`);
        return advancePhaseIfDone(logged);
      }
      return s;
    }

    case 'START_GAME': {
      const startingMechaCount = [0, 1].map(pi =>
        state.units.filter(u => MECHA_TYPES.has(u.typeId) && u.playerIndex === pi).length
      );
      return addLog(
        { ...state, phase: 'playing', activePlayer: state.initiativePlayer, startingMechaCount },
        `Battle begins! ${state.playerNames[state.initiativePlayer]} has initiative.`
      );
    }

    // ── Selection / movement ────────────────────────────────
    case 'SELECT_UNIT': {
      if (state.pendingAction || state.pendingCombat) return state;
      const unit = state.units.find(u => u.id === action.unitId);
      if (!unit || unit.playerIndex !== state.activePlayer || unit.activated) return state;
      const phase = PLAY_PHASES[state.phaseIndex];
      if (!phase.types.includes(unit.typeId)) return state;
      const units = unit.hasJumped
        ? state.units.map(u => u.id === action.unitId ? { ...u, hasJumped: false } : u)
        : state.units;
      return { ...state, selectedUnitId: action.unitId, units };
    }

    case 'DESELECT_UNIT': {
      if (state.pendingCombat) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      const hasMoved = state.pendingAction?.moved === true;
      const hasFired = (unit?.firedWeaponKeys?.length ?? 0) > 0;
      if (unit && (hasMoved || hasFired)) {
        return commitActivation(state, unit);
      }
      return { ...state, selectedUnitId: null, pendingAction: null };
    }

    case 'START_ACTION': {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit) return state;
      const { action: act } = action;

      if (act === 'hold') {
        const units = state.units.map(u =>
          u.id === unit.id ? { ...u, activated: true, heldAction: true } : u
        );
        return advancePhaseIfDone(addLog(
          { ...state, units, selectedUnitId: null, pendingAction: null },
          `${unit.name} (P${unit.playerIndex + 1}) holds.`
        ));
      }

      const unitType = UNIT_TYPES[unit.typeId];

      if (act === 'ram') {
        const sp = unitType.cruise + (hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'highTunedEngine') ? 2 : 0);
        const updatedUnits = state.units.map(u => u.id === unit.id ? { ...u, hasCruised: true } : u);
        const unitSnapshot = { q: unit.q, r: unit.r, facing: unit.facing, hasCruised: unit.hasCruised, carryingObjective: unit.carryingObjective };
        return { ...state, units: updatedUnits, pendingAction: { action: 'ram', remainingMoves: sp, moved: false, unitSnapshot, objectivesSnapshot: state.objectives } };
      }

      let sp = act === 'cruise' ? unitType.cruise : unitType.move;

      // High Tuned Engine: +1 move, +2 cruise
      if (hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'highTunedEngine')) {
        sp += act === 'cruise' ? 2 : 1;
      }

      const updatedUnits = act === 'cruise'
        ? state.units.map(u => u.id === unit.id ? { ...u, hasCruised: true } : u)
        : state.units;

      const isJumping = act === 'move' && !!action.isJumping &&
        hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'boostJets');
      const jumpStartElevation = isJumping
        ? (state.terrain[hexKey(unit.q, unit.r)]?.elevation ?? 0) : undefined;

      const unitSnapshot = { q: unit.q, r: unit.r, facing: unit.facing, hasCruised: unit.hasCruised, carryingObjective: unit.carryingObjective };

      return {
        ...state,
        units: updatedUnits,
        pendingAction: { action: act, remainingMoves: sp, moved: false, isJumping, jumpStartElevation, unitSnapshot, objectivesSnapshot: state.objectives },
      };
    }

    case 'STEP_MOVE': {
      const pa = state.pendingAction;
      if (!pa || pa.remainingMoves == null || pa.remainingMoves <= 0) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit) return state;

      const isForward = action.direction === 'forward';
      const facingDir = isForward ? unit.facing : (unit.facing + 3) % 6;
      const dest = hexNeighborAt(unit.q, unit.r, facingDir);
      const { q: nq, r: nr } = dest;

      if (!inBounds(nq, nr)) return state;

      let cost = isForward ? 1 : 2;
      if (pa.isJumping) {
        // Jump: fly over occupied hexes, all terrain, and elevation restrictions
      } else {
        const occ = occupiedSetExcluding(state.units, unit.id);
        if (occ.has(hexKey(nq, nr))) return state;
        const t = state.terrain[hexKey(nq, nr)];
        if (t?.type === 'blocking') return state;
        if (t?.type === 'difficult') cost++;
        const fromEl = state.terrain[hexKey(unit.q, unit.r)]?.elevation ?? 0;
        const toEl   = t?.elevation ?? 0;
        const elDiff = toEl - fromEl;
        if (elDiff > 1) return state;
        if (elDiff > 0) cost += elDiff;
      }

      if (cost > pa.remainingMoves) return state;

      const newRemaining = pa.remainingMoves - cost;
      const newUnits = state.units.map(u => u.id === unit.id ? { ...u, q: nq, r: nr } : u);
      const newPa = newRemaining > 0
        ? { ...pa, remainingMoves: newRemaining, moved: true }
        : { action: pa.action, moved: true, unitSnapshot: pa.unitSnapshot, objectivesSnapshot: pa.objectivesSnapshot };

      let newState = { ...state, units: newUnits, pendingAction: newPa };

      // Carry isJumping/jumpStartElevation into newPa so subsequent steps still know we're jumping
      if (pa.isJumping && newRemaining > 0) {
        newState = { ...newState, pendingAction: { ...newPa, isJumping: true, jumpStartElevation: pa.jumpStartElevation } };
      }

      // Pick up any objective on the destination hex
      const pickup = newState.objectives.find(o => o.carrierId == null && o.q === nq && o.r === nr);
      if (pickup) {
        newState = addLog(
          { ...newState, objectives: newState.objectives.map(o =>
            (o.q === nq && o.r === nr && o.carrierId == null) ? { ...o, carrierId: unit.id } : o
          )},
          `${unit.name} picks up an objective!`
        );
      }

      // Jump landing: if SP exhausted mid-jump, apply landing effects
      if (pa.isJumping && newRemaining <= 0) return endJump(newState);

      return newState;
    }

    case 'STEP_TURN': {
      const pa = state.pendingAction;
      if (!pa || pa.remainingMoves == null || pa.remainingMoves <= 0) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit) return state;

      const newFacing = action.dir === 'left' ? (unit.facing + 1) % 6 : (unit.facing + 5) % 6;
      const newUnits  = state.units.map(u => u.id === unit.id ? { ...u, facing: newFacing } : u);

      if (pa.isJumping) {
        // Turning during a jump costs 0 SP — free facing
        return { ...state, units: newUnits };
      }

      const newRemaining = pa.remainingMoves - 1;
      const newPa = newRemaining > 0
        ? { ...pa, remainingMoves: newRemaining }
        : { action: pa.action, moved: pa.moved, unitSnapshot: pa.unitSnapshot, objectivesSnapshot: pa.objectivesSnapshot };

      return { ...state, units: newUnits, pendingAction: newPa };
    }

    case 'END_STEP_MOVE': {
      const pa = state.pendingAction;
      if (!pa) return state;
      if (pa.isJumping && pa.moved) return endJump(state);
      return { ...state, pendingAction: { action: pa.action, moved: pa.moved } };
    }

    case 'CANCEL_MOVE': {
      const pa = state.pendingAction;
      if (!pa) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit) return state;
      const snap = pa.unitSnapshot;
      if (!snap) return { ...state, pendingAction: null };
      const newUnits = state.units.map(u =>
        u.id === unit.id
          ? { ...u, q: snap.q, r: snap.r, facing: snap.facing, hasCruised: snap.hasCruised, carryingObjective: snap.carryingObjective }
          : u
      );
      return { ...state, units: newUnits, objectives: pa.objectivesSnapshot ?? state.objectives, pendingAction: null };
    }

    case 'END_ACTIVATION': {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit || state.pendingCombat) return state;
      return commitActivation(state, unit);
    }

    // ── Combat ──────────────────────────────────────────────
    case 'START_SHOOT': {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit || unit.hasCruised || state.pendingCombat) return state;
      const firedKeys = unit.firedWeaponKeys ?? [];
      const weapons = getEquippedWeapons(unit.armyUnit, unit.slotDamage)
        .filter(w => !w.disabled && !firedKeys.includes(w.key));
      if (weapons.length === 0) return state;
      return { ...state, pendingCombat: makeCombatState(unit.id, weapons) };
    }

    case 'SELECT_WEAPON': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'weapon-select') return state;
      const weaponEntry = pc.weaponList[action.weaponIdx];
      if (!weaponEntry) return state;
      const attacker = state.units.find(u => u.id === pc.attackerId);
      const validTargets = state.units
        .filter(u => u.playerIndex !== attacker.playerIndex && !u.destroyed && !u.surrendered)
        .filter(enemy => canWeaponTarget(attacker, enemy, weaponEntry.weapon, state.terrain))
        .map(u => u.id);
      return { ...state, pendingCombat: { ...pc, step: 'target-select', selectedWeaponIdx: action.weaponIdx, validTargets } };
    }

    case 'CANCEL_SHOOT':
      return { ...state, pendingCombat: null };

    case 'SELECT_COMBAT_TARGET': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'target-select' || !pc.validTargets.includes(action.targetId)) return state;
      return { ...state, pendingCombat: { ...pc, step: 'hit-roll', targetId: action.targetId } };
    }

    case 'ROLL_HIT_DICE': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'hit-roll') return state;

      const weapon = pc.weaponList[pc.selectedWeaponIdx].weapon;
      const attacker = state.units.find(u => u.id === pc.attackerId);
      const target = state.units.find(u => u.id === pc.targetId);

      const coverPenalty = getCoverPenalty(target, attacker, state.terrain);
      const isIndirect = weapon.special?.includes('Indirect') || !!attacker.hasJumped;
      const hasMoved = !!state.pendingAction?.moved;
      let att = weapon.att - coverPenalty;
      if (isIndirect && hasMoved) att--;
      att = Math.max(1, att);

      const rolls = rollDice(att);
      let newState = state;

      if (coverPenalty > 0) {
        newState = addLog(newState, `${target.name} is in cover: −${coverPenalty} att die.`);
      }

      const evaThresholdForLog = parseStatValue(UNIT_TYPES[target.typeId].eva);
      const hitsForLog = countSuccesses(rolls, evaThresholdForLog);
      newState = addLog(newState, `${attacker.name} fires ${weapon.name} at ${target.name}: [${rolls.join(', ')}] → ${hitsForLog} hit${hitsForLog !== 1 ? 's' : ''}`);

      // Overheating: 1s on the hit roll wound the attacker
      // Heat Sinks cancel up to 3 total overheat results per activation (tracked via heatSinkCanceled)
      if (weapon.special?.includes('Overheating')) {
        const overheats = countOverheats(rolls);
        if (overheats > 0) {
          const hasHS = hasActiveUpgrade(attacker.armyUnit, attacker.slotDamage, 'heatSinks');
          const budgetUsed = attacker.heatSinkCanceled ?? 0;
          const budgetRemaining = hasHS ? Math.max(0, 3 - budgetUsed) : 0;
          const canceled = Math.min(overheats, budgetRemaining);
          const wounds = overheats - canceled;
          if (canceled > 0) {
            const newBudgetUsed = budgetUsed + canceled;
            newState = {
              ...newState,
              units: newState.units.map(u => u.id === attacker.id
                ? { ...u, heatSinkCanceled: newBudgetUsed }
                : u),
            };
            const remaining = 3 - newBudgetUsed;
            newState = addLog(newState,
              `${attacker.name} Heat Sinks absorb ${canceled} overheat${canceled > 1 ? 's' : ''} (${remaining} budget left).`);
          }
          if (wounds > 0) {
            newState = addLog(newState, `${attacker.name} suffers ${wounds} overheat wound${wounds > 1 ? 's' : ''}! (assigned after target damage)`);
            // Store wounds; don't interrupt the hit flow — overheat resolved after defender assigns damage
            return { ...newState, pendingCombat: { ...pc, hitRolls: rolls, coverPenalty, pendingOverheatWounds: wounds } };
          }
        }
      }

      return { ...newState, pendingCombat: { ...pc, hitRolls: rolls, coverPenalty } };
    }

    case 'ADVANCE_HIT': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'hit-roll' || pc.hitRolls.length === 0) return state;
      const target = state.units.find(u => u.id === pc.targetId);
      const evaThreshold = parseStatValue(UNIT_TYPES[target.typeId].eva);
      const hits = countSuccesses(pc.hitRolls, evaThreshold);
      const weapon = pc.weaponList[pc.selectedWeaponIdx].weapon;
      if (hits === 0) {
        return transitionOrOverheat(
          addLog(state, `${weapon.name} misses ${target.name}! (0 hits)`),
          { hits: 0, netDamage: 0, remainingDamage: 0 }
        );
      }
      return { ...state, pendingCombat: { ...pc, step: 'block-roll', hits } };
    }

    case 'ROLL_BLOCK_DICE': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'block-roll' || pc.hits === 0) return state;
      return { ...state, pendingCombat: { ...pc, blockRolls: rollDice(pc.hits) } };
    }

    case 'ADVANCE_BLOCK': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'block-roll' || pc.blockRolls.length === 0) return state;

      const target = state.units.find(u => u.id === pc.targetId);
      const attacker = state.units.find(u => u.id === pc.attackerId);
      const weapon = pc.weaponList[pc.selectedWeaponIdx].weapon;
      const strPenalty = parseStatValue(pc.weaponList[pc.selectedWeaponIdx].weapon.str);
      const blockThreshold = parseStatValue(UNIT_TYPES[target.typeId].tou) + strPenalty;
      const blocks = countSuccesses(pc.blockRolls, blockThreshold);
      const netHits = pc.hits - blocks;
      const totalDamage = netHits * damagePerHit(weapon);

      if (totalDamage === 0) {
        return transitionOrOverheat(
          addLog(state, `${target.name} blocks all hits from ${weapon.name} [${pc.blockRolls.join(', ')}] — ${blocks}/${pc.hits} saved. No damage!`),
          { blocks, netDamage: 0, remainingDamage: 0 }
        );
      }

      // Collect Blast targets (units within 2 hexes of the target)
      const blastTargetIds = weapon.special?.includes('Blast')
        ? state.units.filter(u =>
            u.id !== target.id && !u.destroyed && !u.surrendered &&
            hexDistance(u.q, u.r, target.q, target.r) <= 2
          ).map(u => u.id)
        : [];

      const available = getAllSlots(target.armyUnit, target.slotDamage).filter(s => !s.disabled);

      if (available.length === 0) {
        const newUnits = state.units.map(u => u.id === target.id ? { ...u, destroyed: true } : u);
        return checkAnnihilation(transitionOrOverheat(
          addLog({ ...state, units: newUnits }, `${target.name} is destroyed by ${attacker.name}'s ${weapon.name}!`),
          { blocks, netDamage: totalDamage, remainingDamage: 0, blastTargetIds }
        ));
      }

      const logMsg = `${target.name} blocks [${pc.blockRolls.join(', ')}] — ${blocks}/${pc.hits} saved. ${weapon.name} deals ${totalDamage} damage.`;
      if (hasActiveUpgrade(target.armyUnit, target.slotDamage, 'experimentalArmor')) {
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'exp-armor-roll', blocks, netDamage: totalDamage, remainingDamage: totalDamage, blastTargetIds, expArmorRolls: [], expArmorNextStep: 'damage-assign' } },
          logMsg
        );
      }
      return addLog(
        { ...state, pendingCombat: { ...pc, step: 'damage-assign', blocks, netDamage: totalDamage, remainingDamage: totalDamage, blastTargetIds } },
        logMsg
      );
    }

    case 'ADVANCE_OVERHEAT': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'overheat-result') return state;
      return { ...state, pendingCombat: { ...pc, step: 'overheat-assign' } };
    }

    case 'ROLL_EXP_ARMOR_DICE': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'exp-armor-roll' || pc.expArmorRolls.length > 0) return state;
      return { ...state, pendingCombat: { ...pc, expArmorRolls: rollDice(pc.remainingDamage) } };
    }

    case 'ADVANCE_EXP_ARMOR': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'exp-armor-roll' || pc.expArmorRolls.length === 0) return state;
      const saves = pc.expArmorRolls.filter(v => v >= 5).length;
      const netDamage = pc.remainingDamage - saves;
      const expTarget = state.units.find(u => u.id === pc.targetId);
      const expRammer = state.units.find(u => u.id === pc.rammerId);
      const saveLabel = saves > 0 ? `${saves} saved` : 'none saved';

      if (pc.expArmorNextStep === 'damage-assign') {
        const logText = `${expTarget?.name}'s Experimental Armor: [${pc.expArmorRolls.join(', ')}] — ${saveLabel}. ${netDamage} damage gets through.`;
        if (netDamage <= 0) {
          return checkAnnihilation(transitionOrOverheat(addLog(state, logText), { remainingDamage: 0, netDamage: 0 }));
        }
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'damage-assign', remainingDamage: netDamage, netDamage } },
          logText
        );
      }

      if (pc.expArmorNextStep === 'ram-damage-target') {
        const logText = `${expTarget?.name}'s Experimental Armor: [${pc.expArmorRolls.join(', ')}] — ${saveLabel}. ${netDamage} damage gets through.`;
        if (netDamage <= 0) {
          const rammerUnit = state.units.find(u => u.id === pc.rammerId);
          if (pc.rammerTakes > 0 && rammerUnit && !rammerUnit.destroyed) {
            const hasRammerExp = hasActiveUpgrade(rammerUnit.armyUnit, rammerUnit.slotDamage, 'experimentalArmor');
            const newPc = hasRammerExp
              ? { ...pc, step: 'exp-armor-roll', remainingDamage: pc.rammerTakes, expArmorRolls: [], expArmorNextStep: 'ram-damage-rammer', lockedUpgradeKey: null }
              : { ...pc, step: 'ram-damage-rammer', remainingDamage: pc.rammerTakes, lockedUpgradeKey: null };
            return addLog({ ...state, pendingCombat: newPc }, logText);
          }
          return startRamPushOrEnd(addLog(state, logText), pc.rammerId, pc.targetId, pc.targetTypeId, pc.rammerTakes, pc.targetTakes);
        }
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'ram-damage-target', remainingDamage: netDamage } },
          logText
        );
      }

      if (pc.expArmorNextStep === 'ram-damage-rammer') {
        const logText = `${expRammer?.name}'s Experimental Armor: [${pc.expArmorRolls.join(', ')}] — ${saveLabel}. ${netDamage} damage gets through.`;
        if (netDamage <= 0) {
          return startRamPushOrEnd(addLog(state, logText), pc.rammerId, pc.targetId, pc.targetTypeId, pc.rammerTakes, pc.targetTakes);
        }
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'ram-damage-rammer', remainingDamage: netDamage } },
          logText
        );
      }

      return state;
    }

    case 'DISMISS_MORALE': {
      if (!state.pendingMorale) return state;
      const s = { ...state, pendingMorale: null };
      const newRound = s.round + 1;
      if (newRound > 4) return addLog({ ...s, phase: 'over' }, 'Game over after 4 rounds!');
      return startNextRound(s, newRound);
    }

    case 'ASSIGN_DAMAGE': {
      const pc = state.pendingCombat;
      if (!pc || (pc.step !== 'damage-assign' && pc.step !== 'overheat-assign' &&
                  pc.step !== 'ram-damage-rammer' && pc.step !== 'ram-damage-target')) return state;

      // Overheat: player assigns damage to their own attacker
      if (pc.step === 'overheat-assign') {
        const { slotKey } = action;
        if (pc.lockedUpgradeKey && pc.lockedUpgradeKey !== slotKey) return state;
        const result = applyOneDamage(state, pc.attackerId, slotKey, { destroySuffix: ' by overheat' });
        if (!result) return state;
        const { newState, newUnits, unitDestroyed, newLocked } = result;
        const newRemaining = pc.overheatRemaining - 1;
        return checkAnnihilation({
          ...newState,
          units: newUnits,
          pendingCombat: {
            ...pc,
            overheatRemaining: newRemaining,
            lockedUpgradeKey: newLocked,
            step: unitDestroyed || newRemaining <= 0 ? 'done' : 'overheat-assign',
          },
        });
      }

      // ── Ram damage assignment (rammer or target) ───────────────────────────
      if (pc.step === 'ram-damage-rammer' || pc.step === 'ram-damage-target') {
        const isRammer  = pc.step === 'ram-damage-rammer';
        const damagedId = isRammer ? pc.rammerId : pc.targetId;
        if (!state.units.find(u => u.id === damagedId && !u.destroyed)) return state;
        const { slotKey } = action;
        if (pc.lockedUpgradeKey && pc.lockedUpgradeKey !== slotKey) return state;

        const result = applyOneDamage(state, damagedId, slotKey);
        if (!result) return state;
        const { newState, newUnits, unitDestroyed, newLocked } = result;
        const newRemaining = pc.remainingDamage - 1;
        if (newRemaining > 0 && !unitDestroyed) {
          return { ...newState, units: newUnits, pendingCombat: { ...newState.pendingCombat, remainingDamage: newRemaining, lockedUpgradeKey: newLocked } };
        }
        const afterCheck = checkAnnihilation({ ...newState, units: newUnits });
        if (afterCheck.phase === 'over') return afterCheck;
        if (!isRammer) {
          const rammerUnit = afterCheck.units.find(u => u.id === pc.rammerId);
          if (pc.rammerTakes > 0 && rammerUnit && !rammerUnit.destroyed) {
            const hasRammerExp = hasActiveUpgrade(rammerUnit.armyUnit, rammerUnit.slotDamage, 'experimentalArmor');
            if (hasRammerExp) {
              return { ...afterCheck, pendingCombat: { ...afterCheck.pendingCombat, step: 'exp-armor-roll', remainingDamage: pc.rammerTakes, expArmorRolls: [], expArmorNextStep: 'ram-damage-rammer', lockedUpgradeKey: null } };
            }
            return { ...afterCheck, pendingCombat: { ...afterCheck.pendingCombat, step: 'ram-damage-rammer', remainingDamage: pc.rammerTakes, lockedUpgradeKey: null } };
          }
        }
        return startRamPushOrEnd(afterCheck, pc.rammerId, pc.targetId, pc.targetTypeId, pc.rammerTakes, pc.targetTakes);
      }

      // ── Normal damage assignment ────────────────────────────────────────────
      const target = state.units.find(u => u.id === pc.targetId);
      if (!target) return state;
      const { slotKey } = action;
      if (pc.lockedUpgradeKey && pc.lockedUpgradeKey !== slotKey) return state;
      const [loc, idxStr] = slotKey.split(':');
      const upgradeId = target.armyUnit.slots[loc]?.[Number(idxStr)];
      if (!upgradeId) return state;

      // Ammo Box: first time in round target's Ammo Box weapon takes damage
      const isAmmoBox = ALL_UPGRADES[upgradeId]?.special?.includes('Ammo Box');
      let extraDamage = 0;
      let preState = state;
      if (isAmmoBox && !target.ammoBoxDamaged) {
        extraDamage = 1;
        preState = addLog(preState, `Ammo Box! ${ALL_UPGRADES[upgradeId].name} takes +1 extra damage!`);
      }

      const result = applyOneDamage(preState, pc.targetId, slotKey, { extraDamage });
      if (!result) return state;
      const { newState, newUnits, unitDestroyed, newLocked } = result;

      let finalUnits = newUnits;
      if (isAmmoBox && extraDamage > 0) {
        finalUnits = finalUnits.map(u => u.id === target.id ? { ...u, ammoBoxDamaged: true } : u);
      }

      const newRemaining = preState.pendingCombat.remainingDamage - 1;
      if (newRemaining <= 0 || unitDestroyed) {
        return checkAnnihilation(transitionOrOverheat(
          { ...newState, units: finalUnits },
          { remainingDamage: newRemaining, lockedUpgradeKey: newLocked }
        ));
      }
      return checkAnnihilation({
        ...newState,
        units: finalUnits,
        pendingCombat: { ...newState.pendingCombat, remainingDamage: newRemaining, lockedUpgradeKey: newLocked, step: 'damage-assign' },
      });
    }

    case 'FINISH_COMBAT': {
      const pc = state.pendingCombat;
      if (!pc) return state;
      const attacker = state.units.find(u => u.id === pc.attackerId);
      if (!attacker) return { ...state, pendingCombat: null };

      const firedKey = pc.weaponList[pc.selectedWeaponIdx]?.key;
      const newFiredKeys = firedKey ? [...(attacker.firedWeaponKeys ?? []), firedKey] : attacker.firedWeaponKeys;

      let newState = {
        ...state,
        units: state.units.map(u => u.id === attacker.id ? { ...u, firedWeaponKeys: newFiredKeys } : u),
        pendingCombat: null,
      };

      // Blast: auto-apply damage to units within 2 hexes of primary target
      if (pc.blastTargetIds?.length > 0 && pc.hits > 0) {
        const weapon = pc.weaponList[pc.selectedWeaponIdx]?.weapon;
        const dpH = weapon ? damagePerHit(weapon) : 1;
        const names = [];
        for (const blastId of pc.blastTargetIds) {
          const bt = newState.units.find(u => u.id === blastId);
          if (!bt || bt.destroyed) continue;
          names.push(bt.name);
          const { units: afterBlast, objectives: afterBlastObj, logs } = autoAssignDamage(newState.units, newState.objectives, blastId, dpH);
          newState = { ...newState, units: afterBlast, objectives: afterBlastObj };
          for (const l of logs) newState = addLog(newState, l);
        }
        if (names.length > 0) newState = addLog(newState, `Blast! ${names.join(', ')} hit for ${dpH}.`);
      }

      // If attacker still has unfired, non-disabled weapons, loop back to weapon selection
      const updatedAttacker = newState.units.find(u => u.id === pc.attackerId);
      if (updatedAttacker && !updatedAttacker.destroyed) {
        const remaining = getEquippedWeapons(updatedAttacker.armyUnit, updatedAttacker.slotDamage)
          .filter(w => !w.disabled && !newFiredKeys.includes(w.key));
        if (remaining.length > 0) {
          newState = { ...newState, pendingCombat: makeCombatState(pc.attackerId, remaining) };
        }
      }

      return checkAnnihilation(newState);
    }

    // ── Ramming ─────────────────────────────────────────────
    case 'EXECUTE_RAM': {
      const { targetId } = action;
      const rammer = state.units.find(u => u.id === state.selectedUnitId);
      const target  = state.units.find(u => u.id === targetId);
      if (!rammer || !target || target.destroyed || target.surrendered) return state;

      const { rammerTakes, targetTakes } = calcRamDamage(rammer, target);

      const newState = addLog(
        { ...state, pendingAction: null },
        `${rammer.name} rams ${target.name}! Assign ${targetTakes} damage to ${target.name}, then ${rammerTakes} to ${rammer.name}.`
      );

      // Both sides take 0 damage (edge case) — skip straight to push
      if (rammerTakes === 0 && targetTakes === 0) {
        return startRamPushOrEnd(newState, rammer.id, target.id, target.typeId, rammerTakes, targetTakes);
      }

      // Defender (target) assigns damage first, then rammer takes self-inflicted damage
      const targetHasExpArmor = targetTakes > 0 && hasActiveUpgrade(target.armyUnit, target.slotDamage, 'experimentalArmor');
      const rammerHasExpArmor = targetTakes === 0 && rammerTakes > 0 && hasActiveUpgrade(rammer.armyUnit, rammer.slotDamage, 'experimentalArmor');
      const firstRemaining = targetTakes > 0 ? targetTakes : rammerTakes;
      const firstStep = targetHasExpArmor ? 'exp-armor-roll'
        : targetTakes > 0                 ? 'ram-damage-target'
        : rammerHasExpArmor               ? 'exp-armor-roll'
        :                                   'ram-damage-rammer';
      const expArmorNextStep = targetTakes > 0 ? 'ram-damage-target' : 'ram-damage-rammer';

      return {
        ...newState,
        pendingCombat: {
          step: firstStep,
          rammerId: rammer.id,
          targetId,
          targetTypeId: target.typeId,
          rammerTakes,
          targetTakes,
          remainingDamage: firstRemaining,
          lockedUpgradeKey: null,
          expArmorRolls: firstStep === 'exp-armor-roll' ? [] : undefined,
          expArmorNextStep: firstStep === 'exp-armor-roll' ? expArmorNextStep : undefined,
        },
      };
    }

    case 'RESOLVE_RAM_PUSH': {
      const pc = state.pendingCombat;
      if (!pc || pc.step !== 'ram-push') return state;
      const { q, r } = action;
      if (!pc.validPushHexes.some(h => h.q === q && h.r === r)) return state;

      const pushedUnit = state.units.find(u => u.id === pc.pushedUnitId);
      if (!pushedUnit) return state;

      const pushedOriginQ = pushedUnit.q;
      const pushedOriginR = pushedUnit.r;

      const newUnits = state.units.map(u => {
        const isRammer = u.id === pc.rammerId;
        if (u.id === pc.pushedUnitId) return { ...u, q, r, activated: isRammer ? true : u.activated };
        if (!pc.rammerPushed && isRammer) return { ...u, q: pushedOriginQ, r: pushedOriginR, activated: true };
        if (isRammer) return { ...u, activated: true };
        return u;
      });

      return advancePhaseIfDone(addLog(
        { ...state, units: newUnits, selectedUnitId: null, pendingAction: null, pendingCombat: null },
        `${pushedUnit.name} pushed to ${q},${r}.`
      ));
    }

    default:
      return state;
  }
}

// ── Online helper ───────────────────────────────────────────────────────────
// Builds a game state that is already past terrain + objective setup, ready
// for deployment. Used by the server so online games skip the manual phases.

const OBJ_MIN_ROW  = 6;
const OBJ_MAX_ROW  = BOARD_ROWS - 7;
const OBJ_MIN_DIST = 3;

function findValidObjectiveHex(terrain, objectives) {
  const candidates = [];
  for (let r = OBJ_MIN_ROW; r <= OBJ_MAX_ROW; r++) {
    for (let q = 0; q < BOARD_COLS; q++) {
      if (terrain[hexKey(q, r)]?.type === 'blocking') continue;
      if (objectives.some(o => hexDistance(q, r, o.q, o.r) <= OBJ_MIN_DIST)) continue;
      candidates.push({ q, r });
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function buildOnlineInitialState(playerNames, armies) {
  let state = buildInitialState(playerNames, armies);
  state = gameReducer(state, { type: 'RANDOMIZE_TERRAIN' });
  state = gameReducer(state, { type: 'FINISH_TERRAIN' });
  while (state.phase === 'objective-setup') {
    const hex = findValidObjectiveHex(state.terrain, state.objectives);
    if (!hex) break;
    state = gameReducer(state, { type: 'PLACE_OBJECTIVE', q: hex.q, r: hex.r });
  }
  return state;
}
