/**
 * Full-game AI simulator — run with:
 *   npx tsx sim-game.js [games] [armyA] [armyB]
 *
 * Armies:  ironwall | sharpshot | sizzler | speedrun | carpetbomb
 *           versatile | gutpunch | maneuverer | harasser | wildcard
 * Example: npx tsx sim-game.js 200 laserPrecision ballisticBarrage
 *
 * Outputs per-army win rates, avg rounds, damage dealt, and per-weapon stats.
 */

import { buildOnlineInitialState, gameReducer, PLAY_PHASES } from './src/game/gameReducer.js';
import { UNIT_TYPES, ALL_UPGRADES, WEAPONS }                  from './src/data/gameData.js';
import { hexKey, hexDistance, isDeployZone, inBounds,
         BOARD_COLS, BOARD_ROWS, vectorToFacing }             from './src/game/hexMath.js';
import { getEquippedWeapons, canWeaponTarget, hasActiveUpgrade,
         getAllSlots, parseStatValue, damagePerHit }           from './src/game/combat.js';

// ─── Balance patches ──────────────────────────────────────────────────────────
// Edit these objects to test changes without touching any game source files.
// Patches are applied once at startup and shown in the run header.
//
// Weapon fields:  att, str, range, slotCost, special (array of keyword strings)
// Unit fields:    tou, eva, sp  (stat strings like '4+' or numbers)
//
// Examples (uncomment to activate):
//
//   ppc:        { str: 2 }            nerf PPC strength 3 → 2
//   gaussRifle: { att: 3 }            nerf Gauss att 4 → 3
//   lrm5:       { range: 9 }          buff LRM-5 range 6 → 9
//   assault:    { tou: '5+' }         buff assault toughness
//   light:      { eva: '3+' }         buff light evasion

const WEAPON_PATCHES = {};

const UNIT_PATCHES = {};

const RULE_PATCHES = {};

function applyPatches() {
  const lines = [];
  for (const [id, overrides] of Object.entries(WEAPON_PATCHES)) {
    const w = WEAPONS[id];
    if (!w) { console.warn(`[patch] Unknown weapon: ${id}`); continue; }
    for (const [key, val] of Object.entries(overrides)) {
      lines.push(`  weapon ${w.name} .${key}  ${JSON.stringify(w[key])} → ${JSON.stringify(val)}`);
      w[key] = val;
    }
  }
  for (const [id, overrides] of Object.entries(UNIT_PATCHES)) {
    const u = UNIT_TYPES[id];
    if (!u) { console.warn(`[patch] Unknown unit type: ${id}`); continue; }
    for (const [key, val] of Object.entries(overrides)) {
      lines.push(`  unit   ${u.name} .${key}  ${JSON.stringify(u[key])} → ${JSON.stringify(val)}`);
      u[key] = val;
    }
  }
  if (RULE_PATCHES.deadly) {
    globalThis.__simRules = { ...globalThis.__simRules, deadly: RULE_PATCHES.deadly };
    lines.push(`  rule   Deadly    "+1 per hit" → "+1 once if damage landed"`);
  }
  if (RULE_PATCHES.accurate) {
    globalThis.__simRules = { ...globalThis.__simRules, accurate: RULE_PATCHES.accurate };
    lines.push(`  rule   Accurate  "-1 eva threshold" → "each hit counts as 2 before blocks"`);
  }
  if (lines.length) {
    console.log('Balance patches:');
    lines.forEach(l => console.log(l));
    console.log('');
  }
}

// ─── Army builder helpers ─────────────────────────────────────────────────────

let _uid = 1;
function unit(typeId, name, slots) {
  return { id: _uid++, typeId, name, slots, heroId: null, titleId: null, aceCustomSlot: null };
}
function army(armyName, units) {
  return { armyName, units };
}

// ─── Test armies ─────────────────────────────────────────────────────────────
// Ten armies built as if by different real players — each has a genuine
// philosophy and mixes weapons across range bands.
// Slot capacity: assault 5+4+4, heavy 4+3+3, medium 3+2+2, light 2+1+1
// Variable upgrade costs: highTunedEngine heavy=2/medium=1, boostJets light=1/medium=1/heavy=2

