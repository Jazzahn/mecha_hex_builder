import { createContext, useContext, useReducer } from 'react';
import { gameReducer, buildInitialState } from '../game/gameReducer';

export const GameContext = createContext(null);

export function GameProvider({ playerNames, armies, children }) {
  const [gameState, dispatch] = useReducer(gameReducer, buildInitialState(playerNames, armies));
  return (
    <GameContext.Provider value={{ gameState, dispatch, localPlayerIndex: null }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
