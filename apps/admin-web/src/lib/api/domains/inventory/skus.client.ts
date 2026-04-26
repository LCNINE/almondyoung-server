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

// SKU 생성
export const createSku = async (
  data: CreateSkuDto
): Promise<SkuResponseDto> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus`,
    data
  );
  return response.data;
};

// SKU 검색
export const getSkus = async (
  query: SkuQuery = {}
): Promise<{ items: SkuResponseDto[]; total: number; limit: number; offset: number }> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus?${buildQueryString(query as Record<string, unknown>)}`
  );
  return response.data;
};

// SKU 상세 조회
export const getSku = async (id: string): Promise<SkuResponseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`
  );
  return response.data;
};

// SKU 수정
export const updateSku = async (
  id: string,
  data: UpdateSkuDto
): Promise<SkuResponseDto> => {
  const response = await client.put(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`,
    data
  );
  return response.data;
};

// SKU 삭제
export const deleteSku = async (id: string): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}`
  );
};

// SKU에 바코드 추가
export const addBarcode = async (
  id: string,
  data: AddBarcodeDto
): Promise<BarcodeDto> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}/barcodes`,
    data
  );
  return response.data;
};

// 바코드 제거
export const removeBarcode = async (
  id: string,
  barcodeId: string
): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(
      id
    )}/barcodes/${encodeURIComponent(barcodeId)}`
  );
};

// SKU 재고 요약 조회
export const getSkuStockSummary = async (
  id: string
): Promise<SkuStockSummaryDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/skus/${encodeURIComponent(id)}/stock-summary`
  );
  return response.data;
};

// SKU 관련 클라이언트 객체
export const skusClient = {
  createSku,
  getSkus,
  getSku,
  updateSku,
  deleteSku,
  addBarcode,
  removeBarcode,
  getSkuStockSummary,
};
