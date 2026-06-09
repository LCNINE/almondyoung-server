'use client';

// src/lib/api/domains/inventory/skus.client.ts
// SKU 관련 API 클라이언트

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateSkuDto,
  UpdateSkuDto,
  SkuResponseDto,
  AddBarcodeDto,
  BarcodeDto,
  SkuStockSummaryDto,
  SkuQuery,
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

export const skusClient = {
  createSku: async (data: CreateSkuDto): Promise<SkuResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus`,
      data
    );
    return response.data;
  },

  getSkus: async (
    query: SkuQuery = {}
  ): Promise<{ items: SkuResponseDto[]; total: number; limit: number; offset: number }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus?${buildQueryString(query as Record<string, unknown>)}`
    );
    // 백엔드 GET /inventory/skus 는 SkuResponseDto[] 배열을 그대로 반환하므로
    // 선언된 페이지네이션 형태로 정규화한다.
    const data = response.data;
    if (Array.isArray(data)) {
      return {
        items: data,
        total: data.length,
        limit: query.limit ?? data.length,
        offset: query.offset ?? 0,
      };
    }
    return data;
  },

  getSku: async (id: string): Promise<SkuResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  updateSku: async (id: string, data: UpdateSkuDto): Promise<SkuResponseDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },

  deleteSku: async (id: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`
    );
  },

  addBarcode: async (id: string, data: AddBarcodeDto): Promise<BarcodeDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}/barcodes`,
      data
    );
    return response.data;
  },

  removeBarcode: async (id: string, barcodeId: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(
        id
      )}/barcodes/${encodeURIComponent(barcodeId)}`
    );
  },

  getSkuStockSummary: async (id: string): Promise<SkuStockSummaryDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}/stock-summary`
    );
    return response.data;
  },
};
