import { createContext, useContext, useEffect, useState } from 'react';
import { GameContext } from './gameContext';
import { gameSocket } from '../lib/gameSocket';

// Returns the playerIndex who controls the current combat step, or null if no combat.
function getCombatStepController(gameState) {
  const pc = gameState.pendingCombat;
  if (!pc) return null;
  const { units } = gameState;
  const attacker = units.find(u => u.id === pc.attackerId);
  const target   = units.find(u => u.id === pc.targetId);
  const rammer   = units.find(u => u.id === pc.rammerId);
  switch (pc.step) {
    case 'block-roll':
    case 'damage-assign':
      return target?.playerIndex ?? null;
    case 'exp-armor-roll':
      return pc.expArmorNextStep === 'ram-damage-rammer' ? (rammer?.playerIndex ?? null) : (target?.playerIndex ?? null);
    case 'overheat-assign':
    case 'overheat-result':
      return attacker?.playerIndex ?? null;
    case 'ram-damage-rammer':
      return rammer?.playerIndex ?? null;
    case 'ram-damage-target':
      return target?.playerIndex ?? null;
    case 'ram-push':
      return pc.pushChooserIndex ?? null;
    default:
      return attacker?.playerIndex ?? (rammer?.playerIndex ?? null);
  }
}

export function OnlineGameProvider({ playerIndex, initialState, onExit = null, children }) {
  const [gameState, setGameState] = useState(initialState ?? null);

  useEffect(() => {
    function onStateUpdate(state) { setGameState(state); }
    function onReconnected({ gameState }) { setGameState(gameState); }
    gameSocket.on('state-update', onStateUpdate);
    gameSocket.on('reconnected',  onReconnected);
    return () => {
      gameSocket.off('state-update', onStateUpdate);
      gameSocket.off('reconnected',  onReconnected);
    };
  }, []);

  function dispatch(action) {
    if (!gameState) return;

    const { phase, activePlayer, deployPlayerIndex } = gameState;
    // Allow dispatch when it's the player's activation turn, OR when they control
    // the current combat step (e.g. defender rolling block / assigning damage).
    const combatController = getCombatStepController(gameState);
    const canAct =
      (phase === 'playing'         && (playerIndex === activePlayer || playerIndex === combatController)) ||
      (phase === 'playing'         && !!gameState.pendingMorale) ||
      (phase === 'deploy'          && playerIndex === deployPlayerIndex) ||
      (phase === 'terrain'         && playerIndex === 0) ||
      (phase === 'objective-setup' && playerIndex === 0) ||
      phase === 'over';

    if (!canAct) return;
    gameSocket.send('dispatch-action', { action });
  }

  return (
    <GameContext.Provider value={{ gameState, dispatch, localPlayerIndex: playerIndex, onExit }}>
      {children}
    </GameContext.Provider>
  );
}
