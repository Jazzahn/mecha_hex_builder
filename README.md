# Mecha: HEX

A browser-based army builder and battle client for **Mecha: HEX**, a hex-grid tactical wargame featuring mechs, vehicles, and structures. Build your force, set up the battlefield, and fight turn-based battles — locally, online, or against an AI bot.

---

## About the Game

Mecha: HEX is a tabletop-style skirmish game played on a hex grid. Each player commands a force of mechs and support vehicles, activating them by weight class each round through a structured phase order — Vehicles → Light Mechs → Medium Mechs → Heavy Mechs → Assault Mechs. Objectives are contested across four rounds; the player who controls the most at the end wins.

Combat uses a dice-pool system: attacking units roll a pool of dice based on weapon Attacks, and defenders block with their Toughness. Upgrades, terrain, cover, range, facing, and elevation all influence the outcome. Special weapon keywords like **Accurate**, **Relentless**, **Indirect**, **Blast**, **Overheating**, and **Deadly** create meaningful tactical choices.

### Unit Types

| Type | Points | Notes |
|---|---|---|
| Assault Mech | 100 | Slowest, most durable, most slots |
| Heavy Mech | 80 | Strong all-rounder |
| Medium Mech | 60 | Balanced speed and firepower |
| Light Mech | 40 | Fast and evasive |
| Heavy Vehicle | 25 | Armored, turret-equipped, must take Extra Armor |
| Ground Vehicle | 15 | Fast, cheap, one weapon slot |

**Army building rules:** Vehicles may not outnumber mechs. Max 1 Ground Vehicle per 50 points. Heroes limited to 1 per 200 points.

### Terrain

The battlefield is built by players before deployment using the in-app terrain editor. Terrain types include:

- **Blocking** — impassable, blocks line of sight
- **Cover** — passable, grants +1 Toughness to defenders
- **Difficult** — passable, costs +1 movement to enter
- **Dangerous** — passable, deals damage to units moving through
- **Elevation** — raises ground height; affects LOS and charge height differences

### Combat Overview

1. **Select a unit** to activate in the current phase
2. **Move** (standard) or **Cruise** (extended, no shoot) — jumping requires Boost Jets
3. **Shoot** with equipped weapons; Indirect weapons fire without LOS but suffer a −1 die penalty
4. Resolve **hit rolls**, **block rolls**, **damage assignment**, and any special effects (Overheat, Ammo Box, Blast, etc.)
5. **End activation** — repeat until all units have activated, then advance to the next phase

### Weapon Keywords

| Keyword | Effect |
|---|---|
| Accurate | +1 to hit (doubles effective hit rolls) |
| Ammo Box | First damage to this slot deals +1 |
| Blast | Hit spreads to all models within 2 hexes |
| Deadly | Always +1 damage per hit |
| Indirect | Fire without LOS; −1 die penalty when no LOS |
| Light Arms | Defender gains +1 Toughness against this weapon |
| Overheating | Each 1 rolled to hit generates an Overheat wound |
| Relentless | Split attacks across multiple declared targets |

---

## App Features

### Army Builder
- Add any combination of mechs and vehicles within a point limit
- Equip weapons and upgrades in named slot locations (torso, left arm, right arm, or single for vehicles)
- Full validation: slot limits, vehicle ratios, hero caps, armored unit requirements
- Save armies to browser storage as Player 1 or Player 2 slots
- Print-ready army card view

### Battle Client (Local)
- Hex grid board with interactive terrain editor
- Objective placement and contested scoring
- Full deploy phase with alternating placement
- Complete rules implementation: movement, facing, cruise, jump, ram, shoot, block, damage, morale, surrender
- Turn-based phase order across 4 rounds
- In-game unit tooltips, action modal, and combat panel with dice display

### Battle Client (Online)
- Real-time multiplayer via the included Express server
- Lobby system with room codes
- Synchronized game state with reconnect support

### Single Player vs Bot
- AI opponent that builds its own army to match your point limit
- Bot navigates terrain, manages facing, selects weapons by expected damage, and assigns damage intelligently
- "Play vs Bot" toggle in game setup — no second army needed

---

## Tech Stack

- **Frontend:** React 18, Vite
- **State:** React `useReducer` — all game logic in a pure reducer (`gameReducer.js`)
- **Styling:** Plain CSS
- **Backend:** Node.js + Express (online mode only)
- **Rendering:** SVG hex grid

---

## Running Locally

```bash
npm install
npm run dev         # Frontend only (local play, no online)
npm run start       # Express server + Vite build (online mode)
```

The dev server runs on `http://localhost:5173` by default. Online mode requires the Express server running on port 3000 (or as configured in `railway.json`).

---

## Credits

**Code:** AI-assisted development using [Claude](https://claude.ai) (Anthropic). All game logic, rules implementation, AI behaviour, and application architecture was developed through an iterative human–AI collaboration.

**Art assets:** All sprite artwork, icons, and visual assets are original human-created work.

**Game design:** Mecha: HEX rules and balance are original designs by the project author.

---

## Repository Structure

```
src/
  components/
    GameClient/       # Battle board, combat UI, deploy phase, bot controller
    OnlineClient/     # Multiplayer lobby and sync
    *.jsx             # Army builder components
  data/
    gameData.js       # All unit types, weapons, upgrades, keywords
  game/
    ai.js             # Bot AI (move, shoot, damage assignment)
    combat.js         # Hit/block resolution, LOS, cover, weapons
    generateBotArmy.js# Procedural army generation for bot
    gameReducer.js    # Pure game state reducer (all rules)
    hexMath.js        # Hex grid geometry and coordinate math
  store/
    armyStore.jsx     # Army builder state
    gameContext.jsx   # Battle game state context
  utils/
    validation.js     # Army validation rules
server/
  index.js            # Express server for online multiplayer
sim-game.js           # Monte Carlo balance simulator (Node.js, offline tool)
```
