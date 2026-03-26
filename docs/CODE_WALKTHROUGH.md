# Netcode Lab 代码走读

这份文档不是“概览”，而是按源码顺序把客户端和服务器拆开讲清楚。  
目标是让你拿着这份文档，能一边看代码一边理解每一层为什么这么写。

如果你想先建立全局印象，建议阅读顺序是：

1. `[package.json](../package.json)`
2. `[server/src/constants.js](../server/src/constants.js)`
3. `[server/src/sim.js](../server/src/sim.js)`
4. `[server/src/index.js](../server/src/index.js)`
5. `[server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js)`
6. `[server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js)`
7. `[client/frame-sync/app.js](../client/frame-sync/app.js)`
8. `[client/state-sync/app.js](../client/state-sync/app.js)`

---

## 1. 项目在做什么

Netcode Lab 只有一个核心目标：用最少的代码，把“同步网络游戏”里最重要的两条思路讲明白。

- Frame Sync
  - 服务器不直接替你算最终位置，而是广播“每一帧大家按了什么键”
  - 客户端拿到输入后，本地按同一套规则推进模拟
  - 重点是“输入同步”和“确定性”
- State Sync
  - 服务器自己算位置，再把“当前状态”广播给客户端
  - 客户端主要负责显示，不负责决定最终结果
  - 重点是“服务器权威”和“状态广播”

从代码结构看，它们共享同一套：

- 地图尺寸
- 玩家大小
- 移动速度
- 生成点逻辑

但它们在“谁算位置”这件事上完全不同。

---

## 2. 目录和职责

### 2.1 服务器

- `[server/src/index.js](../server/src/index.js)`
  - Express 静态托管
  - WebSocket 升级分流
  - 把不同 demo 路由到不同 room
- `[server/src/constants.js](../server/src/constants.js)`
  - 统一定义常量
- `[server/src/sim.js](../server/src/sim.js)`
  - 运动学和出生点
- `[server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js)`
  - Frame Sync 房间逻辑
- `[server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js)`
  - State Sync 房间逻辑

### 2.2 客户端

- `[client/frame-sync/index.html](../client/frame-sync/index.html)`
  - 页面骨架
- `[client/frame-sync/style.css](../client/frame-sync/style.css)`
  - 样式
- `[client/frame-sync/app.js](../client/frame-sync/app.js)`
  - Frame Sync 客户端逻辑
- `[client/state-sync/index.html](../client/state-sync/index.html)`
  - 页面骨架
- `[client/state-sync/style.css](../client/state-sync/style.css)`
  - 样式
- `[client/state-sync/app.js](../client/state-sync/app.js)`
  - State Sync 客户端逻辑

---

## 3. `package.json` 是整套程序的入口约定

先看 `[package.json](../package.json)`，因为它决定了“怎么启动”。

你可以把它理解成：

- `npm start` 会做什么
- Node 版本最低要求是什么
- 依赖哪些库

### 3.1 `scripts`

当前项目的启动脚本本质上都指向同一个入口：

- `start`
  - 运行 `node server/src/index.js`
- `dev`
  - 也运行 `node server/src/index.js`

这说明这个项目没有单独的编译层，也没有前端打包器介入。  
客户端直接是浏览器原生加载静态文件。

### 3.2 `engines`

- `node >= 18`

这很重要，因为：

- 服务端使用了现代 Node 运行方式
- `URL`、`Map`、`const`、`let` 等现代特性都默认可用
- 你的启动脚本也默认假设 Node 环境稳定可用

### 3.3 `dependencies`

- `express`
  - 提供 HTTP 服务和静态文件托管
- `ws`
  - 提供 WebSocket 服务端能力

这两个库就是整个项目最核心的运行时依赖。

---

## 4. 共享常量：`server/src/constants.js`

这个文件很短，但它是全局一致性的根。

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

### 4.1 `CANVAS_W` / `CANVAS_H`

这两个值定义了游戏区域大小。

