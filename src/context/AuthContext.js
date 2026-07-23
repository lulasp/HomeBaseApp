import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged, getRedirectResult, updateProfile, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../config/firebase';

const HOUSEHOLD_KEY     = '@homebase_household_id';
const HOUSEHOLD_IDS_KEY = '@homebase_household_ids';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]                 = useState(null);
  const [displayName, setDisplayName]   = useState('');
  const [householdId, setHouseholdId]   = useState(null);
  const [householdIds, setHouseholdIds] = useState([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    // Complete a redirect-based Google sign-in (popup fallback on web).
    if (Platform.OS === 'web') {
      getRedirectResult(auth).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setDisplayName(firebaseUser.displayName || '');
        const hid     = await AsyncStorage.getItem(HOUSEHOLD_KEY);
        const hidsRaw = await AsyncStorage.getItem(HOUSEHOLD_IDS_KEY);
        const hids    = hidsRaw ? JSON.parse(hidsRaw) : (hid ? [hid] : []);
        setHouseholdId(hid || null);
        setHouseholdIds(hids);
      } else {
        setUser(null);
        setDisplayName('');
        setHouseholdId(null);
        setHouseholdIds([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const saveHouseholdId = async (id) => {
    const next = householdIds.includes(id) ? householdIds : [...householdIds, id];
    await AsyncStorage.setItem(HOUSEHOLD_IDS_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
    setHouseholdIds(next);
    setHouseholdId(id);
  };

  const switchHousehold = async (id) => {
    await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
    setHouseholdId(id);
  };

  const removeHousehold = async (id) => {
    const remaining = householdIds.filter((h) => h !== id);
    const newActive = householdId === id ? (remaining[0] ?? null) : householdId;
    await AsyncStorage.setItem(HOUSEHOLD_IDS_KEY, JSON.stringify(remaining));
    await AsyncStorage.setItem(HOUSEHOLD_KEY, newActive ?? '');
    setHouseholdIds(remaining);
    setHouseholdId(newActive);
  };

  const updateDisplayName = async (name) => {
    const trimmed = name.trim();
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: trimmed });
    }
    setDisplayName(trimmed);
  };

  const signOut = async () => {
    await AsyncStorage.multiRemove([HOUSEHOLD_KEY, HOUSEHOLD_IDS_KEY]);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{
      user, displayName, householdId, householdIds, loading,
      saveHouseholdId, switchHousehold, removeHousehold, updateDisplayName, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
