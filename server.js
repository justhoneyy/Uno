'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000, MAX = 10, TURN_MS = 45000, OFF_TURN_MS = 4000, MAX_ROOMS = 1000;
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'));
const rooms = new Map();

const server = http.createServer((q, s) => {
  if (q.url === '/health') return s.end('ok');
  s.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' ws: wss:"
  });
  s.end(HTML);
});
const wss = new WebSocketServer({ server, maxPayload: 1024 });

// ---------- helpers ----------
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from(crypto.randomBytes(6), b => CH[b % 32]).join(''); } while (rooms.has(c)); return c; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';
const send = (p, o) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const err = (ws, m, fatal) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'err', m, fatal }));

function makeDeck() {
  const d = []; let n = 0; const add = (c, v) => d.push({ id: n++, c, v });
  for (const c of 'rygb') { add(c, '0'); for (let i = 1; i <= 9; i++) { add(c, '' + i); add(c, '' + i); } for (const v of 'SRD') { add(c, v); add(c, v); } }
  for (let i = 0; i < 4; i++) { add('w', 'W'); add('w', 'F'); }
  return shuffle(d);
}
const cur = r => r.players[r.turn];
const nxt = (r, s = 1) => { const n = r.players.length; return (((r.turn + r.dir * s) % n) + n) % n; };
const top = r => r.discard[r.discard.length - 1];
const ok = (r, c) => c.c === 'w' || c.c === r.color || c.v === top(r).v;
const arm = r => { r.deadline = Date.now() + (cur(r).online ? TURN_MS : OFF_TURN_MS); };
const step = (r, s = 1) => { r.turn = nxt(r, s); r.drawn = null; arm(r); };
const say = (r, m) => { r.log.push(m); if (r.log.length > 20) r.log.shift(); };

function take(r, p, n) {
  for (let i = 0; i < n; i++) {
    if (!r.deck.length) { const t = r.discard.pop(); r.deck = shuffle(r.discard); r.discard = [t]; if (!r.deck.length) break; }
    p.hand.push(r.deck.pop());
  }
  p.uno = false;
}

// ---------- views (never leak other hands / deck) ----------
function view(r, p) {
  const playing = r.phase === 'playing';
  return {
    t: 'state', code: r.code, you: p.id, host: r.host, phase: r.phase,
    players: r.players.map(q => ({ id: q.id, name: q.name, av: q.av, n: q.hand.length, on: q.online, uno: q.uno })),
    hand: p.hand, top: r.discard.length ? top(r) : null, color: r.color, dir: r.dir,
    turn: playing ? cur(r).id : null, deck: r.deck.length, ms: Math.max(0, r.deadline - Date.now()),
    drawn: playing && cur(r) === p ? r.drawn : null, catch: r.catch, winner: r.winner, log: r.log.slice(-5)
  };
}
const push = r => r.players.forEach(p => send(p, view(r, p)));

// ---------- game actions ----------
function deal(r) {
  r.deck = makeDeck(); r.players.forEach(p => { p.hand = []; p.uno = false; });
  for (let i = 0; i < 7; i++) r.players.forEach(p => p.hand.push(r.deck.pop()));
  const i = r.deck.findIndex(c => /\d/.test(c.v));
  r.discard = r.deck.splice(i, 1); r.color = top(r).c;
  r.turn = crypto.randomInt(r.players.length); r.dir = 1; r.drawn = null; r.catch = null; r.winner = null;
  r.phase = 'playing'; r.log = ['Game started']; arm(r);
}

function play(r, p, cid, col) {
  if (r.phase !== 'playing' || cur(r) !== p) return;
  if (r.drawn != null && r.drawn !== cid) return;
  const i = p.hand.findIndex(c => c.id === cid); if (i < 0) return;
  const c = p.hand[i]; if (!ok(r, c)) return;
  if (c.c === 'w' && !(typeof col === 'string' && col.length === 1 && 'rygb'.includes(col))) return;
  p.hand.splice(i, 1); r.discard.push(c); r.color = c.c === 'w' ? col : c.c; r.drawn = null; r.catch = null;
  if (!p.hand.length) { r.phase = 'over'; r.winner = p.id; say(r, p.name + ' wins!'); return; }
  if (p.hand.length === 1 && !p.uno) r.catch = p.id;
  const n = r.players.length; let s = 1;
  if (c.v === 'R') { r.dir *= -1; if (n === 2) s = 2; }
  else if (c.v === 'S') { s = 2; say(r, r.players[nxt(r)].name + ' is skipped'); }
  else if (c.v === 'D' || c.v === 'F') { const q = r.players[nxt(r)]; const k = c.v === 'D' ? 2 : 4; take(r, q, k); say(r, q.name + ' draws ' + k); s = 2; }
  step(r, s);
}

function draw(r, p) {
  if (r.phase !== 'playing' || cur(r) !== p || r.drawn != null) return;
  r.catch = null; take(r, p, 1);
  const c = p.hand[p.hand.length - 1];
  if (c && ok(r, c)) r.drawn = c.id; else step(r);
}

