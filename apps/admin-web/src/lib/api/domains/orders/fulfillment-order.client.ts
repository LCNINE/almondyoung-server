// src/lib/api/domains/orders/fulfillment-order.client.ts
// Fulfillment Orders API 클라이언트

import type {
  CreateFulfillmentOrderDto,
  CreateFulfillmentOrderResponse,
  DeleteFulfillmentOrderResponse,
  UpdatePriorityDto,
  UpdatePriorityResponse,
  AllocateInventoryDto,
  AllocateInventoryResponse,
} from '../../../types/dto/orders';
import { WMS_BASE_URL } from '@/const';
import { client } from '../../client';

export const fulfillmentOrder = {
  // Fulfillment Order 생성
  create: async (
    data: CreateFulfillmentOrderDto
  ): Promise<CreateFulfillmentOrderResponse> => {
    const response = await client.post(
      `${WMS_BASE_URL}/wms/fulfillment-orders`,
      data
    );
    return response.data;
  },

  // Fulfillment Order 삭제
  delete: async (id: string): Promise<DeleteFulfillmentOrderResponse> => {
    const response = await client.delete(
      `${WMS_BASE_URL}/wms/fulfillment-orders/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  // Fulfillment Order 우선순위 변경
  updatePriority: async (
    id: string,
    data: UpdatePriorityDto
  ): Promise<UpdatePriorityResponse> => {
    const response = await client.put(
      `${WMS_BASE_URL}/wms/fulfillment-orders/${encodeURIComponent(
        id
      )}/priority`,
      data
    );
    return response.data;
  },

  // 재고 할당
  allocateInventory: async (
    id: string,
    data: AllocateInventoryDto
  ): Promise<AllocateInventoryResponse> => {
    const response = await client.post(
      `${WMS_BASE_URL}/wms/fulfillment-orders/${encodeURIComponent(
        id
      )}/allocate`,
      data
    );
    return response.data;
  },
};
