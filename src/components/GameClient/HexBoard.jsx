import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, HEX_SIZE,
  hexToPixel, pixelToHex, hexCorners, cornersToPoints,
  hexKey, hexNeighborAt, inBounds,
  SVG_WIDTH, SVG_HEIGHT, PLAYER_COLORS, PLAYER_LIGHT,
  FACING_PIXEL_DELTAS,
} from '../../game/hexMath';
import grassHexImg from '../../assets/terrain/grass_hex.png';
import explosionGif from '../../assets/animations/Explosion.gif';
import heavyMechBlue   from '../../assets/units/Heavy_blue.png';
import assaultMechBlue from '../../assets/units/Assault_blue.png';
import mediumMechBlue  from '../../assets/units/Medium_blue.png';
import lightMechBlue   from '../../assets/units/Light_blue.png';
import groundVehBlue   from '../../assets/units/Ground_Veh_blue.png';
import heavyVehBlue    from '../../assets/units/Heavy_Veh_blue.png';
import heavyMechRed    from '../../assets/units/Heavy_red.png';
import assaultMechRed  from '../../assets/units/Assault_red.png';
import mediumMechRed   from '../../assets/units/Medium_red.png';
import lightMechRed    from '../../assets/units/Light_red.png';
import groundVehRed    from '../../assets/units/Ground_Veh_red.png';
import heavyVehRed     from '../../assets/units/Heavy_Veh_red.png';
import overlayDifficult1 from '../../assets/terrain/overlay_difficult_1.png';
import overlayDifficult2 from '../../assets/terrain/overlay_difficult_2.png';
import overlayDifficult3 from '../../assets/terrain/overlay_difficult_3.png';
import overlayCover1 from '../../assets/terrain/overlay_cover_1.png';
import overlayCover2 from '../../assets/terrain/overlay_cover_2.png';
import overlayBlocking1 from '../../assets/terrain/blocking_1.png';
import overlayBlocking2 from '../../assets/terrain/blocking_2.png';
import overlayElev1E  from '../../assets/terrain/overlay_elevation_1_e.png';
import overlayElev1NE from '../../assets/terrain/overlay_elevation_1_ne.png';
import overlayElev1NW from '../../assets/terrain/overlay_elevation_1_nw.png';
import overlayElev1W  from '../../assets/terrain/overlay_elevation_1_w.png';
import overlayElev1SW from '../../assets/terrain/overlay_elevation_1_sw.png';
import overlayElev1SE from '../../assets/terrain/overlay_elevation_1_se.png';
import overlayElev2E  from '../../assets/terrain/overlay_elevation_2_e.png';
import overlayElev2NE from '../../assets/terrain/overlay_elevation_2_ne.png';
import overlayElev2NW from '../../assets/terrain/overlay_elevation_2_nw.png';
import overlayElev2W  from '../../assets/terrain/overlay_elevation_2_w.png';
import overlayElev2SW from '../../assets/terrain/overlay_elevation_2_sw.png';
import overlayElev2SE from '../../assets/terrain/overlay_elevation_2_se.png';
import overlayElev3E  from '../../assets/terrain/overlay_elevation_3_e.png';
import overlayElev3NE from '../../assets/terrain/overlay_elevation_3_ne.png';
import overlayElev3NW from '../../assets/terrain/overlay_elevation_3_nw.png';
import overlayElev3W  from '../../assets/terrain/overlay_elevation_3_w.png';
import overlayElev3SW from '../../assets/terrain/overlay_elevation_3_sw.png';
import overlayElev3SE from '../../assets/terrain/overlay_elevation_3_se.png';
import shadowW1  from '../../assets/terrain/shadow_1_w.png';
import shadowW2  from '../../assets/terrain/shadow_2_w.png';
import shadowW3  from '../../assets/terrain/shadow_3_w.png';
import shadowNW1 from '../../assets/terrain/shadow_1_nw.png';
import shadowNW2 from '../../assets/terrain/shadow_2_nw.png';
import shadowNW3 from '../../assets/terrain/shadow_3_nw.png';

// Indexed [1..3] — null placeholder at [0] so diff maps directly
const SHADOW_W  = [null, shadowW1,  shadowW2,  shadowW3];
const SHADOW_NW = [null, shadowNW1, shadowNW2, shadowNW3];

