const UNIT_TABLE = [
  { name: 'Assault Mecha', pts: 100, walk: 2, run: 3, eva: '2+', tou: '2+', slots: 13 },
  { name: 'Heavy Mecha',   pts: 80,  walk: 3, run: 5, eva: '3+', tou: '3+', slots: 10 },
  { name: 'Medium Mecha',  pts: 60,  walk: 4, run: 6, eva: '4+', tou: '4+', slots: 7  },
  { name: 'Light Mecha',   pts: 40,  walk: 5, run: 8, eva: '5+', tou: '5+', slots: 5  },
  { name: 'Ground Vehicle',pts: 15,  walk: 5, run: 8, eva: '5+', tou: '5+', slots: 1, special: 'Turret' },
  { name: 'Heavy Vehicle', pts: 25,  walk: 4, run: 6, eva: '4+', tou: '4+', slots: 2, special: 'Armored, Turret' },
  { name: 'Armed Structure', pts: 20, walk: '—', run: '—', eva: '2+', tou: '4+', slots: 3, special: 'Armored, Turret' },
  { name: 'Unarmed Structure', pts: 0, walk: '—', run: '—', eva: '2+', tou: '5+', slots: 1, special: 'Armored, Landing Zone, NPC' },
  { name: 'Fortified Structure', pts: 0, walk: '—', run: '—', eva: '2+', tou: '2+', slots: 1, special: 'Armored, NPC' },
];

const WEAPON_TABLE = [
  { name: 'Sm Laser',            range: 3,  att: 3, str: 0, slots: 1, special: 'Deadly' },
  { name: 'Md Laser',            range: 6,  att: 4, str: 1, slots: 2, special: 'Overheating, Deadly' },
  { name: 'Lg Laser',            range: 9,  att: 4, str: 2, slots: 3, special: 'Overheating, Deadly' },
  { name: 'Sm Pulse Laser',      range: 3,  att: 4, str: 0, slots: 1, special: 'Accurate' },
  { name: 'Md Pulse Laser',      range: 6,  att: 6, str: 1, slots: 2, special: 'Overheating, Accurate' },
  { name: 'Lg Pulse Laser',      range: 9,  att: 6, str: 2, slots: 3, special: 'Overheating, Accurate' },
  { name: 'ER Sm Laser',         range: 6,  att: 2, str: 1, slots: 1, special: 'Overheating, Deadly' },
  { name: 'ER Md Laser',         range: 9,  att: 3, str: 1, slots: 2, special: 'Overheating, Deadly' },
  { name: 'Streak SRM',          range: 3,  att: 3, str: 0, slots: 1, special: 'Ammo Box, Accurate, Deadly' },
  { name: 'LRM-5',               range: 9,  att: 2, str: 0, slots: 1, minRange: 2, special: 'Ammo Box, Indirect' },
  { name: 'LRM-10',              range: 9,  att: 4, str: 0, slots: 2, minRange: 2, special: 'Ammo Box, Indirect' },
  { name: 'LRM-20',              range: 9,  att: 6, str: 0, slots: 3, minRange: 2, special: 'Ammo Box, Indirect' },
  { name: 'A/C 2',               range: 10, att: 2, str: 1, slots: 1, minRange: 2, special: 'Ammo Box, Relentless' },
  { name: 'A/C 10',              range: 6,  att: 4, str: 2, slots: 2, special: 'Ammo Box, Relentless' },
  { name: 'A/C 20',              range: 4,  att: 6, str: 3, slots: 3, special: 'Ammo Box, Relentless, Deadly' },
  { name: 'UA/C 2',              range: 10, att: 3, str: 0, slots: 1, minRange: 1, special: 'Ammo Box, Relentless' },
  { name: 'UA/C 5',              range: 9,  att: 6, str: 1, slots: 2, special: 'Ammo Box, Relentless' },
  { name: 'UA/C 10',             range: 6,  att: 8, str: 2, slots: 3, special: 'Ammo Box, Relentless' },
  { name: 'LB-X A/C 2',         range: 10, att: 3, str: 0, slots: 1, minRange: 2, special: 'Ammo Box, Relentless' },
  { name: 'LB-X A/C 5',         range: 9,  att: 6, str: 0, slots: 2, special: 'Ammo Box, Relentless' },
  { name: 'LB-X A/C 10',        range: 6,  att: 10,str: 0, slots: 3, special: 'Ammo Box, Relentless' },
  { name: 'MG Array',            range: 3,  att: 8, str: 0, slots: 1, special: 'Ammo Box, Relentless, Light Arms' },
  { name: 'Arrow IV',            range: 12, att: 3, str: 2, slots: 3, minRange: 3, special: 'Ammo Box, Indirect, Blast' },
  { name: 'PPC',                 range: 9,  att: 2, str: 3, slots: 3, minRange: 1, special: 'Overheating, Deadly' },
  { name: 'Gauss Rifle',         range: 9,  att: 2, str: 2, slots: 3, minRange: 1, special: 'Ammo Box, Deadly' },
];

