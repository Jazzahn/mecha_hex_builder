import { useGame, isActivePlayer } from '../../store/gameContext';
import { UNIT_TYPES } from '../../data/gameData';
import { PLAY_PHASES } from '../../game/gameReducer';
import { getEquippedWeapons, hasActiveUpgrade } from '../../game/combat';
import { CombatPanelInner } from './CombatPanel';

export default function UnitActionModal({ position, boardWidth, onWeaponHover }) {
  const { gameState, dispatch, localPlayerIndex } = useGame();
  const { selectedUnitId, units, pendingAction, pendingCombat, activePlayer, playerNames, phaseIndex } = gameState;

  const selectedUnit = units.find(u => u.id === selectedUnitId);
  if (!selectedUnit || !position) return null;

  const isMyTurn = isActivePlayer(gameState, localPlayerIndex);

  const MODAL_W = 240;
  const hexW = position.hexScreenW ?? 60;
  const GAP = hexW * 1.5;
  const bw = boardWidth ?? 800;
  const fitsRight = (position.x + GAP + MODAL_W) < bw;

  const style = {
    position: 'absolute',
    left: fitsRight ? position.x + GAP : position.x - GAP - MODAL_W,
    top: Math.max(8, position.y - 40),
    width: MODAL_W,
    zIndex: 10,
  };

  const unitType = UNIT_TYPES[selectedUnit.typeId];
  const hasMoved = !!pendingAction?.moved;

  const hasHighTuned = hasActiveUpgrade(selectedUnit.armyUnit, selectedUnit.slotDamage, 'highTunedEngine');
  const effectiveMoveSP   = (unitType?.move   ?? 0) + (hasHighTuned ? 1 : 0);
  const effectiveCruiseSP = (unitType?.cruise ?? 0) + (hasHighTuned ? 2 : 0);

  const firedKeys = selectedUnit.firedWeaponKeys ?? [];
  const availableWeapons = getEquippedWeapons(selectedUnit.armyUnit, selectedUnit.slotDamage)
    .filter(w => !w.disabled && !firedKeys.includes(w.key));
  const hasFired = firedKeys.length > 0;

  const canInitiateAction = !pendingAction && !pendingCombat && !hasFired;
  const inStepping = pendingAction?.remainingMoves != null;
  const postMove = pendingAction != null && pendingAction.remainingMoves == null;
  const isCruise = pendingAction?.action === 'cruise';
  const canShoot = availableWeapons.length > 0 && !selectedUnit.hasCruised && !pendingCombat;
  const postFire = hasFired && !pendingAction && !pendingCombat;
  const isStructure = ['armedStructure', 'unarmedStructure', 'fortifiedStructure'].includes(selectedUnit.typeId);
  const isVehicle   = ['groundVehicle', 'heavyVehicle'].includes(selectedUnit.typeId);

  return (
    <div className="unit-action-modal" style={style}>
      <div className="unit-action-modal-header">
        <span className="unit-action-modal-name">{selectedUnit.name}</span>
        <button className="unit-action-modal-close" onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>✕</button>
      </div>

      {!isMyTurn && (
        <div className="action-hint">Not your turn</div>
      )}

      {(isMyTurn || pendingCombat?.step === 'ram-push') && pendingCombat && (
        <CombatPanelInner
          pendingCombat={pendingCombat}
          units={units}
          dispatch={dispatch}
          hasMoved={hasMoved}
          onWeaponHover={onWeaponHover}
          localPlayerIndex={localPlayerIndex}
        />
      )}

      {isMyTurn && !pendingCombat && canInitiateAction && (
        <div className="action-buttons">
          <div className="action-buttons-label">Choose action:</div>
          <button className="action-btn action-btn--hold" onClick={() => dispatch({ type: 'START_ACTION', action: 'hold' })}>Hold</button>
          {!isStructure && (
            <>
              <button className="action-btn action-btn--move" onClick={() => dispatch({ type: 'START_ACTION', action: 'move' })}>
                Move ({effectiveMoveSP} SP)
              </button>
              <button className="action-btn action-btn--cruise" onClick={() => dispatch({ type: 'START_ACTION', action: 'cruise' })}>
                Cruise ({effectiveCruiseSP} SP)
              </button>
              {!isVehicle && (
                <button className="action-btn action-btn--ram" onClick={() => dispatch({ type: 'START_ACTION', action: 'ram' })}>
                  Ram ({effectiveCruiseSP} SP)
                </button>
              )}
            </>
          )}
          {canShoot && (
            <button className="action-btn action-btn--shoot" onClick={() => dispatch({ type: 'START_SHOOT' })}>Shoot</button>
          )}
          <button className="action-btn action-btn--cancel" onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>Cancel</button>
        </div>
      )}

      {isMyTurn && !pendingCombat && inStepping && (
        <div className="action-step-move">
          <div className="action-sp-bar">
            <span className="action-sp-label">SP remaining:</span>
            <span className="action-sp-count">{pendingAction.remainingMoves}</span>
          </div>
          {pendingAction.action === 'ram'
            ? <div className="action-move-hint">Move adjacent to an enemy then click the red hex to ram them.</div>
            : <div className="action-move-hint">Use ↺/↻ on the unit to turn. Click highlighted hexes to move.</div>
          }
          {pendingAction.action !== 'ram' && (
            <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_STEP_MOVE' })}>End Move</button>
          )}
          {!pendingAction.moved && (
            <button className="action-btn action-btn--cancel" onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>Cancel</button>
          )}
        </div>
      )}

      {isMyTurn && !pendingCombat && postMove && (
        <div className="action-facing">
          {!isCruise && canShoot && (
            <button className="action-btn action-btn--shoot" onClick={() => dispatch({ type: 'START_SHOOT' })}>Shoot</button>
          )}
          <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_ACTIVATION' })}>End Activation</button>
        </div>
      )}

      {isMyTurn && !pendingCombat && postFire && (
        <div className="action-facing">
          <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_ACTIVATION' })}>End Activation</button>
        </div>
      )}
    </div>
  );
}
