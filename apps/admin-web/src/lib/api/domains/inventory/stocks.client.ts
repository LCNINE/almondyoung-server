// src/lib/api/domains/inventory/stocks.client.ts
// 재고 관련 API 클라이언트

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  StockDto,
  StockSummaryDto,
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

// 재고 조회
export const getStocks = async (
  query: StockQuery = {}
): Promise<StockDto[]> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks?${buildQueryString(query as Record<string, unknown>)}`
  );
  return response.data;
};

// 재고 현황 요약 조회
export const getStockSummary = async (
  query: StockSummaryQuery = {}
): Promise<StockSummaryDto[]> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/summary?${buildQueryString(query as Record<string, unknown>)}`
  );
  return response.data;
};

// SKU별 총 재고 조회
export const getSkuTotalStock = async (
  skuId: string
): Promise<SkuTotalStockDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/sku/${encodeURIComponent(skuId)}/total`
  );
  return response.data;
};

// 특정 창고의 SKU별 재고 상세 조회
export const getSkuWarehouseStock = async (
  skuId: string,
  warehouseId: string
): Promise<SkuWarehouseStockDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/sku/${encodeURIComponent(
      skuId
    )}/warehouse/${encodeURIComponent(warehouseId)}`
  );
  return response.data;
};

// 재고 수량 조정
export const adjustStock = async (data: AdjustStockDto): Promise<void> => {
  await client.post(`${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/adjust`, data);
};

// 재고 이벤트 이력 조회
export const getStockHistory = async (
  query: StockHistoryQuery
): Promise<StockHistoryDto[]> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/history?${buildQueryString(query as unknown as Record<string, unknown>)}`
  );
  return response.data;
};

// 재고 현황 재구축
export const rebuildStockSummary = async (
  skuId: string,
  warehouseId: string
): Promise<void> => {
  await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/summary/${encodeURIComponent(
      skuId
    )}/${encodeURIComponent(warehouseId)}/rebuild`
  );
};

// 재고 이벤트 취소
export const cancelStockEvent = async (eventId: string): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/stocks/events/${encodeURIComponent(eventId)}/cancel`
  );
};

// 재고 관련 클라이언트 객체
export const stocksClient = {
  getStocks,
  getStockSummary,
  getSkuTotalStock,
  getSkuWarehouseStock,
  adjustStock,
  getStockHistory,
  rebuildStockSummary,
  cancelStockEvent,
};
