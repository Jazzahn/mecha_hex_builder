// Pointy-top hexes, ODD-R offset coordinates (q=col, r=row)
// Even rows are left-aligned; odd rows shift right by half a hex.
// This produces a rectangular board shape.
// All game-logic math (distance, LOS, front arc) converts to axial internally.

export const BOARD_COLS = 15;
export const BOARD_ROWS = 17;
export const HEX_SIZE = 24;
export const PADDING = 40;

export const DIR_LABELS = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];

// Offset (col, row) → axial (q, r) for odd-r layout
function toAxial(col, row) {
  return { q: col - Math.floor(row / 2), r: row };
}

// Axial (q, r) → offset (col, row)
function toOffset(q, r) {
  return { q: q + Math.floor(r / 2), r };
}

// Neighbor offsets for pointy-top odd-r (depend on row parity)
function getDirections(row) {
  return row % 2 === 0
    ? [
        { q:  1, r:  0 }, // 0 E
        { q:  0, r: -1 }, // 1 NE
        { q: -1, r: -1 }, // 2 NW
        { q: -1, r:  0 }, // 3 W
        { q: -1, r:  1 }, // 4 SW
        { q:  0, r:  1 }, // 5 SE
      ]
    : [
        { q:  1, r:  0 }, // 0 E
        { q:  1, r: -1 }, // 1 NE
        { q:  0, r: -1 }, // 2 NW
        { q: -1, r:  0 }, // 3 W
        { q:  0, r:  1 }, // 4 SW
        { q:  1, r:  1 }, // 5 SE
      ];
}

// Axial direction vectors (for facing/LOS math, independent of row parity)
const AXIAL_DIRS = [
  { q: 1,  r:  0 }, // 0 E
  { q: 1,  r: -1 }, // 1 NE
  { q: 0,  r: -1 }, // 2 NW
  { q: -1, r:  0 }, // 3 W
  { q: -1, r:  1 }, // 4 SW
  { q: 0,  r:  1 }, // 5 SE
];

// Pixel direction vectors for each facing (same for any row parity)
export const FACING_PIXEL_DELTAS = AXIAL_DIRS.map(({ q, r }) => ({
  dx: HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r),
  dy: HEX_SIZE * 1.5 * r,
}));

export function inBounds(q, r) {
  return q >= 0 && q < BOARD_COLS && r >= 0 && r < BOARD_ROWS;
}

export function hexKey(q, r) { return `${q},${r}`; }

// Distance via axial conversion
export function hexDistance(col1, row1, col2, row2) {
  const a = toAxial(col1, row1), b = toAxial(col2, row2);
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hexNeighbors(col, row) {
  return getDirections(row)
    .map(d => ({ q: col + d.q, r: row + d.r }))
    .filter(h => inBounds(h.q, h.r));
}

// Offset neighbor in a specific facing direction (may be out of bounds — caller checks)
export function hexNeighborAt(col, row, facing) {
  const d = getDirections(row)[facing];
  return { q: col + d.q, r: row + d.r };
}

// Offset (col, row) → pixel center (rectangular grid, odd rows shift right)
export function hexToPixel(col, row) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * col + (row & 1 ? HEX_SIZE * Math.sqrt(3) / 2 : 0) + PADDING,
    y: HEX_SIZE * 1.5 * row + PADDING,
  };
}

function cubeRound(q, r, s) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// Pixel → offset (col, row): convert to axial via inverse formula, round, then to offset
export function pixelToHex(px, py) {
  const x = px - PADDING, y = py - PADDING;
  const aq = (x * Math.sqrt(3) / 3 - y / 3) / HEX_SIZE;
  const ar = (y * 2 / 3) / HEX_SIZE;
  const axial = cubeRound(aq, ar, -aq - ar);
  return toOffset(axial.q, axial.r);
}

// 6 corner points of a pointy-top hex at center (cx, cy)
export function hexCorners(cx, cy) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return { x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) };
  });
}

export function cornersToPoints(corners) {
  return corners.map(c => `${c.x},${c.y}`).join(' ');
}

// Which facing best matches the direction from (fromCol,fromRow) to (toCol,toRow)?
// Uses axial space for consistent dot-product comparison
export function vectorToFacing(fromCol, fromRow, toCol, toRow) {
  const fa = toAxial(fromCol, fromRow), ta = toAxial(toCol, toRow);
  const dq = ta.q - fa.q, dr = ta.r - fa.r, ds = -(dq + dr);
  let best = 0, bestDot = -Infinity;
  AXIAL_DIRS.forEach(({ q, r }, i) => {
    const dot = dq * q + dr * r + ds * (-q - r);
    if (dot > bestDot) { bestDot = dot; best = i; }
  });
  return best;
}

// Is (tCol, tRow) in the front 180° arc of a unit at (uCol, uRow) facing `facing`?
export function inFrontArc(uCol, uRow, facing, tCol, tRow) {
  if (tCol === uCol && tRow === uRow) return false;
  const sector = vectorToFacing(uCol, uRow, tCol, tRow);
  const diff = ((sector - facing) + 6) % 6;
  return diff <= 1 || diff >= 5;
}