- `400 x 400`
- 服务器计算移动边界时要用
- 客户端绘图时也要用

也就是说，地图不是“看起来像 400 x 400”，而是客户端和服务器都必须认同它就是这个尺寸。

### 4.2 `PLAYER_SIZE`

玩家方块的尺寸。

为什么它重要：

- 运动边界不是用中心点判断，而是要考虑方块半径
- 绘图时要把中心点换算成左上角
- 生成点要避免一出生就贴边

### 4.3 `SPEED_PER_TICK`

每个 tick 走多少像素。

- 服务器和客户端都必须用同一个值
- Frame Sync 里尤其关键，因为客户端要自己模拟

### 4.4 `TICK_MS`

服务器主循环的步长，单位毫秒。

- 这里是 `50`
- 也就是每秒大约 `20` 次 tick

这是一个学习用的“固定步长”设计，不追求高精度物理，只求逻辑清晰。

### 4.5 `MAX_PLAYERS`

房间最多容纳多少玩家。

- 当前是 `16`
- 这会影响：
  - 连接超限时如何拒绝
  - 出生点如何排布
  - UI 中最多看到多少人

---

## 5. 运动学：`server/src/sim.js`

这个文件负责两个很关键的基础函数。

### 5.1 `clamp(v, min, max)`

```js
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
```

它的作用只有一个：把值限制在区间内。

在本项目里它主要用于：

- 防止玩家跑出画布
- 保证出生点和移动结果都在合法范围

你可以把它理解成“边界保险丝”。

### 5.2 `stepPlayer(x, y, keys)`

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

这是本项目最重要的“运动规则”。

#### 它做了什么

1. 把按键状态转换成布尔值
2. 计算横轴和纵轴的位移
3. 用 `SPEED_PER_TICK` 作为步幅
4. 用 `clamp` 把结果限制在画布内
5. 返回新坐标

#### 为什么这样写

- 输入只看方向键，不看鼠标、不看复杂动作
- `right - left` 和 `down - up` 的写法很适合做对称移动
- 同时按相反方向时会抵消
  - 左右一起按，横向位移为 `0`
  - 上下一起按，纵向位移为 `0`

#### 为什么半径要参与边界计算

玩家不是一个点，而是一个 `PLAYER_SIZE` 的方块。

- 如果直接限制中心点为 `0 ~ CANVAS_W`
  - 方块会有一半跑出屏幕
- 所以正确范围应该是：
  - `half ~ CANVAS_W - half`
  - `half ~ CANVAS_H - half`

### 5.3 `spawnForIndex(index)`

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

这个函数负责“玩家出生在哪里”。

#### 计算思路

- 用 4 列摆放
- 根据 `index` 算出 `row` 和 `col`
- 用 `margin = 80` 留出四周空白
- 在画布内部均匀分布出生点

#### 为什么是 4 列

因为 `MAX_PLAYERS = 16`，正好可以排成 `4 x 4` 的格子。

这是一种很适合教学的布局：

- 不需要随机出生
- 不会重叠
- 一眼能看出多个玩家的位置关系

#### 为什么 `cellH` 用 `/ 3`

4 行玩家对应 3 个间隔。

如果你把 4 个点从上到下排开，本质上是在 3 个“空隙”里做均分。  
这是一个简洁的网格排布技巧。

---

## 6. 服务器入口：`server/src/index.js`

这个文件是整个服务端的总装配点。

它的职责不是“算游戏逻辑”，而是：

- 启 HTTP 服务
- 暴露静态页面
- 接管 WebSocket upgrade
- 把不同 URL 导向不同 room

### 6.1 依赖导入

你会看到它引入了：

- `path`
- `http`
- `express`
- `ws`
- `attachFrameSyncRoom`
- `attachStateSyncRoom`

这里的意思非常明确：

- `express` 负责页面
- `ws` 负责实时连接
- `frameSyncRoom` 和 `stateSyncRoom` 负责两种模式的业务逻辑

### 6.2 静态文件托管