const ARMIES = {

  // ── 1. Iron Wall ────────────────────────────────────────────────────────────
  // "I just want to not die."  Armor upgrades on everything, weapons chosen
  // for sustained output rather than burst.  Wins the attrition war.
  ironwall: army('Iron Wall', [
    unit('assault', 'Bastion', {
      torso: ['ultraAC10', 'extraArmor', 'extraArmor'],          // 3+1+1 = 5/5
      larm:  ['autocannon10', 'extraArmor', 'lb2xAC'],           // 2+1+1 = 4/4
      rarm:  ['autocannon10', 'extraArmor', 'lb2xAC'],           // 2+1+1 = 4/4
    }),
    unit('heavy', 'Rampart', {
      torso: ['experimentalArmor', 'lb5xAC'],                    // 2+2 = 4/4
      larm:  ['erMediumLaser', 'extraArmor'],                    // 2+1 = 3/3
      rarm:  ['erMediumLaser', 'extraArmor'],                    // 2+1 = 3/3
    }),
    unit('light', 'Picket', {
      torso: ['erSmallLaser', 'extraArmor', 'extraArmor'],       // 1+1+1 = 3/3
      larm:  ['lb2xAC'],                                         // 1/1
      rarm:  ['lb2xAC'],                                         // 1/1
    }),
  ]),

  // ── 2. Sharp Shot ───────────────────────────────────────────────────────────
  // "Quality over quantity."  PPC + twin Gauss for maximum Str at range 9.
  // ER lasers fill mid-range, LRMs harass while closing.  Few shots but each one hurts.
  sharpshot: army('Sharp Shot', [
    unit('assault', 'Headhunter', {
      torso: ['ppc', 'heatSinks', 'lb2xAC'],                     // 3+1+1 = 5/5
      larm:  ['gaussRifle', 'lb2xAC'],                           // 3+1 = 4/4
      rarm:  ['gaussRifle', 'lb2xAC'],                           // 3+1 = 4/4
    }),
    unit('medium', 'Spotter', {
      torso: ['erMediumLaser', 'lrm5'],                          // 2+1 = 3/3
      larm:  ['lrm5', 'ultraAC2'],                               // 1+1 = 2/2
      rarm:  ['lrm5', 'ultraAC2'],                               // 1+1 = 2/2
    }),
    unit('light', 'Courier', {
      torso: ['lb2xAC', 'erSmallLaser', 'lrm5'],                // 1+1+1 = 3/3
      larm:  ['lrm5'],                                           // 1/1
      rarm:  ['lrm5'],                                           // 1/1
    }),
  ]),

  // ── 3. Sizzler ──────────────────────────────────────────────────────────────
  // "Lasers.  All lasers.  Always lasers."  Heat sinks let the assault fire
  // everything every round.  Accurate double-hits on pulse lasers is the payoff.
  sizzler: army('Sizzler', [
    unit('assault', 'Pyro', {
      torso: ['largePulseLaser', 'heatSinks', 'heatSinks'],      // 3+1+1 = 5/5
      larm:  ['mediumPulseLaser', 'mediumLaser'],                // 2+2 = 4/4
      rarm:  ['mediumPulseLaser', 'mediumLaser'],                // 2+2 = 4/4
    }),
    unit('heavy', 'Torch', {
      torso: ['largeLaser', 'heatSinks'],                        // 3+1 = 4/4
      larm:  ['mediumPulseLaser', 'erSmallLaser'],               // 2+1 = 3/3
      rarm:  ['mediumPulseLaser', 'erSmallLaser'],               // 2+1 = 3/3
    }),
    unit('light', 'Spark', {
      torso: ['smallPulseLaser', 'erSmallLaser', 'smallLaser'],  // 1+1+1 = 3/3
      larm:  ['smallPulseLaser'],                                // 1/1
      rarm:  ['smallPulseLaser'],                                // 1/1
    }),
  ]),

  // ── 4. Speed Run ────────────────────────────────────────────────────────────
  // "I'll be in your face before you finish your first shot."  No assault mech
  // — skips sluggishness entirely.  High-tuned engines close the gap fast,
  // then mid and short-range weapons do the talking.
  speedrun: army('Speed Run', [
    unit('heavy', 'Blitz', {
      torso: ['highTunedEngine', 'lb5xAC'],                      // 2+2 = 4/4
      larm:  ['autocannon10', 'autocannon2'],                    // 2+1 = 3/3
      rarm:  ['autocannon10', 'autocannon2'],                    // 2+1 = 3/3
    }),
    unit('medium', 'Streak', {
      torso: ['highTunedEngine', 'mediumPulseLaser'],            // 1+2 = 3/3
      larm:  ['streakSRMRack', 'lb2xAC'],                       // 1+1 = 2/2
      rarm:  ['streakSRMRack', 'lb2xAC'],                       // 1+1 = 2/2
    }),
    unit('light', 'Sprint', {
      torso: ['boostJets', 'heatSinks', 'streakSRMRack'],        // 1+1+1 = 3/3 (HS absorbs jump heat)
      larm:  ['streakSRMRack'],                                  // 1/1
      rarm:  ['streakSRMRack'],                                  // 1/1
    }),
  ]),

  // ── 5. Carpet Bomb ──────────────────────────────────────────────────────────
  // "You can't fight what you can't see coming."  Arrow IV blast area denial
  // from range 12, LRM saturation at 9, then AC/10 + pulse for close work.
  // Mix of indirect and direct that forces opponents to keep moving.
  carpetbomb: army('Carpet Bomb', [
    unit('assault', 'Typhoon', {
      torso: ['arrowIVArtillery', 'lrm5', 'lrm5'],              // 3+1+1 = 5/5
      larm:  ['lrm10', 'autocannon10'],                         // 2+2 = 4/4
      rarm:  ['lrm10', 'autocannon10'],                         // 2+2 = 4/4
    }),
    unit('medium', 'Squall', {
      torso: ['lrm10', 'autocannon2'],                          // 2+1 = 3/3
      larm:  ['lrm5', 'erSmallLaser'],                          // 1+1 = 2/2
      rarm:  ['lrm5', 'erSmallLaser'],                          // 1+1 = 2/2
    }),
    unit('light', 'Drizzle', {
      torso: ['lrm5', 'smallPulseLaser', 'ultraAC2'],           // 1+1+1 = 3/3
      larm:  ['streakSRMRack'],                                  // 1/1
      rarm:  ['streakSRMRack'],                                  // 1/1
    }),
  ]),

  // ── 6. Versatile ────────────────────────────────────────────────────────────
  // "I always have an answer."  Deliberately covers R10, R9, R6, R3 in every
  // unit.  No dominant weapon; wins by always having something in range.
  versatile: army('Versatile', [
    unit('assault', 'Omnivore', {
      torso: ['largeLaser', 'ultraAC5'],                         // 3+2 = 5/5
      larm:  ['ultraAC5', 'streakSRMRack', 'lb2xAC'],           // 2+1+1 = 4/4
      rarm:  ['ultraAC5', 'streakSRMRack', 'lb2xAC'],           // 2+1+1 = 4/4
    }),
    unit('heavy', 'Adapter', {
      torso: ['ppc', 'heatSinks'],                               // 3+1 = 4/4
      larm:  ['autocannon10', 'streakSRMRack'],                  // 2+1 = 3/3
      rarm:  ['autocannon10', 'streakSRMRack'],                  // 2+1 = 3/3
    }),
    unit('medium', 'Flex', {
      torso: ['lb5xAC', 'autocannon2'],                          // 2+1 = 3/3
      larm:  ['erSmallLaser', 'streakSRMRack'],                  // 1+1 = 2/2
      rarm:  ['erSmallLaser', 'streakSRMRack'],                  // 1+1 = 2/2
    }),
  ]),

  // ── 7. Gut Punch ────────────────────────────────────────────────────────────
  // "Skip the range game entirely.  Two heavies march in and wreck face."
  // AC/20 for burst, Ultra AC/10 backbone, machine guns for infantry-shredding
  // volume once inside the enemy's guard.
  gutpunch: army('Gut Punch', [
    unit('heavy', 'Crusher', {
      torso: ['autocannon20', 'extraArmor'],                     // 3+1 = 4/4
      larm:  ['autocannon10', 'streakSRMRack'],                  // 2+1 = 3/3
      rarm:  ['autocannon10', 'streakSRMRack'],                  // 2+1 = 3/3
    }),
    unit('heavy', 'Grinder', {
      torso: ['ultraAC10', 'machineGunArray'],                   // 3+1 = 4/4
      larm:  ['lb5xAC', 'machineGunArray'],                      // 2+1 = 3/3
      rarm:  ['lb5xAC', 'machineGunArray'],                      // 2+1 = 3/3
    }),
    unit('medium', 'Wedge', {
      torso: ['autocannon10', 'streakSRMRack'],                  // 2+1 = 3/3
      larm:  ['autocannon2', 'streakSRMRack'],                   // 1+1 = 2/2
      rarm:  ['autocannon2', 'streakSRMRack'],                   // 1+1 = 2/2
    }),
  ]),

  // ── 8. Maneuverer ───────────────────────────────────────────────────────────
  // "Positioning is the weapon."  Boost jets let the medium and light flank
  // freely.  Medium-range pulse lasers + Ultra ACs reward getting side arcs.
  maneuverer: army('Maneuverer', [
    unit('heavy', 'Stormbird', {
      torso: ['largePulseLaser', 'heatSinks'],                   // 3+1 = 4/4
      larm:  ['ultraAC5', 'lb2xAC'],                            // 2+1 = 3/3
      rarm:  ['ultraAC5', 'lb2xAC'],                            // 2+1 = 3/3
    }),
    unit('medium', 'Harrier', {
      torso: ['boostJets', 'mediumPulseLaser'],                  // 1+2 = 3/3
      larm:  ['heatSinks', 'streakSRMRack'],                     // 1+1 = 2/2 (HS absorbs jump heat)
      rarm:  ['lb2xAC', 'streakSRMRack'],                       // 1+1 = 2/2
    }),
    unit('light', 'Kestrel', {
      torso: ['boostJets', 'smallPulseLaser', 'heatSinks'],      // 1+1+1 = 3/3 (HS absorbs jump heat)
      larm:  ['streakSRMRack'],                                  // 1/1
      rarm:  ['streakSRMRack'],                                  // 1/1
    }),
  ]),

  // ── 9. Harasser ─────────────────────────────────────────────────────────────
  // "Death by a thousand cuts."  Maximum shot count via Relentless ballistics
  // at every range band.  No single hit kills, but the cumulative chip is
  // relentless.  LB 10-X + Ultra ACs generate massive hit totals per round.
  harasser: army('Harasser', [
    unit('assault', 'Tempest', {
      torso: ['lb10xAC', 'erMediumLaser'],                       // 3+2 = 5/5
      larm:  ['ultraAC5', 'lb2xAC', 'ultraAC2'],                // 2+1+1 = 4/4
      rarm:  ['ultraAC5', 'lb2xAC', 'ultraAC2'],                // 2+1+1 = 4/4
    }),
    unit('medium', 'Current', {
      torso: ['lb5xAC', 'erSmallLaser'],                         // 2+1 = 3/3
      larm:  ['ultraAC2', 'lb2xAC'],                            // 1+1 = 2/2
      rarm:  ['ultraAC2', 'lb2xAC'],                            // 1+1 = 2/2
    }),
    unit('light', 'Static', {
      torso: ['machineGunArray', 'ultraAC2', 'lb2xAC'],          // 1+1+1 = 3/3
      larm:  ['lb2xAC'],                                         // 1/1
      rarm:  ['lb2xAC'],                                         // 1/1
    }),
  ]),

  // ── 10. Wild Card ───────────────────────────────────────────────────────────
  // "Nobody expects this list."  Arrow IV blast + twin PPC spike damage on the
  // assault, LRM-20 suppression + dual Ultra AC/10 hammers on the heavy,
  // jump-capable light that splits arms (lrm5 one side, streak the other).
  wildcard: army('Wild Card', [
    unit('assault', 'Joker', {
      torso: ['arrowIVArtillery', 'lb2xAC', 'ultraAC2'],        // 3+1+1 = 5/5
      larm:  ['ppc', 'erSmallLaser'],                           // 3+1 = 4/4
      rarm:  ['ppc', 'erSmallLaser'],                           // 3+1 = 4/4
    }),
    unit('heavy', 'Wildfire', {
      torso: ['lrm20', 'machineGunArray'],                       // 3+1 = 4/4
      larm:  ['ultraAC10'],                                      // 3/3
      rarm:  ['ultraAC10'],                                      // 3/3
    }),
    unit('light', 'Odd One', {
      torso: ['boostJets', 'heatSinks', 'ultraAC2'],             // 1+1+1 = 3/3 (HS absorbs jump heat)
      larm:  ['lrm5'],                                           // 1/1
      rarm:  ['streakSRMRack'],                                  // 1/1
    }),
  ]),
};

