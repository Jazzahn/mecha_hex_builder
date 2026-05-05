import { createContext, useContext, useReducer, useCallback } from 'react';
import { UNIT_TYPES } from '../data/gameData';

let nextId = 1;

function makeUnit(typeId) {
  const unitType = UNIT_TYPES[typeId];
  const slots = unitType.isMecha
    ? { torso: [], larm: [], rarm: [] }
    : { single: [] };
  return {
    id: nextId++,
    typeId,
    name: unitType.name,
    slots,
    heroId: null,
    titleId: null,
    aceCustomSlot: null, // 'torso' | 'larm' | 'rarm' | null
  };
}

const initialState = {
  armyName: 'My Army',
  pointLimit: 200,
  units: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ARMY_NAME':
      return { ...state, armyName: action.name };
    case 'SET_POINT_LIMIT':
      return { ...state, pointLimit: action.limit };
    case 'ADD_UNIT':
      return { ...state, units: [...state.units, makeUnit(action.typeId)] };
    case 'REMOVE_UNIT':
      return { ...state, units: state.units.filter(u => u.id !== action.unitId) };
    case 'SET_UNIT_NAME':
      return updateUnit(state, action.unitId, u => ({ ...u, name: action.name }));
    case 'ADD_UPGRADE': {
      const { unitId, location, upgradeId } = action;
      return updateUnit(state, unitId, u => ({
        ...u,
        slots: {
          ...u.slots,
          [location]: [...(u.slots[location] || []), upgradeId],
        },
      }));
    }
    case 'REMOVE_UPGRADE': {
      const { unitId, location, index } = action;
      return updateUnit(state, unitId, u => ({
        ...u,
        slots: {
          ...u.slots,
          [location]: u.slots[location].filter((_, i) => i !== index),
        },
      }));
    }
    case 'SET_HERO':
      return updateUnit(state, action.unitId, u => ({ ...u, heroId: action.heroId }));
    case 'SET_TITLE':
      return updateUnit(state, action.unitId, u => ({ ...u, titleId: action.titleId }));
    case 'SET_ACE_CUSTOM_SLOT':
      return updateUnit(state, action.unitId, u => ({ ...u, aceCustomSlot: action.slot }));
    case 'LOAD':
      nextId = Math.max(...action.army.units.map(u => u.id), 0) + 1;
      return action.army;
    case 'LOAD_CLAMPED':
      nextId = Math.max(...action.army.units.map(u => u.id), 0) + 1;
      return { ...action.army, pointLimit: action.pointLimit };
    default:
      return state;
  }
}

function updateUnit(state, unitId, fn) {
  return { ...state, units: state.units.map(u => u.id === unitId ? fn(u) : u) };
}

const ArmyContext = createContext(null);

export function ArmyProvider({ children, initialArmy }) {
  const [army, dispatch] = useReducer(reducer, initialArmy ?? initialState);

  const save = useCallback(() => {
    localStorage.setItem('mechaArmy', JSON.stringify(army));
  }, [army]);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem('mechaArmy');
      if (raw) dispatch({ type: 'LOAD', army: JSON.parse(raw) });
    } catch {
      // ignore corrupt data
    }
  }, []);

  return (
    <ArmyContext.Provider value={{ army, dispatch, save, load }}>
      {children}
    </ArmyContext.Provider>
  );
}

export function useArmy() {
  return useContext(ArmyContext);
}
