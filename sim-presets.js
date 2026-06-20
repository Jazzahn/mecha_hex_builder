/**
 * Named Mech Tournament — run with:
 *   npx tsx sim-presets.js [games]
 *
 * Builds armies from MECH_PRESETS grouped by faction/shop, then runs a full
 * round-robin tournament at 200 / 250 / 300 point limits.
 * Uses the same AI and game engine as sim-game.js.
 */

import { buildOnlineInitialState, gameReducer, PLAY_PHASES, effectiveSlotDamage } from './src/game/gameReducer.js';
import { UNIT_TYPES, ALL_UPGRADES, WEAPONS }                  from './src/data/gameData.js';
import { MECH_PRESETS }                                        from './src/data/mechPresets.js';
import { hexKey, hexDistance, isDeployZone, inBounds,
         BOARD_COLS, BOARD_ROWS, vectorToFacing }              from './src/game/hexMath.js';
import { getEquippedWeapons, canWeaponTarget, hasActiveUpgrade,
         getAllSlots, parseStatValue }                          from './src/game/combat.js';

// ─── CLI ──────────────────────────────────────────────────────────────────────
const GAMES_PER_MATCH = parseInt(process.argv[2]) || 100;

// ─── Faction definitions ──────────────────────────────────────────────────────
const BY_ID = Object.fromEntries(MECH_PRESETS.map(p => [p.id, p]));

const FACTIONS = {
  'Sea Fox A': [
    'dasher-ii','locust-lct7v','spider-sdr8m','jenner-iic','piranha-5','havoc-hvcp6',
    'crab-crb27b','shadow-hawk-shd7h','griffin-iic','gravedigger-gdr1d','coyotl-prime',
    'venom-sdr9ka','panther-pnt12a','jenner-jr7c3','cricket-rwn01','chimera-cma1s',
    'avatar-av1o','jenner-iic-5','black-hawk-ku-bhkuo',
  ],
  'Sea Fox B': [
    'lament-lmt2r','vulture-mkiv-prime','cyclops-cp11b','jade-hawk-jhk03','ostsol-c',
    'phoenix-hawk-iic-10','mad-cat-mkiv-prime',
    'shadow-hawk-iic-7','vapor-eagle-6','goshawk-ii-3',
    'warhammer-iic-13','omen','charger-c','rifleman-iic-9','white-raven',
  ],
  'Scrapyard Light': [
    'locust-lct3m','wasp-wsp3s','garm-grm01a','spider-sdr7k','venom-sdr9k',
    'valkyrie-vlkqd1','panther-pnt10k2','hitman-hm1','tarantula-zph4a',
    'wolfhound-wlf2','osiris-osr3d',
    'javelin-jvn12n','ostscout-ott8j','gunsmith-ch11ng',
    'wasp-wsp3a','locust-c','stinger-iic','bear-cub','baboon-baboon3','dark-crow',
  ],
  'Scrapyard Medium': [
    'assassin-asn30','centurion-cn9da','hunchback-hbk5n','vindicator-vnd3l',
    'blackjack-bj2','bushwacker-bswx1','stealth-sth1d','phoenix-hawk-pxh3k',
    'dervish-dv9d','huron-warrior-hurw0r4l','shadow-hawk-shd5d',
    'hatchetman-hct6d','enforcer-enf5r','watchman-wtc4dm','legionnaire-lgn2d',
    'cadaver-cvrt1','clint-iic',
    'griffin-grf5k','wolverine-wvr8c','wolverine-wvr8d','wolverine-wvr8k',
    'griffin-grf6s2','hatchetman-hct5k','tessen-tsnc3','exhumer-exr3p',
    'tessen-tsnc3m','fujin-rjn301f',
  ],
  'Scrapyard Heavy': [
    'jagermech-jm6dda','grand-dragon-drg5k','rifleman-rfl5d','archer-arc5r',
    'maelstrom-mtr5k','gallowglas-gal1gls','catapult-cpltc5','marauder-mad5d',
    'rakshasa-mdg1a','war-dog-wrdg02fc','falconer-flc8r',
    'argus-ags4d','ostsol-otl8e3','thanatos-tns4t',
    'caesar-ces5r','marauder-mad11d','black-knight-blknt5h',
    'bombardier-bmb12d','merlin-c',
    'archer-arc9m','warhammer-whm10k','lancelot-lnc2509',
    'gallant-glt100','inferno-infno','thanatos-tns4s','marauder-mad9w2',
    'warhammer-whm9d',
  ],
  'Scrapyard Assault': [
    'goliath-gol3m2','stalker-stk5m','battlemaster-blr3m','victor-vtr9k',
    'awesome-aws9m','longbow-lgb7v','cerberus-mrv2','charger-cgr3kr',
    'atlas-as7k','gunslinger-gun1erd',
    'mauler-mal1k','katana-crk50061','atlas-as8ke','gunslinger-gun3erd',
    'marauder-ii-mad6c',
    'victor-vtr12d','atlas-iii-as7d3','sagittaire-sgt14r','devastator-dvs11',
    'stalker-stk7d','orochi-or3k','orochi-or2i','longbow-lgb14c',
    'akuma-aku2xk','marauder-ii-mad8k','peacekeeper-pkp1b',
  ],
};