// ─── Unit roster & budget-tier armies ────────────────────────────────────────
// Slot capacity (patched):  assault 6/5/5  heavy 5/4/4  medium 4/3/3  light 3/2/2
//                           groundVehicle single/1   heavyVehicle single/2
// Weapon slot costs (patched): autocannon20=4, gaussRifle=4, arrowIV=4, all others unchanged
// Unit pts: assault 100  heavy 80  medium 60  light 40  groundVehicle 15  heavyVehicle 25

const ROSTER = {
  // ── Assault (100 pts) — torso:6  larm:5  rarm:5 ───────────────────────
  // Pyro: layered laser threat — ER medium for range, pulse for brawling
  asr_laser:     unit('assault', 'Pyro',      { torso: ['largePulseLaser','heatSinks','erMediumLaser','heatSinks'],     larm: ['erMediumLaser','mediumPulseLaser','heatSinks','lb2xAC','lb2xAC'], rarm: ['erMediumLaser','mediumPulseLaser','heatSinks','lb2xAC','lb2xAC'] }),
  // Bastion: armored ballistic fortress
  asr_ballistic: unit('assault', 'Bastion',   { torso: ['ultraAC10','extraArmor','extraArmor','lb2xAC','lb2xAC'],      larm: ['autocannon10','extraArmor','lb2xAC','lb2xAC','lb2xAC'],           rarm: ['autocannon10','extraArmor','lb2xAC','lb2xAC','lb2xAC'] }),
  // Headshot: long-range precision — dual gauss + PPC
  asr_gauss:     unit('assault', 'Headshot',  { torso: ['ppc','heatSinks','lb2xAC','lb2xAC','lb2xAC'],                 larm: ['gaussRifle','lb2xAC'],                                            rarm: ['gaussRifle','lb2xAC'] }),
  // Typhoon: indirect fire platform
  asr_indirect:  unit('assault', 'Typhoon',   { torso: ['arrowIVArtillery','lrm5','lrm5'],                             larm: ['lrm10','autocannon10','lb2xAC','ultraAC2'],                       rarm: ['lrm10','autocannon10','lb2xAC','ultraAC2'] }),
  // Bruiser: close-range demolisher, AC20 + support weapons
  asr_brawler:   unit('assault', 'Bruiser',   { torso: ['autocannon20','extraArmor','lb2xAC'],                         larm: ['autocannon10','streakSRMRack','lb2xAC','lb2xAC','machineGunArray'], rarm: ['autocannon10','streakSRMRack','lb2xAC','lb2xAC','machineGunArray'] }),
  // Overlord: mixed long-range — LRMs + ultra ACs
  asr_mixed:     unit('assault', 'Overlord',  { torso: ['lrm20','ultraAC5','lb2xAC'],                                  larm: ['ultraAC10','lrm5','lb2xAC'],                                      rarm: ['ultraAC10','lrm5','lb2xAC'] }),
  // Ironclad: reinforced armor + steady sustained fire
  asr_tank:      unit('assault', 'Ironclad',  { torso: ['ultraAC10','hardenedArmor','lb2xAC'],                         larm: ['autocannon10','extraArmor','lb2xAC','lb2xAC'],                    rarm: ['autocannon10','extraArmor','lb2xAC','lb2xAC'] }),

  // ── Heavy (80 pts) — torso:5  larm:4  rarm:4 ──────────────────────────
  // Torch: ER lasers for reach, pulse for close work
  hvy_laser:     unit('heavy',   'Torch',     { torso: ['largePulseLaser','heatSinks','erMediumLaser'],                 larm: ['erMediumLaser','mediumPulseLaser','heatSinks','lb2xAC'],          rarm: ['erMediumLaser','mediumPulseLaser','heatSinks','lb2xAC'] }),
  // Grinder: sustained ballistic fire, stripped Relentless so just raw volume
  hvy_ballistic: unit('heavy',   'Grinder',   { torso: ['ultraAC10','lb2xAC','machineGunArray'],                        larm: ['lb5xAC','lb2xAC','machineGunArray'],                              rarm: ['lb5xAC','lb2xAC','machineGunArray'] }),
  // Rampart: LB-X cluster barrage
  hvy_ultra:     unit('heavy',   'Rampart',   { torso: ['lb5xAC','lb2xAC','lb2xAC','lb2xAC'],                          larm: ['ultraAC5','lb2xAC','lb2xAC'],                                    rarm: ['ultraAC5','lb2xAC','lb2xAC'] }),
  // Adapter: versatile mid-range PPC + autocannons
  hvy_mixed:     unit('heavy',   'Adapter',   { torso: ['ppc','heatSinks','lb2xAC'],                                   larm: ['autocannon10','streakSRMRack','lb2xAC'],                          rarm: ['autocannon10','streakSRMRack','lb2xAC'] }),
  // Warcloud: LRM saturation + ultraAC backup
  hvy_lrm:       unit('heavy',   'Warcloud',  { torso: ['lrm20','lrm5','machineGunArray'],                              larm: ['ultraAC10','lrm5'],                                               rarm: ['ultraAC10','lrm5'] }),
  // Stalker: gauss + streaks, patient long-range hunter
  hvy_gauss:     unit('heavy',   'Stalker',   { torso: ['gaussRifle','lb2xAC'],                                        larm: ['lrm10','streakSRMRack','lb2xAC'],                                 rarm: ['lrm10','streakSRMRack','lb2xAC'] }),
  // Anvil: heavily armored defensive platform
  hvy_tank:      unit('heavy',   'Anvil',     { torso: ['ultraAC10','hardenedArmor'],                                  larm: ['autocannon10','extraArmor','lb2xAC','lb2xAC'],                    rarm: ['autocannon10','extraArmor','lb2xAC','lb2xAC'] }),

  // ── Medium (60 pts) — torso:4  larm:3  rarm:3 ─────────────────────────
  // Harrier: jump + ER medium reach, pulse for close
  med_pulse:     unit('medium',  'Harrier',   { torso: ['boostJets','erMediumLaser','heatSinks'],                       larm: ['mediumPulseLaser','erSmallLaser','lb2xAC'],                       rarm: ['mediumPulseLaser','erSmallLaser','lb2xAC'] }),
  // Wedge: autocannon generalist
  med_ballistic: unit('medium',  'Wedge',     { torso: ['autocannon10','lb2xAC','lb2xAC'],                             larm: ['autocannon2','streakSRMRack','lb2xAC'],                           rarm: ['autocannon2','streakSRMRack','lb2xAC'] }),
  // Squall: LRM support
  med_lrm:       unit('medium',  'Squall',    { torso: ['lrm10','lrm5','autocannon2'],                                 larm: ['lrm5','erSmallLaser','lb2xAC'],                                   rarm: ['lrm5','erSmallLaser','lb2xAC'] }),
  // Blitz: speed + firepower, high-tuned engine
  med_boost:     unit('medium',  'Blitz',     { torso: ['highTunedEngine','lb5xAC'],                                   larm: ['autocannon10','autocannon2','lb2xAC'],                            rarm: ['autocannon10','autocannon2','lb2xAC'] }),
  // Viper: streak missile boat
  med_streak:    unit('medium',  'Viper',     { torso: ['streakSRMRack','streakSRMRack','lb2xAC'],                     larm: ['streakSRMRack','erSmallLaser','lb2xAC'],                          rarm: ['streakSRMRack','erSmallLaser','lb2xAC'] }),
  // Phantom: jump + ER lasers for hit-and-run
  med_er:        unit('medium',  'Phantom',   { torso: ['boostJets','erMediumLaser','heatSinks'],                      larm: ['erMediumLaser','erSmallLaser','lb2xAC'],                          rarm: ['erMediumLaser','erSmallLaser','lb2xAC'] }),

  // ── Light (40 pts) — torso:3  larm:2  rarm:2 ──────────────────────────
  // Kestrel: jump + SRM harasser
  lgt_fast:      unit('light',   'Kestrel',   { torso: ['boostJets','smallPulseLaser'],                                larm: ['streakSRMRack','erSmallLaser'],                                   rarm: ['streakSRMRack','erSmallLaser'] }),
  // Picket: long-range scout with LB-X
  lgt_lb:        unit('light',   'Picket',    { torso: ['lb2xAC','extraArmor'],                                        larm: ['lb2xAC','ultraAC2'],                                              rarm: ['lb2xAC','ultraAC2'] }),
  // Sprint: mixed short-range brawler
  lgt_streak:    unit('light',   'Sprint',    { torso: ['streakSRMRack','erSmallLaser'],                               larm: ['streakSRMRack','lb2xAC'],                                         rarm: ['lb2xAC','ultraAC2'] }),
  // Drizzle: LRM spotter
  lgt_lrm:       unit('light',   'Drizzle',   { torso: ['lrm5','ultraAC2'],                                            larm: ['lrm5','erSmallLaser'],                                            rarm: ['ultraAC2','erSmallLaser'] }),
  // Dart: ER laser skirmisher with jump
  lgt_er:        unit('light',   'Dart',      { torso: ['boostJets','erSmallLaser'],                                   larm: ['erSmallLaser','ultraAC2'],                                        rarm: ['erSmallLaser','ultraAC2'] }),
  // Hornet: MGA + streaks, swarm skirmisher
  lgt_mga:       unit('light',   'Hornet',    { torso: ['machineGunArray','streakSRMRack'],                             larm: ['streakSRMRack','lb2xAC'],                                         rarm: ['machineGunArray','lb2xAC'] }),

  // ── Ground Vehicle (15 pts, single/1 slot) ────────────────────────────
  gv_lrm:        unit('groundVehicle', 'LRM Buggy',    { single: ['lrm5'] }),
  gv_streak:     unit('groundVehicle', 'SRM Scout',    { single: ['streakSRMRack'] }),
  gv_ac:         unit('groundVehicle', 'AC Scout',     { single: ['autocannon2'] }),
  gv_laser:      unit('groundVehicle', 'Laser Scout',  { single: ['smallPulseLaser'] }),
  gv_mga:        unit('groundVehicle', 'MGA Buggy',    { single: ['machineGunArray'] }),

  // ── Heavy Vehicle (25 pts, single/2 slots) ────────────────────────────
  hv_ac:         unit('heavyVehicle', 'Gun Tank',      { single: ['autocannon10', 'lb2xAC'] }),
  hv_lrm:        unit('heavyVehicle', 'LRM Tank',      { single: ['lrm10', 'lrm5'] }),
  hv_streak:     unit('heavyVehicle', 'SRM Tank',      { single: ['streakSRMRack', 'streakSRMRack', 'lb2xAC'] }),
  hv_laser:      unit('heavyVehicle', 'Laser Tank',    { single: ['mediumPulseLaser', 'erSmallLaser'] }),
  hv_ultra:      unit('heavyVehicle', 'Ultra Tank',    { single: ['ultraAC5', 'lb2xAC'] }),
};