const KEYWORDS = [
  { kw: 'Accurate',    rule: 'Each hit counts as 2 hits before the block roll.' },
  { kw: 'Ammo Box',    rule: 'The first time per round that this upgrade takes damage, it takes +1 damage.' },
  { kw: 'Armored',     rule: 'This unit must take at least one armor upgrade (Extra Armor, Reinforced Plating, or Hardened Armor).' },
  { kw: 'Blast',       rule: 'If the target is hit, all models within 2 hexes of the target are also hit (friend or foe).' },
  { kw: 'Deadly',      rule: 'If at least 1 hit goes unblocked, the whole attack deals +1 damage. Stacks with Str.' },
  { kw: 'Indirect',    rule: 'May target enemies not in LOS; ignores cover from blocking obstructions. Takes −1 att die when fired without LOS.' },
  { kw: 'Light Arms',  rule: 'Lacks armor penetration. Defender gains +1 Toughness die when blocking hits from this weapon.' },
  { kw: 'Overheating', rule: 'Each natural 1 rolled to hit is an Overheat result: the unit suffers 1 damage and may destroy a Heat Sinks upgrade (once per activation).' },
  { kw: 'Relentless',  rule: 'May split attacks across multiple targets. Declare all targets before rolling; rolls may not be changed afterward.' },
  { kw: 'Turret',      rule: 'May fire weapons in any direction, ignoring the unit\'s facing.' },
  { kw: 'Landing Zone',rule: 'Other units may end their activation on this structure (overrides the normal "no stacking" rule).' },
  { kw: 'NPC',         rule: 'Not a player-controlled unit — represents a terrain structure that can be targeted and destroyed.' },
  { kw: 'Rogue',       rule: 'May activate during phases other than its normal phase, but only to move or shoot.' },
];

const UPGRADES = [
  { name: 'Boost Jets',          slots: '1–3', rule: 'This mecha may Jump instead of walking normally. Jump: turn to any facing, move up to Walk hexes in any direction (ignoring terrain cost and adjacency). Cannot shoot if you jumped and moved.' },
  { name: 'Experimental Armor',  slots: '2', rule: 'When this unit takes 1 point of damage, roll 1d6. On a 5+ the damage is ignored.' },
  { name: 'Extra Armor',         slots: '1', rule: 'This upgrade takes 3 damage to be disabled. At least one armor upgrade is required on Armored units.' },
  { name: 'Reinforced Plating', slots: '2', rule: 'This upgrade takes 5 damage to be disabled.' },
  { name: 'Hardened Armor',     slots: '3', rule: 'This upgrade takes 7 damage to be disabled.' },
  { name: 'Heat Sinks',         slots: '1', rule: 'Cancel up to 3 Overheat results per activation. Destroyed when used to cancel Overheat. Max 2 per unit.' },
  { name: 'High Tuned Engine',   slots: '1–2', rule: 'Grants +1 hex on Walk actions and +2 hexes on Run or Ram actions.' },
  { name: 'Melee Optimized',     slots: '1', rule: 'Deals +1 damage when ramming or being rammed.' },
  { name: 'Reinforced Frame',    slots: '1', rule: 'Takes −1 damage when ramming or being rammed (minimum 1).' },
  { name: 'Reinforced Hydraulics', slots: '1', rule: 'Enemy models are pushed +1 additional hex when rammed by this unit.' },
  { name: 'RAM Armor',           slots: '2', rule: 'This unit always counts as being in cover when targeted from more than 6 hexes away.' },
];

