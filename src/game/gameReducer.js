import { UNIT_TYPES, ALL_UPGRADES } from '../data/gameData';
import { hexKey, hexDistance, isDeployZone, hexNeighborAt, hexNeighbors, inBounds, BOARD_COLS, BOARD_ROWS } from './hexMath';
import {
  getEquippedWeapons, canWeaponTarget, rollDice,
  countSuccesses, countOverheats, parseStatValue,
  damagePerHit, getAllSlots, damageThreshold, isUnitDestroyed,
  hasActiveUpgrade, getCoverPenalty,
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

function dropCarriedObjectives(objectives, unitId, q, r, logs) {
  const carried = objectives.filter(o => o.carrierId === unitId);
  if (carried.length === 0) return objectives;
  logs.push(`An objective is dropped at ${q},${r}!`);
  return objectives.map(o => o.carrierId === unitId ? { ...o, carrierId: null, q, r } : o);
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
    const newInitiative = 1 - state.initiativePlayer;
    const resetUnits = state.units.map(u => ({
      ...u, activated: false, heldAction: false,
      firedWeaponKeys: [], hasCruised: false, heatSinkCanceled: 0, ammoBoxDamaged: false,
    }));
    const roundStartState = addLog(
      { ...state, round: newRound, phaseIndex: 0, initiativePlayer: newInitiative, activePlayer: newInitiative, units: resetUnits },
      `Round ${newRound} begins. ${state.playerNames[newInitiative]} has initiative.`
    );
    // Skip any phases that have no living units (same as game-start logic)
    return advancePhaseIfDone(roundStartState);
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

      const newUnit = makeGameUnit(army.units[unitIdx], pIdx, q, r, pIdx === 0 ? 5 : 2);
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

    case 'START_GAME':
      return addLog({ ...state, phase: 'playing', activePlayer: state.initiativePlayer },
        `Battle begins! ${state.playerNames[state.initiativePlayer]} has initiative.`);

    // ── Selection / movement ────────────────────────────────
    case 'SELECT_UNIT': {
      if (state.pendingAction || state.pendingCombat) return state;
      const unit = state.units.find(u => u.id === action.unitId);
      if (!unit || unit.playerIndex !== state.activePlayer || unit.activated) return state;
      const phase = PLAY_PHASES[state.phaseIndex];
      if (!phase.types.includes(unit.typeId)) return state;
      return { ...state, selectedUnitId: action.unitId };
    }

    case 'DESELECT_UNIT': {
      if (state.pendingCombat) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      const hasMoved = state.pendingAction?.moved === true;
      const hasFired = (unit?.firedWeaponKeys?.length ?? 0) > 0;
      if (unit && (hasMoved || hasFired)) {
        // Unit already spent resources — commit activation so SP can't be reclaimed
        const moved = state.pendingAction?.action === 'move';
        const cruised = state.pendingAction?.action === 'cruise';
        const shot = hasFired;
        const verb = cruised ? 'cruise' : moved && shot ? 'move and shoot' : moved ? 'move' : shot ? 'shoot' : 'hold';
        const units = state.units.map(u => u.id === unit.id ? { ...u, activated: true } : u);
        return advancePhaseIfDone(addLog(
          { ...state, units, selectedUnitId: null, pendingAction: null },
          `${unit.name} (P${unit.playerIndex + 1}) ${verb}s.`
        ));
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
      let sp = act === 'cruise' ? unitType.cruise : unitType.move;

      // High Tuned Engine: +1 move, +2 cruise
      if (hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'highTunedEngine')) {
        sp += act === 'cruise' ? 2 : 1;
      }

      const updatedUnits = act === 'cruise'
        ? state.units.map(u => u.id === unit.id ? { ...u, hasCruised: true } : u)
        : state.units;

      return { ...state, units: updatedUnits, pendingAction: { action: act, remainingMoves: sp, moved: false } };
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
      const occ = occupiedSet(state.units);
      occ.delete(hexKey(unit.q, unit.r));
      if (occ.has(hexKey(nq, nr))) return state;

      const t = state.terrain[hexKey(nq, nr)];
      if (t?.type === 'blocking') return state;

      let cost = isForward ? 1 : 2;
      if (t?.type === 'difficult') cost++;
      const fromEl = state.terrain[hexKey(unit.q, unit.r)]?.elevation ?? 0;
      const toEl = t?.elevation ?? 0;
      const elDiff = toEl - fromEl;
      if (elDiff > 1) return state;
      if (elDiff > 0) cost += elDiff;

      if (cost > pa.remainingMoves) return state;

      const newRemaining = pa.remainingMoves - cost;
      const newUnits = state.units.map(u => u.id === unit.id ? { ...u, q: nq, r: nr } : u);
      const newPa = newRemaining > 0
        ? { ...pa, remainingMoves: newRemaining, moved: true }
        : { action: pa.action, moved: true };

      let newState = { ...state, units: newUnits, pendingAction: newPa };

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

      return newState;
    }

    case 'STEP_TURN': {
      const pa = state.pendingAction;
      if (!pa || pa.remainingMoves == null || pa.remainingMoves <= 0) return state;
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit) return state;

      const newFacing = action.dir === 'left' ? (unit.facing + 1) % 6 : (unit.facing + 5) % 6;
      const newRemaining = pa.remainingMoves - 1;
      const newUnits = state.units.map(u => u.id === unit.id ? { ...u, facing: newFacing } : u);
      const newPa = newRemaining > 0
        ? { ...pa, remainingMoves: newRemaining }
        : { action: pa.action, moved: pa.moved };

      return { ...state, units: newUnits, pendingAction: newPa };
    }

    case 'END_STEP_MOVE': {
      const pa = state.pendingAction;
      if (!pa) return state;
      return { ...state, pendingAction: { action: pa.action, moved: pa.moved } };
    }

    case 'END_ACTIVATION': {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit || state.pendingCombat) return state;
      const moved = state.pendingAction?.action === 'move';
      const cruised = state.pendingAction?.action === 'cruise';
      const shot = (unit.firedWeaponKeys?.length ?? 0) > 0;
      const verb = cruised ? 'cruise' : moved && shot ? 'move and shoot' : moved ? 'move' : shot ? 'shoot' : 'hold';
      const units = state.units.map(u => u.id === unit.id ? { ...u, activated: true } : u);
      return advancePhaseIfDone(addLog(
        { ...state, units, selectedUnitId: null, pendingAction: null },
        `${unit.name} (P${unit.playerIndex + 1}) ${verb}s.`
      ));
    }

    // ── Combat ──────────────────────────────────────────────
    case 'START_SHOOT': {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (!unit || unit.hasCruised || state.pendingCombat) return state;
      const firedKeys = unit.firedWeaponKeys ?? [];
      const weapons = getEquippedWeapons(unit.armyUnit, unit.slotDamage)
        .filter(w => !w.disabled && !firedKeys.includes(w.key));
      if (weapons.length === 0) return state;
      return {
        ...state,
        pendingCombat: {
          step: 'weapon-select',
          attackerId: unit.id,
          weaponList: weapons,
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
          lastExpArmorSave: null,
          lockedUpgradeKey: null,
        },
      };
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
      const isIndirect = weapon.special?.includes('Indirect');
      const hasMoved = !!state.pendingAction?.moved;
      let att = weapon.att - coverPenalty;
      if (isIndirect && hasMoved) att--;
      att = Math.max(1, att);

      const rolls = rollDice(att);
      let newState = state;

      if (coverPenalty > 0) {
        newState = addLog(newState, `${target.name} is in cover: −${coverPenalty} att die.`);
      }

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
            newState = addLog(newState, `${attacker.name} suffers ${wounds} overheat wound${wounds > 1 ? 's' : ''}!`);
            return {
              ...newState,
              pendingCombat: {
                ...pc,
                step: 'overheat-assign',
                hitRolls: rolls,
                coverPenalty,
                overheatRemaining: wounds,
                lockedUpgradeKey: null,
                lastExpArmorSave: null,
              },
            };
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
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'done', hits: 0, netDamage: 0, remainingDamage: 0 } },
          `${weapon.name} misses ${target.name}! (0 hits)`
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
        return addLog(
          { ...state, pendingCombat: { ...pc, step: 'done', blocks, netDamage: 0, remainingDamage: 0 } },
          `${target.name} blocks all hits from ${weapon.name}. No damage!`
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
        return checkAnnihilation(addLog(
          { ...state, units: newUnits, pendingCombat: { ...pc, step: 'done', blocks, netDamage: totalDamage, remainingDamage: 0, blastTargetIds } },
          `${target.name} is destroyed by ${attacker.name}'s ${weapon.name}!`
        ));
      }

      return addLog(
        { ...state, pendingCombat: { ...pc, step: 'damage-assign', blocks, netDamage: totalDamage, remainingDamage: totalDamage, blastTargetIds } },
        `${weapon.name} hits ${target.name} for ${totalDamage} damage. Assign damage.`
      );
    }

    case 'ASSIGN_DAMAGE': {
      const pc = state.pendingCombat;
      if (!pc || (pc.step !== 'damage-assign' && pc.step !== 'overheat-assign')) return state;

      // Overheat: player assigns damage to their own attacker
      if (pc.step === 'overheat-assign') {
        const attacker = state.units.find(u => u.id === pc.attackerId);
        if (!attacker) return state;
        const { slotKey } = action;
        if (pc.lockedUpgradeKey && pc.lockedUpgradeKey !== slotKey) return state;
        const [loc, idxStr] = slotKey.split(':');
        const upgradeId = attacker.armyUnit.slots[loc]?.[Number(idxStr)];
        if (!upgradeId) return state;
        const threshold = damageThreshold(upgradeId, attacker.typeId);
        const currentDmg = attacker.slotDamage[slotKey] ?? 0;
        if (currentDmg >= threshold) return state;
        const newDmg = Math.min(currentDmg + 1, threshold);
        const upgradeDestroyed = newDmg >= threshold;
        const newSlotDamage = { ...attacker.slotDamage, [slotKey]: newDmg };
        let newUnits = state.units.map(u =>
          u.id === attacker.id ? { ...u, slotDamage: newSlotDamage } : u
        );
        let newState = state;
        if (upgradeDestroyed) {
          newState = addLog(newState, `${attacker.name}'s ${ALL_UPGRADES[upgradeId]?.name ?? upgradeId} is destroyed by overheat!`);
        }
        const updatedAttacker = newUnits.find(u => u.id === attacker.id);
        const unitDestroyed = isUnitDestroyed(updatedAttacker.armyUnit, updatedAttacker.slotDamage);
        if (unitDestroyed) {
          newUnits = newUnits.map(u => u.id === attacker.id ? { ...u, destroyed: true } : u);
          newState = addLog(newState, `${attacker.name} is destroyed by overheat!`);
          const dropLogs = [];
          const droppedObjs = dropCarriedObjectives(newState.objectives, attacker.id, attacker.q, attacker.r, dropLogs);
          newState = { ...newState, objectives: droppedObjs };
          for (const l of dropLogs) newState = addLog(newState, l);
        }
        const newRemaining = pc.overheatRemaining - 1;
        const newLocked = upgradeDestroyed ? null : slotKey;
        return checkAnnihilation({
          ...newState,
          units: newUnits,
          pendingCombat: {
            ...pc,
            overheatRemaining: newRemaining,
            lockedUpgradeKey: newLocked,
            step: unitDestroyed ? 'done' : newRemaining <= 0 ? 'hit-roll' : 'overheat-assign',
          },
        });
      }

      const target = state.units.find(u => u.id === pc.targetId);
      if (!target) return state;

      const { slotKey } = action;

      // Enforce lock: once an upgrade is partially damaged, all remaining damage goes there
      if (pc.lockedUpgradeKey && pc.lockedUpgradeKey !== slotKey) return state;

      const [loc, idxStr] = slotKey.split(':');
      const idx = Number(idxStr);
      const upgradeId = target.armyUnit.slots[loc]?.[idx];
      if (!upgradeId) return state;

      const threshold = damageThreshold(upgradeId, target.typeId);
      const currentDmg = target.slotDamage[slotKey] ?? 0;
      if (currentDmg >= threshold) return state;

      // Experimental Armor: roll 5+ to ignore this point of damage
      const hasExpArmor = hasActiveUpgrade(target.armyUnit, target.slotDamage, 'experimentalArmor');
      if (hasExpArmor) {
        const saveRoll = rollDice(1)[0];
        if (saveRoll >= 5) {
          const newRemaining = pc.remainingDamage - 1;
          return addLog(
            {
              ...state,
              pendingCombat: {
                ...pc,
                remainingDamage: newRemaining,
                step: newRemaining <= 0 ? 'done' : 'damage-assign',
                lastExpArmorSave: { roll: saveRoll, saved: true },
              },
            },
            `${target.name}'s Experimental Armor saves! (rolled ${saveRoll})`
          );
        }
        state = { ...state, pendingCombat: { ...pc, lastExpArmorSave: { roll: saveRoll, saved: false } } };
      }

      // Ammo Box: first time in round target's Ammo Box weapon takes damage
      const isAmmoBox = ALL_UPGRADES[upgradeId]?.special?.includes('Ammo Box');
      let extraDamage = 0;
      let newState = state;
      if (isAmmoBox && !target.ammoBoxDamaged) {
        extraDamage = 1;
        newState = addLog(newState, `Ammo Box! ${ALL_UPGRADES[upgradeId].name} takes +1 extra damage!`);
      }

      const newDmg = Math.min(currentDmg + 1 + extraDamage, threshold);
      const upgradeDestroyed = newDmg >= threshold;
      const newSlotDamage = { ...target.slotDamage, [slotKey]: newDmg };
      let newUnits = newState.units.map(u =>
        u.id === target.id ? { ...u, slotDamage: newSlotDamage, ammoBoxDamaged: u.ammoBoxDamaged || (isAmmoBox && extraDamage > 0) } : u
      );

      if (upgradeDestroyed) {
        newState = addLog(newState, `${target.name}'s ${ALL_UPGRADES[upgradeId]?.name ?? upgradeId} is destroyed!`);
      }

      const updatedTarget = newUnits.find(u => u.id === target.id);
      const unitDestroyed = isUnitDestroyed(updatedTarget.armyUnit, updatedTarget.slotDamage);
      if (unitDestroyed) {
        newUnits = newUnits.map(u => u.id === target.id ? { ...u, destroyed: true } : u);
        newState = addLog(newState, `${target.name} is destroyed!`);
        const dropLogs = [];
        const droppedObjs = dropCarriedObjectives(newState.objectives, target.id, target.q, target.r, dropLogs);
        newState = { ...newState, objectives: droppedObjs };
        for (const l of dropLogs) newState = addLog(newState, l);
      }

      const newRemaining = newState.pendingCombat.remainingDamage - 1;
      // Lock clears when the upgrade is destroyed so player can pick a new one
      const newLocked = upgradeDestroyed ? null : slotKey;

      return checkAnnihilation({
        ...newState,
        units: newUnits,
        pendingCombat: {
          ...newState.pendingCombat,
          remainingDamage: newRemaining,
          lockedUpgradeKey: newLocked,
          // If the unit is fully destroyed, end assignment regardless of remaining damage
          step: (newRemaining <= 0 || unitDestroyed) ? 'done' : 'damage-assign',
        },
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
          newState = {
            ...newState,
            pendingCombat: {
              step: 'weapon-select',
              attackerId: pc.attackerId,
              weaponList: remaining,
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
              lastExpArmorSave: null,
              lockedUpgradeKey: null,
            },
          };
        }
      }

      return checkAnnihilation(newState);
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
