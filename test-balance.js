/**
 * Balance test harness — run with:  npx tsx test-balance.js [scenario]
 *
 * Scenarios:
 *   weapons   (default) — expected damage per activation for every weapon vs every unit class
 *   army                — head-to-head army simulation between two hardcoded lists
 *   weapon <id>         — detailed breakdown for one weapon
 */

import { WEAPONS, UNIT_TYPES } from './src/data/gameData.js';
import { rollDice, countSuccesses, damagePerHit, parseStatValue } from './src/game/combat.js';

const ITERS = 50_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function expectedDamage(weapon, targetTypeId, iters = ITERS) {
  const t = UNIT_TYPES[targetTypeId];
  const evaBase  = parseStatValue(t.eva);
  const touBase  = parseStatValue(t.tou);
  const accurate  = weapon.special?.includes('Accurate')   ? 1 : 0;
  const lightArms = weapon.special?.includes('Light Arms') ? 1 : 0;
  const evaThresh   = evaBase  - accurate;
  const blockThresh = touBase  + weapon.str - lightArms;
  const dpH = damagePerHit(weapon);

  let total = 0;
  for (let i = 0; i < iters; i++) {
    const hits   = countSuccesses(rollDice(weapon.att), evaThresh);
    if (!hits) continue;
    const blocks = countSuccesses(rollDice(hits), blockThresh);
    total += Math.max(0, hits - blocks) * dpH;
  }
  return total / iters;
}

function fmt(n)  { return n.toFixed(2).padStart(5); }
function pad(s, w) { return String(s).padEnd(w); }

// ── scenario: weapons table ───────────────────────────────────────────────────

function scenarioWeapons() {
  const targets = ['assault','heavy','medium','light'];
  const header  = ['Weapon','Sl','Rng','Kw','Asslt','Heavy','Med','Light','ED/sl'];
  const COL = [28, 3, 4, 28, 6, 6, 6, 6, 6];

  const row = (cols) => cols.map((c, i) => pad(c, COL[i])).join(' ');
  console.log(row(header));
  console.log('-'.repeat(COL.reduce((a, b) => a + b + 1, 0)));

  const rows = [];
  for (const w of Object.values(WEAPONS)) {
    const eds = targets.map(t => expectedDamage(w, t));
    const avgED = eds.reduce((a, b) => a + b, 0) / eds.length;
    const edPerSlot = avgED / w.slotCost;
    rows.push({ w, eds, avgED, edPerSlot });
  }

  // Sort by slot cost then avg ED desc
  rows.sort((a, b) => a.w.slotCost - b.w.slotCost || b.avgED - a.avgED);

  for (const { w, eds, edPerSlot } of rows) {
    const kw = (w.special ?? []).join(', ');
    console.log(row([
      w.name, w.slotCost, w.range,
      kw.length > 27 ? kw.slice(0, 25) + '..' : kw,
      ...eds.map(fmt),
      fmt(edPerSlot),
    ]));
  }
}

// ── scenario: detailed single weapon ─────────────────────────────────────────

function scenarioWeapon(id) {
  const w = WEAPONS[id];
  if (!w) { console.error(`Unknown weapon: ${id}`); process.exit(1); }
  console.log(`\n${w.name}  (${w.slotCost} slot, R${w.range}, Att${w.att}, Str${w.str})`);
  console.log(`Keywords: ${(w.special ?? []).join(', ') || 'none'}\n`);

  const targets = ['assault','heavy','medium','light','groundVehicle','heavyVehicle'];
  for (const tid of targets) {
    const t = UNIT_TYPES[tid];
    const accurate  = w.special?.includes('Accurate')   ? 1 : 0;
    const lightArms = w.special?.includes('Light Arms') ? 1 : 0;
    const evaThresh   = parseStatValue(t.eva) - accurate;
    const blockThresh = parseStatValue(t.tou) + w.str - lightArms;
    const ed = expectedDamage(w, tid);
    console.log(`  vs ${pad(t.name, 18)} eva=${evaThresh}+ block=${blockThresh > 6 ? '6only' : blockThresh + '+'}  ED=${ed.toFixed(3)}`);
  }
}

// ── scenario: army sim ────────────────────────────────────────────────────────
// Simplified — each unit fires its weapons once per round, no movement/facing.
// Good for rough army-level balance, not tactical positioning.

const ARMY_A = [
  { type: 'assault', weapons: ['largeLaser', 'largeLaser', 'mediumPulseLaser', 'mediumPulseLaser'] },
  { type: 'heavy',   weapons: ['autocannon10', 'autocannon10', 'smallPulseLaser'] },
  { type: 'medium',  weapons: ['streakSRMRack', 'streakSRMRack'] },
  { type: 'light',   weapons: ['smallLaser'] },
];

const ARMY_B = [
  { type: 'assault', weapons: ['ppc', 'ppc', 'gaussRifle'] },
  { type: 'heavy',   weapons: ['lrm10', 'lrm10', 'lrm5'] },
  { type: 'medium',  weapons: ['lb5xAC', 'lb5xAC'] },
  { type: 'light',   weapons: ['machineGunArray'] },
];

function scenarioArmy(rounds = 6, iters = 5_000) {
  function simArmy(attackers, defenders, iters) {
    let totalDmg = 0;
    for (let i = 0; i < iters; i++) {
      // Each unit fires all its weapons at a random living defender
      const hp = defenders.map(d => UNIT_TYPES[d.type].totalSlots ?? 4);
      for (const atk of attackers) {
        for (const wid of atk.weapons) {
          const w = WEAPONS[wid];
          if (!w) continue;
          // Pick a random living defender
          const alive = hp.map((h, i) => h > 0 ? i : -1).filter(i => i >= 0);
          if (!alive.length) break;
          const di = alive[Math.floor(Math.random() * alive.length)];
          const t = defenders[di];
          const accurate  = w.special?.includes('Accurate')   ? 1 : 0;
          const lightArms = w.special?.includes('Light Arms') ? 1 : 0;
          const eva   = parseStatValue(UNIT_TYPES[t.type].eva) - accurate;
          const block = parseStatValue(UNIT_TYPES[t.type].tou) + w.str - lightArms;
          const hits  = countSuccesses(rollDice(w.att), eva);
          const saves = hits ? countSuccesses(rollDice(hits), block) : 0;
          const dmg   = Math.max(0, hits - saves) * damagePerHit(w);
          hp[di] = Math.max(0, hp[di] - dmg);
          totalDmg += dmg;
        }
      }
    }
    return totalDmg / iters;
  }

  console.log('\nArmy A fires at Army B:');
  console.log('  Avg damage dealt per round: ' + simArmy(ARMY_A, ARMY_B, iters).toFixed(2));
  console.log('\nArmy B fires at Army A:');
  console.log('  Avg damage dealt per round: ' + simArmy(ARMY_B, ARMY_A, iters).toFixed(2));
}

// ── entry point ───────────────────────────────────────────────────────────────

const [,, scenario = 'weapons', arg] = process.argv;
if (scenario === 'weapons')       scenarioWeapons();
else if (scenario === 'weapon')   scenarioWeapon(arg);
else if (scenario === 'army')     scenarioArmy();
else { console.error('Unknown scenario:', scenario); process.exit(1); }