const DIFFICULT_VARIANTS = [overlayDifficult1, overlayDifficult2, overlayDifficult3];
const COVER_VARIANTS = [overlayCover1, overlayCover2];
const BLOCKING_VARIANTS = [overlayBlocking1, overlayBlocking2];
// Each array ordered E, NE, NW, W, SW, SE — matches facing direction indices 0–5
const ELEVATION_SIDES = [
  [overlayElev1E, overlayElev1NE, overlayElev1NW, overlayElev1W, overlayElev1SW, overlayElev1SE],
  [overlayElev2E, overlayElev2NE, overlayElev2NW, overlayElev2W, overlayElev2SW, overlayElev2SE],
  [overlayElev3E, overlayElev3NE, overlayElev3NW, overlayElev3W, overlayElev3SW, overlayElev3SE],
];

// Pointy-top hex image dimensions at HEX_SIZE=24
const HEX_IMG_W = HEX_SIZE * Math.sqrt(3);
const HEX_IMG_H = HEX_SIZE * 2;

// Reflection transform for mirroring a sprite along a hex face.
// Each hex face has a specific angle: E/W = 90°, NE/SW = 30°, NW/SE = 150°.
// Reflects about that line passing through (cx, cy) = (x, y) hex center.
// SVG reflection matrix about line at angle θ through (cx,cy):
//   a=cos2θ  b=sin2θ  c=sin2θ  d=-cos2θ
//   e=cx*(1-cos2θ)-cy*sin2θ  f=-cx*sin2θ+cy*(1+cos2θ)
const _S3H = Math.sqrt(3) / 2;
function reflectTransform(side, x, y) {
  if (side === 0 || side === 3) {
    // θ=90°: horizontal flip about x
    return `translate(${x}, 0) scale(-1, 1) translate(${-x}, 0)`;
  }
  if (side === 1 || side === 4) {
    // θ=30°: reflect along NE–SW axis
    const e = 0.5 * x - _S3H * y;
    const f = -_S3H * x + 1.5 * y;
    return `matrix(0.5,${_S3H},${_S3H},-0.5,${e},${f})`;
  }
  // side 2 or 5 — θ=150°: reflect along NW–SE axis
  const e = 0.5 * x + _S3H * y;
  const f = _S3H * x + 1.5 * y;
  return `matrix(0.5,${-_S3H},${-_S3H},-0.5,${e},${f})`;
}

const TERRAIN_COLORS = {
  cover:     'rgba(46,125,50,0.35)',
  difficult: 'rgba(230,145,0,0.35)',
  blocking:  'rgba(55,55,55,0.75)',
  dangerous: 'rgba(183,28,28,0.40)',
};

const TYPE_ABBREV = {
  assault: 'A', heavy: 'H', medium: 'M', light: 'L',
  groundVehicle: 'V', heavyVehicle: 'V',
  armedStructure: 'S', unarmedStructure: 'S', fortifiedStructure: 'S',
};

const UNIT_SPRITES = [
  { heavy: heavyMechBlue,  assault: assaultMechBlue, medium: mediumMechBlue,  light: lightMechBlue,  groundVehicle: groundVehBlue,  heavyVehicle: heavyVehBlue  },
  { heavy: heavyMechRed,   assault: assaultMechRed,  medium: mediumMechRed,   light: lightMechRed,   groundVehicle: groundVehRed,   heavyVehicle: heavyVehRed   },
];

const TREE_SHADOW  = 'drop-shadow(2px 4px 3px rgba(0,0,0,0.50))';

