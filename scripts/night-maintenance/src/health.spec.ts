import { assertHealthy, LoadSnapshot } from './health';

const healthy: LoadSnapshot = {
  membershipPending: 0,
  staleProcessing: 0,
  unmarkedProductPending: 0,
  ugcPending: 0,
  ugcOldestSeconds: 0,
  newUgcFailures: 0,
  newChannelFailures: 0,
  cpuPercent: 20,
};

describe('payment and membership load protection', () => {
  it('accepts a quiet server and stops for each overload signal', () => {
    expect(() => assertHealthy(healthy)).not.toThrow();
    for (const change of [
      { membershipPending: 1 },
      { staleProcessing: 1 },
      { unmarkedProductPending: 1 },
      { ugcPending: 101 },
      { ugcOldestSeconds: 61 },
      { newUgcFailures: 1 },
      { newChannelFailures: 1 },
      { cpuPercent: 71 },
      { cpuPercent: Number.NaN },
    ]) {
      expect(() => assertHealthy({ ...healthy, ...change })).toThrow();
    }
  });
});