// Helper: point cost of an army
const UNIT_PTS = { assault: 100, heavy: 80, medium: 60, light: 40, groundVehicle: 15, heavyVehicle: 25 };
function armyPts(a) { return a.units.reduce((s, u) => s + (UNIT_PTS[u.typeId] ?? 0), 0); }

const R = ROSTER; // shorthand
const TIER_ARMIES = {
  200: [
    //                              pts   composition
    // Laser Spike: mobile close-range lasers, jump to close fast
    army('Laser Spike',       [R.asr_laser,     R.med_pulse,     R.lgt_fast]),                                           // 100+60+40 = 200
    // Iron Defense: armored assault + ballistic support + cheap vehicles
    army('Iron Defense',      [R.asr_tank,      R.med_ballistic, R.hv_ac,      R.gv_ac]),                                // 100+60+25+15 = 200
    // Ballistic Wall: two heavies saturate with cluster/ultra fire
    army('Ballistic Wall',    [R.hvy_ballistic, R.hvy_ultra,     R.lgt_streak]),                                         // 80+80+40 = 200
    // Indirect Barrage: arrow IV + LRM denial zone
    army('Indirect Barrage',  [R.asr_indirect,  R.med_lrm,       R.lgt_lrm]),                                            // 100+60+40 = 200
    // Speed Blitz: fast mechs close and overwhelm before enemy sets up
    army('Speed Blitz',       [R.hvy_ultra,     R.med_boost,     R.lgt_fast,   R.gv_ac]),                                // 80+60+40+15 = 195
    // Gauss Sniper: long-range precision with gauss + PPC
    army('Gauss Sniper',      [R.asr_gauss,     R.med_lrm,       R.lgt_lrm]),                                            // 100+60+40 = 200
    // Vehicle Swarm: many cheap activations, harassment and attrition
    army('Vehicle Swarm',     [R.lgt_fast,      R.lgt_streak,    R.lgt_lb,     R.lgt_lrm,  R.hv_lrm, R.gv_streak]),     // 40+40+40+40+25+15 = 200
    // Missile Boat: streak missiles from all angles, Deadly on every shot
    army('Missile Boat',      [R.asr_brawler,   R.med_streak,    R.lgt_streak]),                                         // 100+60+40 = 200
  ],
  250: [
    army('Laser Spike',       [R.asr_laser,     R.hvy_laser,     R.lgt_fast,   R.gv_laser, R.gv_laser]),                 // 100+80+40+15+15 = 250
    army('Iron Defense',      [R.asr_tank,      R.hvy_tank,      R.lgt_lb,     R.gv_ac,    R.gv_ac]),                    // 100+80+40+15+15 = 250
    army('Ballistic Wall',    [R.hvy_ballistic, R.hvy_ultra,     R.lgt_lb,     R.hv_ac,    R.hv_ac]),                    // 80+80+40+25+25 = 250
    army('Indirect Barrage',  [R.asr_indirect,  R.hvy_lrm,       R.lgt_lrm,    R.gv_lrm,   R.gv_lrm]),                  // 100+80+40+15+15 = 250
    army('Speed Blitz',       [R.hvy_ultra,     R.med_boost,     R.lgt_fast,   R.lgt_er,   R.gv_ac,   R.gv_ac]),         // 80+60+40+40+15+15 = 250
    army('Gauss Sniper',      [R.asr_gauss,     R.hvy_gauss,     R.lgt_lrm,    R.gv_lrm,   R.gv_lrm]),                  // 100+80+40+15+15 = 250
    army('Vehicle Swarm',     [R.hvy_ballistic, R.hvy_ultra,     R.med_ballistic, R.gv_streak, R.gv_streak]),            // 80+80+60+15+15 = 250
    army('Missile Boat',      [R.asr_brawler,   R.hvy_mixed,     R.lgt_streak, R.gv_streak, R.gv_streak]),               // 100+80+40+15+15 = 250
  ],
  300: [
    army('Laser Spike',       [R.asr_laser,     R.hvy_laser,     R.med_pulse,  R.lgt_fast,  R.gv_laser]),                // 100+80+60+40+15 = 295
    army('Iron Defense',      [R.asr_tank,      R.hvy_tank,      R.med_ballistic, R.lgt_lb, R.gv_ac]),                   // 100+80+60+40+15 = 295
    army('Ballistic Wall',    [R.hvy_ballistic, R.hvy_ultra,     R.med_ballistic, R.lgt_streak, R.hv_ac]),               // 80+80+60+40+25 = 285
    army('Indirect Barrage',  [R.asr_indirect,  R.hvy_lrm,       R.med_lrm,    R.lgt_lrm,   R.gv_lrm]),                 // 100+80+60+40+15 = 295
    army('Speed Blitz',       [R.hvy_ultra,     R.hvy_ballistic, R.med_boost,  R.lgt_fast,  R.lgt_er]),                  // 80+80+60+40+40 = 300
    army('Gauss Sniper',      [R.asr_gauss,     R.hvy_gauss,     R.med_lrm,    R.lgt_lrm,   R.gv_lrm]),                  // 100+80+60+40+15 = 295
    army('Vehicle Swarm',     [R.hvy_ballistic, R.hvy_ultra,     R.med_ballistic, R.lgt_lb, R.hv_ultra]),                // 80+80+60+40+25 = 285
    army('Missile Boat',      [R.asr_brawler,   R.hvy_mixed,     R.med_streak, R.lgt_streak, R.gv_streak]),              // 100+80+60+40+15 = 295
  ],
};

