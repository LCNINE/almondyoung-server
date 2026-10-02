import {
  type ShopListingClassification,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from './shop-listing-classifier';

export interface AutoDecisionPolicy {
  /** 꺼져 있으면 판정 결과를 이력에 남기기만 하고 상태는 항상 pending (섀도 모드). */
  enabled: boolean;
  approveThreshold: number;
  rejectThreshold: number;
}

export const SHOP_LISTING_AUTO_DECISION_POLICY = Symbol('SHOP_LISTING_AUTO_DECISION_POLICY');

export type AutoDecision = 'published' | 'rejected' | 'pending';

/** 자동 거절 시 회원에게 보이는 사유. */
export const CLASSIFIER_REJECT_REASON = '샵 매매 글로 보기 어려워 게시되지 않았습니다. 내용을 고쳐 다시 제출해 주세요.';

export function decide(result: ShopListingClassification | null, policy: AutoDecisionPolicy): AutoDecision {
  if (!result || !policy.enabled) return 'pending';
  if (result.label === 'shop_listing' && result.confidence >= policy.approveThreshold) return 'published';
  if (result.label === 'not_shop_listing' && result.confidence >= policy.rejectThreshold) return 'rejected';
  return 'pending';
}

/** 판정기 장애가 글쓰기를 막지 않게 한다 — 실패·타임아웃은 null(= pending). */
export async function classifySafely(
  classifier: ShopListingClassifier,
  input: ShopListingClassifierInput,
  timeoutMs = 1_000,
): Promise<ShopListingClassification | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([classifier.classify(input).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 임계값은 Jev 섀도 모드에서 관리자 판정과 대조해 정한다(spec §6.3). 그 전까지 켜지 않으므로
 * 기본값은 보수적으로 둔다.
 */
export function autoDecisionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): AutoDecisionPolicy {
  return {
    enabled: env.SHOP_LISTING_AUTO_DECISION === 'on',
    approveThreshold: 0.95,
    rejectThreshold: 0.95,
  };
}
