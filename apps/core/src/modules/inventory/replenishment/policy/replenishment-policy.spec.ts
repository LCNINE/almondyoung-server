import { composeLeadTime, computePolicy, PolicyInput } from './replenishment-policy';
import { normalQuantile } from './distributions';

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    pattern: 'smooth',
    dailyMean: 10,
    dailyStd: 3,
    dailyMean90: 10,
    leadTime: { meanDays: 20, stdDays: 5 },
    alpha: 0.05,
    coverDays: 30,
    overrideSafetyStock: null,
    ...overrides,
  };
}

describe('composeLeadTime', () => {
  it('μ 는 합 + 버퍼, σ 는 제곱합의 제곱근', () => {
    expect(
      composeLeadTime(
        [
          { meanDays: 10, stdDays: 2 },
          { meanDays: 5, stdDays: 1 },
        ],
        7,
      ),
    ).toEqual({
      meanDays: 22,
      stdDays: Math.sqrt(5),
    });
    expect(composeLeadTime([{ meanDays: 10, stdDays: 2 }], 0)).toEqual({ meanDays: 10, stdDays: 2 });
  });
});

describe('computePolicy — smooth (정규)', () => {
  it('5변수 공식과 수치가 같다 — μ_LTD 200 · σ_LTD √2680 · z(0.95)', () => {
    const out = computePolicy(input());
    const sigma = Math.sqrt(20 * 9 + 100 * 25);
    const ss = normalQuantile(0.95) * sigma;
    expect(out.distribution).toBe('normal');
    expect(out.safetyStock).toBeCloseTo(ss, 1); // 85.15
    expect(out.reorderPoint).toBeCloseTo(200 + ss, 1); // 285.15
    expect(out.targetLevel).toBeCloseTo(10 * 50 + ss, 1); // 585.15
    expect(out.leadTimeDays).toBe(20);
    expect(out.confidence).toBe('normal');
    expect(out.legacyReorderPoint).toBe(200);
  });
  it('σ_LTD = 0 이면 ROP = μ_LTD, SS = 0', () => {
    const out = computePolicy(input({ dailyStd: 0, leadTime: { meanDays: 20, stdDays: 0 } }));
    expect(out).toMatchObject({ safetyStock: 0, reorderPoint: 200, targetLevel: 500 });
  });
  it('α 가 작을수록 SS 가 크다', () => {
    expect(computePolicy(input({ alpha: 0.02 })).safetyStock).toBeGreaterThan(
      computePolicy(input({ alpha: 0.1 })).safetyStock,
    );
  });
  // R1(ii): 리드타임이 0(경로 리드타임이 아직 설정되지 않은 SKU, 스펙 §5.1)이어도 수요가
  // 있으면 μ_LTD = dailyMean·0 = 0 이지만 목표수준 S = μ_D·(0 + cover) + SS 는 0 이 아니다.
  // 조기 반환을 muLtd 대신 dailyMean 으로 판정해야 이 경우 S 가 정상적으로 계산된다.
  it('리드타임 0 · 수요 있음 — SS=ROP=0 이지만 S 는 커버일수만큼 남는다', () => {
    const out = computePolicy(input({ leadTime: { meanDays: 0, stdDays: 0 } }));
    expect(out.safetyStock).toBe(0);
    expect(out.reorderPoint).toBe(0);
    expect(out.targetLevel).toBe(10 * 30); // dailyMean(10) × coverDays(30) = 300
  });
});

describe('computePolicy — 감마 패턴', () => {
  it('erratic 은 감마이고 같은 μ·σ 에서 정규보다 SS 가 크다(오른쪽 꼬리)', () => {
    const gamma = computePolicy(input({ pattern: 'erratic', dailyStd: 12 }));
    const normal = computePolicy(input({ pattern: 'smooth', dailyStd: 12 }));
    expect(gamma.distribution).toBe('gamma');
    expect(gamma.safetyStock).toBeGreaterThan(normal.safetyStock);
    expect(gamma.reorderPoint).toBeCloseTo(gamma.safetyStock + 200, 6);
  });
  it('CV → 0 이면 감마가 정규로 수렴한다', () => {
    const gamma = computePolicy(
      input({ pattern: 'lumpy', dailyMean: 100, dailyStd: 1, leadTime: { meanDays: 1, stdDays: 0 } }),
    );
    const normal = computePolicy(
      input({ pattern: 'smooth', dailyMean: 100, dailyStd: 1, leadTime: { meanDays: 1, stdDays: 0 } }),
    );
    expect(gamma.reorderPoint).toBeCloseTo(normal.reorderPoint, 1);
  });
  it('intermittent · lumpy 도 감마', () => {
    expect(computePolicy(input({ pattern: 'intermittent' })).distribution).toBe('gamma');
    expect(computePolicy(input({ pattern: 'lumpy' })).distribution).toBe('gamma');
  });
  it('μ_LTD = 0 (수요 0) 이면 감마 패턴이어도 전부 0', () => {
    expect(computePolicy(input({ pattern: 'lumpy', dailyMean: 0, dailyStd: 0 }))).toMatchObject({
      safetyStock: 0,
      reorderPoint: 0,
      targetLevel: 0,
    });
  });
});

describe('computePolicy — insufficient · none · 오버라이드', () => {
  it('insufficient 는 정규로 계산하되 confidence low', () => {
    const out = computePolicy(input({ pattern: 'insufficient' }));
    expect(out.distribution).toBe('normal');
    expect(out.confidence).toBe('low');
    expect(out.safetyStock).toBeGreaterThan(0);
  });
  it('none 은 SS = ROP = S = 0, 분포 none, 레거시 값도 0', () => {
    expect(computePolicy(input({ pattern: 'none', dailyMean: 0, dailyStd: 0, dailyMean90: 0 }))).toEqual({
      safetyStock: 0,
      reorderPoint: 0,
      targetLevel: 0,
      leadTimeDays: 20,
      distribution: 'none',
      confidence: 'normal',
      legacyReorderPoint: 0,
    });
  });
  it('오버라이드 SS 는 계산을 대체한다 — ROP = μ_LTD + SS, S = μ_D(μ_L + cover) + SS', () => {
    const out = computePolicy(input({ overrideSafetyStock: 40 }));
    expect(out).toMatchObject({ safetyStock: 40, reorderPoint: 240, targetLevel: 540, distribution: 'none' });
  });
  it('오버라이드는 none 패턴에도 적용된다 (사람이 준 숫자)', () => {
    const out = computePolicy(
      input({ pattern: 'none', dailyMean: 0, dailyStd: 0, dailyMean90: 0, overrideSafetyStock: 100 }),
    );
    expect(out).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100 });
  });
  it('레거시 재주문점은 μ_D(90)·μ_L — 파라미터 창이 365 인 패턴에서도', () => {
    const out = computePolicy(
      input({ pattern: 'lumpy', dailyMean: 0.5, dailyMean90: 0.8, leadTime: { meanDays: 25, stdDays: 0 } }),
    );
    expect(out.legacyReorderPoint).toBe(20);
  });
});
