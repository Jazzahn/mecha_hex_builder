import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { WEAPONS, UPGRADES, KEYWORDS, getSlotCost } from '../data/gameData';
import { useBuilder } from '../store/builderContext';
import Tooltip from './Tooltip';

function slotCostLabel(upgrade) {
  if (typeof upgrade.slotCost === 'number') return `${upgrade.slotCost}sl`;
  const vals = Object.values(upgrade.slotCost);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `${min}sl` : `${min}–${max}sl`;
}

function LibraryItem({ upgrade }) {
  const { selectedUpgrade, setSelectedUpgrade } = useBuilder();

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `upgrade::${upgrade.id}`,
    data: { upgradeId: upgrade.id },
  });

  const isSelected = selectedUpgrade === upgrade.id;

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  function handleClick(e) {
    e.stopPropagation();
    setSelectedUpgrade(isSelected ? null : upgrade.id);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`library-item ${isSelected ? 'library-item--selected' : ''}`}
      onClick={handleClick}
      {...listeners}
      {...attributes}
    >
      <div className="library-item-top">
        <span className="library-item-name">{upgrade.name}</span>
        <span className="library-item-cost">{slotCostLabel(upgrade)}</span>
      </div>
      {upgrade.range !== undefined && (
        <div className="library-item-stats">
          {upgrade.range}hex &nbsp;·&nbsp; Att {upgrade.att} &nbsp;·&nbsp; Str {upgrade.str}
        </div>
      )}
      {upgrade.description && (
        <div className="library-item-desc">{upgrade.description}</div>
      )}
      {upgrade.special?.length > 0 && (
        <div className="library-item-keywords">
          {upgrade.special.map(kw =>
            KEYWORDS[kw]
              ? <Tooltip key={kw} text={KEYWORDS[kw]}>{kw}</Tooltip>
              : <span key={kw} className="keyword-tag keyword-tag--unknown">{kw}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function UpgradeLibrary() {
  const [tab, setTab] = useState('weapons');
  const { selectedUpgrade, setSelectedUpgrade } = useBuilder();
  const pool = tab === 'weapons' ? WEAPONS : UPGRADES;

  return (
    <aside className="upgrade-library" onClick={() => selectedUpgrade && setSelectedUpgrade(null)}>
      <div className="library-header">
        <span className="library-title">Library</span>
        {selectedUpgrade && (
          <button className="library-cancel" onClick={() => setSelectedUpgrade(null)}>
            Cancel
          </button>
        )}
      </div>
      {selectedUpgrade && (
        <div className="library-hint">Click a valid zone on any unit to assign</div>
      )}
      <div className="library-tabs">
        <button className={tab === 'weapons' ? 'active' : ''} onClick={e => { e.stopPropagation(); setTab('weapons'); }}>
          Weapons
        </button>
        <button className={tab === 'upgrades' ? 'active' : ''} onClick={e => { e.stopPropagation(); setTab('upgrades'); }}>
          Upgrades
        </button>
      </div>
      <div className="library-list">
        {Object.values(pool).map(upgrade => (
          <LibraryItem key={upgrade.id} upgrade={upgrade} />
        ))}
      </div>
    </aside>
  );
}
