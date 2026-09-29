import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import './style.css';
import { ArrowLeft, ArrowRight, Bot, Check, ChevronDown, CircleHelp, Copy, Crown, DoorOpen, Hash, Layers, LogOut, Plus, RotateCcw, ShieldCheck, Sparkles, Volume2, VolumeX, Wifi, Zap } from 'lucide-react';

type Color = 'red' | 'blue' | 'green' | 'yellow';
type Card = { id: string; color: Color | null; kind: 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'; value?: number };
type Player = { id: string; name: string; host: boolean; ai: boolean; connected: boolean; score: number; uno: boolean; difficulty: string; count: number; hand?: Card[] };
type State = { code: string; players: Player[]; started: boolean; finished: boolean; drawCount: number; top: Card | null; color: Color | null; current: string | null; message: string; you: string; turnDrawn: boolean };
type Ack = { error?: string; id?: string; code?: string; ok?: boolean };

const socket: Socket = io();
const KEY_PLAYER = 'ysn-uno-player';
const KEY_ROOM = 'ysn-uno-room';
const KEY_NAME = 'ysn-uno-name';
const COLORS: Color[] = ['red', 'blue', 'green', 'yellow'];

function isWild(c: Card) { return c.kind === 'wild' || c.kind === 'wild4'; }
function canPlay(card: Card, s: State, hand: Card[]) {
  if (!s.top || !s.color) return false;
  if (card.kind === 'wild4') return !hand.some(c => c.color === s.color);
  if (card.kind === 'wild') return true;
  if (card.color === s.color) return true;
  if (card.kind === s.top.kind && card.kind !== 'number') return true;
  return card.kind === 'number' && s.top.kind === 'number' && card.value === s.top.value;
}
function symbolOf(card: Card) {
  switch (card.kind) {
    case 'number': return String(card.value);
    case 'skip': return '⊘';
    case 'reverse': return '⇄';
    case 'draw2': return '+2';
    case 'wild4': return '+4';
    default: return '✦';
  }
}

function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden>
      <span className="logo-card logo-card-a" />
      <span className="logo-card logo-card-b" />
      <b>U</b>
    </span>
  );
}