const HEROES = [
  { name: 'Tactical Master', pts: 15, rule: 'May be held off-board at deployment. Can deploy anywhere 5+ hexes from enemies at the start of any later round.' },
  { name: 'Ace Pilot',       pts: 10, rule: 'This mecha gains the Rogue special rule.' },
  { name: 'Ace Custom',      pts: 10, rule: 'This mecha gains one additional upgrade slot in any location of your choice.' },
];

const TITLES = [
  { name: 'Vanguard', pts: 10, rule: 'When deployed, the unit may immediately take a Walk action.' },
  { name: 'Avenger',  pts: 5,  rule: 'One weapon upgrade of your choice on this unit gains Relentless.' },
  { name: 'Defiant',  pts: 5,  rule: 'When a friendly mecha within 6 hexes is destroyed, you may remove 2 damage from this unit.' },
];

function Section({ id, title, children }) {
  return (
    <section className="rules-section" id={id}>
      <div className="rules-section-title">{title}</div>
      <div className="rules-section-body">{children}</div>
    </section>
  );
}

function RuleRow({ label, children }) {
  return (
    <div className="rules-row">
      <span className="rules-row-label">{label}</span>
      <span className="rules-row-text">{children}</span>
    </div>
  );
}

export default function RulesModal({ onClose }) {
  return (
    <div className="rules-overlay" onClick={onClose}>
      <div className="rules-modal" onClick={e => e.stopPropagation()}>
        <div className="rules-header">
          <span className="rules-header-title">// MECHA: HEX — RULES REFERENCE //</span>
          <button className="rules-close-btn" onClick={onClose}>✕ CLOSE</button>
        </div>

        <nav className="rules-toc">
          {['overview','army-building','unit-types','turn-structure','movement','combat','terrain','los','ramming','morale','weapons','keywords','upgrades','heroes','victory'].map(id => (
            <a key={id} className="rules-toc-link" href={`#${id}`} onClick={e => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>{id.replace(/-/g, ' ')}</a>
          ))}
        </nav>

        <div className="rules-body">

          <Section id="overview" title="Overview">
            <p>Mechatech is a two-player tactical game played on a hexagonal grid over 4 rounds. Each player commands an army of mecha, vehicles, and structures, competing to hold more objectives than the opponent when the final round ends.</p>
          </Section>

          <Section id="army-building" title="Army Building">
            <RuleRow label="Point Limit">Agree on a point limit before the game (default 200 pts). Both armies must not exceed this limit.</RuleRow>
            <RuleRow label="Unit Cost">Each unit costs its Pts value. Heroes and Titles add to the cost of the mecha they are attached to.</RuleRow>
            <RuleRow label="Weapon Slots">Each mecha has slots split across Torso, Left Arm, and Right Arm. Vehicles and structures have a single shared pool. Weapons and upgrades fill slots by their slot cost.</RuleRow>
            <RuleRow label="Armored Units">Heavy Vehicles and Armed Structures must have at least one armor upgrade (Extra Armor, Reinforced Plating, or Hardened Armor) installed.</RuleRow>
          </Section>

          <Section id="unit-types" title="Unit Types">
            <div className="rules-scroll-x">
              <table className="rules-table">
                <thead>
                  <tr>
                    <th>Unit</th><th>Pts</th><th>Walk</th><th>Run</th><th>Eva</th><th>Tou</th><th>Slots</th><th>Special</th>
                  </tr>
                </thead>
                <tbody>
                  {UNIT_TABLE.map(u => (
                    <tr key={u.name}>
                      <td>{u.name}</td>
                      <td>{u.pts || '—'}</td>
                      <td>{u.walk}</td>
                      <td>{u.run}</td>
                      <td>{u.eva}</td>
                      <td>{u.tou}</td>
                      <td>{u.slots}</td>
                      <td className="rules-dim">{u.special || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rules-note">Walk and Run are in hexes. Eva and Tou are the roll needed on a d6 to succeed (lower = harder to hit/damage).</p>
          </Section>

          <Section id="turn-structure" title="Turn Structure">
            <RuleRow label="Phases">Each round consists of 5 phases in order: Vehicles → Light Mecha → Medium Mecha → Heavy Mecha → Assault Mecha. Structures act during the phase matching their weapon types.</RuleRow>
            <RuleRow label="Alternating Activations">Within each phase, players alternate activating one eligible unit at a time. The player with initiative activates first.</RuleRow>
            <RuleRow label="Initiative">The player who wins initiative (determined each round) activates first in each phase. Ties are broken in favor of the player who had it last round.</RuleRow>
            <RuleRow label="Activation">On a unit's activation it may: Walk (or Run or Ram) AND Shoot (one weapon per activation, unless Relentless). A unit may choose to do only one of these. After activating, the unit is marked and cannot activate again this phase.</RuleRow>
          </Section>

          <Section id="movement" title="Movement">
            <RuleRow label="Walk Action">Move up to Walk hexes forward or backward (2 hexes backward costs 1 extra). May also turn one facing step (60°) each time you move forward or backward.</RuleRow>
            <RuleRow label="Run Action">Move up to Run hexes in a straight line (facing direction only). You may not turn during a Run. You cannot shoot on the same activation you Run.</RuleRow>
            <RuleRow label="Facing">Each unit faces one of 6 directions. Front arc = the 3 hexes in front. Weapons can only target the front arc unless the unit has Turret.</RuleRow>
            <RuleRow label="Turning">During a Walk, you may turn 1 step (60°) per hex moved. You do not have to move before turning. Each backward step costs 2 move points instead of 1.</RuleRow>
            <RuleRow label="Jumping">If the unit has Boost Jets, it may Jump instead of walking. Choose a new facing, then move up to Walk hexes in any direction (including diagonals). Jumping ignores terrain movement costs and elevation restrictions but grants cover to the jumping unit.</RuleRow>
            <RuleRow label="Difficult Terrain">Costs +1 hex of movement to enter (2 total instead of 1).</RuleRow>
            <RuleRow label="Elevation">Moving up by 1 elevation level costs +1 hex. You cannot move up more than 1 level per hex in a single Walk action. Moving down costs no extra.</RuleRow>
            <RuleRow label="Blocking Terrain">Cannot be entered or moved through.</RuleRow>
            <RuleRow label="Stacking">Two active units cannot occupy the same hex. Units may pass through friendly hexes but not end there.</RuleRow>
          </Section>

          <Section id="combat" title="Combat">
            <RuleRow label="Attack Roll">Roll a number of d6 equal to the weapon's Att value. Each die that meets or beats the target's Eva score is a hit. Accurate weapons treat each success as 2 hits.</RuleRow>
            <RuleRow label="Toughness Roll">For each hit, the defender rolls 1d6. Each die that meets or beats the defender's Tou score blocks 1 hit. Remaining unblocked hits deal damage.</RuleRow>
            <RuleRow label="Damage">Each unblocked hit deals 1 damage to a slot of the defender's choice. A slot is disabled when it has taken damage equal to its slot cost (armor upgrades use their own damage threshold: 3 / 5 / 7). Disabled upgrades no longer function.</RuleRow>
            <RuleRow label="Strength">A weapon with Str deals +Str damage per unblocked hit. A hit from a Str 2 weapon deals 2 damage to a single slot or split across slots.</RuleRow>
            <RuleRow label="Deadly">If at least 1 hit goes unblocked, the whole attack deals +1 damage (not per hit). A Deadly Str 1 weapon that lands 3 net hits deals 5 damage total (3 + 1 Str + 1 Deadly), not 6.</RuleRow>
            <RuleRow label="Cover">A unit in a Cover terrain hex, behind blocking terrain (from the attacker's perspective), or with RAM Armor reduces the attacker's Att by 1. A jumping unit also counts as in cover. Units on higher ground ignore cover granted by lower terrain.</RuleRow>
            <RuleRow label="Minimum Range">Some weapons have a minimum range. Firing within minimum range applies a penalty of −(minRange − distance + 1) to Att, minimum 1 die always fires.</RuleRow>
            <RuleRow label="Shoot Restriction">A unit that Ran cannot Shoot in the same activation. A unit can fire one weapon per activation. Relentless weapons may split their attacks across multiple targets declared before rolling.</RuleRow>
          </Section>

          <Section id="terrain" title="Terrain">
            <RuleRow label="Cover">Units on a cover hex or obscured by cover gain −1 to the attacker's Att dice pool. Cover does not block LOS. Units at higher elevation than the cover terrain ignore the cover bonus.</RuleRow>
            <RuleRow label="Difficult">Costs +1 hex of movement to enter. Does not block LOS.</RuleRow>
            <RuleRow label="Blocking">Cannot be entered or moved through. Blocks all LOS (except Indirect weapons ignore this for targeting purposes).</RuleRow>
            <RuleRow label="Dangerous">A unit that enters a Dangerous hex takes 1 damage immediately to a slot of their choice.</RuleRow>
            <RuleRow label="Elevation">Hexes can be at elevation 0, 1, or 2. Higher ground provides LOS advantages — see Line of Sight. Each level of elevation costs +1 hex to move up into.</RuleRow>
          </Section>

          <Section id="los" title="Line of Sight">
            <p>LOS is traced between the center of the attacker's hex and the center of the target's hex through all intervening hexes.</p>
            <RuleRow label="Blocking Terrain">Blocking terrain hexes block LOS entirely. Any blocking hex on the line = no LOS.</RuleRow>
            <RuleRow label="Elevation">Eye level = hex elevation + unit height (mecha/structures = 2, vehicles = 1). LOS is blocked by any intervening hex whose elevation meets or exceeds the lower of the two eye levels.</RuleRow>
            <RuleRow label="Cover Terrain">Cover terrain does not block LOS but grants a cover bonus to the target.</RuleRow>
            <RuleRow label="Indirect Weapons">Indirect weapons may fire without LOS. They take −1 Att die when doing so. They still ignore cover granted by blocking terrain obstructions.</RuleRow>
          </Section>

          <Section id="ramming" title="Ramming">
            <RuleRow label="Ram Action">Instead of a Run, a unit may Ram: move up to Run hexes in a straight line and, if an enemy ends up in the forward hex, deal ram damage to both units.</RuleRow>
            <RuleRow label="Ram Damage">Each unit involved rolls a number of d6 equal to their base Tou value. Each success deals 1 damage to a slot on the opponent. Additional damage from Melee Optimized and reduced damage from Reinforced Frame apply here.</RuleRow>
            <RuleRow label="Push">After a successful ram, the target is pushed 1 hex in the direction of the ram (if the destination is clear). Reinforced Hydraulics pushes +1 additional hex.</RuleRow>
            <RuleRow label="Cannot Shoot">A unit that performs a Ram action cannot Shoot in the same activation.</RuleRow>
          </Section>

          <Section id="morale" title="Morale">
            <RuleRow label="Trigger">At the end of each round: if a player has lost half or more of their starting mecha count, each of their surviving mecha must make a Morale Check.</RuleRow>
            <RuleRow label="Morale Roll">Roll 1d6 and add the number of non-disabled upgrade slots on the unit. If the total is 6 or more, the unit holds. If less than 6, the unit surrenders.</RuleRow>
            <RuleRow label="Surrender">A surrendered unit is removed from play. It counts as destroyed for all purposes including victory scoring.</RuleRow>
            <RuleRow label="Vehicle Cascade">If all of a player's mecha are destroyed or surrendered, their vehicles automatically surrender as well.</RuleRow>
          </Section>

          <Section id="weapons" title="Weapons">
            <div className="rules-scroll-x">
              <table className="rules-table">
                <thead>
                  <tr>
                    <th>Weapon</th><th>Range</th><th>Min</th><th>Att</th><th>Str</th><th>Slots</th><th>Keywords</th>
                  </tr>
                </thead>
                <tbody>
                  {WEAPON_TABLE.map(w => (
                    <tr key={w.name}>
                      <td>{w.name}</td>
                      <td>{w.range}</td>
                      <td>{w.minRange ?? '—'}</td>
                      <td>{w.att}</td>
                      <td>{w.str}</td>
                      <td>{w.slots}</td>
                      <td className="rules-dim">{w.special}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="keywords" title="Keywords">
            {KEYWORDS.map(({ kw, rule }) => (
              <div key={kw} className="rules-keyword-entry">
                <span className="rules-keyword-name">{kw}</span>
                <span className="rules-keyword-rule">{rule}</span>
              </div>
            ))}
          </Section>

          <Section id="upgrades" title="Upgrades">
            {UPGRADES.map(({ name, slots, rule }) => (
              <div key={name} className="rules-upgrade-entry">
                <div className="rules-upgrade-header">
                  <span className="rules-upgrade-name">{name}</span>
                  <span className="rules-upgrade-cost">{slots} slot{slots === '1' ? '' : 's'}</span>
                </div>
                <div className="rules-upgrade-rule">{rule}</div>
              </div>
            ))}
          </Section>

          <Section id="heroes" title="Heroes &amp; Titles">
            <p className="rules-note">Heroes and Titles are attached to individual mecha and add to their points cost.</p>
            {HEROES.map(({ name, pts, rule }) => (
              <div key={name} className="rules-upgrade-entry">
                <div className="rules-upgrade-header">
                  <span className="rules-upgrade-name">{name}</span>
                  <span className="rules-upgrade-cost">+{pts} pts</span>
                </div>
                <div className="rules-upgrade-rule">{rule}</div>
              </div>
            ))}
            <div className="rules-section-divider" />
            {TITLES.map(({ name, pts, rule }) => (
              <div key={name} className="rules-upgrade-entry">
                <div className="rules-upgrade-header">
                  <span className="rules-upgrade-name">{name}</span>
                  <span className="rules-upgrade-cost">+{pts} pts</span>
                </div>
                <div className="rules-upgrade-rule">{rule}</div>
              </div>
            ))}
          </Section>

          <Section id="victory" title="Victory Conditions">
            <RuleRow label="Objectives">Objectives are placed on the board during setup. A unit captures an objective by moving onto its hex and spending 1 hex of movement.</RuleRow>
            <RuleRow label="Carrying">A unit carrying an objective must drop it if it is destroyed or surrenders. The objective remains at that hex.</RuleRow>
            <RuleRow label="End of Game">After 4 full rounds, the player holding more objectives wins. If tied, the player who destroyed more enemy units wins. If still tied, it is a draw.</RuleRow>
            <RuleRow label="Annihilation">If all of one player's units are destroyed or surrendered before round 4 ends, the opponent wins immediately.</RuleRow>
          </Section>

        </div>
      </div>
    </div>
  );
}
