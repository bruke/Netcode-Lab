const WebSocket = require('ws');
const { TICK_MS, MAX_PLAYERS } = require('./constants');
const { stepPlayer, spawnForIndex } = require('./sim');

/**
 * State sync: server owns positions; clients send input and render authoritative state.
 */
function attachStateSyncRoom(wss) {
    let frame = 0;
    let nextPlayerId = 1;
    /** @type {Map<string, { ws: import('ws'), id: string, x: number, y: number, keys: object }>} */
    const players = new Map();

    function broadcastState() {
        const list = Array.from(players.values()).map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
        }));
        const data = JSON.stringify({ type: 'state', frame, players: list });
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

    const tick = setInterval(() => {
        if (players.size === 0) return;
        frame += 1;
        for (const p of players.values()) {
            const next = stepPlayer(p.x, p.y, p.keys);
            p.x = next.x;
            p.y = next.y;
        }
        broadcastState();
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
            keys: { up: false, down: false, left: false, right: false },
        };
        players.set(id, player);

        ws.send(
            JSON.stringify({
                type: 'welcome',
                mode: 'state-sync',
                id,
                frame,
                tickMs: TICK_MS,
                players: Array.from(players.values()).map((p) => ({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                })),
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
            player.keys = {
                up: !!keys.up,
                down: !!keys.down,
                left: !!keys.left,
                right: !!keys.right,
            };
        });

        ws.on('close', () => {
            players.delete(id);
            const data = JSON.stringify({ type: 'player_left', id });
            for (const p of players.values()) {
                if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
            }
        });
    });
}

module.exports = { attachStateSyncRoom };
