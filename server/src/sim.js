const { CANVAS_W, CANVAS_H, PLAYER_SIZE, SPEED_PER_TICK } = require('./constants');

// 把一个数夹在最小值和最大值之间，避免角色跑出画布。
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * 根据按键状态推进一步移动。
 * 这套计算必须在服务器和帧同步客户端里保持完全一致，否则同一帧会推演出不同结果。
 */
function stepPlayer(x, y, keys) {
    // 先把输入归一化成布尔值，避免 undefined、null、0 等值混进来。
    const up = !!keys.up;
    const down = !!keys.down;
    const left = !!keys.left;
    const right = !!keys.right;
    // 横向和纵向分开算，右减左、下减上，抵消后就会得到 -1 / 0 / 1。
    let nx = x + ((right ? 1 : 0) - (left ? 1 : 0)) * SPEED_PER_TICK;
    let ny = y + ((down ? 1 : 0) - (up ? 1 : 0)) * SPEED_PER_TICK;
    // 玩家是一个方块，不是一个点，所以边界要给半个方块的留白。
    const half = PLAYER_SIZE / 2;
    nx = clamp(nx, half, CANVAS_W - half);
    ny = clamp(ny, half, CANVAS_H - half);
    return { x: nx, y: ny };
}

// 按索引返回一个稳定的出生点，方便多人同时进入时排成网格。
function spawnForIndex(index) {
    // 16 人房间正好能放进 4 x 4 的布局。
    const cols = 4;
    const row = Math.floor(index / cols);
    const col = index % cols;
    // 留出边距，避免玩家一出生就贴着边界。
    const margin = 80;
    // 这里用“可用空间 / 间隔数”来均匀分布点位。
    const cellW = (CANVAS_W - 2 * margin) / (cols - 1 || 1);
    const cellH = (CANVAS_H - 2 * margin) / 3;
    return {
        x: margin + col * cellW,
        y: margin + row * cellH,
    };
}

module.exports = { stepPlayer, spawnForIndex, clamp };
