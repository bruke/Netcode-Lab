# Netcode Lab 客户端与服务端技术说明

> 阅读提示：仓库里部分界面文案和旧版说明文档存在编码乱码，主要影响可读性，不影响核心逻辑。下面重点讲结构、协议、数据流和每个文件的职责。

## 1. 这个项目在做什么

Netcode Lab 是一个用来对比两种常见网络同步思路的学习项目：

1. Frame Sync，帧同步，强调“输入同步”和“确定性模拟”
2. State Sync，状态同步，强调“服务器权威状态”和“客户端渲染”

项目的特点很明确：

- 只有一个 Node.js 服务端
- 同一个服务端同时提供静态页面和 WebSocket 连接
- 浏览器里有两个独立 demo 页面
- 两个 demo 共用一套移动规则、画布尺寸、出生点逻辑

如果你只想先抓住整体，可以先看这条链路：

```text
浏览器页面
  -> client/frame-sync 或 client/state-sync
  -> WebSocket 连接到 /ws/frame-sync 或 /ws/state-sync
  -> server/src/index.js 负责 upgrade 分流
  -> server/src/frameSyncRoom.js 或 server/src/stateSyncRoom.js 处理房间逻辑
  -> server/src/sim.js 提供移动和出生点规则
```

---

## 2. 项目目录和职责

| 路径 | 作用 | 你学习时要重点看什么 |
|---|---|---|
| [package.json](../package.json) | 入口和依赖定义 | `scripts.start`、`scripts.dev`、`engines`、`dependencies` |
| [server/src/index.js](../server/src/index.js) | HTTP 服务入口 + WebSocket 升级分流 | Express 静态资源、`upgrade` 事件、`noServer`、路由路径 |
| [server/src/constants.js](../server/src/constants.js) | 共享常量 | 画布大小、角色大小、移动速度、tick 频率、最大人数 |
| [server/src/sim.js](../server/src/sim.js) | 纯模拟逻辑 | `stepPlayer`、`spawnForIndex`、`clamp` |
| [server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js) | 帧同步房间 | 输入广播、帧循环、房间状态、连接生命周期 |
| [server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js) | 状态同步房间 | 服务器权威模拟、状态广播、连接生命周期 |
| [client/frame-sync/index.html](../client/frame-sync/index.html) | 帧同步页面骨架 | `canvas`、`meta`、`app.js`、`style.css` |
| [client/frame-sync/style.css](../client/frame-sync/style.css) | 帧同步样式 | 页面布局、深色主题、画布容器 |
| [client/frame-sync/app.js](../client/frame-sync/app.js) | 帧同步前端逻辑 | WebSocket、键盘输入、客户端镜像模拟、绘制循环 |
| [client/state-sync/index.html](../client/state-sync/index.html) | 状态同步页面骨架 | 与帧同步页面相同，但入口不同 |
| [client/state-sync/style.css](../client/state-sync/style.css) | 状态同步样式 | 与帧同步页面不同的配色 |
| [client/state-sync/app.js](../client/state-sync/app.js) | 状态同步前端逻辑 | WebSocket、键盘输入、服务器状态渲染 |
| [docs/NETWORK_SYNC.md](../docs/NETWORK_SYNC.md) | 旧版说明 | 内容目前有编码问题，建议以本文件为准 |
| [start-server.bat](../start-server.bat) | Windows 启动脚本 | 双击启动、保留窗口、便于看日志 |
| [start-server.command](../start-server.command) | macOS 启动脚本 | 双击启动、保留窗口、便于看日志 |

---

## 3. 共享配置层

### 3.1 [server/src/constants.js](../server/src/constants.js)

这个文件定义了整个项目最基础、最容易出错的共享参数：

```js
module.exports = {
    CANVAS_W: 400,
    CANVAS_H: 400,
    PLAYER_SIZE: 28,
    SPEED_PER_TICK: 5,
    TICK_MS: 50,
    MAX_PLAYERS: 16,
};
```