服务端把两个 demo 页面分别挂在不同路径下：

- `/frame-sync`
- `/state-sync`

它们对应各自的前端目录。

这样做的好处是：

- 两个 demo 互不干扰
- 浏览器直接访问路径就能打开对应页面
- 调试时可以清楚区分两种同步方式

### 6.3 WebSocket 为什么要手动 `upgrade`

这是这个项目里最值得学习的一段。

```js
const wssOptions = {
    noServer: true,
    perMessageDeflate: false,
};

const wssFrame = new WebSocket.Server(wssOptions);
const wssState = new WebSocket.Server(wssOptions);
```

#### `noServer: true`

表示 WebSocket 服务不自己去监听 HTTP server，而是由你手动接管升级流程。

这在这里非常必要，因为项目里有两个不同的 WebSocket 房间：

- `/ws/frame-sync`
- `/ws/state-sync`

如果不手动分流，就容易把连接挂错地方，或者让两个房间互相干扰。

#### `perMessageDeflate: false`

关闭 WebSocket 消息压缩。

原因很实际：

- 消息很小
- 频率很高
- 压缩的收益不大
- 反而会增加复杂度和开销

这个项目更适合保持简单直接。

### 6.4 `server.on('upgrade', ...)`

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

这段代码的作用是：

1. 拿到浏览器请求的 URL
2. 解析出 pathname
3. 根据 pathname 决定交给哪个 WebSocket server
4. 如果路径不匹配，直接销毁连接

#### 为什么要解析 pathname

因为同一个 HTTP server 上可能有多个 WebSocket 入口。  
path 是最直观、最容易理解的分流方式。

#### 为什么要自己调用 `handleUpgrade`

因为 `noServer: true` 已经告诉 `ws`：

- 不要自动帮我接管 HTTP upgrade
- 你先等我决定把这个 socket 给谁

这就让“路由”和“连接接管”变成了你显式控制的行为。

这是本项目之前修复连接断开问题的关键点。

### 6.5 启动日志

服务启动时会打印本地访问地址。

这对教学项目很重要，因为你可以立刻知道：

- 服务有没有起来
- 该打开哪个页面
- 两个 demo 的入口是否都正常

---

## 7. Frame Sync 房间：`server/src/frameSyncRoom.js`

这个文件负责“输入同步”模式。

它的核心思想不是“服务器算位置”，而是：

- 服务器收集每个玩家的输入
- 服务器按帧广播输入快照
- 客户端自己根据输入和共享规则推进模拟

### 7.1 房间数据结构

你会看到它维护一个 `players` 容器。

每个玩家一般会有这些信息：

- `ws`
- `id`
- `x`
- `y`
- `pending`

其中最关键的是 `pending`：

- 它表示当前玩家最新一次提交的按键状态
- 服务器在每个 tick 都会把它打包成输入快照

### 7.2 广播函数

Frame Sync 房间通常会有两类广播：

- 广播给所有人
- 广播给除自己之外的人

这样设计是为了分别处理：

- 房间公告
- 玩家加入/退出
- 共享输入帧

如果把所有消息都混在一起，客户端会非常难维护。

### 7.3 `welcome`

玩家刚连上来时，服务器会发一个 `welcome`。

它的作用是建立初始状态：

- `mode: 'frame-sync'`
- `id`
- `frame`
- `tickMs`
- 当前房间里的玩家列表

客户端拿到这条消息后，才知道：

- 自己是谁
- 现在处在哪一帧
- 房间里已经有哪些人

### 7.4 `input`

客户端会持续发送输入消息，大致长这样：

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

服务器收到后不会立刻改位置，而是更新这个玩家的 `pending` 输入。

这是 Frame Sync 的关键：

- 输入先到服务器
- 位置后由客户端本地按规则推进
- 服务器只负责“同步帧”和“分发输入”

### 7.5 tick 循环

Frame Sync 的 tick 更像“节拍器”。

它通常做的事情是：

