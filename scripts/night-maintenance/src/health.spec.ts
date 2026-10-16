import { assertHealthy, LoadSnapshot, pacedDelay } from './health';

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
  it('allows high overnight CPU and increases spacing instead of aborting', () => {
    expect(() => assertHealthy({ ...healthy, cpuPercent: 95 })).not.toThrow();
    expect(pacedDelay(200, 75)).toBe(300);
    expect(pacedDelay(200, 95)).toBe(400);
    expect(pacedDelay(5000, 75)).toBe(7500);
    expect(pacedDelay(5000, 95)).toBe(10000);
    expect(pacedDelay(300000, 95)).toBe(300000);
    expect(pacedDelay(200, 20)).toBe(200);
  });

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
      { cpuPercent: Number.NaN },
    ]) {
      expect(() => assertHealthy({ ...healthy, ...change })).toThrow();
    }
  });
});
