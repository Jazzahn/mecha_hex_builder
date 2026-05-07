import { useState } from 'react';
import { useGame } from '../../store/gameContext';
import { hexKey, isDeployZone, BOARD_COLS, BOARD_ROWS, PLAYER_COLORS } from '../../game/hexMath';
import { UNIT_TYPES } from '../../data/gameData';
import HexBoard from './HexBoard';

const FACING_LABELS = ['E →', 'NE ↗', 'NW ↖', '← W', '↙ SW', 'SE ↘'];

export default function DeployPhase() {
  const { gameState, dispatch } = useGame();
  const {
    deployPlayerIndex, deployUnitIndex, deployedCount,
    armies, units, terrain, playerNames,
  } = gameState;

  const [pendingDeployHex, setPendingDeployHex] = useState(null);

  const army = armies[deployPlayerIndex];
  const occupied = new Set(units.map(u => hexKey(u.q, u.r)));

  // Build list of undeployed units for current player
  const deployedIds = new Set(
    units.filter(u => u.playerIndex === deployPlayerIndex).map(u => u.armyUnit.id)
  );
  const undeployed = army.units.filter(u => !deployedIds.has(u.id));

  // Build overlay: highlight valid deploy hexes
  const overlayHexes = new Map();
  if (deployUnitIndex !== null && deployUnitIndex !== undefined) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let q = 0; q < BOARD_COLS; q++) {
        const hk = hexKey(q, r);
        if (!isDeployZone(q, r, deployPlayerIndex)) continue;
        const t = terrain[hk];
        if (t?.type === 'blocking') continue;
        if (occupied.has(hk)) continue;
        overlayHexes.set(hk, 'deploy-valid');
      }
    }
  }

  function handleHexClick(q, r) {
    if (deployUnitIndex === null || deployUnitIndex === undefined) return;
    if (!isDeployZone(q, r, deployPlayerIndex)) return;
    if (occupied.has(hexKey(q, r))) return;
    if (terrain[hexKey(q, r)]?.type === 'blocking') return;
    setPendingDeployHex({ q, r });
  }

  function handleFacingSelect(facing) {
    if (!pendingDeployHex) return;
    dispatch({ type: 'DEPLOY_UNIT', q: pendingDeployHex.q, r: pendingDeployHex.r, facing });
    setPendingDeployHex(null);
  }

  function selectUnit(index) {
    dispatch({ type: 'SELECT_DEPLOY_UNIT', index: army.units.indexOf(undeployed[index]) });
  }

  const playerColor = PLAYER_COLORS[deployPlayerIndex];
  const totalP0 = armies[0].units.length;
  const totalP1 = armies[1].units.length;

  return (
    <div className="game-layout">
      <div className="game-sidebar">
        <div className="sidebar-section">
          <h2>Deployment</h2>
          <div className="deploy-player-badge" style={{ borderColor: playerColor, color: playerColor }}>
            {playerNames[deployPlayerIndex]}'s turn to deploy
          </div>
          <p className="sidebar-hint">
            Select a unit, then click a highlighted hex in your deployment zone (
            {deployPlayerIndex === 0 ? 'top 5 rows' : 'bottom 5 rows'}).
          </p>
        </div>

        <div className="sidebar-section">
          <div className="deploy-progress">
            <div>{playerNames[0]}: {deployedCount[0]} / {totalP0}</div>
            <div>{playerNames[1]}: {deployedCount[1]} / {totalP1}</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="deploy-unit-list-label">
            Undeployed — {playerNames[deployPlayerIndex]}:
          </div>
          <div className="deploy-unit-list">
            {undeployed.length === 0 && (
              <div className="deploy-unit-done">All deployed!</div>
            )}
            {undeployed.map((u, i) => {
              const ut = UNIT_TYPES[u.typeId];
              const armyIdx = army.units.indexOf(u);
              const isSelected = deployUnitIndex === armyIdx;
              return (
                <button
                  key={u.id}
                  className={`deploy-unit-btn${isSelected ? ' deploy-unit-btn--selected' : ''}`}
                  onClick={() => dispatch({ type: 'SELECT_DEPLOY_UNIT', index: armyIdx })}
                  style={{ borderColor: isSelected ? playerColor : undefined }}
                >
                  <span className="deploy-unit-name">{u.name}</span>
                  <span className="deploy-unit-type">{ut.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {pendingDeployHex && (
          <div className="sidebar-section">
            <div className="deploy-facing-label">Choose facing for {playerNames[deployPlayerIndex]}:</div>
            <div className="deploy-facing-grid">
              {FACING_LABELS.map((label, i) => (
                <button key={i} className="deploy-facing-btn" onClick={() => handleFacingSelect(i)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="action-btn action-btn--cancel" onClick={() => setPendingDeployHex(null)}>
              Cancel
            </button>
          </div>
        )}

        <div className="sidebar-section sidebar-section--bottom">
          <button
            className="sidebar-btn sidebar-btn--primary"
            disabled={deployedCount[0] < totalP0 || deployedCount[1] < totalP1}
            onClick={() => dispatch({ type: 'START_GAME' })}
          >
            Start Battle →
          </button>
        </div>
      </div>

      <div className="game-board-area">
        <HexBoard
          gameState={gameState}
          overlayHexes={overlayHexes}
          onHexClick={handleHexClick}
          onUnitClick={() => {}}
        />
      </div>
    </div>
  );
}
