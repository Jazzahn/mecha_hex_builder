import { UNIT_TYPES } from '../../data/gameData';
import { parseStatValue, getAllSlots, damagePerHit } from '../../game/combat';

function DieBadge({ value, success }) {
  return (
    <span className={`die-badge${success ? ' die-badge--hit' : ' die-badge--miss'}`}>
      {value}
    </span>
  );
}

function WeaponSelect({ pc, dispatch, onWeaponHover }) {
  return (
    <div className="combat-step">
      <div className="combat-instruction">Select a weapon to fire:</div>
      <div className="combat-weapon-list">
        {pc.weaponList.map((w, i) => (
          <button
            key={i}
            className={`combat-weapon-btn${w.disabled ? ' combat-weapon-btn--disabled' : ''}`}
            onClick={() => !w.disabled && dispatch({ type: 'SELECT_WEAPON', weaponIdx: i })}
            onMouseEnter={() => onWeaponHover?.(w)}
            onMouseLeave={() => onWeaponHover?.(null)}
            disabled={w.disabled}
          >
            <span className="cwb-name">{w.weapon.name}</span>
            <span className="cwb-stats">R{w.weapon.range} · {w.weapon.att}att · S{w.weapon.str}</span>
            {w.weapon.special?.length > 0 && (
              <span className="cwb-special">{w.weapon.special.join(', ')}</span>
            )}
            {w.disabled && <span className="cwb-tag cwb-tag--dead">Destroyed</span>}
          </button>
        ))}
      </div>
      <button className="combat-cancel-btn" onClick={() => dispatch({ type: 'CANCEL_SHOOT' })}>
        Done Shooting
      </button>
    </div>
  );
}

function TargetSelect({ pc, dispatch }) {
  const w = pc.weaponList[pc.selectedWeaponIdx]?.weapon;
  return (
    <div className="combat-step">
      {w && (
        <div className="combat-weapon-summary">
          {w.name} · R{w.range} · {w.att}att · S{w.str}
          {w.special?.length > 0 && <span className="cwb-special"> · {w.special.join(', ')}</span>}
        </div>
      )}
      {pc.validTargets.length === 0 ? (
        <div className="combat-no-targets">No valid targets in range / arc / LOS.</div>
      ) : (
        <div className="combat-instruction">Click an enemy on the board ({pc.validTargets.length} valid).</div>
      )}
      <button className="combat-cancel-btn" onClick={() => dispatch({ type: 'CANCEL_SHOOT' })}>
        Cancel
      </button>
    </div>
  );
}

function HitRoll({ pc, units, dispatch, hasMoved }) {
  const weapon = pc.weaponList[pc.selectedWeaponIdx]?.weapon;
  const target = units.find(u => u.id === pc.targetId);
  const targetType = target ? UNIT_TYPES[target.typeId] : null;
  const evaThreshold = targetType ? parseStatValue(targetType.eva) : 4;

  const isIndirect = weapon?.special?.includes('Indirect');
  const penaltyDie = isIndirect && hasMoved;
  const att = Math.max(1, (weapon?.att ?? 0) - (pc.coverPenalty ?? 0) - (penaltyDie ? 1 : 0));

  const rolled = pc.hitRolls.length > 0;
  const hits = rolled ? pc.hitRolls.filter(v => v >= evaThreshold).length : 0;

  return (
    <div className="combat-step">
      <div className="combat-matchup">
        <span className="combat-attacker-label">{weapon?.name}</span>
        <span className="combat-vs"> → </span>
        <span className="combat-target-label">{target?.name}</span>
      </div>
      <div className="combat-stat-row">
        Roll {att} dice · Hit on {evaThreshold}+
      </div>
      {(pc.coverPenalty > 0 || penaltyDie) && (
        <div className="combat-modifiers">
          {pc.coverPenalty > 0 && <span className="combat-penalty">Cover −{pc.coverPenalty} die</span>}
          {penaltyDie && <span className="combat-penalty">Indirect −1 die</span>}
        </div>
      )}

      {!rolled ? (
        <button className="combat-roll-btn" onClick={() => dispatch({ type: 'ROLL_HIT_DICE' })}>
          Roll to Hit
        </button>
      ) : (
        <>
          <div className="combat-dice-row">
            {pc.hitRolls.map((v, i) => <DieBadge key={i} value={v} success={v >= evaThreshold} />)}
          </div>
          <div className="combat-result">
            <strong>{hits}</strong> hit{hits !== 1 ? 's' : ''} of {pc.hitRolls.length} dice
          </div>
          <button className="combat-roll-btn" onClick={() => dispatch({ type: 'ADVANCE_HIT' })}>
            Continue →
          </button>
        </>
      )}
    </div>
  );
}

