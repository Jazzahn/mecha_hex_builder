import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function DescriptionPicker({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function onMouseDown(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function handleOpen(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 3,
        left: rect.left,
        minWidth: Math.max(rect.width, 260),
      });
    }
    setOpen(o => !o);
  }

  const selected = options.find(o => o.id === value) ?? null;

  return (
    <div className="desc-picker">
      <span className="desc-picker-label">{label}</span>
      <button
        ref={btnRef}
        className={`desc-picker-btn ${open ? 'open' : ''}`}
        onClick={handleOpen}
      >
        <span className="desc-picker-value">
          {selected ? `${selected.name} (${selected.pts}pts)` : '— none —'}
        </span>
        <span className="desc-picker-arrow">{open ? '▴' : '▾'}</span>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="desc-picker-dropdown"
          style={dropdownStyle}
          onClick={e => e.stopPropagation()}
        >
          <div
            className={`desc-picker-option desc-picker-option--none ${!value ? 'desc-picker-option--selected' : ''}`}
            onClick={() => { onChange(null); setOpen(false); }}
          >
            — none —
          </div>
          {options.map(opt => (
            <div
              key={opt.id}
              className={`desc-picker-option ${opt.id === value ? 'desc-picker-option--selected' : ''}`}
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              <div className="desc-picker-option-header">
                <span className="desc-picker-option-name">{opt.name}</span>
                <span className="desc-picker-option-pts">{opt.pts}pts</span>
              </div>
              <p className="desc-picker-option-desc">{opt.description}</p>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
