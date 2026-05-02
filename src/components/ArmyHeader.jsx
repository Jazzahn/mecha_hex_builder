import { useArmy } from '../store/armyStore';
import { useBuilder } from '../store/builderContext';
import { calcPoints } from '../utils/validation';

export default function ArmyHeader({ onPlayClick, onOnlineClick }) {
  const { army, dispatch, save, load } = useArmy();
  const { printLegend, setPrintLegend } = useBuilder();
  const spent = calcPoints(army);
  const over = spent > army.pointLimit;

  return (
    <header className="army-header">
      <div className="army-header-title">
        <input
          className="army-name-input"
          value={army.armyName}
          onChange={e => dispatch({ type: 'SET_ARMY_NAME', name: e.target.value })}
          placeholder="Army Name"
        />
        <span className="game-title">MECHA: HEX Army Builder</span>
      </div>
      <div className="army-header-controls">
        <label className="pts-label">
          Point Limit:
          <input
            type="number"
            min={50}
            max={9999}
            step={50}
            value={army.pointLimit}
            onChange={e => dispatch({ type: 'SET_POINT_LIMIT', limit: Number(e.target.value) })}
            className="pts-input"
          />
        </label>
        <div className={`pts-tracker ${over ? 'over-budget' : ''}`}>
          <span className="pts-spent">{spent}</span>
          <span className="pts-sep">/</span>
          <span className="pts-limit">{army.pointLimit}</span>
          <span className="pts-unit">pts</span>
        </div>
        <div className="header-actions">
          <button onClick={save} title="Save to browser storage">Save</button>
          <button onClick={load} title="Load from browser storage">Load</button>
          <button
            onClick={() => localStorage.setItem('mechaArmy_p1', JSON.stringify(army))}
            title="Save as Player 1's army for the game client"
          >Save as P1</button>
          <button
            onClick={() => localStorage.setItem('mechaArmy_p2', JSON.stringify(army))}
            title="Save as Player 2's army for the game client"
          >Save as P2</button>
          <label className="legend-toggle" title="Include a special rules reference on the printed sheet">
            <input
              type="checkbox"
              checked={printLegend}
              onChange={e => setPrintLegend(e.target.checked)}
            />
            Print legend
          </label>
          <button onClick={() => window.print()} title="Print roster">Print</button>
          <button
            className="play-btn"
            onClick={onPlayClick}
            title="Launch local game"
          >
            ▶ Play
          </button>
          <button
            className="play-btn play-btn--online"
            onClick={onOnlineClick}
            title="Play online"
          >
            ⬡ Online
          </button>
        </div>
      </div>
    </header>
  );
}
