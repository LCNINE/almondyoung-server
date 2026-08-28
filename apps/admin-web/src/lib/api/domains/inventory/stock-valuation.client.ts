'use client';

// 재고 금액(묶인 돈) 통계 API 클라이언트 — core inventory 읽기 전용

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

export interface StockValuationState {
  state: 'ON_HAND' | 'DEFECTIVE' | 'IN_TRANSFER';
  quantity: number;
  value: number;
  uncostedQuantity: number;
}

export interface StockValuationWarehouse {
  warehouseId: string;
  warehouseName: string;
  isSellable: boolean;
  onHandQuantity: number;
  onHandValue: number;
  uncostedQuantity: number;
}

export interface StockValuationBucket {
  skuCount: number;
  onHandQuantity: number;
}

export interface StockValuationSummary {
  onHandValue: number;
  onHandQuantity: number;
  stockedSkuCount: number;
  states: StockValuationState[];
  warehouses: StockValuationWarehouse[];
  costMissing: StockValuationBucket;
  costConflict: StockValuationBucket;
  multiMaster: StockValuationBucket;
  unmatched: StockValuationBucket;
  soldOutMasterCount: number;
  generatedAt: string;
}

export interface StockValuationProduct {
  masterId: string;
  name: string | null;
  skuCount: number;
  onHandQuantity: number;
  onHandValue: number;
  hasUncostedSku: boolean;
}

export interface StockValuationProductsQuery {
  page?: number;
  limit?: number;
  sort?: 'value' | 'quantity';
  order?: 'asc' | 'desc';
  masterIds?: string[];
}

export interface StockValuationProductsResult {
  data: StockValuationProduct[];
  total: number;
  page: number;
  limit: number;
}

export const stockValuationClient = {
  getSummary: async (): Promise<StockValuationSummary> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/statistics/stock-valuation/summary`);
    return response.data;
  },

  getProducts: async (query: StockValuationProductsQuery = {}): Promise<StockValuationProductsResult> => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.sort) params.set('sort', query.sort);
    if (query.order) params.set('order', query.order);
    if (query.masterIds?.length) params.set('masterIds', query.masterIds.join(','));
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/statistics/stock-valuation/products?${params.toString()}`,
    );
    return response.data;
  },
};