// ─── Army builder ─────────────────────────────────────────────────────────────
const UNIT_PTS = { assault: 100, heavy: 80, medium: 60, light: 40 };
const ORDER    = { assault: 4, heavy: 3, medium: 2, light: 1 };
let _uid = 1;

function buildArmy(factionName, ids, budget) {
  const presets = ids.map(id => BY_ID[id]).filter(Boolean)
    .sort((a, b) => (ORDER[b.typeId] ?? 0) - (ORDER[a.typeId] ?? 0));

  const chosen = [];
  let remaining = budget;
  for (const p of presets) {
    const cost = UNIT_PTS[p.typeId];
    if (!cost) continue; // skip non-mech presets
    if (cost <= remaining) {
      chosen.push(p);
      remaining -= cost;
    }
    if (remaining < 40) break;
  }

  if (!chosen.length) return null;
  return {
    armyName: factionName,
    units: chosen.map(p => ({
      id: _uid++,
      typeId: p.typeId,
      name: p.name + (p.model ? ` (${p.model})` : ''),
      slots: p.slots,
      heroId: null, titleId: null, aceCustomSlot: null,
    })),
  };
}

// ─── AI — copied verbatim from sim-game.js ────────────────────────────────────

function weaponED(weapon, target, dist = 99) {
  const isAccurate = weapon.special?.includes('Accurate');
  const isDeadly   = weapon.special?.includes('Deadly');
  const light      = weapon.special?.includes('Light Arms') ? 1 : 0;
  const eva  = Math.max(2, parseStatValue(UNIT_TYPES[target.typeId].eva));
  const blk  = Math.max(2, parseStatValue(UNIT_TYPES[target.typeId].tou) + weapon.str - light);
  const hitR = Math.max(0, (7 - eva) / 6);
  const blkR = Math.max(0, (7 - blk) / 6);
  const minRangePenalty = weapon.minRange && dist <= weapon.minRange ? weapon.minRange - dist + 1 : 0;
  const effectiveAtt = Math.max(1, weapon.att - minRangePenalty);
  const expectedHits    = effectiveAtt * hitR * (isAccurate ? 2 : 1);
  const expectedNetHits = expectedHits * (1 - blkR);
  const pAnyNetHit = isDeadly ? 1 - Math.pow(Math.max(0, 1 - hitR * (1 - blkR)), effectiveAtt) : 0;
  return expectedNetHits + pAnyNetHit;
}

