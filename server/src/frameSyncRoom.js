const WebSocket = require('ws');
const { TICK_MS, MAX_PLAYERS } = require('./constants');
const { stepPlayer, spawnForIndex } = require('./sim');

/**
 * 帧同步房间。
 * 核心思路是：服务器不替客户端算最终结果，而是按固定节拍广播“这一帧每个人按了什么”，
 * 客户端再用同一套运动规则自己推演位置。
 */
function attachFrameSyncRoom(wss) {
    // 逻辑帧编号，所有客户端都围绕这一个节拍同步。
    let frame = 0;
    // 用于生成递增的玩家 id，便于日志和 UI 显示。
    let nextPlayerId = 1;
    /**
     * 房间内玩家表。
     * 每个条目保存 WebSocket、玩家 id、当前坐标，以及最新收到但尚未广播的按键状态。
     */
    const players = new Map();

    // 向房间里的所有有效连接广播同一条消息。
    function broadcast(obj) {
        const data = JSON.stringify(obj);
        for (const p of players.values()) {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
        }
    }

    // 广播给除自己以外的其他玩家，常用于 join 通知，避免把通知重复回放给新玩家自己。
    function broadcastExcept(ws, obj) {
        const data = JSON.stringify(obj);
        for (const p of players.values()) {
            if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
        }
    }

    // 把房间当前状态转成可以直接放进 welcome 包的简化快照。
    function snapshot() {
        return Array.from(players.values()).map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
        }));
    }

    // 固定 tick 循环：每到一个节拍，就把当前帧的输入打包并广播出去。
    const tick = setInterval(() => {
        // 没人在线时不做任何模拟，省掉无意义的计算。
        if (players.size === 0) return;

        frame += 1;
        // 先把这一帧会用到的输入拷贝出来，确保广播内容和本次模拟使用的是同一份数据。
        const inputs = {};
        for (const p of players.values()) {
            inputs[p.id] = { ...p.pending };
        }

        // 用共享的确定性运动规则推进每个玩家的位置。
        for (const p of players.values()) {
            const next = stepPlayer(p.x, p.y, p.pending);
            p.x = next.x;
            p.y = next.y;
        }

        // frame 包里只带输入，不带最终位置；客户端会用相同规则自行重放。
        broadcast({ type: 'frame', frame, inputs });
    }, TICK_MS);

    // 这个 timer 不应该阻止 Node 进程退出。
    if (tick.unref) tick.unref();

    wss.on('connection', (ws) => {
        // 超过房间上限就提前拒绝，避免 spawn 布局和状态管理失控。
        if (players.size >= MAX_PLAYERS) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
            ws.close();
            return;
        }

        // 玩家 id 采用字符串，和消息字段、Map key 都更统一。
        const id = String(nextPlayerId++);
        // 根据当前房间人数决定出生点，保证多人加入时不会重叠。
        const spawn = spawnForIndex(players.size);
        const player = {
            ws,
            id,
            x: spawn.x,
            y: spawn.y,
            // pending 表示“当前最新输入”，tick 会直接读取它。
            pending: { up: false, down: false, left: false, right: false },
        };
        players.set(id, player);

        // welcome 是连接建立后的第一份完整快照：谁是你、当前帧是多少、房间里还有谁。
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

        // 只通知其他玩家，不回放给自己，避免 join 消息重复干扰 UI。
        broadcastExcept(ws, {
            type: 'player_joined',
            player: { id, x: player.x, y: player.y },
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                // 非 JSON 消息直接忽略，避免脏数据打断房间逻辑。
                return;
            }
            // 帧同步房间只接受 input 消息；其他类型一律不处理。
            if (msg.type !== 'input' || !players.has(id)) return;
            // 重新规范化按键状态，防止客户端传入奇怪值。
            const keys = msg.keys || {};
            player.pending = {
                up: !!keys.up,
                down: !!keys.down,
                left: !!keys.left,
                right: !!keys.right,
            };
        });

        ws.on('close', () => {
            // 连接关闭后立刻清理房间状态，并通知其他客户端移除该玩家。
            players.delete(id);
            broadcast({ type: 'player_left', id });
        });
    });
}

module.exports = { attachFrameSyncRoom };