function remove(r, q) {
  const i = r.players.indexOf(q); if (i < 0) return;
  r.players.splice(i, 1);
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.host === q.id) r.host = (r.players.find(x => x.online) || r.players[0]).id;
  if (r.phase === 'playing') {
    r.deck.push(...q.hand); shuffle(r.deck);
    if (r.catch === q.id) r.catch = null;
    if (r.players.length < 2) { r.phase = 'over'; r.winner = r.players[0].id; say(r, 'Everyone else left'); }
    else if (i < r.turn) r.turn--;
    else if (i === r.turn) { const n = r.players.length; r.turn = r.dir === 1 ? r.turn % n : (r.turn - 1 + n) % n; r.drawn = null; arm(r); }
  }
  push(r);
}

// ---------- message handling ----------
function handle(ws, m) {
  const t = m.t;
  if (t === 'create' || t === 'join') {
    if (ws.p) return;
    let r;
    if (t === 'create') {
      if (rooms.size >= MAX_ROOMS) return err(ws, 'Server is busy. Try again soon.');
      r = { code: newCode(), host: null, phase: 'lobby', players: [], deck: [], discard: [], turn: 0, dir: 1, color: 'r', drawn: null, catch: null, winner: null, deadline: 0, log: [] };
      rooms.set(r.code, r);
    } else {
      r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return err(ws, 'Room not found. Check the code.');
      if (r.phase !== 'lobby') return err(ws, 'That game has already started.');
      if (r.players.length >= MAX) return err(ws, 'Room is full (10 players).');
    }
    const p = { id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'), name: cleanName(m.name),
      av: Number.isInteger(m.av) && m.av >= 0 && m.av < 24 ? m.av : 0, hand: [], ws, online: true, off: 0, uno: false };
    r.players.push(p); if (!r.host) r.host = p.id; ws.p = p; ws.r = r;
    send(p, { t: 'joined', code: r.code, token: p.token }); return push(r);
  }
  if (t === 'resume') {
    const r = rooms.get(String(m.code || '')); const p = r && r.players.find(x => x.token === m.token);
    if (!p) return err(ws, 'Session expired.', 'resume');
    if (p.ws && p.ws !== ws) { p.ws.p = null; p.ws.close(); }
    p.ws = ws; p.online = true; ws.p = p; ws.r = r;
    send(p, { t: 'joined', code: r.code, token: p.token }); return push(r);
  }
  const p = ws.p, r = ws.r; if (!p || !rooms.has(r.code)) return;
  const host = r.host === p.id;
  switch (t) {
    case 'start': if (host && r.phase === 'lobby' && r.players.length >= 2) deal(r); break;
    case 'restart': if (host && r.phase !== 'lobby' && r.players.length >= 2) deal(r); break;
    case 'kick': {
      const q = host && r.players.find(x => x.id === m.id);
      if (q && q !== p) { send(q, { t: 'kicked' }); if (q.ws) { q.ws.p = null; q.ws.r = null; } remove(r, q); }
      return;
    }
    case 'leave': ws.p = null; ws.r = null; remove(r, p); return;
    case 'play': play(r, p, m.id, m.color); break;
    case 'draw': draw(r, p); break;
    case 'pass': if (r.phase === 'playing' && cur(r) === p && r.drawn != null) step(r); break;
    case 'uno': if (p.hand.length <= 2 && p.hand.length > 0) { p.uno = true; if (r.catch === p.id) r.catch = null; say(r, p.name + ' calls UNO!'); } break;
    case 'catch': {
      const q = r.catch && r.catch !== p.id && r.players.find(x => x.id === r.catch);
      if (q) { take(r, q, 2); r.catch = null; say(r, p.name + ' caught ' + q.name + ' (+2)'); }
      break;
    }
    case 'chat': {
      const x = String(m.x || '').replace(/[\u0000-\u001f]/g, '').slice(0, 80); if (!x) return;
      r.players.forEach(q => send(q, { t: 'chat', n: p.name, x })); return;
    }
    default: return;
  }
  push(r);
}

wss.on('connection', (ws, req) => {
  const allow = process.env.ALLOWED_ORIGIN;
  if (allow && req.headers.origin !== allow) return ws.close();
  ws.hits = 0; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (++ws.hits > 20) return ws.close();
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error(e); }
  });
  ws.on('close', () => {
    const p = ws.p, r = ws.r;
    if (!p || p.ws !== ws) return;
    p.ws = null; p.online = false; p.off = Date.now();
    if (r.host === p.id) { const o = r.players.find(x => x.online); if (o) r.host = o.id; }
    push(r);
  });
});

setInterval(() => wss.clients.forEach(w => { w.hits = 0; }), 1000);
setInterval(() => wss.clients.forEach(w => { if (!w.alive) return w.terminate(); w.alive = false; w.ping(); }), 25000);
setInterval(() => {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    for (const p of [...r.players]) if (!p.online && now - p.off > (r.phase === 'lobby' ? 30000 : 120000)) remove(r, p);
    if (!rooms.has(r.code)) continue;
    if (r.phase === 'playing' && now > r.deadline) {
      const p = cur(r); say(r, p.name + ' ran out of time');
      if (r.drawn == null) draw(r, p);
      if (r.drawn != null) step(r);
      push(r);
    }
  }
}, 1000);

server.listen(PORT, () => console.log('UNO server on :' + PORT));