// Facing arrow triangle points, centred at (cx, cy)
export function facingArrow(cx, cy, facing) {
  const { dx, dy } = FACING_PIXEL_DELTAS[facing];
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len, ny = dy / len;
  const tipDist = HEX_SIZE * 0.72, baseDist = HEX_SIZE * 0.3, wingW = HEX_SIZE * 0.22;
  const tip  = { x: cx + nx * tipDist,  y: cy + ny * tipDist };
  const base = { x: cx + nx * baseDist, y: cy + ny * baseDist };
  const perp = { x: -ny, y: nx };
  return [
    tip,
    { x: base.x + perp.x * wingW, y: base.y + perp.y * wingW },
    { x: base.x - perp.x * wingW, y: base.y - perp.y * wingW },
  ];
}

// Dijkstra BFS: find all hexes reachable within `speedPoints`
// terrain: { [hexKey]: { type, elevation } }
// occupiedSet: Set<hexKey>
// Returns Map<hexKey, { cost, facing }>
export function reachableHexes(startQ, startR, startFacing, speedPoints, terrain, occupiedSet) {
  const stateKey = (q, r, f) => `${q},${r},${f}`;
  const dist = new Map();
  const queue = [{ q: startQ, r: startR, facing: startFacing, cost: 0 }];
  dist.set(stateKey(startQ, startR, startFacing), 0);

  const reachable = new Map();

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { q, r, facing, cost } = queue.shift();

    const sk = stateKey(q, r, facing);
    if ((dist.get(sk) ?? Infinity) < cost) continue;

    if (!(q === startQ && r === startR)) {
      const hk = hexKey(q, r);
      if (!reachable.has(hk) || reachable.get(hk).cost > cost) {
        reachable.set(hk, { cost, facing });
      }
    }

    if (cost >= speedPoints) continue;

    // Pivot (1 SP per face, shortest rotation)
    for (let f = 0; f < 6; f++) {
      if (f === facing) continue;
      const pivotCost = Math.min(((f - facing + 6) % 6), ((facing - f + 6) % 6));
      const nc = cost + pivotCost;
      if (nc > speedPoints) continue;
      const k = stateKey(q, r, f);
      if ((dist.get(k) ?? Infinity) > nc) {
        dist.set(k, nc);
        queue.push({ q, r, facing: f, cost: nc });
      }
    }

    // Row-parity-aware directions
    const dirs = getDirections(r);

    // Forward (1 SP)
    const fd = dirs[facing];
    tryStep(q + fd.q, r + fd.r, facing, cost + 1, q, r);

    // Backward (2 SP, keep facing)
    const bd = dirs[(facing + 3) % 6];
    tryStep(q + bd.q, r + bd.r, facing, cost + 2, q, r);

    function tryStep(nq, nr, newFacing, baseCost, fq, fr) {
      if (!inBounds(nq, nr)) return;
      if (occupiedSet.has(hexKey(nq, nr))) return;
      const t = terrain[hexKey(nq, nr)];
      if (t?.type === 'blocking') return;

      let moveCost = baseCost;
      if (t?.type === 'difficult') moveCost++;

      const fromEl = terrain[hexKey(fq, fr)]?.elevation ?? 0;
      const toEl   = t?.elevation ?? 0;
      const elDiff = toEl - fromEl;
      if (elDiff > 1) return;
      if (elDiff > 0) moveCost += elDiff;

      if (moveCost > speedPoints) return;
      const k = stateKey(nq, nr, newFacing);
      if ((dist.get(k) ?? Infinity) > moveCost) {
        dist.set(k, moveCost);
        queue.push({ q: nq, r: nr, facing: newFacing, cost: moveCost });
      }
    }
  }

  return reachable;
}

// Hex line for LOS (converts to axial for tracing, returns offset coords)
export function hexLine(col1, row1, col2, row2) {
  const a = toAxial(col1, row1), b = toAxial(col2, row2);
  const n = hexDistance(col1, row1, col2, row2);
  if (n === 0) return [{ q: col1, r: row1 }];
  const result = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rq = a.q + (b.q - a.q) * t, rr = a.r + (b.r - a.r) * t;
    const axial = cubeRound(rq, rr, -rq - rr);
    const off = toOffset(axial.q, axial.r);
    result.push(off);
  }
  return result;
}

// SVG canvas dimensions for the rectangular board
export const SVG_WIDTH  = Math.ceil(BOARD_COLS * HEX_SIZE * Math.sqrt(3) + HEX_SIZE * Math.sqrt(3) / 2 + PADDING * 2);
export const SVG_HEIGHT = Math.ceil((BOARD_ROWS - 1) * HEX_SIZE * 1.5 + HEX_SIZE * 2 + PADDING * 2);

// Deployment zones: rows 0–4 for player 0 (top), rows 12–16 for player 1 (bottom)
export function isDeployZone(col, row, playerIndex) {
  if (playerIndex === 0) return row <= 4;
  return row >= BOARD_ROWS - 5;
}

export const PLAYER_COLORS = ['#1565c0', '#b71c1c'];
export const PLAYER_LIGHT  = ['#90caf9', '#ef9a9a'];