- 让帧编号递增
- 收集所有玩家的 pending input
- 广播给所有客户端

广播的数据通常是：

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

#### 这意味着什么

客户端拿到同一帧、同一份输入后，就可以在本地按相同步长前进。

这就是“输入同步”。

### 7.6 连接关闭

玩家断开时，服务器会：

- 从 `players` 中删除这个玩家
- 广播 `player_left`

这样别的客户端就能把这个人从画面里移除。

### 7.7 Frame Sync 的学习重点

这套逻辑重点不在“服务器算得多精准”，而在：

- 所有客户端是否使用同一套规则
- 输入是否在同一节拍上被分发
- 本地模拟是否足够稳定

你可以把它理解成“大家一起按同一份剧本演”。

---

## 8. State Sync 房间：`server/src/stateSyncRoom.js`

这个文件负责“状态同步”模式。

它和 Frame Sync 最大的区别是：

- 状态由服务器算
- 客户端不自己决定最终位置

### 8.1 房间数据结构

这里的玩家通常会带上：

- `ws`
- `id`
- `x`
- `y`
- `keys`

注意，这里保存的是 `keys`，不是 `pending`。

因为服务器会直接用这个按键状态去推进位置。

### 8.2 `welcome`

`welcome` 里除了自己的 id 和房间玩家列表外，还会告诉客户端：

- 当前模式是 `state-sync`
- 当前帧编号
- tick 间隔

客户端据此建立 UI 初始状态。

### 8.3 `input`

客户端上报按键状态。

服务器收到后直接更新这个玩家的 `keys`。

这和 Frame Sync 的区别在于：

- Frame Sync 只是“收起来，等统一分发”
- State Sync 是“收到后直接拿来算”

### 8.4 tick 循环

State Sync 的 tick 会做真正的模拟推进。

大意是：

1. 遍历所有玩家
2. 调用 `stepPlayer(x, y, keys)`
3. 更新玩家坐标
4. 广播所有玩家的最新位置

广播的数据一般是：

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

### 8.5 为什么它更“权威”

因为客户端不能自己决定最终位置。

即使客户端本地显示有延迟、卡顿、抖动，最后服务器广播的 state 还是准的。

这就是状态同步的优点：

- 简单
- 稳定
- 容易调试

代价是：

- 带宽更大
- 服务器负担更高
- 客户端“先感受到的反馈”可能更慢

### 8.6 连接关闭

和 Frame Sync 一样，玩家离开后：

- 从 `players` 中移除
- 广播 `player_left`

这样其他客户端能及时清理显示。

---

## 9. Frame Sync 与 State Sync 的本质区别

这部分很适合对照着看。

| 维度 | Frame Sync | State Sync |
|---|---|---|
| 服务器角色 | 分发输入、维护节拍 | 计算最终状态 |
| 客户端角色 | 本地模拟 | 主要渲染 |
| 网络消息重点 | `frame + inputs` | `state + players` |
| 谁决定位置 | 客户端本地 | 服务器 |
| 优点 | 带宽小、思路接近 lockstep | 稳定、简单、易调试 |
| 缺点 | 强依赖确定性 | 带宽更高、服务器更忙 |

如果你要学习网络游戏同步，最重要的不是背这个表，而是理解：

- Frame Sync 把“正确性”压到客户端一致性上
- State Sync 把“正确性”压到服务器权威上

这就是两种设计哲学。

---

## 10. 客户端公共骨架

两个客户端页面结构非常接近。

### 10.1 `index.html`

它们都只负责放一个最小骨架：

- 页面标题
- 顶部说明
- 状态文字
- `canvas`
- `app.js`

这说明真正的交互逻辑都在 JavaScript 里，HTML 只是承载层。

### 10.2 `style.css`

样式文件主要做三件事：

- 设置暗色背景
- 给 `canvas` 一个清晰边框和阴影
- 让页面在移动端和桌面端都能正常阅读

对于这个项目来说，视觉不是重点，但“能看清状态”很重要。

---