// Verify all tier armies are within budget and rule limits
for (const [budget, armies] of Object.entries(TIER_ARMIES)) {
  for (const a of armies) {
    const pts = armyPts(a);
    if (pts > Number(budget)) console.warn(`[budget] ${a.armyName} at ${budget}pts is over budget: ${pts}pts`);
    const gvCount = a.units.filter(u => u.typeId === 'groundVehicle').length;
    const maxGVs = Math.floor(Number(budget) / 50);
    if (gvCount > maxGVs) console.warn(`[gv-cap] ${a.armyName} at ${budget}pts has ${gvCount} GVs but max is ${maxGVs}`);
    const mechaCount = a.units.filter(u => ['assault','heavy','medium','light'].includes(u.typeId)).length;
    const vehCount = a.units.filter(u => ['groundVehicle','heavyVehicle'].includes(u.typeId)).length;
    if (vehCount > mechaCount) console.warn(`[veh-cap] ${a.armyName} at ${budget}pts has ${vehCount} vehicles but only ${mechaCount} mecha`);
  }
}

// ─── AI: expected damage estimate (no dice, pure math) ───────────────────────

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
  // Accurate doubles hits before block roll (actual rule)
  const expectedHits = effectiveAtt * hitR * (isAccurate ? 2 : 1);
  const expectedNetHits = expectedHits * (1 - blkR);
  // Deadly: flat +1 if any hits land — P(at least 1 net hit) ≈ 1 - (1-hitR*(1-blkR))^att
  const pAnyNetHit = isDeadly ? 1 - Math.pow(Math.max(0, 1 - hitR * (1 - blkR)), effectiveAtt) : 0;
  return expectedNetHits + pAnyNetHit;
}

