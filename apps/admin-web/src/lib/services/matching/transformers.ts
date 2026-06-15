// src/lib/services/matching/transformers.ts

import type {
  MatchingDto,
  MatchingsResponseDto,
  ResolveMatchingDto,
  StockPolicyDto,
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

export const normalizeStockPolicy = (policy?: Partial<StockPolicyDto> | null): StockPolicyDto => ({
  ...createDefaultStockPolicy(),
  ...(policy ?? {}),
  availabilityOverride: policy?.availabilityOverride ?? null,
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
