import { useRef } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, HEX_SIZE,
  hexToPixel, pixelToHex, hexCorners, cornersToPoints,
  facingArrow, hexKey, isDeployZone, inBounds,
  SVG_WIDTH, SVG_HEIGHT, PLAYER_COLORS, PLAYER_LIGHT,
} from '../../game/hexMath';
import { UNIT_TYPES } from '../../data/gameData';

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

function UnitToken({ unit, selected, hasObjective, onUnitClick }) {
  const { x, y } = hexToPixel(unit.q, unit.r);
  const color = PLAYER_COLORS[unit.playerIndex];
  const lightColor = PLAYER_LIGHT[unit.playerIndex];
  const abbrev = TYPE_ABBREV[unit.typeId] ?? '?';
  const arrowPts = facingArrow(x, y, unit.facing);
  const arrowStr = arrowPts.map(p => `${p.x},${p.y}`).join(' ');
  const r = HEX_SIZE * 0.58;

  return (
    <g
      className={`unit-token${unit.activated ? ' unit-token--activated' : ''}${selected ? ' unit-token--selected' : ''}`}
      onClick={e => { e.stopPropagation(); onUnitClick(unit.id); }}
      style={{ cursor: 'pointer' }}
    >
      <circle cx={x} cy={y} r={r} fill={unit.activated ? '#ccc' : lightColor} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
      <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={HEX_SIZE * 0.48} fontWeight="700" fill={unit.activated ? '#888' : color}
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {abbrev}
      </text>
      <polygon points={arrowStr} fill={unit.activated ? '#aaa' : color} opacity={0.85} style={{ pointerEvents: 'none' }} />
      {selected && <circle cx={x} cy={y} r={r + 3} fill="none" stroke="#ffeb3b" strokeWidth={2} strokeDasharray="4 2" />}
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
    const { q, r } = pixelToHex(e.clientX - rect.left, e.clientY - rect.top);
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

      let fillColor = '#2a2a2e';
      if (terrainEntry?.type) fillColor = TERRAIN_COLORS[terrainEntry.type] ?? fillColor;

      let overlayFill = 'none';
      let overlayOpacity = 0;
      if (overlay === 'objective-valid') { overlayFill = '#ffd600'; overlayOpacity = 0.30; }
      if (overlay === 'step-forward')    { overlayFill = '#76ff03'; overlayOpacity = 0.38; }
      if (overlay === 'step-back')       { overlayFill = '#ffeb3b'; overlayOpacity = 0.32; }
      if (overlay === 'step-blocked')    { overlayFill = '#ff5722'; overlayOpacity = 0.18; }
      if (overlay === 'reachable')      { overlayFill = '#76ff03'; overlayOpacity = 0.28; }
      if (overlay === 'deploy-valid')  { overlayFill = '#29b6f6'; overlayOpacity = 0.35; }
      if (overlay === 'deploy-invalid') { overlayFill = '#ef5350'; overlayOpacity = 0.18; }
      if (overlay === 'valid-target')  { overlayFill = '#ff6f00'; overlayOpacity = 0.45; }
      if (overlay === 'combat-target') { overlayFill = '#e53935'; overlayOpacity = 0.35; }
      if (overlay === 'range-ring')    { overlayFill = '#1565c0'; overlayOpacity = 0.20; }

      hexCells.push(
        <g key={hk}>
          <polygon points={pts} fill={fillColor} stroke="#444" strokeWidth={0.8} />
          {overlayFill !== 'none' && (
            <polygon points={pts} fill={overlayFill} stroke="none" opacity={overlayOpacity} style={{ pointerEvents: 'none' }} />
          )}
          {/* Elevation label */}
          {terrainEntry?.elevation > 0 && (
            <text x={x} y={y + HEX_SIZE * 0.72} textAnchor="middle" fontSize={8} fill="#90a4ae"
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
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        className="hex-board-svg"
        onClick={handleSvgClick}
      >
        {/* Hex grid */}
        {hexCells}

        {/* Objectives */}
        {objectives.map((obj, i) => <ObjectiveMarker key={i} obj={obj} />)}

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