逐项解释：

- `CANVAS_W` 和 `CANVAS_H`
  - 画布宽高
  - 服务端和客户端都必须使用同一组值，否则出生点、边界、渲染都会错位
- `PLAYER_SIZE`
  - 方块角色的边长
  - 角色绘制、边界裁剪都依赖这个值
- `SPEED_PER_TICK`
  - 每个 tick 角色移动的像素数
  - 所有移动都基于这个速度
- `TICK_MS`
  - 服务端更新节拍，50ms 一次，也就是 20 TPS
  - 两种同步方式都用同一个 tick 频率
- `MAX_PLAYERS`
  - 房间最大人数，当前是 16
  - 服务器会在满员时直接返回错误并关闭连接

这个文件的价值在于“单一事实来源”：

- 你改速度时，服务端和客户端都应该看到相同的数值
- 你改画布时，出生点和边界逻辑也跟着一起更新

### 3.2 [server/src/sim.js](../server/src/sim.js)

这个文件只做纯数学和纯位置计算，不关心 WebSocket，也不关心 DOM。

#### `clamp(v, min, max)`

作用很简单：把数值限制在区间内。

```js
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
```

它在这里主要用于把角色限制在画布内部：

- 左边界不能小于半个角色大小
- 右边界不能大于画布宽减半个角色大小
- 上下同理

#### `stepPlayer(x, y, keys)`

这是整个项目里最核心的移动规则。

```js
function stepPlayer(x, y, keys) {
    const up = !!keys.up;
    const down = !!keys.down;
    const left = !!keys.left;
    const right = !!keys.right;
    let nx = x + ((right ? 1 : 0) - (left ? 1 : 0)) * SPEED_PER_TICK;
    let ny = y + ((down ? 1 : 0) - (up ? 1 : 0)) * SPEED_PER_TICK;
    const half = PLAYER_SIZE / 2;
    nx = clamp(nx, half, CANVAS_W - half);
    ny = clamp(ny, half, CANVAS_H - half);
    return { x: nx, y: ny };
}
```

这个函数的特点：

- 输入是当前坐标 `x, y` 和键盘状态 `keys`
- 输出是下一帧坐标
- 上下左右按键是布尔值
- 水平和垂直方向是独立计算的
- 最后统一做边界裁剪

几个细节值得注意：

- `right - left` 这种写法允许左右键同时按下时互相抵消
- `down - up` 同理处理上下方向
- 这个函数没有随机性，所以它是确定性的

#### `spawnForIndex(index)`

这个函数负责给每个新玩家分配出生点。

```js
function spawnForIndex(index) {
    const cols = 4;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const margin = 80;
    const cellW = (CANVAS_W - 2 * margin) / (cols - 1 || 1);
    const cellH = (CANVAS_H - 2 * margin) / 3;
    return {
        x: margin + col * cellW,
        y: margin + row * cellH,
    };
}
```

这里的设计思路是：

- 固定 4 列
- 横向从左到右排布
- 每 4 个玩家换一行
- 边缘留出 80 像素边距

因为 `MAX_PLAYERS` 是 16，所以刚好是 4 x 4 的网格。

这段逻辑有两个好处：

1. 连接多个客户端时，不会全部叠在一个点上
2. 调试时能一眼看出谁是新加入的玩家

---

## 4. 服务端结构

### 4.1 [package.json](../package.json)

这个文件定义了服务端的启动方式。

关键字段：

- `main: "server/src/index.js"`
  - 说明主入口在服务端入口文件
- `scripts.start`
  - 直接运行 `node server/src/index.js`
- `scripts.dev`
  - 目前和 `start` 一样
- `engines.node >= 18`
  - 项目要求较新的 Node.js

依赖也很少：

- `express`
  - 提供 HTTP 服务和静态资源托管
- `ws`
  - 提供 WebSocket 支持