// ─── AI: slot damage helper ────────────────────────────────────────────────────

function unitRemainingHP(unit) {
  const slots = getAllSlots(unit.armyUnit, unit.slotDamage);
  return slots.reduce((sum, s) => sum + Math.max(0, s.threshold - s.dmg), 0);
}

// ─── AI: pick best weapon+target pair ─────────────────────────────────────────

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

// ─── AI: pick damage slot ─────────────────────────────────────────────────────
// Priority: most-damaged active slot (finish it off first)

function pickDamageSlot(unit, lockedKey) {
  const slots = getAllSlots(unit.armyUnit, unit.slotDamage)
    .filter(s => !s.disabled);
  if (lockedKey) {
    const locked = slots.find(s => s.key === lockedKey);
    if (locked) return locked.key;
  }
  // Sort: most already-damaged first (closest to destruction)
  slots.sort((a, b) => (b.dmg / b.threshold) - (a.dmg / a.threshold));
  return slots[0]?.key ?? null;
}

// ─── AI: deploy one unit ──────────────────────────────────────────────────────

function aiDeploy(state) {
  const pi  = state.deployPlayerIndex;
  const idx = state.deployedCount[pi];
  if (idx >= state.armies[pi].units.length) return state; // nothing to do

  // Collect occupied hexes
  const occ = new Set(state.units.map(u => hexKey(u.q, u.r)));

  // All valid deploy hexes for this player, shuffled for variety
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

  // Pick a random position spread across the zone
  const { q, r } = candidates[Math.floor(Math.random() * candidates.length)];

  // Face toward centre of board
  const facing = pi === 0 ? 4 : 1; // SW for top player, NE for bottom player

  let s = gameReducer(state, { type: 'SELECT_DEPLOY_UNIT', index: idx });
  s     = gameReducer(s,     { type: 'DEPLOY_UNIT', q, r, facing });
  return s;
}

// ─── AI: movement step ────────────────────────────────────────────────────────

function aiMoveStep(state) {
  const pa   = state.pendingAction;
  const unit = state.units.find(u => u.id === state.selectedUnitId);
  if (!unit) return gameReducer(state, { type: 'END_STEP_MOVE' });

  // No SP left — end
  if (!pa?.remainingMoves) return gameReducer(state, { type: 'END_STEP_MOVE' });

  const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
  if (!enemies.length) return gameReducer(state, { type: 'END_STEP_MOVE' });

  // Nearest enemy
  const target = enemies.reduce((b, e) =>
    hexDistance(unit.q, unit.r, e.q, e.r) < hexDistance(unit.q, unit.r, b.q, b.r) ? e : b);

  const desired = vectorToFacing(unit.q, unit.r, target.q, target.r);
  const distToTarget = hexDistance(unit.q, unit.r, target.q, target.r);

  const hasTurret = UNIT_TYPES[unit.typeId]?.special?.includes('Turret');

  if (pa.isJumping) {
    // Jump: fly directly toward target (any direction, cost 1, terrain ignored)
    if (distToTarget <= 1) return gameReducer(state, { type: 'END_STEP_MOVE' });

    const before = hexKey(unit.q, unit.r);
    const moved  = gameReducer(state, { type: 'STEP_MOVE', direction: desired });
    const afterUnit = moved.units.find(u => u.id === unit.id);

    if (hexKey(afterUnit.q, afterUnit.r) === before) return gameReducer(state, { type: 'END_STEP_MOVE' });

    // If SP exhausted the reducer already triggered endJump → jump-land; just return the new state
    if (moved.pendingAction?.action === 'jump-land') return moved;

    const distAfter = hexDistance(afterUnit.q, afterUnit.r, target.q, target.r);
    if (distAfter <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });

    return moved;
  }

  // Normal movement — turret units skip turning (can shoot any direction; save SP for movement)
  if (!hasTurret && unit.facing !== desired) {
    const leftTurns  = (desired - unit.facing + 6) % 6;
    const rightTurns = (unit.facing - desired + 6) % 6;
    return gameReducer(state, { type: 'STEP_TURN', dir: leftTurns <= rightTurns ? 'left' : 'right' });
  }

  // Facing correct — try to step forward; dispatch and check if position changed
  const before = hexKey(unit.q, unit.r);
  const moved  = gameReducer(state, { type: 'STEP_MOVE', direction: 'forward' });
  const afterUnit = moved.units.find(u => u.id === unit.id);

  // If position didn't change, blocked — end movement
  if (hexKey(afterUnit.q, afterUnit.r) === before) {
    return gameReducer(state, { type: 'END_STEP_MOVE' });
  }

  // If now adjacent to target, stop (save AP for shooting)
  const distAfter = hexDistance(afterUnit.q, afterUnit.r, target.q, target.r);
  if (distAfter <= 1) return gameReducer(moved, { type: 'END_STEP_MOVE' });

  return moved;
}