## 11. Frame Sync 客户端：`client/frame-sync/app.js`

这个文件是学习 Frame Sync 的关键。

### 11.1 局部工具函数

你会看到它也有一套和服务器很像的工具：

- `clamp`
- `stepPlayer`

这不是重复劳动，而是 Frame Sync 的核心要求：

- 客户端必须用和服务器一致的运动规则
- 否则本地模拟会和大家不一致

### 11.2 页面引用

客户端会先拿到：

- `canvas`
- `ctx`
- 状态文本区域
- 玩家缓存结构

这些东西决定了“怎么画”和“画什么”。

### 11.3 WebSocket 连接

客户端会连到：

- `/ws/frame-sync`

连接成功后，它会更新页面状态，比如：

- 正在连接
- 已连接
- 已断开

这部分虽然简单，但很适合调试网络问题。

### 11.4 `welcome`

收到 `welcome` 后，客户端会建立本地玩家表。

通常包括：

- 自己的 id
- 房间内已有玩家
- 初始坐标
- 当前帧和 tick 间隔

这一步是“客户端第一次和服务器对齐世界观”。

### 11.5 `player_joined` / `player_left`

新玩家进来时：

- 把他加到本地 `players` 里

玩家离开时：

- 从本地 `players` 里删掉

这样 UI 就和房间成员保持一致。

### 11.6 `frame`

这是 Frame Sync 客户端最关键的消息。

收到一个 `frame` 后，客户端会拿到：

- 当前帧号
- 所有玩家的输入

然后在本地根据这些输入逐个推进玩家位置。

也就是说，客户端不是被动等服务器告诉它“你现在在哪”，而是：

- 拿输入
- 自己算下一步
- 再画出来

这就是输入同步的核心体验。

### 11.7 `sendInput`

客户端会持续把当前按键状态发给服务器。

它做的事大致是：

1. 收集当前方向键状态
2. 打包成 JSON
3. 通过 WebSocket 发送

这个循环通常会跟着一个固定频率跑，比如每秒 30 次。

### 11.8 键盘事件

键盘按下和松开时，客户端只做一件事：

- 更新本地按键表

真正的移动不是键盘事件驱动的，而是：

- 键盘事件改状态
- 定时发送状态
- 服务器/本地模拟在 tick 中使用状态

这是一种标准的网络输入设计。

### 11.9 渲染循环

Frame Sync 客户端的 `requestAnimationFrame` 负责画面更新。

通常会画：

- 背景网格
- 每个玩家的方块
- 玩家 id
- 当前帧号
- 连接状态

#### 为什么要每帧重绘

因为前端 canvas 是即时绘图模型，不是保留式 UI。

你每次都要重新画整个场景，才能保证画面和状态一致。

---

## 12. State Sync 客户端：`client/state-sync/app.js`

State Sync 客户端和 Frame Sync 客户端结构很像，但职责更轻。

### 12.1 相同点

它也有：

- canvas
- WebSocket
- 键盘事件
- 连接状态
- 渲染循环

说明两个 demo 在“界面骨架”上是统一的。

### 12.2 不同点

最大的不同是：

- 它不需要自己根据输入推进所有玩家的位置
- 它主要接收 `state` 消息并直接渲染

### 12.3 `state`

服务器会定期发来完整状态：

- 每个玩家的 id
- 每个玩家的 x/y 坐标
- 当前帧号

客户端收到后会更新本地缓存，然后在下一次绘制里直接显示。

### 12.4 为什么文件里还会出现 `stepPlayer`

当前版本里，`client/state-sync/app.js` 里保留了一个 `stepPlayer`。

你可以把它理解成：

- 和 Frame Sync 保持代码风格一致
- 方便以后做预测或对照实验
- 但当前渲染主流程并不依赖它

这在学习项目里很常见：  
先保留一个“可实验的钩子”，以后想扩展时不用从零加。

### 12.5 `sendInput`

虽然 State Sync 服务器自己算状态，客户端仍然要发输入。

