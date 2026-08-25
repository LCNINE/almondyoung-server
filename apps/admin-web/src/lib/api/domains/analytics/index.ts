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

  getProductStatistics: async (
    query: StatisticsRangeQuery & { sort?: 'revenue' | 'quantity' | 'orders'; limit?: number }
  ): Promise<ProductStatistics> => {
    const params = new URLSearchParams(rangeQs(query));
    if (query.sort) params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/products?${params.toString()}`);
    return res.data;
  },

  getCustomerStatistics: async (query: StatisticsRangeQuery): Promise<CustomerStatistics> => {
    const res = await client.get(`${ANALYTICS_SERVICE_BASE_URL}/statistics/customers?${rangeQs(query)}`);
    return res.data;
  },
};
