import { createContext, useContext, useState } from 'react';

const BuilderContext = createContext(null);

export function BuilderProvider({ children }) {
  const [selectedUpgrade, setSelectedUpgrade] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const [printLegend, setPrintLegend] = useState(false);

  return (
    <BuilderContext.Provider value={{ selectedUpgrade, setSelectedUpgrade, activeDragId, setActiveDragId, printLegend, setPrintLegend }}>
      {children}
    </BuilderContext.Provider>
  );
}

export function useBuilder() {
  return useContext(BuilderContext);
}
