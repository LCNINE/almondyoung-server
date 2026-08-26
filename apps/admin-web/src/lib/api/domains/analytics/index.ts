import { client } from '@/lib/api/client';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';

export type Granularity = 'day' | 'month' | 'year';

export interface StatisticsRangeQuery {
  from: string;
  to: string;
  channel?: string;
  granularity?: Granularity;
}

export interface RevenueTotals {
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  /** 취소가 취소일에 귀속되므로 음수가 될 수 있다 — 화면에서 숨기지 말고 표기한다 */
  netRevenue: number;
  ordersCount: number;
}

export interface SalesKpis extends RevenueTotals {
  avgOrderValue: number | null;
  cancelRefundRate: number | null;
}

export interface SalesStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  series: Array<{ bucket: string } & RevenueTotals>;
  channels: Array<{ salesChannel: string } & RevenueTotals>;
  cancelReasons: Array<{ reason: string; count: number }>;
}

export interface ProductRankingRow extends RevenueTotals {
  masterId: string;
  name: string | null;
  quantitySold: number;
  previousNetRevenue: number;
}

export interface ProductStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  ranking: ProductRankingRow[];
  categories: Array<{ categoryId: string; categoryName: string | null; grossRevenue: number; quantitySold: number }>;
  variants: Array<{
    variantId: string;
    variantName: string | null;
    isDefault: boolean;
    masterId: string;
    masterName: string | null;
    quantitySold: number;
    grossRevenue: number;
  }>;
}

export type ProductSort = 'revenue' | 'quantity' | 'orders';
export type ProductSortOrder = 'desc' | 'asc';

export interface ProductStatisticsQuery extends StatisticsRangeQuery {
  sort?: ProductSort;
  limit?: number;
  order?: ProductSortOrder;
}

export interface UnsoldProductRow {
  masterId: string;
  name: string | null;
  /** 전 기간 통틀어 마지막 판매일. null 이면 집계 이래 판매 기록 없음 */
  lastSoldDate: string | null;
}

export interface UnsoldProductsResult {
  range: { from: string; to: string };
  total: number;
  items: UnsoldProductRow[];
}

export interface CustomerStatistics {
  range: { from: string; to: string };
  lifetime: {
    customersTotal: number;
    repeatCustomers: number;
    repurchaseRate: number | null;
    ordersTotal: number;
    totalRevenue: number;
    avgRevenuePerCustomer: number | null;
  };
  newCustomers: Array<{ bucket: string; count: number }>;
  lifetimeDistribution: Array<{ bucket: string; count: number }>;
  membershipTrend: Array<{ aggDate: string; tierId: string; membersCount: number }>;
  cancellationReasons: Array<{ reasonCode: string; count: number }>;
  tierRevenue: Array<{
    tierId: string;
    grossRevenue: number;
    ordersCount: number;
    customersCount: number;
    avgOrderValue: number | null;
  }>;
}

export interface CustomerInsightsQuery {
  from: string;
  to: string;
  limit?: number;
  minBuyers?: number;
}

export interface CohortRow {
  cohortMonth: string;
  size: number;
  /** 경과 개월별 재구매 고객 비율. 아직 오지 않은 달은 null */
  retention: Array<number | null>;
}

export interface RfmCell {
  recency: string;
  frequency: string;
  customers: number;
  totalRevenue: number;
}

export interface CustomerInsights {
  range: { from: string; to: string };
  /** to 기준 최근 12개월 첫구매 코호트 — from 과 무관 */
  cohorts: { rows: CohortRow[]; maxOffset: number };
  rfm: {
    recencyBuckets: string[];
    frequencyBuckets: string[];
    cells: RfmCell[];
    segments: Array<{ key: string; label: string; customers: number }>;
    totalCustomers: number;
  };
  repurchase: {
    minBuyers: number;
    items: Array<{
      masterId: string;
      name: string | null;
      buyers: number;
      repeatBuyers: number;
      repurchaseRate: number;
      avgCycleDays: number | null;
    }>;
  };
  tierFlow: {
    transitions: Array<{ fromTier: string; toTier: string; count: number }>;
    currentDistribution: Array<{ tierId: string; count: number }>;
  };
}

export type TrafficChannelGroup = 'organic' | 'all';

