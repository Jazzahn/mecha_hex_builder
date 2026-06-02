import { useRef, useState, useEffect } from 'react';
import { GameProvider, useGame, isActivePlayer } from '../../store/gameContext';
import RulesModal from '../RulesModal';
import GameSetup from './GameSetup';
import BotController from './BotController';
import TerrainEditor from './TerrainEditor';
import ObjectiveSetup from './ObjectiveSetup';
import DeployPhase from './DeployPhase';
import HexBoard from './HexBoard';
import UnitActionModal from './UnitActionModal';
import UnitTooltip from './UnitTooltip';
import { hexKey, hexDistance, hexNeighborAt, inBounds, inFrontArc, BOARD_COLS, BOARD_ROWS, PLAYER_COLORS } from '../../game/hexMath';
import { checkLOS, unitHeight } from '../../game/combat';
import { PLAY_PHASES } from '../../game/gameReducer';
import { UNIT_TYPES } from '../../data/gameData';

const TERRAIN_INFO = {
  cover:     { label: 'Cover',     color: '#33CC77', rule: '−1 Att die to attackers. Higher elevation ignores cover.' },
  difficult: { label: 'Difficult', color: '#FFCC00', rule: '+1 hex movement cost to enter. Does not block LOS.' },
  blocking:  { label: 'Blocking',  color: '#888',    rule: 'Impassable. Blocks LOS (Indirect weapons can still target).' },
  dangerous: { label: 'Dangerous', color: '#FF4444', rule: 'Take 1 damage when entering this hex.' },
};