function unitRemainingHP(unit) {
  return getAllSlots(unit.armyUnit, unit.slotDamage)
    .reduce((sum, s) => sum + Math.max(0, s.threshold - s.dmg), 0);
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

function pickDamageSlot(unit, pendingDamage, lockedKey) {
  const eff = effectiveSlotDamage(unit, pendingDamage ?? []);
  const slots = getAllSlots(unit.armyUnit, unit.slotDamage).filter(s => (eff[s.key] ?? 0) < s.threshold);
  if (lockedKey) { const l = slots.find(s => s.key === lockedKey); if (l) return l.key; }
  slots.sort((a, b) => ((eff[b.key] ?? 0) / b.threshold) - ((eff[a.key] ?? 0) / a.threshold));
  return slots[0]?.key ?? null;
}

function aiDeploy(state) {
  const pi  = state.deployPlayerIndex;
  const idx = state.deployedCount[pi];
  if (idx >= state.armies[pi].units.length) return state;
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
  if (!candidates.length) return state;
  const { q, r } = candidates[Math.floor(Math.random() * candidates.length)];
  const facing = pi === 0 ? 4 : 1;
  let s = gameReducer(state, { type: 'SELECT_DEPLOY_UNIT', index: idx });
  s     = gameReducer(s,     { type: 'DEPLOY_UNIT', q, r, facing });
  return s;
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

  const desired      = vectorToFacing(unit.q, unit.r, target.q, target.r);
  const distToTarget = hexDistance(unit.q, unit.r, target.q, target.r);
  const hasTurret    = UNIT_TYPES[unit.typeId]?.special?.includes('Turret');

  if (pa.isJumping) {
    if (distToTarget <= 1) return gameReducer(state, { type: 'END_STEP_MOVE' });
    const before  = hexKey(unit.q, unit.r);
    const moved   = gameReducer(state, { type: 'STEP_MOVE', direction: desired });
    const after   = moved.units.find(u => u.id === unit.id);
    if (hexKey(after.q, after.r) === before) return gameReducer(state, { type: 'END_STEP_MOVE' });
    if (moved.pendingAction?.action === 'jump-land') return moved;
    if (hexDistance(after.q, after.r, target.q, target.r) <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });
    return moved;
  }

  if (!hasTurret && unit.facing !== desired) {
    const L = (desired - unit.facing + 6) % 6, R = (unit.facing - desired + 6) % 6;
    return gameReducer(state, { type: 'STEP_TURN', dir: L <= R ? 'left' : 'right' });
  }

  const before = hexKey(unit.q, unit.r);
  const moved  = gameReducer(state, { type: 'STEP_MOVE', direction: 'forward' });
  const after  = moved.units.find(u => u.id === unit.id);
  if (hexKey(after.q, after.r) === before) return gameReducer(state, { type: 'END_STEP_MOVE' });
  if (hexDistance(after.q, after.r, target.q, target.r) <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });
  return moved;
}

