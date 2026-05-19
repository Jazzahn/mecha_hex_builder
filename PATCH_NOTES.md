# Mecha: HEX — Patch Notes

---

## v0.7.0 — Single Player Bot
*2026-05-18*

### New Features
- **Play vs Bot mode** — new toggle in game setup lets a single player battle an AI opponent. No second army required.
- **Procedural bot army generation** — the bot builds its own army to match the player's point limit. Chassis selection is weighted by cost with randomisation for variety; slots are filled greedily with weapons from a tiered priority list. Vehicle composition rules (max GVs, vehicle ≤ mech ratio) are respected.
- **Custom bot army support** — advanced players can load a specific army into the Player 2 slot in vs-bot mode to control the bot's composition.
- **Obstacle-aware pathfinding** — the bot now evaluates all six neighbouring hexes each movement step and picks the best passable one, allowing it to route around blocking terrain instead of getting stuck.

### Bot AI Behaviour
- Targets the nearest enemy and moves to engage
- Selects weapons by highest expected damage (accounting for min range, cover, and Accurate keyword)
- Assigns damage to the most-wounded active slot
- Handles jump movement, turret units, indirect fire, and all combat step types (hit rolls, block rolls, damage assignment, overheat, ram, push resolution)

---

## v0.6.0 — Balance Pass
*2026-05-16*

### Army Building
- **Ground Vehicle cost:** 10 pts → 15 pts
- **Heavy Vehicle cost:** 20 pts → 25 pts
- **New rule:** Maximum 1 Ground Vehicle per 50 points of army limit (enforced in validation)

### Weapons — Minimum Range keyword added
Units firing at targets within the minimum range suffer an Att penalty equal to `(minimum range − target's range + 1)`, to a minimum of 1 Att die.

| Weapon | Minimum Range |
|---|---|
| PPC | 1 |
| Gauss Rifle | 1 |
| Ultra AC/2 | 1 |
| LB 2-X AC | 2 |
| Autocannon/2 | 2 |
| LRM-5 | 2 |
| LRM-10 | 2 |
| LRM-20 | 2 |
| Arrow IV Artillery | 3 |

### Weapons — LRM changes
- **LRM-5, LRM-10, LRM-20:** Removed Deadly keyword. LRMs now deal standard damage without the guaranteed +1 per hit.

### Indirect Fire — Rule Fix
- Indirect weapons now require the attacker to be in the **front arc** of the target to fire (same as direct-fire weapons). Exception: units that **jumped** this activation may fire indirect in any direction regardless of facing.
- The **−1 die penalty** is now based on **line of sight**, not movement:
  - Target in LOS → no penalty (full attack dice)
  - Target outside LOS → −1 die penalty
  - Previously: penalty applied when the attacker had moved, regardless of LOS

### UI — Indirect Targeting Overlay
- When selecting a target for an Indirect weapon, hexes now display in two colours:
  - **Orange** — target is in LOS (no penalty)
  - **Purple** — target is outside LOS (−1 die penalty applies)
- Weapon hover ring similarly splits into orange (direct) and purple (indirect) zones.

### Combat Panel
- Hit roll display now shows **Min Range −N die** and **Indirect −N die** penalties separately.

---

## v0.5.0 — Monte Carlo Simulator & Test Suite
*2026-05-14*

### Tooling
- **sim-game.js** — offline Node.js balance simulator running round-robin Monte Carlo matchups across predefined army archetypes at 200, 250, and 300 point brackets.
- **test-balance.js** — automated test suite validating army composition rules and point calculations.

### Balance findings addressed in v0.6.0
- Vehicle swarm armies (cheap GVs at 10pts) achieved disproportionate win rates (>70%) at 200pts due to activation economy advantage.
- Indirect Barrage archetype dominated after indirect rules correction; Deadly on LRMs was the primary driver.

---

## v0.4.0 — Bug Fixes
*2026-05~*

- Fixed incorrect damage sequence when multiple hits resolved in a single combat step.
- Fixed push resolution bugs where pushed units could overlap occupied hexes.
- Fixed SPA fallback route compatibility with Express 5 wildcard syntax.
- Various build and deployment fixes.

---

## v0.3.0 — Sprites & Visual Polish
*2026-05~*

- Added sprite art for all vehicle unit types.
- Added sprites for blocking terrain tiles.
- Added explosion animation on unit destruction.

---

## v0.2.0 — BattleTech Weapons Overhaul
*2026-05~*

- Replaced placeholder weapon names and stats with a full BattleTech-inspired weapon roster:
  - Lasers: Small, Medium, Large (standard and Pulse variants), ER variants
  - Autocannons: AC/2, AC/10, AC/20
  - Ultra ACs: Ultra AC/2, Ultra AC/5, Ultra AC/10
  - LB-X ACs: LB 2-X, LB 5-X, LB 10-X
  - Missiles: LRM-5, LRM-10, LRM-20, Streak SRM Rack
  - Support: Machine Gun Array, Arrow IV Artillery
  - Energy: PPC, Gauss Rifle
- Added weapon keywords: Accurate, Ammo Box, Blast, Deadly, Indirect, Light Arms, Overheating, Relentless.

---

## v0.1.0 — Initial Release
*2026-05~*

### Core Systems
- **Army Builder** — point-limited list building with unit type selection, slot-based upgrade/weapon assignment, hero and title support, save/load from browser storage, print view.
- **Battle Client** — full local two-player game with:
  - Terrain editor (blocking, cover, difficult, dangerous, elevation)
  - Objective placement and scoring
  - Deploy phase with alternating unit placement
  - Four-round game with six activation phases per round
  - Complete combat pipeline: hit dice, block dice, damage assignment, special rules
  - Overheat, Ammo Box, Blast, Indirect, Deadly, Relentless, Jump (Boost Jets), Ram
  - Morale checks and surrender
  - Rogue activation support
- **Online Client** — real-time multiplayer via Express/WebSocket with lobby and room codes.
- **Hex grid** — SVG rendering with flat-top offset coordinates, LOS tracing through elevation, cover and arc detection.
