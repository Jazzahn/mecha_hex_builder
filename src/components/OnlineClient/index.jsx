import { useEffect, useState } from 'react';
import { gameSocket } from '../../lib/gameSocket';
import { OnlineGameProvider } from '../../store/onlineGameContext';
import { GameInner } from '../GameClient/index.jsx';
import OnlineArmyBuilder from './OnlineArmyBuilder';

// ── helpers ───────────────────────────────────────────────────────────────────

const POINT_OPTIONS = [100, 150, 200, 250, 300, 400];

function DisconnectedScreen({ onExit, reason = 'Opponent disconnected' }) {
  return (
    <div className="online-disconnected">
      <h2>{reason}</h2>
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

  // Auto-query room info via HTTP when code reaches 6 chars
  useEffect(() => {
    if (joinCode.length !== 6) { setJoinInfo(null); setJoinLoading(false); return; }
    let cancelled = false;
    setJoinLoading(true);
    setJoinInfo(null);
    gameSocket.getRoomInfo(joinCode)
      .then(info => { if (!cancelled) setJoinInfo(info); })
      .catch(err => { if (!cancelled) setJoinInfo({ error: err.message }); })
      .finally(() => { if (!cancelled) setJoinLoading(false); });
    return () => { cancelled = true; };
  }, [joinCode]);

  async function handleCreate() {
    if (!displayName.trim()) return;
    setBusy(true); setError('');
    try {
      const { code } = await gameSocket.createRoom(displayName.trim(), maxPoints);
      // Connect WebSocket now so the host receives both-joined when opponent connects
      gameSocket.connect(code, displayName.trim());
      onCreated(code, displayName.trim(), maxPoints);
    } catch (err) {
      setError(err.message ?? 'Failed to create room');
    } finally {
      setBusy(false);
    }
  }

  function handleJoin() {
    if (!displayName.trim() || joinCode.length !== 6 || !joinInfo?.maxPoints) return;
    setBusy(true); setError('');

    gameSocket.once('both-joined', ({ maxPoints: mp, opponentName }) => {
      setBusy(false);
      onJoined(1, mp, opponentName);
    });
    gameSocket.once('disconnect', () => {
      setBusy(false);
      setError('Connection lost. Try again.');
    });

    // Connecting triggers the DO to send both-joined once 2 players are in
    gameSocket.connect(joinCode, displayName.trim());
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
    gameSocket.on('both-joined', handler);
    return () => gameSocket.off('both-joined', handler);
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
  const [opponentReady, setOpponentReady]           = useState(false);
  const [isReady, setIsReady]                       = useState(false);
  const [endReason, setEndReason]                   = useState(null);
  const [opponentReconnecting, setOppReconnecting]  = useState(false);
  const [selfReconnecting, setSelfReconnecting]     = useState(false);

  useEffect(() => {
    const onOppReady        = ()  => setOpponentReady(true);
    const onOppUnready      = ()  => setOpponentReady(false);
    const onStart           = ({ playerIndex: pi, gameState }) => onGameStart(pi, gameState);
    const onDisconnect      = ()  => setEndReason('Opponent disconnected');
    const onExpired         = ()  => setEndReason('Session expired (3-hour limit reached)');
    const onOppReconnecting = ()  => setOppReconnecting(true);
    const onOppReconnected  = ()  => setOppReconnecting(false);
    const onReconnecting    = ()  => setSelfReconnecting(true);
    const onReconnected     = ()  => setSelfReconnecting(false);

    gameSocket.on('opponent-ready',        onOppReady);
    gameSocket.on('opponent-unready',      onOppUnready);
    gameSocket.on('game-start',            onStart);
    gameSocket.on('opponent-disconnected', onDisconnect);
    gameSocket.on('disconnect',            onDisconnect);
    gameSocket.on('session-expired',       onExpired);
    gameSocket.on('opponent-reconnecting', onOppReconnecting);
    gameSocket.on('opponent-reconnected',  onOppReconnected);
    gameSocket.on('reconnecting',          onReconnecting);
    gameSocket.on('reconnected',           onReconnected);
    return () => {
      gameSocket.off('opponent-ready',        onOppReady);
      gameSocket.off('opponent-unready',      onOppUnready);
      gameSocket.off('game-start',            onStart);
      gameSocket.off('opponent-disconnected', onDisconnect);
      gameSocket.off('disconnect',            onDisconnect);
      gameSocket.off('session-expired',       onExpired);
      gameSocket.off('opponent-reconnecting', onOppReconnecting);
      gameSocket.off('opponent-reconnected',  onOppReconnected);
      gameSocket.off('reconnecting',          onReconnecting);
      gameSocket.off('reconnected',           onReconnected);
    };
  }, [onGameStart]);

  function handleReady(army) {
    gameSocket.send('player-ready', { army });
    setIsReady(true);
  }

  function handleUnready() {
    gameSocket.send('player-unready');
    setIsReady(false);
  }

  if (endReason) return <DisconnectedScreen onExit={onExit} reason={endReason} />;

  return (
    <>
      {(opponentReconnecting || selfReconnecting) && (
        <div className="reconnecting-banner">
          {selfReconnecting ? 'Reconnecting…' : 'Opponent reconnecting…'}
        </div>
      )}
      <OnlineArmyBuilder
      maxPoints={maxPoints}
      opponentName={opponentName}
      opponentReady={opponentReady}
      isReady={isReady}
      onReady={handleReady}
      onUnready={handleUnready}
    />
    </>
  );
}

// ── Online game wrapper ───────────────────────────────────────────────────────

function OnlineGame({ playerIndex, initialState, onExit }) {
  const [endReason, setEndReason]                  = useState(null);
  const [opponentReconnecting, setOppReconnecting] = useState(false);
  const [selfReconnecting, setSelfReconnecting]    = useState(false);

  useEffect(() => {
    const onDisconnect      = () => setEndReason('Opponent disconnected');
    const onExpired         = () => setEndReason('Session expired (3-hour limit reached)');
    const onOppReconnecting = () => setOppReconnecting(true);
    const onOppReconnected  = () => setOppReconnecting(false);
    const onReconnecting    = () => setSelfReconnecting(true);
    const onReconnected     = () => setSelfReconnecting(false);

    gameSocket.on('opponent-disconnected', onDisconnect);
    gameSocket.on('disconnect',            onDisconnect);
    gameSocket.on('session-expired',       onExpired);
    gameSocket.on('opponent-reconnecting', onOppReconnecting);
    gameSocket.on('opponent-reconnected',  onOppReconnected);
    gameSocket.on('reconnecting',          onReconnecting);
    gameSocket.on('reconnected',           onReconnected);
    return () => {
      gameSocket.off('opponent-disconnected', onDisconnect);
      gameSocket.off('disconnect',            onDisconnect);
      gameSocket.off('session-expired',       onExpired);
      gameSocket.off('opponent-reconnecting', onOppReconnecting);
      gameSocket.off('opponent-reconnected',  onOppReconnected);
      gameSocket.off('reconnecting',          onReconnecting);
      gameSocket.off('reconnected',           onReconnected);
    };
  }, []);

  if (endReason) return <DisconnectedScreen onExit={onExit} reason={endReason} />;

  return (
    <OnlineGameProvider playerIndex={playerIndex} initialState={initialState} onExit={onExit}>
      {(opponentReconnecting || selfReconnecting) && (
        <div className="reconnecting-banner">
          {selfReconnecting ? 'Reconnecting…' : 'Opponent reconnecting…'}
        </div>
      )}
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
    gameSocket.disconnect();
    setScreen('lobby');
    setRoomCode('');
    setInitialState(null);
    onExit();
  }

  if (screen === 'game' && initialState) {
    return (
      <div className="game-root">
        <div className="game-nav">
          <button className="game-nav-back" onClick={handleExit}>← Menu</button>
          <span className="game-nav-title">Mechatech — Online Battle</span>
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
          <span className="game-nav-title">Mechatech — Online Match Setup</span>
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
        <button className="game-nav-back" onClick={onExit}>← Menu</button>
        <span className="game-nav-title">Mechatech — Online</span>
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