// ─── AI: single step of the state machine ─────────────────────────────────────

function aiStep(state) {
  // Safety guard against infinite loops
  if (state.phase === 'over') return state;

  // ── Morale ──────────────────────────────────────────────────────────────────
  if (state.pendingMorale) {
    return gameReducer(state, { type: 'DISMISS_MORALE' });
  }

  // ── Deploy ──────────────────────────────────────────────────────────────────
  if (state.phase === 'deploy') {
    return aiDeploy(state);
  }

  if (state.phase !== 'playing') return state;

  // ── Combat step machine ───────────────────────────────────────────────────
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
        // Pick weakest enemy (lowest remaining HP)
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

      case 'overheat-assign': {
        const attacker = state.units.find(u => u.id === pc.attackerId);
        const key = pickDamageSlot(attacker, pc.lockedUpgradeKey);
        if (!key) return gameReducer(state, { type: 'ADVANCE_OVERHEAT' });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }

      case 'damage-assign': {
        const target = state.units.find(u => u.id === pc.targetId);
        const key = pickDamageSlot(target, pc.lockedUpgradeKey);
        if (!key) return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: getAllSlots(target.armyUnit, target.slotDamage).find(s => !s.disabled)?.key });
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key });
      }

      case 'ram-damage-target': {
        const target = state.units.find(u => u.id === pc.targetId);
        const key = pickDamageSlot(target, pc.lockedUpgradeKey);
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key ?? getAllSlots(target.armyUnit, target.slotDamage).find(s => !s.disabled)?.key });
      }

      case 'ram-damage-rammer': {
        const rammer = state.units.find(u => u.id === pc.rammerId);
        const key = pickDamageSlot(rammer, pc.lockedUpgradeKey);
        return gameReducer(state, { type: 'ASSIGN_DAMAGE', slotKey: key ?? getAllSlots(rammer.armyUnit, rammer.slotDamage).find(s => !s.disabled)?.key });
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

  // ── Unit selected: handle movement or post-move ───────────────────────────
  if (state.selectedUnitId) {
    const unit = state.units.find(u => u.id === state.selectedUnitId);
    if (!unit) return gameReducer(state, { type: 'END_ACTIVATION' });

    const pa = state.pendingAction;

    // No action started yet — use jump if available, otherwise normal move
    if (!pa) {
      const hasJump = hasActiveUpgrade(unit.armyUnit, unit.slotDamage, 'boostJets');
      return gameReducer(state, { type: 'START_ACTION', action: 'move', isJumping: hasJump || undefined });
    }

    // Still have SP — keep moving
    if (pa.remainingMoves) {
      return aiMoveStep(state);
    }

    // Jump-land: choose facing toward nearest enemy then commit
    if (pa.action === 'jump-land') {
      const enemies = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
      const target  = enemies.length
        ? enemies.reduce((b, e) => hexDistance(unit.q, unit.r, e.q, e.r) < hexDistance(unit.q, unit.r, b.q, b.r) ? e : b)
        : null;
      const facing = target ? vectorToFacing(unit.q, unit.r, target.q, target.r) : unit.facing;
      return gameReducer(state, { type: 'JUMP_LAND', facing });
    }

    // Movement done — try to shoot
    if (!unit.hasCruised) {
      const enemies  = state.units.filter(u => u.playerIndex !== unit.playerIndex && !u.destroyed && !u.surrendered);
      const weapons  = getEquippedWeapons(unit.armyUnit, unit.slotDamage).filter(w => !w.disabled && !unit.firedWeaponKeys.includes(w.key));
      const hasShot  = pickShot(unit, weapons, enemies, state.terrain);
      if (hasShot) return gameReducer(state, { type: 'START_SHOOT' });
    }

    return gameReducer(state, { type: 'END_ACTIVATION' });
  }

  // ── Select next unit to activate ─────────────────────────────────────────
  const phase = PLAY_PHASES[state.phaseIndex];
  if (!phase) return state;

  const nextUnit = state.units.find(u =>
    !u.activated && !u.destroyed && !u.surrendered &&
    u.playerIndex === state.activePlayer &&
    phase.types.includes(u.typeId)
  );

  if (nextUnit) return gameReducer(state, { type: 'SELECT_UNIT', unitId: nextUnit.id });

  // No unit available — phase should auto-advance via reducer, but guard against stuck state
  return state;
}

// ─── Run one full game ────────────────────────────────────────────────────────

const MAX_STEPS = 50_000;

function runGame(army0, army1, statsA, statsB) {
  let state = buildOnlineInitialState(['Alpha', 'Beta'], [army0, army1]);

  // Deploy all units
  let deploySteps = 0;
  while (state.phase === 'deploy' && deploySteps++ < 500) {
    state = aiDeploy(state);
  }
  if (state.phase === 'deploy') return null; // deploy failed

  let steps = 0;
  while (state.phase !== 'over' && steps++ < MAX_STEPS) {
    const before = state;
    state = aiStep(state);
    // Detect stuck (state didn't change)
    if (state === before) break;
  }

  if (state.phase !== 'over') return null; // didn't finish

  // Determine winner: check last log message first, then fall back to alive count
  const lastLog = state.log[state.log.length - 1]?.text ?? '';
  let winner = -1;
  if (lastLog.includes('Alpha wins')) winner = 0;
  if (lastLog.includes('Beta wins'))  winner = 1;
  if (winner === -1) {
    const alive0 = state.units.filter(u => u.playerIndex === 0 && !u.destroyed && !u.surrendered).length;
    const alive1 = state.units.filter(u => u.playerIndex === 1 && !u.destroyed && !u.surrendered).length;
    if (alive0 > alive1) winner = 0;
    else if (alive1 > alive0) winner = 1;
  }

  // Collect weapon stats — log format: "${unitName} fires ${weaponName} at ${target}: ..."
  // Build name→playerIndex map so we know who fired
  const nameToPlayer = new Map(state.units.map(u => [u.name, u.playerIndex]));
  for (const entry of state.log) {
    const m = entry.text.match(/^(.+?) fires (.+?)(?:\s\(Accurate\))? at .+?: \[.+?\] → (\d+) hit/);
    if (!m) continue;
    const [, unitName, wname, hitsStr] = m;
    const pi = nameToPlayer.get(unitName);
    if (pi == null) continue;
    const side = pi === 0 ? statsA : statsB;
    if (!side) continue;
    side.weaponFired[wname] = (side.weaponFired[wname] ?? 0) + 1;
    side.weaponHits[wname]  = (side.weaponHits[wname]  ?? 0) + parseInt(hitsStr);
  }

  // Damage per player
  const dmg = [0, 0];
  for (const u of state.units) {
    const enemy = 1 - u.playerIndex;
    const total = Object.values(u.slotDamage).reduce((a, b) => a + b, 0);
    dmg[enemy] += total;
  }

  const destroyed = [
    state.units.filter(u => u.playerIndex === 1 && (u.destroyed || u.surrendered)).length,
    state.units.filter(u => u.playerIndex === 0 && (u.destroyed || u.surrendered)).length,
  ];

  return { winner, round: state.round, dmg, destroyed, log: state.log };
}

