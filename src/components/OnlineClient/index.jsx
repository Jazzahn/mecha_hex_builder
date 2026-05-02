import { useEffect, useReducer, useRef, useState } from 'react';
import { socket } from '../../socket';
import { OnlineGameProvider } from '../../store/onlineGameContext';
import { GameInner } from '../GameClient/index.jsx';

// ── helpers ──────────────────────────────────────────────────────────────────

function tryLoadArmy(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Lobby ─────────────────────────────────────────────────────────────────────

function ArmyPicker({ army, onLoad }) {
  return (
    <div className="online-army-picker">
      {army ? (
        <div className="online-army-loaded">
          ✓ {army.armyName} · {army.units.length} units
          <button className="online-army-clear" onClick={() => onLoad(null)}>✕</button>
        </div>
      ) : (
        <div className="online-army-slots">
          <span className="online-army-hint">Load your army:</span>
          {['mechaArmy_p1', 'mechaArmy_p2', 'mechaArmy'].map(key => {
            const a = tryLoadArmy(key);
            if (!a) return null;
            const label = key === 'mechaArmy_p1' ? 'P1 save' : key === 'mechaArmy_p2' ? 'P2 save' : 'default';
            return (
              <button key={key} className="online-army-slot-btn" onClick={() => onLoad(JSON.parse(JSON.stringify(a)))}>
                {a.armyName} ({label})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Lobby({ onCreated, onJoined }) {
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [army, setArmy] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canAct = displayName.trim().length > 0 && army !== null;

  function handleCreate() {
    if (!canAct) return;
    setBusy(true);
    setError('');
    socket.connect();
    socket.once('room-created', ({ code }) => {
      setBusy(false);
      onCreated(code, displayName.trim(), army);
    });
    socket.emit('create-room', { displayName: displayName.trim(), army });
  }

  function handleJoin() {
    if (!canAct || !joinCode.trim()) return;
    setBusy(true);
    setError('');
    socket.connect();
    socket.once('join-error', ({ message }) => {
      setBusy(false);
      setError(message);
      socket.disconnect();
    });
    socket.once('game-start', ({ playerIndex, gameState }) => {
      setBusy(false);
      onJoined(playerIndex, gameState);
    });
    socket.emit('join-room', { code: joinCode.trim().toUpperCase(), displayName: displayName.trim(), army });
  }

  return (
    <div className="online-lobby">
      <h2 className="online-lobby-title">Online Battle</h2>

      <label className="online-field-label">
        Your display name
        <input
          className="online-field-input"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={24}
          placeholder="Commander"
        />
      </label>

      <ArmyPicker army={army} onLoad={setArmy} />

      {error && <div className="online-error">{error}</div>}

      <div className="online-actions">
        <button
          className="online-btn online-btn--create"
          onClick={handleCreate}
          disabled={!canAct || busy}
        >
          Create Room
        </button>

        <div className="online-join-row">
          <input
            className="online-field-input online-code-input"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ROOM CODE"
          />
          <button
            className="online-btn online-btn--join"
            onClick={handleJoin}
            disabled={!canAct || !joinCode.trim() || busy}
          >
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WaitingRoom ───────────────────────────────────────────────────────────────

function WaitingRoom({ code, onGameStart }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    socket.on('game-start', onGameStart);
    return () => socket.off('game-start', onGameStart);
  }, [onGameStart]);

  function copy() {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="online-waiting">
      <h2 className="online-waiting-title">Waiting for opponent…</h2>
      <div className="online-room-code">{code}</div>
      <button className="online-btn online-btn--copy" onClick={copy}>
        {copied ? 'Copied!' : 'Copy code'}
      </button>
      <p className="online-waiting-hint">Share this code with your opponent so they can join.</p>
    </div>
  );
}

// ── Online game wrapper ───────────────────────────────────────────────────────

function OnlineGame({ playerIndex, initialState, onExit }) {
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    function onDisconnect() { setDisconnected(true); }
    socket.on('opponent-disconnected', onDisconnect);
    return () => socket.off('opponent-disconnected', onDisconnect);
  }, []);

  if (disconnected) {
    return (
      <div className="online-disconnected">
        <h2>Opponent disconnected</h2>
        <button className="online-btn" onClick={onExit}>Back to lobby</button>
      </div>
    );
  }

  return (
    <OnlineGameProvider playerIndex={playerIndex} initialState={gameState}>
      <GameInner />
    </OnlineGameProvider>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function OnlineClient({ onExit }) {
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'waiting' | 'game'
  const [roomCode, setRoomCode] = useState('');
  const [playerIndex, setPlayerIndex] = useState(0);
  const [initialState, setInitialState] = useState(null);

  function handleCreated(code, _name, _army) {
    setRoomCode(code);
    setPlayerIndex(0);
    setScreen('waiting');
  }

  function handleJoined(idx, gameState) {
    setPlayerIndex(idx);
    setInitialState(gameState);
    setScreen('game');
  }

  function handleGameStart({ playerIndex: idx, gameState }) {
    setPlayerIndex(idx);
    setInitialState(gameState);
    setScreen('game');
  }

  function handleExit() {
    socket.disconnect();
    setScreen('lobby');
    setRoomCode('');
    setInitialState(null);
    onExit();
  }

  if (screen === 'game' && initialState) {
    return (
      <div className="game-root">
        <div className="game-nav">
          <button className="game-nav-back" onClick={handleExit}>← Army Builder</button>
          <span className="game-nav-title">Mecha: HEX — Online Battle</span>
        </div>
        <OnlineGame playerIndex={playerIndex} initialState={initialState} onExit={handleExit} />
      </div>
    );
  }

  return (
    <div className="online-root">
      <div className="game-nav">
        <button className="game-nav-back" onClick={onExit}>← Army Builder</button>
        <span className="game-nav-title">Mecha: HEX — Online</span>
      </div>
      <div className="online-content">
        {screen === 'lobby' && (
          <Lobby onCreated={handleCreated} onJoined={handleJoined} />
        )}
        {screen === 'waiting' && (
          <WaitingRoom code={roomCode} onGameStart={handleGameStart} />
        )}
      </div>
    </div>
  );
}
