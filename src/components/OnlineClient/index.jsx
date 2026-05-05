import { useEffect, useState } from 'react';
import { socket } from '../../socket';
import { OnlineGameProvider } from '../../store/onlineGameContext';
import { GameInner } from '../GameClient/index.jsx';
import OnlineArmyBuilder from './OnlineArmyBuilder';

// ── helpers ───────────────────────────────────────────────────────────────────

const POINT_OPTIONS = [100, 150, 200, 250, 300, 400];

function DisconnectedScreen({ onExit }) {
  return (
    <div className="online-disconnected">
      <h2>Opponent disconnected</h2>
      <button className="online-btn" onClick={onExit}>Back to lobby</button>
    </div>
  );
}

// ── Lobby ─────────────────────────────────────────────────────────────────────

function Lobby({ onCreated, onJoined }) {
  const [displayName, setDisplayName] = useState('');
  const [maxPoints, setMaxPoints]     = useState(200);
  const [joinCode, setJoinCode]       = useState('');
  const [joinInfo, setJoinInfo]       = useState(null);   // null | { maxPoints } | { error }
  const [joinLoading, setJoinLoading] = useState(false);
  const [error, setError]             = useState('');
  const [busy, setBusy]               = useState(false);

  // Auto-query room info when code reaches 6 chars
  useEffect(() => {
    if (joinCode.length !== 6) { setJoinInfo(null); setJoinLoading(false); return; }
    setJoinLoading(true);
    setJoinInfo(null);
    socket.connect();
    const onInfo  = info          => { setJoinInfo(info);            setJoinLoading(false); };
    const onError = ({ message }) => { setJoinInfo({ error: message }); setJoinLoading(false); };
    socket.once('room-info',       onInfo);
    socket.once('room-info-error', onError);
    socket.emit('get-room-info', { code: joinCode });
    return () => { socket.off('room-info', onInfo); socket.off('room-info-error', onError); };
  }, [joinCode]);

  function handleCreate() {
    if (!displayName.trim()) return;
    setBusy(true); setError('');
    socket.connect();
    socket.once('room-created', ({ code }) => { setBusy(false); onCreated(code, displayName.trim(), maxPoints); });
    socket.emit('create-room', { displayName: displayName.trim(), maxPoints });
  }

  function handleJoin() {
    if (!displayName.trim() || joinCode.length !== 6 || !joinInfo?.maxPoints) return;
    setBusy(true); setError('');
    socket.once('join-error', ({ message }) => { setBusy(false); setError(message); socket.disconnect(); });
    socket.once('both-joined', ({ maxPoints: mp, opponentName }) => {
      setBusy(false);
      onJoined(1, mp, opponentName);
    });
    socket.emit('join-room', { code: joinCode, displayName: displayName.trim() });
  }

  const canCreate = displayName.trim().length > 0;
  const canJoin   = displayName.trim().length > 0 && joinCode.length === 6 && !!joinInfo?.maxPoints;

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

      <div className="online-section-divider">Host a game</div>

      <label className="online-field-label">
        Max points
        <select
          className="online-field-select"
          value={maxPoints}
          onChange={e => setMaxPoints(Number(e.target.value))}
        >
          {POINT_OPTIONS.map(v => <option key={v} value={v}>{v} pts</option>)}
        </select>
      </label>

      <button
        className="online-btn online-btn--create"
        onClick={handleCreate}
        disabled={!canCreate || busy}
      >
        Create Room
      </button>

      <div className="online-section-divider">Join a game</div>

      <label className="online-field-label">
        Room code
        <input
          className="online-field-input online-code-input"
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          maxLength={6}
          placeholder="XXXXXX"
        />
      </label>

      {joinLoading && <div className="online-room-info">Looking up room…</div>}
      {joinInfo?.error && <div className="online-room-info online-room-info--error">{joinInfo.error}</div>}
      {joinInfo?.maxPoints && (
        <div className="online-room-info online-room-info--ok">
          Room limit: <strong>{joinInfo.maxPoints} pts</strong> — you will build your army after joining.
        </div>
      )}

      <button
        className="online-btn online-btn--join"
        onClick={handleJoin}
        disabled={!canJoin || busy}
      >
        Join Room
      </button>

      {error && <div className="online-error">{error}</div>}
    </div>
  );
}

// ── WaitingRoom ───────────────────────────────────────────────────────────────

