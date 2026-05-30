import { useState } from 'react';
import leftDoor  from '../assets/ui/Left_Door_Splash.png';
import rightDoor from '../assets/ui/Right_Door_Splash.png';
import logo      from '../assets/ui/Logo_Splash.png';

const ANIM_DURATION = 950; // ms — must match CSS transition total

export default function SplashScreen({ onSelect, onDone, onRules }) {
  const [opening, setOpening] = useState(false);

  function handleSelect(mode) {
    if (opening) return;
    setOpening(true);
    onSelect(mode);                            // render destination page behind immediately
    setTimeout(() => onDone(), ANIM_DURATION); // unmount after doors finish
  }

  return (
    <div className="splash">
      <div className="splash-stage">
        <img
          className={`splash-door splash-door--left${opening ? ' splash-opening' : ''}`}
          src={leftDoor}
          alt=""
          draggable={false}
        />
        <img
          className={`splash-door splash-door--right${opening ? ' splash-opening' : ''}`}
          src={rightDoor}
          alt=""
          draggable={false}
        />
        <div className={`splash-ui${opening ? ' splash-ui--fade' : ''}`}>
          <img className="splash-logo" src={logo} alt="Mecha: HEX" draggable={false} />
          <div className="splash-buttons">
            <button className="splash-btn" onClick={() => handleSelect('vsbot')}>Vs Bots</button>
            <button className="splash-btn" onClick={() => handleSelect('online')}>Multiplayer</button>
            <button className="splash-btn" onClick={() => handleSelect('builder')}>Army Builder</button>
          </div>
          <div className="splash-rules-link">
            <button className="splash-rules-btn" onClick={onRules}>? Rules Reference</button>
          </div>
        </div>
      </div>
    </div>
  );
}
