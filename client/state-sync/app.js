(function () {
    const CANVAS_W = 800;
    const CANVAS_H = 600;
    const PLAYER_SIZE = 28;

    const palette = ['#5eead4', '#fcd34d', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f87171'];

    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const metaEl = document.getElementById('meta');

    /** @type {string|null} */
    let myId = null;
    /** @type {Map<string, { x: number, y: number }>} */
    const players = new Map();
    let lastFrame = 0;
    const keysHeld = { up: false, down: false, left: false, right: false };

    const wsUrl =
        (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/state-sync';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        metaEl.textContent = '已连接（状态同步）— 等待 welcome…';
    };

    ws.onmessage = (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return;
        }
        switch (msg.type) {
            case 'welcome':
                myId = msg.id;
                players.clear();
                for (const p of msg.players || []) {
                    players.set(p.id, { x: p.x, y: p.y });
                }
                lastFrame = msg.frame || 0;
                metaEl.textContent = `本机 id=${myId} | 服务器帧=${lastFrame} | 节拍 ${msg.tickMs}ms`;
                break;
            case 'state':
                lastFrame = msg.frame;
                for (const p of msg.players || []) {
                    players.set(p.id, { x: p.x, y: p.y });
                }
                break;
            case 'player_joined': {
                const pl = msg.player;
                if (pl && pl.id) players.set(pl.id, { x: pl.x, y: pl.y });
                break;
            }
            case 'player_left':
                if (msg.id) players.delete(msg.id);
                break;
            case 'error':
                metaEl.textContent = '错误: ' + (msg.message || '');
                break;
            default:
                break;
        }
    };

    ws.onclose = () => {
        metaEl.textContent = '连接已断开';
    };

    function sendInput() {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
            JSON.stringify({
                type: 'input',
                keys: { ...keysHeld },
            })
        );
    }

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

    setInterval(sendInput, 1000 / 30);

    function colorForId(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }

    function draw() {
        ctx.fillStyle = '#221a2e';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.strokeStyle = '#3d3250';
        ctx.lineWidth = 1;
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

        players.forEach((pos, id) => {
            const cx = pos.x;
            const cy = pos.y;
            const half = PLAYER_SIZE / 2;
            ctx.fillStyle = colorForId(id);
            ctx.fillRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            ctx.strokeStyle = id === myId ? '#fff' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = id === myId ? 3 : 1;
            ctx.strokeRect(cx - half, cy - half, PLAYER_SIZE, PLAYER_SIZE);
            ctx.fillStyle = '#ece8f0';
            ctx.font = '12px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(id, cx, cy + 4);
        });

        ctx.fillStyle = '#8a7d99';
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('frame #' + lastFrame + '  ·  状态同步：服务器权威坐标', 12, CANVAS_H - 12);

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();
