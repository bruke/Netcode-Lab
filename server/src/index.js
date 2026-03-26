const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { attachFrameSyncRoom } = require('./frameSyncRoom');
const { attachStateSyncRoom } = require('./stateSyncRoom');

const app = express();
// 仓库根目录，静态文件托管时要从这里拼出 client 路径。
const root = path.join(__dirname, '..', '..');

// 首页只做入口导航，不承载复杂逻辑。
app.get('/', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Netcode Lab</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 48px auto; padding: 0 16px; line-height: 1.5; }
    a { color: #0b57d0; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Netcode Lab</h1>
  <p>选择演示：</p>
  <ul>
    <li><a href="/frame-sync/">帧同步（Frame Sync）</a> — 固定步长广播各玩家输入，客户端确定性推演</li>
    <li><a href="/state-sync/">状态同步（State Sync）</a> — 服务器权威位置，客户端只发输入并渲染状态</li>
  </ul>
  <p>技术说明见仓库 <code>docs/NETWORK_SYNC.md</code>。</p>
</body>
</html>`);
});

// 两个 demo 各自放在独立路径下，互不干扰。
app.use('/frame-sync', express.static(path.join(root, 'client', 'frame-sync')));
app.use('/state-sync', express.static(path.join(root, 'client', 'state-sync')));

// 用原生 HTTP server 承载 Express，方便我们手动接管 WebSocket upgrade。
const server = http.createServer(app);

// 这里不使用 per-message compression：
// 1) demo 消息很小
// 2) 压缩会增加复杂度和额外开销
// 3) 保持链路简单更利于学习和调试
const wssOptions = {
    noServer: true,
    perMessageDeflate: false,
};

// 两个独立的 WebSocket 服务器，共享同一个 HTTP server，但对应不同 demo 的房间逻辑。
const wssFrame = new WebSocket.Server(wssOptions);
const wssState = new WebSocket.Server(wssOptions);

// 各自挂载 room 逻辑：连接生命周期、tick 循环、广播规则都在 room 内部处理。
attachFrameSyncRoom(wssFrame);
attachStateSyncRoom(wssState);

// 手动分流 WebSocket 升级请求，根据路径把 socket 交给正确的房间。
server.on('upgrade', (request, socket, head) => {
    // 请求里带着完整 URL，这里只关心 pathname。
    let pathname;
    try {
        pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
        // 非法 URL 直接断开，避免把脏连接交给后面的逻辑。
        socket.destroy();
        return;
    }

    // ws 库只负责把原始 socket 接成 WebSocket，这个 helper 把重复代码收起来。
    const handleUpgrade = (targetWss) => {
        targetWss.handleUpgrade(request, socket, head, (ws) => {
            targetWss.emit('connection', ws, request);
        });
    };

    // 帧同步 demo 使用独立的 websocket 路径。
    if (pathname === '/ws/frame-sync') {
        handleUpgrade(wssFrame);
        return;
    }

    // 状态同步 demo 也有自己的 websocket 路径。
    if (pathname === '/ws/state-sync') {
        handleUpgrade(wssState);
        return;
    }

    // 其他路径不是本项目定义的 websocket 入口。
    socket.destroy();
});

const PORT = process.env.PORT || 3000;
// 启动后打印可直接打开的入口，方便双击脚本和手动调试。
server.listen(PORT, () => {
    console.log(`Netcode Lab http://localhost:${PORT}/`);
    console.log(`  Frame sync:  http://localhost:${PORT}/frame-sync/`);
    console.log(`  State sync:  http://localhost:${PORT}/state-sync/`);
});