原因是：

- 服务器需要知道玩家想怎么移动
- 状态同步不是“客户端不发消息”，而是“客户端不决定结果”

这点很容易误解。

### 12.6 渲染逻辑

State Sync 的渲染更直接：

- 画画布
- 根据 `players` 的最新坐标画方块
- 标注 id
- 显示连接状态和当前帧

如果说 Frame Sync 更像“大家自己算”，  
State Sync 就更像“服务器发最终答案，客户端照着抄”。

---

## 13. 消息协议总表

这部分建议你一边看文档一边去搜源码里的 `type` 分支。

### 13.1 `welcome`

用途：初始化连接状态。

常见字段：

- `type`
- `mode`
- `id`
- `frame`
- `tickMs`
- `players`

### 13.2 `input`

用途：客户端上报当前按键。

常见字段：

- `type`
- `keys`

### 13.3 `frame`

用途：Frame Sync 广播统一节拍与输入。

常见字段：

- `type`
- `frame`
- `inputs`

### 13.4 `state`

用途：State Sync 广播当前服务器状态。

常见字段：

- `type`
- `frame`
- `players`

### 13.5 `player_joined`

用途：告诉所有客户端有新玩家加入。

常见字段：

- `type`
- `player`

### 13.6 `player_left`

用途：告诉所有客户端有玩家离开。

常见字段：

- `type`
- `id`

### 13.7 `error`

用途：告诉客户端出现了错误，比如：

- 房间已满
- 消息格式错误
- 连接不合法

常见字段：

- `type`
- `message`

---

## 14. 这套代码最值得你抄走的设计点

### 14.1 配置集中在 constants

不要把 `400`、`50` 这种值散落在各处。  
集中管理会让服务器和客户端不容易打架。

### 14.2 共享的运动规则必须完全一致

Frame Sync 尤其如此。

如果客户端和服务器的 `stepPlayer` 有一点点不一样，模拟很快就会漂移。

### 14.3 WebSocket 升级要显式分流

这个项目已经证明了一个非常现实的问题：

- 同一个 HTTP server 上有多个 WebSocket 入口时
- 最好自己控制 `upgrade`

这样更清楚，也更不容易出现莫名断开。

### 14.4 房间逻辑尽量封装

把 `frame-sync` 和 `state-sync` 拆成两个 room 文件是对的。

因为它们虽然共享网络层，但业务含义完全不同。

### 14.5 客户端先处理消息，再渲染

无论是哪种同步方式，处理顺序都很重要：

1. 收消息
2. 更新状态
3. 再画画面

不要把网络逻辑和绘制逻辑混在一起。

---

## 15. 推荐学习顺序

如果你想真正吃透这个项目，我建议按下面顺序走一遍：

1. 先看 `[server/src/constants.js](../server/src/constants.js)`  
   把所有数值记住
2. 再看 `[server/src/sim.js](../server/src/sim.js)`  
   理解移动和出生
3. 再看 `[server/src/index.js](../server/src/index.js)`  
   搞懂 HTTP 和 WebSocket 的分流
4. 再看 `[server/src/frameSyncRoom.js](../server/src/frameSyncRoom.js)`  
   理解输入同步
5. 再看 `[server/src/stateSyncRoom.js](../server/src/stateSyncRoom.js)`  
   理解状态同步
6. 最后看两个 `app.js`  
   看客户端如何接消息和画图

如果你愿意继续深入，可以下一步做这三件事：

1. 给每个 `type` 消息画一张流程图
2. 给 Frame Sync 和 State Sync 分别画时序图
3. 把两个客户端改成一个可切换模式的页面

---

## 16. 一句话总结

这个项目的本质是：

- 用同一套地图和移动规则
- 展示两种完全不同的网络同步思路
- 让你亲眼看到“输入同步”和“状态同步”的差异

如果你想继续，我下一步可以帮你把这份文档再升级成“带时序图版”，或者直接继续写一份“逐函数注释版”。  
