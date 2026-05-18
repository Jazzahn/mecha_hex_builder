import { useState, useEffect } from 'react';

function tryLoad(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ArmySlot({ label, colorClass, army, onLoad, onClear }) {
  return (
    <div className={`army-slot ${colorClass}`}>
      <div className="army-slot-label">{label}</div>
      {army ? (
        <div className="army-slot-loaded">
          <div className="army-slot-name">{army.armyName}</div>
          <div className="army-slot-detail">{army.units.length} units · {army.pointLimit}pts</div>
          <button className="army-slot-clear" onClick={onClear}>✕ Clear</button>
        </div>
      ) : (
        <div className="army-slot-empty">
          <div className="army-slot-hint">No army loaded</div>
          <button className="army-slot-load" onClick={onLoad}>Load saved army</button>
        </div>
      )}
    </div>
  );
}

export default function GameSetup({ onStart }) {
  const [playerNames, setPlayerNames] = useState(['Player 1', 'Bot']);
  const [armies, setArmies] = useState([null, null]);
  const [vsBot, setVsBot] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Try to pre-load saved slot armies on mount
    const p1 = tryLoad('mechaArmy_p1') ?? tryLoad('mechaArmy');
    const p2 = tryLoad('mechaArmy_p2');
    setArmies([p1, p2]);
  }, []);

  function loadArmy(playerIndex) {
    // Try player-specific slot first, then shared slot
    const key = playerIndex === 0 ? 'mechaArmy_p1' : 'mechaArmy_p2';
    const fallback = 'mechaArmy';
    const army = tryLoad(key) ?? tryLoad(fallback);
    if (!army) {
      setError(`No saved army found for Player ${playerIndex + 1}. Save one from the Army Builder using "Save as P${playerIndex + 1}".`);
      return;
    }
    setError('');
    setArmies(prev => prev.map((a, i) => i === playerIndex ? JSON.parse(JSON.stringify(army)) : a));
  }

  function clearArmy(playerIndex) {
    setArmies(prev => prev.map((a, i) => i === playerIndex ? null : a));
  }

  function handleStart() {
    if (!armies[0] || armies[0].units.length === 0) {
      setError('Player 1 needs an army. Load one above.');
      return;
    }
    if (!vsBot && (!armies[1] || armies[1].units.length === 0)) {
      setError('Player 2 needs an army. Load one above.');
      return;
    }
    if (vsBot && (!armies[1] || armies[1].units.length === 0)) {
      // Use a copy of P1's army for the bot if no P2 army is loaded
      const botArmy = JSON.parse(JSON.stringify(armies[0]));
      botArmy.armyName = 'Bot Army';
      setError('');
      onStart(playerNames, [JSON.parse(JSON.stringify(armies[0])), botArmy], vsBot ? 1 : null);
      return;
    }
    setError('');
    onStart(playerNames, armies.map(a => JSON.parse(JSON.stringify(a))), vsBot ? 1 : null);
  }

  const canStart = armies[0]?.units.length > 0 && (vsBot || armies[1]?.units.length > 0);

  return (
    <div className="game-setup">
      <div className="game-setup-card">
        <h1 className="game-setup-title">Mecha: HEX — Battle Setup</h1>

        <div className="game-setup-section">
          <h2>Game Mode</h2>
          <div className="game-setup-mode">
            <label className="game-setup-mode-toggle">
              <input
                type="checkbox"
                checked={vsBot}
                onChange={e => {
                  setVsBot(e.target.checked);
                  setPlayerNames(prev => [prev[0], e.target.checked ? 'Bot' : 'Player 2']);
                }}
              />
              <span>Play vs Bot (AI controls Player 2)</span>
            </label>
          </div>
        </div>

        <div className="game-setup-section">
          <h2>Player Names</h2>
          <div className="game-setup-players">
            {[0, 1].map(i => (
              <label key={i} className={`game-setup-player game-setup-player--p${i}`}>
                <span className="player-dot" />
                Player {i + 1} ({i === 0 ? 'Blue' : 'Red'})
                <input
                  value={playerNames[i]}
                  onChange={e => setPlayerNames(prev => prev.map((n, j) => j === i ? e.target.value : n))}
                  maxLength={24}
                  readOnly={vsBot && i === 1}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="game-setup-section">
          <h2>Armies</h2>
          <p className="army-slot-tip">
            In the Army Builder, use <strong>Save as P1</strong> / <strong>Save as P2</strong> to store each player's list, then load them here.
          </p>
          <div className="army-slots">
            <ArmySlot
              label="Player 1 Army (Blue)"
              colorClass="army-slot--p0"
              army={armies[0]}
              onLoad={() => loadArmy(0)}
              onClear={() => clearArmy(0)}
            />
            {vsBot ? (
              <div className="army-slot army-slot--p1 army-slot--bot">
                <div className="army-slot-label">Bot Army (Red)</div>
                <div className="army-slot-loaded">
                  {armies[1] ? (
                    <>
                      <div className="army-slot-name">{armies[1].armyName}</div>
                      <div className="army-slot-detail">{armies[1].units.length} units · {armies[1].pointLimit}pts</div>
                      <button className="army-slot-clear" onClick={() => clearArmy(1)}>✕ Clear</button>
                    </>
                  ) : (
                    <>
                      <div className="army-slot-hint">Will mirror your army if none loaded</div>
                      <button className="army-slot-load" onClick={() => loadArmy(1)}>Load saved army for bot</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <ArmySlot
                label="Player 2 Army (Red)"
                colorClass="army-slot--p1"
                army={armies[1]}
                onLoad={() => loadArmy(1)}
                onClear={() => clearArmy(1)}
              />
            )}
          </div>
        </div>

        <div className="game-setup-section">
          <h2>Setup Order</h2>
          <ol className="game-setup-steps">
            <li>Place terrain on the battlefield</li>
            <li>Roll initiative off-screen</li>
            <li>Alternate deploying units within 5 rows of your table edge</li>
            <li>Battle — 4 rounds, 6 phases each</li>
          </ol>
        </div>

        {error && <div className="game-setup-error">{error}</div>}

        <button className="game-setup-start" onClick={handleStart} disabled={!canStart}>
          Set Up Battlefield →
        </button>
      </div>
    </div>
  );
}
