import { UNIT_TYPES } from '../data/gameData';
import { useArmy } from '../store/armyStore';

const GROUPS = [
  { label: 'Mecha', ids: ['assault', 'heavy', 'medium', 'light'] },
  { label: 'Vehicles', ids: ['heavyVehicle', 'groundVehicle'] },
  { label: 'Structures', ids: ['armedStructure', 'unarmedStructure', 'fortifiedStructure'] },
];

export default function AddUnitPanel() {
  const { dispatch } = useArmy();

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
      </div>
    </div>
  );
}
