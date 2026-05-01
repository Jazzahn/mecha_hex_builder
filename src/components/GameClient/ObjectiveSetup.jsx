import { useGame } from '../../store/gameContext';
import HexBoard from './HexBoard';
import { hexKey, hexDistance, BOARD_COLS, BOARD_ROWS, PLAYER_COLORS } from '../../game/hexMath';

function isValidPlacement(q, r, objectives, terrain) {
  if (terrain[hexKey(q, r)]?.type === 'blocking') return false;
  // More than 5 hexes from every board-edge hex (top/bottom rows, left/right cols)
  for (let eq = 0; eq < BOARD_COLS; eq++) {
    if (hexDistance(q, r, eq, 0) <= 5) return false;
    if (hexDistance(q, r, eq, BOARD_ROWS - 1) <= 5) return false;
  }
  for (let er = 1; er < BOARD_ROWS - 1; er++) {
    if (hexDistance(q, r, 0, er) <= 5) return false;
    if (hexDistance(q, r, BOARD_COLS - 1, er) <= 5) return false;
  }
  // More than 5 hexes from any already-placed objective
  for (const obj of objectives) {
    if (hexDistance(q, r, obj.q, obj.r) <= 5) return false;
  }
  return true;
}

export default function ObjectiveSetup() {
  const { gameState, dispatch } = useGame();
  const {
    objectives, terrain, playerNames,
    objectivesToPlace, objectivePlacingPlayer,
  } = gameState;

  const overlayHexes = new Map();
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let q = 0; q < BOARD_COLS; q++) {
      if (isValidPlacement(q, r, objectives, terrain)) {
        overlayHexes.set(hexKey(q, r), 'objective-valid');
      }
    }
  }

  function handleHexClick(q, r) {
    if (overlayHexes.has(hexKey(q, r))) {
      dispatch({ type: 'PLACE_OBJECTIVE', q, r });
    }
  }

  const remaining = objectivesToPlace - objectives.length;
  const placerColor = PLAYER_COLORS[objectivePlacingPlayer];

  return (
    <div className="game-layout">
      <div className="game-sidebar">
        <div className="sidebar-section">
          <h2>Place Objectives</h2>
          <div className="deploy-player-badge" style={{ borderColor: placerColor, color: placerColor }}>
            {playerNames[objectivePlacingPlayer]}'s turn
          </div>
          <p className="sidebar-hint">
            Click a highlighted hex to place an objective marker.
            Objectives must be placed more than 5 hexes from any board edge
            and more than 5 hexes from each other.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="obj-progress">
            <span className="obj-progress-label">Objectives to place:</span>
            <span className="obj-progress-count">{remaining} / {objectivesToPlace}</span>
          </div>
          <div className="obj-placed-list">
            {objectives.map((o, i) => (
              <div key={i} className="obj-placed-item">⬡ Objective {i + 1} at {o.q},{o.r}</div>
            ))}
          </div>
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
