import { useArmy } from '../store/armyStore';
import { useBuilder } from '../store/builderContext';
import { UNIT_TYPES, HEROES, TITLES, ALL_UPGRADES, MECHA_UNIT_IDS, KEYWORDS } from '../data/gameData';
import { calcPoints, calcUnitPoints, buildSlotRows } from '../utils/validation';

function SlotList({ unit, location, label }) {
  const rows = buildSlotRows(unit, location);
  return (
    <td className="print-upgrades-cell">
      <div className="print-cell-header">{label}</div>
      {rows.map((row, i) => {
        if (!row) {
          return <div key={i} className="print-slot-row print-slot-row--empty" />;
        }
        const up = ALL_UPGRADES[row.upgradeId];
        const name = up?.name ?? row.upgradeId;
        const isMulti = row.totalSlots > 1;
        let cls = 'print-slot-row';
        if (isMulti) cls += ' print-slot-row--multi';
        if (row.isFirst) cls += ' print-slot-row--first';
        if (row.isLast)  cls += ' print-slot-row--last';
        return (
          <div key={i} className={cls}>
            <div className="print-slot-main">
              <span className="print-slot-name">{name}</span>
              {row.isFirst && up?.range !== undefined && (
                <span className="print-slot-stats">{up.range}hex · Att {up.att} · Str {up.str}</span>
              )}
            </div>
            {row.isFirst && up?.special?.length > 0 && (
              <div className="print-slot-keywords">
                {up.special.map(kw => (
                  <span key={kw} className="print-keyword">{kw}</span>
                ))}
              </div>
            )}
            {row.isFirst && !up?.special && up?.description && (
              <div className="print-slot-desc">{up.description}</div>
            )}
          </div>
        );
      })}
    </td>
  );
}

function MechaBlock({ unit }) {
  const unitType = UNIT_TYPES[unit.typeId];
  const hero = unit.heroId ? HEROES[unit.heroId] : null;
  const title = unit.titleId ? TITLES[unit.titleId] : null;
  const titleStr = [unit.name, title?.name].filter(Boolean).join(' — ');
  const pts = calcUnitPoints(unit);

  return (
    <table className="print-unit-table">
      <thead>
        <tr>
          <th colSpan={3} className="print-unit-header">
            {titleStr}
            {hero && <span className="print-hero"> [{hero.name}]</span>}
            <span className="print-unit-type"> ({unitType.name})</span>
            <span className="print-unit-pts"> — {pts}pts</span>
          </th>
        </tr>
        <tr className="print-stats-row">
          <td>Spd: {unitType.move}/{unitType.cruise}</td>
          <td>Eva: {unitType.eva}</td>
          <td>Tou: {unitType.tou}</td>
        </tr>
        {unitType.special?.length > 0 && (
          <tr className="print-specials-row">
            <td colSpan={3}>
              {unitType.special.map(s => <span key={s} className="print-keyword print-keyword--innate">{s}</span>)}
            </td>
          </tr>
        )}
      </thead>
      <tbody>
        <tr>
          <SlotList unit={unit} location="torso" label="Torso" />
          <SlotList unit={unit} location="larm" label="L.Arm" />
          <SlotList unit={unit} location="rarm" label="R.Arm" />
        </tr>
      </tbody>
    </table>
  );
}

function VehicleBlock({ unit }) {
  const unitType = UNIT_TYPES[unit.typeId];
  const pts = calcUnitPoints(unit);
  const rows = buildSlotRows(unit, 'single');

  return (
    <table className="print-unit-table print-vehicle-table">
      <thead>
        <tr>
          <th colSpan={3} className="print-unit-header">
            {unit.name}
            <span className="print-unit-type"> ({unitType.name})</span>
            <span className="print-unit-pts"> — {pts}pts</span>
          </th>
        </tr>
        <tr className="print-stats-row">
          {unitType.move !== undefined && <td>Spd: {unitType.move}/{unitType.cruise}</td>}
          <td>Eva: {unitType.eva}</td>
          <td>Tou: {unitType.tou}</td>
        </tr>
        {unitType.special?.length > 0 && (
          <tr className="print-specials-row">
            <td colSpan={3}>
              {unitType.special.map(s => <span key={s} className="print-keyword print-keyword--innate">{s}</span>)}
            </td>
          </tr>
        )}
      </thead>
      <tbody>
        <tr>
          <td colSpan={3} className="print-upgrades-cell">
            <div className="print-cell-header">Upgrades</div>
            {rows.map((row, i) => {
              if (!row) return <div key={i} className="print-slot-row print-slot-row--empty" />;
              const up = ALL_UPGRADES[row.upgradeId];
              const name = up?.name ?? row.upgradeId;
              const isMulti = row.totalSlots > 1;
              let cls = 'print-slot-row';
              if (isMulti) cls += ' print-slot-row--multi';
              if (row.isFirst) cls += ' print-slot-row--first';
              if (row.isLast)  cls += ' print-slot-row--last';
              return (
                <div key={i} className={cls}>
                  <div className="print-slot-main">
                    <span className="print-slot-name">{name}</span>
                    {row.isFirst && up?.range !== undefined && (
                      <span className="print-slot-stats">{up.range}hex · Att {up.att} · Str {up.str}</span>
                    )}
                  </div>
                  {row.isFirst && up?.special?.length > 0 && (
                    <div className="print-slot-keywords">
                      {up.special.map(kw => (
                        <span key={kw} className="print-keyword">{kw}</span>
                      ))}
                    </div>
                  )}
                  {row.isFirst && !up?.special && up?.description && (
                    <div className="print-slot-desc">{up.description}</div>
                  )}
                </div>
              );
            })}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function collectUsedKeywords(army) {
  const used = new Set();
  army.units.forEach(unit => {
    // Innate unit specials (Turret, Armored, etc.)
    UNIT_TYPES[unit.typeId]?.special?.forEach(kw => used.add(kw));
    // Equipped upgrade/weapon specials
    Object.values(unit.slots).flat().forEach(upgradeId => {
      ALL_UPGRADES[upgradeId]?.special?.forEach(kw => used.add(kw));
    });
  });
  return used;
}

export default function PrintView() {
  const { army } = useArmy();
  const { printLegend } = useBuilder();
  const totalPts = calcPoints(army);
  const mechaUnits = army.units.filter(u => MECHA_UNIT_IDS.includes(u.typeId));
  const otherUnits = army.units.filter(u => !MECHA_UNIT_IDS.includes(u.typeId));

  const legendEntries = printLegend
    ? Object.entries(KEYWORDS).filter(([name]) => collectUsedKeywords(army).has(name))
    : [];

  return (
    <div className="print-view">
      <div className="print-header">
        <h1 className="print-army-name">{army.armyName}</h1>
        <div className="print-pts">{totalPts} / {army.pointLimit} pts</div>
      </div>
      <div className="print-section">
        {mechaUnits.map(u => <MechaBlock key={u.id} unit={u} />)}
      </div>
      {otherUnits.length > 0 && (
        <div className="print-section">
          {otherUnits.map(u => <VehicleBlock key={u.id} unit={u} />)}
        </div>
      )}
      {legendEntries.length > 0 && (
        <div className="print-legend">
          <div className="print-legend-title">Special Rules Reference</div>
          <div className="print-legend-grid">
            {legendEntries.map(([name, text]) => (
              <div key={name} className="print-legend-entry">
                <span className="print-legend-name">{name}:</span>
                <span className="print-legend-text">{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
