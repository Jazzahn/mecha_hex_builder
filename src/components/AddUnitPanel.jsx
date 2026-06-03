import { useState } from 'react';
import { UNIT_TYPES } from '../data/gameData';
import { MECH_PRESETS } from '../data/mechPresets';
import { useArmy } from '../store/armyStore';

const GROUPS = [
  { label: 'Mecha',      ids: ['assault', 'heavy', 'medium', 'light'] },
  { label: 'Vehicles',   ids: ['heavyVehicle', 'groundVehicle'] },
  { label: 'Structures', ids: ['armedStructure', 'unarmedStructure', 'fortifiedStructure'] },
];

const TYPE_LABEL = { assault: 'ASS', heavy: 'HVY', medium: 'MED', light: 'LGT' };

export default function AddUnitPanel() {
  const { dispatch } = useArmy();
  const [filter, setFilter] = useState('');

  const filtered = MECH_PRESETS.filter(p => {
    const q = filter.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.model.toLowerCase().includes(q);
  });

  return (
    <div className="add-unit-panel">
      <div className="add-unit-title">Add Unit</div>
      <div className="add-unit-groups">
        {GROUPS.map(group => (
          <div key={group.label} className="add-unit-group">
            <div className="group-label">{group.label}</div>
            <div className="group-buttons">
              {group.ids.map(id => {
                const ut = UNIT_TYPES[id];
                return (
                  <button
                    key={id}
                    className={`add-btn add-btn-${id}`}
                    onClick={() => dispatch({ type: 'ADD_UNIT', typeId: id })}
                    title={`${ut.name} — ${ut.pts}pts`}
                  >
                    <span className="add-btn-name">{ut.name}</span>
                    <span className="add-btn-pts">{ut.pts}pts</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="add-unit-group">
          <div className="group-label">Named Mechs</div>
          <input
            className="mech-filter"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className="mech-preset-list">
            {filtered.map(p => (
              <button
                key={p.id}
                className="add-btn mech-preset-btn"
                onClick={() => dispatch({ type: 'ADD_PRESET_UNIT', presetId: p.id })}
                title={`${p.tonnage}t · BV ${p.bv} · ${p.tech}`}
              >
                <span className="add-btn-name">
                  {p.name}{p.model ? ` ${p.model}` : ''}
                </span>
                <span className="preset-tag">{TYPE_LABEL[p.typeId]}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="mech-no-results">No mechs found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
