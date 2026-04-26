/**
 * UNDERCOVER ONLINE — SERVER
 * Node.js + Socket.IO real-time game server.
 * Handles rooms, role assignment, phase progression,
 * voting, win conditions, and voice-note relay.
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory room store ────────────────────────────────────────────────────
// rooms: Map<code, RoomObject>
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

/** Strip private fields before broadcasting player list */
function safePlayer(p) {
  return { id: p.id, name: p.name, eliminated: p.eliminated, connected: p.connected };
}

// ─── Game utilities ──────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRoles(room) {
  const { players, undercoverCount, hasMrWhite } = room;
  const n = players.length;
  const civCount = n - undercoverCount - (hasMrWhite ? 1 : 0);
  const roles = [
    ...Array(civCount).fill('civilian'),
    ...Array(undercoverCount).fill('undercover'),
    ...(hasMrWhite ? ['mrwhite'] : []),
  ];
  const shuffled = shuffle(roles);
  players.forEach((p, i) => {
    p.role      = shuffled[i];
    p.eliminated = false;
    p.hasDescribed = false;
    p.hasVoted   = false;
    p.hasReady   = false;
  });
}

function checkWin(room) {
  const alive      = room.players.filter(p => !p.eliminated);
  const aliveUnder = alive.filter(p => p.role === 'undercover');
  const aliveCiv   = alive.filter(p => p.role === 'civilian');
  const aliveMrW   = alive.filter(p => p.role === 'mrwhite');

  if (aliveUnder.length === 0 && aliveMrW.length === 0) return 'civilians';
  if (aliveUnder.length > 0 && aliveUnder.length >= aliveCiv.length) return 'undercover';
  if (aliveCiv.length === 0) return aliveUnder.length > 0 ? 'undercover' : 'mrwhite';
  return 'continue';
}

function awardScores(room, outcome) {
  room.players.forEach(p => {
    if (!room.scores[p.name]) room.scores[p.name] = { points: 0, wins: 0 };
    let pts = 0;
    if (outcome === 'civilians'  && p.role === 'civilian'   && !p.eliminated) pts = 2;
    if (outcome === 'undercover' && p.role === 'undercover' && !p.eliminated) pts = 3;
    if (pts > 0) { room.scores[p.name].points += pts; room.scores[p.name].wins += 1; }
  });
}

function broadcastGameOver(room, outcome) {
  io.to(room.code).emit('game-over', {
    outcome,
    civWord:   room.civWord,
    underWord: room.underWord,
    players:   room.players.map(p => ({ name: p.name, role: p.role, eliminated: p.eliminated })),
    scores:    room.scores,
  });
  room.phase = 'win';
}

