// HandCricket — multiplayer game server + WebRTC signaling
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const BET_MS = 15000;      // betting window
const REVEAL_MS = 2200;    // fists shaking
const RESULT_MS = 4500;    // result shown before next round
const START_BALANCE = 1000;
const MAX_PLAYERS = 6;
const MAX_BET = 100000;

// Every market has ~0.99 return: Blue/Red push on a tie, Over/Under push on 7.
const PAYOUT = { blue: 1.98, red: 1.98, tie: 5.94, odd: 1.98, even: 1.98, over: 1.98, under: 1.98 };

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ICE servers for WebRTC. STUN works for most home networks; add a TURN server
// (env vars) for strict corporate / mobile-carrier networks.
app.get('/api/ice', (_req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    ice.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  }
  res.json(ice);
});

const rooms = new Map();
const round2 = (n) => Math.round(n * 100) / 100;

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    roundId: room.roundId,
    roundNo: room.roundNo,
    endsAt: room.endsAt,
    serverNow: Date.now(),
    betMs: BET_MS,
    result: room.phase === 'result' ? room.result : null,
    history: room.history.slice(-24),
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      inCall: p.inCall,
      staked: (room.bets.get(p.id) || []).reduce((s, b) => s + b.amount, 0),
    })),
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function settle(market, b, r) {
  const sum = b + r;
  switch (market) {
    case 'blue': return b > r ? 'win' : b === r ? 'push' : 'lose';
    case 'red': return r > b ? 'win' : b === r ? 'push' : 'lose';
    case 'tie': return b === r ? 'win' : 'lose';
    case 'odd': return sum % 2 === 1 ? 'win' : 'lose';
    case 'even': return sum % 2 === 0 ? 'win' : 'lose';
    case 'over': return sum > 7 ? 'win' : sum === 7 ? 'push' : 'lose';
    case 'under': return sum < 7 ? 'win' : sum === 7 ? 'push' : 'lose';
    default: return 'lose';
  }
}

function startRound(room) {
  clearTimeout(room.timer);
  room.phase = 'betting';
  room.roundId = crypto.randomUUID();
  room.roundNo += 1;
  room.endsAt = Date.now() + BET_MS;
  room.bets = new Map();
  room.result = null;
  broadcast(room);
  room.timer = setTimeout(() => startReveal(room), BET_MS);
}

function startReveal(room) {
  room.phase = 'reveal';
  room.endsAt = Date.now() + REVEAL_MS;
  broadcast(room);
  room.timer = setTimeout(() => finishRound(room), REVEAL_MS);
}

function finishRound(room) {
  const b = crypto.randomInt(1, 7);
  const r = crypto.randomInt(1, 7);
  const sum = b + r;
  const winner = b > r ? 'blue' : r > b ? 'red' : 'tie';
  const payouts = {};

  for (const [pid, bets] of room.bets) {
    const player = room.players.get(pid);
    let returned = 0;
    let staked = 0;
    const lines = bets.map((bet) => {
      const outcome = settle(bet.market, b, r);
      const back = outcome === 'win' ? bet.amount * PAYOUT[bet.market] : outcome === 'push' ? bet.amount : 0;
      returned += back;
      staked += bet.amount;
      return { ...bet, outcome, back: round2(back) };
    });
    if (player) player.balance = round2(player.balance + returned);
    payouts[pid] = { staked: round2(staked), returned: round2(returned), net: round2(returned - staked), lines };
  }

  room.result = { blue: b, red: r, sum, winner, roundId: room.roundId };
  room.history.push({ blue: b, red: r, sum, winner });
  if (room.history.length > 50) room.history.shift();
  room.phase = 'result';
  room.endsAt = Date.now() + RESULT_MS;

  // everyone sees the result; each player gets their own payout breakdown
  broadcast(room);
  for (const pid of room.players.keys()) {
    io.to(pid).emit('payout', payouts[pid] || null);
  }
  room.timer = setTimeout(() => startRound(room), RESULT_MS);
}