function UnitToken({ unit, selected, hasObjective, onUnitClick, onHoverUnit }) {
  const { x, y } = hexToPixel(unit.q, unit.r);
  const color = PLAYER_COLORS[unit.playerIndex];
  const lightColor = PLAYER_LIGHT[unit.playerIndex];
  const abbrev = TYPE_ABBREV[unit.typeId] ?? '?';
  const r = HEX_SIZE * 0.58;
  const sprite = UNIT_SPRITES[unit.playerIndex]?.[unit.typeId];
  const spriteSize = HEX_SIZE * 1.5;

  // Sprite images face "down" (+90° from East). Rotate to match current facing.
  const { dx, dy } = FACING_PIXEL_DELTAS[unit.facing];
  const spriteDeg = Math.atan2(dy, dx) * (180 / Math.PI) - 90;

  return (
    <g
      className={`unit-token${unit.activated ? ' unit-token--activated' : ''}${selected ? ' unit-token--selected' : ''}`}
      onClick={e => { e.stopPropagation(); onUnitClick(unit.id); }}
      onMouseEnter={e => onHoverUnit?.(unit.id, e.clientX, e.clientY)}
      onMouseLeave={() => onHoverUnit?.(null, 0, 0)}
      style={{ cursor: 'pointer' }}
    >
      {/* Background circle for fallback (no sprite) units only */}
      {!sprite && <circle cx={x} cy={y} r={r} fill={unit.activated ? '#ccc' : lightColor} stroke={color} strokeWidth={1.5} />}
      {/* Yellow dashed selection ring */}
      {selected && <circle cx={x} cy={y} r={r + 3} fill="none" stroke="#ffeb3b" strokeWidth={2} strokeDasharray="4 2" />}
      {sprite ? (
        <image
          href={sprite}
          x={x - spriteSize / 2} y={y - spriteSize / 2}
          width={spriteSize} height={spriteSize}
          opacity={unit.activated ? 0.75 : 1}
          preserveAspectRatio="xMidYMid meet"
          transform={`rotate(${spriteDeg}, ${x}, ${y})`}
          style={{ pointerEvents: 'none', filter: TREE_SHADOW }}
        />
      ) : (
        <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
          fontSize={HEX_SIZE * 0.48} fontWeight="700" fill={unit.activated ? '#888' : color}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {abbrev}
        </text>
      )}
      {hasObjective && (
        <text x={x + r * 0.62} y={y - r * 0.62} textAnchor="middle" dominantBaseline="middle"
          fontSize={HEX_SIZE * 0.38} fill="#ffd600" stroke="#333" strokeWidth={0.5}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          ★
        </text>
      )}
      {/* Transparent hit area — keeps pointer events on sprite units where all children are pointerEvents:none */}
      <circle cx={x} cy={y} r={r} fill="transparent" />
    </g>
  );
}

function ObjectiveMarker({ obj }) {
  const { x, y } = hexToPixel(obj.q, obj.r);
  return (
    <g>
      <polygon
        points={`${x},${y - HEX_SIZE * 0.4} ${x + HEX_SIZE * 0.35},${y + HEX_SIZE * 0.2} ${x - HEX_SIZE * 0.35},${y + HEX_SIZE * 0.2}`}
        fill="#ffd600" stroke="#f57f17" strokeWidth={1.5}
      />
    </g>
  );
}

function DeployFacingOverlay({ deployHex }) {
  if (!deployHex) return null;
  const { x: ox, y: oy } = hexToPixel(deployHex.q, deployHex.r);
  const s = HEX_SIZE * 0.28;

  return (
    <g>
      {[0, 1, 2, 3, 4, 5].map(facing => {
        const nb = hexNeighborAt(deployHex.q, deployHex.r, facing);
        if (!inBounds(nb.q, nb.r)) return null;
        const { x, y } = hexToPixel(nb.q, nb.r);
        // Angle pointing from deploy hex center toward this neighbor
        const angle = Math.atan2(y - oy, x - ox) * (180 / Math.PI);
        // Caret triangle: tip at +s along x-axis, base on left — rotated to face outward
        const pts = `${s},0 ${-s * 0.55},${s * 0.65} ${-s * 0.55},${-s * 0.65}`;
        return (
          <polygon
            key={facing}
            points={pts}
            transform={`translate(${x},${y}) rotate(${angle})`}
            fill="#e040fb"
            opacity={0.92}
            style={{ pointerEvents: 'none' }}
          />
        );
      })}
    </g>
  );
}

