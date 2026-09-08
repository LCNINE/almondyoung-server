import { DemandPattern } from './classification';
import { gammaQuantile, normalQuantile } from './distributions';

/**
 * 연속검토 (s, S) 정책 (스펙 §5). 순수 함수 — DB · Nest · drizzle 을 모른다.
 *
 *   μ_LTD = μ_D·μ_L,  σ²_LTD = μ_L·σ_D² + μ_D²·σ_L²
 *   ROP   = Q(1 − α; 분포, μ_LTD, σ_LTD),  SS = ROP − μ_LTD,  S = μ_D·(μ_L + cover) + SS
 *
 * smooth · insufficient → 정규, erratic · intermittent · lumpy → 감마(모멘트 일치), none → 0.
 * 오버라이드 SS 가 있으면 분포 계산을 건너뛴다. 레거시 값(μ_D(90)·μ_L)은 열람용으로 항상 낸다.
 */
export interface LeadTimeSegment {
  meanDays: number;
  stdDays: number;
}

export function composeLeadTime(segments: LeadTimeSegment[], bufferDays: number): LeadTimeSegment {
  const meanDays = segments.reduce((s, x) => s + x.meanDays, 0) + bufferDays;
  const variance = segments.reduce((s, x) => s + x.stdDays * x.stdDays, 0);
  return { meanDays, stdDays: Math.sqrt(variance) };
}

export interface PolicyInput {
  pattern: DemandPattern;
  dailyMean: number;
  dailyStd: number;
  dailyMean90: number;
  leadTime: LeadTimeSegment;
  alpha: number;
  coverDays: number;
  overrideSafetyStock: number | null;
}

export interface PolicyOutput {
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  leadTimeDays: number;
  distribution: 'normal' | 'gamma' | 'none';
  confidence: 'normal' | 'low';
  legacyReorderPoint: number;
}

const GAMMA_PATTERNS: ReadonlySet<DemandPattern> = new Set(['erratic', 'intermittent', 'lumpy']);

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function computePolicy(input: PolicyInput): PolicyOutput {
  const { dailyMean, dailyStd, leadTime, alpha, coverDays } = input;
  const muLtd = dailyMean * leadTime.meanDays;
  const sigmaLtd = Math.sqrt(
    leadTime.meanDays * dailyStd * dailyStd + dailyMean * dailyMean * leadTime.stdDays * leadTime.stdDays,
  );
  const confidence: PolicyOutput['confidence'] = input.pattern === 'insufficient' ? 'low' : 'normal';
  const legacyReorderPoint = round2(input.dailyMean90 * leadTime.meanDays);
  const leadTimeDays = round2(leadTime.meanDays);

  if (input.overrideSafetyStock !== null) {
    const ss = input.overrideSafetyStock;
    return {
      safetyStock: round2(ss),
      reorderPoint: round2(muLtd + ss),
      targetLevel: round2(dailyMean * (leadTime.meanDays + coverDays) + ss),
      leadTimeDays,
      distribution: 'none',
      confidence,
      legacyReorderPoint,
    };
  }

  // R1(ii): muLtd(=dailyMean·leadTime.meanDays) 로 조기 반환을 판정하면 리드타임이 아직
  // 0으로 설정된 SKU(수요는 있음, §5.1)의 목표수준 S 까지 잘못 0 이 된다. "수요 자체가
  // 없다"는 dailyMean 으로만 판정한다 — pattern='none' 은 분류기가 이미 그 경우로 낸다.
  if (input.pattern === 'none' || dailyMean <= 0) {
    return {
      safetyStock: 0,
      reorderPoint: 0,
      targetLevel: 0,
      leadTimeDays,
      distribution: 'none',
      confidence,
      legacyReorderPoint,
    };
  }

  const useGamma = GAMMA_PATTERNS.has(input.pattern);
  let reorderPoint: number;
  // muLtd <= 0 도 함께 걸러야 한다 — 리드타임 0(수요 있음) 인 경우 감마 형상 k = μ²/σ² 가
  // 0/0 이 되는 것을 막고, ROP = μ_LTD(=0) 로 정상 처리한다.
  if (sigmaLtd <= 0 || muLtd <= 0) {
    reorderPoint = muLtd;
  } else if (useGamma) {
    const shape = (muLtd * muLtd) / (sigmaLtd * sigmaLtd);
    const scale = (sigmaLtd * sigmaLtd) / muLtd;
    reorderPoint = gammaQuantile(1 - alpha, shape, scale);
  } else {
    reorderPoint = muLtd + normalQuantile(1 - alpha) * sigmaLtd;
  }
  const safetyStock = Math.max(0, reorderPoint - muLtd);

  return {
    safetyStock: round2(safetyStock),
    reorderPoint: round2(muLtd + safetyStock),
    targetLevel: round2(dailyMean * (leadTime.meanDays + coverDays) + safetyStock),
    leadTimeDays,
    distribution: useGamma ? 'gamma' : 'normal',
    confidence,
    legacyReorderPoint,
  };
}
