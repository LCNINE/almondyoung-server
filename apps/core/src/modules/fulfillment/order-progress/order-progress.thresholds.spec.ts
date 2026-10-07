import { ORDER_PROGRESS_STAGES, STUCK_AFTER_MS, isStuck, stuckCutoff } from './order-progress.thresholds';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('order-progress thresholds', () => {
  it('스펙 §6 표의 기준을 그대로 갖는다', () => {
    expect(STUCK_AFTER_MS).toEqual({
      accept: HOUR,
      fo: DAY,
      reserve: 3 * DAY,
      plan: DAY,
      waybill: HOUR,
      pick: 12 * HOUR,
      dispatch: HOUR,
      track: 5 * DAY,
      cancel_request: 5 * 60_000,
      cancel: HOUR,
      return_exchange: 7 * DAY,
      unclassified: 0,
    });
  });

  it('모든 단계에 기준이 있다', () => {
    for (const stage of ORDER_PROGRESS_STAGES) expect(typeof STUCK_AFTER_MS[stage]).toBe('number');
  });

  it('기준을 «넘겨야» 갇힘이다 — 같으면 아니다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('accept', new Date(now.getTime() - HOUR), now)).toBe(false);
    expect(isStuck('accept', new Date(now.getTime() - HOUR - 1), now)).toBe(true);
  });

  it('unclassified 는 들어온 순간부터 갇힘이다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('unclassified', new Date(now.getTime() - 1), now)).toBe(true);
  });

  it('stuckCutoff 는 now − 기준', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(stuckCutoff('fo', now).toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });
});
