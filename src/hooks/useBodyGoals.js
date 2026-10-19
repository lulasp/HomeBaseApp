import { useEffect, useMemo, useState } from 'react';
import { subscribeBodyProfile, subscribeWeightLogs } from '../services/firestore';
import { sortLogs, latestWeight, calcCalorieTarget } from '../utils/bodyMetrics';

// Live body profile + weight logs for one member, plus the derived calorie target.
export default function useBodyGoals(householdId, uid) {
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = none
  const [rawLogs, setRawLogs] = useState(undefined);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!householdId || !uid) return undefined;
    setError(null);
    const unsubProfile = subscribeBodyProfile(householdId, uid, setProfile, setError);
    const unsubLogs    = subscribeWeightLogs(householdId, uid, setRawLogs, setError);
    return () => { unsubProfile(); unsubLogs(); };
  }, [householdId, uid]);

  const logs          = useMemo(() => sortLogs(rawLogs || []), [rawLogs]);
  const currentWeight = useMemo(() => latestWeight(logs), [logs]);
  const calories      = useMemo(
    () => (profile && currentWeight ? calcCalorieTarget(profile, currentWeight) : null),
    [profile, currentWeight],
  );

  return {
    profile: profile ?? null,
    logs,
    currentWeight,
    calories,
    loading: !error && (profile === undefined || rawLogs === undefined),
    error,
  };
}
