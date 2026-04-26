import { useState } from 'react';
import { ALL_UPGRADES, UPGRADES, WEAPONS, KEYWORDS, getSlotCost } from '../data/gameData';
import { useArmy } from '../store/armyStore';
import { slotsUsed, slotsMax } from '../utils/validation';
import Tooltip from './Tooltip';

export default function UpgradeSelector({ unit, location }) {
  const { dispatch } = useArmy();
  const [tab, setTab] = useState('weapons');

  const used = slotsUsed(unit, location);
  const max = slotsMax(unit, location);
  const remaining = max - used;

  const assigned = unit.slots[location] || [];

  function canAdd(upgradeId) {
    const upgrade = ALL_UPGRADES[upgradeId];
    if (!upgrade) return false;
    const cost = getSlotCost(upgradeId, unit.typeId);
    if (cost > remaining) return false;
    const allAssigned = Object.values(unit.slots).flat();
    const count = allAssigned.filter(id => id === upgradeId).length;
    if (upgrade.isWeapon && count >= 2) return false;
    if (!upgrade.isWeapon && count >= 1) return false;
    return true;
  }

  function handleAdd(upgradeId) {
    if (!canAdd(upgradeId)) return;
    dispatch({ type: 'ADD_UPGRADE', unitId: unit.id, location, upgradeId });
  }

  function handleRemove(index) {
    dispatch({ type: 'REMOVE_UPGRADE', unitId: unit.id, location, index });
  }

  const pool = tab === 'weapons' ? WEAPONS : UPGRADES;

  return (
    <div className="upgrade-selector">
      <div className="slot-bar">
        <span className="slot-label">Slots: </span>
        <span className={`slot-count ${remaining === 0 ? 'full' : ''}`}>{used}/{max}</span>
      </div>

      <div className="assigned-list">
        {assigned.map((id, i) => {
          const up = ALL_UPGRADES[id];
          return (
            <div key={i} className="assigned-chip">
              <span className="chip-name">{up?.name ?? id}</span>
              <span className="chip-cost">({getSlotCost(id, unit.typeId)})</span>
              <button className="chip-remove" onClick={() => handleRemove(i)} title="Remove">×</button>
            </div>
          );
        })}
        {assigned.length === 0 && <span className="empty-slot">— empty —</span>}
      </div>

      <div className="upgrade-tabs">
        <button className={tab === 'weapons' ? 'active' : ''} onClick={() => setTab('weapons')}>Weapons</button>
        <button className={tab === 'upgrades' ? 'active' : ''} onClick={() => setTab('upgrades')}>Upgrades</button>
      </div>

      <div className="upgrade-pool">
        {Object.values(pool).map(upgrade => {
          const cost = getSlotCost(upgrade.id, unit.typeId);
          const addable = canAdd(upgrade.id);
          return (
            <div key={upgrade.id} className={`upgrade-option ${addable ? '' : 'disabled'}`}>
              <button
                className="opt-add-btn"
                onClick={() => handleAdd(upgrade.id)}
                disabled={!addable}
              >
                <span className="opt-name">{upgrade.name}</span>
                {upgrade.range !== undefined && (
                  <span className="opt-stats">{upgrade.range}hex Att{upgrade.att} Str{upgrade.str}</span>
                )}
                <span className="opt-cost">{cost}sl</span>
              </button>
              {(upgrade.special?.length > 0 || upgrade.description) && (
                <div className="opt-keywords">
                  {upgrade.special?.map(kw => (
                    KEYWORDS[kw]
                      ? <Tooltip key={kw} text={KEYWORDS[kw]}>{kw}</Tooltip>
                      : <span key={kw} className="keyword-tag keyword-tag--unknown">{kw}</span>
                  ))}
                  {!upgrade.special && upgrade.description && (
                    <Tooltip text={upgrade.description}>Info</Tooltip>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
