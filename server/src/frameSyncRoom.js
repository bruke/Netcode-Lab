const WebSocket = require('ws');
const { TICK_MS, MAX_PLAYERS } = require('./constants');
const { stepPlayer, spawnForIndex } = require('./sim');

/**
 * Frame sync: fixed tick, broadcast per-frame input map so clients run identical deterministic sim.
 */
function attachFrameSyncRoom(wss) {
    let frame = 0;
    let nextPlayerId = 1;
    /** @type {Map<string, { ws: import('ws'), id: string, x: number, y: number, pending: object }>} */
    const players = new Map();

    function broadcast(obj) {
        const data = JSON.stringify(obj);
        for (const p of players.values()) {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
        }
    }

    function broadcastExcept(ws, obj) {
        const data = JSON.stringify(obj);
        for (const p of players.values()) {
            if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
        }
    }

    function snapshot() {
        return Array.from(players.values()).map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
        }));
    }

    const tick = setInterval(() => {
        if (players.size === 0) return;

        frame += 1;
        const inputs = {};
        for (const p of players.values()) {
            inputs[p.id] = { ...p.pending };
        }

        for (const p of players.values()) {
            const next = stepPlayer(p.x, p.y, p.pending);
            p.x = next.x;
            p.y = next.y;
        }

        broadcast({ type: 'frame', frame, inputs });
    }, TICK_MS);

    if (tick.unref) tick.unref();

    wss.on('connection', (ws) => {
        if (players.size >= MAX_PLAYERS) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
            ws.close();
            return;
        }

        const id = String(nextPlayerId++);
        const spawn = spawnForIndex(players.size);
        const player = {
            ws,
            id,
            x: spawn.x,
            y: spawn.y,
            pending: { up: false, down: false, left: false, right: false },
        };
        players.set(id, player);

        ws.send(
            JSON.stringify({
                type: 'welcome',
                mode: 'frame-sync',
                id,
                frame,
                tickMs: TICK_MS,
                players: snapshot(),
            })
        );

        broadcastExcept(ws, {
            type: 'player_joined',
            player: { id, x: player.x, y: player.y },
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }
            if (msg.type !== 'input' || !players.has(id)) return;
            const keys = msg.keys || {};
            player.pending = {
                up: !!keys.up,
                down: !!keys.down,
                left: !!keys.left,
                right: !!keys.right,
            };
        });

        ws.on('close', () => {
            players.delete(id);
            broadcast({ type: 'player_left', id });
        });
    });
}

module.exports = { attachFrameSyncRoom };
