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
      <div className="unit-tooltip-slots">
        {slots.map(s => (
          <div key={s.key} className={`unit-tooltip-slot${s.disabled ? ' unit-tooltip-slot--destroyed' : ''}`}>
            <span className="unit-tooltip-slot-name">{s.upgrade.name}</span>
            <div className="unit-tooltip-slot-boxes">
              {Array.from({ length: s.threshold }).map((_, i) => (
                <span key={i} className={`unit-tooltip-box${i < s.dmg ? ' unit-tooltip-box--hit' : ''}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
