# Gridbound: Point Wars — starter prototype

A browser-based four-player real-time grid game using Node.js, Express and Socket.IO.

## Requirements
- Node.js 18 or newer
- npm

## Run locally
1. Extract the project ZIP.
2. Open a terminal in the `gridbound-point-wars` folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open http://localhost:3000 in your browser.
6. Create a room in one browser, then join that room from three other browser sessions/devices.

For local testing, use separate browser profiles or incognito windows. All four players must join before the match starts.

## Included in this prototype
- 10×10 board and four corner starts
- 100 starting points per player
- Random obstacle generation with reachability checks
- Walk (1 point/cell) and sprint (2 points/cell)
- Same-cell point transfer with recipient approval
- Adjacent-cell point challenge
- Defender can spend matching points to defend or accept knockback and receive the attacker's offer
- Five-second attack response timer
- Stationary recovery at zero points
- 15-minute match timer and final ranking

## Important prototype limitations
- This is an early playable prototype, not a production-ready online game.
- The combat implementation is intentionally simple. The server validates actions, but more extensive testing and refinements are needed.
- The first player to create a room occupies the top-left starting slot; the other slots are assigned in join order.
- Reconnection recovery, persistent accounts, matchmaking, sound, polished animations, and production anti-cheat are not implemented.
- Sprint movement is rate-limited on the server. Holding a movement key sends repeated movement requests from the client.
- The game currently requires four players to start.

## Next improvements
1. Add automated tests for movement, combat and point accounting.
2. Add reconnect support and room cleanup.
3. Improve simultaneous-action handling.
4. Add a proper game-over scoreboard and rematch flow.
5. Deploy the server to a host that supports persistent WebSocket connections.