function aiStep(state) {
  if (state.phase === 'over') return state;

  if (state.pendingMorale) return gameReducer(state, { type: 'DISMISS_MORALE' });

  if (state.phase === 'deploy') return aiDeploy(state);

  if (state.phase !== 'playing') return state;

  const pc = state.pendingCombat;
  if (pc) {
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
        if (!pc.expArmorRolls?.length) return gameReducer(state, { type: 'ROLL_EXP_ARMOR_DICE' });
        return gameReducer(state, { type: 'ADVANCE_EXP_ARMOR' });
      case 'location-roll':
        return gameReducer(state, { type: 'ROLL_LOCATION_DICE' });
      case 'overheat-result':
        return gameReducer(state, { type: 'ADVANCE_OVERHEAT' });
      case 'overheat-assign': {
        const attacker = state.units.find(u => u.id === pc.attackerId);
        const key = pickDamageSlot(attacker, state.pendingDamage, pc.lockedUpgradeKey);
        if (!key) return gameReducer(state, { type: 'ADVANCE_OVERHEAT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'damage-assign': {
        const target = state.units.find(u => u.id === pc.targetId);
        const BUFFER_IDS = ['extraArmor', 'reinforcedPlating', 'hardenedArmor'];
        const eff = effectiveSlotDamage(target, state.pendingDamage);
        const allSlots = getAllSlots(target.armyUnit, target.slotDamage).filter(s => (eff[s.key] ?? 0) < s.threshold);
        const eligible = pc.lockedLocation === 'buffer'
          ? allSlots.filter(s => BUFFER_IDS.includes(s.upgradeId))
          : pc.lockedLocation
          ? allSlots.filter(s => s.location === pc.lockedLocation)
          : allSlots;
        const pool = eligible.length > 0 ? eligible : allSlots;
        if (pc.lockedUpgradeKey) {
          const locked = pool.find(s => s.key === pc.lockedUpgradeKey);
          if (locked) return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: locked.key });
        }
        pool.sort((a, b) => ((eff[b.key] ?? 0) / b.threshold) - ((eff[a.key] ?? 0) / a.threshold));
        const key = pool[0]?.key ?? allSlots[0]?.key;
        if (!key) return gameReducer(state, { type: 'SKIP_REMAINING_DAMAGE' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }
      case 'ram-damage-target': {
        const target = state.units.find(u => u.id === pc.targetId);
        const key = pickDamageSlot(target, state.pendingDamage, pc.lockedUpgradeKey);
        const fb = getAllSlots(target.armyUnit, target.slotDamage).filter(s => (effectiveSlotDamage(target, state.pendingDamage)[s.key] ?? 0) < s.threshold)[0]?.key;
        if (!(key ?? fb)) return gameReducer(state, { type: 'SKIP_REMAINING_DAMAGE' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key ?? fb });
      }
      case 'ram-damage-rammer': {
        const rammer = state.units.find(u => u.id === pc.rammerId);
        const key = pickDamageSlot(rammer, state.pendingDamage, pc.lockedUpgradeKey);
        const fb = getAllSlots(rammer.armyUnit, rammer.slotDamage).filter(s => (effectiveSlotDamage(rammer, state.pendingDamage)[s.key] ?? 0) < s.threshold)[0]?.key;
        if (!(key ?? fb)) return gameReducer(state, { type: 'SKIP_REMAINING_DAMAGE' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key ?? fb });
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
      const t = enemies.length
        ? enemies.reduce((b, e) => hexDistance(unit.q, unit.r, e.q, e.r) < hexDistance(unit.q, unit.r, b.q, b.r) ? e : b)
        : null;
      const facing = t ? vectorToFacing(unit.q, unit.r, t.q, t.r) : unit.facing;
      return gameReducer(state, { type: 'JUMP_LAND', facing });
    }
    if (!unit.hasCruised) {
      const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
      const weapons = getEquippedWeapons(unit.armyUnit, unit.slotDamage).filter(w => !w.disabled && !unit.firedWeaponKeys?.includes(w.key));
      if (pickShot(unit, weapons, enemies, state.terrain)) return gameReducer(state, { type: 'START_SHOOT' });
    }
    return gameReducer(state, { type: 'END_ACTIVATION' });
  }

  const phase = PLAY_PHASES[state.phaseIndex];
  if (!phase) return state;
  const nextUnit = state.units.find(u =>
    !u.activated && !u.destroyed && !u.surrendered &&
    u.playerIndex === state.activePlayer &&
    phase.types.includes(u.typeId)
  );
  if (nextUnit) return gameReducer(state, { type: 'SELECT_UNIT', unitId: nextUnit.id });
  return state;
}

// ─── Run one full game ────────────────────────────────────────────────────────
const MAX_STEPS = 50_000;

function runGame(army0, army1) {
  let state = buildOnlineInitialState(['Alpha', 'Beta'], [army0, army1]);

  let deploySteps = 0;
  while (state.phase === 'deploy' && deploySteps++ < 500) state = aiDeploy(state);
  if (state.phase === 'deploy') return null;

  let steps = 0;
  while (state.phase !== 'over' && steps++ < MAX_STEPS) {
    const before = state;
    state = aiStep(state);
    if (state === before) break;
  }
  if (state.phase !== 'over') return null;

  // Determine winner from alive unit counts (flush always runs before game-over now)
  const alive = [0, 1].map(pi => state.units.filter(u => u.playerIndex === pi && !u.destroyed && !u.surrendered).length);
  let winner = -1;
  if (alive[0] > alive[1]) winner = 0;
  else if (alive[1] > alive[0]) winner = 1;
  return { winner, rounds: state.round ?? 0 };
}

// ─── Tournament ───────────────────────────────────────────────────────────────
function runTournament(factionArmies) {
  const names = Object.keys(factionArmies);
  const wins  = Object.fromEntries(names.map(n => [n, 0]));
  const played = Object.fromEntries(names.map(n => [n, 0]));
  const matchResults = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const nameA = names[i], nameB = names[j];
      const armyA = factionArmies[nameA], armyB = factionArmies[nameB];
      if (!armyA || !armyB) continue;

      let wA = 0, wB = 0, draws = 0;
      for (let g = 0; g < GAMES_PER_MATCH; g++) {
        // Reset UIDs per game so the army objects stay reusable
        const result = g % 2 === 0
          ? runGame(armyA, armyB)
          : (() => {
              const r = runGame(armyB, armyA);
              if (!r) return null;
              return { ...r, winner: r.winner === -1 ? -1 : 1 - r.winner };
            })();
        if (!result) continue;
        if (result.winner === 0) wA++;
        else if (result.winner === 1) wB++;
        else draws++;
      }
      wins[nameA]  += wA;
      wins[nameB]  += wB;
      played[nameA] += GAMES_PER_MATCH;
      played[nameB] += GAMES_PER_MATCH;
      matchResults.push({ nameA, nameB, wA, wB, draws });
    }
  }
  return { wins, played, matchResults };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(70)}`);
console.log(` NAMED MECH TOURNAMENT  —  ${GAMES_PER_MATCH} games per match`);
console.log(`${'═'.repeat(70)}\n`);

for (const budget of [200, 250, 300]) {
  console.log(`${'─'.repeat(70)}`);
  console.log(` ${budget} POINT BRACKET`);
  console.log(`${'─'.repeat(70)}`);

  const factionArmies = {};
  for (const [name, ids] of Object.entries(FACTIONS)) {
    const arm = buildArmy(name, ids, budget);
    if (arm) {
      factionArmies[name] = arm;
      const pts  = arm.units.reduce((s, u) => s + (UNIT_PTS[u.typeId] ?? 0), 0);
      const list = arm.units.map(u => `${u.name}`).join(', ');
      console.log(`  ${name.padEnd(22)} [${String(pts).padStart(3)}pts]  ${list}`);
    }
  }
  console.log('');

  process.stdout.write('  Running... ');
  const { wins, played, matchResults } = runTournament(factionArmies);
  console.log('done.\n');

  // Standings
  const standings = Object.keys(factionArmies)
    .map(n => ({ n, w: wins[n], p: played[n], wr: played[n] ? wins[n] / played[n] * 100 : 0 }))
    .sort((a, b) => b.wr - a.wr);

  console.log(`  ${'STANDINGS'.padEnd(24)} ${'W'.padStart(5)} ${'G'.padStart(5)} ${'Win%'.padStart(7)}`);
  console.log(`  ${'─'.repeat(43)}`);
  for (const { n, w, p, wr } of standings) {
    const bar = '█'.repeat(Math.round(wr / 5));
    console.log(`  ${n.padEnd(24)} ${String(w).padStart(5)} ${String(p).padStart(5)} ${wr.toFixed(1).padStart(6)}%  ${bar}`);
  }

  // Head-to-head
  console.log(`\n  HEAD-TO-HEAD (W - L - D)`);
  console.log(`  ${'─'.repeat(60)}`);
  for (const { nameA, nameB, wA, wB, draws } of matchResults) {
    const winner = wA > wB ? nameA : wB > wA ? nameB : 'Draw';
    const margin = Math.abs(wA - wB);
    console.log(`  ${nameA.padEnd(22)} vs ${nameB.padEnd(22)}  ${wA}-${wB}-${draws}  (${winner}${wA !== wB ? ` +${margin}` : ''})`);
  }
  console.log('');
}

console.log(`${'═'.repeat(70)}\n`);
