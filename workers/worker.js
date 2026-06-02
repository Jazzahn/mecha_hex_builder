import { neon } from '@neondatabase/serverless';
export { GameRoom } from './GameRoom.js';

// Cloudflare WAF / built-in rate limiting handles burst abuse before the Worker runs.
// This Neon-backed check is a second layer for sustained per-IP room creation abuse.
const ROOM_RATE_LIMIT    = 5;   // max rooms per IP per hour
const ROOM_RATE_WINDOW   = '1 hour';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function clientIp(request) {
  // CF-Connecting-IP is the real client IP set by Cloudflare's edge.
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
    ?? 'unknown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return cors();

    // POST /api/rooms — rate-check, create room in Neon, warm DO
    if (request.method === 'POST' && pathname === '/api/rooms') {
      const { displayName, maxPoints } = await request.json();
      const pts = Number(maxPoints) || 200;
      const ip  = clientIp(request);
      const sql = neon(env.NEON_DATABASE_URL);

      // IP rate limit — check before touching room table
      const [{ count }] = await sql`
        SELECT COUNT(*) AS count FROM rooms
        WHERE created_by_ip = ${ip}
          AND created_at > now() - INTERVAL '1 hour'
      `;
      if (Number(count) >= ROOM_RATE_LIMIT) {
        return json({ error: 'Too many rooms created. Try again in an hour.' }, 429);
      }

      // Insert room, retrying on code collision
      let code = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateCode();
        try {
          await sql`
            INSERT INTO rooms (code, max_points, created_by_ip)
            VALUES (${candidate}, ${pts}, ${ip})
          `;
          code = candidate;
          break;
        } catch {
          // Primary key collision — try a new code
        }
      }
      if (!code) return json({ error: 'Could not generate room code.' }, 500);

      // Pre-warm the Durable Object with the room's maxPoints and TTL
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
      await stub.fetch(new Request('https://do/init', {
        method: 'POST',
        body: JSON.stringify({ maxPoints: pts }),
      }));

      return json({ code });
    }

    // GET /api/rooms/:code — look up room in Neon
    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})$/);
    if (request.method === 'GET' && roomMatch) {
      const code = roomMatch[1];
      const sql  = neon(env.NEON_DATABASE_URL);
      const rows = await sql`
        SELECT max_points FROM rooms
        WHERE code = ${code} AND expires_at > now()
      `;
      if (!rows.length) return json({ error: 'Room not found.' }, 404);
      return json({ maxPoints: rows[0].max_points });
    }

    // WebSocket /ws/:code — route to Durable Object
    const wsMatch = pathname.match(/^\/ws\/([A-Z0-9]{6})$/);
    if (wsMatch) {
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(wsMatch[1]));
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
