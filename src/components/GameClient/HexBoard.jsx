import { useRef } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, HEX_SIZE,
  hexToPixel, pixelToHex, hexCorners, cornersToPoints,
  facingArrow, hexKey, hexNeighborAt, isDeployZone, inBounds,
  SVG_WIDTH, SVG_HEIGHT, PLAYER_COLORS, PLAYER_LIGHT,
  FACING_PIXEL_DELTAS,
} from '../../game/hexMath';
import { UNIT_TYPES } from '../../data/gameData';
import grassHexImg from '../../assets/terrain/grass_hex.png';
import heavyMechImg from '../../assets/units/Heavy.png';
import overlayDifficult1 from '../../assets/terrain/overlay_difficult_1.png';
import overlayDifficult2 from '../../assets/terrain/overlay_difficult_2.png';
import overlayDifficult3 from '../../assets/terrain/overlay_difficult_3.png';
import overlayCover1 from '../../assets/terrain/overlay_cover_1.png';
import overlayCover2 from '../../assets/terrain/overlay_cover_2.png';
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

const DIFFICULT_VARIANTS = [overlayDifficult1, overlayDifficult2, overlayDifficult3];
const COVER_VARIANTS = [overlayCover1, overlayCover2];
// Each array ordered E, NE, NW, W, SW, SE — matches facing direction indices 0–5
const ELEVATION_SIDES = [
  [overlayElev1E, overlayElev1NE, overlayElev1NW, overlayElev1W, overlayElev1SW, overlayElev1SE],
  [overlayElev2E, overlayElev2NE, overlayElev2NW, overlayElev2W, overlayElev2SW, overlayElev2SE],
];

// Pointy-top hex image dimensions at HEX_SIZE=24
const HEX_IMG_W = HEX_SIZE * Math.sqrt(3);
const HEX_IMG_H = HEX_SIZE * 2;

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

const UNIT_SPRITES = {
  heavy: heavyMechImg,
};

