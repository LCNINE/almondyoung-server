import { EffectiveParametersInput, resolveEffectiveParameters } from './effective-parameters';

function input(overrides: Partial<EffectiveParametersInput> = {}): EffectiveParametersInput {
  return {
    today: '2026-09-08',
    settings: {
      minLeadTimeObservations: 5,
      defaultLeadTimeDays: 30,
      defaultLeadTimeStdDays: null,
      defaultTransferLeadTimeDays: 14,
      defaultTransferLeadTimeStdDays: null,
      defaultLeadTimeCv: 0.25,
      defaultCoverDays: 30,
      defaultTransferCoverDays: 14,
    },
    gradeAlpha: { A: 0.02, B: 0.05, C: 0.1 },
    grade: 'B',
    override: null,
    supplierRule: null,
    supplierObservation: null,
    hasRoute: true,
    routeRule: null,
    routeObservation: null,
    ...overrides,
  };
}

describe('resolveEffectiveParameters — α', () => {
  it('등급 α 가 기본, SKU 예외 α 가 있으면 그것', () => {
    expect(resolveEffectiveParameters(input()).alpha).toEqual({ value: 0.05, source: 'grade' });
    expect(
      resolveEffectiveParameters(
        input({ override: { mode: 'auto', excludedUntil: null, safetyStock: null, alpha: 0.01 } }),
      ).alpha,
    ).toEqual({ value: 0.01, source: 'override' });
  });
});

describe('resolveEffectiveParameters — L1', () => {
  it('관측 n ≥ min 이면 관측', () => {
    // R3: routeRule 을 넣어 l2 가 route_rule 에서 나오게 한다 — 넣지 않으면 l2 가
    // global_default 로 떨어져 usesDefaultLeadTime 이 이 케이스에서도 true 가 되고,
    // "L1 이 관측에서 왔다" 는 이 단언이 무의미해진다.
    const p = resolveEffectiveParameters(
      input({
        supplierObservation: { observations: 5, meanDays: 12, stdDays: 3 },
        supplierRule: { leadTimeDays: 30, leadTimeStdDays: 4, coverDays: 45 },
        routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 5 },
      }),
    );
    expect(p.l1).toEqual({ meanDays: 12, stdDays: 3, source: 'observation' });
    expect(p.usesDefaultLeadTime).toBe(false);
  });
  it('관측 n < min 이면 공급사 규칙, 규칙도 없으면 전역 기본 + default_lead_time 표시', () => {
    const rule = resolveEffectiveParameters(
      input({
        supplierObservation: { observations: 4, meanDays: 12, stdDays: 3 },
        supplierRule: { leadTimeDays: 30, leadTimeStdDays: 4, coverDays: 45 },
      }),
    );
    expect(rule.l1).toEqual({ meanDays: 30, stdDays: 4, source: 'supplier_rule' });
    const global = resolveEffectiveParameters(
      input({ supplierObservation: { observations: 4, meanDays: 12, stdDays: 3 } }),
    );
    expect(global.l1).toEqual({ meanDays: 30, stdDays: 7.5, source: 'global_default' });
    expect(global.usesDefaultLeadTime).toBe(true);
  });
  it('σ 가 비어 있으면 cv · μ (규칙 · 관측 · 전역 모두)', () => {
    expect(
      resolveEffectiveParameters(input({ supplierRule: { leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 } })).l1
        .stdDays,
    ).toBe(5);
    expect(
      resolveEffectiveParameters(input({ supplierObservation: { observations: 9, meanDays: 8, stdDays: null } })).l1
        .stdDays,
    ).toBe(2);
    expect(
      resolveEffectiveParameters(input({ settings: { ...input().settings, defaultLeadTimeStdDays: 6 } })).l1.stdDays,
    ).toBe(6);
  });
});

describe('resolveEffectiveParameters — L2 · 커버', () => {
  // R1(i): l2 는 절대 null 이 아니다 — hasRoute=false 면 경로 규칙·관측을 무시하고
  // 전역 default_transfer_lead_time_* 로 떨어진다 (§6 의 L2 우선순위표에는 0/null 갈래가 없다).
  // null 을 냈다가 Task 6 이 {meanDays:0, stdDays:0} 으로 떨어뜨리면 판매창고 축 μ_LTD=0 →
  // ROP=0 → 이동 제안이 영구히 죽는다.
  it('hasRoute 가 false 면 경로 규칙 · 관측을 보지 않고 l2 는 전역 기본으로 떨어진다', () => {
    const p = resolveEffectiveParameters(
      input({ hasRoute: false, routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 5 } }),
    );
    expect(p.l2).toEqual({ meanDays: 14, stdDays: 3.5, source: 'global_default' });
    expect(p.usesDefaultLeadTime).toBe(true); // l1 이 전역 기본
  });
  it('L2 우선순위: 관측 > 경로 규칙 > 전역 이동 기본', () => {
    expect(
      resolveEffectiveParameters(
        input({
          routeObservation: { observations: 6, meanDays: 7, stdDays: 2 },
          routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 5 },
        }),
      ).l2,
    ).toEqual({ meanDays: 7, stdDays: 2, source: 'observation' });
    expect(
      resolveEffectiveParameters(input({ routeRule: { leadTimeDays: 9, leadTimeStdDays: null, coverDays: 5 } })).l2,
    ).toEqual({
      meanDays: 9,
      stdDays: 2.25,
      source: 'route_rule',
    });
    expect(resolveEffectiveParameters(input()).l2).toEqual({ meanDays: 14, stdDays: 3.5, source: 'global_default' });
  });
  it('커버는 공급사 규칙 > 전역, 이동 커버는 경로 규칙 > 전역', () => {
    const p = resolveEffectiveParameters(
      input({
        supplierRule: { leadTimeDays: 30, leadTimeStdDays: null, coverDays: 45 },
        routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 10 },
      }),
    );
    expect(p.coverDays).toEqual({ value: 45, source: 'supplier_rule' });
    expect(p.transferCoverDays).toEqual({ value: 10, source: 'route_rule' });
    expect(resolveEffectiveParameters(input()).coverDays).toEqual({ value: 30, source: 'global_default' });
    expect(resolveEffectiveParameters(input()).transferCoverDays).toEqual({ value: 14, source: 'global_default' });
  });
});

describe('resolveEffectiveParameters — 예외', () => {
  const excluded = (excludedUntil: string | null) => ({
    mode: 'excluded' as const,
    excludedUntil,
    safetyStock: null,
    alpha: null,
  });
  it('excluded 는 until 이 없거나 오늘 이후면 제외, 오늘보다 앞이면 auto', () => {
    expect(resolveEffectiveParameters(input({ override: excluded(null) })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-09-08') })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-12-31') })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-09-07') })).excluded).toBe(false);
    expect(
      resolveEffectiveParameters(
        input({ override: { mode: 'auto', excludedUntil: '2026-12-31', safetyStock: null, alpha: null } }),
      ).excluded,
    ).toBe(false);
    expect(resolveEffectiveParameters(input()).excluded).toBe(false);
  });
  it('안전재고 오버라이드는 그대로 넘긴다', () => {
    expect(
      resolveEffectiveParameters(
        input({ override: { mode: 'auto', excludedUntil: null, safetyStock: 40, alpha: null } }),
      ).overrideSafetyStock,
    ).toBe(40);
    expect(resolveEffectiveParameters(input()).overrideSafetyStock).toBeNull();
  });
});
