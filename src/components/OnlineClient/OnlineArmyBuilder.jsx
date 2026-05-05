import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { ArmyProvider, useArmy } from '../../store/armyStore';
import { BuilderProvider, useBuilder } from '../../store/builderContext';
import AddUnitPanel from '../AddUnitPanel';
import UnitCard from '../UnitCard';
import ValidationPanel from '../ValidationPanel';
import UpgradeLibrary from '../UpgradeLibrary';
import { ALL_UPGRADES } from '../../data/gameData';
import { calcPoints, canAddToZone } from '../../utils/validation';

const PHASE_ORDER = [
  { label: 'Vehicles',      filter: u => ['groundVehicle', 'heavyVehicle'].includes(u.typeId) },
  { label: 'Light Mecha',   filter: u => u.typeId === 'light' },
  { label: 'Medium Mecha',  filter: u => u.typeId === 'medium' },
  { label: 'Heavy Mecha',   filter: u => u.typeId === 'heavy' },
  { label: 'Assault Mecha', filter: u => u.typeId === 'assault' },
  { label: 'Structures',    filter: u => ['armedStructure', 'unarmedStructure', 'fortifiedStructure'].includes(u.typeId) },
];

const ARMY_KEYS = [
  { key: 'mechaArmy_p1', label: 'P1 save' },
  { key: 'mechaArmy_p2', label: 'P2 save' },
  { key: 'mechaArmy',    label: 'default'  },
];

function tryLoad(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); }
  catch { return null; }
}

// ── Online header ─────────────────────────────────────────────────────────────

function OnlineHeader({ maxPoints, opponentName, opponentReady, isReady, onReady, onUnready }) {
  const { army, dispatch } = useArmy();
  const spent  = calcPoints(army);
  const over   = spent > maxPoints;
  const noUnits = army.units.length === 0;

  const saves = ARMY_KEYS.map(({ key, label }) => {
    const a = tryLoad(key);
    return a ? { key, label, army: a } : null;
  }).filter(Boolean);

  return (
    <header className="army-header online-army-header">
      <div className="army-header-title">
        <input
          className="army-name-input"
          value={army.armyName}
          onChange={e => dispatch({ type: 'SET_ARMY_NAME', name: e.target.value })}
          placeholder="Army Name"
        />
        <span className="game-title">MECHA: HEX — Online Match</span>
      </div>

      <div className="army-header-controls">
        <div className={`pts-tracker${over ? ' over-budget' : ''}`}>
          <span className="pts-spent">{spent}</span>
          <span className="pts-sep">/</span>
          <span className="pts-limit">{maxPoints}</span>
          <span className="pts-unit">pts</span>
        </div>

        {saves.length > 0 && (
          <div className="online-load-group">
            <span className="online-load-label">Load:</span>
            {saves.map(({ key, label, army: a }) => (
              <button
                key={key}
                className="online-load-btn"
                onClick={() => dispatch({ type: 'LOAD_CLAMPED', army: a, pointLimit: maxPoints })}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="online-opponent-status">
          <span className="online-opponent-name">{opponentName}</span>
          <span className={`online-opponent-badge${opponentReady ? ' online-opponent-badge--ready' : ''}`}>
            {opponentReady ? '✓ Ready' : 'Building…'}
          </span>
        </div>

        {isReady ? (
          <button className="online-ready-btn online-ready-btn--cancel" onClick={onUnready}>
            Cancel Ready
          </button>
        ) : (
          <button
            className="online-ready-btn"
            onClick={() => onReady(army)}
            disabled={over || noUnits}
            title={noUnits ? 'Add at least one unit' : over ? 'Army is over the point limit' : ''}
          >
            ✓ Ready
          </button>
        )}
      </div>
    </header>
  );
}

// ── Drag overlay ──────────────────────────────────────────────────────────────

function ActiveDragOverlay() {
  const { activeDragId } = useBuilder();
  if (!activeDragId) return null;
  const upgrade = ALL_UPGRADES[activeDragId];
  if (!upgrade) return null;
  return (
    <div className="drag-preview">
      <div className="library-item-top">
        <span className="library-item-name">{upgrade.name}</span>
      </div>
    </div>
  );
}

// ── Inner (needs context) ─────────────────────────────────────────────────────

function BuilderInner({ maxPoints, opponentName, opponentReady, isReady, onReady, onUnready }) {
  const { army, dispatch } = useArmy();
  const { setActiveDragId } = useBuilder();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd({ active, over }) {
    setActiveDragId(null);
    if (!over) return;
    const upgradeId = active.data.current?.upgradeId;
    const unitId    = over.data.current?.unitId;
    const location  = over.data.current?.location;
    if (!upgradeId || !unitId || !location) return;
    const unit = army.units.find(u => u.id === unitId);
    if (!unit || !canAddToZone(unit, location, upgradeId)) return;
    dispatch({ type: 'ADD_UPGRADE', unitId, location, upgradeId });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveDragId(active.data.current?.upgradeId ?? null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
      <div className="screen-only">
        <OnlineHeader
          maxPoints={maxPoints}
          opponentName={opponentName}
          opponentReady={opponentReady}
          isReady={isReady}
          onReady={onReady}
          onUnready={onUnready}
        />
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
                Add units from the panel on the left, then drag or click weapons and upgrades onto each unit.
              </div>
            )}
          </main>
          <UpgradeLibrary />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        <ActiveDragOverlay />
      </DragOverlay>
    </DndContext>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function OnlineArmyBuilder({ maxPoints, opponentName, opponentReady, isReady, onReady, onUnready }) {
  return (
    <ArmyProvider initialArmy={{ armyName: 'My Army', pointLimit: maxPoints, units: [] }}>
      <BuilderProvider>
        <BuilderInner
          maxPoints={maxPoints}
          opponentName={opponentName}
          opponentReady={opponentReady}
          isReady={isReady}
          onReady={onReady}
          onUnready={onUnready}
        />
      </BuilderProvider>
    </ArmyProvider>
  );
}
