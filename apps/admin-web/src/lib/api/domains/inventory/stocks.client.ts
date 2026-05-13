'use client';

// src/lib/api/domains/inventory/stocks.client.ts
// 재고 관련 API 클라이언트

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  StockDto,
  StockSummariesResponseDto,
  SkuTotalStockDto,
  SkuWarehouseStockDto,
  AdjustStockDto,
  StockHistoryDto,
  StockQuery,
  StockSummaryQuery,
  StockHistoryQuery,
} from '../../../types/dto/inventory';

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const stocksClient = {
  getStocks: async (query: StockQuery = {}): Promise<StockDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks?${buildQueryString(query as Record<string, unknown>)}`
    );
    return response.data;
  },

  getStockSummary: async (
    query: StockSummaryQuery = {}
  ): Promise<StockSummariesResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/summary?${buildQueryString(query as Record<string, unknown>)}`
    );
    return response.data;
  },

  getSkuTotalStock: async (skuId: string): Promise<SkuTotalStockDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/sku/${encodeURIComponent(skuId)}/total`
    );
    return response.data;
  },

  getSkuWarehouseStock: async (
    skuId: string,
    warehouseId: string
  ): Promise<SkuWarehouseStockDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/sku/${encodeURIComponent(
        skuId
      )}/warehouse/${encodeURIComponent(warehouseId)}`
    );
    return response.data;
  },

  adjustStock: async (data: AdjustStockDto): Promise<void> => {
    await client.post(`${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/adjust`, data);
  },

  getStockHistory: async (query: StockHistoryQuery): Promise<StockHistoryDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/history?${buildQueryString(query as unknown as Record<string, unknown>)}`
    );
    return response.data;
  },

  rebuildStockSummary: async (skuId: string, warehouseId: string): Promise<void> => {
    await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/summary/${encodeURIComponent(
        skuId
      )}/${encodeURIComponent(warehouseId)}/rebuild`
    );
  },

  cancelStockEvent: async (eventId: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/events/${encodeURIComponent(eventId)}/cancel`
    );
  },
};
