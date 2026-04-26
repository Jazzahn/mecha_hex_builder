import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Tooltip({ text, children }) {
  const [pos, setPos] = useState(null);
  const timerRef = useRef(null);

  const show = useCallback(e => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        className="keyword-tag"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children}
      </span>
      {pos && createPortal(
        <div
          className="keyword-tooltip"
          style={{ left: pos.left, top: pos.top }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
