import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { subscribeHouseholdPrivate } from '../services/firestore';

const HouseholdContext = createContext(null);

const hasXiaomiCreds = (c) => !!(c && (c.userId || c.serviceToken || c.ssecurity));

// Live household integration state, sourced from the members-only private doc.
// An absent flag defaults to "on if already configured" so existing setups keep
// working without a migration; an explicit false always wins.
export const HouseholdProvider = ({ children }) => {
  const { householdId } = useAuth();
  const [priv, setPriv] = useState({});

  useEffect(() => {
    if (!householdId) { setPriv({}); return; }
    setPriv({});
    const unsub = subscribeHouseholdPrivate(householdId, setPriv);
    return unsub;
  }, [householdId]);

  const value = useMemo(() => ({
    privateData: priv,
    goveeEnabled:  priv.goveeEnabled  ?? !!priv.goveeApiKey,
    xiaomiEnabled: priv.xiaomiEnabled ?? hasXiaomiCreds(priv.xiaomiCreds),
    reduceMotion:      !!priv.reduceMotion,
    animationsEnabled: !priv.reduceMotion, // absent ⇒ animations on
  }), [priv]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
};

export const useHousehold = () => useContext(HouseholdContext);
