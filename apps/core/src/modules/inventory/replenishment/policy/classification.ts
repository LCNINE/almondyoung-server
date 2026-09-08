/**
 * ADI–CV² 사분면 분류 (스펙 §3 · §4.3). 순수 함수 — Nest · drizzle 을 모른다.
 * 임계와 같은 값은 낮은 쪽(smooth 쪽)으로 본다.
 */
export type DemandPattern = 'smooth' | 'intermittent' | 'erratic' | 'lumpy' | 'insufficient' | 'none';

/** 분류 창 안 이력이 이보다 짧으면 통계를 믿지 않는다(스펙 §4.3). 규칙 값이 아니라 상수다. */
export const MIN_HISTORY_DAYS = 30;

export interface ClassificationThresholds {
  adiThreshold: number;
  cv2Threshold: number;
  minDemandEvents: number;
}

export interface ClassificationStats {
  adi: number | null;
  cv2: number | null;
  demandEvents: number;
  historyDays: number;
}

export function classifyPattern(stats: ClassificationStats, t: ClassificationThresholds): DemandPattern {
  if (stats.demandEvents === 0) return 'none';
  if (stats.demandEvents < t.minDemandEvents) return 'insufficient';
  if (stats.historyDays < MIN_HISTORY_DAYS) return 'insufficient';
  if (stats.adi === null || stats.cv2 === null) return 'insufficient';
  const frequent = stats.adi <= t.adiThreshold;
  const stable = stats.cv2 <= t.cv2Threshold;
  if (frequent && stable) return 'smooth';
  if (frequent) return 'erratic';
  if (stable) return 'intermittent';
  return 'lumpy';
}