function WaitingRoom({ code, maxPoints, displayName, onBothJoined }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = ({ maxPoints: mp, opponentName }) => onBothJoined(0, mp, opponentName);
    socket.on('both-joined', handler);
    return () => socket.off('both-joined', handler);
  }, [onBothJoined]);

  function copy() {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="online-waiting">
      <h2 className="online-waiting-title">Waiting for opponent…</h2>
      <div className="online-room-code">{code}</div>
      <div className="online-waiting-limit">{maxPoints} pt limit</div>
      <button className="online-btn online-btn--copy" onClick={copy}>
        {copied ? 'Copied!' : 'Copy code'}
      </button>
      <p className="online-waiting-hint">Share this code with your opponent. You will both build your armies once they join.</p>
    </div>
  );
}

// ── ArmyBuilding screen ───────────────────────────────────────────────────────

function ArmyBuildingScreen({ playerIndex, maxPoints, opponentName, onGameStart, onExit }) {
  const [opponentReady, setOpponentReady] = useState(false);
  const [isReady, setIsReady]             = useState(false);
  const [disconnected, setDisconnected]   = useState(false);

  useEffect(() => {
    const onOppReady   = () => setOpponentReady(true);
    const onOppUnready = () => setOpponentReady(false);
    const onStart      = ({ playerIndex: pi, gameState }) => onGameStart(pi, gameState);
    const onDisconnect = () => setDisconnected(true);

    socket.on('opponent-ready',        onOppReady);
    socket.on('opponent-unready',      onOppUnready);
    socket.on('game-start',            onStart);
    socket.on('opponent-disconnected', onDisconnect);
    return () => {
      socket.off('opponent-ready',        onOppReady);
      socket.off('opponent-unready',      onOppUnready);
      socket.off('game-start',            onStart);
      socket.off('opponent-disconnected', onDisconnect);
    };
  }, [onGameStart]);

  function handleReady(army) {
    socket.emit('player-ready', { army });
    setIsReady(true);
  }

  function handleUnready() {
    socket.emit('player-unready');
    setIsReady(false);
  }

  if (disconnected) return <DisconnectedScreen onExit={onExit} />;

  return (
    <OnlineArmyBuilder
      maxPoints={maxPoints}
      opponentName={opponentName}
      opponentReady={opponentReady}
      isReady={isReady}
      onReady={handleReady}
      onUnready={handleUnready}
    />
  );
}

// ── Online game wrapper ───────────────────────────────────────────────────────

function OnlineGame({ playerIndex, initialState, onExit }) {
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const handler = () => setDisconnected(true);
    socket.on('opponent-disconnected', handler);
    return () => socket.off('opponent-disconnected', handler);
  }, []);

  if (disconnected) return <DisconnectedScreen onExit={onExit} />;

  return (
    <OnlineGameProvider playerIndex={playerIndex} initialState={initialState}>
      <GameInner />
    </OnlineGameProvider>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function OnlineClient({ onExit }) {
  const [screen, setScreen]               = useState('lobby');
  const [roomCode, setRoomCode]           = useState('');
  const [roomMaxPoints, setRoomMaxPoints] = useState(200);
  const [playerIndex, setPlayerIndex]     = useState(0);
  const [opponentName, setOpponentName]   = useState('');
  const [displayName, setDisplayName]     = useState('');
  const [initialState, setInitialState]   = useState(null);

  function handleCreated(code, name, maxPts) {
    setRoomCode(code);
    setDisplayName(name);
    setRoomMaxPoints(maxPts);
    setPlayerIndex(0);
    setScreen('waiting');
  }

  function handleJoined(pi, maxPts, oppName) {
    setPlayerIndex(pi);
    setRoomMaxPoints(maxPts);
    setOpponentName(oppName);
    setScreen('building');
  }

  function handleGameStart(pi, gameState) {
    setPlayerIndex(pi);
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

  if (screen === 'building') {
    return (
      <div className="game-root">
        <div className="game-nav">
          <button className="game-nav-back" onClick={handleExit}>← Exit</button>
          <span className="game-nav-title">Mecha: HEX — Online Match Setup</span>
        </div>
        <ArmyBuildingScreen
          playerIndex={playerIndex}
          maxPoints={roomMaxPoints}
          opponentName={opponentName}
          onGameStart={handleGameStart}
          onExit={handleExit}
        />
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
          <WaitingRoom
            code={roomCode}
            maxPoints={roomMaxPoints}
            displayName={displayName}
            onBothJoined={handleJoined}
          />
        )}
      </div>
    </div>
  );
}
