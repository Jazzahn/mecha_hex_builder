import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import { gameReducer, buildOnlineInitialState } from '../src/game/gameReducer.js';

const app = express();
app.get('/', (_req, res) => res.send('ok'));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// roomCode → { players: [{socketId, displayName, playerIndex}], armies: [null,null], ready: [false,false], maxPoints, gameState }
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

io.on('connection', (socket) => {
  console.log('connect:', socket.id);

  socket.on('create-room', ({ displayName, maxPoints }) => {
    const pts = Number(maxPoints) || 200;
    const code = generateCode();
    rooms.set(code, {
      players: [{ socketId: socket.id, displayName, playerIndex: 0 }],
      armies: [null, null],
      ready: [false, false],
      maxPoints: pts,
      gameState: null,
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerIndex = 0;
    socket.emit('room-created', { code });
    console.log(`Room ${code} created by "${displayName}" (${pts} pts)`);
  });

  socket.on('get-room-info', ({ code }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('room-info-error', { message: 'Room not found.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('room-info-error', { message: 'Room is full.' });
      return;
    }
    socket.emit('room-info', { maxPoints: room.maxPoints });
  });

  socket.on('join-room', ({ code, displayName }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('join-error', { message: 'Room not found.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('join-error', { message: 'Room is full.' });
      return;
    }

    room.players.push({ socketId: socket.id, displayName, playerIndex: 1 });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerIndex = 1;

    const [p0, p1] = room.players;
    // Both players go to the army builder
    io.to(p0.socketId).emit('both-joined', { maxPoints: room.maxPoints, opponentName: p1.displayName });
    io.to(p1.socketId).emit('both-joined', { maxPoints: room.maxPoints, opponentName: p0.displayName });
    console.log(`Room ${code}: "${p0.displayName}" vs "${p1.displayName}" — building armies`);
  });

  socket.on('player-ready', ({ army }) => {
    const { roomCode, playerIndex } = socket.data;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.armies[playerIndex] = army;
    room.ready[playerIndex] = true;

    // Tell the opponent this player is ready
    const opponent = room.players.find(p => p.playerIndex !== playerIndex);
    if (opponent) io.to(opponent.socketId).emit('opponent-ready');

    // If both ready, build and start the game
    if (room.ready[0] && room.ready[1]) {
      const [p0, p1] = room.players;
      room.gameState = buildOnlineInitialState(
        [p0.displayName, p1.displayName],
        [room.armies[0], room.armies[1]]
      );
      io.to(p0.socketId).emit('game-start', { playerIndex: 0, gameState: room.gameState });
      io.to(p1.socketId).emit('game-start', { playerIndex: 1, gameState: room.gameState });
      console.log(`Room ${roomCode}: both ready — game started`);
    }
  });

  socket.on('player-unready', () => {
    const { roomCode, playerIndex } = socket.data;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.armies[playerIndex] = null;
    room.ready[playerIndex] = false;

    const opponent = room.players.find(p => p.playerIndex !== playerIndex);
    if (opponent) io.to(opponent.socketId).emit('opponent-unready');
  });

  socket.on('dispatch-action', ({ action }) => {
    const { roomCode, playerIndex } = socket.data;
    const room = rooms.get(roomCode);
    if (!room?.gameState) return;

    const { phase, activePlayer, deployPlayerIndex } = room.gameState;

    const allowed =
      (phase === 'playing' && playerIndex === activePlayer) ||
      (phase === 'deploy'  && playerIndex === deployPlayerIndex) ||
      (['terrain', 'objective-setup'].includes(phase) && playerIndex === 0) ||
      phase === 'over';

    if (!allowed) return;

    try {
      room.gameState = gameReducer(room.gameState, action);
      io.to(roomCode).emit('state-update', room.gameState);
    } catch (e) {
      console.error('Reducer error:', e.message);
    }
  });

  socket.on('disconnect', () => {
    const { roomCode } = socket.data;
    if (!roomCode) return;
    io.to(roomCode).emit('opponent-disconnected');
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} closed (disconnect)`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server listening on :${PORT}`));
