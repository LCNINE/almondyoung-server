import { DemandGrade } from '../demand/demand-profile.calculator';

/**
 * 규칙 우선순위 (스펙 §6). 순수 함수 — DB · Nest · drizzle 을 모른다.
 *   α       : SKU 예외 > 등급
 *   L1(μ,σ) : 관측(n ≥ min_lead_time_observations) > 공급사 규칙 > 전역 default_lead_time_*
 *   L2(μ,σ) : 관측 > 경로 규칙 > 전역 default_transfer_lead_time_*
 *   커버    : 공급사 규칙 > 전역. 이동 커버는 경로 규칙 > 전역
 *   σ 가 비면 σ = default_lead_time_cv · μ — 0 으로 두면 리드타임 변동이 조용히 사라진다(§5.2).
 *
 * R1(i) (Task 4 컨트롤러 결정): l2 는 절대 null 이 아니다. 브리프 원안은 hasRoute=false 면
 * l2:null 을 내고 Task 6 이 그걸 {meanDays:0, stdDays:0} 으로 떨어뜨리는 설계였는데, 그러면
 * 판매창고 축의 μ_LTD = 0 → ROP = 0 → 공급사 미정(sourceWarehouseId=null) SKU 의 이동 제안이
 * 영구히 안 뜬다. §6 의 L2 우선순위표엔 관측 > 경로 규칙 > 전역 셋뿐이고 0 갈래가 없다 — §4.4 의
 * "L2=0" 은 출발 창고 = 판매 창고인 *국내 발주* 의 전사 축 합성 얘기(§5.2)이지 이 함수의 계약이
 * 아니다. hasRoute 는 "경로 규칙·관측을 볼 것인가" 로만 쓰고, 어느 경우든 값을 낸다. 전사 축
 * 합성에 L2 를 더할지는 Task 6 이 hasRoute 로 판단한다.
 */
export type ParameterSource = 'override' | 'grade' | 'observation' | 'supplier_rule' | 'route_rule' | 'global_default';

export interface LeadTimeObservation {
  observations: number;
  meanDays: number;
  stdDays: number | null;
}

export interface LeadTimeRule {
  leadTimeDays: number;
  leadTimeStdDays: number | null;
  coverDays: number;
}

export interface SkuOverrideInput {
  mode: 'auto' | 'excluded';
  excludedUntil: string | null;
  safetyStock: number | null;
  alpha: number | null;
}

export interface ParameterSettings {
  minLeadTimeObservations: number;
  defaultLeadTimeDays: number;
  defaultLeadTimeStdDays: number | null;
  defaultTransferLeadTimeDays: number;
  defaultTransferLeadTimeStdDays: number | null;
  defaultLeadTimeCv: number;
  defaultCoverDays: number;
  defaultTransferCoverDays: number;
}

export interface EffectiveParametersInput {
  today: string;
  settings: ParameterSettings;
  gradeAlpha: Record<DemandGrade, number>;
  grade: DemandGrade;
  override: SkuOverrideInput | null;
  supplierRule: LeadTimeRule | null;
  supplierObservation: LeadTimeObservation | null;
  /** 경로 규칙 · 관측을 볼 것인가. false 면 그 둘을 무시하고 전역 이동 기본으로 떨어진다 — l2 는 항상 값을 낸다(R1(i)). */
  hasRoute: boolean;
  routeRule: LeadTimeRule | null;
  routeObservation: LeadTimeObservation | null;
}

export interface ResolvedSegment {
  meanDays: number;
  stdDays: number;
  source: ParameterSource;
}

export interface EffectiveParameters {
  excluded: boolean;
  alpha: { value: number; source: 'override' | 'grade' };
  l1: ResolvedSegment;
  /** R1(i): 항상 값이 있다. hasRoute=false 면 { source: 'global_default' } 로 떨어진다. */
  l2: ResolvedSegment;
  coverDays: { value: number; source: 'supplier_rule' | 'global_default' };
  transferCoverDays: { value: number; source: 'route_rule' | 'global_default' };
  overrideSafetyStock: number | null;
  /** l1 또는 l2 가 global_default 로 떨어졌다 — 스펙 §9.2 가 운영자에게 규칙을 채우라 유도하는 신호. */
  usesDefaultLeadTime: boolean;
}

function segment(meanDays: number, stdDays: number | null, cv: number, source: ParameterSource): ResolvedSegment {
  return { meanDays, stdDays: stdDays ?? cv * meanDays, source };
}

function resolveSegment(
  observation: LeadTimeObservation | null,
  rule: LeadTimeRule | null,
  fallback: { meanDays: number; stdDays: number | null; ruleSource: 'supplier_rule' | 'route_rule' },
  settings: ParameterSettings,
): ResolvedSegment {
  const cv = settings.defaultLeadTimeCv;
  if (observation && observation.observations >= settings.minLeadTimeObservations) {
    return segment(observation.meanDays, observation.stdDays, cv, 'observation');
  }
  if (rule) return segment(rule.leadTimeDays, rule.leadTimeStdDays, cv, fallback.ruleSource);
  return segment(fallback.meanDays, fallback.stdDays, cv, 'global_default');
}

export function resolveEffectiveParameters(input: EffectiveParametersInput): EffectiveParameters {
  const { settings, override } = input;

  const excluded =
    override !== null &&
    override.mode === 'excluded' &&
    (override.excludedUntil === null || override.excludedUntil >= input.today);

  const alpha =
    override !== null && override.alpha !== null
      ? { value: override.alpha, source: 'override' as const }
      : { value: input.gradeAlpha[input.grade], source: 'grade' as const };

  const l1 = resolveSegment(
    input.supplierObservation,
    input.supplierRule,
    { meanDays: settings.defaultLeadTimeDays, stdDays: settings.defaultLeadTimeStdDays, ruleSource: 'supplier_rule' },
    settings,
  );
  // R1(i): hasRoute=false 면 경로 규칙·관측을 아예 넘기지 않는다 — resolveSegment 는 rule/observation
  // 이 둘 다 없으면 전역 이동 기본으로 떨어지므로 l2 는 이 경로에서도 항상 값을 낸다.
  const l2 = resolveSegment(
    input.hasRoute ? input.routeObservation : null,
    input.hasRoute ? input.routeRule : null,
    {
      meanDays: settings.defaultTransferLeadTimeDays,
      stdDays: settings.defaultTransferLeadTimeStdDays,
      ruleSource: 'route_rule',
    },
    settings,
  );

  const coverDays = input.supplierRule
    ? { value: input.supplierRule.coverDays, source: 'supplier_rule' as const }
    : { value: settings.defaultCoverDays, source: 'global_default' as const };
  const transferCoverDays = input.routeRule
    ? { value: input.routeRule.coverDays, source: 'route_rule' as const }
    : { value: settings.defaultTransferCoverDays, source: 'global_default' as const };

  return {
    excluded,
    alpha,
    l1,
    l2,
    coverDays,
    transferCoverDays,
    overrideSafetyStock: override?.safetyStock ?? null,
    usesDefaultLeadTime: l1.source === 'global_default' || l2.source === 'global_default',
  };
}
