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
    load.newChannelFailures ||
    load.cpuPercent > 70
  ) {
    throw new Error('Maintenance stopped to protect live traffic');
  }
}
