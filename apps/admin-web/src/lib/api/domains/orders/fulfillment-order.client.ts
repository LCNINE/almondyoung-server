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
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

export const fulfillmentOrder = {
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
