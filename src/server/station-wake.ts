/**
 * Probuzení čekající tiskové stanice (dlouhý dotaz v src/server/station.ts) po zařazení úlohy.
 * Bez dalších importů — volá se i z obsluh modulů (zkušební stránka). Úloha se zakládá v transakci,
 * proto se stanice budí s malým zpožděním (po potvrzení transakce); nestihne-li to, vyzvedne ji dalším dotazem.
 */
const waiters = new Map<string, Set<() => void>>();

export function onStationWake(deviceId: string, fn: () => void): () => void {
  const set = waiters.get(deviceId) ?? new Set();
  set.add(fn);
  waiters.set(deviceId, set);
  return () => {
    set.delete(fn);
    if (!set.size) waiters.delete(deviceId);
  };
}

export function wakeStation(deviceId: string, delayMs = 300) {
  setTimeout(() => {
    for (const fn of [...(waiters.get(deviceId) ?? [])]) fn();
  }, delayMs);
}
