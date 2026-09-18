import { DeviceCandidate, pickDevice, startOfKstDay } from './device-picker';

const now = new Date('2026-09-18T03:00:00.000Z');
const device = (overrides: Partial<DeviceCandidate>): DeviceCandidate => ({
  deviceId: 'a',
  enabled: true,
  dailyLimit: 100,
  sentToday: 0,
  lastSeen: now,
  ...overrides,
});

describe('pickDevice', () => {
  it('잔여 한도가 가장 많은 폰을 고른다', () => {
    const picked = pickDevice([device({ deviceId: 'a', sentToday: 90 }), device({ deviceId: 'b', sentToday: 10 })], now);
    expect(picked?.deviceId).toBe('b');
  });

  it('한도 소진·비활성·오프라인 폰은 고르지 않는다', () => {
    const picked = pickDevice(
      [
        device({ deviceId: 'full', sentToday: 100 }),
        device({ deviceId: 'off', enabled: false }),
        device({ deviceId: 'stale', lastSeen: new Date(now.getTime() - 31 * 60 * 1000) }),
        device({ deviceId: 'never', lastSeen: null }),
      ],
      now,
    );
    expect(picked).toBeNull();
  });

  it('지정한 폰이 못 보내면 다른 폰으로 대체하지 않는다', () => {
    const picked = pickDevice([device({ deviceId: 'a', sentToday: 100 }), device({ deviceId: 'b' })], now, 'a');
    expect(picked).toBeNull();
  });
});

describe('startOfKstDay', () => {
  it('KST 자정을 UTC 로 돌려준다', () => {
    expect(startOfKstDay(new Date('2026-09-18T14:59:00.000Z')).toISOString()).toBe('2026-09-17T15:00:00.000Z');
    expect(startOfKstDay(new Date('2026-09-18T15:00:00.000Z')).toISOString()).toBe('2026-09-18T15:00:00.000Z');
  });
});
