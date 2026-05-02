import { useEffect, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { ArmyProvider, useArmy } from './store/armyStore';
import { BuilderProvider, useBuilder } from './store/builderContext';
import ArmyHeader from './components/ArmyHeader';
import AddUnitPanel from './components/AddUnitPanel';
import UnitCard from './components/UnitCard';
import ValidationPanel from './components/ValidationPanel';
import UpgradeLibrary from './components/UpgradeLibrary';
import PrintView from './components/PrintView';
import GameClient from './components/GameClient/index.jsx';
import OnlineClient from './components/OnlineClient/index.jsx';
import { ALL_UPGRADES, KEYWORDS, getSlotCost } from './data/gameData';
import { canAddToZone } from './utils/validation';
import Tooltip from './components/Tooltip';
import './App.css';
import './game.css';

const PHASE_ORDER = [
  { label: 'Vehicles', filter: u => ['groundVehicle', 'heavyVehicle'].includes(u.typeId) },
  { label: 'Light Mecha', filter: u => u.typeId === 'light' },
  { label: 'Medium Mecha', filter: u => u.typeId === 'medium' },
  { label: 'Heavy Mecha', filter: u => u.typeId === 'heavy' },
  { label: 'Assault Mecha', filter: u => u.typeId === 'assault' },
  { label: 'Structures', filter: u => ['armedStructure', 'unarmedStructure', 'fortifiedStructure'].includes(u.typeId) },
];

function slotCostLabel(upgrade) {
  if (typeof upgrade.slotCost === 'number') return `${upgrade.slotCost}sl`;
  const vals = Object.values(upgrade.slotCost);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  return mn === mx ? `${mn}sl` : `${mn}–${mx}sl`;
}

function DragPreview({ upgradeId }) {
  const upgrade = ALL_UPGRADES[upgradeId];
  if (!upgrade) return null;
  return (
    <div className="drag-preview">
      <div className="library-item-top">
        <span className="library-item-name">{upgrade.name}</span>
        <span className="library-item-cost">{slotCostLabel(upgrade)}</span>
      </div>
      {upgrade.range !== undefined && (
        <div className="library-item-stats">
          {upgrade.range}hex &nbsp;·&nbsp; Att {upgrade.att} &nbsp;·&nbsp; Str {upgrade.str}
        </div>
      )}
      {upgrade.special?.length > 0 && (
        <div className="library-item-keywords">
          {upgrade.special.map(kw => (
            <span key={kw} className="keyword-tag">{kw}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ArmyBuilderInner({ onPlayClick, onOnlineClick }) {
  const { army, dispatch, load } = useArmy();
  const { setActiveDragId } = useBuilder();

  useEffect(() => { load(); }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart({ active }) {
    const upgradeId = active.data.current?.upgradeId;
    if (upgradeId) setActiveDragId(upgradeId);
  }

  function handleDragEnd({ active, over }) {
    setActiveDragId(null);
    if (!over) return;
    const upgradeId = active.data.current?.upgradeId;
    const unitId = over.data.current?.unitId;
    const location = over.data.current?.location;
    if (!upgradeId || !unitId || !location) return;
    const unit = army.units.find(u => u.id === unitId);
    if (!unit || !canAddToZone(unit, location, upgradeId)) return;
    dispatch({ type: 'ADD_UPGRADE', unitId, location, upgradeId });
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="screen-only">
        <ArmyHeader onPlayClick={onPlayClick} onOnlineClick={onOnlineClick} />
        <div className="main-layout">
          <aside className="sidebar">
            <AddUnitPanel />
            <ValidationPanel />
          </aside>
          <main className="roster">
            {PHASE_ORDER.map(({ label, filter }) => {
              const units = army.units.filter(filter);
              if (units.length === 0) return null;
              return (
                <section key={label} className="phase-section">
                  <div className="phase-label">{label} Phase</div>
                  {units.map(u => <UnitCard key={u.id} unit={u} />)}
                </section>
              );
            })}
            {army.units.length === 0 && (
              <div className="empty-roster">
                Add units from the panel on the left, then drag or click weapons and upgrades from the right panel onto each unit.
              </div>
            )}
          </main>
          <UpgradeLibrary />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {/* rendered by activeDragId via context — read inside DragOverlay */}
        <ActiveDragOverlay />
      </DragOverlay>
      <div className="print-only">
        <PrintView />
      </div>
    </DndContext>
  );
}

function ActiveDragOverlay() {
  const { activeDragId } = useBuilder();
  if (!activeDragId) return null;
  return <DragPreview upgradeId={activeDragId} />;
}

export default function App() {
  const [page, setPage] = useState('builder'); // 'builder' | 'game' | 'online'

  if (page === 'game') {
    return <GameClient onExit={() => setPage('builder')} />;
  }
  if (page === 'online') {
    return <OnlineClient onExit={() => setPage('builder')} />;
  }

  return (
    <ArmyProvider>
      <BuilderProvider>
        <ArmyBuilderInner
          onPlayClick={() => setPage('game')}
          onOnlineClick={() => setPage('online')}
        />
      </BuilderProvider>
    </ArmyProvider>
  );
}
