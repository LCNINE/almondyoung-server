import {
  BestSelectionMode,
  ReviewRewardKind,
  ReviewRewardPeriod,
  ReviewRewardTrigger,
  ReviewTypeFilter,
  UpsertReviewRewardRuleDto,
} from '@/lib/types/dto/review-reward';

export const TRIGGER_LABELS: Record<ReviewRewardTrigger, string> = {
  ON_REVIEW_CREATED: '리뷰 작성 시',
  WEEKLY_BEST: '주간 베스트 선정 시',
};

export const REWARD_KIND_LABELS: Record<ReviewRewardKind, string> = {
  NONE: '지급 없음',
  POINT_FIXED: '적립금 정액',
  POINT_RATE: '적립금 정률(주문금액 비례)',
  BADGE: '비금전 — 베스트 뱃지·상단 고정',
};

export const REVIEW_TYPE_LABELS: Record<ReviewTypeFilter, string> = {
  ANY: '전체',
  TEXT: '텍스트 리뷰만',
  PHOTO: '포토 리뷰만',
};

export const PERIOD_LABELS: Record<ReviewRewardPeriod, string> = {
  DAY: '하루',
  WEEK: '한 주',
  MONTH: '한 달',
  ALL: '누적 전체',
};

export const BEST_MODE_LABELS: Record<BestSelectionMode, string> = {
  HELPFUL_COUNT: '추천수 상위',
  RANDOM: '무작위 추첨',
};

/** 미지급 사유 — 원장에 남는 값과 1:1. 「왜 안 나갔나」를 화면에서 그대로 읽을 수 있어야 한다 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  NO_ACTIVE_RULE: '활성 규칙 없음',
  NO_MATCHING_RULE: '조건에 맞는 규칙 없음',
  REWARD_NONE: '규칙이 지급 없음으로 설정됨',
  ORDER_AMOUNT_UNKNOWN: '주문 금액을 알 수 없어 정률 계산 불가',
  PER_USER_LIMIT: '1인당 한도 초과',
  GLOBAL_LIMIT: '전체 예산 상한 초과',
  AMOUNT_ZERO: '계산 결과가 0원',
  NON_ORDER_PROVIDER: '주문으로 얻은 권한이 아니라 지급 대상 아님',
  UNKNOWN: '사유 없음',
};

export const GRANT_STATUS_LABELS: Record<string, string> = {
  GRANTED: '지급',
  SKIPPED: '미지급',
  REVOKED: '회수',
};

export function formatKrw(value: number | null | undefined): string {
  if (value == null) return '-';
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/** 새 규칙의 기본값 — 비활성, 지급 없음. 만들자마자 돈이 나가지 않는다 */
export function emptyRuleForm(): UpsertReviewRewardRuleDto {
  return {
    name: '',
    description: null,
    trigger: 'ON_REVIEW_CREATED',
    active: false,
    priority: 0,
    stopOnMatch: true,
    conditions: {
      reviewType: 'ANY',
      minContentLength: 0,
      minMediaCount: 0,
      minRating: null,
      everyNthReview: null,
      best: null,
    },
    reward: { kind: 'NONE' },
    limits: { perUser: null, global: null },
    startsAt: null,
    endsAt: null,
  };
}

/** 규칙 한 줄 요약 — 목록에서 「무엇을 주는 규칙인지」를 펼치지 않고 읽게 한다 */
export function describeReward(
  reward: UpsertReviewRewardRuleDto['reward']
): string {
  switch (reward.kind) {
    case 'NONE':
      return '지급 없음';
    case 'BADGE':
      return '베스트 뱃지 (비금전)';
    case 'POINT_FIXED':
      return `${formatKrw(reward.amount ?? 0)} 적립${reward.expiresInDays ? ` · ${reward.expiresInDays}일 후 만료` : ''}`;
    case 'POINT_RATE': {
      const cap = reward.maxAmount
        ? ` · 최대 ${formatKrw(reward.maxAmount)}`
        : '';
      const floor = reward.minAmount
        ? ` · 최소 ${formatKrw(reward.minAmount)}`
        : '';
      return `주문금액의 ${reward.ratePercent ?? 0}%${floor}${cap}`;
    }
    default:
      return '-';
  }
}

/**
 * 「지금 보상이 나가는가」에 대한 이 화면의 단언. 이 화면의 존재 이유가 그 단언이므로,
 * 목록을 «실제로 받아왔을 때만» 말한다 — 조회가 실패하면 규칙 배열이 undefined 라
 * 활성 0건과 구별되지 않아, 권한 없음(403)이 「아무 보상도 안 나갑니다」라는
 * 거짓 안심으로 그려진 적이 있다.
 */
export type RewardRuleNotice =
  | { kind: 'error' }
  | { kind: 'loading' }
  | { kind: 'counted'; activeCount: number };

export function rewardRuleNotice(state: {
  isError: boolean;
  rules?: Array<{ active: boolean }>;
}): RewardRuleNotice {
  if (state.isError) return { kind: 'error' };
  if (!state.rules) return { kind: 'loading' };
  return {
    kind: 'counted',
    activeCount: state.rules.filter((rule) => rule.active).length,
  };
}

/**
 * 지급 내역이 비었을 때 덧붙이는 «원인» 문장. 「활성 규칙이 없어서 안 쌓인다」는
 * 실제로 활성 규칙이 0건일 때만 참이다. 규칙 목록을 아직/못 받았으면 원인을 말하지 않는다.
 */
export function describeEmptyGrants(
  hasActiveRule: boolean | undefined
): string {
  if (hasActiveRule === false)
    return '활성 규칙이 없으면 판정 자체를 하지 않으므로 아무 행도 쌓이지 않습니다.';
  if (hasActiveRule === true)
    return '활성 규칙은 있으므로, 조건에 맞는 리뷰가 아직 없었다는 뜻입니다.';
  return '';
}
