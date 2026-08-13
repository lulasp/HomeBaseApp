import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@homebase_fab_corner';

export const FAB_CORNERS = ['bottomRight', 'bottomLeft', 'topRight', 'topLeft'];
const DEFAULT_CORNER = 'bottomRight';

const FabPositionContext = createContext(null);

// Which screen corner the draggable floating add button snaps to. One shared
// choice across every FAB screen, persisted so it survives reloads.
export const FabPositionProvider = ({ children }) => {
  const [corner, setCornerState] = useState(DEFAULT_CORNER);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && FAB_CORNERS.includes(saved)) setCornerState(saved);
    });
  }, []);

  const setCorner = (next) => {
    if (!FAB_CORNERS.includes(next)) return;
    setCornerState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  return (
    <FabPositionContext.Provider value={{ corner, setCorner }}>
      {children}
    </FabPositionContext.Provider>
  );
};

export const useFabPosition = () => useContext(FabPositionContext);