function CardFace({ card, large = false, playable = false }: { card: Card | null; large?: boolean; playable?: boolean }) {
  if (!card) return <div className="card-empty" />;
  const sym = symbolOf(card);
  const label = card.kind === 'number' ? 'YSN UNO' : card.kind === 'draw2' ? 'DRAW TWO' : card.kind === 'wild4' ? 'WILD DRAW FOUR' : card.kind.toUpperCase();
  return (
    <div className={`face face-${card.color ?? 'wild'} ${large ? 'face-large' : ''} ${playable ? 'is-playable' : ''}`}>
      <span className="face-shine" />
      <span className="card-corner">{sym}</span>
      <span className="face-oval"><span className="card-symbol">{sym}</span></span>
      <span className="card-label">{label}</span>
      <span className="card-corner corner-bottom">{sym}</span>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<'home' | 'create' | 'join'>('home');
  const [name, setName] = useState(localStorage.getItem(KEY_NAME) || '');
  const [code, setCode] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [playerId, setPlayerId] = useState(localStorage.getItem(KEY_PLAYER) || '');
  const [notice, setNotice] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [aiCount, setAiCount] = useState(2);
  const [pending, setPending] = useState<Card | null>(null);
  const [copied, setCopied] = useState(false);
  const [sound, setSound] = useState(true);
  const audio = useRef<AudioContext | null>(null);

  const act = (event: string, data: Record<string, unknown> = {}) =>
    new Promise<Ack>(resolve => socket.emit(event, data, (result: Ack) => resolve(result ?? {})));

  useEffect(() => {
    const onState = (s: State) => setState(s);
    const onNotice = (n: { message: string }) => setNotice(n.message);
    const reconnect = () => {
      const savedCode = localStorage.getItem(KEY_ROOM), savedName = localStorage.getItem(KEY_NAME), savedId = localStorage.getItem(KEY_PLAYER);
      if (savedCode && savedName && savedId) {
        socket.emit('join', { code: savedCode, name: savedName, playerId: savedId }, (result: { error?: string }) => {
          if (result?.error) {
            setNotice(result.error);
            if (result.error.includes('Room not found')) { localStorage.removeItem(KEY_PLAYER); localStorage.removeItem(KEY_ROOM); }
          }
        });
      }
    };
    socket.on('state', onState); socket.on('notice', onNotice); socket.on('connect', reconnect);
    if (socket.connected) reconnect();
    return () => { socket.off('state', onState); socket.off('notice', onNotice); socket.off('connect', reconnect); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const me = state?.players.find(p => p.id === state.you);
  const isMyTurn = state?.current === state?.you;
  const hand = me?.hand ?? [];
  const others = useMemo(() => state?.players.filter(p => p.id !== state.you) ?? [], [state]);
  const currentName = state?.players.find(p => p.id === state.current)?.name;

  function remember(id: string, roomCode: string) {
    setPlayerId(id);
    localStorage.setItem(KEY_PLAYER, id); localStorage.setItem(KEY_ROOM, roomCode); localStorage.setItem(KEY_NAME, name);
  }
  async function create() {
    const result = await act('create', { name, difficulty });
    if (result.error) return setNotice(result.error);
    const id = result.id!;
    remember(id, result.code!); setCode(result.code!); setScreen('home');
    for (let i = 0; i < aiCount; i++) await act('add-ai', { id, difficulty });
  }
  async function join() {
    const result = await act('join', { name, code, playerId });
    if (result.error) return setNotice(result.error);
    remember(result.id!, result.code!); setScreen('home');
  }
  function playCue(event: string) {
    if (!sound) return;
    try {
      const ctx = audio.current ?? (audio.current = new AudioContext());
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const freq = event === 'uno' ? 740 : event === 'draw' ? 300 : event === 'start' ? 520 : 440;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.045, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.14);
    } catch { /* audio unavailable */ }
  }
  async function doAction(event: string, data: Record<string, unknown> = {}) {
    const result = await act(event, { id: state?.you, ...data });
    if (result.error) setNotice(result.error);
    else if (['play', 'draw', 'uno', 'start'].includes(event)) playCue(event);
  }
  async function play(card: Card) {
    if (isWild(card)) { setPending(card); return; }
    await doAction('play', { cardId: card.id });
  }
  function back() {
    if (state) void doAction('leave');
    setState(null); setScreen('home');
    localStorage.removeItem(KEY_PLAYER); localStorage.removeItem(KEY_ROOM);
    setPlayerId('');
  }
  async function copyCode() {
    await navigator.clipboard?.writeText(state?.code ?? code);
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main className="app-shell">
      <div className="ambient" aria-hidden><i /><i /><i /></div>

      <header className="topbar">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); if (!state) setScreen('home'); }}>
          <Logo />
          <span className="brand-word">YSN<span className="brand-accent">UNO</span></span>
        </a>
        <div className="topbar-right">
          <span className="online"><i /> LIVE TABLES</span>
          <button className="icon-button" aria-label={sound ? 'Mute sound' : 'Enable sound'} onClick={() => setSound(!sound)}>
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <span className="avatar">{(me?.name || name || 'P').slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      {notice && <div className="toast" role="status"><CircleHelp size={16} />{notice}</div>}

      {!state && screen === 'home' && (
        <section className="landing">
          <div className="landing-copy">
            <div className="eyebrow"><span /> THE PREMIUM CARD TABLE</div>
            <h1>Play cards.<br /><em>Outsmart</em><br />everyone.</h1>
            <p>A private table, real-time rivals and a finish worth bragging about. Deal in, call it, win it.</p>
            <div className="landing-actions">
              <button className="primary-button" onClick={() => setScreen('create')}><Sparkles size={17} /> CREATE GAME <ArrowRight size={17} /></button>
              <button className="secondary-button" onClick={() => setScreen('join')}>JOIN A TABLE</button>
            </div>
            <div className="landing-foot">
              <span><Wifi size={15} /> REAL-TIME MULTIPLAYER</span>
              <span><Bot size={16} /> SMART AI OPPONENTS</span>
              <span><ShieldCheck size={15} /> SERVER-FAIR DEALS</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Premium cards on a game table">
            <div className="halo" />
            <div className="hero-card hero-card-blue"><span>7</span><b>YSN UNO</b></div>
            <div className="hero-card hero-card-yellow"><span>⇄</span></div>
            <div className="hero-card hero-card-red"><span>+2</span></div>
            <div className="hero-card hero-card-wild"><span>✦</span></div>
            <div className="floating-chip chip-top"><Zap size={12} /> YOUR MOVE</div>
            <div className="floating-chip chip-bottom"><i /> 4 PLAYERS READY</div>
          </div>
        </section>
      )}

      {!state && (screen === 'create' || screen === 'join') && (
        <section className="form-wrap">
          <button className="back-link" onClick={() => setScreen('home')}><ArrowLeft size={16} /> BACK</button>
          <div className="form-card glass">
            <div className="eyebrow"><span /> {screen === 'create' ? 'SET UP YOUR TABLE' : 'PULL UP A CHAIR'}</div>
            <h2>{screen === 'create' ? 'Create a game' : 'Join a game'}</h2>
            <p className="muted">{screen === 'create' ? 'Start a table and invite your people.' : 'Enter a room code and take your seat.'}</p>
            <label>DISPLAY NAME
              <input value={name} onChange={e => setName(e.target.value)} maxLength={18} placeholder="How should we call you?" autoFocus />
            </label>
            {screen === 'create' ? (
              <>
                <label>AI DIFFICULTY
                  <select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
                    <option value="easy">Easy · relaxed</option>
                    <option value="medium">Medium · clever</option>
                    <option value="hard">Hard · strategic</option>
                  </select>
                  <ChevronDown className="select-icon" size={15} />
                </label>
                <label>AI PLAYERS <span className="range-value">{aiCount}</span>
                  <input className="range" type="range" min="1" max="5" value={aiCount} onChange={e => setAiCount(+e.target.value)} />
                  <span className="range-labels"><span>Just me</span><span>Full table</span></span>
                </label>
                <button className="primary-button wide" disabled={!name.trim()} onClick={create}>CREATE YOUR TABLE <ArrowRight size={17} /></button>
              </>
            ) : (
              <>
                <label>ROOM CODE
                  <div className="code-input"><Hash size={17} />
                    <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="E.G. A7K2P" />
                  </div>
                </label>
                <button className="primary-button wide" disabled={!name.trim() || code.length < 5} onClick={join}>JOIN GAME <ArrowRight size={17} /></button>
              </>
            )}
            <div className="form-note"><Wifi size={14} /> Private room · up to 10 players</div>
          </div>
        </section>
      )}

      {state && !state.started && (
        <section className="lobby-wrap">
          <div className="lobby-head">
            <div>
              <div className="eyebrow"><span /> TABLE IS OPEN</div>
              <h2>Room lobby</h2>
              <p className="muted">Gather your crew, then let the cards fly.</p>
            </div>
            <button className="icon-button leave" onClick={back} aria-label="Leave room"><LogOut size={17} /></button>
          </div>
          <div className="room-code-card glass">
            <div>
              <span className="tiny-label">ROOM CODE</span>
              <strong>{state.code}</strong>
              <span className="muted">Share this code with your friends</span>
            </div>
            <button onClick={copyCode} className="copy-button">{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'COPIED' : 'COPY CODE'}</button>
          </div>
          <div className="lobby-players">
            <div className="section-heading">
              <span>PLAYERS <b>{state.players.length}<em>/10</em></b></span>
              <span className="muted">{state.players.length < 2 ? 'Need at least 2 to start' : 'Looking good!'}</span>
            </div>
            <div className="player-grid">
              {state.players.map((p, i) => (
                <div className="lobby-player glass" key={p.id} style={{ '--n': i } as CSSProperties}>
                  <div className={`player-avatar avatar-${i % 5}`}>{p.ai ? <Bot size={19} /> : p.name.slice(0, 1).toUpperCase()}</div>
                  <div><b>{p.name}</b><small>{p.ai ? `${p.difficulty} AI` : p.host ? (p.id === state.you ? 'HOST · YOU' : 'HOST') : p.id === state.you ? 'YOU' : 'PLAYER'}</small></div>
                  {p.host && <Crown className="crown" size={16} />}
                </div>
              ))}
              {Array.from({ length: Math.max(0, Math.min(3, 10 - state.players.length)) }, (_, i) => (
                <div className="empty-seat" key={i}><Plus size={16} /> OPEN SEAT</div>
              ))}
            </div>
          </div>
          <div className="lobby-footer">
            {me?.host ? (
              <div className="host-controls">
                <button className="secondary-button" onClick={() => doAction('add-ai', { difficulty })} disabled={state.players.length >= 10}><Bot size={16} /> ADD AI</button>
                <button className="icon-button" title="Remove last AI" onClick={() => doAction('remove-ai')}><LogOut size={15} /></button>
                <button className="primary-button start-button" disabled={state.players.length < 2} onClick={() => doAction('start')}>START GAME <ArrowRight size={17} /></button>
              </div>
            ) : (
              <div className="waiting"><span className="pulse-dot" /> WAITING FOR HOST TO START</div>
            )}
            <span className="seat-note">{10 - state.players.length} SEATS LEFT</span>
          </div>
        </section>
      )}

      {state && state.started && (
        <section className="table-wrap">
          <div className="gamebar">
            <button className="back-link" onClick={back}><DoorOpen size={16} /> LEAVE TABLE</button>
            <div className="game-room"><Hash size={14} />{state.code}</div>
            <div className="round-tag">{state.finished ? 'ROUND COMPLETE' : 'ROUND 01'}</div>
          </div>

          <div className={`table-felt ${isMyTurn && !state.finished ? 'my-turn' : ''}`}>
            <div className="felt-rings" />
            <div className="felt-logo" aria-hidden>YSN</div>
            <div className="opponents">
              {others.map((p, i) => (
                <div key={p.id} className={`opponent ${state.current === p.id ? 'opponent-turn' : ''}`} style={{ '--seat': i } as CSSProperties}>
                  <div className={`opponent-avatar avatar-${i % 5}`}>
                    {p.ai ? <Bot size={17} /> : p.name.slice(0, 1).toUpperCase()}
                    <span className={`connection ${p.connected ? '' : 'offline'}`} />
                  </div>
                  <div className="opponent-name">{p.name}{p.host && <Crown size={11} />}</div>
                  <div className="opponent-cards">{Array.from({ length: Math.min(p.count, 7) }, (_, j) => <i key={j} style={{ '--i': j } as CSSProperties} />)}</div>
                  <small>{p.count} CARDS {p.uno && p.count === 1 && <b className="uno-tag">UNO!</b>}</small>
                </div>
              ))}
            </div>

            <div className="table-center">
              <div className={`turn-pill ${isMyTurn && !state.finished ? 'turn-you' : ''}`}>
                {state.finished ? <><Crown size={14} /> ROUND OVER</>
                  : isMyTurn ? <><span className="turn-pulse" /> YOUR TURN</>
                  : <><span className="turn-pulse" /> {currentName?.toUpperCase()}'S TURN</>}
              </div>
              <div className="piles">
                <button className={`draw-pile ${!isMyTurn || state.finished ? 'disabled' : ''}`} onClick={() => doAction('draw')} disabled={!isMyTurn || state.finished}>
                  <div className="deck-stack">
                    <div className="card-back back-3" /><div className="card-back back-2" />
                    <div className="card-back"><span>✦</span><b>YSN</b></div>
                  </div>
                  <small><Layers size={13} /> DRAW PILE <b>{state.drawCount}</b></small>
                </button>
                <div className="discard-pile">
                  <div key={state.top?.id} className="discard-drop"><CardFace card={state.top} large /></div>
                  <small>DISCARD</small>
                </div>
                <div className={`color-indicator color-${state.color}`}><i />{state.color?.toUpperCase()}</div>
              </div>
              <div className="table-message">{state.message}</div>
            </div>

            <div className="you-label">
              <div className="you-avatar">{me?.name.slice(0, 1).toUpperCase()}</div>
              <span>{me?.name} <b>YOU</b></span>
              <small>{me?.score ?? 0} PTS</small>
            </div>
          </div>

          <div className="hand-section">
            <div className="hand-top">
              <div><span className="tiny-label">YOUR HAND</span><span className="hand-count">{me?.count} CARDS</span></div>
              <div className="hand-actions">
                {isMyTurn && !state.finished && me?.count === 2 && !me.uno && <button className="uno-button" onClick={() => doAction('uno')}>UNO!</button>}
                {isMyTurn && state.turnDrawn && <button className="pass-button" onClick={() => doAction('pass')}>PASS <ArrowRight size={14} /></button>}
              </div>
            </div>
            <div className="hand-cards">
              {hand.map((card, i) => {
                const active = isMyTurn && !state.finished;
                const ok = active && canPlay(card, state, hand);
                return (
                  <button
                    key={card.id}
                    aria-label={`Play ${card.kind === 'number' ? card.value : card.kind}`}
                    className={`hand-card ${active && !ok ? 'dimmed' : ''} ${!active ? 'not-your-turn' : ''}`}
                    style={{ '--index': i, '--mid': (hand.length - 1) / 2 } as CSSProperties}
                    onClick={() => { if (active) void play(card); }}
                  >
                    <CardFace card={card} playable={ok} />
                  </button>
                );
              })}
            </div>
            <div className="mobile-hint">{isMyTurn ? 'Glowing cards are playable · Draw if you need a card' : 'Waiting for the next move'}</div>
          </div>

          {state.finished && (
            <div className="winner-overlay">
              <div className="winner-card">
                <div className="confetti" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--c': i } as CSSProperties} />)}</div>
                <div className="winner-icon"><Crown size={26} /></div>
                <div className="eyebrow"><span /> ROUND COMPLETE</div>
                <h2>{state.message}</h2>
                <p className="muted">Scores updated · Ready for another?</p>
                <div className="score-list">
                  {[...state.players].sort((a, b) => b.score - a.score).map((p, i) => (
                    <div key={p.id} className={i === 0 ? 'leader' : ''}><span>{i + 1}</span><b>{p.name}</b><strong>{p.score} <small>PTS</small></strong></div>
                  ))}
                </div>
                <div className="winner-actions">
                  {me?.host && <button className="primary-button" onClick={() => doAction('restart')}>PLAY AGAIN <RotateCcw size={15} /></button>}
                  <button className="secondary-button" onClick={() => doAction('return-lobby')}>RETURN TO LOBBY</button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {pending && (
        <div className="modal-scrim" onClick={() => setPending(null)}>
          <div className="color-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={() => setPending(null)}>×</button>
            <div className="eyebrow"><span /> WILD CARD</div>
            <h2>Pick a color</h2>
            <p className="muted">Set the color everyone plays to.</p>
            <div className="color-choices">
              {COLORS.map(c => (
                <button key={c} className={`color-choice color-${c}`} aria-label={`Choose ${c}`}
                  onClick={async () => { await doAction('play', { cardId: pending.id, color: c }); setPending(null); }}>
                  <i />{c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="site-footer">
        <span>© 2026 YSN UNO <i /> A LITTLE FRIENDLY COMPETITION</span>
        <span>BUILT FOR THE NEXT ROUND <Sparkles size={12} /></span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
