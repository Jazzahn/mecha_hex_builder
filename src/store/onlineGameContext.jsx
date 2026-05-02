import { createContext, useContext, useEffect, useState } from 'react';
import { GameContext } from './gameContext';
import { socket } from '../socket';

export function OnlineGameProvider({ playerIndex, initialState, children }) {
  const [gameState, setGameState] = useState(initialState ?? null);

  useEffect(() => {
    function onStateUpdate(state) { setGameState(state); }
    socket.on('state-update', onStateUpdate);
    return () => socket.off('state-update', onStateUpdate);
  }, []);

  function dispatch(action) {
    if (!gameState) return;

    const { phase, activePlayer, deployPlayerIndex } = gameState;
    const canAct =
      (phase === 'playing'          && playerIndex === activePlayer) ||
      (phase === 'deploy'           && playerIndex === deployPlayerIndex) ||
      (phase === 'terrain'          && playerIndex === 0) ||
      (phase === 'objective-setup'  && playerIndex === 0) ||
      phase === 'over';

    if (!canAct) return;
    socket.emit('dispatch-action', { action });
  }

  return (
    <GameContext.Provider value={{ gameState, dispatch, localPlayerIndex: playerIndex }}>
      {children}
    </GameContext.Provider>
  );
}