function BlockRoll({ pc, units, dispatch }) {
  const target = units.find(u => u.id === pc.targetId);
  const targetType = target ? UNIT_TYPES[target.typeId] : null;
  const tou = targetType ? parseStatValue(targetType.tou) : 4;
  const weapon = pc.weaponList[pc.selectedWeaponIdx]?.weapon;
  const strPenalty = weapon ? parseStatValue(weapon.str) : 0;
  const blockThreshold = tou + strPenalty;
  const dpH = weapon ? damagePerHit(weapon) : 1;

  const rolled = pc.blockRolls.length > 0;
  const blocks = rolled ? pc.blockRolls.filter(v => v === 6 || v >= blockThreshold).length : 0;
  const netHits = pc.hits - blocks;
  const totalDamage = netHits * dpH;

  const thresholdLabel = blockThreshold > 6 ? '6 only' : `${blockThreshold}+`;

  return (
    <div className="combat-step">
      <div className="combat-hit-summary">{pc.hits} hit{pc.hits !== 1 ? 's' : ''} landed</div>
      <div className="combat-stat-row">
        {target?.name} rolls {pc.hits} block dice · Save on {thresholdLabel}
        {strPenalty > 0 && <span className="combat-penalty"> · Str {strPenalty} penalty</span>}
      </div>

      {!rolled ? (
        <button className="combat-roll-btn" onClick={() => dispatch({ type: 'ROLL_BLOCK_DICE' })}>
          Roll Block
        </button>
      ) : (
        <>
          <div className="combat-dice-row">
            {pc.blockRolls.map((v, i) => <DieBadge key={i} value={v} success={v === 6 || v >= blockThreshold} />)}
          </div>
          <div className="combat-result">
            <strong>{blocks}</strong> saved · <strong>{netHits}</strong> hit{netHits !== 1 ? 's' : ''} land
          </div>
          <div className="combat-damage-total">
            {totalDamage} damage ({dpH}/hit
            {weapon?.special?.includes('Deadly') ? ', Deadly' : ''})
            {weapon?.special?.includes('Blast') && pc.blastTargetIds?.length > 0 && (
              <span className="combat-blast-warn"> · Blast!</span>
            )}
          </div>
          <button className="combat-roll-btn" onClick={() => dispatch({ type: 'ADVANCE_BLOCK' })}>
            Continue →
          </button>
        </>
      )}
    </div>
  );
}

