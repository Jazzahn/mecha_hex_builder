// HTTP for room create/lookup; native WebSocket for game phase.
// Auto-reconnects with exponential backoff when the connection drops unexpectedly.

const BASE_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';
const WS_BASE  = BASE_URL.replace(/^http/, 'ws');

const MAX_RECONNECT_ATTEMPTS = 5;

class GameSocket {
  #ws             = null;
  #code           = null;
  #displayName    = null;
  #intentional    = false;   // true when disconnect() was called deliberately
  #attempt        = 0;
  #reconnectTimer = null;
  #listeners      = new Map(); // event → Set<handler>
  #onceListeners  = new Map(); // event → Set<handler>

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async createRoom(displayName, maxPoints) {
    const res = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, maxPoints }),
    });
    if (!res.ok) throw new Error('Failed to create room');
    return res.json(); // { code }
  }

  async getRoomInfo(code) {
    const res = await fetch(`${BASE_URL}/api/rooms/${code}`);
    if (res.status === 404) throw new Error('Room not found.');
    if (!res.ok) throw new Error('Failed to look up room');
    return res.json(); // { maxPoints } or { error }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  connect(code, displayName) {
    this.#code        = code;
    this.#displayName = displayName;
    this.#intentional = false;
    this.#attempt     = 0;
    clearTimeout(this.#reconnectTimer);
    this.#doConnect();
  }

  disconnect() {
    this.#intentional = true;
    this.#code        = null;
    this.#displayName = null;
    this.#attempt     = 0;
    clearTimeout(this.#reconnectTimer);
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  send(type, payload = {}) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  // ── event emitter ─────────────────────────────────────────────────────────

  on(event, handler) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
  }

  once(event, handler) {
    if (!this.#onceListeners.has(event)) this.#onceListeners.set(event, new Set());
    this.#onceListeners.get(event).add(handler);
  }

  off(event, handler) {
    this.#listeners.get(event)?.delete(handler);
    this.#onceListeners.get(event)?.delete(handler);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #doConnect() {
    if (this.#ws) {
      // Detach close handler before closing to prevent a reconnect loop
      this.#ws.onclose = null;
      this.#ws.close();
    }
    const url = `${WS_BASE}/ws/${this.#code}?name=${encodeURIComponent(this.#displayName)}`;
    this.#ws = new WebSocket(url);

    this.#ws.addEventListener('message', (evt) => {
      try {
        const { type, ...payload } = JSON.parse(evt.data);
        this.#dispatch(type, payload);
      } catch { /* malformed */ }
    });

    this.#ws.addEventListener('close', () => {
      if (this.#intentional) {
        this.#dispatch('disconnect', {});
        return;
      }
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (!this.#code || this.#attempt >= MAX_RECONNECT_ATTEMPTS) {
      this.#dispatch('disconnect', {});
      return;
    }
    this.#attempt++;
    // Exponential backoff: ~1s, 2s, 4s, 8s, 15s
    const delay = Math.min(500 * 2 ** this.#attempt, 15_000);
    this.#dispatch('reconnecting', { attempt: this.#attempt, max: MAX_RECONNECT_ATTEMPTS });
    this.#reconnectTimer = setTimeout(() => this.#doConnect(), delay);
  }

  #dispatch(event, payload) {
    for (const h of (this.#listeners.get(event) ?? [])) h(payload);
    const once = this.#onceListeners.get(event);
    if (once) {
      for (const h of once) h(payload);
      this.#onceListeners.delete(event);
    }
  }
}

export const gameSocket = new GameSocket();
