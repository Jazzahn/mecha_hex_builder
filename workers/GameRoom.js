import { neon } from '@neondatabase/serverless';
import { gameReducer, buildOnlineInitialState } from '../src/game/gameReducer.js';

const RECONNECT_GRACE_MS = 60_000;             // 60s reconnect window
const ROOM_TTL_MS        = 3 * 60 * 60_000;   // 3h hard lifetime

export class GameRoom {
  #sessions     = []; // [{ ws, playerIndex, displayName }]
  #disconnected = [false, false];
  #ttlAlarm     = 0;  // absolute ms timestamp of the TTL alarm
  #room = {
    players:   [],
    armies:    [null, null],
    ready:     [false, false],
    maxPoints: 200,
    gameState: null,
  };
  #env;
  #state;

  constructor(state, env) {
    this.#state = state;
    this.#env   = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Internal init call from worker.js on room creation
    if (url.pathname === '/init' && request.method === 'POST') {
      const { maxPoints } = await request.json();
      this.#room.maxPoints = Number(maxPoints) || 200;
      // Arm the TTL — DO self-destructs after 3h regardless of game state
      this.#ttlAlarm = Date.now() + ROOM_TTL_MS;
      await this.#state.storage.setAlarm(this.#ttlAlarm);
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const displayName = url.searchParams.get('name') ?? 'Unknown';
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    // ── Reconnect path ────────────────────────────────────────────────────────
    const existing = this.#room.players.find(p => p.displayName === displayName);
    if (existing && this.#disconnected[existing.playerIndex]) {
      const pi = existing.playerIndex;
      this.#disconnected[pi] = false;
      this.#sessions.push({ ws: server, playerIndex: pi, displayName });
      this.#attachHandlers(server, pi);

      // Both sides reconnected — cancel short alarm and re-arm the TTL
      if (!this.#disconnected[0] && !this.#disconnected[1]) {
        this.#state.storage.deleteAlarm().catch(() => {});
        if (this.#ttlAlarm > Date.now()) {
          this.#state.storage.setAlarm(this.#ttlAlarm).catch(() => {});
        }
      }

      // Restore state for the reconnecting player
      this.#send(pi, { type: 'reconnected', gameState: this.#room.gameState });
      this.#broadcast({ type: 'opponent-reconnected' }, pi);

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── New connection path ───────────────────────────────────────────────────
    const playerIndex = this.#room.players.length;
    if (playerIndex > 1) {
      server.close(1008, 'Room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.#room.players.push({ playerIndex, displayName });
    this.#sessions.push({ ws: server, playerIndex, displayName });
    this.#attachHandlers(server, playerIndex);

    // Second player connected — both go to army builder
    if (this.#room.players.length === 2) {
      const [p0, p1] = this.#room.players;
      this.#send(0, { type: 'both-joined', maxPoints: this.#room.maxPoints, opponentName: p1.displayName });
      this.#send(1, { type: 'both-joined', maxPoints: this.#room.maxPoints, opponentName: p0.displayName });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    if (this.#disconnected[0] || this.#disconnected[1]) {
      // Reconnect grace window expired
      this.#sendAll({ type: 'opponent-disconnected' });
    } else {
      // TTL alarm fired — room has been alive for 3h
      this.#sendAll({ type: 'session-expired' });
    }
    try {
      const sql  = neon(this.#env.NEON_DATABASE_URL);
      const code = this.#state.id.name;
      if (code) await sql`DELETE FROM rooms WHERE code = ${code}`;
    } catch { /* best-effort */ }
  }

  // ── message/event wiring ──────────────────────────────────────────────────

  #attachHandlers(server, playerIndex) {
    server.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this.#handleMessage(playerIndex, msg);
      } catch { /* malformed — ignore */ }
    });

    server.addEventListener('close', () => {
      this.#sessions = this.#sessions.filter(s => s.ws !== server);

      const inActiveGame = this.#room.gameState && this.#room.gameState.phase !== 'over';
      if (inActiveGame) {
        // Grant reconnect window — override TTL alarm with the shorter grace window
        this.#disconnected[playerIndex] = true;
        this.#broadcast({ type: 'opponent-reconnecting' }, playerIndex);
        const graceEnd = Date.now() + RECONNECT_GRACE_MS;
        // Only shorten the alarm (never push it out past the TTL)
        this.#state.storage.setAlarm(Math.min(graceEnd, this.#ttlAlarm || graceEnd)).catch(() => {});
      } else {
        // Pre-game or finished — clean up shortly
        this.#broadcast({ type: 'opponent-disconnected' }, playerIndex);
        this.#state.storage.setAlarm(Date.now() + 5_000).catch(() => {});
      }
    });
  }

  // ── message dispatch ──────────────────────────────────────────────────────

  #handleMessage(playerIndex, msg) {
    const { type, ...payload } = msg;
    switch (type) {
      case 'player-ready':    return this.#onPlayerReady(playerIndex, payload.army);
      case 'player-unready':  return this.#onPlayerUnready(playerIndex);
      case 'dispatch-action': return this.#onDispatchAction(playerIndex, payload.action);
    }
  }

  #onPlayerReady(playerIndex, army) {
    this.#room.armies[playerIndex] = army;
    this.#room.ready[playerIndex]  = true;
    this.#broadcast({ type: 'opponent-ready' }, playerIndex);

    if (this.#room.ready[0] && this.#room.ready[1]) {
      const [p0, p1] = this.#room.players;
      this.#room.gameState = buildOnlineInitialState(
        [p0.displayName, p1.displayName],
        [this.#room.armies[0], this.#room.armies[1]]
      );
      this.#send(0, { type: 'game-start', playerIndex: 0, gameState: this.#room.gameState });
      this.#send(1, { type: 'game-start', playerIndex: 1, gameState: this.#room.gameState });
    }
  }

  #onPlayerUnready(playerIndex) {
    this.#room.armies[playerIndex] = null;
    this.#room.ready[playerIndex]  = false;
    this.#broadcast({ type: 'opponent-unready' }, playerIndex);
  }

  #onDispatchAction(playerIndex, action) {
    if (!this.#room.gameState) return;
    if (!this.#isAllowed(playerIndex)) return;

    try {
      this.#room.gameState = gameReducer(this.#room.gameState, action);
      this.#sendAll({ type: 'state-update', ...this.#room.gameState });

      if (this.#room.gameState.phase === 'over') {
        this.#persistResult().catch(() => {});
      }
    } catch (e) {
      console.error('Reducer error:', e.message);
    }
  }

  // ── authorization ─────────────────────────────────────────────────────────

  #isAllowed(playerIndex) {
    const gs = this.#room.gameState;
    const { phase, activePlayer, deployPlayerIndex, pendingCombat, units } = gs;
    const cc = this.#getCombatController(pendingCombat, units);

    return (
      (phase === 'playing' && (playerIndex === activePlayer || playerIndex === cc)) ||
      (phase === 'playing' && !!gs.pendingMorale) ||
      (phase === 'deploy'  && playerIndex === deployPlayerIndex) ||
      (['terrain', 'objective-setup'].includes(phase) && playerIndex === 0) ||
      phase === 'over'
    );
  }

  #getCombatController(pc, units) {
    if (!pc) return null;
    const att = units.find(u => u.id === pc.attackerId);
    const tgt = units.find(u => u.id === pc.targetId);
    const ram = units.find(u => u.id === pc.rammerId);
    switch (pc.step) {
      case 'block-roll':
      case 'damage-assign':    return tgt?.playerIndex ?? null;
      case 'exp-armor-roll':
        return pc.expArmorNextStep === 'ram-damage-rammer'
          ? (ram?.playerIndex ?? null) : (tgt?.playerIndex ?? null);
      case 'overheat-assign':
      case 'overheat-result':  return att?.playerIndex ?? null;
      case 'ram-damage-rammer': return ram?.playerIndex ?? null;
      case 'ram-damage-target': return tgt?.playerIndex ?? null;
      case 'ram-push':          return pc.pushChooserIndex ?? null;
      default: return att?.playerIndex ?? (ram?.playerIndex ?? null);
    }
  }

  // ── Neon ──────────────────────────────────────────────────────────────────

  async #persistResult() {
    try {
      const sql        = neon(this.#env.NEON_DATABASE_URL);
      const code       = this.#state.id.name ?? '';
      const winnerName = this.#room.players[this.#room.gameState.winner]?.displayName ?? null;
      await sql`INSERT INTO games (room_code, winner_name) VALUES (${code}, ${winnerName})`;
    } catch { /* best-effort */ }
  }

  // ── send helpers ──────────────────────────────────────────────────────────

  #send(playerIndex, msg) {
    const s = this.#sessions.find(s => s.playerIndex === playerIndex);
    if (s?.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
  }

  #broadcast(msg, exceptPlayerIndex) {
    const text = JSON.stringify(msg);
    for (const s of this.#sessions) {
      if (s.playerIndex !== exceptPlayerIndex && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(text);
      }
    }
  }

  #sendAll(msg) {
    const text = JSON.stringify(msg);
    for (const s of this.#sessions) {
      if (s.ws.readyState === WebSocket.OPEN) s.ws.send(text);
    }
  }
}
