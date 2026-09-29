# UNO Rooms

Real-time multiplayer UNO for up to 10 players per room. One server file, one HTML file, one dependency (`ws`).

## Run locally
```
npm install
npm start        # http://localhost:3000
```
Open it in several tabs/devices, create a room, share the 6-character code.

## Deploy
Any host that runs a persistent Node process with WebSocket support works (Render, Railway, Fly, a VPS).
- Build: `npm install` — Start: `npm start`
- Uses `PORT` from the environment. Health check: `/health`.
- Optional: `ALLOWED_ORIGIN=https://your-domain.com` restricts WebSocket connections to that origin.
- Vercel serverless functions cannot hold WebSocket connections or in-memory rooms; deploy this on Render/Railway instead (or put only a static front end on Vercel and point it at the server).
- Run a single instance: rooms live in server memory and are lost on restart.

## Rules implemented
Match color, number or symbol. Skip, Reverse (acts as Skip with 2 players), +2 and Wild +4 (next player draws and is skipped, no stacking), Wild color choice. Draw one card; if playable you may play it or keep it and pass. Call UNO at 2 cards or 1 card; if you reach 1 card without calling, any player can hit Catch (+2 cards) before the next move. First empty hand wins.

## Security notes
- Server is authoritative: clients only send intents (`play`, `draw`, ...). Deck, shuffle (crypto RNG) and other hands never leave the server.
- Every move is validated (turn, ownership of card, legality, color choice).
- Input sanitized and length-limited, 1 KB message cap, per-socket rate limit, heartbeat, room cap, CSP headers, random room codes and reconnect tokens.
- Turn timer (45 s) auto-plays; disconnected players are skipped after 4 s and removed after 2 minutes (30 s in lobby). Reconnect resumes automatically via a saved token.
- Host leaving transfers host to another player.