function leaveRoom(socket) {
  const code = socket.data.room;
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(socket.id);
  if (p) {
    room.saved.set(p.name.toLowerCase(), p.balance); // restore balance if they rejoin
    if (p.inCall) socket.to(code).emit('call-peer-left', { id: socket.id });
  }
  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.room = null;
  if (room.players.size === 0) {
    clearTimeout(room.timer);
    rooms.delete(code);
  } else {
    io.to(code).emit('toast', { text: `${p ? p.name : 'A player'} left the room` });
    broadcast(room);
  }
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ code, name } = {}, cb = () => {}) => {
    name = String(name || '').trim().slice(0, 18) || `Player_${crypto.randomInt(1000, 9999)}`;
    code = String(code || '').trim().toUpperCase();
    if (socket.data.room) leaveRoom(socket);

    let room = code ? rooms.get(code) : null;
    if (code && !room) return cb({ ok: false, error: 'Room not found. Check the code.' });
    if (room && room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full.' });
    if (room && [...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ ok: false, error: 'That name is taken in this room.' });
    }

    if (!room) {
      room = {
        code: newCode(), players: new Map(), saved: new Map(), bets: new Map(),
        history: [], phase: 'betting', roundNo: 0, timer: null,
      };
      rooms.set(room.code, room);
    }

    const balance = room.saved.has(name.toLowerCase()) ? room.saved.get(name.toLowerCase()) : START_BALANCE;
    room.players.set(socket.id, { id: socket.id, name, balance, inCall: false });
    socket.join(room.code);
    socket.data.room = room.code;

    if (room.players.size === 1 && !room.timer) startRound(room);
    else {
      socket.to(room.code).emit('toast', { text: `${name} joined the room` });
      broadcast(room);
    }
    cb({ ok: true, id: socket.id, name, state: publicState(room) });
  });

  socket.on('bet', ({ market, amount } = {}, cb = () => {}) => {
    const room = rooms.get(socket.data.room);
    if (!room) return cb({ ok: false, error: 'Not in a room' });
    const p = room.players.get(socket.id);
    amount = round2(Number(amount));
    if (room.phase !== 'betting' || Date.now() > room.endsAt - 250) return cb({ ok: false, error: 'Betting is closed for this round' });
    if (!PAYOUT[market]) return cb({ ok: false, error: 'Unknown market' });
    if (!(amount >= 1) || amount > MAX_BET) return cb({ ok: false, error: 'Invalid amount' });
    if (amount > p.balance) return cb({ ok: false, error: 'Not enough coins' });

    p.balance = round2(p.balance - amount);
    const list = room.bets.get(socket.id) || [];
    list.push({ market, amount });
    room.bets.set(socket.id, list);

    socket.to(room.code).emit('bet-feed', { name: p.name, market, amount });
    broadcast(room);
    cb({ ok: true, balance: p.balance, bets: list });
  });

  socket.on('refill', (cb = () => {}) => {
    const room = rooms.get(socket.data.room);
    const p = room && room.players.get(socket.id);
    if (!p) return cb({ ok: false });
    if (p.balance >= 50) return cb({ ok: false, error: 'Refill is only available below 50 coins' });
    p.balance = START_BALANCE;
    broadcast(room);
    cb({ ok: true });
  });

  // ---------- WebRTC call signaling (mesh) ----------
  socket.on('call-join', (cb = () => {}) => {
    const room = rooms.get(socket.data.room);
    const p = room && room.players.get(socket.id);
    if (!p) return cb([]);
    const others = [...room.players.values()].filter((o) => o.inCall && o.id !== socket.id).map((o) => ({ id: o.id, name: o.name }));
    p.inCall = true;
    socket.to(room.code).emit('call-peer-joined', { id: socket.id, name: p.name });
    broadcast(room);
    cb(others); // newcomer sends offers to everyone already in the call
  });

  socket.on('call-leave', () => {
    const room = rooms.get(socket.data.room);
    const p = room && room.players.get(socket.id);
    if (!p) return;
    p.inCall = false;
    socket.to(room.code).emit('call-peer-left', { id: socket.id });
    broadcast(room);
  });

  socket.on('signal', ({ to, data } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.players.has(to)) return;
    const p = room.players.get(socket.id);
    io.to(to).emit('signal', { from: socket.id, name: p ? p.name : '', data });
  });

  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`HandCricket running on http://localhost:${PORT}`));