function UnitToken({ unit, selected, hasObjective, onUnitClick }) {
  const { x, y } = hexToPixel(unit.q, unit.r);
  const color = PLAYER_COLORS[unit.playerIndex];
  const lightColor = PLAYER_LIGHT[unit.playerIndex];
  const abbrev = TYPE_ABBREV[unit.typeId] ?? '?';
  const arrowPts = facingArrow(x, y, unit.facing);
  const arrowStr = arrowPts.map(p => `${p.x},${p.y}`).join(' ');
  const r = HEX_SIZE * 0.58;
  const sprite = UNIT_SPRITES[unit.typeId];
  const spriteSize = HEX_SIZE * 1.5;

  // Sprite images face "down" (+90° from East). Rotate to match current facing.
  const { dx, dy } = FACING_PIXEL_DELTAS[unit.facing];
  const spriteDeg = Math.atan2(dy, dx) * (180 / Math.PI) - 90;

  return (
    <g
      className={`unit-token${unit.activated ? ' unit-token--activated' : ''}${selected ? ' unit-token--selected' : ''}`}
      onClick={e => { e.stopPropagation(); onUnitClick(unit.id); }}
      style={{ cursor: 'pointer' }}
    >
      {/* Player-colour ring */}
      {sprite ? (
        <circle cx={x} cy={y} r={r} fill={unit.activated ? 'rgba(180,180,180,0.25)' : 'rgba(255,255,255,0.08)'} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
      ) : (
        <circle cx={x} cy={y} r={r} fill={unit.activated ? '#ccc' : lightColor} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
      )}
      {/* Selection ring and arrow drawn before the sprite so sprite sits on top */}
      {selected && <circle cx={x} cy={y} r={r + 3} fill="none" stroke="#ffeb3b" strokeWidth={2} strokeDasharray="4 2" />}
      <polygon points={arrowStr} fill={unit.activated ? '#aaa' : color} opacity={0.85} style={{ pointerEvents: 'none' }} />
      {sprite ? (
        <image
          href={sprite}
          x={x - spriteSize / 2} y={y - spriteSize / 2}
          width={spriteSize} height={spriteSize}
          opacity={unit.activated ? 0.45 : 1}
          preserveAspectRatio="xMidYMid meet"
          transform={`rotate(${spriteDeg}, ${x}, ${y})`}
          style={{ pointerEvents: 'none' }}
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

function TurnOverlay({ unit, onTurnLeft, onTurnRight }) {
  // Left turn (CCW) = facing+1, right turn (CW) = facing+5
  const leftFacing  = (unit.facing + 1) % 6;
  const rightFacing = (unit.facing + 5) % 6;
  const leftHex  = { q: unit.q, r: unit.r }; // placeholder; computed via neighbor
  const rightHex = { q: unit.q, r: unit.r };

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
}) {
  const svgRef = useRef(null);
  const { units = [], terrain = {}, objectives = [], selectedUnitId } = gameState;

  const carryingIds = new Set(objectives.map(o => o.carrierId).filter(Boolean));

  function handleSvgClick(e) {
    if (!onHexClick) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Scale from rendered pixels back to viewBox coordinates
    const sx = (e.clientX - rect.left) * (SVG_WIDTH  / rect.width);
    const sy = (e.clientY - rect.top)  * (SVG_HEIGHT / rect.height);
    const { q, r } = pixelToHex(sx, sy);
    if (inBounds(q, r)) onHexClick(q, r);
  }

  // Build all hex cells
  const hexCells = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let q = 0; q < BOARD_COLS; q++) {
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      const pts = cornersToPoints(corners);
      const hk = hexKey(q, r);
      const terrainEntry = terrain[hk];
      const overlay = overlayHexes.get(hk);

      const terrainFill = terrainEntry?.type ? (TERRAIN_COLORS[terrainEntry.type] ?? null) : null;

      let overlayFill = 'none';
      let overlayOpacity = 0;
      if (overlay === 'objective-valid') { overlayFill = '#ffd600'; overlayOpacity = 0.30; }
      if (overlay === 'step-forward')    { overlayFill = '#76ff03'; overlayOpacity = 0.38; }
      if (overlay === 'step-back')       { overlayFill = '#ffeb3b'; overlayOpacity = 0.32; }
      if (overlay === 'step-blocked')    { overlayFill = '#ff5722'; overlayOpacity = 0.18; }
      if (overlay === 'reachable')       { overlayFill = '#76ff03'; overlayOpacity = 0.28; }
      if (overlay === 'deploy-valid')    { overlayFill = '#29b6f6'; overlayOpacity = 0.35; }
      if (overlay === 'deploy-invalid')  { overlayFill = '#ef5350'; overlayOpacity = 0.18; }
      if (overlay === 'valid-target')    { overlayFill = '#ff6f00'; overlayOpacity = 0.45; }
      if (overlay === 'combat-target')   { overlayFill = '#e53935'; overlayOpacity = 0.35; }
      if (overlay === 'range-ring')      { overlayFill = '#1565c0'; overlayOpacity = 0.20; }

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
          {/* Terrain overlays */}
          {terrainEntry?.type === 'difficult' ? (
            <image
              href={DIFFICULT_VARIANTS[(q * 7 + r * 13) % 3]}
              x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
              width={HEX_IMG_W} height={HEX_IMG_H}
              clipPath={`url(#hc-${hk})`}
              preserveAspectRatio="xMidYMid slice"
              style={{ pointerEvents: 'none' }}
            />
          ) : terrainEntry?.type === 'cover' ? (
            <image
              href={COVER_VARIANTS[(q * 11 + r * 7) % 2]}
              x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
              width={HEX_IMG_W} height={HEX_IMG_H}
              clipPath={`url(#hc-${hk})`}
              preserveAspectRatio="xMidYMid slice"
              style={{ pointerEvents: 'none' }}
            />
          ) : terrainFill && (
            <polygon points={pts} fill={terrainFill} stroke="none" style={{ pointerEvents: 'none' }} />
          )}
          {/* Elevation side overlays — one layer per elevation level up to this hex's elevation.
              Each layer only renders on sides where the neighbor drops below that level. */}
          {(terrainEntry?.elevation ?? 0) > 0 && Array.from({ length: terrainEntry.elevation }, (_, i) => i).reverse().map(levelIdx => {
            const level = levelIdx + 1;
            const sideImgs = ELEVATION_SIDES[levelIdx];
            return sideImgs.map((img, side) => {
              const n = hexNeighborAt(q, r, side);
              const neighborElev = terrain[hexKey(n.q, n.r)]?.elevation ?? 0;
              if (neighborElev >= terrainEntry.elevation - levelIdx) return null;
              return (
                <image
                  key={`${level}-${side}`}
                  href={img}
                  x={x - HEX_IMG_W / 2} y={y - HEX_SIZE}
                  width={HEX_IMG_W} height={HEX_IMG_H}
                  clipPath={`url(#hc-${hk})`}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ pointerEvents: 'none' }}
                />
              );
            });
          })}
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
    }
  }

  return (
    <div className="hex-board-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="hex-board-svg"
        onClick={handleSvgClick}
      >
        {/* Hex grid */}
        {hexCells}

        {/* Objectives */}
        {objectives.filter(obj => !obj.carrierId).map((obj, i) => <ObjectiveMarker key={i} obj={obj} />)}

        {/* Units */}
        {units.filter(u => !u.destroyed && !u.surrendered).map(u => (
          <UnitToken
            key={u.id}
            unit={u}
            selected={u.id === selectedUnitId}
            hasObjective={carryingIds.has(u.id)}
            onUnitClick={onUnitClick ?? (() => {})}
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
      </svg>
    </div>
  );
}
