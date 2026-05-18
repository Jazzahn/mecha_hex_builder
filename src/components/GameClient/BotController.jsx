import { useEffect, useRef } from 'react';
import { useGame } from '../../store/gameContext';
import { aiStep } from '../../game/ai';

const BOT_DELAY_MS = 350;

export default function BotController({ botPlayerIndex }) {
  const { gameState, dispatch } = useGame();
  const timerRef = useRef(null);

  useEffect(() => {
    if (gameState.phase === 'over') return;

    const nextState = aiStep(gameState, botPlayerIndex);
    if (!nextState) return;

    timerRef.current = setTimeout(() => {
      dispatch({ type: 'APPLY_BOT_STEP', nextState });
    }, BOT_DELAY_MS);

    return () => clearTimeout(timerRef.current);
  });

  return null;
}
