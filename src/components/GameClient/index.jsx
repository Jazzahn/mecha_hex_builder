import { useState } from 'react';
import { GameProvider, useGame } from '../../store/gameContext';
import GameSetup from './GameSetup';
import TerrainEditor from './TerrainEditor';
import ObjectiveSetup from './ObjectiveSetup';
import DeployPhase from './DeployPhase';
import HexBoard from './HexBoard';
import ActionPanel from './ActionPanel';
import CombatPanel from './CombatPanel';
import { hexKey, hexDistance, hexNeighborAt, inBounds, inFrontArc, BOARD_COLS, BOARD_ROWS } from '../../game/hexMath';
import { checkLOS, unitHeight } from '../../game/combat';
import { PLAY_PHASES } from '../../game/gameReducer';
import { UNIT_TYPES } from '../../data/gameData';

function PlayingView() {
  const { gameState, dispatch } = useGame();
  const {
    selectedUnitId, units, pendingAction, pendingCombat, terrain,
    phaseIndex, playerNames, activePlayer, round, log,
  } = gameState;

  const [hoveredWeaponEntry, setHoveredWeaponEntry] = useState(null);

  const selectedUnit = units.find(u => u.id === selectedUnitId);

  // Build overlay hexes
  const overlayHexes = new Map();

  // Step-movement overlays: forward hex (green) and backward hex (amber), grayed if too expensive
  if (pendingAction?.remainingMoves != null && selectedUnit) {
    const { remainingMoves } = pendingAction;
    const stepCost = (fromQ, fromR, toQ, toR, isForward) => {
      const t = terrain[hexKey(toQ, toR)];
      if (t?.type === 'blocking') return null;
      let c = isForward ? 1 : 2;
      if (t?.type === 'difficult') c++;
      const elDiff = (t?.elevation ?? 0) - (terrain[hexKey(fromQ, fromR)]?.elevation ?? 0);
      if (elDiff > 1) return null;
      if (elDiff > 0) c += elDiff;
      return c;
    };
    const isOccupied = (q, r) =>
      units.some(u => !u.destroyed && !u.surrendered && u.id !== selectedUnit.id && u.q === q && u.r === r);

    const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
    if (inBounds(fwd.q, fwd.r) && !isOccupied(fwd.q, fwd.r)) {
      const cost = stepCost(selectedUnit.q, selectedUnit.r, fwd.q, fwd.r, true);
      if (cost !== null)
        overlayHexes.set(hexKey(fwd.q, fwd.r), cost <= remainingMoves ? 'step-forward' : 'step-blocked');
    }

    const bwdFacing = (selectedUnit.facing + 3) % 6;
    const bwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, bwdFacing);
    if (inBounds(bwd.q, bwd.r) && !isOccupied(bwd.q, bwd.r)) {
      const cost = stepCost(selectedUnit.q, selectedUnit.r, bwd.q, bwd.r, false);
      if (cost !== null)
        overlayHexes.set(hexKey(bwd.q, bwd.r), cost <= remainingMoves ? 'step-back' : 'step-blocked');
    }
  }

  if (pendingCombat?.step === 'target-select') {
    pendingCombat.validTargets.forEach(targetId => {
      const u = units.find(x => x.id === targetId);
      if (u) overlayHexes.set(hexKey(u.q, u.r), 'valid-target');
    });
  }

  if (pendingCombat?.targetId && pendingCombat.step !== 'target-select') {
    const target = units.find(u => u.id === pendingCombat.targetId);
    if (target) overlayHexes.set(hexKey(target.q, target.r), 'combat-target');
  }

  // Weapon range ring: only hexes in arc + LOS, matching actual targeting rules
  if (hoveredWeaponEntry && pendingCombat?.step === 'weapon-select') {
    const attacker = units.find(u => u.id === pendingCombat.attackerId);
    if (attacker) {
      const weapon = hoveredWeaponEntry.weapon;
      const isIndirect = weapon.special?.includes('Indirect');
      const hasTurret = UNIT_TYPES[attacker.typeId]?.special?.includes('Turret');
      const attackerH = unitHeight(attacker.typeId);
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let q = 0; q < BOARD_COLS; q++) {
          const dist = hexDistance(attacker.q, attacker.r, q, r);
          if (dist < 1 || dist > weapon.range) continue;
          if (!hasTurret && !isIndirect && !inFrontArc(attacker.q, attacker.r, attacker.facing, q, r)) continue;
          // Use mech height (2) as the assumed target height for the ring — most conservative
          if (!isIndirect && !checkLOS(attacker.q, attacker.r, q, r, terrain, attackerH, 2)) continue;
          overlayHexes.set(hexKey(q, r), 'range-ring');
        }
      }
    }
  }

  function handleHexClick(q, r) {
    if (pendingAction?.remainingMoves != null && selectedUnit) {
      const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
      const bwdFacing = (selectedUnit.facing + 3) % 6;
      const bwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, bwdFacing);
      if (fwd.q === q && fwd.r === r) dispatch({ type: 'STEP_MOVE', direction: 'forward' });
      else if (bwd.q === q && bwd.r === r) dispatch({ type: 'STEP_MOVE', direction: 'backward' });
    }
  }

  function handleUnitClick(unitId) {
    // Target selection mode
    if (pendingCombat?.step === 'target-select') {
      if (pendingCombat.validTargets.includes(unitId)) {
        dispatch({ type: 'SELECT_COMBAT_TARGET', targetId: unitId });
      }
      return;
    }
    // Lock out token clicks while a move action is in progress — prevents
    // deselect → reselect → fresh SP exploit
    if (pendingAction) return;
    // Normal unit selection
    if (selectedUnitId === unitId) {
      dispatch({ type: 'DESELECT_UNIT' });
    } else {
      dispatch({ type: 'SELECT_UNIT', unitId });
    }
  }

  const phase = PLAY_PHASES[phaseIndex];
  const phaseUnits = units.filter(u => phase?.types.includes(u.typeId) && !u.destroyed);
  const activatedCount = phaseUnits.filter(u => u.activated).length;
  const hasMoved = !!pendingAction?.moved;

  return (
    <div className="game-layout game-layout--playing">
      <div className="game-sidebar">
        <ActionPanel />

        <div className="sidebar-section">
          <div className="phase-progress">
            <div className="phase-progress-label">{phase?.label}</div>
            <div className="phase-progress-bar">
              <div
                className="phase-progress-fill"
                style={{ width: phaseUnits.length ? `${(activatedCount / phaseUnits.length) * 100}%` : '0%' }}
              />
            </div>
            <div className="phase-progress-count">{activatedCount} / {phaseUnits.length} activated</div>
          </div>
        </div>

        <div className="sidebar-section sidebar-section--log">
          <div className="game-log-label">Battle Log</div>
          <div className="game-log">
            {[...log].reverse().map((entry, i) => (
              <div key={i} className="game-log-entry">
                <span className="log-round">R{entry.round}</span> {entry.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="game-board-area" style={{ position: 'relative' }}>
        <HexBoard
          gameState={gameState}
          overlayHexes={overlayHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
          onTurnLeft={() => dispatch({ type: 'STEP_TURN', dir: 'left' })}
          onTurnRight={() => dispatch({ type: 'STEP_TURN', dir: 'right' })}
        />
        {pendingCombat && (
          <CombatPanel
            pendingCombat={pendingCombat}
            units={units}
            dispatch={dispatch}
            hasMoved={hasMoved}
            onWeaponHover={setHoveredWeaponEntry}
          />
        )}
      </div>
    </div>
  );
}

function GameOver() {
  const { gameState } = useGame();
  const { objectives, units, playerNames, log } = gameState;

  const scores = [0, 1].map(pi =>
    objectives.filter(o => {
      if (!o.carrierId) return false;
      return units.find(u => u.id === o.carrierId)?.playerIndex === pi;
    }).length
  );
  const unclaimed = objectives.filter(o => !o.carrierId).length;
  const winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;

  return (
    <div className="game-over">
      <h1>Game Over</h1>
      <div className="game-over-scores">
        {[0, 1].map(pi => (
          <div key={pi} className={`game-over-score${winner === pi ? ' game-over-score--winner' : ''}`}>
            <span className="score-name">{playerNames[pi]}</span>
            <span className="score-count">{scores[pi]} objective{scores[pi] !== 1 ? 's' : ''}</span>
          </div>
        ))}
        {unclaimed > 0 && (
          <div className="game-over-unclaimed">{unclaimed} unclaimed objective{unclaimed !== 1 ? 's' : ''} on the field</div>
        )}
      </div>
      <div className="game-over-result">
        {winner === -1 ? "It's a tie!" : `${playerNames[winner]} wins!`}
      </div>
      <div className="game-over-log">
        {log.map((e, i) => <div key={i}><b>R{e.round}:</b> {e.text}</div>)}
      </div>
    </div>
  );
}

export function GameInner() {
  const { gameState } = useGame();
  switch (gameState.phase) {
    case 'terrain':          return <TerrainEditor />;
    case 'objective-setup':  return <ObjectiveSetup />;
    case 'deploy':           return <DeployPhase />;
    case 'playing':          return <PlayingView />;
    case 'over':             return <GameOver />;
    default:                 return null;
  }
}

export default function GameClient({ onExit }) {
  const [gameConfig, setGameConfig] = useState(null);

  if (!gameConfig) {
    return (
      <div className="game-root">
        <div className="game-nav">
          <button className="game-nav-back" onClick={onExit}>← Army Builder</button>
          <span className="game-nav-title">Mecha: HEX — Battle</span>
        </div>
        <GameSetup onStart={(names, armies) => setGameConfig({ names, armies })} />
      </div>
    );
  }

  return (
    <div className="game-root">
      <div className="game-nav">
        <button className="game-nav-back" onClick={onExit}>← Army Builder</button>
        <span className="game-nav-title">Mecha: HEX — Battle</span>
      </div>
      <GameProvider playerNames={gameConfig.names} armies={gameConfig.armies}>
        <GameInner />
      </GameProvider>
    </div>
  );
}
