import { classifyPattern, MIN_HISTORY_DAYS } from './classification';

const t = { adiThreshold: 1.32, cv2Threshold: 0.49, minDemandEvents: 3 };
const enough = { demandEvents: 50, historyDays: 365 };

describe('classifyPattern — ADI·CV² 사분면', () => {
  it('smooth: ADI ≤ 1.32 · CV² ≤ 0.49', () => {
    expect(classifyPattern({ adi: 1.0, cv2: 0.1, ...enough }, t)).toBe('smooth');
  });
  it('erratic: ADI ≤ 1.32 · CV² > 0.49', () => {
    expect(classifyPattern({ adi: 1.0, cv2: 0.8, ...enough }, t)).toBe('erratic');
  });
  it('intermittent: ADI > 1.32 · CV² ≤ 0.49', () => {
    expect(classifyPattern({ adi: 5, cv2: 0.1, ...enough }, t)).toBe('intermittent');
  });
  it('lumpy: ADI > 1.32 · CV² > 0.49', () => {
    expect(classifyPattern({ adi: 5, cv2: 0.8, ...enough }, t)).toBe('lumpy');
  });

  it('임계 경계 — 같으면 낮은 쪽', () => {
    expect(classifyPattern({ adi: 1.32, cv2: 0.49, ...enough }, t)).toBe('smooth');
    expect(classifyPattern({ adi: 1.33, cv2: 0.49, ...enough }, t)).toBe('intermittent');
    expect(classifyPattern({ adi: 1.32, cv2: 0.5, ...enough }, t)).toBe('erratic');
  });

  it('none: 수요 발생일 0', () => {
    expect(classifyPattern({ adi: null, cv2: null, demandEvents: 0, historyDays: 365 }, t)).toBe('none');
    expect(classifyPattern({ adi: null, cv2: null, demandEvents: 0, historyDays: 0 }, t)).toBe('none');
  });

  it('insufficient: 발생일 < min_demand_events 또는 이력 < 30일', () => {
    expect(classifyPattern({ adi: 100, cv2: null, demandEvents: 2, historyDays: 365 }, t)).toBe('insufficient');
    expect(classifyPattern({ adi: 1, cv2: 0, demandEvents: 19, historyDays: MIN_HISTORY_DAYS - 1 }, t)).toBe('insufficient');
    expect(classifyPattern({ adi: 1, cv2: 0, demandEvents: 30, historyDays: MIN_HISTORY_DAYS }, t)).toBe('smooth');
  });

  it('발생일이 충분한데 cv2 가 null 이면(방어) insufficient', () => {
    expect(classifyPattern({ adi: 1, cv2: null, demandEvents: 3, historyDays: 365 }, t)).toBe('insufficient');
  });
});