### 4.2 [server/src/index.js](../server/src/index.js)

这是整个服务端的总入口。

#### 4.2.1 导入和基础对象

```js
const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { attachFrameSyncRoom } = require('./frameSyncRoom');
const { attachStateSyncRoom } = require('./stateSyncRoom');
```

可以看到它的职责非常清晰：

- `express` 负责静态页面
- `http` 负责创建原生 HTTP server
- `ws` 负责 WebSocket
- 两个 room 模块负责业务逻辑

#### 4.2.2 根路由页面

`app.get('/')` 返回一个内嵌的 HTML 页面。

这个页面的作用是：

- 给用户一个入口
- 提供两个 demo 的链接
- 提示查看文档

它不是主业务页面，只是一个导航页。

#### 4.2.3 静态资源托管

```js
app.use('/frame-sync', express.static(path.join(root, 'client', 'frame-sync')));
app.use('/state-sync', express.static(path.join(root, 'client', 'state-sync')));
```

这两行很重要：

- `/frame-sync/` 会打开帧同步 demo
- `/state-sync/` 会打开状态同步 demo

浏览器请求这些路径时，Express 会直接返回对应目录下的 `index.html`、`style.css` 和 `app.js`。

#### 4.2.4 WebSocket 的创建方式

当前代码采用的是“手动 upgrade 分流”的方式：

```js
const wssOptions = {
    noServer: true,
    perMessageDeflate: false,
};

const wssFrame = new WebSocket.Server(wssOptions);
const wssState = new WebSocket.Server(wssOptions);
```

这里有两个关键点：

- `noServer: true`
  - 说明 WebSocket 不直接绑定 HTTP server
  - 升级请求会先进入 `server.on('upgrade')`
- `perMessageDeflate: false`
  - 关闭消息压缩
  - 这个 demo 的 JSON 很小，压缩收益不大
  - 关闭后传输更简单，也更稳定

#### 4.2.5 `upgrade` 路由分流

```js
server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
        pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
        socket.destroy();
        return;
    }

    const handleUpgrade = (targetWss) => {
        targetWss.handleUpgrade(request, socket, head, (ws) => {
            targetWss.emit('connection', ws, request);
        });
    };

    if (pathname === '/ws/frame-sync') {
        handleUpgrade(wssFrame);
        return;
    }

    if (pathname === '/ws/state-sync') {
        handleUpgrade(wssState);
        return;
    }

    socket.destroy();
});
```

这段代码的含义：

- 只允许两个合法 WebSocket 路径
  - `/ws/frame-sync`
  - `/ws/state-sync`
- 其它路径直接断开
- 由 `upgrade` 事件显式决定连接归属

这样做的好处：

- 一个 HTTP server 就能服务两个 WebSocket 房间
- 路由逻辑清晰
- 避免路径混淆
- 更容易调试

#### 4.2.6 监听端口

