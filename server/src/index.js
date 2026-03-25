const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { attachFrameSyncRoom } = require('./frameSyncRoom');
const { attachStateSyncRoom } = require('./stateSyncRoom');

const app = express();
const root = path.join(__dirname, '..', '..');

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

app.use('/frame-sync', express.static(path.join(root, 'client', 'frame-sync')));
app.use('/state-sync', express.static(path.join(root, 'client', 'state-sync')));

const server = http.createServer(app);

const wssFrame = new WebSocket.Server({ server, path: '/ws/frame-sync' });
const wssState = new WebSocket.Server({ server, path: '/ws/state-sync' });

attachFrameSyncRoom(wssFrame);
attachStateSyncRoom(wssState);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Netcode Lab http://localhost:${PORT}/`);
    console.log(`  Frame sync:  http://localhost:${PORT}/frame-sync/`);
    console.log(`  State sync:  http://localhost:${PORT}/state-sync/`);
});