function TerrainTooltip({ info, playerNames }) {
  const { terrainEntry, unitsOnHex, x, y } = info;
  const ti = terrainEntry?.type ? TERRAIN_INFO[terrainEntry.type] : null;
  const elev = terrainEntry?.elevation ?? 0;

  const style = {
    left: x + 12,
    top: y - 10,
    transform: x > 400 ? 'translateX(-110%)' : undefined,
  };

  return (
    <div className="terrain-tooltip" style={style}>
      {ti ? (
        <>
          <div className="terrain-tooltip-type" style={{ color: ti.color }}>{ti.label}</div>
          <div className="terrain-tooltip-rule">{ti.rule}</div>
        </>
      ) : (
        <div className="terrain-tooltip-type" style={{ color: '#FFA128' }}>Clear Ground</div>
      )}
      {elev > 0 && (
        <div className="terrain-tooltip-elev">Elevation: {elev}</div>
      )}
      {unitsOnHex.length > 0 && (
        <div className="terrain-tooltip-units">
          {unitsOnHex.map(u => (
            <div key={u.id} className="terrain-tooltip-unit"
              style={{ color: u.playerIndex === 0 ? '#90caf9' : '#ef9a9a' }}>
              {u.name} [{playerNames[u.playerIndex]}]
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MoralePanel({ pendingMorale, playerNames, dispatch }) {
  const { results } = pendingMorale;
  return (
    <div className="morale-overlay">
      <div className="morale-card">
        <div className="morale-card-title">Morale Check</div>
        {[0, 1].map(pi => {
          const group = results.filter(r => r.playerIndex === pi);
          if (group.length === 0) return null;
          return (
            <div key={pi} className="morale-player-group">
              <div className="morale-player-label" style={{ color: PLAYER_COLORS[pi] }}>
                {playerNames[pi]}
              </div>
              {group.map((r, i) => (
                <div key={i} className={`morale-result ${r.passed ? 'morale-result--pass' : 'morale-result--fail'}`}>
                  <span className="morale-unit-name">{r.unitName}</span>
                  {r.isVehicle
                    ? <span className="morale-roll-detail">all mecha fallen</span>
                    : <span className="morale-roll-detail">{r.roll} + {r.bonuses} = {r.total}</span>
                  }
                  <span className={`morale-verdict ${r.passed ? 'morale-verdict--pass' : 'morale-verdict--fail'}`}>
                    {r.passed ? 'Holds' : 'Surrenders'}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <button className="sidebar-btn sidebar-btn--primary morale-continue-btn"
          onClick={() => dispatch({ type: 'DISMISS_MORALE' })}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function PlayingView() {
  const { gameState, dispatch, localPlayerIndex } = useGame();
  const {
    selectedUnitId, units, pendingAction, pendingCombat, pendingMorale, terrain,
    phaseIndex, playerNames, activePlayer, round, log,
  } = gameState;

  const [hoveredWeaponEntry, setHoveredWeaponEntry] = useState(null);
  const [unitModalPos, setUnitModalPos] = useState(null);
  const [tooltipInfo, setTooltipInfo] = useState(null);
  const [explosions, setExplosions] = useState([]);
  const [hoveredHexInfo, setHoveredHexInfo] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const hoverTimerRef = useRef(null);
  const boardAreaRef = useRef(null);
  const prevUnitsRef = useRef(units);

  useEffect(() => {
    const prev = prevUnitsRef.current;
    const newlyDestroyed = units.filter(u =>
      u.destroyed && !prev.find(p => p.id === u.id)?.destroyed
    );
    if (newlyDestroyed.length > 0) {
      const added = newlyDestroyed.map(u => ({ id: `${u.id}-${Date.now()}`, q: u.q, r: u.r }));
      setExplosions(cur => [...cur, ...added]);
      added.forEach(exp => {
        setTimeout(() => setExplosions(cur => cur.filter(e => e.id !== exp.id)), 1500);
      });
    }
    prevUnitsRef.current = units;
  }, [units]);

  const isMyTurn = isActivePlayer(gameState, localPlayerIndex);

  const selectedUnit = units.find(u => u.id === selectedUnitId);

  // Build overlay hexes
  const overlayHexes = new Map();

  if (pendingAction?.remainingMoves != null && selectedUnit) {
    const { remainingMoves, isJumping } = pendingAction;

    if (isJumping) {
      for (let dir = 0; dir < 6; dir++) {
        const nb = hexNeighborAt(selectedUnit.q, selectedUnit.r, dir);
        if (inBounds(nb.q, nb.r))
          overlayHexes.set(hexKey(nb.q, nb.r), remainingMoves >= 1 ? 'step-forward' : 'step-blocked');
      }
    } else {
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
  }

  if (pendingCombat?.step === 'target-select') {
    const shooter = units.find(u => u.id === pendingCombat.attackerId);
    const selWeapon = pendingCombat.selectedWeaponIdx != null
      ? pendingCombat.weaponList[pendingCombat.selectedWeaponIdx]?.weapon : null;
    const isIndirectWeapon = selWeapon?.special?.includes('Indirect');
    pendingCombat.validTargets.forEach(targetId => {
      const u = units.find(x => x.id === targetId);
      if (!u) return;
      if (isIndirectWeapon && shooter) {
        const hasLOS = checkLOS(shooter.q, shooter.r, u.q, u.r, terrain,
          unitHeight(shooter.typeId), unitHeight(u.typeId));
        overlayHexes.set(hexKey(u.q, u.r), hasLOS ? 'valid-target' : 'indirect-target');
      } else {
        overlayHexes.set(hexKey(u.q, u.r), 'valid-target');
      }
    });
  }

  if (pendingCombat?.targetId && pendingCombat.step !== 'target-select' && pendingCombat.step !== 'ram-push') {
    const target = units.find(u => u.id === pendingCombat.targetId);
    if (target) overlayHexes.set(hexKey(target.q, target.r), 'combat-target');
  }

  // Ram: show enemy in forward hex as ram-target during ram action
  if (pendingAction?.action === 'ram' && pendingAction.remainingMoves != null && selectedUnit) {
    const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
    if (inBounds(fwd.q, fwd.r)) {
      const enemy = units.find(u => !u.destroyed && !u.surrendered &&
        u.playerIndex !== selectedUnit.playerIndex && u.q === fwd.q && u.r === fwd.r);
      if (enemy) overlayHexes.set(hexKey(fwd.q, fwd.r), 'ram-target');
    }
  }

  // Ram push: show valid push destination hexes
  if (pendingCombat?.step === 'ram-push') {
    (pendingCombat.validPushHexes ?? []).forEach(({ q, r }) => {
      overlayHexes.set(hexKey(q, r), 'ram-push-hex');
    });
  }

  if (hoveredWeaponEntry && pendingCombat?.step === 'weapon-select') {
    const attacker = units.find(u => u.id === pendingCombat.attackerId);
    if (attacker) {
      const weapon = hoveredWeaponEntry.weapon;
      const isIndirectWeapon = weapon.special?.includes('Indirect');
      const isJumpIndirect = !!attacker.hasJumped;
      const hasTurret = UNIT_TYPES[attacker.typeId]?.special?.includes('Turret');
      const attackerH = unitHeight(attacker.typeId);
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let q = 0; q < BOARD_COLS; q++) {
          const dist = hexDistance(attacker.q, attacker.r, q, r);
          if (dist < 1 || dist > weapon.range) continue;
          // Turrets and jump-indirect bypass arc; indirect weapons still need front arc
          if (!hasTurret && !isJumpIndirect && !inFrontArc(attacker.q, attacker.r, attacker.facing, q, r)) continue;
          const hasLOS = checkLOS(attacker.q, attacker.r, q, r, terrain, attackerH, 2);
          if (!isIndirectWeapon && !isJumpIndirect && !hasLOS) continue;
          overlayHexes.set(hexKey(q, r), (isIndirectWeapon && !hasLOS) ? 'range-ring-indirect' : 'range-ring');
        }
      }
    }
  }

  function handleHexClick(q, r) {
    // Ram push resolution — push chooser clicks a purple hex
    if (pendingCombat?.step === 'ram-push') {
      const isChooser = localPlayerIndex == null || localPlayerIndex === pendingCombat.pushChooserIndex;
      if (isChooser && (pendingCombat.validPushHexes ?? []).some(h => h.q === q && h.r === r)) {
        dispatch({ type: 'RESOLVE_RAM_PUSH', q, r });
      }
      return;
    }

    if (pendingAction?.remainingMoves != null && selectedUnit) {
      // Ram action: clicking an enemy in the forward hex executes the ram;
      // clicking an empty forward/backward hex moves normally (approach).
      if (pendingAction.action === 'ram') {
        const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
        if (fwd.q === q && fwd.r === r) {
          const enemy = units.find(u => !u.destroyed && !u.surrendered &&
            u.playerIndex !== selectedUnit.playerIndex && u.q === q && u.r === r);
          if (enemy) { dispatch({ type: 'EXECUTE_RAM', targetId: enemy.id }); return; }
          dispatch({ type: 'STEP_MOVE', direction: 'forward' });
          return;
        }
        const bwdFacing = (selectedUnit.facing + 3) % 6;
        const bwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, bwdFacing);
        if (bwd.q === q && bwd.r === r) dispatch({ type: 'STEP_MOVE', direction: 'backward' });
        return;
      }

      if (pendingAction.isJumping) {
        for (let dir = 0; dir < 6; dir++) {
          const nb = hexNeighborAt(selectedUnit.q, selectedUnit.r, dir);
          if (nb.q === q && nb.r === r) { dispatch({ type: 'STEP_MOVE', direction: dir }); return; }
        }
        return;
      }
      const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
      const bwdFacing = (selectedUnit.facing + 3) % 6;
      const bwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, bwdFacing);
      if (fwd.q === q && fwd.r === r) dispatch({ type: 'STEP_MOVE', direction: 'forward' });
      else if (bwd.q === q && bwd.r === r) dispatch({ type: 'STEP_MOVE', direction: 'backward' });
    }
  }

  function handleUnitClick(unitId) {
    if (pendingCombat?.step === 'target-select') {
      if (pendingCombat.validTargets.includes(unitId)) {
        dispatch({ type: 'SELECT_COMBAT_TARGET', targetId: unitId });
      }
      return;
    }

    // Ram action: clicking an adjacent forward enemy executes the ram
    if (pendingAction?.action === 'ram' && pendingAction.remainingMoves != null && selectedUnit) {
      const unit = units.find(u => u.id === unitId);
      if (unit && !unit.destroyed && !unit.surrendered && unit.playerIndex !== selectedUnit.playerIndex) {
        const fwd = hexNeighborAt(selectedUnit.q, selectedUnit.r, selectedUnit.facing);
        if (fwd.q === unit.q && fwd.r === unit.r) {
          dispatch({ type: 'EXECUTE_RAM', targetId: unitId });
          return;
        }
      }
      return;
    }

    if (pendingAction) return;
    if (selectedUnitId === unitId) {
      dispatch({ type: 'DESELECT_UNIT' });
    } else {
      dispatch({ type: 'SELECT_UNIT', unitId });
    }
  }

  function handleUnitPos(pos) {
    setUnitModalPos(pos);
  }

  function handleHoverUnit(unitId, clientX, clientY) {
    clearTimeout(hoverTimerRef.current);
    if (!unitId) { setTooltipInfo(null); return; }
    hoverTimerRef.current = setTimeout(() => {
      const rect = boardAreaRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltipInfo({ unitId, x: clientX - rect.left, y: clientY - rect.top });
    }, 1000);
  }

  function handleHoverHex(q, r, clientX, clientY) {
    if (q === null) { setHoveredHexInfo(null); return; }
    const rect = boardAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const terrainEntry = terrain[hexKey(q, r)] ?? null;
    const unitsOnHex = units.filter(u => !u.destroyed && !u.surrendered && u.q === q && u.r === r);
    if (!terrainEntry && unitsOnHex.length === 0) { setHoveredHexInfo(null); return; }
    setHoveredHexInfo({ terrainEntry, unitsOnHex, x: clientX - rect.left, y: clientY - rect.top });
  }

  const phase = PLAY_PHASES[phaseIndex];
  const phaseUnits = units.filter(u => phase?.types.includes(u.typeId) && !u.destroyed && !u.surrendered);
  const activatedCount = phaseUnits.filter(u => u.activated).length;

  return (
    <div className="game-layout game-layout--playing">
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      <div className="game-sidebar">
        <div className="sidebar-section">
          <div className="action-panel-status">
            <div className="status-round">Round {round} / 4</div>
            <div className="status-phase">{phase?.label}</div>
            <div className="status-player" style={{ color: activePlayer === 0 ? '#90caf9' : '#ef9a9a' }}>
              {playerNames[activePlayer]}'s turn
            </div>
          </div>
          {!isMyTurn && <div className="action-hint" style={{ color: '#888' }}>Waiting for opponent…</div>}
          {isMyTurn && !selectedUnit && (
            <div className="action-hint">
              Click one of {playerNames[activePlayer]}'s unactivated units to select it.
            </div>
          )}
          <div className="phase-progress" style={{ marginTop: 10 }}>
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

        <div className="sidebar-section sidebar-section--rules-btn">
          <button className="sidebar-btn" style={{ width: '100%', textAlign: 'center', letterSpacing: '0.06em' }}
            onClick={() => setShowRules(true)}>
            ? Rules Reference
          </button>
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

      <div className="game-board-area" ref={boardAreaRef} style={{ position: 'relative' }}>
        {pendingMorale && (
          <MoralePanel pendingMorale={pendingMorale} playerNames={playerNames} dispatch={dispatch} />
        )}
        <HexBoard
          gameState={gameState}
          overlayHexes={overlayHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
          onTurnLeft={() => dispatch({ type: 'STEP_TURN', dir: 'left' })}
          onTurnRight={() => dispatch({ type: 'STEP_TURN', dir: 'right' })}
          onUnitPos={handleUnitPos}
          onHoverUnit={handleHoverUnit}
          onHoverHex={handleHoverHex}
          explosions={explosions}
        />
        {hoveredHexInfo && <TerrainTooltip info={hoveredHexInfo} playerNames={playerNames} />}
        <UnitActionModal
          position={unitModalPos}
          boardWidth={boardAreaRef.current?.offsetWidth}
          onWeaponHover={setHoveredWeaponEntry}
        />
        {tooltipInfo && (
          <UnitTooltip
            unitId={tooltipInfo.unitId}
            position={{ x: tooltipInfo.x, y: tooltipInfo.y }}
          />
        )}
      </div>
    </div>
  );
}

function GameOver() {
  const { gameState, onExit } = useGame();
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
      {onExit && (
        <button className="game-over-menu-btn" onClick={onExit}>← Back to Menu</button>
      )}
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

export default function GameClient({ onExit, initialConfig = null }) {
  const [gameConfig, setGameConfig] = useState(initialConfig);

  if (!gameConfig) {
    return (
      <div className="game-root">
        <div className="game-nav">
          <button className="game-nav-back" onClick={onExit}>← Menu</button>
          <span className="game-nav-title">Mechatech — Battle Setup</span>
        </div>
        <GameSetup onStart={(names, armies, botPlayerIndex) => setGameConfig({ names, armies, botPlayerIndex })} />
      </div>
    );
  }

  return (
    <div className="game-root">
      <GameProvider
        playerNames={gameConfig.names}
        armies={gameConfig.armies}
        localPlayerIndex={gameConfig.botPlayerIndex != null ? 0 : null}
        botPlayerIndex={gameConfig.botPlayerIndex ?? null}
        onExit={onExit}
      >
        {gameConfig.botPlayerIndex != null && <BotController botPlayerIndex={gameConfig.botPlayerIndex} />}
        <GameInner />
      </GameProvider>
    </div>
  );
}
