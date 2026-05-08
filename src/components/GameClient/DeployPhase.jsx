import { useState } from 'react';
import { useGame } from '../../store/gameContext';
import { hexKey, isDeployZone, hexNeighborAt, inBounds, BOARD_COLS, BOARD_ROWS, PLAYER_COLORS } from '../../game/hexMath';
import { UNIT_TYPES } from '../../data/gameData';
import HexBoard from './HexBoard';

export default function DeployPhase() {
  const { gameState, dispatch, localPlayerIndex } = useGame();
  const {
    deployPlayerIndex, deployUnitIndex, deployedCount,
    armies, units, terrain, playerNames,
  } = gameState;

  const isMyDeployTurn = localPlayerIndex == null || localPlayerIndex === deployPlayerIndex;

  const [pendingDeployHex, setPendingDeployHex] = useState(null);

  const army = armies[deployPlayerIndex];
  const occupied = new Set(units.map(u => hexKey(u.q, u.r)));

  // Build list of undeployed units for current player
  const deployedIds = new Set(
    units.filter(u => u.playerIndex === deployPlayerIndex).map(u => u.armyUnit.id)
  );
  const undeployed = army.units.filter(u => !deployedIds.has(u.id));

  // Build overlay: highlight valid deploy hexes (hide when choosing facing)
  const overlayHexes = new Map();
  if (!pendingDeployHex && deployUnitIndex !== null && deployUnitIndex !== undefined) {
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
  if (pendingDeployHex) {
    overlayHexes.set(hexKey(pendingDeployHex.q, pendingDeployHex.r), 'deploy-chosen');
    for (let f = 0; f < 6; f++) {
      const nb = hexNeighborAt(pendingDeployHex.q, pendingDeployHex.r, f);
      if (inBounds(nb.q, nb.r)) overlayHexes.set(hexKey(nb.q, nb.r), 'facing-choice');
    }
  }

  function handleHexClick(q, r) {
    if (!isMyDeployTurn) return;
    if (pendingDeployHex) {
      // Check if clicking a facing-direction neighbor
      for (let facing = 0; facing < 6; facing++) {
        const nb = hexNeighborAt(pendingDeployHex.q, pendingDeployHex.r, facing);
        if (nb.q === q && nb.r === r) {
          dispatch({ type: 'DEPLOY_UNIT', q: pendingDeployHex.q, r: pendingDeployHex.r, facing });
          setPendingDeployHex(null);
          return;
        }
      }
      // Clicking elsewhere cancels the facing pick
      setPendingDeployHex(null);
      return;
    }
    if (deployUnitIndex === null || deployUnitIndex === undefined) return;
    if (!isDeployZone(q, r, deployPlayerIndex)) return;
    if (occupied.has(hexKey(q, r))) return;
    if (terrain[hexKey(q, r)]?.type === 'blocking') return;
    setPendingDeployHex({ q, r });
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
            {pendingDeployHex
              ? 'Click a direction arrow on the board to set facing.'
              : `Select a unit, then click a highlighted hex in your deployment zone (${deployPlayerIndex === 0 ? 'top 5 rows' : 'bottom 5 rows'}).`
            }
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
                  onClick={() => isMyDeployTurn && dispatch({ type: 'SELECT_DEPLOY_UNIT', index: armyIdx })}
                  style={{ borderColor: isSelected ? playerColor : undefined }}
                >
                  <span className="deploy-unit-name">{u.name}</span>
                  <span className="deploy-unit-type">{ut.name}</span>
                </button>
              );
            })}
          </div>
        </div>

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
          deployFacingOrigin={pendingDeployHex}
        />
      </div>
    </div>
  );
}
