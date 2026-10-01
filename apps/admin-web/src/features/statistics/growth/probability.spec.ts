import { formatProbability, goalProbability, seededRandom } from './probability';

describe('goalProbability', () => {
  it('매일 같은 값이면 결과가 결정적이다 — 목표가 착지 이하면 1, 초과면 0', () => {
    const recent = Array(28).fill(10_000);
    const reach = goalProbability({ recentDaily: recent, actualToDate: 100_000, annualTarget: 400_000, remainingDays: 30 })!;
    expect(reach.probability).toBe(1);
    expect(reach.p50).toBe(400_000);
    const miss = goalProbability({ recentDaily: recent, actualToDate: 100_000, annualTarget: 400_001, remainingDays: 30 })!;
    expect(miss.probability).toBe(0);
  });

  it('같은 시드면 같은 확률, 분위수는 오름차순', () => {
    const recent = Array.from({ length: 56 }, (_, i) => 5_000 + ((i * 7919) % 10_000));
    const a = goalProbability({ recentDaily: recent, actualToDate: 0, annualTarget: 900_000, remainingDays: 90 })!;
    const b = goalProbability({ recentDaily: recent, actualToDate: 0, annualTarget: 900_000, remainingDays: 90 })!;
    expect(a).toEqual(b);
    expect(a.probability).toBeGreaterThan(0);
    expect(a.probability).toBeLessThan(1);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
    // 기대 착지 ≈ 평균 × 90 — 중앙값이 그 근처에 있다
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    expect(Math.abs(a.p50 - mean * 90) / (mean * 90)).toBeLessThan(0.05);
  });

  it('블록이 4개(28일) 미만이면 판정하지 않는다', () => {
    expect(goalProbability({ recentDaily: Array(27).fill(1), actualToDate: 0, annualTarget: 1, remainingDays: 10 })).toBeNull();
  });

  it('남은 날이 관측보다 길면 신뢰 낮음', () => {
    const r = goalProbability({ recentDaily: Array(28).fill(1), actualToDate: 0, annualTarget: 1, remainingDays: 100 })!;
    expect(r.lowConfidence).toBe(true);
  });

  it('주 블록을 통째로 쓴다 — 날짜를 하나씩 뽑는 방식과 확률이 갈린다', () => {
    // 블록 합 7·14·21·28 인 4주. 7일 남았고 목표 21 → 블록 방식이면 21·28 두 블록 = 약 50%.
    // 날짜를 하나씩 뽑으면 7일 합의 평균이 17.5 라 21 이상은 약 20% 남짓이다.
    const weeks = [1, 2, 3, 4].flatMap((k) => Array(7).fill(k));
    const r = goalProbability({ recentDaily: weeks, actualToDate: 0, annualTarget: 21, remainingDays: 7, simulations: 2000 })!;
    expect(r.probability).toBeGreaterThan(0.4);
    expect(r.probability).toBeLessThan(0.6);
  });

  it('난수는 [0,1) 이고 시드가 다르면 다른 수열', () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(xs[0]).not.toBe(b());
  });
});

describe('formatProbability', () => {
  it('양 끝은 확실하다고 쓰지 않는다', () => {
    expect(formatProbability(1)).toBe('99% 이상');
    expect(formatProbability(0)).toBe('1% 미만');
    expect(formatProbability(0.234)).toBe('23%');
  });
});