export interface TrafficStatisticsQuery {
  from: string;
  to: string;
  channelGroup?: TrafficChannelGroup;
  limit?: number;
}

export interface TrafficTotals {
  sessions: number;
  totalUsers: number;
  pageViews: number;
  /** 참여 세션 ÷ 전체 세션. GA4 bounceRate(UA 와 정의가 다름)의 역수 */
  engagementRate: number | null;
}

export interface TrafficStatistics {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  range: { from: string; to: string };
  channelGroup: TrafficChannelGroup;
  totals: TrafficTotals | null;
  series: Array<{ date: string; sessions: number; engagementRate: number | null }>;
  landingPages: Array<{ path: string; sessions: number; engagementRate: number | null }>;
  devices: Array<{ label: string; sessions: number }>;
  countries: Array<{ label: string; sessions: number }>;
}

export interface BehaviorStatisticsQuery {
  from: string;
  to: string;
  limit?: number;
}

export interface BehaviorTotals {
  sessions: number;
  totalUsers: number;
  viewItem: number;
  addToCart: number;
  beginCheckout: number;
  addPaymentInfo: number;
  purchase: number;
}

export interface BehaviorStatistics {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  range: { from: string; to: string };
  totals: BehaviorTotals | null;
  series: Array<{
    date: string;
    sessions: number;
    viewItem: number;
    addToCart: number;
    purchase: number;
    conversionRate: number | null;
  }>;
  items: Array<{
    name: string;
    viewed: number;
    addedToCart: number;
    purchased: number;
    revenue: number;
    cartRate: number | null;
    purchaseRate: number | null;
  }>;
  devices: Array<{
    device: string;
    viewItem: number;
    addToCart: number;
    purchase: number;
    conversionRate: number | null;
  }>;
  /** 랜딩페이지별 매출 — SEO/유입 투자가 매출로 이어졌는지 (매출 내림차순) */
  landingRevenue: Array<{
    path: string;
    sessions: number;
    transactions: number;
    revenue: number;
    conversionRate: number | null;
  }>;
}

export interface DailyRevenueSummary extends RevenueTotals {
  date: string;
  avgOrderValue: number | null;
}

export interface AnalyticsOverview {
  today: DailyRevenueSummary;
  yesterday: DailyRevenueSummary;
  activeMembers: number | null;
  activeMembersAsOf: string | null;
}

function rangeQs(query: StatisticsRangeQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.channel) params.set('channel', query.channel);
  if (query.granularity) params.set('granularity', query.granularity);
  return params.toString();
}

export const analyticsApi = {
  getOverview: async (): Promise<AnalyticsOverview> => {
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/summary`);
    return res.data;
  },

  getSalesStatistics: async (query: StatisticsRangeQuery): Promise<SalesStatistics> => {
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/sales?${rangeQs(query)}`);
    return res.data;
  },

  getProductStatistics: async (query: ProductStatisticsQuery): Promise<ProductStatistics> => {
    const params = new URLSearchParams(rangeQs(query));
    if (query.sort) params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.order) params.set('order', query.order);
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/products?${params.toString()}`);
    return res.data;
  },

  getUnsoldProducts: async (
    query: StatisticsRangeQuery & { limit?: number }
  ): Promise<UnsoldProductsResult> => {
    const params = new URLSearchParams(rangeQs(query));
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/products/unsold?${params.toString()}`);
    return res.data;
  },

  getCustomerStatistics: async (query: StatisticsRangeQuery): Promise<CustomerStatistics> => {
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/customers?${rangeQs(query)}`);
    return res.data;
  },

  getCustomerInsights: async (query: CustomerInsightsQuery): Promise<CustomerInsights> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.limit) params.set('limit', String(query.limit));
    if (query.minBuyers) params.set('minBuyers', String(query.minBuyers));
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/customers/insights?${params.toString()}`);
    return res.data;
  },

  getTrafficStatistics: async (query: TrafficStatisticsQuery): Promise<TrafficStatistics> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.channelGroup) params.set('channelGroup', query.channelGroup);
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/traffic?${params.toString()}`);
    return res.data;
  },

  getBehaviorStatistics: async (query: BehaviorStatisticsQuery): Promise<BehaviorStatistics> => {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/behavior?${params.toString()}`);
    return res.data;
  },
};