function tallyVotes(room) {
  const tally = {};
  Object.values(room.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const maxVotes    = Math.max(...Object.values(tally));
  const topTargets  = Object.keys(tally).filter(t => tally[t] === maxVotes);
  return topTargets[Math.floor(Math.random() * topTargets.length)]; // random tie-break
}

function eliminatePlayer(room, name) {
  const player = room.players.find(p => p.name === name);
  if (!player) return;
  player.eliminated = true;

  room.phase = 'elimination';
  io.to(room.code).emit('player-eliminated', {
    name:          player.name,
    role:          player.role,
    mrWhiteGuessing: player.role === 'mrwhite',
  });

  if (player.role !== 'mrwhite') {
    resolveAfterElimination(room, player);
  }
  // If mrwhite → wait for 'mrwhite-guess' event
}

function resolveAfterElimination(room, eliminatedPlayer) {
  const outcome = checkWin(room);
  if (outcome !== 'continue') {
    awardScores(room, outcome);
    setTimeout(() => broadcastGameOver(room, outcome), 2500);
  } else {
    // Advance to next round automatically (skip re-reveal for online)
    room.round++;
    setTimeout(() => startDescriptionPhase(room), 2500);
  }
}

function startDescriptionPhase(room) {
  room.phase = 'description';
  room.descriptions = {};
  room.players.filter(p => !p.eliminated).forEach(p => { p.hasDescribed = false; });
  io.to(room.code).emit('phase-changed', { phase: 'description', round: room.round });
}

// ─── Socket.IO event handling ────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Connected:', socket.id);

  // ── Create Room ───────────────────────────────────────────────────────────
  socket.on('create-room', ({ name, undercoverCount = 1, hasMrWhite = false }) => {
    const trimmed = (name || '').trim() || 'Host';
    const code    = generateCode();
    const player  = mkPlayer(socket.id, trimmed);

    const room = {
      code, hostId: socket.id,
      players:        [player],
      undercoverCount: Math.max(1, undercoverCount),
      hasMrWhite:     !!hasMrWhite,
      civWord: '', underWord: '',
      round: 1, phase: 'lobby',
      descriptions: {}, votes: {}, scores: {},
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('room-created', {
      code, isHost: true,
      players: room.players.map(safePlayer),
    });
    console.log(`Room ${code} created by ${trimmed}`);
  });

  // ── Join Room ─────────────────────────────────────────────────────────────
  socket.on('join-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room)               return socket.emit('join-error', { message: 'Room not found. Check the code!' });
    if (room.phase !== 'lobby') return socket.emit('join-error', { message: 'Game already started!' });
    if (room.players.length >= 12) return socket.emit('join-error', { message: 'Room is full (max 12 players)!' });

    const trimmed = (name || '').trim() || `Player ${room.players.length + 1}`;
    if (room.players.some(p => p.name === trimmed))
      return socket.emit('join-error', { message: 'That name is taken in this room!' });

    const player = mkPlayer(socket.id, trimmed);
    room.players.push(player);
    socket.join(room.code);
    socket.data.roomCode = room.code;

    socket.emit('room-joined', {
      code: room.code, isHost: false,
      players: room.players.map(safePlayer),
    });
    io.to(room.code).emit('player-joined', { name: trimmed, players: room.players.map(safePlayer) });
    console.log(`${trimmed} joined ${room.code}`);
  });

  // ── Start Game (host) ─────────────────────────────────────────────────────
  socket.on('start-game', ({ code, wordPair }) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 3)
      return socket.emit('error-msg', { message: 'Need at least 3 players!' });

    // Validate undercover settings
    const totalSpecial = room.undercoverCount + (room.hasMrWhite ? 1 : 0);
    if (totalSpecial >= room.players.length) {
      room.undercoverCount = 1;
      room.hasMrWhite      = false;
    }

    room.civWord   = wordPair.civ;
    room.underWord = wordPair.under;
    room.round     = 1;
    room.phase     = 'reveal';
    room.descriptions = {};
    room.votes        = {};

    assignRoles(room);
    room.players.forEach(p => {
      if (!room.scores[p.name]) room.scores[p.name] = { points: 0, wins: 0 };
    });

    const wordMap = { civilian: room.civWord, undercover: room.underWord, mrwhite: '???' };

    // Private reveal to each player
    room.players.forEach(p => {
      io.to(p.id).emit('game-started', {
        role: p.role,
        word: wordMap[p.role],
        totalPlayers: room.players.length,
        round: room.round,
      });
    });

    io.to(code).emit('phase-changed', {
      phase: 'reveal',
      totalPlayers: room.players.length,
      hostId: room.hostId,
    });
    console.log(`Game started in ${code}`);
  });

  // ── Player viewed word ────────────────────────────────────────────────────
  socket.on('player-ready', ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.hasReady) return;
    player.hasReady = true;

    const readyCount = room.players.filter(p => p.hasReady).length;
    io.to(code).emit('ready-progress', { ready: readyCount, total: room.players.length });

    if (readyCount >= room.players.length) {
      startDescriptionPhase(room);
    }
  });

  // ── Submit Description ────────────────────────────────────────────────────
  // type: 'text' | 'voice'
  // content: string (text) | base64 data-URL (voice)
  socket.on('submit-description', ({ code, type, content }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'description') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.hasDescribed || player.eliminated) return;

    player.hasDescribed = true;
    room.descriptions[player.name] = { name: player.name, type, content };

    const submitted = room.players.filter(p => !p.eliminated && p.hasDescribed).length;
    const total     = room.players.filter(p => !p.eliminated).length;

    io.to(code).emit('description-progress', { submitted, total, playerName: player.name });

    if (submitted >= total) {
      room.phase = 'discussion';
      const descs = shuffle(
        room.players.filter(p => !p.eliminated).map(p => room.descriptions[p.name])
      );
      io.to(code).emit('phase-changed', { phase: 'discussion', descriptions: descs, round: room.round });
    }
  });

  // ── Start Voting (host advances from discussion) ───────────────────────────
  socket.on('start-voting', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    room.phase = 'voting';
    room.votes = {};
    room.players.filter(p => !p.eliminated).forEach(p => { p.hasVoted = false; });
    io.to(code).emit('phase-changed', {
      phase: 'voting',
      players: room.players.filter(p => !p.eliminated).map(safePlayer),
    });
  });

  // ── Cast Vote ─────────────────────────────────────────────────────────────
  socket.on('cast-vote', ({ code, target }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'voting') return;
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.hasVoted || voter.eliminated) return;

    voter.hasVoted      = true;
    room.votes[voter.name] = target;

    const voted = Object.keys(room.votes).length;
    const total = room.players.filter(p => !p.eliminated).length;
    io.to(code).emit('vote-progress', { voted, total });

    if (voted >= total) {
      const eliminated = tallyVotes(room);
      eliminatePlayer(room, eliminated);
    }
  });

  // ── Mr. White Guess ───────────────────────────────────────────────────────
  socket.on('mrwhite-guess', ({ code, guess }) => {
    const room = getRoom(code);
    if (!room) return;
    const mrw = room.players.find(p => p.role === 'mrwhite');

    const g       = (guess || '').trim().toLowerCase();
    const correct = g === room.civWord.toLowerCase() || g === room.underWord.toLowerCase();
    const aliveUnder = room.players.filter(p => !p.eliminated && p.role === 'undercover');

    if (correct && aliveUnder.length === 0) {
      // Mr. White wins!
      if (mrw && room.scores[mrw.name]) {
        room.scores[mrw.name].points += 3;
        room.scores[mrw.name].wins   += 1;
      }
      io.to(code).emit('mrwhite-result', { correct: true, guess, civWord: room.civWord });
      setTimeout(() => broadcastGameOver(room, 'mrwhite'), 2500);
    } else {
      io.to(code).emit('mrwhite-result', { correct, guess, civWord: room.civWord });
      setTimeout(() => resolveAfterElimination(room, mrw), 2000);
    }
  });

  // ── Next Round (play again, same players) ─────────────────────────────────
  socket.on('next-round', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    room.phase = 'lobby';
    room.players.forEach(p => { p.eliminated = false; p.role = null; });
    io.to(code).emit('phase-changed', { phase: 'lobby', players: room.players.map(safePlayer) });
  });

  // ── Update room settings (host only, while in lobby) ─────────────────────
  socket.on('update-settings', ({ code, undercoverCount, hasMrWhite }) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    room.undercoverCount = Math.max(1, undercoverCount);
    room.hasMrWhite      = !!hasMrWhite;
    io.to(code).emit('settings-updated', { undercoverCount: room.undercoverCount, hasMrWhite: room.hasMrWhite });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      io.to(code).emit('player-disconnected', {
        name: player.name,
        players: room.players.map(safePlayer),
      });
    }

    // If host disconnects and game not started, close the room
    if (socket.id === room.hostId && room.phase === 'lobby') {
      rooms.delete(code);
      io.to(code).emit('room-closed', { message: 'Host left. Room closed.' });
    }
    console.log(`Disconnected: ${socket.id} from room ${code}`);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mkPlayer(id, name) {
  return { id, name, role: null, eliminated: false, connected: true, hasReady: false, hasDescribed: false, hasVoted: false };
}

server.listen(PORT, () => console.log(`Undercover Online running on port ${PORT}`));
