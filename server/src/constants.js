/**
 * 共享模拟常量。
 * 这里的数值必须和两个客户端 demo 保持一致，否则服务端和前端会对不上同一套坐标系。
 */
module.exports = {
    // 逻辑画布宽度，服务端做边界裁剪、客户端做绘制时都要用。
    CANVAS_W: 400,
    // 逻辑画布高度。
    CANVAS_H: 400,
    // 玩家方块边长。
    PLAYER_SIZE: 28,
    // 每个 tick 里允许移动的像素数。
    SPEED_PER_TICK: 5,
    // 服务器主循环节拍，50ms = 20 TPS。
    TICK_MS: 50,
    // 房间最大人数。
    MAX_PLAYERS: 16,
};