// ─── Round-robin runner ───────────────────────────────────────────────────────

function runRoundRobin(armies, gamesPerMatchup) {
  const wins   = Object.fromEntries(armies.map(a => [a.armyName, 0]));
  const played = Object.fromEntries(armies.map(a => [a.armyName, 0]));
  let totalMatchups = 0, failedMatchups = 0;

  for (let i = 0; i < armies.length; i++) {
    for (let j = i + 1; j < armies.length; j++) {
      const a = armies[i], b = armies[j];
      let wA = 0, wB = 0, fail = 0;
      for (let g = 0; g < gamesPerMatchup; g++) {
        const r = runGame(a, b, null, null);
        if (!r) { fail++; continue; }
        if (r.winner === 0) wA++;
        else if (r.winner === 1) wB++;
      }
      const done = gamesPerMatchup - fail;
      if (done > 0) {
        wins[a.armyName]   += 100 * wA / done;
        wins[b.armyName]   += 100 * wB / done;
        played[a.armyName]++;
        played[b.armyName]++;
      }
      totalMatchups++;
      failedMatchups += (fail > gamesPerMatchup / 2 ? 1 : 0);
    }
  }

  const sorted = armies.slice().sort((a, b) =>
    (wins[b.armyName] / (played[b.armyName] || 1)) - (wins[a.armyName] / (played[a.armyName] || 1))
  );

  const COL = 22;
  for (const a of sorted) {
    const avg = played[a.armyName] ? wins[a.armyName] / played[a.armyName] : 0;
    const pts = armyPts(a);
    const unitDesc = a.units.map(u => u.typeId.replace('groundVehicle','GV').replace('heavyVehicle','HV')).join('+');
    console.log(`  ${a.armyName.padEnd(COL)} ${avg.toFixed(1).padStart(5)}%   ${pts}pts  [${unitDesc}]`);
  }
  if (failedMatchups) console.log(`  (${failedMatchups}/${totalMatchups} matchups had >50% timeouts)`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2).filter(a => a !== '--logs');
const showLogs = process.argv.includes('--logs');
const [nArg = '100', nameA = 'ironwall', nameB = 'sharpshot'] = rawArgs;
const N = Math.max(1, parseInt(nArg));

applyPatches();

// ── Budget-tier mode: npx tsx sim-game.js [games] tiers ──────────────────────
if (nameA === 'tiers') {
  console.log(`Budget tier round-robin — ${N} games per matchup\n`);
  for (const budget of [200, 250, 300]) {
    const tierArmies = TIER_ARMIES[budget];
    const matchups = tierArmies.length * (tierArmies.length - 1) / 2;
    console.log(`══ ${budget}pt Budget (${tierArmies.length} armies, ${matchups} matchups) ════════════════════`);
    runRoundRobin(tierArmies, N);
    console.log();
  }
  process.exit(0);
}

// ── Named-army mode: npx tsx sim-game.js [games] [armyA] [armyB] ─────────────
const army0 = ARMIES[nameA];
const army1 = ARMIES[nameB];

if (!army0) { console.error(`Unknown army: ${nameA}\nAvailable: ${Object.keys(ARMIES).join(', ')}`); process.exit(1); }
if (!army1) { console.error(`Unknown army: ${nameB}\nAvailable: ${Object.keys(ARMIES).join(', ')}`); process.exit(1); }

console.log(`Simulating ${N} games: ${army0.armyName} vs ${army1.armyName}\n`);

const statsA = { weaponFired: {}, weaponHits: {} };
const statsB = { weaponFired: {}, weaponHits: {} };

let wins = [0, 0], draws = 0, failed = 0;
let totalRounds = 0, totalDmg = [0, 0], totalDestroyed = [0, 0];

for (let i = 0; i < N; i++) {
  const r = runGame(army0, army1, statsA, statsB);
  if (!r) { failed++; continue; }
  if (showLogs && i === 0) {
    console.log('─── Game 1 log ──────────────────────────────────────────────────────────────');
    for (const entry of r.log) console.log(`  [R${entry.round ?? '?'}] ${entry.text}`);
    console.log('─────────────────────────────────────────────────────────────────────────────\n');
  }
  if (r.winner === 0) wins[0]++;
  else if (r.winner === 1) wins[1]++;
  else draws++;
  totalRounds += r.round;
  totalDmg[0]       += r.dmg[0];
  totalDmg[1]       += r.dmg[1];
  totalDestroyed[0] += r.destroyed[0];
  totalDestroyed[1] += r.destroyed[1];
}

const played = N - failed;
console.log(`Results (${played} completed, ${failed} failed/timeout):`);
console.log(`  ${army0.armyName.padEnd(22)} wins: ${wins[0].toString().padStart(4)} (${(100*wins[0]/played).toFixed(1)}%)`);
console.log(`  ${army1.armyName.padEnd(22)} wins: ${wins[1].toString().padStart(4)} (${(100*wins[1]/played).toFixed(1)}%)`);
if (draws) console.log(`  Draws: ${draws}`);
console.log(`  Avg rounds:              ${(totalRounds/played).toFixed(1)}`);
console.log(`  Avg dmg dealt  A→B:      ${(totalDmg[0]/played).toFixed(1)}`);
console.log(`  Avg dmg dealt  B→A:      ${(totalDmg[1]/played).toFixed(1)}`);
console.log(`  Avg units destroyed A:   ${(totalDestroyed[0]/played).toFixed(2)}`);
console.log(`  Avg units destroyed B:   ${(totalDestroyed[1]/played).toFixed(2)}`);

function printWeaponStats(label, stats) {
  const weapons = Object.keys(stats.weaponFired).sort((a, b) => stats.weaponFired[b] - stats.weaponFired[a]);
  if (!weapons.length) return;
  console.log(`\n  ${label} weapon usage (shots / avg hits per shot):`);
  for (const w of weapons) {
    const shots = stats.weaponFired[w];
    const hits  = stats.weaponHits[w] ?? 0;
    console.log(`    ${w.padEnd(30)} ${shots.toString().padStart(5)} shots  ${(hits/shots).toFixed(2)} avg hits`);
  }
}

printWeaponStats(army0.armyName, statsA);
printWeaponStats(army1.armyName, statsB);
console.log();
