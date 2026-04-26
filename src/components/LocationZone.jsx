import { useDroppable } from '@dnd-kit/core';
import { useArmy } from '../store/armyStore';
import { useBuilder } from '../store/builderContext';
import { ALL_UPGRADES, KEYWORDS } from '../data/gameData';
import { slotsUsed, slotsMax, canAddToZone, buildSlotRows } from '../utils/validation';
import Tooltip from './Tooltip';

export default function LocationZone({ unit, location, label }) {
  const { dispatch } = useArmy();
  const { selectedUpgrade, setSelectedUpgrade, activeDragId } = useBuilder();

  const { setNodeRef, isOver } = useDroppable({
    id: `zone::${unit.id}::${location}`,
    data: { unitId: unit.id, location },
  });

  const used = slotsUsed(unit, location);
  const max = slotsMax(unit, location);
  const rows = buildSlotRows(unit, location);

  const dragging = activeDragId !== null;
  const dragCanDrop = dragging && canAddToZone(unit, location, activeDragId);
  const selCanAssign = selectedUpgrade && canAddToZone(unit, location, selectedUpgrade);

  function handleZoneClick() {
    if (selectedUpgrade && selCanAssign) {
      dispatch({ type: 'ADD_UPGRADE', unitId: unit.id, location, upgradeId: selectedUpgrade });
      setSelectedUpgrade(null);
    }
  }

  function handleRemove(e, assignedIndex) {
    e.stopPropagation();
    dispatch({ type: 'REMOVE_UPGRADE', unitId: unit.id, location, index: assignedIndex });
  }

  let zoneClass = 'location-zone';
  if (isOver && dragCanDrop)      zoneClass += ' drop-valid-over';
  else if (isOver && dragging)    zoneClass += ' drop-invalid-over';
  else if (dragging && dragCanDrop)  zoneClass += ' drop-valid';
  else if (dragging && !dragCanDrop) zoneClass += ' drop-invalid';
  if (selectedUpgrade && selCanAssign)  zoneClass += ' sel-valid';
  else if (selectedUpgrade)             zoneClass += ' sel-invalid';

  return (
    <div ref={setNodeRef} className={zoneClass} onClick={handleZoneClick}>
      <div className="zone-header">
        <span className="zone-label">{label}</span>
        <span className={`zone-slots ${used >= max ? 'zone-slots-full' : ''}`}>{used}/{max}</span>
      </div>

      <div className="slot-rows">
        {rows.map((row, i) => {
          if (!row) {
            return (
              <div key={i} className="slot-row slot-row--empty">
                <span className="slot-row-name">—</span>
              </div>
            );
          }

          const up = ALL_UPGRADES[row.upgradeId];
          const isMulti = row.totalSlots > 1;

          let rowClass = 'slot-row slot-row--occupied';
          if (isMulti) rowClass += ' slot-row--multi';
          if (row.isFirst) rowClass += ' slot-row--first';
          if (row.isLast)  rowClass += ' slot-row--last';

          return (
            <div key={i} className={rowClass}>
              <div className="slot-row-main">
                <span className="slot-row-name">{up?.name ?? row.upgradeId}</span>
                {row.isFirst && up?.range !== undefined && (
                  <span className="slot-row-stats">{up.range}hex · Att {up.att} · Str {up.str}</span>
                )}
              </div>
              {row.isFirst && (up?.special?.length > 0 || up?.description) && (
                <div className="slot-row-keywords">
                  {up.special?.map(kw =>
                    KEYWORDS[kw]
                      ? <Tooltip key={kw} text={KEYWORDS[kw]}>{kw}</Tooltip>
                      : <span key={kw} className="keyword-tag keyword-tag--unknown">{kw}</span>
                  )}
                  {!up.special && up.description && (
                    <Tooltip text={up.description}>
                      <span className="keyword-tag">ℹ info</span>
                    </Tooltip>
                  )}
                </div>
              )}
              {row.isFirst && (
                <button
                  className="slot-row-remove"
                  onClick={e => handleRemove(e, row.assignedIndex)}
                  title="Remove"
                >×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
