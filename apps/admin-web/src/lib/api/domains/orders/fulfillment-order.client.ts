'use client';

// src/lib/api/domains/orders/fulfillment-order.client.ts
// Legacy endpoints kept only for:
//   - priority update (PUT /fulfillment-orders/:id/priority)
//   - legacy cancel/delete (DELETE /fulfillment-orders/:id)
//
// FO 생성/재고 action은 fulfillments.client.ts (POST /fulfillments) 사용

import type {
  DeleteFulfillmentOrderResponse,
  UpdatePriorityDto,
  UpdatePriorityResponse,
} from '../../../types/dto/orders';
import type {
  FulfillmentOrderDetail,
  FulfillmentOrdersListResponse,
  FulfillmentOrdersQuery,
  CreateStandaloneFulfillmentRequest,
} from '../../../types/dto/fulfillment';
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

export const fulfillmentOrder = {
  // 출고주문 목록 조회 (GET /fulfillments — 메인 FulfillmentsController, {data,total})
  list: async (
    query: FulfillmentOrdersQuery = {}
  ): Promise<FulfillmentOrdersListResponse> => {
    const params = new URLSearchParams();
    const limit = query.limit ?? 20;
    params.set('limit', String(limit));
    // page 우선, 없으면 offset 사용
    const offset =
      query.page != null ? Math.max(0, (query.page - 1) * limit) : query.offset ?? 0;
    params.set('offset', String(offset));
    if (query.status) params.set('status', query.status);
    if (query.warehouseId) params.set('warehouseId', query.warehouseId);
    if (query.fulfillmentMode) params.set('fulfillmentMode', query.fulfillmentMode);
    if (query.salesOrderId) params.set('salesOrderId', query.salesOrderId);
    if (query.priority) params.set('priority', query.priority);
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments?${params.toString()}`
    );
    return response.data;
  },

  // 출고주문 상세 조회 (GET /fulfillments/:id)
  getOne: async (id: string): Promise<FulfillmentOrderDetail> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  // 수동 standalone FO 생성 (POST /fulfillments — items 기반, salesOrderId 미사용)
  createStandalone: async (
    data: CreateStandaloneFulfillmentRequest
  ): Promise<FulfillmentOrderDetail> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments`,
      data
    );
    return response.data;
  },

  // 출고 처리 (POST /fulfillments/:id/ship)
  ship: async (id: string): Promise<FulfillmentOrderDetail> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments/${encodeURIComponent(id)}/ship`
    );
    return response.data;
  },

  // 출고주문 취소 (POST /fulfillments/:id/cancel)
  cancel: async (id: string): Promise<FulfillmentOrderDetail> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments/${encodeURIComponent(id)}/cancel`
    );
    return response.data;
  },

  // FOI 단위 재고 예약 (POST /fulfillments/:id/reserve)
  reserveItem: async (
    id: string,
    data: { fulfillmentOrderItemId: string; quantity: number }
  ): Promise<unknown> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillments/${encodeURIComponent(id)}/reserve`,
      data
    );
    return response.data;
  },

  // Fulfillment Order 삭제 (legacy cancel)
  delete: async (id: string): Promise<DeleteFulfillmentOrderResponse> => {
    const response = await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillment-orders/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  // Fulfillment Order 우선순위 변경
  updatePriority: async (
    id: string,
    data: UpdatePriorityDto
  ): Promise<UpdatePriorityResponse> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/fulfillment-orders/${encodeURIComponent(
        id
      )}/priority`,
      data
    );
    return response.data;
  },
};
