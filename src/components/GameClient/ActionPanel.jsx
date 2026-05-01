import { useGame } from '../../store/gameContext';
import { UNIT_TYPES } from '../../data/gameData';
import { PLAY_PHASES } from '../../game/gameReducer';
import { getEquippedWeapons } from '../../game/combat';

export default function ActionPanel() {
  const { gameState, dispatch } = useGame();
  const {
    selectedUnitId, units, pendingAction, pendingCombat,
    activePlayer, playerNames, phaseIndex, round,
  } = gameState;

  const phase = PLAY_PHASES[phaseIndex];
  const selectedUnit = units.find(u => u.id === selectedUnitId);
  const unitType = selectedUnit ? UNIT_TYPES[selectedUnit.typeId] : null;

  const firedKeys = selectedUnit?.firedWeaponKeys ?? [];
  const availableWeapons = selectedUnit
    ? getEquippedWeapons(selectedUnit.armyUnit, selectedUnit.slotDamage)
        .filter(w => !w.disabled && !firedKeys.includes(w.key))
    : [];
  const hasFired = firedKeys.length > 0;

  const canInitiateAction = !pendingAction && !pendingCombat && !hasFired;
  const inStepping = pendingAction?.remainingMoves != null;
  const postMove = pendingAction != null && pendingAction.remainingMoves == null;
  const isCruise = pendingAction?.action === 'cruise';

  const canShoot = availableWeapons.length > 0 && !selectedUnit?.hasCruised && !pendingCombat;
  // After firing at least once with no pending action: show shoot-again / end panel
  const postFire = hasFired && !pendingAction && !pendingCombat;

  const isStructure = selectedUnit && ['armedStructure', 'unarmedStructure', 'fortifiedStructure'].includes(selectedUnit.typeId);

  return (
    <div className="action-panel">
      {/* Status bar */}
      <div className="action-panel-status">
        <div className="status-round">Round {round} / 4</div>
        <div className="status-phase">{phase?.label}</div>
        <div className="status-player" style={{ color: activePlayer === 0 ? '#90caf9' : '#ef9a9a' }}>
          {playerNames[activePlayer]}'s turn
        </div>
      </div>

      {!selectedUnit && (
        <div className="action-hint">
          Click one of {playerNames[activePlayer]}'s unactivated units to select it.
        </div>
      )}

      {selectedUnit && (
        <div className="action-unit-info">
          <div className="action-unit-name">{selectedUnit.name}</div>
          <div className="action-unit-stats">
            {unitType?.move !== undefined && (
              <span>Move {unitType.move} / Cruise {unitType.cruise}</span>
            )}
            <span> · Eva {unitType?.eva}</span>
            <span> · Tou {unitType?.tou}</span>
          </div>
        </div>
      )}

      {/* Initial action choice */}
      {selectedUnit && canInitiateAction && (
        <div className="action-buttons">
          <div className="action-buttons-label">Choose action:</div>
          <button className="action-btn action-btn--hold" onClick={() => dispatch({ type: 'START_ACTION', action: 'hold' })}>
            Hold
          </button>
          {!isStructure && (
            <>
              <button className="action-btn action-btn--move" onClick={() => dispatch({ type: 'START_ACTION', action: 'move' })}>
                Move ({unitType?.move} SP)
              </button>
              <button className="action-btn action-btn--cruise" onClick={() => dispatch({ type: 'START_ACTION', action: 'cruise' })}>
                Cruise ({unitType?.cruise} SP)
              </button>
            </>
          )}
          {canShoot && (
            <button className="action-btn action-btn--shoot" onClick={() => dispatch({ type: 'START_SHOOT' })}>
              Shoot
            </button>
          )}
          <button className="action-btn action-btn--cancel" onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>
            Cancel
          </button>
        </div>
      )}

      {/* Step movement controls */}
      {inStepping && selectedUnit && (
        <div className="action-step-move">
          <div className="action-sp-bar">
            <span className="action-sp-label">SP remaining:</span>
            <span className="action-sp-count">{pendingAction.remainingMoves}</span>
          </div>
          <div className="action-move-hint">Use ↺/↻ on the unit to turn. Click highlighted hexes to move.</div>
          <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_STEP_MOVE' })}>
            End Move
          </button>
          {!pendingAction.moved && (
            <button className="action-btn action-btn--cancel" onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Post-move: optional shoot + end */}
      {postMove && selectedUnit && (
        <div className="action-facing">
          {!isCruise && canShoot && (
            <button className="action-btn action-btn--shoot" onClick={() => dispatch({ type: 'START_SHOOT' })}>
              Shoot
            </button>
          )}
          <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_ACTIVATION' })}>
            End Activation
          </button>
        </div>
      )}

      {/* Fired at least one weapon, not currently moving */}
      {postFire && (
        <div className="action-facing">
          {canShoot && (
            <button className="action-btn action-btn--shoot" onClick={() => dispatch({ type: 'START_SHOOT' })}>
              Fire Next Weapon
            </button>
          )}
          <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_ACTIVATION' })}>
            End Activation
          </button>
        </div>
      )}
    </div>
  );
}
