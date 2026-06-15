// src/lib/services/matching/transformers.ts

import type {
  MatchingDto,
  MatchingsResponseDto,
  ResolveMatchingDto,
  StockPolicyDto,
  UpsertMatchingDto,
} from '@/lib/types/dto/matching';
import {
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
} from './strategy-decision';

export {
  getMatchingStrategyDecision,
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
  isMatchingStrategyDecisionComplete,
} from './strategy-decision';

export const getMatchingStatusLabel = (status: string): string => {
  const map: Record<string, string> = {
    pending: '전략 미결정',
    matched: '전략 결정 완료',
    ignored: '레거시 감사 대상',
  };
  return map[status] ?? status;
};

export const getMatchingStrategyLabel = (strategy?: string | null): string => {
  if (!strategy) return '전략 미결정';

  const map: Record<string, string> = {
    void: '재고상품 비매칭',
    variant: 'SKU 구성 매칭',
  };
  return map[strategy] ?? strategy;
};

export const getPriorityLabel = (priority: string): string => {
  const map: Record<string, string> = {
    normal: '일반',
    high: '높음',
  };
  return map[priority] ?? priority;
};

export const getSalesChannelLabel = (channel: string): string => {
  const map: Record<string, string> = {
    medusa: '아몬드영',
    naver: '네이버',
    coupang: '쿠팡',
    smartstore: '스마트스토어',
    phone_order: '전화주문',
    other: '기타',
  };
  return map[channel.toLowerCase()] ?? channel.toUpperCase();
};

export const transformMatchingForTable = (matching: MatchingDto) => ({
  ...matching,
  statusLabel: getMatchingStatusLabel(matching.status),
  strategyLabel: getMatchingStrategyLabel(matching.strategy),
  decisionLabel: getMatchingStrategyDecisionLabel(matching),
  priorityLabel: getPriorityLabel(matching.priority),
  salesChannelLabel: matching.order?.salesChannel
    ? getSalesChannelLabel(matching.order.salesChannel)
    : '알 수 없음',
  formattedSalesAmount: matching.order?.salesAmount
    ? matching.order.salesAmount.toLocaleString() + '원'
    : '0원',
  formattedOrderDate: matching.order?.orderDate
    ? new Date(matching.order.orderDate).toLocaleDateString('ko-KR')
    : '알 수 없음',
});

export const transformMatchingsForTable = (response: MatchingsResponseDto) => ({
  ...response,
  data: response.data.map(transformMatchingForTable),
});

export const createDefaultStockPolicy = (): StockPolicyDto => ({
  preStockSellable: true,
  alwaysSellableZeroStock: false,
  availabilityOverride: null,
});

export const normalizeStockPolicy = (
  policy?: Partial<StockPolicyDto> | null
): StockPolicyDto => ({
  ...createDefaultStockPolicy(),
  ...(policy ?? {}),
  availabilityOverride: policy?.availabilityOverride ?? null,
});

export const PRODUCT_SELLABLE_REASON_LABELS: Record<string, string> = {
  SELLABLE: '판매 가능',
  ALWAYS_SELLABLE_ZERO_STOCK: '항상 판매 가능',
  PRE_STOCK_SELLABLE: '선판매 가능',
  MANUAL_OUT_OF_STOCK: '수동 품절',
  NOT_ACTIVE_VERSION: '운영 버전 아님',
  VARIANT_INACTIVE: '품목 비활성',
  SALES_NOT_STARTED: '판매 시작 전',
  SALES_ENDED: '판매 종료',
  MATCHING_MISSING: '매칭 없음',
  MATCHING_PENDING: '매칭 필요',
  MATCHING_IGNORED: '매칭 감사 대상',
  MATCHING_STRATEGY_UNSUPPORTED: '지원하지 않는 전략',
  MATCHING_LINK_MISSING: 'SKU 구성 없음',
  INSUFFICIENT_COMPONENT_STOCK: '구성 SKU 재고 부족',
};

export const getProductSellableReasonLabel = (
  reason?: string | null
): string => {
  if (!reason) return '-';
  return PRODUCT_SELLABLE_REASON_LABELS[reason] ?? reason;
};

export const getProductSellableReasonBadgeVariant = (
  reason?: string | null,
  isSellable?: boolean
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (!reason) return 'outline';
  if (isSellable) return 'default';
  if (
    reason === 'MANUAL_OUT_OF_STOCK' ||
    reason === 'INSUFFICIENT_COMPONENT_STOCK'
  ) {
    return 'destructive';
  }
  return 'secondary';
};

export const buildUpsertMatchingPayload = ({
  masterId,
  links,
  policy,
  changedLinks,
}: {
  masterId?: string | null;
  links: NonNullable<UpsertMatchingDto['links']>;
  policy: UpsertMatchingDto['policy'];
  changedLinks: boolean;
}): UpsertMatchingDto => ({
  masterId,
  ...(changedLinks ? { links } : {}),
  policy,
});

export const createDefaultResolveMatching = (): ResolveMatchingDto => ({
  ignore: false,
  strategy: 'variant',
  stockPolicy: createDefaultStockPolicy(),
  isGift: false,
});

export const getMatchingStatusColor = (status: string): string => {
  const map: Record<string, string> = {
    pending: 'text-orange-600 bg-orange-100',
    matched: 'text-green-600 bg-green-100',
    ignored: 'text-neutral-600 bg-neutral-100',
  };
  return map[status] ?? 'text-neutral-600 bg-neutral-100';
};

export const getMatchingDecisionColor = getMatchingStrategyDecisionColor;

export const getPriorityColor = (priority: string): string => {
  const map: Record<string, string> = {
    normal: 'text-blue-600 bg-blue-100',
    high: 'text-red-600 bg-red-100',
  };
  return map[priority] ?? 'text-neutral-600 bg-neutral-100';
};

export const getSalesChannelColor = (channel: string): string => {
  const map: Record<string, string> = {
    medusa: 'bg-purple-100 text-purple-600',
    naver: 'bg-green-100 text-green-600',
    coupang: 'bg-blue-100 text-blue-600',
    smartstore: 'bg-yellow-100 text-yellow-600',
    phone_order: 'bg-pink-100 text-pink-600',
    other: 'bg-neutral-100 text-neutral-600',
  };
  return map[channel.toLowerCase()] ?? 'bg-neutral-100 text-neutral-600';
};