function SlotAssign({ unitId, remaining, showExpArmor, pc, units, dispatch }) {
  const unit = units.find(u => u.id === unitId);
  if (!unit) return null;

  const slots = getAllSlots(unit.armyUnit, unit.slotDamage);
  const hasAvailable = slots.some(s => !s.disabled);
  const { lockedUpgradeKey, lastExpArmorSave } = pc;

  return (
    <div className="combat-step">
      <div className="combat-assign-header">
        Assign <strong>{remaining}</strong> damage to {unit.name}
      </div>

      {showExpArmor && lastExpArmorSave && (
        <div className={`combat-exp-armor-save${lastExpArmorSave.saved ? ' combat-exp-armor-save--saved' : ' combat-exp-armor-save--failed'}`}>
          Experimental Armor: rolled {lastExpArmorSave.roll} — {lastExpArmorSave.saved ? '✓ Saved!' : '✗ Failed'}
        </div>
      )}

      {!hasAvailable ? (
        <div className="combat-no-slots">No slots remaining — unit will be destroyed.</div>
      ) : (
        <div className="combat-slot-list">
          {slots.map(s => {
            const isLocked = lockedUpgradeKey === s.key;
            const isBlocked = !s.disabled && lockedUpgradeKey && !isLocked;
            const clickable = !s.disabled && !isBlocked;
            return (
              <button
                key={s.key}
                className={[
                  'combat-slot-btn',
                  s.disabled ? 'combat-slot-btn--disabled' : '',
                  isLocked ? 'combat-slot-btn--locked' : '',
                  isBlocked ? 'combat-slot-btn--blocked' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => clickable && dispatch({ type: 'ASSIGN_DAMAGE', slotKey: s.key })}
                disabled={!clickable}
              >
                <div className="dup-header">
                  <span className="slot-name">{s.upgrade.name}</span>
                  <span className="slot-loc">[{s.location}]</span>
                  {s.disabled && <span className="slot-destroyed-tag">✗ Destroyed</span>}
                  {isLocked && <span className="slot-locked-tag">assign here</span>}
                </div>
                <div className="dup-slots">
                  {Array.from({ length: s.threshold }).map((_, boxIdx) => (
                    <span
                      key={boxIdx}
                      className={`dup-slot${boxIdx < s.dmg ? ' dup-slot--damaged' : ''}`}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RamPush({ pc, units, isChooser }) {
  const pushed  = units.find(u => u.id === pc.pushedUnitId);
  const rammer  = units.find(u => u.id === pc.rammerId);
  const target  = units.find(u => u.id === pc.targetId);
  return (
    <div className="combat-step">
      <div className="combat-matchup">
        <span className="combat-attacker-label">{rammer?.name}</span>
        <span className="combat-vs"> → </span>
        <span className="combat-target-label">{target?.name}</span>
      </div>
      <div className="combat-instruction">
        <strong>{pushed?.name}</strong> must be pushed!
      </div>
      {isChooser
        ? <div className="combat-instruction">Click a purple hex to choose the push direction.</div>
        : <div className="combat-instruction" style={{ color: '#aaa' }}>Waiting for opponent to choose push direction…</div>
      }
    </div>
  );
}

function CombatDone({ pc, units, dispatch }) {
  const target = units.find(u => u.id === pc.targetId);
  const weapon = pc.weaponList[pc.selectedWeaponIdx]?.weapon;
  const blastNames = (pc.blastTargetIds ?? [])
    .map(id => units.find(u => u.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="combat-step">
      {pc.netDamage === 0 ? (
        <div className="combat-done-miss">{weapon?.name} — no damage dealt.</div>
      ) : target?.destroyed ? (
        <div className="combat-done-destroy">{target.name} is <strong>destroyed!</strong></div>
      ) : (
        <div className="combat-done-hit">{weapon?.name} dealt {pc.netDamage} damage to {target?.name}.</div>
      )}
      {blastNames.length > 0 && (
        <div className="combat-blast-note">
          Blast will hit: {blastNames.join(', ')}
        </div>
      )}
      <button className="combat-roll-btn" onClick={() => dispatch({ type: 'FINISH_COMBAT' })}>
        OK
      </button>
    </div>
  );
}

export function CombatPanelInner({ pendingCombat, units, dispatch, hasMoved, onWeaponHover, localPlayerIndex = null }) {
  if (!pendingCombat) return null;
  const isRamStep = pendingCombat.step.startsWith('ram-');
  const actorId   = isRamStep ? pendingCombat.rammerId : pendingCombat.attackerId;
  const actor     = units.find(u => u.id === actorId);
  const isChooser = localPlayerIndex === null || localPlayerIndex === pendingCombat.pushChooserIndex;
  return (
    <div className="combat-panel">
      <div className="combat-panel-header">
        <span className="combat-panel-title">⚔ {actor?.name} {isRamStep ? 'rams!' : 'fires!'}</span>
        <span className="combat-step-indicator">{pendingCombat.step.replace(/-/g, ' ')}</span>
      </div>
      <div className="combat-panel-body">
        {pendingCombat.step === 'weapon-select'   && <WeaponSelect    pc={pendingCombat} dispatch={dispatch} onWeaponHover={onWeaponHover} />}
        {pendingCombat.step === 'target-select'   && <TargetSelect    pc={pendingCombat} dispatch={dispatch} />}
        {pendingCombat.step === 'hit-roll'        && <HitRoll         pc={pendingCombat} units={units} dispatch={dispatch} hasMoved={hasMoved} />}
        {pendingCombat.step === 'block-roll'      && <BlockRoll       pc={pendingCombat} units={units} dispatch={dispatch} />}
        {pendingCombat.step === 'overheat-assign' && (
          <SlotAssign unitId={pendingCombat.attackerId} remaining={pendingCombat.overheatRemaining}
            pc={pendingCombat} units={units} dispatch={dispatch} />
        )}
        {(pendingCombat.step === 'damage-assign' ||
          pendingCombat.step === 'ram-damage-rammer' ||
          pendingCombat.step === 'ram-damage-target') && (
          <SlotAssign
            unitId={pendingCombat.step === 'ram-damage-rammer' ? pendingCombat.rammerId : pendingCombat.targetId}
            remaining={pendingCombat.remainingDamage}
            showExpArmor
            pc={pendingCombat} units={units} dispatch={dispatch} />
        )}
        {pendingCombat.step === 'done'            && <CombatDone      pc={pendingCombat} units={units} dispatch={dispatch} />}
        {pendingCombat.step === 'ram-push'        && <RamPush         pc={pendingCombat} units={units} isChooser={isChooser} />}
      </div>
    </div>
  );
}

export default function CombatPanel({ pendingCombat, units, dispatch, hasMoved, onWeaponHover }) {
  if (!pendingCombat) return null;
  return (
    <div className="combat-overlay">
      <CombatPanelInner pendingCombat={pendingCombat} units={units} dispatch={dispatch} hasMoved={hasMoved} onWeaponHover={onWeaponHover} />
    </div>
  );
}
