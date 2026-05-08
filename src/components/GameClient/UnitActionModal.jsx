import { useRef, useState, useEffect } from 'react';
import { useGame, isActivePlayer } from '../../store/gameContext';
import { UNIT_TYPES } from '../../data/gameData';
import { PLAY_PHASES } from '../../game/gameReducer';
import { getEquippedWeapons, hasActiveUpgrade } from '../../game/combat';
import { CombatPanelInner } from './CombatPanel';

export default function UnitActionModal({ position, boardWidth, onWeaponHover }) {
  const { gameState, dispatch, localPlayerIndex } = useGame();
  const { selectedUnitId, units, pendingAction, pendingCombat, activePlayer, playerNames, phaseIndex } = gameState;

  const selectedUnit = units.find(u => u.id === selectedUnitId);

  // Drag state for fix 5
  const [dragPos, setDragPos] = useState(null);
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 });

  // Reset drag position when the selected unit changes
  useEffect(() => { setDragPos(null); }, [selectedUnitId]);

  if (!selectedUnit || !position) return null;

  const isMyTurn = isActivePlayer(gameState, localPlayerIndex);

  // Determine if local player controls the current combat step
  const combatAttacker = units.find(u => u.id === pendingCombat?.attackerId);
  const combatTarget   = units.find(u => u.id === pendingCombat?.targetId);
  const combatRammer   = units.find(u => u.id === pendingCombat?.rammerId);
  const combatStepController = (() => {
    if (!pendingCombat) return null;
    switch (pendingCombat.step) {
      case 'block-roll': case 'damage-assign': return combatTarget?.playerIndex ?? 0;
      case 'exp-armor-roll':
        return pendingCombat.expArmorNextStep === 'ram-damage-rammer' ? (combatRammer?.playerIndex ?? 0) : (combatTarget?.playerIndex ?? 0);
      case 'overheat-assign': case 'overheat-result': return combatAttacker?.playerIndex ?? 0;
      case 'ram-damage-rammer': return combatRammer?.playerIndex ?? 0;
      case 'ram-damage-target': return combatTarget?.playerIndex ?? 0;
      case 'ram-push': return pendingCombat.pushChooserIndex ?? 0;
      default: return combatAttacker?.playerIndex ?? (combatRammer?.playerIndex ?? 0);
    }
  })();
  const isCombatController = localPlayerIndex === null || combatStepController === null || localPlayerIndex === combatStepController;

  const MODAL_W = 240;
  const hexW = position.hexScreenW ?? 60;
  const GAP = hexW * 1.5;
  const bw = boardWidth ?? 800;
  const fitsRight = (position.x + GAP + MODAL_W) < bw;

  const computedLeft = fitsRight ? position.x + GAP : position.x - GAP - MODAL_W;
  const computedTop  = Math.max(8, position.y - 40);

  const style = {
    position: 'absolute',
    left:  dragPos ? dragPos.left  : computedLeft,
    top:   dragPos ? dragPos.top   : computedTop,
    width: MODAL_W,
    zIndex: 10,
  };

  function handleHeaderMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const origLeft = dragPos ? dragPos.left : computedLeft;
    const origTop  = dragPos ? dragPos.top  : computedTop;
    dragStateRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origLeft, origTop };

    function onMove(ev) {
      if (!dragStateRef.current.dragging) return;
      setDragPos({
        left: dragStateRef.current.origLeft + ev.clientX - dragStateRef.current.startX,
        top:  dragStateRef.current.origTop  + ev.clientY - dragStateRef.current.startY,
      });
    }
    function onUp() {
      dragStateRef.current.dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const unitType = UNIT_TYPES[selectedUnit.typeId];
  const hasMoved = !!pendingAction?.moved;

  const hasHighTuned = hasActiveUpgrade(selectedUnit.armyUnit, selectedUnit.slotDamage, 'highTunedEngine');
  const effectiveMoveSP   = (unitType?.move   ?? 0) + (hasHighTuned ? 1 : 0);
  const effectiveCruiseSP = (unitType?.cruise ?? 0) + (hasHighTuned ? 2 : 0);

  const firedKeys = selectedUnit.firedWeaponKeys ?? [];
  const availableWeapons = getEquippedWeapons(selectedUnit.armyUnit, selectedUnit.slotDamage)
    .filter(w => !w.disabled && !firedKeys.includes(w.key));
  const hasFired = firedKeys.length > 0;

  const hasBoostJets = hasActiveUpgrade(selectedUnit.armyUnit, selectedUnit.slotDamage, 'boostJets');
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
      <div className="unit-action-modal-header" onMouseDown={handleHeaderMouseDown} style={{ cursor: 'grab' }}>
        <span className="unit-action-modal-name">{selectedUnit.name}</span>
        <button className="unit-action-modal-close" onMouseDown={e => e.stopPropagation()} onClick={() => dispatch({ type: 'DESELECT_UNIT' })}>✕</button>
      </div>

      {!isMyTurn && !pendingCombat && (
        <div className="action-hint">Not your turn</div>
      )}

      {pendingCombat && (isCombatController || isMyTurn) && (
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
              {hasBoostJets && (
                <button className="action-btn action-btn--jump" onClick={() => dispatch({ type: 'START_ACTION', action: 'move', isJumping: true })}>
                  Jump ({effectiveMoveSP} SP)
                </button>
              )}
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
            : pendingAction.isJumping
              ? <div className="action-move-hint">Jumping — terrain and units ignored. Turn freely. Click hexes to fly.</div>
              : <div className="action-move-hint">Use ↺/↻ on the unit to turn. Click highlighted hexes to move.</div>
          }
          {pendingAction.action !== 'ram' && (
            <button className="action-btn action-btn--end" onClick={() => dispatch({ type: 'END_STEP_MOVE' })}>
              {pendingAction.isJumping ? 'Land' : 'End Move'}
            </button>
          )}
          <button className="action-btn action-btn--cancel" onClick={() => dispatch({ type: 'CANCEL_MOVE' })}>Cancel Move</button>
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
