const WebSocket = require('ws');
const { TICK_MS, MAX_PLAYERS } = require('./constants');
const { stepPlayer, spawnForIndex } = require('./sim');

/**
 * 状态同步房间。
 * 与帧同步不同，这里是服务器自己推进位置，并把最终状态周期性广播给所有客户端。
 */
function attachStateSyncRoom(wss) {
    // 逻辑帧编号，用来告诉客户端当前已经运行到第几拍。
    let frame = 0;
    // 顺序增长的玩家 id，方便在 UI 中识别玩家。
    let nextPlayerId = 1;
    /**
     * 房间玩家表。
     * 这里保存的是服务器权威的坐标，以及最新的按键状态。
     */
    const players = new Map();

    // 将当前服务器状态打包成一次完整广播，客户端收到后直接覆盖本地显示。
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

    // join 时用来通知其他客户端有新人进入房间。
    function broadcastExcept(ws, obj) {
        const data = JSON.stringify(obj);
        for (const p of players.values()) {
            if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
        }
    }

    // 服务器的固定节拍循环：直接按服务器保存的按键状态更新每个玩家的位置。
    const tick = setInterval(() => {
        // 房间空闲时不运行模拟。
        if (players.size === 0) return;
        frame += 1;
        for (const p of players.values()) {
            const next = stepPlayer(p.x, p.y, p.keys);
            p.x = next.x;
            p.y = next.y;
        }
        // 这里广播的是最终坐标，所以客户端不需要做本地推演。
        broadcastState();
    }, TICK_MS);

    // 如果进程里只剩这个 timer，它也不要阻止 Node 退出。
    if (tick.unref) tick.unref();

    wss.on('connection', (ws) => {
        // 房间人数已满时，直接拒绝新的连接。
        if (players.size >= MAX_PLAYERS) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
            ws.close();
            return;
        }

        // 给新玩家分配 id，并根据当前人数决定出生点。
        const id = String(nextPlayerId++);
        const spawn = spawnForIndex(players.size);
        const player = {
            ws,
            id,
            x: spawn.x,
            y: spawn.y,
            // keys 保存“当前按键状态”，服务器每个 tick 都会读取它。
            keys: { up: false, down: false, left: false, right: false },
        };
        players.set(id, player);

        // welcome 发送的是当前房间快照，客户端拿到后就能立即画出所有现有玩家。
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

        // 通知其他玩家：有新人加入。
        broadcastExcept(ws, {
            type: 'player_joined',
            player: { id, x: player.x, y: player.y },
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                // 非法 JSON 直接忽略，不影响房间继续运行。
                return;
            }
            // 状态同步房间也只接受 input 消息；其它类型全部忽略。
            if (msg.type !== 'input' || !players.has(id)) return;
            // 按键状态会被归一化成布尔值，避免异常输入污染模拟。
            const keys = msg.keys || {};
            player.keys = {
                up: !!keys.up,
                down: !!keys.down,
                left: !!keys.left,
                right: !!keys.right,
            };
        });

        ws.on('close', () => {
            // 先移除房间内状态，再广播离线通知。
            players.delete(id);
            const data = JSON.stringify({ type: 'player_left', id });
            for (const p of players.values()) {
                if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
            }
        });
    });
}

module.exports = { attachStateSyncRoom };