function TurnOverlay({ unit, onTurnLeft, onTurnRight }) {
  // Left turn (CCW) = facing+1, right turn (CW) = facing+5
  const leftFacing  = (unit.facing + 1) % 6;
  const rightFacing = (unit.facing + 5) % 6;
  // Use hexToPixel on the neighbor hex in each turn-facing direction
  // We replicate the direction lookup inline (getDirections is not exported)
  const dirs = unit.r % 2 === 0
    ? [{ q:1,r:0},{q:0,r:-1},{q:-1,r:-1},{q:-1,r:0},{q:-1,r:1},{q:0,r:1}]
    : [{ q:1,r:0},{q:1,r:-1},{q:0,r:-1},{q:-1,r:0},{q:0,r:1},{q:1,r:1}];

  const ld = dirs[leftFacing];
  const rd = dirs[rightFacing];
  const lHex = { q: unit.q + ld.q, r: unit.r + ld.r };
  const rHex = { q: unit.q + rd.q, r: unit.r + rd.r };
  const lPos = hexToPixel(lHex.q, lHex.r);
  const rPos = hexToPixel(rHex.q, rHex.r);
  const btnR = HEX_SIZE * 0.45;
  const fs   = HEX_SIZE * 0.7;

  return (
    <g>
      <g onClick={e => { e.stopPropagation(); onTurnLeft(); }} style={{ cursor: 'pointer' }}>
        <circle cx={lPos.x} cy={lPos.y} r={btnR} fill="#0d2233" stroke="#42a5f5" strokeWidth={1.5} opacity={0.92} />
        <text x={lPos.x} y={lPos.y + 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fill="#90caf9" style={{ pointerEvents: 'none', userSelect: 'none' }}>↺</text>
      </g>
      <g onClick={e => { e.stopPropagation(); onTurnRight(); }} style={{ cursor: 'pointer' }}>
        <circle cx={rPos.x} cy={rPos.y} r={btnR} fill="#0d2233" stroke="#42a5f5" strokeWidth={1.5} opacity={0.92} />
        <text x={rPos.x} y={rPos.y + 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fill="#90caf9" style={{ pointerEvents: 'none', userSelect: 'none' }}>↻</text>
      </g>
    </g>
  );
}

export default function HexBoard({
  gameState,
  overlayHexes = new Map(),
  onHexClick,
  onUnitClick,
  onTurnLeft,
  onTurnRight,
  onUnitPos,
  onHoverUnit,
  onHoverHex,
  deployFacingOrigin = null,
  explosions = [],
}) {
  const svgRef = useRef(null);
  const { units = [], terrain = {}, objectives = [], selectedUnitId } = gameState;

  const carryingIds = new Set(objectives.map(o => o.carrierId).filter(Boolean));

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Refs so wheel handler (attached imperatively) always reads fresh values
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  zoomRef.current = zoom;
  panRef.current  = pan;

  const dragRef = useRef({ active: false, lastX: 0, lastY: 0, moved: false });

  // Convert a mouse event to SVG viewBox coordinates
  function toSVGCoords(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (SVG_WIDTH  / rect.width),
      y: (e.clientY - rect.top)  * (SVG_HEIGHT / rect.height),
    };
  }

  // Wheel zoom — must be non-passive to call preventDefault
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const { x: cx, y: cy } = toSVGCoords(e);
    const newZoom = Math.min(6, Math.max(0.4, zoomRef.current * factor));
    const ratio   = newZoom / zoomRef.current;
    setPan({ x: cx - ratio * (cx - panRef.current.x), y: cy - ratio * (cy - panRef.current.y) });
    setZoom(newZoom);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Fire the selected unit's SVG-relative pixel position whenever selection or view changes
  const onUnitPosRef = useRef(onUnitPos);
  onUnitPosRef.current = onUnitPos;
  useEffect(() => {
    const cb = onUnitPosRef.current;
    if (!cb) return;
    const unit = units.find(u => u.id === selectedUnitId);
    if (!unit || !svgRef.current) { cb(null); return; }
    const { x: cx, y: cy } = hexToPixel(unit.q, unit.r);
    const rect = svgRef.current.getBoundingClientRect();
    const vx = (cx * zoom + pan.x) * (rect.width  / SVG_WIDTH);
    const vy = (cy * zoom + pan.y) * (rect.height / SVG_HEIGHT);
    const hexScreenW = HEX_SIZE * Math.sqrt(3) * zoom * (rect.width / SVG_WIDTH);
    cb({ x: vx, y: vy, hexScreenW });
  }, [selectedUnitId, zoom, pan, units]);

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.unit-token')) return;
    const { x, y } = toSVGCoords(e);
    dragRef.current = { active: true, lastX: x, lastY: y, moved: false };
    setIsDragging(true);
  }

  function handleMouseMove(e) {
    if (!dragRef.current.active) {
      if (onHoverHex) {
        const { x: sx, y: sy } = toSVGCoords(e);
        const cx = (sx - panRef.current.x) / zoomRef.current;
        const cy = (sy - panRef.current.y) / zoomRef.current;
        const { q, r } = pixelToHex(cx, cy);
        if (inBounds(q, r)) onHoverHex(q, r, e.clientX, e.clientY);
        else onHoverHex(null);
      }
      return;
    }
    const { x, y } = toSVGCoords(e);
    const dx = x - dragRef.current.lastX;
    const dy = y - dragRef.current.lastY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragRef.current.moved = true;
    dragRef.current.lastX = x;
    dragRef.current.lastY = y;
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }

  function handleMouseUp() {
    dragRef.current.active = false;
    setIsDragging(false);
  }

  function handleSvgClick(e) {
    // Swallow the click if the mouse moved during the drag
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    if (!onHexClick) return;
    const { x: sx, y: sy } = toSVGCoords(e);
    // Undo the zoom/pan transform to get content coordinates
    const cx = (sx - pan.x) / zoom;
    const cy = (sy - pan.y) / zoom;
    const { q, r } = pixelToHex(cx, cy);
    if (inBounds(q, r)) onHexClick(q, r);
  }

  // Build all hex cells and a separate elevation-sprite layer (rendered after all
  // base hex content so shadows project onto neighbouring lower hexes correctly)
  const hexCells = [];
  const elevSprites = [];
  const mirroredElevSprites = [];
  const terrainOverlays = [];
  const shadowSprites = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let q = 0; q < BOARD_COLS; q++) {
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      const pts = cornersToPoints(corners);
      const hk = hexKey(q, r);
      const terrainEntry = terrain[hk];
      const overlay = overlayHexes.get(hk);

      const terrainFill = terrainEntry?.type ? (TERRAIN_COLORS[terrainEntry.type] ?? null) : null;

      if (terrainEntry?.type === 'difficult') {
        terrainOverlays.push(
          <image key={`to-${hk}`}
            href={DIFFICULT_VARIANTS[(q * 7 + r * 13) % 3]}
            x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
            width={HEX_IMG_W} height={HEX_IMG_H}
            clipPath={`url(#hc-${hk})`}
            preserveAspectRatio="xMidYMid slice"
            style={{ pointerEvents: 'none' }}
          />
        );
      } else if (terrainEntry?.type === 'cover') {
        terrainOverlays.push(
          <image key={`to-${hk}`}
            href={COVER_VARIANTS[(q * 11 + r * 7) % 2]}
            x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
            width={HEX_IMG_W} height={HEX_IMG_H}
            clipPath={`url(#hc-${hk})`}
            preserveAspectRatio="xMidYMid slice"
            style={{ pointerEvents: 'none', filter: TREE_SHADOW }}
          />
        );
      } else if (terrainEntry?.type === 'blocking') {
        terrainOverlays.push(
          <image key={`to-${hk}`}
            href={BLOCKING_VARIANTS[(q * 5 + r * 11) % 2]}
            x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
            width={HEX_IMG_W} height={HEX_IMG_H}
            clipPath={`url(#hc-${hk})`}
            preserveAspectRatio="xMidYMid slice"
            style={{ pointerEvents: 'none' }}
          />
        );
      } else if (terrainFill) {
        terrainOverlays.push(
          <polygon key={`to-${hk}`} points={pts} fill={terrainFill} stroke="none" style={{ pointerEvents: 'none' }} />
        );
      }

      let overlayFill = 'none';
      let overlayOpacity = 0;
      if (overlay === 'objective-valid') { overlayFill = '#ffd600'; overlayOpacity = 0.30; }
      if (overlay === 'step-forward')    { overlayFill = '#76ff03'; overlayOpacity = 0.38; }
      if (overlay === 'step-back')       { overlayFill = '#ffeb3b'; overlayOpacity = 0.32; }
      if (overlay === 'step-blocked')    { overlayFill = '#ff5722'; overlayOpacity = 0.18; }
      if (overlay === 'reachable')       { overlayFill = '#76ff03'; overlayOpacity = 0.28; }
      if (overlay === 'deploy-valid')    { overlayFill = '#29b6f6'; overlayOpacity = 0.35; }
      if (overlay === 'deploy-invalid')  { overlayFill = '#ef5350'; overlayOpacity = 0.18; }
      if (overlay === 'valid-target')      { overlayFill = '#ff6f00'; overlayOpacity = 0.45; }
      if (overlay === 'indirect-target')   { overlayFill = '#ce93d8'; overlayOpacity = 0.50; }
      if (overlay === 'combat-target')     { overlayFill = '#e53935'; overlayOpacity = 0.35; }
      if (overlay === 'range-ring')        { overlayFill = '#1565c0'; overlayOpacity = 0.20; }
      if (overlay === 'range-ring-indirect') { overlayFill = '#7b1fa2'; overlayOpacity = 0.18; }
      if (overlay === 'ram-target')      { overlayFill = '#f50057'; overlayOpacity = 0.55; }
      if (overlay === 'ram-push-hex')    { overlayFill = '#ce93d8'; overlayOpacity = 0.50; }
      if (overlay === 'deploy-chosen')   { overlayFill = '#29b6f6'; overlayOpacity = 0.70; }
      if (overlay === 'facing-choice')   { overlayFill = '#7b1fa2'; overlayOpacity = 0.45; }

      hexCells.push(
        <g key={hk}>
          {/* ClipPath scoped inside the group so IDs are self-contained */}
          <defs>
            <clipPath id={`hc-${hk}`}>
              <polygon points={pts} />
            </clipPath>
          </defs>
          {/* Grass image clipped exactly to the hex polygon */}
          <image
            href={grassHexImg}
            x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
            width={HEX_IMG_W} height={HEX_IMG_H}
            clipPath={`url(#hc-${hk})`}
            preserveAspectRatio="xMidYMid slice"
            style={{ pointerEvents: 'none', filter: `brightness(${1 + (terrainEntry?.elevation ?? 0) * 0.15})` }}
          />
          {/* Hex border */}
          <polygon points={pts} fill="none" stroke="#333" strokeWidth={0.6} />
          {overlayFill !== 'none' && (
            <polygon points={pts} fill={overlayFill} stroke="none" opacity={overlayOpacity} style={{ pointerEvents: 'none' }} />
          )}
          {/* Elevation label */}
          {terrainEntry?.elevation > 0 && (
            <text x={x} y={y + HEX_SIZE * 0.72} textAnchor="middle" fontSize={8} fill="#1a1a1a"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {terrainEntry.elevation}
            </text>
          )}
          {/* Coord label (tiny, for reference) */}
          <text x={x} y={y - HEX_SIZE * 0.62} textAnchor="middle" fontSize={6} fill="#555"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {q},{r}
          </text>
        </g>
      );

      // Shadow sprites: for each hex check if its W (side 3) or NW (side 2) neighbour
      // is higher — if so, render the matching shadow sprite on this hex.
      const myElev = terrainEntry?.elevation ?? 0;
      [{ side: 3, sprites: SHADOW_W }, { side: 2, sprites: SHADOW_NW }].forEach(({ side, sprites }) => {
        const n = hexNeighborAt(q, r, side);
        const nElev = terrain[hexKey(n.q, n.r)]?.elevation ?? 0;
        const diff = Math.min(3, nElev - myElev);
        if (diff <= 0) return;
        // Stack all levels 1→diff so a taller cliff includes all lower shadow layers
        for (let h = 1; h <= diff; h++) {
          shadowSprites.push(
            <image
              key={`sh-${hk}-${side}-${h}`}
              href={sprites[h]}
              x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
              width={HEX_IMG_W} height={HEX_IMG_H}
              clipPath={`url(#hc-${hk})`}
              preserveAspectRatio="xMidYMid slice"
              style={{ pointerEvents: 'none', filter: 'brightness(0.8) blur(3px)' }}
            />
          );
        }
      });

      // Elevation sprites collected separately so their shadows paint over
      // neighbouring lower hexes rather than being buried under their grass.
      if ((terrainEntry?.elevation ?? 0) > 0) {
        Array.from({ length: terrainEntry.elevation }, (_, i) => i).reverse().forEach(levelIdx => {
          const level = levelIdx + 1;
          ELEVATION_SIDES[levelIdx].forEach((img, side) => {
            const n = hexNeighborAt(q, r, side);
            const neighborElev = terrain[hexKey(n.q, n.r)]?.elevation ?? 0;
            if (neighborElev >= terrainEntry.elevation - levelIdx) return;
            elevSprites.push(
              <image
                key={`es-${hk}-${level}-${side}`}
                href={img}
                x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
                width={HEX_IMG_W} height={HEX_IMG_H}
                clipPath={`url(#hc-${hk})`}
                preserveAspectRatio="xMidYMid slice"
                style={{ pointerEvents: 'none' }}
              />
            );
          });
        });
      }

      // Mirrored elevation sprites: for each face touching a higher hex, render
      // the level-1 cliff sprite reflected along the shared hex face so the
      // base of the cliff is visible from the ground level.
      for (let d = 0; d < 6; d++) {
        const n = hexNeighborAt(q, r, d);
        const nElev = terrain[hexKey(n.q, n.r)]?.elevation ?? 0;
        if (nElev <= myElev) continue;
        const oppSide = (d + 3) % 6;
        mirroredElevSprites.push(
          <image
            key={`me-${hk}-${d}`}
            href={ELEVATION_SIDES[0][oppSide]}
            x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
            width={HEX_IMG_W} height={HEX_IMG_H}
            clipPath={`url(#hc-${hk})`}
            preserveAspectRatio="xMidYMid slice"
            style={{ pointerEvents: 'none' }}
            transform={reflectTransform(d, x, y)}
          />
        );
      }
    }
  }

  return (
    <div className="hex-board-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="hex-board-svg"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onClick={handleSvgClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { handleMouseUp(); onHoverHex?.(null); }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* 1. Grass + borders + labels */}
          {hexCells}

          {/* 2. Elevation side sprites */}
          {elevSprites}

          {/* 2b. Mirrored cliff base on lower hexes touching elevation */}
          {mirroredElevSprites}

          {/* 3. Terrain overlays (cover/difficult) */}
          {terrainOverlays}

          {/* 4. Hill shadows */}
          {shadowSprites}

          {/* Objectives */}
          {objectives.filter(obj => !obj.carrierId).map(obj => <ObjectiveMarker key={`${obj.q},${obj.r}`} obj={obj} />)}

          {/* Units */}
          {units.filter(u => !u.destroyed && !u.surrendered).map(u => (
            <UnitToken
              key={u.id}
              unit={u}
              selected={u.id === selectedUnitId}
              hasObjective={carryingIds.has(u.id)}
              onUnitClick={onUnitClick ?? (() => {})}
              onHoverUnit={onHoverUnit}
            />
          ))}

          {/* Turn overlay — shown on selected unit during step movement */}
          {(() => {
            const { pendingAction } = gameState;
            if (!onTurnLeft || !onTurnRight) return null;
            if (pendingAction?.remainingMoves == null) return null;
            const selUnit = units.find(u => u.id === selectedUnitId && !u.destroyed);
            if (!selUnit) return null;
            return <TurnOverlay unit={selUnit} onTurnLeft={onTurnLeft} onTurnRight={onTurnRight} />;
          })()}

          {/* Deploy facing arrows — shown after player picks a deploy hex */}
          <DeployFacingOverlay deployHex={deployFacingOrigin} />

          {/* Explosion animations — play once on unit destruction */}
          {explosions.map(exp => {
            const { x, y } = hexToPixel(exp.q, exp.r);
            const sz = HEX_SIZE * 2.5;
            return (
              <image
                key={exp.id}
                href={`${explosionGif}?t=${exp.id}`}
                x={x - sz / 2} y={y - sz / 2}
                width={sz} height={sz}
                style={{ pointerEvents: 'none' }}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
