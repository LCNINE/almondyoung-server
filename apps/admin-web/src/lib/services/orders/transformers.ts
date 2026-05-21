// src/lib/services/orders/transformers.ts
// 주문 관련 데이터 변환 로직

import type {
  MatchingDto,
  MatchingsResponseDto,
  ResolveMatchingDto,
  StockPolicyDto,
} from '@/lib/types/dto/orders';

// ===== 기본 변환 함수들 =====
export const transformOrder = (dto: any) => dto;
export const transformOutboundBatch = (dto: any) => dto;
export const transformPicking = (dto: any) => dto;
export const transformFulfillment = (dto: any) => dto;
export const transformInvoice = (dto: any) => dto;

// ===== 매칭 관련 변환 함수들 =====

/**
 * 매칭 상태를 한국어로 변환
 */
export const getMatchingStatusLabel = (status: string): string => {
  const statusMap: Record<string, string> = {
    pending: '매칭 대기',
    matched: '매칭 완료',
    ignored: '무시됨',
  };
  return statusMap[status] || status;
};

/**
 * 매칭 전략을 한국어로 변환
 */
export const getMatchingStrategyLabel = (strategy: string): string => {
  const strategyMap: Record<string, string> = {
    void: '무효',
    variant: 'Variant',
    option: '옵션별',
  };
  return strategyMap[strategy] || strategy;
};

/**
 * 우선순위를 한국어로 변환
 */
export const getPriorityLabel = (priority: string): string => {
  const priorityMap: Record<string, string> = {
    normal: '일반',
    high: '높음',
  };
  return priorityMap[priority] || priority;
};

/**
 * 판매처 이름을 한국어로 변환
 */
export const getSalesChannelLabel = (channel: string): string => {
  const channelMap: Record<string, string> = {
    medusa: '아몬드영',
    naver: '네이버',
    coupang: '쿠팡',
    smartstore: '스마트스토어',
    phone_order: '전화주문',
    other: '기타',
  };
  return channelMap[channel.toLowerCase()] || channel.toUpperCase();
};

/**
 * 매칭 데이터를 테이블 표시용으로 변환
 */
export const transformMatchingForTable = (matching: MatchingDto) => {
  return {
    ...matching,
    statusLabel: getMatchingStatusLabel(matching.status),
    strategyLabel: getMatchingStrategyLabel(matching.strategy),
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
  };
};

/**
 * 매칭 목록을 테이블 표시용으로 변환
 */
export const transformMatchingsForTable = (response: MatchingsResponseDto) => {
  return {
    ...response,
    data: response.data.map(transformMatchingForTable),
  };
};

/**
 * 재고 정책을 기본값으로 초기화
 */
export const createDefaultStockPolicy = (): StockPolicyDto => ({
  preStockSellable: true,
  alwaysSellableZeroStock: false,
});

/**
 * 매칭 해소 요청을 기본값으로 초기화
 */
export const createDefaultResolveMatching = (): ResolveMatchingDto => ({
  ignore: false,
  strategy: 'variant',
  stockPolicy: createDefaultStockPolicy(),
  isGift: false,
});

/**
 * 매칭 상태별 색상 클래스 반환
 */
export const getMatchingStatusColor = (status: string): string => {
  const colorMap: Record<string, string> = {
    pending: 'text-orange-600 bg-orange-100',
    matched: 'text-green-600 bg-green-100',
    ignored: 'text-gray-600 bg-gray-100',
  };
  return colorMap[status] || 'text-gray-600 bg-gray-100';
};

/**
 * 우선순위별 색상 클래스 반환
 */
export const getPriorityColor = (priority: string): string => {
  const colorMap: Record<string, string> = {
    normal: 'text-blue-600 bg-blue-100',
    high: 'text-red-600 bg-red-100',
  };
  return colorMap[priority] || 'text-gray-600 bg-gray-100';
};

/**
 * 판매처별 색상 클래스 반환
 */
export const getSalesChannelColor = (channel: string): string => {
  const colorMap: Record<string, string> = {
    medusa: 'bg-purple-100 text-purple-600',
    naver: 'bg-green-100 text-green-600',
    coupang: 'bg-blue-100 text-blue-600',
    smartstore: 'bg-yellow-100 text-yellow-600',
    phone_order: 'bg-pink-100 text-pink-600',
    other: 'bg-gray-100 text-gray-600',
  };
  return colorMap[channel.toLowerCase()] || 'bg-gray-100 text-gray-600';
};
