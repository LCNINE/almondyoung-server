import { estimateBulkSchedule, isBulkIntervalPassed, isBulkWindow } from './bulk-schedule';

const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('isBulkWindow', () => {
  it('KST 09:00 부터 20:00 전까지만 대량 발송', () => {
    expect(isBulkWindow(kst('2026-09-21T08:59:59'))).toBe(false);
    expect(isBulkWindow(kst('2026-09-21T09:00:00'))).toBe(true);
    expect(isBulkWindow(kst('2026-09-21T19:59:59'))).toBe(true);
    expect(isBulkWindow(kst('2026-09-21T20:00:00'))).toBe(false);
  });
});

describe('isBulkIntervalPassed', () => {
  it('11시간을 한도로 나눈 간격이 지나야 다음 건을 보낸다', () => {
    const device = { dailyLimit: 110, sentToday: 0, lastSentAt: kst('2026-09-21T10:00:00') };
    expect(isBulkIntervalPassed(device, kst('2026-09-21T10:05:59'))).toBe(false);
    expect(isBulkIntervalPassed(device, kst('2026-09-21T10:06:00'))).toBe(true);
    expect(isBulkIntervalPassed({ ...device, lastSentAt: null }, kst('2026-09-21T10:00:01'))).toBe(true);
  });
});

describe('estimateBulkSchedule', () => {
  const phone = { dailyLimit: 100, sentToday: 0, lastSentAt: null };

  it('한도보다 많으면 여러 날에 걸친다', () => {
    const now = kst('2026-09-21T07:00:00');
    expect(estimateBulkSchedule([phone], now, now, 0, 250)).toEqual({
      startDate: '2026-09-21',
      completeDate: '2026-09-23',
    });
  });

  it('앞 대기분이 오늘 한도를 다 쓰면 내일 시작한다', () => {
    const now = kst('2026-09-21T07:00:00');
    expect(estimateBulkSchedule([phone], now, now, 100, 10)).toEqual({
      startDate: '2026-09-22',
      completeDate: '2026-09-22',
    });
  });

  it('20시 이후에 만들면 다음 날 시작하고, 오늘 남은 한도는 이월되지 않는다', () => {
    const now = kst('2026-09-21T20:30:00');
    expect(estimateBulkSchedule([{ ...phone, sentToday: 10 }], now, now, 0, 100)).toEqual({
      startDate: '2026-09-22',
      completeDate: '2026-09-22',
    });
  });

  it('오늘 남은 시간대만큼만 오늘 나간다', () => {
    const now = kst('2026-09-21T18:48:00');
    // 간격 6.6분, 남은 72분 → 11칸
    expect(estimateBulkSchedule([phone], now, now, 0, 11).completeDate).toBe('2026-09-21');
    expect(estimateBulkSchedule([phone], now, now, 0, 12).completeDate).toBe('2026-09-22');
  });

  it('예약이면 예약일부터 센다', () => {
    const now = kst('2026-09-21T10:00:00');
    expect(estimateBulkSchedule([phone], now, kst('2026-09-25T09:00:00'), 0, 10).startDate).toBe('2026-09-25');
  });

  it('보낼 폰이 없으면 알 수 없다', () => {
    const now = kst('2026-09-21T10:00:00');
    expect(estimateBulkSchedule([], now, now, 0, 10)).toEqual({ startDate: null, completeDate: null });
  });
});
