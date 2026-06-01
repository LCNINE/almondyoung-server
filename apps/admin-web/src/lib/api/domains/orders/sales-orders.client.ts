'use client';

// src/lib/api/domains/orders/sales-orders.client.ts
// Sales Orders API 클라이언트

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  CancelSalesOrderDto,
  CancelSalesOrderResponseDto,
  ConfirmSalesOrderResponseDto,
  CreateBusinessLinkDto,
  CreateSalesOrderDto,
  CreateSalesOrderResponseDto,
  MergeSalesOrdersDto,
  MergeSalesOrdersResponseDto,
  OrderStatsDto,
  SalesOrderDto,
  SalesOrderBusinessTimelineItemDto,
  SalesOrdersQuery,
  SalesOrdersResponseDto,
  UpdateSalesOrderDto,
  UpdateSalesOrderResponseDto,
} from '../../../types/dto/orders';
import { client } from '../../client';

// 쿼리 파라미터를 URL에 추가하는 헬퍼 함수
const buildQueryString = (params: Record<string, any>): string => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, value.toString());
    }
  });
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
};

export const salesOrders = {
  // 판매 주문 생성
  createSalesOrder: async (
    data: CreateSalesOrderDto
  ): Promise<CreateSalesOrderResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders`,
      data
    );
    return response.data;
  },

  // 판매 주문 목록 조회
  getSalesOrders: async (
    query: SalesOrdersQuery
  ): Promise<SalesOrdersResponseDto> => {
    const queryString = buildQueryString(query);
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders${queryString}`
    );
    return response.data;
  },

  // 판매 주문 수정
  updateSalesOrder: async (
    id: string,
    data: UpdateSalesOrderDto
  ): Promise<UpdateSalesOrderResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },

  // 판매 주문 상세 조회
  getSalesOrder: async (id: string): Promise<SalesOrderDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  // 판매 주문 확정
  confirmSalesOrder: async (
    id: string
  ): Promise<ConfirmSalesOrderResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/confirm`
    );
    return response.data;
  },

  // 판매 주문 취소
  cancelSalesOrder: async (
    id: string,
    body?: CancelSalesOrderDto
  ): Promise<CancelSalesOrderResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/cancel`,
      body
    );
    return response.data;
  },

  // 관리자 주문 취소 + Wallet 자동 환불 (새 엔드포인트)
  adminCancelSalesOrder: async (
    id: string,
    body?: CancelSalesOrderDto
  ): Promise<{ status: string; refundStatus: string }> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/admin/sales-orders/${encodeURIComponent(id)}/cancel`,
      body
    );
    return response.data;
  },

  createBusinessLink: async (
    id: string,
    data: CreateBusinessLinkDto
  ): Promise<SalesOrderBusinessTimelineItemDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/business-links`,
      data
    );
    return response.data;
  },

  // 주문 현황 통계
  getStats: async (): Promise<OrderStatsDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/stats`
    );
    return response.data;
  },

  // 주문 병합 처리
  mergeSalesOrders: async (
    data: MergeSalesOrdersDto
  ): Promise<MergeSalesOrdersResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/merge`,
      data
    );
    return response.data;
  },
};
