(function () {
    // 状态同步客户端只负责展示服务器权威状态，因此本地不需要复制运动公式。
    const CANVAS_W = 400;
    const CANVAS_H = 400;
    const PLAYER_SIZE = 28;

    // 同样使用固定调色板，让同一个 id 在两个 demo 中保持相近的视觉识别体验。
    const palette = ['#5eead4', '#fcd34d', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f87171'];

    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const metaEl = document.getElementById('meta');

    // 自己的 id 由 welcome 包发来，用来高亮当前玩家。
    let myId = null;
    // 存储服务器最新广播的玩家位置，state 包到达时会直接覆盖这里。
    const players = new Map();
    // 最近一次收到的服务器帧号。
    let lastFrame = 0;
    // 本地按键状态仍然需要发送给服务器，服务器会据此推进权威状态。
    const keysHeld = { up: false, down: false, left: false, right: false };

    // 按当前页面协议自动选择 ws / wss。
    const wsUrl =
        (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/state-sync';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        // 连接成功后在页面上立即反馈，便于确认服务端在线。
        metaEl.textContent = '已连接（状态同步）— 等待 welcome…';
    };

    ws.onmessage = (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            // 忽略坏包，不让渲染和 UI 状态被影响。
            return;
        }
        switch (msg.type) {
            case 'welcome':
                // 连接建立后的第一份完整快照：把本地缓存初始化成服务器当前状态。
                myId = msg.id;
                players.clear();
                for (const p of msg.players || []) {
                    players.set(p.id, { x: p.x, y: p.y });
                }
                lastFrame = msg.frame || 0;
                metaEl.textContent = `本机 id=${myId} | 服务器帧=${lastFrame} | 节拍 ${msg.tickMs}ms`;
                break;
            case 'state':
                // 服务器权威状态包：直接覆盖本地缓存中的每个玩家坐标。
                lastFrame = msg.frame;
                for (const p of msg.players || []) {
                    players.set(p.id, { x: p.x, y: p.y });
                }
                break;
            case 'player_joined': {
                // 新玩家加入后先补入本地缓存，这样下一次 state 到来前也能看到他。
                const pl = msg.player;
                if (pl && pl.id) players.set(pl.id, { x: pl.x, y: pl.y });
                break;
            }
            case 'player_left':
                // 玩家离开时从缓存删除，避免渲染残留。
                if (msg.id) players.delete(msg.id);
                break;
            case 'error':
                // 房间已满或其他错误会在这里显示。
                metaEl.textContent = '错误: ' + (msg.message || '');
                break;
            default:
                break;
        }
    };

    ws.onclose = () => {
        // 断线状态明确展示，方便你测试连接和服务端重启。
        metaEl.textContent = '连接已断开';
    };

    // 仍然定期发送输入，服务器依靠这个输入来计算权威状态。
    function sendInput() {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
            JSON.stringify({
                type: 'input',
                keys: { ...keysHeld },
            })
        );
    }

    // 键盘事件和帧同步 demo 一样：只记录当前按键，不直接挪动方块。
    window.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'w', 'W'].includes(e.key)) keysHeld.up = true;
        if (['ArrowDown', 's', 'S'].includes(e.key)) keysHeld.down = true;
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysHeld.left = true;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) keysHeld.right = true;
        e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'w', 'W'].includes(e.key)) keysHeld.up = false;
        if (['ArrowDown', 's', 'S'].includes(e.key)) keysHeld.down = false;
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysHeld.left = false;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) keysHeld.right = false;
        e.preventDefault();
    });

    // 输入采样频率与渲染频率分开，方便网络测试时观察“发包”和“画面”是否一致。
    setInterval(sendInput, 1000 / 30);

    // 同一个 id 始终映射到同一颜色，方便多客户端对照同一个玩家。
    function colorForId(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }

    // 渲染循环只消费服务器下发的状态，不做本地预测。
    function draw() {
        // 每帧完整清屏再重绘，避免旧位置残影。
        ctx.fillStyle = '#221a2e';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.strokeStyle = '#3d3250';
        ctx.lineWidth = 1;
        // 背景网格帮助观察服务器广播的位移步长。
        for (let g = 0; g < CANVAS_W; g += 40) {
            ctx.beginPath();
            ctx.moveTo(g, 0);
            ctx.lineTo(g, CANVAS_H);
            ctx.stroke();
        }
        for (let g = 0; g < CANVAS_H; g += 40) {
            ctx.beginPath();
            ctx.moveTo(0, g);
            ctx.lineTo(CANVAS_W, g);
            ctx.stroke();
        }

        // 服务器权威坐标会直接落在这里，渲染只负责把缓存画出来。
        players.forEach((pos, id) => {
            const cx = pos.x;
            const cy = pos.y;
            const half = PLAYER_SIZE / 2;
            ctx.fillStyle = colorForId(id);
            ctx.fillRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            // 自己的玩家仍然高亮显示，方便你确认输入是否生效。
            ctx.strokeStyle = id === myId ? '#fff' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = id === myId ? 3 : 1;
            ctx.strokeRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            ctx.fillStyle = '#ece8f0';
            ctx.font = '12px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(id, cx, cy + 4);
        });

        // 右下角/左下角文案用于标识当前是状态同步模式和最新帧号。
        ctx.fillStyle = '#8a7d99';
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('frame #' + lastFrame + '  ·  状态同步：服务器权威坐标', 12, CANVAS_H - 12);

        // 持续重绘，让画面跟随浏览器刷新率更新。
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();
