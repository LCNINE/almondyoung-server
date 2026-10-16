export interface LoadSnapshot {
  membershipPending: number;
  staleProcessing: number;
  unmarkedProductPending: number;
  ugcPending: number;
  ugcOldestSeconds: number;
  newUgcFailures: number;
  newChannelFailures: number;
  cpuPercent: number;
}

export function assertHealthy(load: LoadSnapshot): void {
  if (!Object.values(load).every(Number.isFinite)) throw new Error('Load measurements unavailable');
  if (
    load.membershipPending ||
    load.staleProcessing ||
    load.unmarkedProductPending ||
    load.ugcPending > 100 ||
    load.ugcOldestSeconds > 60 ||
    load.newUgcFailures ||
    load.newChannelFailures
  ) {
    throw new Error('Maintenance stopped to protect live traffic');
  }
}

export function pacedDelay(baseMs: number, cpuPercent: number): number {
  if (!Number.isFinite(cpuPercent)) throw new Error('Load measurements unavailable');
  const multiplier = cpuPercent >= 90 ? 2 : cpuPercent >= 70 ? 1.5 : 1;

  // Batch rests stay fixed. Only the per-review and per-product spacing adapts.
  return baseMs === 200 || baseMs === 5000 ? Math.round(baseMs * multiplier) : baseMs;
}
