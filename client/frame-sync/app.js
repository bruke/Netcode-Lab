(function () {
    // 帧同步客户端需要和服务端使用完全一致的尺寸和移动规则。
    const CANVAS_W = 400;
    const CANVAS_H = 400;
    const PLAYER_SIZE = 28;
    const SPEED_PER_TICK = 5;

    // 夹紧函数：用于保证本地推演和服务器边界判断一致。
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // 帧同步模式下，客户端必须和服务器用同一套运动公式。
    function stepPlayer(x, y, keys) {
        // 输入态先归一化，确保后续运算不会被奇怪值影响。
        const up = !!keys.up;
        const down = !!keys.down;
        const left = !!keys.left;
        const right = !!keys.right;
        // 这里的位移公式与 server/src/sim.js 保持一致。
        let nx = x + ((right ? 1 : 0) - (left ? 1 : 0)) * SPEED_PER_TICK;
        let ny = y + ((down ? 1 : 0) - (up ? 1 : 0)) * SPEED_PER_TICK;
        // 玩家是方块，因此要给半个边长的安全边界。
        const half = PLAYER_SIZE / 2;
        nx = clamp(nx, half, CANVAS_W - half);
        ny = clamp(ny, half, CANVAS_H - half);
        return { x: nx, y: ny };
    }

    // 用固定调色板 + id 哈希，让同一个玩家始终显示成同一种颜色。
    const palette = ['#5eead4', '#fcd34d', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f87171'];

    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const metaEl = document.getElementById('meta');

    // welcome 消息返回后，当前客户端的 id 会写在这里，用来高亮自己。
    let myId = null;
    // 本地缓存的玩家位置；frame 消息会在这里做确定性重放。
    const players = new Map();
    // 最新收到的逻辑帧编号，仅用于显示和调试。
    let lastFrame = 0;
    // 键盘的当前状态，发送给服务器前会直接展开成对象。
    const keysHeld = { up: false, down: false, left: false, right: false };

    // 根据当前页面协议自动选择 ws / wss，避免 http 和 https 环境切换时写死地址。
    const wsUrl =
        (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/frame-sync';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        // 连接建立后先给页面一个明确反馈，方便你确认服务是否可达。
        metaEl.textContent = '已连接（帧同步）— 等待 welcome…';
    };

    ws.onmessage = (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            // 非 JSON 数据直接忽略，避免渲染循环被坏包打断。
            return;
        }
        switch (msg.type) {
            case 'welcome':
                // 初始化本地缓存：先把服务器给出的完整房间状态铺平。
                myId = msg.id;
                players.clear();
                for (const p of msg.players || []) {
                    players.set(p.id, { x: p.x, y: p.y });
                }
                lastFrame = msg.frame || 0;
                metaEl.textContent = `本机 id=${myId} | 逻辑帧=${lastFrame} | 节拍 ${msg.tickMs}ms`;
                break;
            case 'frame': {
                // 帧同步的关键：服务器只广播“这一帧每个人按了什么键”，本地按同一套规则重放。
                lastFrame = msg.frame;
                const inputs = msg.inputs || {};
                for (const [pid, inp] of Object.entries(inputs)) {
                    const cur = players.get(pid);
                    if (!cur) continue;
                    const next = stepPlayer(cur.x, cur.y, inp);
                    // 直接原地更新缓存，这样渲染循环读取到的就是最新位置。
                    cur.x = next.x;
                    cur.y = next.y;
                }
                break;
            }
            case 'player_joined': {
                // 新玩家加入时，把他先放进缓存，后续 frame 消息就能继续驱动他移动。
                const pl = msg.player;
                if (pl && pl.id) players.set(pl.id, { x: pl.x, y: pl.y });
                break;
            }
            case 'player_left':
                // 玩家离线时从本地缓存删除，渲染循环就不会再画他。
                if (msg.id) players.delete(msg.id);
                break;
            case 'error':
                // 服务器拒绝连接或房间满时，会通过这里把错误显示出来。
                metaEl.textContent = '错误: ' + (msg.message || '');
                break;
            default:
                break;
        }
    };

    ws.onclose = () => {
        // 连接关闭后给出清晰状态，便于调试断线问题。
        metaEl.textContent = '连接已断开';
    };

    // 把当前按键状态发给服务器。帧同步里，服务器需要收集所有人的输入再广播出去。
    function sendInput() {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
            JSON.stringify({
                type: 'input',
                keys: { ...keysHeld },
            })
        );
    }

    // 键盘按下时只更新状态，不直接改位置；真正的移动会在 frame / 渲染中发生。
    window.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'w', 'W'].includes(e.key)) keysHeld.up = true;
        if (['ArrowDown', 's', 'S'].includes(e.key)) keysHeld.down = true;
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysHeld.left = true;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) keysHeld.right = true;
        // 避免方向键触发页面滚动。
        e.preventDefault();
    });
    // 松开按键时同步清理状态，保证发送给服务器的是最新输入。
    window.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'w', 'W'].includes(e.key)) keysHeld.up = false;
        if (['ArrowDown', 's', 'S'].includes(e.key)) keysHeld.down = false;
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysHeld.left = false;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) keysHeld.right = false;
        e.preventDefault();
    });

    // 固定频率采样输入。发送频率与渲染频率分离，便于观察网络和视觉两条时间线。
    setInterval(sendInput, 1000 / 30);

    // 根据 id 生成稳定颜色，方便多玩家场景下区分方块。
    function colorForId(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }

    // 渲染循环只负责画当前缓存状态，不做任何网络处理。
    function draw() {
        // 先清屏，再画背景网格，这样每一帧都是完整重绘。
        ctx.fillStyle = '#1a2332';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.strokeStyle = '#2d3a4d';
        ctx.lineWidth = 1;
        // 画纵向网格线，帮助观察移动速度和边界。
        for (let g = 0; g < CANVAS_W; g += 40) {
            ctx.beginPath();
            ctx.moveTo(g, 0);
            ctx.lineTo(g, CANVAS_H);
            ctx.stroke();
        }
        // 画横向网格线。
        for (let g = 0; g < CANVAS_H; g += 40) {
            ctx.beginPath();
            ctx.moveTo(0, g);
            ctx.lineTo(CANVAS_W, g);
            ctx.stroke();
        }

        // 遍历本地缓存的玩家位置并绘制方块。
        players.forEach((pos, id) => {
            const cx = pos.x;
            const cy = pos.y;
            const half = PLAYER_SIZE / 2;
            ctx.fillStyle = colorForId(id);
            ctx.fillRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            // 当前玩家用更亮的边框强调出来，便于识别自己。
            ctx.strokeStyle = id === myId ? '#fff' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = id === myId ? 3 : 1;
            ctx.strokeRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            ctx.fillStyle = '#e7ecf3';
            ctx.font = '12px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(id, cx, cy + 4);
        });

        // 角落里的文字主要用于调试：看帧号、看当前模式。
        ctx.fillStyle = '#7a8a99';
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('frame #' + lastFrame + '  ·  帧同步：输入广播 + 本地确定性步进', 12, CANVAS_H - 12);

        // 下一帧继续重绘，让画面跟随浏览器刷新率更新。
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();
