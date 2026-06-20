import { useGame } from '../../store/gameContext';
import { UNIT_TYPES } from '../../data/gameData';
import { getAllSlots } from '../../game/combat';

export default function UnitTooltip({ unitId, position }) {
  const { gameState } = useGame();
  if (!unitId || !position) return null;

  const unit = gameState.units.find(u => u.id === unitId);
  if (!unit) return null;

  const unitType = UNIT_TYPES[unit.typeId];
  const slots = getAllSlots(unit.armyUnit, unit.slotDamage);
  const isMech = ['light', 'medium', 'heavy', 'assault'].includes(unit.typeId);

  const COLS = [
    { key: 'larm',  label: 'L.Arm' },
    { key: 'torso', label: 'Torso' },
    { key: 'rarm',  label: 'R.Arm' },
  ];
  const otherSlots = slots.filter(s => !['larm', 'torso', 'rarm'].includes(s.location));

  function SlotRow({ s }) {
    return (
      <div className={`unit-tooltip-slot${s.disabled ? ' unit-tooltip-slot--destroyed' : ''}`}>
        <span className="unit-tooltip-slot-name">{s.upgrade.name}</span>
        <div className="unit-tooltip-slot-boxes">
          {Array.from({ length: s.threshold }).map((_, i) => (
            <span key={i} className={`unit-tooltip-box${i < s.dmg ? ' unit-tooltip-box--hit' : ''}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="unit-tooltip"
      style={{ position: 'absolute', left: position.x + 14, top: position.y - 10, zIndex: 20, pointerEvents: 'none' }}
    >
      <div className="unit-tooltip-header">
        <span className="unit-tooltip-name">{unit.name}</span>
        <span className={`unit-tooltip-status unit-tooltip-status--${unit.activated ? 'done' : 'ready'}`}>
          {unit.activated ? 'Activated' : 'Ready'}
        </span>
      </div>
      <div className="unit-tooltip-type">{unitType?.label ?? unit.typeId}</div>
      {isMech ? (
        <div className="unit-tooltip-columns">
          {COLS.map(col => {
            const colSlots = slots.filter(s => s.location === col.key);
            return (
              <div key={col.key} className="unit-tooltip-col">
                <div className="unit-tooltip-col-label">{col.label}</div>
                {colSlots.length === 0
                  ? <div className="unit-tooltip-col-empty">—</div>
                  : colSlots.map(s => <SlotRow key={s.key} s={s} />)
                }
              </div>
            );
          })}
        </div>
      ) : (
        <div className="unit-tooltip-slots">
          {slots.map(s => <SlotRow key={s.key} s={s} />)}
        </div>
      )}
      {isMech && otherSlots.length > 0 && (
        <div className="unit-tooltip-slots unit-tooltip-slots--other">
          {otherSlots.map(s => <SlotRow key={s.key} s={s} />)}
        </div>
      )}
    </div>
  );
}
