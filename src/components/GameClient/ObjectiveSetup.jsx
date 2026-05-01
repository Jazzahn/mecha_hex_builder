import { useGame } from '../../store/gameContext';
import HexBoard from './HexBoard';
import { hexKey, hexDistance, BOARD_COLS, BOARD_ROWS, PLAYER_COLORS } from '../../game/hexMath';

// Objectives must be more than 5 hexes from the deployment edges (top row 0 / bottom row 16).
// No column restriction. Minimum 3-hex separation between objectives.
// Gives 75 valid hexes; worst-case 4 remain after placing 3 objs — safe for D3+1 (2-4).
const OBJ_MIN_ROW  = 6;               // >5 from row 0
const OBJ_MAX_ROW  = BOARD_ROWS - 7;  // >5 from row 16 → row 10
const OBJ_MIN_DIST = 3;

function isValidPlacement(q, r, objectives, terrain) {
  if (terrain[hexKey(q, r)]?.type === 'blocking') return false;
  if (r < OBJ_MIN_ROW || r > OBJ_MAX_ROW) return false;
  for (const obj of objectives) {
    if (hexDistance(q, r, obj.q, obj.r) <= OBJ_MIN_DIST) return false;
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
