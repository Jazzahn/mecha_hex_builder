import { useState } from 'react';
import { UNIT_TYPES, HEROES, TITLES } from '../data/gameData';
import { useArmy } from '../store/armyStore';
import { calcUnitPoints } from '../utils/validation';
import LocationZone from './LocationZone';

export default function UnitCard({ unit }) {
  const { army, dispatch } = useArmy();
  const [expanded, setExpanded] = useState(true);
  const unitType = UNIT_TYPES[unit.typeId];
  const pts = calcUnitPoints(unit);
  const isMecha = unitType.isMecha;

  function removeUnit() {
    dispatch({ type: 'REMOVE_UNIT', unitId: unit.id });
  }

  const locationLabels = isMecha
    ? [['torso', 'Torso'], ['larm', 'L.Arm'], ['rarm', 'R.Arm']]
    : [['single', 'Upgrades']];

  return (
    <div className={`unit-card unit-type-${unit.typeId}`}>
      <div className="unit-card-header" onClick={() => setExpanded(e => !e)}>
        <span className="unit-expand-icon">{expanded ? '▾' : '▸'}</span>
        <input
          className="unit-name-input"
          value={unit.name}
          onChange={e => {
            e.stopPropagation();
            dispatch({ type: 'SET_UNIT_NAME', unitId: unit.id, name: e.target.value });
          }}
          onClick={e => e.stopPropagation()}
          placeholder="Unit name"
        />
        <span className="unit-type-badge">{unitType.name}</span>
        <span className="unit-pts">{pts}pts</span>
        <button className="unit-remove" onClick={e => { e.stopPropagation(); removeUnit(); }} title="Remove unit">×</button>
      </div>

      {expanded && (
        <div className="unit-card-body">
          <div className="unit-stats">
            {unitType.move !== undefined && (
              <>
                <div className="stat"><span>Mov</span>{unitType.move}</div>
                <div className="stat"><span>Crs</span>{unitType.cruise}</div>
              </>
            )}
            <div className="stat"><span>Eva</span>{unitType.eva}</div>
            <div className="stat"><span>Tou</span>{unitType.tou}</div>
            {isMecha && (
              <div className="stat"><span>Slots</span>{unitType.totalSlots}</div>
            )}
            {unitType.special?.map(s => (
              <div key={s} className="stat special-tag">{s}</div>
            ))}
          </div>

          {isMecha && (
            <div className="hero-title-row">
              <label>
                Hero:
                <select
                  value={unit.heroId ?? ''}
                  onChange={e => dispatch({ type: 'SET_HERO', unitId: unit.id, heroId: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {Object.values(HEROES).map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.pts}pts)</option>
                  ))}
                </select>
              </label>
              <label>
                Title:
                <select
                  value={unit.titleId ?? ''}
                  onChange={e => dispatch({ type: 'SET_TITLE', unitId: unit.id, titleId: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {Object.values(TITLES).map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.pts}pts)</option>
                  ))}
                </select>
              </label>
              {unit.heroId === 'aceCustom' && (
                <label>
                  Ace Custom Slot:
                  <select
                    value={unit.aceCustomSlot ?? ''}
                    onChange={e => dispatch({ type: 'SET_ACE_CUSTOM_SLOT', unitId: unit.id, slot: e.target.value || null })}
                  >
                    <option value="">— pick location —</option>
                    <option value="torso">Torso</option>
                    <option value="larm">L.Arm</option>
                    <option value="rarm">R.Arm</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="locations-grid" style={{ gridTemplateColumns: `repeat(${locationLabels.length}, 1fr)` }}>
            {locationLabels.map(([loc, label]) => (
              <LocationZone key={loc} unit={unit} location={loc} label={label} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
