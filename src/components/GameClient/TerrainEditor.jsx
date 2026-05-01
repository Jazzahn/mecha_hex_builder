import { useGame } from '../../store/gameContext';
import HexBoard from './HexBoard';

const TOOLS = [
  { key: 'cover',     label: 'Cover',     color: 'rgba(46,125,50,0.7)',  desc: '-1 to hit when shooting through' },
  { key: 'difficult', label: 'Difficult', color: 'rgba(230,145,0,0.7)', desc: '+1 SP to enter' },
  { key: 'blocking',  label: 'Blocking',  color: 'rgba(55,55,55,0.9)',   desc: 'Impassable; pushed units take 1 damage' },
  { key: 'dangerous', label: 'Dangerous', color: 'rgba(183,28,28,0.7)', desc: 'Take 1 damage on entry' },
  { key: 'elev-1',    label: 'Elevation 1', color: '#546e7a', desc: 'Set hex elevation to 1' },
  { key: 'elev-2',    label: 'Elevation 2', color: '#37474f', desc: 'Set hex elevation to 2' },
  { key: 'elev-3',    label: 'Elevation 3', color: '#263238', desc: 'Set hex elevation to 3' },
  { key: 'clear',     label: 'Clear',     color: '#555',      desc: 'Remove terrain from hex' },
];

export default function TerrainEditor() {
  const { gameState, dispatch } = useGame();
  const { terrainTool, terrain } = gameState;

  function handleHexClick(q, r) {
    dispatch({ type: 'APPLY_TERRAIN', q, r, tool: terrainTool });
  }

  function finishTerrain() {
    dispatch({ type: 'FINISH_TERRAIN' });
  }

  const terrainCount = Object.keys(terrain).length;

  return (
    <div className="game-layout">
      <div className="game-sidebar">
        <div className="sidebar-section">
          <h2>Terrain Editor</h2>
          <p className="sidebar-hint">Click hexes on the board to paint terrain. Place at least 5–10 pieces of terrain.</p>
        </div>

        <div className="sidebar-section">
          <div className="terrain-tools">
            {TOOLS.map(t => (
              <button
                key={t.key}
                className={`terrain-tool-btn${terrainTool === t.key ? ' terrain-tool-btn--active' : ''}`}
                onClick={() => dispatch({ type: 'SET_TERRAIN_TOOL', tool: t.key })}
                title={t.desc}
              >
                <span className="terrain-swatch" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="terrain-count">{terrainCount} hex{terrainCount !== 1 ? 'es' : ''} painted</div>
          <button
            className="sidebar-btn sidebar-btn--secondary"
            onClick={() => dispatch({ type: 'CLEAR_ALL_TERRAIN' })}
          >
            Clear All
          </button>
        </div>

        <div className="sidebar-section sidebar-section--bottom">
          <button className="sidebar-btn sidebar-btn--primary" onClick={finishTerrain}>
            Done — Start Deployment →
          </button>
        </div>
      </div>

      <div className="game-board-area">
        <HexBoard
          gameState={gameState}
          overlayHexes={new Map()}
          onHexClick={handleHexClick}
          onUnitClick={() => {}}
        />
      </div>
    </div>
  );
}
