const { CANVAS_W, CANVAS_H, PLAYER_SIZE, SPEED_PER_TICK } = require('./constants');

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/** Deterministic movement from key state — used by frame-sync server mirror sim. */
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

module.exports = { stepPlayer, spawnForIndex, clamp };
