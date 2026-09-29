import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';

// ===== GAME ENGINE =====

const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
const MAX_PLAYERS = 10;
type Color = typeof COLORS[number];
type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
type Card = { id: string; color: Color | null; kind: CardKind; value?: number };
type Difficulty = 'easy' | 'medium' | 'hard';
type Player = { id: string; socketId: string | null; name: string; hand: Card[]; host: boolean; ai: boolean; connected: boolean; score: number; uno: boolean; difficulty: Difficulty };
type Room = { code: string; players: Player[]; started: boolean; finished: boolean; draw: Card[]; discard: Card[]; current: number; direction: 1 | -1; color: Color; message: string; turnDrawn: boolean; drawnCardId?: string; aiTimer?: ReturnType<typeof setTimeout> };
type PublicPlayer = Omit<Player, 'hand' | 'socketId'> & { count: number; hand?: Card[] };
type View = { code: string; players: PublicPlayer[]; started: boolean; finished: boolean; drawCount: number; top: Card | null; color: Color | null; current: string | null; message: string; you: string; turnDrawn: boolean };

function createDeck(): Card[] {
  const deck: Card[] = []; let n = 0;
  for (const color of COLORS) {
    deck.push({ id: `c${n++}`, color, kind: 'number', value: 0 });
    for (let value = 1; value <= 9; value++) for (let copy = 0; copy < 2; copy++) deck.push({ id: `c${n++}`, color, kind: 'number', value });
    for (const kind of ['skip', 'reverse', 'draw2'] as const) for (let copy = 0; copy < 2; copy++) deck.push({ id: `c${n++}`, color, kind });
  }
  for (let i = 0; i < 4; i++) { deck.push({ id: `c${n++}`, color: null, kind: 'wild' }, { id: `c${n++}`, color: null, kind: 'wild4' }); }
  return deck;
}
function shuffle<T>(cards: T[]): T[] { const result = [...cards]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function canAddPlayer(players: Player[]): boolean { return players.length < MAX_PLAYERS; }
function isPlayable(card: Card, top: Card, color: Color): boolean { return card.kind === 'wild' || card.kind === 'wild4' || card.color === color || (card.kind === top.kind && card.kind !== 'number') || (card.kind === 'number' && top.kind === 'number' && card.value === top.value); }
const advance = (r: Room, steps = 1) => { r.current = (r.current + r.direction * steps + r.players.length * steps) % r.players.length; r.turnDrawn = false; r.drawnCardId = undefined; };
function reshuffle(r: Room) { if (r.draw.length) return; if (r.discard.length < 2) return; const top = r.discard.pop()!; r.draw = shuffle(r.discard); r.discard = [top]; }
function drawCards(r: Room, p: Player, amount = 1) { for (let i = 0; i < amount; i++) { reshuffle(r); const card = r.draw.pop(); if (card) p.hand.push(card); } }
function startGame(r: Room) {
  const deck = shuffle(createDeck()); r.draw = deck; r.discard = []; r.started = true; r.finished = false; r.current = 0; r.direction = 1; r.turnDrawn = false;
  for (const p of r.players) { p.hand = []; p.uno = false; for (let i = 0;i<7;i++) p.hand.push(r.draw.pop()!); }
  let first = r.draw.pop()!; while (first.kind === 'wild4') { r.draw.unshift(first); first = r.draw.pop()!; } r.discard.push(first); r.color = first.color ?? COLORS[0]; r.message = `${r.players[0]?.name} goes first`;
  if (first.kind === 'skip' || first.kind === 'reverse' && r.players.length === 2) advance(r, 2); else if (first.kind === 'reverse') r.direction = -1; else if (first.kind === 'draw2') { drawCards(r, r.players[r.current], 2); advance(r); }
}
function playCard(r: Room, p: Player, cardId: string, chosen?: Color): string | null {
  if (!r.started || r.finished || r.players[r.current]?.id !== p.id) return 'It is not your turn.';
  const idx = p.hand.findIndex(c => c.id === cardId); if (idx < 0) return 'That card is not in your hand.';
  if (r.turnDrawn && r.drawnCardId && cardId !== r.drawnCardId) return 'After drawing, you can only play the card you just drew.';
  const card = p.hand[idx], top = r.discard.at(-1)!;
  if (!isPlayable(card, top, r.color)) return 'That card cannot be played right now.';
  if ((card.kind === 'wild' || card.kind === 'wild4') && (!chosen || !COLORS.includes(chosen))) return 'Choose a color to play a wild.';
  if (card.kind === 'wild4' && p.hand.some(c => c.color === r.color)) return 'You can only play Wild Draw Four when you have no matching color.';
  p.hand.splice(idx, 1); if (p.hand.length !== 1) p.uno = false; r.discard.push(card); r.color = card.color ?? chosen!; r.turnDrawn = false; r.drawnCardId = undefined;
  r.message = `${p.name} played ${card.kind === 'number' ? card.value : card.kind.replace('wild4','Wild +4').replace('wild','Wild').replace('draw2','Draw Two').replace('reverse','Reverse').replace('skip','Skip')}${card.color ? '' : ` · ${r.color}`}`;
  if (!p.hand.length) { r.finished = true; p.score += r.players.reduce((sum, other) => sum + (other === p ? 0 : other.hand.reduce((s,c)=>s+cardPoints(c),0)), 0); r.message = `${p.name} wins the round!`; return null; }
  if (card.kind === 'skip') advance(r, 2);
  else if (card.kind === 'reverse') { r.direction = r.players.length === 2 ? r.direction : r.direction * -1 as 1 | -1; advance(r, r.players.length === 2 ? 2 : 1); }
  else if (card.kind === 'draw2') { advance(r); drawCards(r, r.players[r.current], 2); r.message += ` · ${r.players[r.current].name} draws 2`; advance(r); }
  else if (card.kind === 'wild4') { advance(r); drawCards(r, r.players[r.current], 4); r.message += ` · ${r.players[r.current].name} draws 4`; advance(r); }
  else advance(r);
  return null;
}
const cardPoints = (c: Card) => c.kind === 'number' ? c.value ?? 0 : c.kind === 'wild' || c.kind === 'wild4' ? 50 : 20;
function aiChoice(p: Player, r: Room): Card | undefined {
  const top = r.discard.at(-1)!; const valid = p.hand.filter(c => isPlayable(c, top, r.color) && (c.kind !== 'wild4' || !p.hand.some(x => x.color === r.color)));
  if (!valid.length) return undefined;
  if (p.difficulty === 'easy') return valid[Math.floor(Math.random() * valid.length)];
  const counts = Object.fromEntries(COLORS.map(c => [c, p.hand.filter(x => x.color === c).length])) as Record<Color,number>;
  const threat = r.players.some(x => x.id !== p.id && x.hand.length <= 2);
  const ranked = [...valid].sort((a,b) => {
    const score = (c: Card) => (c.kind === 'number' ? 0 : c.kind === 'wild4' ? 1 : c.kind === 'wild' ? 0 : 3) + (c.color ? counts[c.color] * 3 : -4) + (threat && p.difficulty === 'hard' && ['skip','reverse','draw2','wild4'].includes(c.kind) ? 10 : 0) + (p.difficulty === 'hard' && c.kind === 'wild4' ? 1 : 0);
    return score(b)-score(a);
  }); return ranked[0];
}
function viewFor(r: Room, id: string): View {
  return { code:r.code, players:r.players.map(p => ({ id:p.id,name:p.name,host:p.host,ai:p.ai,connected:p.connected,score:p.score,uno:p.uno,difficulty:p.difficulty,count:p.hand.length,...(p.id===id?{hand:p.hand}: {}) })), started:r.started,finished:r.finished,drawCount:r.draw.length,top:r.discard.at(-1)??null,color:r.started?r.color:null,current:r.started?r.players[r.current]?.id??null:null,message:r.message,you:id,turnDrawn:r.turnDrawn };
}

// ===== SERVER =====

const app = express(); const http = createServer(app);
const allowed = process.env.CLIENT_ORIGIN?.split(',') ?? ['http://localhost:5173'];
const io = new Server(http, { cors: { origin: allowed, methods: ['GET','POST'] } });
app.get('/health', (_req,res) => res.json({ ok:true, rooms: rooms.size }));
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
app.use(express.static(dist));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const rooms = new Map<string, Room>(); const holdUntil = new Map<string, number>(); const DEAL_MS = 3200; const timers = new Map<string, ReturnType<typeof setTimeout>>();
const code = () => { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(randomBytes(5),b=>chars[b%chars.length]).join(''); };
const cleanName=(s:unknown)=>typeof s==='string'?s.trim().replace(/\s+/g,' ').slice(0,18):'';
function broadcast(r:Room) { for(const p of r.players) if(p.socketId) io.to(p.socketId).emit('state', viewFor(r,p.id)); }
function clearTimer(r:Room) { const t=timers.get(r.code); if(t)clearTimeout(t); timers.delete(r.code); }
function scheduleAI(r:Room) {
  clearTimer(r); if(!r.started||r.finished)return; const p=r.players[r.current]; if(!p?.ai)return;
  const wait=(p.difficulty==='easy'?900:1300)+Math.max(0,(holdUntil.get(r.code)??0)-Date.now());
  const timer=setTimeout(()=>{ const live=rooms.get(r.code); if(live!==r||!r.started||r.finished||r.players[r.current]?.id!==p.id)return; if(p.hand.length===2)p.uno=true;
    const card=aiChoice(p,r); if(card){const chosen=card.color?undefined:COLORS.filter(c=>p.hand.some(x=>x.color===c)).sort((a,b)=>p.hand.filter(x=>x.color===b).length-p.hand.filter(x=>x.color===a).length)[0]??'blue'; playCard(r,p,card.id,chosen as Color);}
    else {drawCards(r,p); const drawn=p.hand.at(-1); if(drawn&&r.discard.at(-1)&&isPlayable(drawn,r.discard.at(-1)!,r.color)&&(drawn.kind!=='wild4'||!p.hand.some(x=>x.color===r.color))) { const chosen=drawn.color??COLORS.filter(c=>p.hand.some(x=>x.color===c)).sort((a,b)=>p.hand.filter(x=>x.color===b).length-p.hand.filter(x=>x.color===a).length)[0]??'blue'; playCard(r,p,drawn.id,chosen as Color); } else { r.message=`${p.name} drew a card`; (r as Room & {current:number}).current=(r.current+r.direction+r.players.length)%r.players.length; r.turnDrawn=false; }
    }
    broadcast(r); scheduleAI(r);
  },wait); timers.set(r.code,timer);
}
function penalizeMissedUno(r:Room, actor:Player) {
  const caught=r.players.filter(p=>p!==actor&&p.hand.length===1&&!p.uno);
  for(const p of caught) drawCards(r,p,2);
  if(caught.length)r.message=`${caught.map(p=>p.name).join(', ')} forgot UNO and drew 2`;
}
function removePlayer(r:Room,p:Player) {
  const idx=r.players.indexOf(p); if(idx<0)return; const wasCurrent=idx===r.current; r.players.splice(idx,1); if(!r.players.length){clearTimer(r);rooms.delete(r.code);return;}
  if(idx<r.current)r.current--; if(r.current>=r.players.length)r.current=0;
  if(p.host)r.players[0].host=true;
  if(r.started&&r.players.length<2){r.finished=true;r.message='Round ended · not enough players remain';}
  else if(r.started&&wasCurrent)r.turnDrawn=false;
  broadcast(r); scheduleAI(r);
}
io.on('connection',socket=>{
  const safeOn=(event:string,handler:(...args:any[])=>void)=>socket.on(event,(raw:unknown,response:unknown)=>{const payload=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};const ack=typeof response==='function'?response:()=>{};try{handler(payload,ack);}catch{ack({error:'Invalid request.'});}});
  const cleanDifficulty=(value:unknown):Difficulty=>value==='easy'||value==='hard'||value==='medium'?value:'medium';
  safeOn('create',({name,difficulty='medium'}:{name:string;difficulty?:Difficulty},ack:(x:unknown)=>void=()=>{})=>{
    const playerName=cleanName(name); if(!playerName)return ack({error:'Enter a display name to continue.'});
    let roomCode=code();while(rooms.has(roomCode))roomCode=code(); const id=randomUUID();
    const p:Player={id,socketId:socket.id,name:playerName,hand:[],host:true,ai:false,connected:true,score:0,uno:false,difficulty:cleanDifficulty(difficulty)};
    const room:Room={code:roomCode,players:[p],started:false,finished:false,draw:[],discard:[],current:0,direction:1,color:'red',message:'Waiting for players…',turnDrawn:false}; rooms.set(roomCode,room);socket.join(roomCode);ack({id,code:roomCode});broadcast(room);
  });
  safeOn('join',({code:raw,name,playerId}:{code:string;name:string;playerId?:string},ack:(x:unknown)=>void=()=>{})=>{
    const key=(raw??'').trim().toUpperCase(), r=rooms.get(key), playerName=cleanName(name); if(!r)return ack({error:'Room not found. Check the code and try again.'}); if(!playerName)return ack({error:'Enter a display name to continue.'});
    const rejoin=playerId&&r.players.find(p=>p.id===playerId); if(rejoin){rejoin.socketId=socket.id;rejoin.connected=true;socket.join(r.code);ack({id:rejoin.id,code:r.code});broadcast(r);return;}
    if(r.started)return ack({error:'This game has already started.'}); if(!canAddPlayer(r.players))return ack({error:`Room is full. The limit is ${MAX_PLAYERS} players.`}); if(r.players.some(p=>p.name.toLowerCase()===playerName.toLowerCase()))return ack({error:'Name already taken in this room.'});
    const p:Player={id:randomUUID(),socketId:socket.id,name:playerName,hand:[],host:false,ai:false,connected:true,score:0,uno:false,difficulty:'medium'};r.players.push(p);socket.join(r.code);r.message=`${playerName} joined the table`;ack({id:p.id,code:r.code});broadcast(r);
  });
  const find=(id:string)=>[...rooms.values()].map(r=>[r,r.players.find(p=>p.socketId===socket.id&&p.id===id)] as const).find(([,p])=>p);
  safeOn('start',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'You are no longer in that room.'});const [r,p]=hit;if(!p!.host)return ack({error:'Only the host can start the game.'});if(r.players.length<2)return ack({error:'Add another player or an AI to start.'});if(r.started&&!r.finished)return ack({error:'The game is already in progress.'});startGame(r);holdUntil.set(r.code,Date.now()+DEAL_MS);ack({ok:true});broadcast(r);scheduleAI(r);});
  safeOn('add-ai',({id,difficulty='medium'}:{id:string;difficulty?:Difficulty},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(!p!.host)return ack({error:'Only the host can add AI players.'});if(r.started)return ack({error:'AI players can only be added in the lobby.'});if(!canAddPlayer(r.players))return ack({error:`Room is full (${MAX_PLAYERS} players maximum).`});const bot:Player={id:randomUUID(),socketId:null,name:`${['Nova','Pixel','Comet','Miso','Echo','Orbit','Sunny','Mochi'][r.players.filter(x=>x.ai).length%8]} AI`,hand:[],host:false,ai:true,connected:true,score:0,uno:false,difficulty:cleanDifficulty(difficulty)};r.players.push(bot);r.message=`${bot.name} joined the table`;ack({ok:true});broadcast(r);});
  safeOn('remove-ai',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(!p!.host)return ack({error:'Only the host can remove AI players.'});if(r.started)return ack({error:'AI players can only be removed in the lobby.'});const bot=[...r.players].reverse().find(x=>x.ai);if(bot)removePlayer(r,bot);ack({ok:true});});
  safeOn('play',({id,cardId,color}:{id:string;cardId:string;color?:Color},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;const message=playCard(r,p!,cardId,color);if(message)return ack({error:message});if(!r.finished)penalizeMissedUno(r,p!);ack({ok:true});broadcast(r);scheduleAI(r);});
  safeOn('draw',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(!r.started||r.finished||r.players[r.current]!==p)return ack({error:'It is not your turn.'});if(r.turnDrawn)return ack({error:'You already drew this turn.'});const before=p!.hand.length;drawCards(r,p!);r.turnDrawn=true;r.drawnCardId=p!.hand.at(-1)?.id;if(p!.hand.length===before){penalizeMissedUno(r,p!);r.message=`${p!.name} passed · draw pile empty`;r.turnDrawn=false;r.drawnCardId=undefined;r.current=(r.current+r.direction+r.players.length)%r.players.length;}else {r.message=`${p!.name} drew a card`;penalizeMissedUno(r,p!);}ack({ok:true});broadcast(r);scheduleAI(r);});
  safeOn('pass',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(!r.turnDrawn||r.players[r.current]!==p)return ack({error:'Draw before passing.'});penalizeMissedUno(r,p!);r.turnDrawn=false;r.drawnCardId=undefined;r.current=(r.current+r.direction+r.players.length)%r.players.length;r.message=`${p!.name} passed`;ack({ok:true});broadcast(r);scheduleAI(r);});
  safeOn('uno',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(p!.hand.length>2||p!.hand.length===0)return ack({error:'Call UNO when you have one card left, or before playing your second-to-last card.'});p!.uno=true;r.message=`${p!.name} called UNO!`;ack({ok:true});broadcast(r);});
  safeOn('restart',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r,p]=hit;if(!p!.host)return ack({error:'Only the host can start a new round.'});if(!r.finished)return ack({error:'The round is still in progress.'});if(r.players.length<2)return ack({error:'At least two players are needed for a new round.'});startGame(r);holdUntil.set(r.code,Date.now()+DEAL_MS);ack({ok:true});broadcast(r);scheduleAI(r);});
  safeOn('return-lobby',({id}:{id:string},ack:(x:unknown)=>void=()=>{})=>{const hit=find(id);if(!hit)return ack({error:'Room not found.'});const[r]=hit;if(!r.finished)return ack({error:'The round is still in progress.'});clearTimer(r);r.started=false;r.finished=false;r.draw=[];r.discard=[];r.current=0;r.direction=1;r.turnDrawn=false;r.drawnCardId=undefined;r.players.forEach(p=>{p.hand=[];p.uno=false;});r.message='Back in the lobby · ready for another round?';ack({ok:true});broadcast(r);});
  safeOn('leave',({id}:{id:string})=>{const hit=find(id);if(hit)removePlayer(hit[0],hit[1]!);});
  socket.on('disconnect',()=>{for(const r of rooms.values()){const p=r.players.find(x=>x.socketId===socket.id);if(p){p.connected=false;p.socketId=null;broadcast(r);setTimeout(()=>{const live=rooms.get(r.code);if(live?.players.includes(p)&&!p.connected)removePlayer(live,p);},30000);}}});
});
const port=Number(process.env.PORT??3001);http.listen(port,()=>console.log(`YSN UNO server listening on ${port}`));
