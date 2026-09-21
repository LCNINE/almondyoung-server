import { diffOfflineAlerts, formatElapsed } from './offline-alert';

const now = new Date('2026-09-21T05:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const device = (id: string, lastSeenMinutesAgo: number | null, alerted: boolean, enabled = true) => ({
  id,
  name: id,
  enabled,
  lastSeen: lastSeenMinutesAgo === null ? null : minutesAgo(lastSeenMinutesAgo),
  offlineAlertedAt: alerted ? minutesAgo(10) : null,
});

describe('diffOfflineAlerts', () => {
  it('꺼질 때 한 번, 켜질 때 한 번만 알린다', () => {
    const result = diffOfflineAlerts(
      [
        device('went-offline', 40, false),
        device('still-offline', 60, true),
        device('recovered', 1, true),
        device('still-online', 1, false),
        device('never-seen', null, false),
        device('disabled', 90, false, false),
      ],
      now,
    );
    expect(result.wentOffline.map((d) => d.id)).toEqual(['went-offline', 'never-seen']);
    expect(result.recovered.map((d) => d.id)).toEqual(['recovered']);
  });
});

describe('formatElapsed', () => {
  it('1시간 미만은 분, 이상은 시간으로 적는다', () => {
    expect(formatElapsed(minutesAgo(42), now)).toBe('42분째 연결 없음');
    expect(formatElapsed(minutesAgo(130), now)).toBe('2시간째 연결 없음');
  });
});
