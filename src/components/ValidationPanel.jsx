import { useArmy } from '../store/armyStore';
import { validateArmy } from '../utils/validation';

export default function ValidationPanel() {
  const { army } = useArmy();
  const errors = validateArmy(army);

  if (errors.length === 0) {
    return (
      <div className="validation-panel valid">
        <span className="valid-icon">✓</span> Army is valid
      </div>
    );
  }

  return (
    <div className="validation-panel invalid">
      <div className="validation-title">Rule Violations ({errors.length})</div>
      <ul className="validation-list">
        {errors.map((e, i) => (
          <li key={i} className="validation-error">{e}</li>
        ))}
      </ul>
    </div>
  );
}