```js
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Netcode Lab http://localhost:${PORT}/`);
    console.log(`  Frame sync:  http://localhost:${PORT}/frame-sync/`);
    console.log(`  State sync:  http://localhost:${PORT}/state-sync/`);
});
```

默认端口是 `3000`。

如果你设置了 `PORT` 环境变量，就会使用环境变量值。

### 4.3 [server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js)

这是帧同步 demo 的核心服务端逻辑。

#### 4.3.1 房间数据结构

```js
const players = new Map();
```

Map 里的每个元素大概长这样：

```js
{
  ws,          // 当前玩家的 WebSocket
  id,          // 玩家 id
  x, y,        // 当前坐标
  pending      // 最近一次收到的按键状态
}
```

这里用 `pending` 保存按键状态，而不是每次保存单个按键事件。

原因：

- 按键状态比按键事件更稳定
- 适合连续模拟
- 服务端和客户端都能直接用同一份状态做 `stepPlayer`

#### 4.3.2 广播工具

```js
function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const p of players.values()) {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
}
```

这个函数向房间内所有在线玩家发送同一条消息。

`broadcastExcept` 则会排除发起者：

```js
function broadcastExcept(ws, obj) {
    const data = JSON.stringify(obj);
    for (const p of players.values()) {
        if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
}
```

它常用于“新玩家加入时通知其他人”。

#### 4.3.3 定时 tick

```js
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
```

这里是帧同步模型最关键的部分。

流程是：

1. 每 50ms 执行一次
2. 如果房间里没人，直接跳过
3. 帧号 `frame` 加 1
4. 把所有玩家当前的 `pending` 输入收集成 `inputs`
5. 服务端自己也执行一次 `stepPlayer`
6. 向所有客户端广播这一帧的输入地图

注意这里广播的是输入，不是位置。

这就是帧同步的核心思想：

- 服务器提供“全员使用的输入序列”
- 客户端根据相同输入自己模拟位置
- 只要初始状态相同，结果就会一致

`tick.unref()` 的作用是：

- 当没有其它活动任务时，不让这个定时器强行把 Node 进程“拽住”
- 对于 demo 来说，这样更利于正常退出

#### 4.3.4 新连接接入

当一个 WebSocket 连接进来时，会依次做这些事：

1. 检查房间是否已满
2. 分配 `id`
3. 根据当前人数计算出生点
4. 初始化玩家对象
5. 发送 `welcome`
6. 通知其他玩家 `player_joined`
7. 监听消息
8. 监听关闭事件

对应代码：

```js
if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
    ws.close();
    return;
}
```

满员时服务器会直接报错并关闭连接。

```js
const id = String(nextPlayerId++);
const spawn = spawnForIndex(players.size);
```

玩家 id 是字符串形式的递增数字。

#### 4.3.5 Welcome 消息

```js
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
```

这个消息会告诉客户端：

- 自己的 `id`
- 当前房间模式
- 当前帧号
- tick 间隔
- 房间内所有玩家的初始位置

客户端据此初始化本地 `players` Map。

#### 4.3.6 玩家加入通知

```js
broadcastExcept(ws, {
    type: 'player_joined',
    player: { id, x: player.x, y: player.y },
});
```

新加入的人不需要再收到自己的加入通知，因为 `welcome` 里已经包含了自己。

其他客户端收到 `player_joined` 后，会把这个玩家插入本地渲染状态。

#### 4.3.7 接收输入

```js
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
```

这里有几个设计点：

- 非 JSON 消息直接忽略
- 不是 `input` 类型的消息直接忽略
- 玩家已经离开时也忽略
- 只保留完整的按键状态对象

这样做会让房间逻辑更稳定，也更容易推理。

#### 4.3.8 断开连接

```js
ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'player_left', id });
});
```

连接断开后：

- 从房间 Map 中删掉这个玩家
- 告诉其他客户端这个 id 已离开

### 4.4 [server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js)

状态同步房间的结构和帧同步房间非常像，但模拟权威在服务器。

#### 4.4.1 房间数据结构

```js
const players = new Map();
```

每个玩家对象的核心字段是：

```js
{
  ws,
  id,
  x,
  y,
  keys
}
```

和帧同步相比，这里没有 `pending`，而是直接保存当前按键状态 `keys`。

#### 4.4.2 状态广播

```js
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
```

状态同步和帧同步最大的区别就在这里：

- 帧同步广播的是 `frame + inputs`
- 状态同步广播的是完整 `players` 状态

#### 4.4.3 tick 逻辑

```js
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
```

这里的角色变化完全由服务器决定：

- 服务器读取 `keys`
- 服务器调用 `stepPlayer`
- 服务器更新位置
- 服务器广播所有位置

客户端只负责把收到的状态画出来。

#### 4.4.4 连接和消息处理

连接流程和帧同步基本一致：

- 满员则报错并关闭
- 分配 id
- 计算出生点
- 发送 `welcome`
- 通知其他玩家 `player_joined`
- 接收 `input`
- 断开时广播 `player_left`

不同点在于 `input` 到达后，它直接更新的是 `player.keys`：

```js
player.keys = {
    up: !!keys.up,
    down: !!keys.down,
    left: !!keys.left,
    right: !!keys.right,
};
```

这意味着服务器每个 tick 看到的都是“当前按键状态”，然后自己推进位置。

---

## 5. 客户端结构

### 5.1 两个页面的共同骨架

`client/frame-sync/index.html` 和 `client/state-sync/index.html` 的结构几乎一致：

- `meta` 负责显示连接状态
- `canvas` 负责绘制游戏画面
- `style.css` 负责页面外观
- `app.js` 负责运行逻辑

这种布局非常适合学习，因为页面结构简单，重点完全落在网络和渲染逻辑上。

### 5.2 [client/frame-sync/style.css](../client/frame-sync/style.css) 和 [client/state-sync/style.css](../client/state-sync/style.css)

两个 CSS 文件都很短，作用主要是：

- 设置页面边距和整体背景色
- 给标题、提示文字、导航链接和状态文本做基础排版
- 让 `canvas` 居中、圆角、带阴影

帧同步和状态同步页面只是在主题色上略有差异：

- 帧同步偏蓝灰
- 状态同步偏紫灰

从学习角度看，这里没有复杂布局，重点是页面结构和 canvas 交互。

### 5.3 [client/frame-sync/index.html](../client/frame-sync/index.html) 和 [client/state-sync/index.html](../client/state-sync/index.html)

HTML 本身非常薄，只负责把资源接起来：

```html
<div class="meta" id="meta"></div>
<canvas id="c" width="400" height="400"></canvas>
<script src="app.js"></script>
```

这里有两个很重要的点：

- `canvas` 的宽高和服务端常量一致，都是 400 x 400
- `script` 是最后加载的，确保 DOM 已经准备好

页面中还包含导航链接：

- 从首页进入两个 demo
- 从一个 demo 页面跳到另一个 demo 页面

---

## 6. 帧同步客户端

### 6.1 [client/frame-sync/app.js](../client/frame-sync/app.js) 的初始化

这个文件一开始自己也定义了移动规则：

```js
const CANVAS_W = 400;
const CANVAS_H = 400;
const PLAYER_SIZE = 28;
const SPEED_PER_TICK = 5;
```

然后定义了一个和服务器一致的 `stepPlayer`：

```js
function stepPlayer(x, y, keys) {
    ...
}
```

这一步是非常关键的。

原因是：

- 帧同步客户端不是接收服务器位置
- 它接收的是服务器广播的输入
- 然后自己执行相同的移动公式

所以客户端必须和服务端使用同一套移动参数。

### 6.2 WebSocket 地址拼接

```js
const wsUrl =
    (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/frame-sync';
const ws = new WebSocket(wsUrl);
```

这个写法有两个优点：

- 页面如果跑在 HTTP 下，就用 `ws:`
- 页面如果跑在 HTTPS 下，就自动切换到 `wss:`

它比写死 `ws://localhost:3000` 更通用。

### 6.3 连接状态处理

#### `onopen`

连接打开后，页面会把状态栏改成“已连接”一类的提示。

#### `onclose`

连接断开后，页面会把状态栏改成“连接已断开”。

#### `onmessage`

消息处理是这个文件的核心。

它会先做 JSON 解析：

```js
let msg;
try {
    msg = JSON.parse(ev.data);
} catch {
    return;
}
```

这意味着如果服务端或中间层发来的不是合法 JSON，客户端会直接忽略。

然后根据 `msg.type` 分支处理：

- `welcome`
- `frame`
- `player_joined`
- `player_left`
- `error`

### 6.4 `welcome` 消息

收到 `welcome` 后，客户端会：

- 保存自己的 `id`
- 清空本地玩家列表
- 重新载入所有玩家初始坐标
- 保存当前帧号
- 更新状态栏

```js
myId = msg.id;
players.clear();
for (const p of msg.players || []) {
    players.set(p.id, { x: p.x, y: p.y });
}
lastFrame = msg.frame || 0;
```

这里的 `players` 是一个 `Map`，它是渲染层唯一的玩家状态来源。

### 6.5 `frame` 消息

这是帧同步客户端最重要的一段：

```js
case 'frame': {
    lastFrame = msg.frame;
    const inputs = msg.inputs || {};
    for (const [pid, inp] of Object.entries(inputs)) {
        const cur = players.get(pid);
        if (!cur) continue;
        const next = stepPlayer(cur.x, cur.y, inp);
        cur.x = next.x;
        cur.y = next.y;
    }
    break;
}
```

这段逻辑的含义是：

- 服务器告诉客户端“这一帧每个玩家按了什么”
- 客户端在本地把这些输入重新跑一遍
- 渲染结果就和服务器一致

这就是帧同步 demo 的核心。

### 6.6 输入采集

页面用两个事件监听收集键盘状态：

- `keydown`
- `keyup`

代码里维护了一个 `keysHeld`：

```js
const keysHeld = { up: false, down: false, left: false, right: false };
```

每次按键变化后，都会更新这个对象。

然后这个对象会被定时发送给服务器：

```js
setInterval(sendInput, 1000 / 30);
```

也就是大约 30Hz。

为什么发送频率比服务器 tick 高？

- 服务器 tick 是 20Hz
- 客户端输入是“状态”，不是“单次事件”
- 更高频率发送可以减少输入状态的可见延迟

`sendInput()` 里还会先检查连接是否打开：

```js
if (ws.readyState !== WebSocket.OPEN) return;
```

这样可以避免在断开时继续发送。

### 6.7 渲染循环

`draw()` 负责每一帧的完整重绘。

它做的事情是：

1. 清空背景
2. 画网格
3. 遍历所有玩家
4. 画方块
5. 画 id 标签
6. 画当前帧号
7. `requestAnimationFrame(draw)` 继续下一帧

这是一个标准的 canvas 游戏循环写法。

你可以把它理解成：

- WebSocket 负责更新“状态”
- `requestAnimationFrame` 负责“显示状态”

这两个循环是分离的，所以即便网络消息不那么频繁，画面也会持续刷新。

### 6.8 帧同步页面的整体特点

这个页面的核心思想是：

- 服务器广播输入
- 客户端自己跑移动公式
- 所有人都看同样的结果

它的学习价值在于：

- 能直接看到“输入同步”是怎么工作的
- 能理解为什么确定性模拟很重要
- 能理解为什么客户端和服务端要共享同一套规则

---

## 7. 状态同步客户端

### 7.1 [client/state-sync/app.js](../client/state-sync/app.js) 的整体结构

这个文件和帧同步客户端很像：

- 同样有 `canvas`、`ctx`、`metaEl`
- 同样有键盘输入采集
- 同样有 `draw()` 渲染循环
- 同样用 WebSocket 连接服务端

但它和帧同步最大的区别是：

- 它不在客户端本地重复推进位置
- 它直接信任服务端发来的最终坐标

### 7.2 `welcome` 消息

收到 `welcome` 时，客户端会：

- 保存自己的 `id`
- 清空玩家列表
- 把 `msg.players` 的每个玩家坐标写入本地 `Map`
- 保存 `frame`
- 更新状态文本

这一点和帧同步一样。

### 7.3 `state` 消息

状态同步最关键的逻辑在这里：

```js
case 'state':
    lastFrame = msg.frame;
    for (const p of msg.players || []) {
        players.set(p.id, { x: p.x, y: p.y });
    }
    break;
```

它的含义很直接：

- 服务端把所有人的最新位置发给你
- 客户端用这些位置覆盖本地 `Map`
- 渲染层只负责画出来

也就是说，客户端不计算“应该走到哪里”，只渲染“已经走到哪里”。

### 7.4 输入发送

状态同步页面也会持续把 `keysHeld` 发给服务端。

这部分和帧同步一样，原因是：

- 服务端需要按键状态来推进权威位置
- 客户端只是负责收集输入，不做最终裁决

### 7.5 一个值得注意的代码点

`client/state-sync/app.js` 里也复制了 `clamp` 和 `stepPlayer`，但当前实现里这两个函数并没有参与渲染路径。

这说明什么？

- 这份文件是从帧同步版本演化出来的
- 逻辑重心已经切换到“服务器发状态”
- 这些辅助函数目前可以看作“保留的共享模板”

从学习角度，这不影响理解；从重构角度，这一段可以进一步清理。

### 7.6 状态同步页面的整体特点

这个页面的核心思想是：

- 客户端只发输入
- 服务器决定位置
- 客户端直接渲染服务器给出的权威状态

它的学习价值在于：

- 你能快速理解“服务器权威”是什么意思
- 你能看到状态广播是怎么驱动画面的
- 你能对比它和帧同步在网络负载、确定性要求上的差异

---

## 8. WebSocket 协议设计

这套 demo 的消息协议非常简单，但结构已经足够清晰。

### 8.1 `welcome`

来源：

- 服务端 -> 客户端

用途：

- 连接成功后的初始化

典型结构：

```json
{
  "type": "welcome",
  "mode": "frame-sync",
  "id": "1",
  "frame": 0,
  "tickMs": 50,
  "players": [
    { "id": "1", "x": 80, "y": 80 }
  ]
}
```

### 8.2 `input`

来源：

- 客户端 -> 服务端

用途：

- 传输当前按键状态

典型结构：

```json
{
  "type": "input",
  "keys": {
    "up": true,
    "down": false,
    "left": false,
    "right": false
  }
}
```

注意这里传的是“当前状态”，不是“按键事件序列”。

### 8.3 `frame`

来源：

- 服务端 -> 客户端

用途：

- 帧同步模式下广播每一帧的输入地图

典型结构：

```json
{
  "type": "frame",
  "frame": 12,
  "inputs": {
    "1": { "up": true, "down": false, "left": false, "right": false },
    "2": { "up": false, "down": false, "left": true, "right": false }
  }
}
```

### 8.4 `state`

来源：

- 服务端 -> 客户端

用途：

- 状态同步模式下广播所有玩家的最新坐标

典型结构：

```json
{
  "type": "state",
  "frame": 12,
  "players": [
    { "id": "1", "x": 80, "y": 75 },
    { "id": "2", "x": 306.67, "y": 80 }
  ]
}
```

### 8.5 `player_joined`

来源：

- 服务端 -> 客户端

用途：

- 通知其他客户端有新玩家加入

结构：

```json
{
  "type": "player_joined",
  "player": { "id": "3", "x": 533.33, "y": 80 }
}
```

### 8.6 `player_left`

来源：

- 服务端 -> 客户端

用途：

- 通知房间内其他人某个玩家离开了

结构：

```json
{
  "type": "player_left",
  "id": "3"
}
```

### 8.7 `error`

来源：

- 服务端 -> 客户端

用途：

- 房间满员等错误提示

结构：

```json
{
  "type": "error",
  "message": "Room full"
}
```

---

## 9. 帧同步 vs 状态同步

这张对照表是理解整个项目最重要的部分。

| 维度 | 帧同步 | 状态同步 |
|---|---|---|
| 服务端角色 | 广播输入和帧 | 权威模拟和状态广播 |
| 客户端角色 | 收输入后自己推进位置 | 只渲染服务端状态 |
| 网络消息重点 | `frame + inputs` | `state + players` |
| 一致性要求 | 高，需要确定性 | 低，客户端不负责最终结果 |
| 带宽特征 | 传输更轻 | 传输更重 |
| 调试重点 | 输入是否一致、模拟是否一致 | 状态是否及时、是否平滑 |
| 当前 demo 的优点 | 能直观看到 lockstep 思想 | 能直观看到 authoritative server 思想 |

你可以把它理解成两种不同的“谁说了算”：

- 帧同步里，大家都按同样的输入自己算，靠“规则一致”来对齐
- 状态同步里，服务器算完再告诉大家结果，靠“服务器权威”来对齐

---

## 10. 为什么代码要这样写

### 10.1 为什么服务端和客户端都要有 `stepPlayer`

在帧同步模式里，服务端和客户端都要用同一套移动逻辑。

这样做是为了让它们对同一个输入产生同一个结果。

如果只有服务端有这段逻辑，而客户端自己随便算，就会出现不同步。

### 10.2 为什么用 `Map`

`Map` 比数组更适合这里，因为：

- 通过 `id` 查找玩家更快
- 删除玩家更方便
- 遍历所有玩家也很自然

### 10.3 为什么输入按“状态”发送，不按“事件”发送

因为这两个 demo 的目标不是做精细按键回放，而是做同步模型教学。

发送状态更简单：

- 一次就能表达“当前四个方向键是否按下”
- 丢一帧也没关系，下一次会再次发送完整状态
- 服务端处理逻辑更稳定

### 10.4 为什么禁用 `perMessageDeflate`

这个项目里消息都很小，压缩收益不明显。

禁用压缩的好处是：

- 传输链路更简单
- 协议排障更容易
- 避免一些 WebSocket 扩展协商带来的复杂问题

### 10.5 为什么要手动处理 `upgrade`

因为这里有两个 WebSocket 路径，共享同一个 HTTP server。

手动处理 `upgrade` 的好处是：

- 你可以显式决定每个路径交给哪个房间
- 更容易维护两个 demo 的分界
- 出问题时更容易定位是哪个路径出了问题

### 10.6 为什么 `tick.unref()` 很有用

`setInterval` 默认会让 Node 进程保持活跃。

对于一个 demo 来说，如果没有连接了，程序最好能自然退出。

`unref()` 就是在说：

- 这个定时器不要阻止进程退出
- 如果没有其它任务，Node 可以正常结束

---

## 11. 建议的学习顺序

如果你是想“边读边学”，建议按这个顺序：

1. 先看 [package.json](../package.json)
2. 再看 [server/src/constants.js](../server/src/constants.js)
3. 再看 [server/src/sim.js](../server/src/sim.js)
4. 然后看 [server/src/index.js](../server/src/index.js)
5. 接着看 [server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js)
6. 再看 [server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js)
7. 最后看两个客户端的 `app.js`

推荐理由：

- 先看常量，能统一全局参数
- 再看模拟层，能知道“移动怎么算”
- 再看入口层，能知道“消息从哪来”
- 最后看客户端，能知道“画面怎么画”

---

## 12. 如果你要继续改进，可以从这些方向入手

1. 把帧同步和状态同步的前端公共逻辑提取成一个共享模块
2. 给状态同步加插值，让移动更平滑
3. 给帧同步加预测和回滚，体验更接近真实游戏
4. 给服务端加心跳和超时检测
5. 给房间加房主、重连、观战等能力
6. 给模拟层加单元测试，保证 `stepPlayer` 的行为稳定

---

## 13. 一句话总结

这个项目最值得学习的不是“方块在移动”，而是这条思路：

- 把规则抽成纯函数
- 把网络协议设计成简单、稳定、可对照
- 把客户端显示和服务端计算分开
- 用两个最小 demo 把两种同步模型并排展示出来

如果你愿意，下一步我还可以继续帮你做一版“逐文件逐函数讲解稿”，把每个函数再拆成更细的注释版学习笔记。
